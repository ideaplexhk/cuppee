// Tiny PostgreSQL migration runner (backlog M1.2).
//
// Applies server/migrations/NNNN_name.sql files in order, each in its own transaction, and records them in
// schema_migrations. Already-applied files are skipped, so running it again is safe. An applied file that has
// since been edited is refused: write a new migration instead.
//
// Run: DATABASE_URL=postgres://... node src/migrate.ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export type Migration = { version: string; name: string; sql: string; checksum: string };

/** Reads NNNN_name.sql files in order. A badly named .sql file or two files with one version number is an error. */
export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const bad = sqlFiles.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
  if (bad.length) throw new Error(`Badly named migration file(s): ${bad.join(', ')}. Use NNNN_lower_case_name.sql`);
  const seen = new Map<string, string>();
  return sqlFiles.map((f) => {
    const version = f.slice(0, 4);
    if (seen.has(version)) throw new Error(`Two migrations share version ${version}: ${seen.get(version)} and ${f}`);
    seen.set(version, f);
    const sql = readFileSync(dir + f, 'utf8');
    return { version, name: f, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

/** Applies pending migrations. Returns the file names applied this time. */
export async function migrate(client: pg.Client | pg.PoolClient, migrations = loadMigrations()): Promise<string[]> {
  // Only one runner at a time, even if two app instances start together.
  await client.query('SELECT pg_advisory_lock(727001)');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const done = new Map(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]),
    );
    const applied: string[] = [];
    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev !== undefined) {
        if (prev !== m.checksum) throw new Error(`Migration ${m.name} was changed after it was applied. Add a new migration instead.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('COMMIT');
      } catch (e) {
        // Keep the migration's own error even if the rollback fails too (e.g. the connection dropped).
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
      }
      applied.push(m.name);
    }
    return applied;
  } finally {
    // Never let a failed unlock hide the real error; a dropped connection releases the lock anyway.
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL, e.g. postgres://user:pass@localhost:5432/cuppee');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}
