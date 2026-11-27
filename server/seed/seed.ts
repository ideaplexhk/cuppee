// Load cafés, staff, stands, rewards and demo cups from seed-data.json. Safe to re-run (upserts).
// Prints each stand's key once: put it in that stand bridge's .env.

import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { openDb, tx } from '../src/db.ts';
import { hashPin, now, sha256, token, id } from '../src/lib/util.ts';

const data = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'));
const cfg = loadConfig();
const db = openDb(cfg.dbPath);

tx(db, () => {
  for (const c of data.cafes) {
    db.prepare(
      `INSERT INTO cafes (id, name, name_zh, district, address, lat, lng, location_confirmed, hours, description, stamp_goal, stamp_reward, beans_per_visit, beans_per_10hkd, pos_provider, pos_location_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_zh=excluded.name_zh, district=excluded.district, address=excluded.address,
         lat=excluded.lat, lng=excluded.lng, location_confirmed=excluded.location_confirmed, hours=excluded.hours, description=excluded.description,
         stamp_goal=excluded.stamp_goal, stamp_reward=excluded.stamp_reward, beans_per_visit=excluded.beans_per_visit,
         beans_per_10hkd=excluded.beans_per_10hkd, pos_provider=excluded.pos_provider, pos_location_ref=excluded.pos_location_ref`,
    ).run(
      c.id, c.name, c.name_zh ?? null, c.district, c.address, c.lat, c.lng, c.lat != null && c.lng != null ? 1 : 0, c.hours, c.description,
      c.stamp_goal, c.stamp_reward, c.beans_per_visit, c.beans_per_10hkd, c.pos_provider, c.pos_location_ref,
    );
    for (const s of c.staff ?? []) {
      db.prepare(
        `INSERT INTO staff (id, cafe_id, name, pin_hash, role) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, pin_hash=excluded.pin_hash, role=excluded.role`,
      ).run(s.id, c.id, s.name, hashPin(String(s.pin)), s.role ?? 'barista');
    }
    for (const st of c.stands ?? []) {
      const exists = db.prepare('SELECT 1 FROM stands WHERE id = ?').get(st.id);
      if (!exists) {
        const key = token();
        db.prepare('INSERT INTO stands (id, cafe_id, label, key_hash) VALUES (?, ?, ?, ?)').run(st.id, c.id, st.label, sha256(key));
        console.log(`stand ${st.id} (${c.name}) → STAND_ID=${st.id} STAND_KEY=${key}`);
      }
    }
    db.prepare('DELETE FROM cafe_menu WHERE cafe_id = ?').run(c.id);
    for (const m of c.menu ?? []) {
      db.prepare('INSERT INTO cafe_menu (id, cafe_id, name, price_hkd, pos_item_ref) VALUES (?, ?, ?, ?, ?)').run(id('menu'), c.id, m.name, m.price_hkd ?? null, m.pos_item_ref ?? null);
    }
  }
  for (const r of data.rewards) {
    db.prepare(
      `INSERT INTO rewards (id, title, description, cost_beans, cafe_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, cost_beans=excluded.cost_beans, cafe_id=excluded.cafe_id`,
    ).run(r.id, r.title, r.description, r.cost_beans, r.cafe_id);
  }
  if (cfg.devMode) {
    for (const cup of data.demo_cups) {
      db.prepare('INSERT OR IGNORE INTO cups (id, uid, tag_type, qr_code, colourway, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id('cup'), cup.uid, cup.tag_type, cup.qr_code, cup.colourway, now());
    }
  }
});
console.log(`Seeded ${data.cafes.length} cafés, ${data.rewards.length} rewards${cfg.devMode ? `, ${data.demo_cups.length} demo cups` : ''}.`);
