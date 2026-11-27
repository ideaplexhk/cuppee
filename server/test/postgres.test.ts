// Backlog M1.3: behaviour that the move from SQLite to PostgreSQL could have changed.
// SQLite ran each request synchronously, so requests never overlapped; on a pg pool they do. These tests prove the
// request transaction keeps the old guarantees, and that values come back with the same JavaScript types.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { startTestServer, freshTestDb, testDatabaseUrl } from './helpers.ts';
import { tx, backoffMs } from '../src/db.ts';

import { HttpError, hashPin, sha256 } from '../src/lib/util.ts';

describe('on PostgreSQL', () => {
  let s: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => (s = await startTestServer({ visitCooldownMs: 0, debounceMs: 0 })));
  after(() => s.close());

  /** A member with `visits` confirmed visits at café A (stamp goal 3, 10 beans a visit). */
  async function memberWithVisits(phone: string, visits: number) {
    const m = await s.signUp(phone, 'Racer');
    await s.db.run('UPDATE cups SET member_id = $1 WHERE id = $2', [m.memberId, 'cup_213']);
    const staff = await s.staffToken();
    for (let i = 0; i < visits; i++) {
      const ev = await s.call('POST', '/v1/stand/events', {
        headers: s.standHeaders,
        body: { events: [{ eventId: `${phone}-${i}`, readAt: Date.now(), uid: '04A1B2C3D4E5F6' }] },
      });
      assert.equal(ev.data.results[0].status, 'pending', JSON.stringify(ev.data));
      const ok = await s.call('POST', `/v1/staff/events/${ev.data.results[0].id}/confirm`, { token: staff });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
    }
    return { ...m, staff };
  }

  test('two staff redeeming the same stamp card at once: exactly one succeeds', async () => {
    const m = await memberWithVisits('95550001', 3);
    const tries = await Promise.all(
      Array.from({ length: 4 }, () => s.call('POST', '/v1/staff/redeem/stamp-card', { token: m.staff, body: { memberId: m.memberId } })),
    );
    assert.deepEqual(tries.map((t) => t.status).sort(), [200, 409, 409, 409], JSON.stringify(tries.map((t) => t.data)));
    const left = await s.db.one('SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = $1 AND unit = $2', [m.memberId, 'stamp']);
    assert.equal(left!.n, 0, 'stamps never go below zero');
  });

  test('spending beans twice at once: only what the member has is spent', async () => {
    const m = await memberWithVisits('95550002', 3); // 30 beans; the reward costs 20
    const tries = await Promise.all(
      Array.from({ length: 3 }, () => s.call('POST', '/v1/staff/redeem/reward', { token: m.staff, body: { memberId: m.memberId, rewardId: 'rwd_1' } })),
    );
    assert.deepEqual(tries.map((t) => t.status).sort(), [200, 409, 409]);
    const me = await s.call('GET', '/v1/me', { token: m.token });
    assert.equal(me.data.beans, 10);
  });

  test('the same phone signing up twice at once makes one member', async () => {
    const phone = '95550003';
    const r1 = await s.call('POST', '/v1/auth/otp/request', { body: { phone } });
    const [a, b] = await Promise.all([
      s.call('POST', '/v1/auth/otp/verify', { body: { phone, code: r1.data.devCode } }),
      s.call('POST', '/v1/auth/otp/verify', { body: { phone, code: r1.data.devCode } }),
    ]);
    const ok = [a, b].filter((r) => r.status === 200);
    assert.equal(ok.length, 1, JSON.stringify([a.data, b.data]));
    assert.equal([a, b].find((r) => r.status !== 200)!.status, 401, 'the loser sees the code as used, not a server error');
    const n = await s.db.one('SELECT COUNT(*) AS n FROM members WHERE phone = $1', ['+85295550003']);
    assert.equal(n!.n, 1);
  });

  test('wrong OTP attempts are still counted, even though the request fails', async () => {
    const phone = '95550004';
    const r1 = await s.call('POST', '/v1/auth/otp/request', { body: { phone } });
    const wrong = r1.data.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/v1/auth/otp/verify', { body: { phone, code: wrong } })).data.error, 'wrong_code');
    const right = await s.call('POST', '/v1/auth/otp/verify', { body: { phone, code: r1.data.devCode } });
    assert.equal(right.data.error, 'code_expired', 'after 5 wrong tries the code is dead');
  });

  test('an SMS is sent only for a code that was saved', async () => {
    const before = s.sms.sent.length;
    await s.call('POST', '/v1/auth/otp/request', { body: { phone: '95550005' } });
    assert.equal(s.sms.sent.length, before + 1);
    assert.equal((await s.db.one('SELECT COUNT(*) AS n FROM otp_codes WHERE phone = $1', ['+85295550005']))!.n, 1);
  });

  test('a failed all-or-nothing request leaves nothing behind: linking a taken cup does not burn its SUN counter', async () => {
    const owner = await s.signUp('95550006', 'Owner');
    // Cup 424 belongs to someone else, with an older counter.
    await s.db.run('UPDATE cups SET member_id = $1, sun_counter = 10 WHERE id = $2', [owner.memberId, 'cup_424']);
    const other = await s.signUp('95550007', 'Other');
    const { NXP_SUN } = await import('./helpers.ts');
    const r = await s.call('POST', '/v1/me/cups', { token: other.token, body: NXP_SUN });
    assert.equal(r.data.error, 'cup_taken');
    const cup = await s.db.one('SELECT sun_counter FROM cups WHERE id = $1', ['cup_424']);
    assert.equal(cup!.sun_counter, 10, 'counter rolled back with the failed link');
    await s.db.run('UPDATE cups SET member_id = NULL, sun_counter = -1 WHERE id = $1', ['cup_424']);
  });

  test('busy network: 20 cafés reading and confirming cups at the same moment all succeed', async () => {
    const N = 20;
    const cafes: { uid: string; staff: string; headers: Record<string, string> }[] = [];
    for (let i = 0; i < N; i++) {
      const c = `cafe_busy${i}`;
      await s.db.run('INSERT INTO cafes (id, name) VALUES ($1, $1)', [c]);
      await s.db.run("INSERT INTO staff (id, cafe_id, name, pin_hash) VALUES ($1, $2, 'B', $3)", [`stf_busy${i}`, c, hashPin('1234')]);
      await s.db.run('INSERT INTO stands (id, cafe_id, key_hash) VALUES ($1, $2, $3)', [`std_busy${i}`, c, sha256(`k${i}`)]);
      const m = await s.signUp(`9666${String(i).padStart(4, '0')}`, `M${i}`);
      const uid = `04BB${String(i).padStart(10, '0')}`;
      await s.db.run("INSERT INTO cups (id, uid, tag_type, created_at, member_id) VALUES ($1, $2, 'ntag213', 0, $3)", [`cup_busy${i}`, uid, m.memberId]);
      cafes.push({ uid, staff: await s.staffToken(c, `stf_busy${i}`), headers: { 'x-stand-id': `std_busy${i}`, 'x-stand-key': `k${i}` } });
    }
    for (let round = 0; round < 3; round++) {
      const feeds = cafes.map((x) => s.call('GET', '/v1/staff/feed', { token: x.staff }));
      const reads = await Promise.all(
        cafes.map((x, i) => s.call('POST', '/v1/stand/events', { headers: x.headers, body: { events: [{ eventId: `busy-${round}-${i}`, readAt: Date.now(), uid: x.uid }] } })),
      );
      assert.deepEqual(reads.map((r) => r.status), Array(N).fill(200), JSON.stringify(reads.filter((r) => r.status !== 200).map((r) => r.data)));
      const confirms = await Promise.all(
        reads.map((r, i) => s.call('POST', `/v1/staff/events/${r.data.results[0].id}/confirm`, { token: cafes[i].staff })),
      );
      assert.deepEqual(confirms.map((r) => r.status), Array(N).fill(200), JSON.stringify(confirms.filter((r) => r.status !== 200).map((r) => r.data)));
      assert.ok((await Promise.all(feeds)).every((f) => f.status === 200), 'feed polls alongside all succeed');
    }
  });

  test('a stand read with a fractional time is answered invalid, and the rest of its batch is saved', async () => {
    const r = await s.call('POST', '/v1/stand/events', {
      headers: s.standHeaders,
      body: { events: [{ eventId: 'frac-ok', readAt: Date.now() - 1000, uid: '04A1B2C3D4E5F6' }, { eventId: 'frac-bad', readAt: Date.now() + 0.5, uid: '04A1B2C3D4E5F6' }] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const by = Object.fromEntries(r.data.results.map((x: any) => [x.eventId, x.status]));
    assert.equal(by['frac-bad'], 'invalid');
    assert.notEqual(by['frac-ok'], 'invalid');
    assert.equal((await s.db.one("SELECT COUNT(*) AS n FROM stand_events WHERE client_event_id = 'frac-ok'"))!.n, 1);
  });

  test('a POS order with a fractional created_at is stored, not a server error', async () => {
    const { createHmac } = await import('node:crypto');
    const raw = JSON.stringify({ orders: [{ id: 'frac-1', location_id: 'loc-a', created_at: Date.now() + 0.7, total: 38, items: [{ name: 'Latte', qty: 1, price: 38 }] }] });
    const sig = 'sha256=' + createHmac('sha256', s.cfg.posSecrets.generic).update(raw).digest('hex');
    const r = await s.call('POST', '/v1/pos/generic/webhook', { raw, headers: { 'x-cuppee-signature': sig } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(Number.isInteger((await s.db.one("SELECT ordered_at FROM pos_orders WHERE external_id = 'frac-1'"))!.ordered_at));
  });

  test('times, counts and money come back as numbers, as they did on SQLite', async () => {
    const m = await memberWithVisits('95550008', 1);
    const me = await s.call('GET', '/v1/me', { token: m.token });
    assert.equal(typeof me.data.member.createdAt, 'number');
    assert.equal(typeof me.data.beans, 'number');
    assert.equal(typeof me.data.recentVisits[0].at, 'number');
    const card = me.data.stampCards.find((c: any) => c.cafeId === 'cafe_a');
    assert.equal(typeof card.stamps, 'number');
    assert.equal(typeof card.lastVisit, 'number');
    // Cafés never visited sort after visited ones (SQLite: ORDER BY lastVisit IS NULL).
    assert.equal(me.data.stampCards[0].cafeId, 'cafe_a');
    assert.equal(me.data.stampCards[1].lastVisit, null);

    await s.db.run("INSERT INTO cafe_menu (id, cafe_id, name, price_hkd) VALUES ('menu_t', 'cafe_b', 'Flat white', 42.5)");
    const cafes = await s.call('GET', '/v1/cafes');
    const b = cafes.data.find((c: any) => c.id === 'cafe_b');
    assert.deepEqual(b.menu, [{ name: 'Flat white', priceHkd: 42.5 }]);
    assert.equal(b.locationConfirmed, false);
  });
});

describe('tx()', () => {
  let t: Awaited<ReturnType<typeof freshTestDb>>;
  before(async () => {
    t = await freshTestDb();
    await t.db.run("INSERT INTO members (id, phone, created_at) VALUES ('mem_tx', '+85290000001', 0)");
  });
  after(() => t.drop());

  const name = async () => (await t.db.one('SELECT display_name FROM members WHERE id = $1', ['mem_tx']))!.display_name;
  const setName = (n: string) => t.db.run('UPDATE members SET display_name = $1 WHERE id = $2', [n, 'mem_tx']);

  test('rolls back on an error, and commits on an error it was told to keep', async () => {
    let sent = 0;
    await assert.rejects(tx(t.db, async () => (await setName('lost'), t.db.afterCommit(() => sent++), Promise.reject(new Error('boom')))), /boom/);
    assert.equal(await name(), null);
    assert.equal(sent, 0, 'after-commit work (such as an SMS) is dropped when the transaction rolls back');
    await assert.rejects(
      tx(t.db, async () => (await setName('kept'), Promise.reject(new HttpError(409, 'x'))), { commitOn: (e) => e instanceof HttpError }),
    );
    assert.equal(await name(), 'kept');
  });

  test('a dropped idle connection does not stop the server, and the next query works', async () => {
    const pid = (await t.db.one<{ pid: number }>('SELECT pg_backend_pid() AS pid'))!.pid; // now idle in the pool
    const admin = new pg.Client({ connectionString: testDatabaseUrl() });
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await admin.end();
    }
    await new Promise((r) => setTimeout(r, 100)); // let the pool see the drop
    assert.equal((await t.db.one('SELECT 1 AS ok'))!.ok, 1);
  });

  test('retries back off exponentially with jitter, capped', () => {
    assert.equal(backoffMs(1, () => 1), 10);
    assert.equal(backoffMs(4, () => 1), 80);
    assert.equal(backoffMs(20, () => 1), 500);
    assert.equal(backoffMs(20, () => 0), 0);
  });

  test('after-commit work queued by a nested tx() that is undone never runs', async () => {
    let sent = 0;
    await tx(t.db, async () => {
      await assert.rejects(tx(t.db, async () => (t.db.afterCommit(() => sent++), Promise.reject(new Error('undo')))));
    });
    assert.equal(sent, 0);
  });

  test('a nested tx() that fails undoes only its own writes', async () => {
    await tx(t.db, async () => {
      await setName('outer');
      await assert.rejects(tx(t.db, async () => (await setName('inner'), Promise.reject(new Error('inner failed')))));
      assert.equal(await name(), 'outer');
    });
    assert.equal(await name(), 'outer');
  });

  test('a transaction that loses a serialization race is retried, and after-commit work runs once', async () => {
    await setName('n0');
    let attempts = 0;
    let sent = 0;
    // Two transactions read the name and then write it: one must be retried.
    const bump = () =>
      tx(t.db, async () => {
        attempts++;
        const cur = await name();
        await new Promise((r) => setTimeout(r, 30));
        await setName(cur + '+');
        t.db.afterCommit(() => sent++);
      });
    await Promise.all([bump(), bump()]);
    assert.equal(await name(), 'n0++', 'both updates applied, one after the other');
    assert.ok(attempts >= 3, `one transaction was retried (attempts: ${attempts})`);
    assert.equal(sent, 2, 'after-commit work ran once per committed transaction');
  });
});

test('the seed script loads into PostgreSQL and is safe to run twice', async () => {
  const t = await freshTestDb();
  try {
    const schema = (await t.db.one<{ s: string }>('SELECT current_schema() AS s'))!.s;
    const url = new URL(testDatabaseUrl());
    url.searchParams.set('options', `-c search_path=${schema}`);
    const run = () =>
      promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', 'seed/seed.ts'], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'development' },
      });
    const first = await run();
    assert.match(first.stdout, /Seeded \d+ cafés/);
    assert.match(first.stdout, /STAND_KEY=/, 'new stands print their key');
    const counts = async () => (await t.db.one('SELECT (SELECT COUNT(*) FROM cafes) AS cafes, (SELECT COUNT(*) FROM cups) AS cups, (SELECT COUNT(*) FROM stands) AS stands'))!;
    const once = await counts();
    assert.ok(once.cafes > 0 && once.cups > 0);
    const second = await run();
    assert.doesNotMatch(second.stdout, /STAND_KEY=/, 'existing stands keep their key');
    assert.deepEqual(await counts(), once);
  } finally {
    await t.drop();
  }
});
