// The member card QR is generated on the phone with no network, using a pure-TS HMAC. The server
// verifies it with Node's crypto. If these drift apart, members get "invalid card" at the counter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { base64url, hmacSha256, sha256, utf8 } from '../src/lib/hmac';
import { cardCode, msUntilNext } from '../src/lib/card';
import { CARD_WINDOW_MS, cardCode as serverCardCode, cardKeyFor } from '../../server/src/services/card.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('sha256 matches Node for empty, short, block-boundary and multi-block inputs', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
    const data = new Uint8Array(len).map((_, i) => (i * 31 + 7) & 0xff);
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'), `length ${len}`);
  }
});

test('hmacSha256 + base64url match Node, including keys longer than one block', () => {
  for (const key of ['k', 'dev-card-secret', 'x'.repeat(64), 'y'.repeat(100)]) {
    const msg = 'mem_abc123.59860000';
    assert.equal(base64url(hmacSha256(utf8(key), utf8(msg))), createHmac('sha256', key).update(msg).digest('base64url'));
  }
});

test('app card code equals the server card code for the same member, key and time', () => {
  const memberId = 'mem_test01';
  const key = cardKeyFor('dev-card-secret', memberId);
  const at = Date.UTC(2026, 10, 28, 1, 0, 0);
  assert.equal(cardCode(key, memberId, CARD_WINDOW_MS, at), serverCardCode(key, memberId, at));
});

test('card code changes at the 30 s window edge and msUntilNext counts down to it', () => {
  const key = 'k';
  const start = 30_000 * 1000;
  assert.equal(cardCode(key, 'mem_x', 30_000, start), cardCode(key, 'mem_x', 30_000, start + 29_999));
  assert.notEqual(cardCode(key, 'mem_x', 30_000, start), cardCode(key, 'mem_x', 30_000, start + 30_000));
  assert.equal(msUntilNext(30_000, start + 1), 29_999);
});
