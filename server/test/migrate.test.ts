// Backlog M1.2: PostgreSQL schema and migrations, tested against a real Postgres.
// Needs DATABASE_URL (CI provides a Postgres service). Each test run works in its own throwaway schema.
// In CI a missing DATABASE_URL is a failure, never a silent skip.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { openDb } from '../src/db.ts';
import { loadMigrations, migrate, MIGRATIONS_DIR } from '../src/migrate.ts';

const url = process.env.DATABASE_URL;
const skip = !url && !process.env.CI ? 'DATABASE_URL not set: Postgres tests need a database' : false;
if (!url && process.env.CI) throw new Error('DATABASE_URL must be set in CI so the Postgres tests run');

let client: pg.Client;
let schema: string;

async function freshSchema() {
  schema = `t_${randomBytes(6).toString('hex')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
}

before(async () => {
  if (skip) return;
  client = new pg.Client({ connectionString: url });
  await client.connect();
  await freshSchema();
});

after(async () => {
  if (skip) return;
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

test('migrations apply once, and a second run applies nothing', { skip }, async () => {
  const first = await migrate(client);
  assert.deepEqual(first, loadMigrations().map((m) => m.name));
  assert.ok(first.includes('0001_init.sql'));
  assert.deepEqual(await migrate(client), []);
});

test('Postgres has the same tables and columns as the v0.1 SQLite schema', { skip }, async () => {
  const lite = openDb(':memory:');
  const liteTables = (lite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const pgTables = (
    await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name <> 'schema_migrations' ORDER BY table_name",
      [schema],
    )
  ).rows.map((t) => t.table_name);
  assert.deepEqual(pgTables, liteTables);
  for (const t of liteTables) {
    const liteCols = (lite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).sort();
    let pgCols = [...(await columns(t)).keys()].sort();
    // Postgres has no rowid, so otp_codes gets an explicit id.
    if (t === 'otp_codes') pgCols = pgCols.filter((c) => c !== 'id');
    assert.deepEqual(pgCols, liteCols, `columns of ${t}`);
  }
});

test('every café-owned table carries a required cafe_id', { skip }, async () => {
  for (const t of ['cafe_menu', 'staff', 'stands', 'stand_events', 'visits', 'redemptions', 'pos_orders']) {
    const c = (await columns(t)).get('cafe_id');
    assert.ok(c, `${t} has cafe_id`);
    assert.equal(c.is_nullable, 'NO', `${t}.cafe_id is NOT NULL`);
  }
  // Network-wide rows may leave it empty: beans in the ledger, and network rewards.
  assert.equal((await columns('ledger')).get('cafe_id')?.is_nullable, 'YES');
  assert.equal((await columns('rewards')).get('cafe_id')?.is_nullable, 'YES');
});

test('a stamp in the ledger must name its café; a bean need not', { skip }, async () => {
  await client.query("INSERT INTO members (id, phone, created_at) VALUES ('mem_t', '+85290000000', 0)");
  await client.query("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, created_at) VALUES ('led_b', 'mem_t', NULL, 'bean', 10, 'visit', 0)");
  await assert.rejects(
    client.query("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, created_at) VALUES ('led_s', 'mem_t', NULL, 'stamp', 1, 'visit', 0)"),
    /check constraint/,
  );
});

test('money is exact decimal, never floating point', { skip }, async () => {
  assert.equal((await columns('pos_orders')).get('total_hkd')?.data_type, 'numeric');
  assert.equal((await columns('cafe_menu')).get('price_hkd')?.data_type, 'numeric');
});

test('an applied migration that was edited afterwards is refused', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const f = join(dir, '0001_init.sql');
  writeFileSync(f, readFileSync(f, 'utf8') + '\n-- edited\n');
  await assert.rejects(migrate(client, loadMigrations(dir + '/')), /was changed after it was applied/);
});

test('a failing migration is rolled back and not recorded', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  writeFileSync(join(dir, '9999_broken.sql'), 'CREATE TABLE half_done (id TEXT); SELECT * FROM no_such_table;');
  await assert.rejects(migrate(client, loadMigrations(dir + '/')), /9999_broken.sql failed/);
  const t = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'half_done'", [schema]);
  assert.equal(t.rowCount, 0);
  const v = await client.query("SELECT 1 FROM schema_migrations WHERE version = '9999'");
  assert.equal(v.rowCount, 0);
});
