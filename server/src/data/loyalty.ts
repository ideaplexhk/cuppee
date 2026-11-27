// Data access for cafés, menus, visits, the points ledger, rewards and redemptions.
// Every SQL statement for this area lives here (backlog M1).
import type { DB } from '../db.ts';

export type CafeRow = {
  id: string;
  name: string;
  name_zh: string | null;
  district: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  location_confirmed: number;
  hours: string | null;
  description: string | null;
  stamp_goal: number;
  stamp_reward: string;
  beans_per_visit: number;
  beans_per_10hkd: number;
  pos_provider: string | null;
  pos_location_ref: string | null;
};

// ---- cafés

export function activeCafe(db: DB, cafeId: string) {
  return db.prepare('SELECT * FROM cafes WHERE id = ? AND active = 1').get(cafeId) as CafeRow | undefined;
}

export function activeCafes(db: DB) {
  return db.prepare('SELECT * FROM cafes WHERE active = 1 ORDER BY name').all() as CafeRow[];
}

export function cafeStampGoal(db: DB, cafeId: string): number {
  return (db.prepare('SELECT stamp_goal FROM cafes WHERE id = ?').get(cafeId) as { stamp_goal: number }).stamp_goal;
}

export function cafeIdByPosLocation(db: DB, provider: string, locationRef: string) {
  return db.prepare('SELECT id FROM cafes WHERE pos_provider = ? AND pos_location_ref = ?').get(provider, locationRef) as { id: string } | undefined;
}

/** Returns a reader for one café's menu, prepared once for a loop over cafés. */
export function menuReader(db: DB) {
  const q = db.prepare('SELECT name, price_hkd AS priceHkd FROM cafe_menu WHERE cafe_id = ? ORDER BY name');
  return (cafeId: string) => q.all(cafeId);
}

// ---- ledger (append-only; balances are sums)

export function beanBalance(db: DB, memberId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND unit = 'bean'").get(memberId) as { n: number }).n;
}

export function stampBalance(db: DB, memberId: string, cafeId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND unit = 'stamp' AND cafe_id = ?").get(memberId, cafeId) as { n: number }).n;
}

/** Returns a stamp-balance reader prepared once, for loops. */
export function stampBalanceReader(db: DB) {
  const q = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND cafe_id = ? AND unit = 'stamp'");
  return (memberId: string, cafeId: string) => (q.get(memberId, cafeId) as { n: number }).n;
}

export function insertLedger(
  db: DB,
  row: { id: string; memberId: string; cafeId: string | null; unit: 'stamp' | 'bean'; delta: number; reason: string; refId: string | null; createdAt: number },
) {
  db.prepare('INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.memberId, row.cafeId, row.unit, row.delta, row.reason, row.refId, row.createdAt);
}

export function hasRefundFor(db: DB, orderId: string): boolean {
  return !!db.prepare("SELECT 1 FROM ledger WHERE ref_id = ? AND reason = 'refund'").get(orderId);
}

export function spendBeansFor(db: DB, orderId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE ref_id = ? AND reason = 'spend'").get(orderId) as { n: number }).n;
}

export function insertRefundBeans(db: DB, ledgerId: string, memberId: string, delta: number, orderId: string, createdAt: number) {
  db.prepare("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES (?, ?, NULL, 'bean', ?, 'refund', ?, ?)")
    .run(ledgerId, memberId, delta, orderId, createdAt);
}

// ---- visits

export function recentVisitId(db: DB, memberId: string, cafeId: string, since: number) {
  return db.prepare('SELECT id FROM visits WHERE member_id = ? AND cafe_id = ? AND created_at > ? LIMIT 1').get(memberId, cafeId, since) as { id: string } | undefined;
}

export function insertVisit(
  db: DB,
  v: { id: string; memberId: string; cafeId: string; cupId: string | null; source: string; staffId: string | null; posOrderId: string | null; createdAt: number },
) {
  db.prepare('INSERT INTO visits (id, member_id, cafe_id, cup_id, source, staff_id, pos_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.id, v.memberId, v.cafeId, v.cupId, v.source, v.staffId, v.posOrderId, v.createdAt);
}

/** Returns a "last visit at this café" reader prepared once, for loops. */
export function lastVisitReader(db: DB) {
  const q = db.prepare('SELECT created_at FROM visits WHERE member_id = ? AND cafe_id = ? ORDER BY created_at DESC LIMIT 1');
  return (memberId: string, cafeId: string) => q.get(memberId, cafeId) as { created_at: number } | undefined;
}

export function stampCardsOfMember(db: DB, memberId: string) {
  return db
    .prepare(
      `SELECT c.id AS cafeId, c.name, c.stamp_goal AS goal, c.stamp_reward AS reward,
              COALESCE((SELECT SUM(delta) FROM ledger l WHERE l.member_id = ? AND l.cafe_id = c.id AND l.unit = 'stamp'), 0) AS stamps,
              (SELECT MAX(created_at) FROM visits v WHERE v.member_id = ? AND v.cafe_id = c.id) AS lastVisit
       FROM cafes c WHERE c.active = 1 ORDER BY lastVisit IS NULL, lastVisit DESC, c.name`,
    )
    .all(memberId, memberId);
}

export function recentVisitsOfMember(db: DB, memberId: string) {
  return db
    .prepare('SELECT v.id, v.cafe_id AS cafeId, c.name AS cafeName, v.source, v.created_at AS at FROM visits v JOIN cafes c ON c.id = v.cafe_id WHERE v.member_id = ? ORDER BY v.created_at DESC LIMIT 20')
    .all(memberId);
}

// ---- rewards and redemptions

export function activeReward(db: DB, rewardId: string) {
  return db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(rewardId) as
    | { id: string; title: string; cost_beans: number; cafe_id: string | null }
    | undefined;
}

export function activeRewards(db: DB) {
  return db
    .prepare('SELECT r.id, r.title, r.description, r.cost_beans AS costBeans, r.cafe_id AS cafeId, c.name AS cafeName FROM rewards r LEFT JOIN cafes c ON c.id = r.cafe_id WHERE r.active = 1 ORDER BY r.cost_beans')
    .all();
}

export function insertStampCardRedemption(db: DB, redemptionId: string, memberId: string, cafeId: string, staffId: string, createdAt: number) {
  db.prepare("INSERT INTO redemptions (id, member_id, cafe_id, kind, staff_id, created_at) VALUES (?, ?, ?, 'stamp_card', ?, ?)").run(redemptionId, memberId, cafeId, staffId, createdAt);
}

export function insertRewardRedemption(db: DB, redemptionId: string, memberId: string, cafeId: string, rewardId: string, staffId: string, createdAt: number) {
  db.prepare("INSERT INTO redemptions (id, member_id, cafe_id, kind, reward_id, staff_id, created_at) VALUES (?, ?, ?, 'reward', ?, ?, ?)").run(redemptionId, memberId, cafeId, rewardId, staffId, createdAt);
}
