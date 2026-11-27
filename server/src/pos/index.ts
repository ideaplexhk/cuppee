import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import type { Config } from '../config.ts';
import type { NormalizedOrder, PosAdapter, WebhookRequest } from './types.ts';
import { genericAdapter } from './generic.ts';
import { verifyCardCode } from '../services/card.ts';
import { awardSpend, recordVisit } from '../services/loyalty.ts';
import { HttpError, id, normalisePhone, now } from '../lib/util.ts';

// Register new POS adapters here.
export const adapters: Record<string, PosAdapter> = {
  [genericAdapter.name]: genericAdapter,
};

export function handleWebhook(db: DB, cfg: Config, provider: string, req: WebhookRequest) {
  const adapter = adapters[provider];
  if (!adapter) throw new HttpError(404, 'unknown_provider');
  if (!adapter.verify(req, cfg.posSecrets[provider] ?? '')) throw new HttpError(401, 'bad_signature');
  let orders: NormalizedOrder[];
  try {
    orders = adapter.parse(req);
  } catch (e) {
    throw new HttpError(400, 'bad_payload', (e as Error).message);
  }
  return { results: orders.map((o) => ingestOrder(db, cfg, provider, o, req.rawBody)) };
}

function memberFromRef(db: DB, cfg: Config, ref: string): string | null {
  const viaCard = verifyCardCode(cfg.cardSecret, ref);
  if (viaCard) return viaCard;
  if (/^mem_[A-Za-z0-9_\-]+$/.test(ref)) {
    const m = db.prepare('SELECT id FROM members WHERE id = ?').get(ref) as { id: string } | undefined;
    if (m) return m.id;
  }
  const phone = normalisePhone(ref);
  if (phone) {
    const m = db.prepare('SELECT id FROM members WHERE phone = ?').get(phone) as { id: string } | undefined;
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
export function ingestOrder(db: DB, cfg: Config, provider: string, o: NormalizedOrder, raw?: string) {
  const cafe = db.prepare('SELECT id FROM cafes WHERE pos_provider = ? AND pos_location_ref = ?').get(provider, o.locationRef) as { id: string } | undefined;
  if (!cafe) return { externalId: o.externalId, status: 'unknown_location' };

  return tx(db, () => {
    const existing = db.prepare('SELECT id, member_id FROM pos_orders WHERE provider = ? AND external_id = ?').get(provider, o.externalId) as
      | { id: string; member_id: string | null }
      | undefined;
    if (existing) {
      if (o.status !== 'paid') reverseSpend(db, existing.id, existing.member_id);
      return { externalId: o.externalId, status: o.status === 'paid' ? 'duplicate' : 'reversed', orderId: existing.id };
    }
    if (o.status !== 'paid') return { externalId: o.externalId, status: 'ignored_unpaid' };

    let memberId: string | null = null;
    let visitId: string | null = null;
    let method = 'none';
    if (o.memberRef) {
      memberId = memberFromRef(db, cfg, o.memberRef);
      if (memberId) method = 'member_ref';
    }
    const candidates = db
      .prepare(
        `SELECT v.id, v.member_id FROM visits v
         WHERE v.cafe_id = ? AND v.created_at BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM pos_orders p WHERE p.visit_id = v.id)
           ${memberId ? 'AND v.member_id = ?' : ''}
         ORDER BY ABS(v.created_at - ?) LIMIT 2`,
      )
      .all(...([cafe.id, o.orderedAt - cfg.posMatchWindowMs, o.orderedAt + cfg.posMatchWindowMs, ...(memberId ? [memberId] : []), o.orderedAt] as any[])) as {
      id: string;
      member_id: string;
    }[];
    if (memberId) {
      visitId = candidates[0]?.id ?? null;
    } else if (candidates.length === 1) {
      memberId = candidates[0].member_id;
      visitId = candidates[0].id;
      method = 'visit_window';
    }

    const orderId = id('ord');
    db.prepare(
      'INSERT INTO pos_orders (id, provider, external_id, cafe_id, member_id, visit_id, total_hkd, items, ordered_at, match_method, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(orderId, provider, o.externalId, cafe.id, memberId, visitId, o.totalHkd, JSON.stringify(o.items), o.orderedAt, method, raw ?? null);

    let beansAwarded = 0;
    if (memberId) {
      // Member identified at the POS with no stand visit: the order itself counts as the visit.
      if (!visitId) {
        const v = recordVisit(db, cfg, { memberId, cafeId: cafe.id, source: 'pos', posOrderId: orderId });
        visitId = v.visitId;
        db.prepare('UPDATE pos_orders SET visit_id = ? WHERE id = ?').run(visitId, orderId);
      }
      beansAwarded = awardSpend(db, memberId, cafe.id, o.totalHkd, orderId);
      rememberUsualDrink(db, memberId, o);
    }
    return { externalId: o.externalId, status: memberId ? 'matched' : 'unmatched', orderId, matchMethod: method, beansAwarded };
  });
}

function reverseSpend(db: DB, orderId: string, memberId: string | null) {
  if (!memberId) return;
  const already = db.prepare("SELECT 1 FROM ledger WHERE ref_id = ? AND reason = 'refund'").get(orderId);
  if (already) return;
  const earned = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE ref_id = ? AND reason = 'spend'").get(orderId) as { n: number };
  if (earned.n > 0) {
    db.prepare("INSERT INTO ledger (id, member_id, cafe_id, unit, delta, reason, ref_id, created_at) VALUES (?, ?, NULL, 'bean', ?, 'refund', ?, ?)")
      .run(id('led'), memberId, -earned.n, orderId, now());
  }
}

/** Keep the member's most recent drink so the barista sees "usual: oat flat white" on the tablet. */
function rememberUsualDrink(db: DB, memberId: string, o: NormalizedOrder) {
  const drink = o.items[0];
  if (!drink?.name) return;
  const row = db.prepare('SELECT preferences FROM members WHERE id = ?').get(memberId) as { preferences: string };
  const prefs = JSON.parse(row.preferences || '{}');
  prefs.lastOrder = { name: drink.name, modifiers: drink.modifiers ?? [], at: o.orderedAt };
  db.prepare('UPDATE members SET preferences = ? WHERE id = ?').run(JSON.stringify(prefs), memberId);
}

/**
 * For POS systems that can call out: "who is at the counter right now?" Returns the newest
 * pending/confirmed stand read at this location in the last few minutes, so the POS can attach
 * member_ref to the order it is ringing up.
 */
export function counterMember(db: DB, provider: string, locationRef: string) {
  const cafe = db.prepare('SELECT id FROM cafes WHERE pos_provider = ? AND pos_location_ref = ?').get(provider, locationRef) as { id: string } | undefined;
  if (!cafe) throw new HttpError(404, 'unknown_location');
  const r = db
    .prepare(
      `SELECT se.id AS standEventId, se.status, se.read_at AS readAt, m.id AS memberId, m.display_name AS name
       FROM stand_events se JOIN cups cu ON cu.id = se.cup_id JOIN members m ON m.id = cu.member_id
       WHERE se.cafe_id = ? AND se.status IN ('pending','confirmed') AND se.read_at > ?
       ORDER BY se.read_at DESC LIMIT 1`,
    )
    .get(cafe.id, now() - 5 * 60_000);
  return { member: r ?? null };
}
