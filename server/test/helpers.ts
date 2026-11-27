import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadConfig, type Config } from '../src/config.ts';
import { openDb, type DB } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { createApp } from '../src/app.ts';
import { ConsoleSms } from '../src/lib/sms.ts';
import { hashPin, sha256, now } from '../src/lib/util.ts';

/**
 * The API tests run against a real PostgreSQL (backlog M1.3). CI provides one; locally, for example:
 *   docker run -d -p 5432:5432 -e POSTGRES_USER=cuppee -e POSTGRES_PASSWORD=cuppee -e POSTGRES_DB=cuppee_test postgres:16
 *   export DATABASE_URL=postgres://cuppee:cuppee@localhost:5432/cuppee_test
 */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set: the server tests need a PostgreSQL database (see test/helpers.ts)');
  return url;
}

/** A throwaway schema with the migrations applied, and a DB whose connections all use it. */
export async function freshTestDb(): Promise<{ db: DB; drop: () => Promise<void> }> {
  const url = testDatabaseUrl();
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const db = openDb(url, { options: `-c search_path=${schema}` });
  const client = await db.pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  return {
    db,
    drop: async () => {
      await db.close();
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    },
  };
}

export async function startTestServer(overrides: Partial<Config> = {}) {
  const { db, drop } = await freshTestDb();
  const cfg = loadConfig({ databaseUrl: testDatabaseUrl(), ...overrides });
  await seedMinimal(db);
  const sms = new ConsoleSms(true);
  const server = createApp(db, cfg, sms);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }

  async function signUp(phone = '91234567', name = 'Ada') {
    const r1 = await call('POST', '/v1/auth/otp/request', { body: { phone } });
    const r2 = await call('POST', '/v1/auth/otp/verify', { body: { phone, code: r1.data.devCode, displayName: name } });
    return r2.data as { token: string; memberId: string };
  }

  async function staffToken(cafeId = 'cafe_a', staffId = 'stf_a') {
    const r = await call('POST', '/v1/staff/login', { body: { cafeId, staffId, pin: '1234' } });
    return r.data.token as string;
  }

  const standHeaders = { 'x-stand-id': 'std_a', 'x-stand-key': 'stand-key-a' };

  async function close() {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await drop();
  }

  return { cfg, db, sms, base, call, signUp, staffToken, standHeaders, close };
}

async function seedMinimal(db: DB) {
  const add = (sql: string, ...args: any[]) => db.run(sql, args);
  await add("INSERT INTO cafes (id, name, stamp_goal, beans_per_visit, beans_per_10hkd, pos_provider, pos_location_ref) VALUES ('cafe_a', 'Café A', 3, 10, 1, 'generic', 'loc-a')");
  await add("INSERT INTO cafes (id, name, stamp_goal, beans_per_visit) VALUES ('cafe_b', 'Café B', 9, 10)");
  await add("INSERT INTO staff (id, cafe_id, name, pin_hash) VALUES ('stf_a', 'cafe_a', 'Barista A', $1)", hashPin('1234'));
  await add("INSERT INTO staff (id, cafe_id, name, pin_hash) VALUES ('stf_b', 'cafe_b', 'Barista B', $1)", hashPin('1234'));
  await add("INSERT INTO stands (id, cafe_id, key_hash) VALUES ('std_a', 'cafe_a', $1)", sha256('stand-key-a'));
  await add("INSERT INTO rewards (id, title, cost_beans) VALUES ('rwd_1', 'Free size-up', 20)");
  await add("INSERT INTO cups (id, uid, tag_type, qr_code, created_at) VALUES ('cup_213', '04A1B2C3D4E5F6', 'ntag213', 'CUP-0001', $1)", now());
  await add("INSERT INTO cups (id, uid, tag_type, qr_code, created_at) VALUES ('cup_424', '04DE5F1EACC040', 'ntag424', 'CUP-0424', $1)", now());
}

// NXP AN12196 example: all-zero keys, UID 04DE5F1EACC040, counter 61.
export const NXP_SUN = { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' };
