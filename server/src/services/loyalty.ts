import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { HttpError, id, now } from '../lib/util.ts';
import * as data from '../data/loyalty.ts';
import type { CafeRow } from '../data/loyalty.ts';
import { memberProfile } from '../data/identity.ts';

export type { CafeRow } from '../data/loyalty.ts';

export function getCafe(db: DB, cafeId: string): CafeRow {
  const c = data.activeCafe(db, cafeId);
  if (!c) throw new HttpError(404, 'cafe_not_found');
  return c;
}

export function beans(db: DB, memberId: string): number {
  return data.beanBalance(db, memberId);
}

export function stamps(db: DB, memberId: string, cafeId: string): number {
  return data.stampBalance(db, memberId, cafeId);
}

function addLedger(db: DB, memberId: string, cafeId: string | null, unit: 'stamp' | 'bean', delta: number, reason: string, refId: string | null) {
  if (delta === 0) return;
  data.insertLedger(db, { id: id('led'), memberId, cafeId, unit, delta, reason, refId, createdAt: now() });
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
  const recent = data.recentVisitId(db, p.memberId, p.cafeId, t - cfg.visitCooldownMs);
  const visitId = id('vis');
  data.insertVisit(db, {
    id: visitId,
    memberId: p.memberId,
    cafeId: p.cafeId,
    cupId: p.cupId ?? null,
    source: p.source,
    staffId: p.staffId ?? null,
    posOrderId: p.posOrderId ?? null,
    createdAt: t,
  });
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
  data.insertStampCardRedemption(db, rid, memberId, cafeId, staffId, now());
  addLedger(db, memberId, cafeId, 'stamp', -cafe.stamp_goal, 'redeem', rid);
  return { redemptionId: rid, reward: cafe.stamp_reward, stampsLeft: have - cafe.stamp_goal };
}

export function redeemReward(db: DB, memberId: string, cafeId: string, rewardId: string, staffId: string) {
  const r = data.activeReward(db, rewardId);
  if (!r) throw new HttpError(404, 'reward_not_found');
  if (r.cafe_id && r.cafe_id !== cafeId) throw new HttpError(409, 'wrong_cafe', 'This reward belongs to another café');
  const have = beans(db, memberId);
  if (have < r.cost_beans) throw new HttpError(409, 'not_enough_beans', `Needs ${r.cost_beans} beans, has ${have}`);
  const rid = id('red');
  data.insertRewardRedemption(db, rid, memberId, cafeId, r.id, staffId, now());
  addLedger(db, memberId, null, 'bean', -r.cost_beans, 'redeem', rid);
  return { redemptionId: rid, reward: r.title, beansLeft: have - r.cost_beans };
}

export function memberSummary(db: DB, memberId: string) {
  const m = memberProfile(db, memberId);
  if (!m) throw new HttpError(404, 'member_not_found');
  const cards = data.stampCardsOfMember(db, memberId);
  const visits = data.recentVisitsOfMember(db, memberId);
  return {
    member: { ...m, preferences: JSON.parse(m.preferences) },
    beans: beans(db, memberId),
    stampCards: cards,
    recentVisits: visits,
  };
}

export function listRewards(db: DB) {
  return data.activeRewards(db);
}

export function listCafes(db: DB) {
  const cafes: CafeRow[] = data.activeCafes(db);
  const menu = data.menuReader(db);
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
    menu: menu(c.id),
  }));
}
