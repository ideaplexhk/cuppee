// Data access for setting up the catalogue: cafés, staff, stands, menus, rewards and demo cups.
// Used by the seed script and, later, the back office. Every SQL statement for this area lives here (backlog M1).
import type { DB } from '../db.ts';

export async function upsertCafe(db: DB, c: any, locationConfirmed: number) {
  await db.run(
    `INSERT INTO cafes (id, name, name_zh, district, address, lat, lng, location_confirmed, hours, description, stamp_goal, stamp_reward, beans_per_visit, beans_per_10hkd, pos_provider, pos_location_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET name=excluded.name, name_zh=excluded.name_zh, district=excluded.district, address=excluded.address,
       lat=excluded.lat, lng=excluded.lng, location_confirmed=excluded.location_confirmed, hours=excluded.hours, description=excluded.description,
       stamp_goal=excluded.stamp_goal, stamp_reward=excluded.stamp_reward, beans_per_visit=excluded.beans_per_visit,
       beans_per_10hkd=excluded.beans_per_10hkd, pos_provider=excluded.pos_provider, pos_location_ref=excluded.pos_location_ref`,
    [
      c.id, c.name, c.name_zh ?? null, c.district, c.address, c.lat, c.lng, locationConfirmed, c.hours, c.description,
      c.stamp_goal, c.stamp_reward, c.beans_per_visit, c.beans_per_10hkd, c.pos_provider, c.pos_location_ref,
    ],
  );
}

export async function upsertStaff(db: DB, staffId: string, cafeId: string, name: string, pinHash: string, role: string) {
  await db.run(
    `INSERT INTO staff (id, cafe_id, name, pin_hash, role) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name=excluded.name, pin_hash=excluded.pin_hash, role=excluded.role`,
    [staffId, cafeId, name, pinHash, role],
  );
}

export async function standExists(db: DB, standId: string): Promise<boolean> {
  return !!(await db.one('SELECT 1 FROM stands WHERE id = $1', [standId]));
}

export async function insertStand(db: DB, standId: string, cafeId: string, label: string, keyHash: string) {
  await db.run('INSERT INTO stands (id, cafe_id, label, key_hash) VALUES ($1, $2, $3, $4)', [standId, cafeId, label, keyHash]);
}

export async function replaceMenu(db: DB, cafeId: string, items: { id: string; name: string; priceHkd: number | null; posItemRef: string | null }[]) {
  await db.run('DELETE FROM cafe_menu WHERE cafe_id = $1', [cafeId]);
  for (const m of items) {
    await db.run('INSERT INTO cafe_menu (id, cafe_id, name, price_hkd, pos_item_ref) VALUES ($1, $2, $3, $4, $5)', [m.id, cafeId, m.name, m.priceHkd, m.posItemRef]);
  }
}

export async function upsertReward(db: DB, r: { id: string; title: string; description: string | null; cost_beans: number; cafe_id: string | null }) {
  await db.run(
    `INSERT INTO rewards (id, title, description, cost_beans, cafe_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET title=excluded.title, description=excluded.description, cost_beans=excluded.cost_beans, cafe_id=excluded.cafe_id`,
    [r.id, r.title, r.description, r.cost_beans, r.cafe_id],
  );
}

/** Like SQLite's INSERT OR IGNORE: a cup whose id, uid or QR code already exists is left alone. */
export async function insertCupIfNew(db: DB, cupId: string, uid: string, tagType: string, qr: string | null, colourway: string | null, createdAt: number) {
  await db.run('INSERT INTO cups (id, uid, tag_type, qr_code, colourway, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', [
    cupId, uid, tagType, qr, colourway, createdAt,
  ]);
}
