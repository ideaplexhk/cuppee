// Load cafés, staff, stands, rewards and demo cups from seed-data.json. Safe to re-run (upserts).
// Applies pending migrations first. Prints each stand's key once: put it in that stand bridge's .env.

import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { openDb, tx } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { hashPin, now, sha256, token, id } from '../src/lib/util.ts';
import * as cat from '../src/data/catalogue.ts';

const data = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'));
const cfg = loadConfig();
const db = openDb(cfg.databaseUrl);

try {
  const client = await db.pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  const standKeys: string[] = [];
  await tx(db, async () => {
    standKeys.length = 0; // a retried transaction starts over
    for (const c of data.cafes) {
      await cat.upsertCafe(db, c, c.lat != null && c.lng != null ? 1 : 0);
      for (const s of c.staff ?? []) await cat.upsertStaff(db, s.id, c.id, s.name, hashPin(String(s.pin)), s.role ?? 'barista');
      for (const st of c.stands ?? []) {
        if (!(await cat.standExists(db, st.id))) {
          const key = token();
          await cat.insertStand(db, st.id, c.id, st.label, sha256(key));
          standKeys.push(`stand ${st.id} (${c.name}) → STAND_ID=${st.id} STAND_KEY=${key}`);
        }
      }
      await cat.replaceMenu(
        db,
        c.id,
        (c.menu ?? []).map((m: any) => ({ id: id('menu'), name: m.name, priceHkd: m.price_hkd ?? null, posItemRef: m.pos_item_ref ?? null })),
      );
    }
    for (const r of data.rewards) await cat.upsertReward(db, r);
    if (cfg.devMode) {
      for (const cup of data.demo_cups) await cat.insertCupIfNew(db, id('cup'), cup.uid, cup.tag_type, cup.qr_code, cup.colourway, now());
    }
  });
  for (const line of standKeys) console.log(line);
  console.log(`Seeded ${data.cafes.length} cafés, ${data.rewards.length} rewards${cfg.devMode ? `, ${data.demo_cups.length} demo cups` : ''}.`);
} finally {
  await db.close();
}
