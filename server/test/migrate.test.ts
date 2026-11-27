// Backlog M1.2: PostgreSQL schema and migrations, tested against a real Postgres.
// Needs DATABASE_URL (see test/helpers.ts); without it the tests fail, never skip. Each run uses a throwaway schema.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { loadMigrations, migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { testDatabaseUrl } from './helpers.ts';

const url = testDatabaseUrl();

let client: pg.Client;
let schema: string;

async function freshSchema() {
  schema = `t_${randomBytes(6).toString('hex')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
}

before(async () => {
  client = new pg.Client({ connectionString: url });
  await client.connect();
  await freshSchema();
});

after(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
});

async function columns(table: string) {
  const r = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
    'SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [schema, table],
  );
  return new Map(r.rows.map((c) => [c.column_name, c]));
}

test('migrations apply once, and a second run applies nothing', async () => {
  const first = await migrate(client);
  assert.deepEqual(first, loadMigrations().map((m) => m.name));
  assert.ok(first.includes('0001_init.sql'));
  assert.deepEqual(await migrate(client), []);
});

// ---- structural comparison helpers: describe each table the same way for SQLite and Postgres

type Shape = {
  columns: Record<string, { notNull: boolean; dflt: string | null; pk: boolean }>;
  foreignKeys: string[]; // "col->table.col"
  uniques: string[];     // "a,b" (unique indexes and UNIQUE constraints, not the primary key)
  indexes: string[];     // "a,b" (plain indexes)
};

/** '{}'::text -> '{}', '-1'::integer -> -1, 'barista'::text -> 'barista' */
function normDefault(d: string | null): string | null {
  if (d === null || d === undefined) return null;
  let v = String(d).replace(/::[a-z ]+$/i, '').trim();
  if (/^'-?\d+(\.\d+)?'$/.test(v)) v = v.slice(1, -1);
  return v;
}

// The v0.1 SQLite schema (the old src/db.ts), captured as PRAGMA output before SQLite was removed in M1.3.
type LiteTable = Shape & { checks: { column: string; values: string[] }[] };
const SQLITE_V01: Record<string, LiteTable> = JSON.parse(readFileSync(new URL('./fixtures/v0.1-sqlite-schema.json', import.meta.url), 'utf8'));

async function pgShape(t: string, skipCols: string[] = []): Promise<Shape> {
  const cols = await client.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
    'SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [schema, t],
  );
  const pkCols = (
    await client.query<{ col: string }>(
      `SELECT a.attname AS col FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`${schema}.${t}`],
    )
  ).rows.map((r) => r.col);
  const columns: Shape['columns'] = {};
  for (const c of cols.rows) {
    if (skipCols.includes(c.column_name)) continue;
    columns[c.column_name] = { notNull: c.is_nullable === 'NO', dflt: normDefault(c.column_default), pk: pkCols.includes(c.column_name) };
  }
  const foreignKeys = (
    await client.query<{ fk: string }>(
      `SELECT a.attname || '->' || rt.relname || '.' || ra.attname AS fk
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_class rt ON rt.oid = c.confrelid
       JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
       WHERE c.contype = 'f' AND c.conrelid = $1::regclass`,
      [`${schema}.${t}`],
    )
  ).rows.map((r) => r.fk).sort();
  const ix = await client.query<{ cols: string; uniq: boolean }>(
    `SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS cols, i.indisunique AS uniq
     FROM pg_index i
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = $1::regclass AND NOT i.indisprimary
     GROUP BY i.indexrelid, i.indisunique`,
    [`${schema}.${t}`],
  );
  return {
    columns,
    foreignKeys,
    uniques: ix.rows.filter((r) => r.uniq).map((r) => r.cols).sort(),
    indexes: ix.rows.filter((r) => !r.uniq).map((r) => r.cols).sort(),
  };
}

/** Every CHECK in the SQLite table must exist in Postgres on the same column with the same allowed values. */
async function checksCovered(t: string) {
  const pgDefs = (
    await client.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c' AND conrelid = $1::regclass", [
      `${schema}.${t}`,
    ])
  ).rows.map((r) => r.def);
  for (const c of SQLITE_V01[t].checks) {
    const hit = pgDefs.find((d) => d.includes(c.column) && c.values.every((v) => d.includes(v)));
    assert.ok(hit, `${t}: CHECK on ${c.column} IN (${c.values.join(', ')}) is missing in Postgres`);
  }
  return SQLITE_V01[t].checks.length;
}

test('Postgres matches the v0.1 SQLite schema: columns, nullability, defaults, keys, indexes and checks', async () => {
  const liteTables = Object.keys(SQLITE_V01).sort();
  const pgTables = (
    await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name <> 'schema_migrations' ORDER BY table_name",
      [schema],
    )
  ).rows.map((t) => t.table_name);
  assert.deepEqual(pgTables, liteTables);
  let checks = 0;
  for (const t of liteTables) {
    // Postgres has no rowid, so otp_codes has an explicit id primary key; compare the rest.
    const { checks: _, ...want } = SQLITE_V01[t];
    const got = await pgShape(t, t === 'otp_codes' ? ['id'] : []);
    assert.deepEqual(got.columns, want.columns, `columns of ${t}`);
    assert.deepEqual(got.foreignKeys, want.foreignKeys, `foreign keys of ${t}`);
    assert.deepEqual(got.uniques, want.uniques, `unique keys of ${t}`);
    assert.deepEqual(got.indexes, want.indexes, `indexes of ${t}`);
    checks += await checksCovered(t);
  }
  assert.equal(checks, 7, 'all 7 SQLite CHECK constraints were compared');
});

test('every café-owned table carries a required cafe_id', async () => {
  for (const t of ['cafe_menu', 'staff', 'stands', 'stand_events', 'visits', 'redemptions', 'pos_orders']) {
    const c = (await columns(t)).get('cafe_id');
    assert.ok(c, `${t} has cafe_id`);
    assert.equal(c.is_nullable, 'NO', `${t}.cafe_id is NOT NULL`);
    assert.ok((await pgShape(t)).foreignKeys.includes('cafe_id->cafes.id'), `${t}.cafe_id references cafes(id)`);
  }
  // Network-wide rows may leave it empty: beans in the ledger, and network rewards.
  assert.equal((await columns('ledger')).get('cafe_id')?.is_nullable, 'YES');
  assert.equal((await columns('rewards')).get('cafe_id')?.is_nullable, 'YES');
});

test('a stamp in the ledger must name its café; a bean need not', async () => {
  await client.query("INSERT INTO members (id, phone, created_at) VALUES ('mem_t', '+85290000000', 0)");
  await client.query("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, created_at) VALUES ('led_b', 'mem_t', NULL, 'bean', 10, 'visit', 0)");
  await assert.rejects(
    client.query("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, created_at) VALUES ('led_s', 'mem_t', NULL, 'stamp', 1, 'visit', 0)"),
    /check constraint/,
  );
});

test('money is exact decimal, never floating point', async () => {
  assert.equal((await columns('pos_orders')).get('total_hkd')?.data_type, 'numeric');
  assert.equal((await columns('cafe_menu')).get('price_hkd')?.data_type, 'numeric');
});

test('an applied migration that was edited afterwards is refused', async () => {
  const dir = copyMigrations({});
  writeFileSync(dir + '0001_init.sql', readFileSync(dir + '0001_init.sql', 'utf8') + '\n-- edited\n');
  await assert.rejects(migrate(client, loadMigrations(dir)), /was changed after it was applied/);
});

function copyMigrations(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(dir, name), sql);
  return dir + '/';
}

test('a migration and its record commit together, or not at all', async () => {
  // The SQL itself succeeds, but recording it fails (the file already claims its own version), so the runner's
  // explicit transaction must undo the table too. Without that transaction the table would survive.
  const dir = copyMigrations({
    '9998_atomic.sql': "CREATE TABLE half_done (id TEXT); INSERT INTO schema_migrations (version, name, checksum) VALUES ('9998', 'x', 'x');",
  });
  await assert.rejects(migrate(client, loadMigrations(dir)), /9998_atomic.sql failed/);
  const t = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'half_done'", [schema]);
  assert.equal(t.rowCount, 0, 'table from a failed migration was kept');
  const v = await client.query("SELECT 1 FROM schema_migrations WHERE version = '9998'");
  assert.equal(v.rowCount, 0, 'failed migration was recorded');
});

test('the migration lock is released after a failure, and two runners at once apply each file once', async () => {
  const dir = copyMigrations({ '9997_broken.sql': 'SELECT * FROM no_such_table;' });
  await assert.rejects(migrate(client, loadMigrations(dir)), /9997_broken.sql failed/);
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  try {
    const got = await other.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(727001) AS ok');
    assert.equal(got.rows[0].ok, true, 'another session can take the lock after the failure');
    await other.query('SELECT pg_advisory_unlock(727001)');

    // Fresh schema shared by two clients migrating at the same time.
    const shared = `t_${randomBytes(6).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${shared}`);
    const a = new pg.Client({ connectionString: url });
    await a.connect();
    try {
      await a.query(`SET search_path TO ${shared}`);
      await other.query(`SET search_path TO ${shared}`);
      const [ra, rb] = await Promise.all([migrate(a), migrate(other)]);
      assert.deepEqual([...ra, ...rb].sort(), loadMigrations().map((m) => m.name).sort(), 'each migration applied exactly once');
    } finally {
      await a.end();
      await client.query(`DROP SCHEMA ${shared} CASCADE`);
    }
  } finally {
    await other.end();
  }
});

test('badly named or duplicate-version migration files are refused before anything runs', () => {
  assert.throws(() => loadMigrations(copyMigrations({ '0003_AddThing.sql': 'SELECT 1;' })), /Badly named migration/);
  assert.throws(() => loadMigrations(copyMigrations({ '0001_again.sql': 'SELECT 1;' })), /share version 0001/);
});
