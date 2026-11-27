// Reading the cup tag over PC/SC (ACR122U / ACR1252U / ACR1255U).
// NTAG 424 DNA (ISO 14443-4, Type 4): select the NDEF application, select the NDEF file, read it,
// then pull picc_data / cmac out of the URL. NTAG 213 (Type 2) in Phase 0: the UID is enough.

export type Transmit = (apdu: Buffer, responseMax: number) => Promise<Buffer>;

const SELECT_NDEF_APP = Buffer.from('00A4040007D276000085010100', 'hex');
const SELECT_NDEF_FILE = Buffer.from('00A4000C02E104', 'hex');
const readBinary = (offset: number, len: number) => Buffer.from([0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, len]);

function ok(r: Buffer): Buffer {
  if (r.length < 2 || r[r.length - 2] !== 0x90 || r[r.length - 1] !== 0x00) throw new Error(`APDU failed: ${r.toString('hex')}`);
  return r.subarray(0, r.length - 2);
}

const URI_PREFIX = ['', 'http://www.', 'https://www.', 'http://', 'https://'];

/** Decode the first URI record of an NDEF message (short records only, which is what SDM uses). */
export function ndefUri(msg: Buffer): string | null {
  let i = 0;
  while (i < msg.length) {
    const hdr = msg[i];
    const sr = (hdr & 0x10) !== 0;
    const il = (hdr & 0x08) !== 0;
    const typeLen = msg[i + 1];
    let p = i + 2;
    let payloadLen: number;
    if (sr) payloadLen = msg[p++];
    else {
      payloadLen = msg.readUInt32BE(p);
      p += 4;
    }
    const idLen = il ? msg[p++] : 0;
    const type = msg.subarray(p, p + typeLen).toString('latin1');
    p += typeLen + idLen;
    const payload = msg.subarray(p, p + payloadLen);
    if ((hdr & 0x07) === 0x01 && type === 'U' && payload.length > 0) {
      return (URI_PREFIX[payload[0]] ?? '') + payload.subarray(1).toString('utf8');
    }
    i = p + payloadLen;
    if (hdr & 0x40) break; // ME (message end)
  }
  return null;
}

export async function readSunUrl(transmit: Transmit): Promise<string | null> {
  try {
    ok(await transmit(SELECT_NDEF_APP, 2));
  } catch {
    return null; // not a Type 4 tag (e.g. NTAG 213)
  }
  ok(await transmit(SELECT_NDEF_FILE, 2));
  const nlen = ok(await transmit(readBinary(0, 2), 4)).readUInt16BE(0);
  if (nlen === 0 || nlen > 250) return null;
  const msg = ok(await transmit(readBinary(2, nlen), nlen + 2));
  return ndefUri(msg);
}

export function sunParams(url: string): { picc: string; cmac: string } | null {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url;
  const p = new URLSearchParams(q);
  const picc = p.get('picc_data') ?? p.get('e');
  const cmac = p.get('cmac') ?? p.get('m');
  return picc && cmac ? { picc, cmac } : null;
}
