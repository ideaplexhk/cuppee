// NTAG 424 DNA "Secure Unique NFC" (SUN) message verification.
// Reference: NXP AN12196 "NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints".
//
// The cup's NDEF URL is configured with SDM mirroring, e.g.
//   https://tap.cuppee.hk/c?picc_data=<32 hex>&cmac=<16 hex>
// picc_data = AES-128-CBC(K_SDMMetaRead, IV=0) of [0xC7 | UID(7) | SDMReadCtr(3, LE) | random padding]
// cmac      = truncated CMAC over an empty message, keyed with a session key derived from
//             K_SDMFileRead, UID and counter.
// The counter must strictly increase between accepted taps: that is what rejects replayed / cloned URLs.

import { createCipheriv, createDecipheriv } from 'node:crypto';

const BLOCK = 16;

function aesEcbEncrypt(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function shiftLeft1(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length);
  let carry = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    out[i] = ((b[i] << 1) | carry) & 0xff;
    carry = (b[i] & 0x80) ? 1 : 0;
  }
  return out;
}

function subkeys(key: Buffer): [Buffer, Buffer] {
  const l = aesEcbEncrypt(key, Buffer.alloc(BLOCK));
  const k1 = shiftLeft1(l);
  if (l[0] & 0x80) k1[BLOCK - 1] ^= 0x87;
  const k2 = shiftLeft1(k1);
  if (k1[0] & 0x80) k2[BLOCK - 1] ^= 0x87;
  return [k1, k2];
}

/** AES-CMAC (RFC 4493). */
export function aesCmac(key: Buffer, msg: Buffer): Buffer {
  const [k1, k2] = subkeys(key);
  const n = Math.max(1, Math.ceil(msg.length / BLOCK));
  const complete = msg.length > 0 && msg.length % BLOCK === 0;
  let last: Buffer;
  if (complete) {
    last = Buffer.from(msg.subarray((n - 1) * BLOCK));
    for (let i = 0; i < BLOCK; i++) last[i] ^= k1[i];
  } else {
    last = Buffer.alloc(BLOCK);
    msg.copy(last, 0, (n - 1) * BLOCK);
    last[msg.length - (n - 1) * BLOCK] = 0x80;
    for (let i = 0; i < BLOCK; i++) last[i] ^= k2[i];
  }
  let x: Buffer = Buffer.alloc(BLOCK);
  for (let i = 0; i < n - 1; i++) {
    const blk = msg.subarray(i * BLOCK, (i + 1) * BLOCK);
    const y = Buffer.alloc(BLOCK);
    for (let j = 0; j < BLOCK; j++) y[j] = x[j] ^ blk[j];
    x = aesEcbEncrypt(key, y);
  }
  const y = Buffer.alloc(BLOCK);
  for (let j = 0; j < BLOCK; j++) y[j] = x[j] ^ last[j];
  return aesEcbEncrypt(key, y);
}

export type SunResult =
  | { ok: true; uid: string; counter: number }
  | { ok: false; reason: 'bad_format' | 'bad_picc_tag' | 'bad_cmac' };

const HEX = /^[0-9a-fA-F]+$/;

export function verifySun(
  piccDataHex: string,
  cmacHex: string,
  kMetaRead: Buffer,
  kFileRead: Buffer,
): SunResult {
  if (!HEX.test(piccDataHex) || piccDataHex.length !== 32 || !HEX.test(cmacHex) || cmacHex.length !== 16) {
    return { ok: false, reason: 'bad_format' };
  }
  const d = createDecipheriv('aes-128-cbc', kMetaRead, Buffer.alloc(BLOCK));
  d.setAutoPadding(false);
  const plain = Buffer.concat([d.update(Buffer.from(piccDataHex, 'hex')), d.final()]);
  // 0xC7 = UID mirrored (bit7) + counter mirrored (bit6) + UID length 7.
  if (plain[0] !== 0xc7) return { ok: false, reason: 'bad_picc_tag' };
  const uid = plain.subarray(1, 8);
  const ctrLE = plain.subarray(8, 11);
  const counter = ctrLE[0] | (ctrLE[1] << 8) | (ctrLE[2] << 16);

  // SV2 = 3C C3 00 01 00 80 || UID || SDMReadCtr  (AN12196 §3.4.4)
  const sv2 = Buffer.concat([Buffer.from('3cc300010080', 'hex'), uid, ctrLE]);
  const sessionKey = aesCmac(kFileRead, sv2);
  const full = aesCmac(sessionKey, Buffer.alloc(0));
  const trunc = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) trunc[i] = full[i * 2 + 1];

  const given = Buffer.from(cmacHex, 'hex');
  if (!timingSafeEq(trunc, given)) return { ok: false, reason: 'bad_cmac' };
  return { ok: true, uid: uid.toString('hex').toUpperCase(), counter };
}

function timingSafeEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/** Pull picc_data / cmac out of a tapped SUN URL (also accepts the bare query string). */
export function parseSunUrl(url: string): { picc: string; cmac: string } | null {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url;
  const p = new URLSearchParams(q);
  const picc = p.get('picc_data') ?? p.get('e');
  const cmac = p.get('cmac') ?? p.get('m');
  return picc && cmac ? { picc, cmac } : null;
}
