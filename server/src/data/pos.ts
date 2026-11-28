// Data access for orders received from a café's POS. Every SQL statement for this area lives here (backlog M1).
import type { DB } from '../db.ts';

export function orderByExternalId(db: DB, provider: string, externalId: string) {
  return db.one<{ id: string; member_id: string | null }>('SELECT id, member_id FROM pos_orders WHERE provider = $1 AND external_id = $2', [provider, externalId]);
}

/**
 * Up to two visits at the café within [from, to] that have no order yet, nearest to `at` first.
 * With a member id, only that member's visits.
 */
export function unmatchedVisitsNear(db: DB, cafeId: string, from: number, to: number, at: number, memberId: string | null) {
  return db.all<{ id: string; member_id: string }>(
    `SELECT v.id, v.member_id FROM visits v
     WHERE v.cafe_id = $1 AND v.created_at BETWEEN $2 AND $3
       AND NOT EXISTS (SELECT 1 FROM pos_orders p WHERE p.visit_id = v.id)
       AND ($5::text IS NULL OR v.member_id = $5)
     ORDER BY ABS(v.created_at - $4::bigint) LIMIT 2`,
    [cafeId, from, to, at, memberId],
  );
}

export async function insertOrder(
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
  await db.run(
    'INSERT INTO pos_orders (id, provider, external_id, cafe_id, member_id, visit_id, total_hkd, items, ordered_at, match_method, raw) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [o.id, o.provider, o.externalId, o.cafeId, o.memberId, o.visitId, o.totalHkd, o.itemsJson, o.orderedAt, o.matchMethod, o.raw],
  );
}

export async function setOrderVisit(db: DB, orderId: string, visitId: string) {
  await db.run('UPDATE pos_orders SET visit_id = $1 WHERE id = $2', [visitId, orderId]);
}
