import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import type { Config } from '../config.ts';
import type { NormalizedOrder, PosAdapter, WebhookRequest } from './types.ts';
import { genericAdapter } from './generic.ts';
import { verifyCardCode } from '../services/card.ts';
import { awardSpend, recordVisit } from '../services/loyalty.ts';
import { HttpError, id, normalisePhone, now } from '../lib/util.ts';
import * as orders from '../data/pos.ts';
import { cafeIdByPosLocation, hasRefundFor, insertRefundBeans, spendBeansFor } from '../data/loyalty.ts';
import { memberIdById, memberIdByPhone, memberPreferencesJson, setMemberPreferencesJson } from '../data/identity.ts';
import { latestMemberReadAtCafe } from '../data/stand.ts';

// Register new POS adapters here.
export const adapters: Record<string, PosAdapter> = {
  [genericAdapter.name]: genericAdapter,
};

export async function handleWebhook(db: DB, cfg: Config, provider: string, req: WebhookRequest) {
  const adapter = adapters[provider];
  if (!adapter) throw new HttpError(404, 'unknown_provider');
  if (!adapter.verify(req, cfg.posSecrets[provider] ?? '')) throw new HttpError(401, 'bad_signature');
  let orders: NormalizedOrder[];
  try {
    orders = adapter.parse(req);
  } catch (e) {
    throw new HttpError(400, 'bad_payload', (e as Error).message);
  }
  const results = [];
  for (const o of orders) results.push(await ingestOrder(db, cfg, provider, o, req.rawBody));
  return { results };
}

async function memberFromRef(db: DB, cfg: Config, ref: string): Promise<string | null> {
  const viaCard = verifyCardCode(cfg.cardSecret, ref);
  if (viaCard) return viaCard;
  if (/^mem_[A-Za-z0-9_\-]+$/.test(ref)) {
    const m = await memberIdById(db, ref);
    if (m) return m.id;
  }
  const phone = normalisePhone(ref);
  if (phone) {
    const m = await memberIdByPhone(db, phone);
    if (m) return m.id;
  }
  return null;
}

/**
 * Store an order and match it to a member:
 *  1. member_ref sent by the POS (scanned card / member id / phone), else
 *  2. the one confirmed stand visit at that café within ±window with no order yet.
 * Two or more candidate visits = ambiguous, left unmatched rather than guessed.
 */
export async function ingestOrder(db: DB, cfg: Config, provider: string, o: NormalizedOrder, raw?: string) {
  const cafe = await cafeIdByPosLocation(db, provider, o.locationRef);
  if (!cafe) return { externalId: o.externalId, status: 'unknown_location' };

  return tx(db, async () => {
    const existing = await orders.orderByExternalId(db, provider, o.externalId);
    if (existing) {
      if (o.status !== 'paid') await reverseSpend(db, existing.id, existing.member_id);
      return { externalId: o.externalId, status: o.status === 'paid' ? 'duplicate' : 'reversed', orderId: existing.id };
    }
    if (o.status !== 'paid') return { externalId: o.externalId, status: 'ignored_unpaid' };

    let memberId: string | null = null;
    let visitId: string | null = null;
    let method = 'none';
    if (o.memberRef) {
      memberId = await memberFromRef(db, cfg, o.memberRef);
      if (memberId) method = 'member_ref';
    }
    const candidates = await orders.unmatchedVisitsNear(db, cafe.id, o.orderedAt - cfg.posMatchWindowMs, o.orderedAt + cfg.posMatchWindowMs, o.orderedAt, memberId);
    if (memberId) {
      visitId = candidates[0]?.id ?? null;
    } else if (candidates.length === 1) {
      memberId = candidates[0].member_id;
      visitId = candidates[0].id;
      method = 'visit_window';
    }

    const orderId = id('ord');
    await orders.insertOrder(db, {
      id: orderId,
      provider,
      externalId: o.externalId,
      cafeId: cafe.id,
      memberId,
      visitId,
      totalHkd: o.totalHkd,
      itemsJson: JSON.stringify(o.items),
      orderedAt: o.orderedAt,
      matchMethod: method,
      raw: raw ?? null,
    });

    let beansAwarded = 0;
    if (memberId) {
      // Member identified at the POS with no stand visit: the order itself counts as the visit.
      if (!visitId) {
        const v = await recordVisit(db, cfg, { memberId, cafeId: cafe.id, source: 'pos', posOrderId: orderId });
        visitId = v.visitId;
        await orders.setOrderVisit(db, orderId, visitId);
      }
      beansAwarded = await awardSpend(db, memberId, cafe.id, o.totalHkd, orderId);
      await rememberUsualDrink(db, memberId, o);
    }
    return { externalId: o.externalId, status: memberId ? 'matched' : 'unmatched', orderId, matchMethod: method, beansAwarded };
  });
}

async function reverseSpend(db: DB, orderId: string, memberId: string | null) {
  if (!memberId) return;
  if (await hasRefundFor(db, orderId)) return;
  const earned = await spendBeansFor(db, orderId);
  if (earned > 0) await insertRefundBeans(db, id('led'), memberId, -earned, orderId, now());
}

/** Keep the member's most recent drink so the barista sees "usual: oat flat white" on the tablet. */
async function rememberUsualDrink(db: DB, memberId: string, o: NormalizedOrder) {
  const drink = o.items[0];
  if (!drink?.name) return;
  const prefs = JSON.parse((await memberPreferencesJson(db, memberId)) || '{}');
  prefs.lastOrder = { name: drink.name, modifiers: drink.modifiers ?? [], at: o.orderedAt };
  await setMemberPreferencesJson(db, memberId, JSON.stringify(prefs));
}

/**
 * For POS systems that can call out: "who is at the counter right now?" Returns the newest
 * pending/confirmed stand read at this location in the last few minutes, so the POS can attach
 * member_ref to the order it is ringing up.
 */
export async function counterMember(db: DB, provider: string, locationRef: string) {
  const cafe = await cafeIdByPosLocation(db, provider, locationRef);
  if (!cafe) throw new HttpError(404, 'unknown_location');
  const r = await latestMemberReadAtCafe(db, cafe.id, now() - 5 * 60_000);
  return { member: r ?? null };
}
