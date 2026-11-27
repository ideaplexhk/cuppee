import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from '../src/config.ts';
import { openDb, type DB } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { ConsoleSms } from '../src/lib/sms.ts';
import { hashPin, sha256, now } from '../src/lib/util.ts';

export async function startTestServer(overrides: Partial<Config> = {}) {
  const cfg = loadConfig({ dbPath: ':memory:', ...overrides });
  const db = openDb(':memory:');
  seedMinimal(db);
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

  return { cfg, db, sms, base, call, signUp, staffToken, standHeaders, close: () => server.close() };
}

function seedMinimal(db: DB) {
  const add = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
  add("INSERT INTO cafes (id, name, stamp_goal, beans_per_visit, beans_per_10hkd, pos_provider, pos_location_ref) VALUES ('cafe_a', 'Café A', 3, 10, 1, 'generic', 'loc-a')");
  add("INSERT INTO cafes (id, name, stamp_goal, beans_per_visit) VALUES ('cafe_b', 'Café B', 9, 10)");
  add("INSERT INTO staff (id, cafe_id, name, pin_hash) VALUES ('stf_a', 'cafe_a', 'Barista A', ?)", hashPin('1234'));
  add("INSERT INTO staff (id, cafe_id, name, pin_hash) VALUES ('stf_b', 'cafe_b', 'Barista B', ?)", hashPin('1234'));
  add("INSERT INTO stands (id, cafe_id, key_hash) VALUES ('std_a', 'cafe_a', ?)", sha256('stand-key-a'));
  add("INSERT INTO rewards (id, title, cost_beans) VALUES ('rwd_1', 'Free size-up', 20)");
  add("INSERT INTO cups (id, uid, tag_type, qr_code, created_at) VALUES ('cup_213', '04A1B2C3D4E5F6', 'ntag213', 'CUP-0001', ?)", now());
  add("INSERT INTO cups (id, uid, tag_type, qr_code, created_at) VALUES ('cup_424', '04DE5F1EACC040', 'ntag424', 'CUP-0424', ?)", now());
}

// NXP AN12196 example: all-zero keys, UID 04DE5F1EACC040, counter 61.
export const NXP_SUN = { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' };
