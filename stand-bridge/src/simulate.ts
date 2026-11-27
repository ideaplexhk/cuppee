// No reader handy? Pretend a cup landed on the stand.
//   npm run simulate -- 04A1B2C3D4E5F6            (NTAG 213 demo cup UID)
//   npm run simulate -- "https://tap.cuppee.hk/c?picc_data=…&cmac=…"
import { randomUUID } from 'node:crypto';
import { sunParams } from './tag.ts';

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const arg = process.argv[2];
if (!arg || !process.env.STAND_ID || !process.env.STAND_KEY) {
  console.error('Usage: STAND_ID=… STAND_KEY=… npm run simulate -- <uid | SUN url>');
  process.exit(1);
}
const sun = arg.includes('picc_data') || arg.includes('?e=') ? sunParams(arg) : null;
const event = { eventId: randomUUID(), readAt: Date.now(), ...(sun ?? { uid: arg }) };
const res = await fetch(`${API_URL}/v1/stand/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-stand-id': process.env.STAND_ID, 'x-stand-key': process.env.STAND_KEY },
  body: JSON.stringify({ events: [event] }),
});
console.log(res.status, JSON.stringify(await res.json()));
