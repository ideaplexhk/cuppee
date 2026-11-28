import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { HttpError, id, now } from '../lib/util.ts';
import * as data from '../data/loyalty.ts';
import type { CafeRow } from '../data/loyalty.ts';
import { memberProfile } from '../data/identity.ts';

export type { CafeRow } from '../data/loyalty.ts';

export async function getCafe(db: DB, cafeId: string): Promise<CafeRow> {
  const c = await data.activeCafe(db, cafeId);
  if (!c) throw new HttpError(404, 'cafe_not_found');
  return c;
}

export function beans(db: DB, memberId: string): Promise<number> {
  return data.beanBalance(db, memberId);
}

export function stamps(db: DB, memberId: string, cafeId: string): Promise<number> {
  return data.stampBalance(db, memberId, cafeId);
}

async function addLedger(db: DB, memberId: string, cafeId: string | null, unit: 'stamp' | 'bean', delta: number, reason: string, refId: string | null) {
  if (delta === 0) return;
  await data.insertLedger(db, { id: id('led'), memberId, cafeId, unit, delta, reason, refId, createdAt: now() });
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
export async function recordVisit(
  db: DB,
  cfg: Config,
  p: { memberId: string; cafeId: string; cupId?: string | null; source: 'stand' | 'card_qr' | 'pos'; staffId?: string | null; posOrderId?: string | null },
): Promise<VisitResult> {
  const cafe = await getCafe(db, p.cafeId);
  const t = now();
  const recent = await data.recentVisitId(db, p.memberId, p.cafeId, t - cfg.visitCooldownMs);
  const visitId = id('vis');
  await data.insertVisit(db, {
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
    await addLedger(db, p.memberId, p.cafeId, 'stamp', 1, 'visit', visitId);
    await addLedger(db, p.memberId, null, 'bean', cafe.beans_per_visit, 'visit', visitId);
  }
  const s = await stamps(db, p.memberId, p.cafeId);
  return {
    visitId,
    awarded,
    cooldown: !!recent,
    balances: { beans: await beans(db, p.memberId), stamps: s, stampGoal: cafe.stamp_goal, stampCardReady: s >= cafe.stamp_goal },
  };
}

/** Beans for spend, once a POS order is matched to a member. */
export async function awardSpend(db: DB, memberId: string, cafeId: string, totalHkd: number, orderId: string): Promise<number> {
  const cafe = await getCafe(db, cafeId);
  const n = Math.floor(totalHkd / 10) * cafe.beans_per_10hkd;
  await addLedger(db, memberId, null, 'bean', n, 'spend', orderId);
  return n;
}

export async function redeemStampCard(db: DB, memberId: string, cafeId: string, staffId: string) {
  const cafe = await getCafe(db, cafeId);
  const have = await stamps(db, memberId, cafeId);
  if (have < cafe.stamp_goal) throw new HttpError(409, 'not_enough_stamps', `Needs ${cafe.stamp_goal} stamps, has ${have}`);
  const rid = id('red');
  await data.insertStampCardRedemption(db, rid, memberId, cafeId, staffId, now());
  await addLedger(db, memberId, cafeId, 'stamp', -cafe.stamp_goal, 'redeem', rid);
  return { redemptionId: rid, reward: cafe.stamp_reward, stampsLeft: have - cafe.stamp_goal };
}

export async function redeemReward(db: DB, memberId: string, cafeId: string, rewardId: string, staffId: string) {
  const r = await data.activeReward(db, rewardId);
  if (!r) throw new HttpError(404, 'reward_not_found');
  if (r.cafe_id && r.cafe_id !== cafeId) throw new HttpError(409, 'wrong_cafe', 'This reward belongs to another café');
  const have = await beans(db, memberId);
  if (have < r.cost_beans) throw new HttpError(409, 'not_enough_beans', `Needs ${r.cost_beans} beans, has ${have}`);
  const rid = id('red');
  await data.insertRewardRedemption(db, rid, memberId, cafeId, r.id, staffId, now());
  await addLedger(db, memberId, null, 'bean', -r.cost_beans, 'redeem', rid);
  return { redemptionId: rid, reward: r.title, beansLeft: have - r.cost_beans };
}

export async function memberSummary(db: DB, memberId: string) {
  const m = await memberProfile(db, memberId);
  if (!m) throw new HttpError(404, 'member_not_found');
  const cards = await data.stampCardsOfMember(db, memberId);
  const visits = await data.recentVisitsOfMember(db, memberId);
  return {
    member: { ...m, preferences: JSON.parse(m.preferences) },
    beans: await beans(db, memberId),
    stampCards: cards,
    recentVisits: visits,
  };
}

export function listRewards(db: DB) {
  return data.activeRewards(db);
}

export async function listCafes(db: DB) {
  const cafes: CafeRow[] = await data.activeCafes(db);
  const out = [];
  for (const c of cafes) {
    out.push({
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
      menu: await data.menuOfCafe(db, c.id),
    });
  }
  return out;
}
