import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventQueue, flush } from '../src/queue.ts';
import { ndefUri, readSunUrl, sunParams } from '../src/tag.ts';

const URL_BODY = 'tap.cuppee.hk/c?picc_data=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086';

function ndefMessage(uri: string): Buffer {
  const payload = Buffer.concat([Buffer.from([0x04]), Buffer.from(uri)]); // 0x04 = https://
  return Buffer.concat([Buffer.from([0xd1, 0x01, payload.length]), Buffer.from('U'), payload]);
}

test('decodes an SDM NDEF URI record', () => {
  assert.equal(ndefUri(ndefMessage(URL_BODY)), 'https://' + URL_BODY);
  assert.deepEqual(sunParams('https://' + URL_BODY), { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' });
});

test('reads the NDEF file from a Type 4 tag via APDUs', async () => {
  const msg = ndefMessage(URL_BODY);
  const file = Buffer.concat([Buffer.from([msg.length >> 8, msg.length & 0xff]), msg]);
  const OK = Buffer.from([0x90, 0x00]);
  const seen: string[] = [];
  const transmit = async (apdu: Buffer) => {
    seen.push(apdu.subarray(0, 2).toString('hex'));
    if (apdu[1] === 0xa4) return OK;
    const off = (apdu[2] << 8) | apdu[3];
    return Buffer.concat([file.subarray(off, off + apdu[4]), OK]);
  };
  assert.equal(await readSunUrl(transmit), 'https://' + URL_BODY);
  assert.deepEqual(seen, ['00a4', '00a4', '00b0', '00b0']);
  // A Type 2 tag refuses the SELECT → null, bridge falls back to UID.
  assert.equal(await readSunUrl(async () => Buffer.from([0x6a, 0x82])), null);
});

test('queue persists, caps at 100 and only drops acknowledged events', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cq-')), 'q.json');
  const q = new EventQueue(path);
  for (let i = 0; i < 105; i++) q.push({ readAt: i, uid: '04AA' });
  assert.equal(q.size, 100);
  assert.equal(q.peek(1)[0].readAt, 5); // oldest five dropped
  assert.equal(new EventQueue(path).size, 100); // survives restart

  await assert.rejects(flush(q, async () => { throw new Error('offline'); }));
  assert.equal(q.size, 100);
  await flush(q, async (evs) => evs.slice(0, 40).map((e) => ({ eventId: e.eventId, status: 'pending' })));
  assert.equal(q.size, 60);
});
