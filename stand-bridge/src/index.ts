// CUPPEE counter stand bridge. Runs on the laptop / mini PC / Raspberry Pi the ACR122U is plugged into.
// Every cup landing → one read event → posted to the API (queued on disk if the network is down).

import { NFC } from 'nfc-pcsc';
import { EventQueue, flush } from './queue.ts';
import { readSunUrl, sunParams } from './tag.ts';

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const STAND_ID = process.env.STAND_ID;
const STAND_KEY = process.env.STAND_KEY;
const QUEUE_FILE = process.env.QUEUE_FILE ?? './stand-queue.json';
// Local debounce: ignore the same chip for a few seconds so a wobble on the cradle isn't two reads.
// The server applies the real 30 s rule.
const LOCAL_DEBOUNCE_MS = Number(process.env.LOCAL_DEBOUNCE_MS ?? 3000);

if (!STAND_ID || !STAND_KEY) {
  console.error('Set STAND_ID and STAND_KEY (printed by `npm run seed` in server/).');
  process.exit(1);
}

const queue = new EventQueue(QUEUE_FILE);
const lastSeen = new Map<string, number>();

async function send(events: unknown[]) {
  const res = await fetch(`${API_URL}/v1/stand/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stand-id': STAND_ID!, 'x-stand-key': STAND_KEY! },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()).results as { eventId: string; status: string }[];
}

let flushing = false;
async function tryFlush() {
  if (flushing || queue.size === 0) return;
  flushing = true;
  try {
    const results = await flush(queue, send);
    for (const r of results) console.log(`  ↳ ${r.status}`);
  } catch (e) {
    console.warn(`offline, ${queue.size} read(s) queued: ${(e as Error).message}`);
  } finally {
    flushing = false;
  }
}
setInterval(tryFlush, 5000);

const nfc = new NFC();
nfc.on('reader', (reader: any) => {
  console.log(`reader ready: ${reader.reader.name}`);
  reader.autoProcessing = false; // we talk APDUs ourselves (needed for NTAG 424)

  reader.on('card', async (card: any) => {
    const readAt = Date.now();
    try {
      const transmit = (apdu: Buffer, max: number) => reader.transmit(apdu, max + 2);
      const url = await readSunUrl(transmit);
      const sun = url ? sunParams(url) : null;
      let uid: string | undefined;
      if (!sun) {
        // Type 2 tag: GET UID pseudo-APDU (FF CA 00 00 00).
        const r: Buffer = await reader.transmit(Buffer.from('FFCA000000', 'hex'), 12);
        uid = r.subarray(0, r.length - 2).toString('hex').toUpperCase();
      }
      const key = sun?.picc ? 'sun' : uid!;
      // SUN data changes on every read, so local debounce for 424 cups is by time only.
      const last = lastSeen.get(key) ?? 0;
      if (readAt - last < LOCAL_DEBOUNCE_MS) return;
      lastSeen.set(key, readAt);
      queue.push({ readAt, ...(sun ?? { uid }) });
      console.log(`${new Date(readAt).toLocaleTimeString()} cup ${sun ? '(NTAG 424 SUN)' : uid}`);
      tryFlush();
    } catch (e) {
      console.warn(`read failed: ${(e as Error).message}. Lift the cup and place it again.`);
    }
  });
  reader.on('error', (e: Error) => console.warn(`reader error: ${e.message}`));
  reader.on('end', () => console.log('reader removed'));
});
nfc.on('error', (e: Error) => console.error(`PC/SC error: ${e.message}`));

console.log(`CUPPEE stand ${STAND_ID} → ${API_URL} (queue: ${queue.size} pending)`);
tryFlush();
