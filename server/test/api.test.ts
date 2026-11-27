import { test, after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { aesCmac, verifySun, parseSunUrl } from '../src/lib/sun.ts';
import { cardCode, cardKeyFor, verifyCardCode, CARD_WINDOW_MS } from '../src/services/card.ts';
import { startTestServer, NXP_SUN } from './helpers.ts';

describe('NTAG 424 SUN', () => {
  test('AES-CMAC matches RFC 4493', () => {
    const k = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
    assert.equal(aesCmac(k, Buffer.alloc(0)).toString('hex'), 'bb1d6929e95937287fa37d129b756746');
    assert.equal(aesCmac(k, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex')).toString('hex'), '070a16b46b4d4144f79bdd9dd04a287c');
    const m40 = Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411', 'hex');
    assert.equal(aesCmac(k, m40).toString('hex'), 'dfa66747de9ae63030ca32611497c827');
  });
  test('verifies the NXP AN12196 example', () => {
    const z = Buffer.alloc(16);
    assert.deepEqual(verifySun(NXP_SUN.picc, NXP_SUN.cmac, z, z), { ok: true, uid: '04DE5F1EACC040', counter: 61 });
    assert.equal(verifySun(NXP_SUN.picc, '94EED9EE65337087', z, z).ok, false);
    assert.equal(verifySun(NXP_SUN.picc, NXP_SUN.cmac, Buffer.alloc(16, 1), z).ok, false);
  });
  test('parses tap URLs', () => {
    assert.deepEqual(parseSunUrl(`https://tap.cuppee.hk/c?picc_data=${NXP_SUN.picc}&cmac=${NXP_SUN.cmac}`), NXP_SUN);
    assert.equal(parseSunUrl('https://tap.cuppee.hk/c'), null);
  });
});

describe('member card QR', () => {
  test('valid for current and previous window only', () => {
    const key = cardKeyFor('s', 'mem_x');
    const t = 1_800_000_000_000;
    const code = cardCode(key, 'mem_x', t);
    assert.equal(verifyCardCode('s', code, t), 'mem_x');
    assert.equal(verifyCardCode('s', code, t + CARD_WINDOW_MS), 'mem_x');
    assert.equal(verifyCardCode('s', code, t + 2 * CARD_WINDOW_MS), null);
    assert.equal(verifyCardCode('other', code, t), null);
    assert.equal(verifyCardCode('s', code.replace('mem_x', 'mem_y'), t), null);
  });
});

describe('API', () => {
  let s: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => (s = await startTestServer()));
  after(() => s.close());

  test('OTP sign-up, wrong code, me', async () => {
    const r1 = await s.call('POST', '/v1/auth/otp/request', { body: { phone: '9123 4567' } });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.phone, '+85291234567');
    const bad = await s.call('POST', '/v1/auth/otp/verify', { body: { phone: '91234567', code: r1.data.devCode === '000000' ? '111111' : '000000' } });
    assert.equal(bad.status, 401);
    const ok = await s.call('POST', '/v1/auth/otp/verify', { body: { phone: '91234567', code: r1.data.devCode, displayName: 'Ada' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.isNew, true);
    const me = await s.call('GET', '/v1/me', { token: ok.data.token });
    assert.equal(me.data.member.displayName, 'Ada');
    assert.equal(me.data.beans, 0);
    assert.equal((await s.call('GET', '/v1/me')).status, 401);
    assert.equal((await s.call('POST', '/v1/auth/otp/request', { body: { phone: '123' } })).status, 400);
  });

  test('link cups: UID for NTAG 213, SUN required for NTAG 424, replay rejected', async () => {
    const { token } = await s.signUp('92222222', 'Bo');
    const a = await s.call('POST', '/v1/me/cups', { token, body: { uid: '04:A1:B2:C3:D4:E5:F6', nickname: 'Daily' } });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(a.data.nickname, 'Daily');
    const uidOnly424 = await s.call('POST', '/v1/me/cups', { token, body: { uid: '04DE5F1EACC040' } });
    assert.equal(uidOnly424.data.error, 'sun_required');
    const sun = await s.call('POST', '/v1/me/cups', { token, body: { url: `https://tap.cuppee.hk/c?picc_data=${NXP_SUN.picc}&cmac=${NXP_SUN.cmac}` } });
    assert.equal(sun.status, 200, JSON.stringify(sun.data));
    const replay = await s.call('POST', '/v1/me/cups', { token, body: NXP_SUN });
    assert.equal(replay.data.error, 'replayed_tap');
    const cups = await s.call('GET', '/v1/me/cups', { token });
    assert.equal(cups.data.length, 2);
    const other = await s.signUp('93333333', 'Cy');
    const taken = await s.call('POST', '/v1/me/cups', { token: other.token, body: { qr: 'CUP-0001' } });
    assert.equal(taken.status, 409);
  });

  test('stand flow: debounce, idempotent replay, confirm, cooldown, stamp card', async () => {
    const { token, memberId } = await s.signUp('94444444', 'Di');
    // Free the NTAG 213 cup from the previous test and give it to Di.
    s.db.prepare("UPDATE cups SET member_id = NULL WHERE id = 'cup_213'").run();
    assert.equal((await s.call('POST', '/v1/me/cups', { token, body: { qr: 'CUP-0001' } })).status, 200);
    const st = await s.staffToken();

    const t0 = Date.now() - 60_000;
    const batch = await s.call('POST', '/v1/stand/events', {
      headers: s.standHeaders,
      body: {
        events: [
          { eventId: 'e1', readAt: t0, uid: '04A1B2C3D4E5F6' },
          { eventId: 'e2', readAt: t0 + 5_000, uid: '04A1B2C3D4E5F6' },  // re-placed → duplicate
          { eventId: 'e3', readAt: t0 + 6_000, uid: '0499999999999999' }, // unknown cup
        ],
      },
    });
    assert.equal(batch.status, 200, JSON.stringify(batch.data));
    assert.deepEqual(batch.data.results.map((r: any) => r.status), ['pending', 'duplicate', 'unknown_cup']);
    // Offline queue resends the same events: nothing new is created.
    const again = await s.call('POST', '/v1/stand/events', { headers: s.standHeaders, body: { events: [{ eventId: 'e1', readAt: t0, uid: '04A1B2C3D4E5F6' }] } });
    assert.equal(again.data.results[0].id, batch.data.results[0].id);
    assert.equal((await s.call('POST', '/v1/stand/events', { headers: { 'x-stand-id': 'std_a', 'x-stand-key': 'nope' }, body: { events: [] } })).status, 401);

    const feed = await s.call('GET', '/v1/staff/feed', { token: st });
    const pending = feed.data.events.find((e: any) => e.status === 'pending');
    assert.equal(pending.member.name, 'Di');
    assert.equal(feed.data.events.some((e: any) => e.status === 'unknown_cup'), true);

    const conf = await s.call('POST', `/v1/staff/events/${pending.id}/confirm`, { token: st });
    assert.equal(conf.status, 200);
    assert.deepEqual(conf.data.awarded, { stamps: 1, beans: 10 });
    assert.equal((await s.call('POST', `/v1/staff/events/${pending.id}/confirm`, { token: st })).status, 409);

    // Another café's staff can't touch this event.
    const stB = await s.staffToken('cafe_b', 'stf_b');
    assert.equal((await s.call('POST', `/v1/staff/events/${pending.id}/confirm`, { token: stB })).status, 404);

    // Second visit inside cooldown: recorded, no points.
    const ev2 = await s.call('POST', '/v1/stand/events', { headers: s.standHeaders, body: { events: [{ eventId: 'e4', readAt: Date.now(), uid: '04A1B2C3D4E5F6' }] } });
    const c2 = await s.call('POST', `/v1/staff/events/${ev2.data.results[0].id}/confirm`, { token: st });
    assert.equal(c2.data.cooldown, true);
    assert.deepEqual(c2.data.awarded, { stamps: 0, beans: 0 });

    // Fill the stamp card (goal 3 at Café A) by backdating visits past the cooldown.
    s.db.prepare('UPDATE visits SET created_at = created_at - 3600000 WHERE member_id = ?').run(memberId);
    const key = (await s.call('GET', '/v1/me/card', { token })).data.cardKey;
    const { cardCode } = await import('../src/services/card.ts');
    const v3 = await s.call('POST', '/v1/staff/visits', { token: st, body: { code: cardCode(key, memberId) } });
    assert.equal(v3.data.balances.stamps, 2);
    s.db.prepare('UPDATE visits SET created_at = created_at - 3600000 WHERE member_id = ?').run(memberId);
    const v4 = await s.call('POST', '/v1/staff/visits', { token: st, body: { code: cardCode(key, memberId) } });
    assert.equal(v4.data.balances.stampCardReady, true);

    const red = await s.call('POST', '/v1/staff/redeem/stamp-card', { token: st, body: { memberId } });
    assert.equal(red.status, 200);
    assert.equal(red.data.stampsLeft, 0);
    assert.equal((await s.call('POST', '/v1/staff/redeem/stamp-card', { token: st, body: { memberId } })).status, 409);

    // 30 beans so far → 20-bean reward works once.
    const rr = await s.call('POST', '/v1/staff/redeem/reward', { token: st, body: { memberId, rewardId: 'rwd_1' } });
    assert.equal(rr.data.beansLeft, 10);
    assert.equal((await s.call('POST', '/v1/staff/redeem/reward', { token: st, body: { memberId, rewardId: 'rwd_1' } })).data.error, 'not_enough_beans');

    const me = await s.call('GET', '/v1/me', { token });
    assert.equal(me.data.beans, 10);
    assert.equal(me.data.recentVisits.length, 4);
  });

  test('POS webhook: signature, visit-window match, member_ref, duplicate, refund', async () => {
    const { token, memberId } = await s.signUp('95555555', 'Ed');
    const st = await s.staffToken();
    const key = (await s.call('GET', '/v1/me/card', { token })).data.cardKey;
    const { cardCode } = await import('../src/services/card.ts');
    // Clear other members' recent visits so Ed's is the only candidate in the window.
    s.db.prepare('UPDATE visits SET created_at = created_at - 86400000 WHERE member_id != ?').run(memberId);
    await s.call('POST', '/v1/staff/visits', { token: st, body: { code: cardCode(key, memberId) } });

    const sign = (raw: string) => ({ 'x-cuppee-signature': 'sha256=' + createHmac('sha256', s.cfg.posSecrets.generic).update(raw).digest('hex') });
    const order = (oid: string, extra: object = {}) =>
      JSON.stringify({ orders: [{ id: oid, location_id: 'loc-a', created_at: new Date().toISOString(), total: 46, items: [{ name: 'Oat flat white', qty: 1, price: 46, modifiers: ['Oat milk'] }], ...extra }] });

    const raw1 = order('pos-1');
    assert.equal((await s.call('POST', '/v1/pos/generic/webhook', { raw: raw1, headers: { 'x-cuppee-signature': 'sha256=00' } })).status, 401);
    const w1 = await s.call('POST', '/v1/pos/generic/webhook', { raw: raw1, headers: sign(raw1) });
    assert.equal(w1.status, 200, JSON.stringify(w1.data));
    assert.equal(w1.data.results[0].status, 'matched');
    assert.equal(w1.data.results[0].matchMethod, 'visit_window');
    assert.equal(w1.data.results[0].beansAwarded, 4);

    const dup = await s.call('POST', '/v1/pos/generic/webhook', { raw: raw1, headers: sign(raw1) });
    assert.equal(dup.data.results[0].status, 'duplicate');

    // Second order, no free visit in window, but POS scanned the member card.
    const raw2 = order('pos-2', { member_ref: cardCode(key, memberId), total: 100 });
    const w2 = await s.call('POST', '/v1/pos/generic/webhook', { raw: raw2, headers: sign(raw2) });
    assert.equal(w2.data.results[0].matchMethod, 'member_ref');
    assert.equal(w2.data.results[0].beansAwarded, 10);

    const before = (await s.call('GET', '/v1/me', { token })).data;
    assert.equal(before.member.preferences.lastOrder.name, 'Oat flat white');
    const raw3 = order('pos-2', { status: 'refunded' });
    const w3 = await s.call('POST', '/v1/pos/generic/webhook', { raw: raw3, headers: sign(raw3) });
    assert.equal(w3.data.results[0].status, 'reversed');
    const afterRefund = (await s.call('GET', '/v1/me', { token })).data;
    assert.equal(afterRefund.beans, before.beans - 10);

    const raw4 = JSON.stringify({ orders: [{ id: 'x', location_id: 'nowhere', created_at: Date.now(), total: 1 }] });
    assert.equal((await s.call('POST', '/v1/pos/generic/webhook', { raw: raw4, headers: sign(raw4) })).data.results[0].status, 'unknown_location');

    const counter = await s.call('GET', '/v1/pos/generic/counter?location=loc-a', { headers: { 'x-cuppee-key': s.cfg.posSecrets.generic } });
    assert.equal(counter.status, 200);
    assert.equal((await s.call('GET', '/v1/pos/generic/counter?location=loc-a', { headers: { 'x-cuppee-key': 'bad' } })).status, 401);
  });

  test('ambiguous POS order is left unmatched', async () => {
    const st = await s.staffToken();
    const { cardCode } = await import('../src/services/card.ts');
    s.db.prepare('UPDATE visits SET created_at = created_at - 86400000').run();
    for (const [phone, name] of [['96666666', 'Fi'], ['97777777', 'Gu']]) {
      const m = await s.signUp(phone, name);
      const key = (await s.call('GET', '/v1/me/card', { token: m.token })).data.cardKey;
      await s.call('POST', '/v1/staff/visits', { token: st, body: { code: cardCode(key, m.memberId) } });
    }
    const raw = JSON.stringify({ orders: [{ id: 'pos-amb', location_id: 'loc-a', created_at: Date.now(), total: 40 }] });
    const sig = 'sha256=' + createHmac('sha256', s.cfg.posSecrets.generic).update(raw).digest('hex');
    const r = await s.call('POST', '/v1/pos/generic/webhook', { raw, headers: { 'x-cuppee-signature': sig } });
    assert.equal(r.data.results[0].status, 'unmatched');
  });

  test('catalogue endpoints', async () => {
    const cafes = await s.call('GET', '/v1/cafes');
    assert.equal(cafes.data.length, 2);
    const rewards = await s.call('GET', '/v1/rewards');
    assert.equal(rewards.data[0].id, 'rwd_1');
    assert.equal((await s.call('GET', '/v1/nope')).status, 404);
    assert.equal((await s.call('DELETE', '/v1/cafes')).status, 405);
  });
});
