import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { HttpError, id, now } from '../lib/util.ts';

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

export function getCafe(db: DB, cafeId: string): CafeRow {
  const c = db.prepare('SELECT * FROM cafes WHERE id = ? AND active = 1').get(cafeId) as CafeRow | undefined;
  if (!c) throw new HttpError(404, 'cafe_not_found');
  return c;
}

export function beans(db: DB, memberId: string): number {
  const r = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND unit = 'bean'").get(memberId) as { n: number };
  return r.n;
}

export function stamps(db: DB, memberId: string, cafeId: string): number {
  const r = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND unit = 'stamp' AND cafe_id = ?").get(memberId, cafeId) as { n: number };
  return r.n;
}

function addLedger(db: DB, memberId: string, cafeId: string | null, unit: 'stamp' | 'bean', delta: number, reason: string, refId: string | null) {
  if (delta === 0) return;
  db.prepare('INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id('led'), memberId, cafeId, unit, delta, reason, refId, now());
}

export type VisitResult = {
  visitId: string;
  awarded: { stamps: number; beans: number };
  cooldown: boolean;
  balances: { beans: number; stamps: number; stampGoal: number; stampCardReady: boolean };
};

/**
 * Record a visit and award one stamp (café card) plus the café's network beans.
 * A second visit at the same café inside the cooldown is recorded but earns nothing,
 * so a cup put down twice, or a double tap on "confirm", cannot farm points.
 * Call inside a transaction.
 */
export function recordVisit(
  db: DB,
  cfg: Config,
  p: { memberId: string; cafeId: string; cupId?: string | null; source: 'stand' | 'card_qr' | 'pos'; staffId?: string | null; posOrderId?: string | null },
): VisitResult {
  const cafe = getCafe(db, p.cafeId);
  const t = now();
  const recent = db
    .prepare('SELECT id FROM visits WHERE member_id = ? AND cafe_id = ? AND created_at > ? LIMIT 1')
    .get(p.memberId, p.cafeId, t - cfg.visitCooldownMs) as { id: string } | undefined;
  const visitId = id('vis');
  db.prepare('INSERT INTO visits (id, member_id, cafe_id, cup_id, source, staff_id, pos_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(visitId, p.memberId, p.cafeId, p.cupId ?? null, p.source, p.staffId ?? null, p.posOrderId ?? null, t);
  const awarded = { stamps: 0, beans: 0 };
  if (!recent) {
    awarded.stamps = 1;
    awarded.beans = cafe.beans_per_visit;
    addLedger(db, p.memberId, p.cafeId, 'stamp', 1, 'visit', visitId);
    addLedger(db, p.memberId, null, 'bean', cafe.beans_per_visit, 'visit', visitId);
  }
  const s = stamps(db, p.memberId, p.cafeId);
  return {
    visitId,
    awarded,
    cooldown: !!recent,
    balances: { beans: beans(db, p.memberId), stamps: s, stampGoal: cafe.stamp_goal, stampCardReady: s >= cafe.stamp_goal },
  };
}

/** Beans for spend, once a POS order is matched to a member. */
export function awardSpend(db: DB, memberId: string, cafeId: string, totalHkd: number, orderId: string): number {
  const cafe = getCafe(db, cafeId);
  const n = Math.floor(totalHkd / 10) * cafe.beans_per_10hkd;
  addLedger(db, memberId, null, 'bean', n, 'spend', orderId);
  return n;
}

export function redeemStampCard(db: DB, memberId: string, cafeId: string, staffId: string) {
  const cafe = getCafe(db, cafeId);
  const have = stamps(db, memberId, cafeId);
  if (have < cafe.stamp_goal) throw new HttpError(409, 'not_enough_stamps', `Needs ${cafe.stamp_goal} stamps, has ${have}`);
  const rid = id('red');
  db.prepare("INSERT INTO redemptions (id, member_id, cafe_id, kind, staff_id, created_at) VALUES (?, ?, ?, 'stamp_card', ?, ?)").run(rid, memberId, cafeId, staffId, now());
  addLedger(db, memberId, cafeId, 'stamp', -cafe.stamp_goal, 'redeem', rid);
  return { redemptionId: rid, reward: cafe.stamp_reward, stampsLeft: have - cafe.stamp_goal };
}

export function redeemReward(db: DB, memberId: string, cafeId: string, rewardId: string, staffId: string) {
  const r = db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(rewardId) as
    | { id: string; title: string; cost_beans: number; cafe_id: string | null }
    | undefined;
  if (!r) throw new HttpError(404, 'reward_not_found');
  if (r.cafe_id && r.cafe_id !== cafeId) throw new HttpError(409, 'wrong_cafe', 'This reward belongs to another café');
  const have = beans(db, memberId);
  if (have < r.cost_beans) throw new HttpError(409, 'not_enough_beans', `Needs ${r.cost_beans} beans, has ${have}`);
  const rid = id('red');
  db.prepare("INSERT INTO redemptions (id, member_id, cafe_id, kind, reward_id, staff_id, created_at) VALUES (?, ?, ?, 'reward', ?, ?, ?)").run(rid, memberId, cafeId, r.id, staffId, now());
  addLedger(db, memberId, null, 'bean', -r.cost_beans, 'redeem', rid);
  return { redemptionId: rid, reward: r.title, beansLeft: have - r.cost_beans };
}

export function memberSummary(db: DB, memberId: string) {
  const m = db.prepare('SELECT id, phone, display_name AS displayName, preferences, created_at AS createdAt FROM members WHERE id = ?').get(memberId) as
    | { id: string; phone: string; displayName: string | null; preferences: string; createdAt: number }
    | undefined;
  if (!m) throw new HttpError(404, 'member_not_found');
  const cards = db
    .prepare(
      `SELECT c.id AS cafeId, c.name, c.stamp_goal AS goal, c.stamp_reward AS reward,
              COALESCE((SELECT SUM(delta) FROM ledger l WHERE l.member_id = ? AND l.cafe_id = c.id AND l.unit = 'stamp'), 0) AS stamps,
              (SELECT MAX(created_at) FROM visits v WHERE v.member_id = ? AND v.cafe_id = c.id) AS lastVisit
       FROM cafes c WHERE c.active = 1 ORDER BY lastVisit IS NULL, lastVisit DESC, c.name`,
    )
    .all(memberId, memberId);
  const visits = db
    .prepare('SELECT v.id, v.cafe_id AS cafeId, c.name AS cafeName, v.source, v.created_at AS at FROM visits v JOIN cafes c ON c.id = v.cafe_id WHERE v.member_id = ? ORDER BY v.created_at DESC LIMIT 20')
    .all(memberId);
  return {
    member: { ...m, preferences: JSON.parse(m.preferences) },
    beans: beans(db, memberId),
    stampCards: cards,
    recentVisits: visits,
  };
}

export function listRewards(db: DB) {
  return db
    .prepare('SELECT r.id, r.title, r.description, r.cost_beans AS costBeans, r.cafe_id AS cafeId, c.name AS cafeName FROM rewards r LEFT JOIN cafes c ON c.id = r.cafe_id WHERE r.active = 1 ORDER BY r.cost_beans')
    .all();
}

export function listCafes(db: DB) {
  const cafes = db.prepare('SELECT * FROM cafes WHERE active = 1 ORDER BY name').all() as CafeRow[];
  const menu = db.prepare('SELECT name, price_hkd AS priceHkd FROM cafe_menu WHERE cafe_id = ? ORDER BY name');
  return cafes.map((c) => ({
    id: c.id,
    name: c.name,
    nameZh: c.name_zh,
    district: c.district,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    locationConfirmed: !!c.location_confirmed,
    hours: c.hours,
    description: c.description,
    stampGoal: c.stamp_goal,
    stampReward: c.stamp_reward,
    beansPerVisit: c.beans_per_visit,
    menu: menu.all(c.id),
  }));
}
