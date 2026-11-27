// Data access for orders received from a café's POS. Every SQL statement for this area lives here (backlog M1).
import type { DB } from '../db.ts';

export function orderByExternalId(db: DB, provider: string, externalId: string) {
  return db.prepare('SELECT id, member_id FROM pos_orders WHERE provider = ? AND external_id = ?').get(provider, externalId) as
    | { id: string; member_id: string | null }
    | undefined;
}

/**
 * Up to two visits at the café within [from, to] that have no order yet, nearest to `at` first.
 * With a member id, only that member's visits.
 */
export function unmatchedVisitsNear(db: DB, cafeId: string, from: number, to: number, at: number, memberId: string | null) {
  return db
    .prepare(
      `SELECT v.id, v.member_id FROM visits v
       WHERE v.cafe_id = ? AND v.created_at BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM pos_orders p WHERE p.visit_id = v.id)
         ${memberId ? 'AND v.member_id = ?' : ''}
       ORDER BY ABS(v.created_at - ?) LIMIT 2`,
    )
    .all(...([cafeId, from, to, ...(memberId ? [memberId] : []), at] as any[])) as { id: string; member_id: string }[];
}

export function insertOrder(
  db: DB,
  o: {
    id: string;
    provider: string;
    externalId: string;
    cafeId: string;
    memberId: string | null;
    visitId: string | null;
    totalHkd: number;
    itemsJson: string;
    orderedAt: number;
    matchMethod: string;
    raw: string | null;
  },
) {
  db.prepare(
    'INSERT INTO pos_orders (id, provider, external_id, cafe_id, member_id, visit_id, total_hkd, items, ordered_at, match_method, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(o.id, o.provider, o.externalId, o.cafeId, o.memberId, o.visitId, o.totalHkd, o.itemsJson, o.orderedAt, o.matchMethod, o.raw);
}

export function setOrderVisit(db: DB, orderId: string, visitId: string) {
  db.prepare('UPDATE pos_orders SET visit_id = ? WHERE id = ?').run(visitId, orderId);
}
