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
  return db.one<CafeRow>('SELECT * FROM cafes WHERE id = $1 AND active = 1', [cafeId]);
}

export function activeCafes(db: DB) {
  return db.all<CafeRow>('SELECT * FROM cafes WHERE active = 1 ORDER BY name COLLATE "C"');
}

export async function cafeStampGoal(db: DB, cafeId: string): Promise<number> {
  return (await db.one<{ stamp_goal: number }>('SELECT stamp_goal FROM cafes WHERE id = $1', [cafeId]))!.stamp_goal;
}

export function cafeIdByPosLocation(db: DB, provider: string, locationRef: string) {
  return db.one<{ id: string }>('SELECT id FROM cafes WHERE pos_provider = $1 AND pos_location_ref = $2', [provider, locationRef]);
}

export function menuOfCafe(db: DB, cafeId: string) {
  return db.all<{ name: string; priceHkd: number | null }>('SELECT name, price_hkd AS "priceHkd" FROM cafe_menu WHERE cafe_id = $1 ORDER BY name COLLATE "C"', [cafeId]);
}

// ---- ledger (append-only; balances are sums)

export async function beanBalance(db: DB, memberId: string): Promise<number> {
  return (await db.one<{ n: number }>("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = $1 AND unit = 'bean'", [memberId]))!.n;
}

export async function stampBalance(db: DB, memberId: string, cafeId: string): Promise<number> {
  return (await db.one<{ n: number }>("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = $1 AND unit = 'stamp' AND cafe_id = $2", [memberId, cafeId]))!.n;
}

export async function insertLedger(
  db: DB,
  row: { id: string; memberId: string; cafeId: string | null; unit: 'stamp' | 'bean'; delta: number; reason: string; refId: string | null; createdAt: number },
) {
  await db.run('INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
    row.id, row.memberId, row.cafeId, row.unit, row.delta, row.reason, row.refId, row.createdAt,
  ]);
}

export async function hasRefundFor(db: DB, orderId: string): Promise<boolean> {
  return !!(await db.one("SELECT 1 FROM ledger WHERE ref_id = $1 AND reason = 'refund'", [orderId]));
}

export async function spendBeansFor(db: DB, orderId: string): Promise<number> {
  return (await db.one<{ n: number }>("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE ref_id = $1 AND reason = 'spend'", [orderId]))!.n;
}

export async function insertRefundBeans(db: DB, ledgerId: string, memberId: string, delta: number, orderId: string, createdAt: number) {
  await db.run("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES ($1, $2, NULL, 'bean', $3, 'refund', $4, $5)", [
    ledgerId, memberId, delta, orderId, createdAt,
  ]);
}

// ---- visits

export function recentVisitId(db: DB, memberId: string, cafeId: string, since: number) {
  return db.one<{ id: string }>('SELECT id FROM visits WHERE member_id = $1 AND cafe_id = $2 AND created_at > $3 LIMIT 1', [memberId, cafeId, since]);
}

export async function insertVisit(
  db: DB,
  v: { id: string; memberId: string; cafeId: string; cupId: string | null; source: string; staffId: string | null; posOrderId: string | null; createdAt: number },
) {
  await db.run('INSERT INTO visits (id, member_id, cafe_id, cup_id, source, staff_id, pos_order_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
    v.id, v.memberId, v.cafeId, v.cupId, v.source, v.staffId, v.posOrderId, v.createdAt,
  ]);
}

export function lastVisitAtCafe(db: DB, memberId: string, cafeId: string) {
  return db.one<{ created_at: number }>('SELECT created_at FROM visits WHERE member_id = $1 AND cafe_id = $2 ORDER BY created_at DESC LIMIT 1', [memberId, cafeId]);
}

export function stampCardsOfMember(db: DB, memberId: string) {
  return db.all<{ cafeId: string; name: string; goal: number; reward: string; stamps: number; lastVisit: number | null }>(
    `SELECT c.id AS "cafeId", c.name, c.stamp_goal AS goal, c.stamp_reward AS reward,
            COALESCE((SELECT SUM(delta) FROM ledger l WHERE l.member_id = $1 AND l.cafe_id = c.id AND l.unit = 'stamp'), 0) AS stamps,
            (SELECT MAX(created_at) FROM visits v WHERE v.member_id = $1 AND v.cafe_id = c.id) AS "lastVisit"
     FROM cafes c WHERE c.active = 1 ORDER BY "lastVisit" DESC NULLS LAST, c.name COLLATE "C"`,
    [memberId],
  );
}

export function recentVisitsOfMember(db: DB, memberId: string) {
  return db.all<{ id: string; cafeId: string; cafeName: string; source: string; at: number }>(
    `SELECT v.id, v.cafe_id AS "cafeId", c.name AS "cafeName", v.source, v.created_at AS at
     FROM visits v JOIN cafes c ON c.id = v.cafe_id WHERE v.member_id = $1 ORDER BY v.created_at DESC LIMIT 20`,
    [memberId],
  );
}

// ---- rewards and redemptions

export function activeReward(db: DB, rewardId: string) {
  return db.one<{ id: string; title: string; cost_beans: number; cafe_id: string | null }>('SELECT * FROM rewards WHERE id = $1 AND active = 1', [rewardId]);
}

export function activeRewards(db: DB) {
  return db.all(
    `SELECT r.id, r.title, r.description, r.cost_beans AS "costBeans", r.cafe_id AS "cafeId", c.name AS "cafeName"
     FROM rewards r LEFT JOIN cafes c ON c.id = r.cafe_id WHERE r.active = 1 ORDER BY r.cost_beans`,
  );
}

export async function insertStampCardRedemption(db: DB, redemptionId: string, memberId: string, cafeId: string, staffId: string, createdAt: number) {
  await db.run("INSERT INTO redemptions (id, member_id, cafe_id, kind, staff_id, created_at) VALUES ($1, $2, $3, 'stamp_card', $4, $5)", [
    redemptionId, memberId, cafeId, staffId, createdAt,
  ]);
}

export async function insertRewardRedemption(db: DB, redemptionId: string, memberId: string, cafeId: string, rewardId: string, staffId: string, createdAt: number) {
  await db.run("INSERT INTO redemptions (id, member_id, cafe_id, kind, reward_id, staff_id, created_at) VALUES ($1, $2, $3, 'reward', $4, $5, $6)", [
    redemptionId, memberId, cafeId, rewardId, staffId, createdAt,
  ]);
}
