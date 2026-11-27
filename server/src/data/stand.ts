// Data access for counter stands and their reads (stand events). Every SQL statement for this area lives here
// (backlog M1).
import type { DB } from '../db.ts';

export function standById(db: DB, standId: string) {
  return db.prepare('SELECT id, cafe_id, key_hash FROM stands WHERE id = ?').get(standId) as { id: string; cafe_id: string; key_hash: string } | undefined;
}

export function touchStand(db: DB, standId: string, at: number) {
  db.prepare('UPDATE stands SET last_seen_at = ? WHERE id = ?').run(at, standId);
}

export function eventByClientId(db: DB, standId: string, clientEventId: string) {
  return db.prepare('SELECT id, status FROM stand_events WHERE stand_id = ? AND client_event_id = ?').get(standId, clientEventId) as
    | { id: string; status: string }
    | undefined;
}

/** A pending or confirmed read of the same cup at the same café within the debounce window, if any. */
export function nearbyReadOfCup(db: DB, cupId: string, cafeId: string, readAt: number, windowMs: number) {
  return db
    .prepare("SELECT id FROM stand_events WHERE cup_id = ? AND cafe_id = ? AND status IN ('pending','confirmed') AND ABS(read_at - ?) < ? LIMIT 1")
    .get(cupId, cafeId, readAt, windowMs);
}

export function insertStandEvent(
  db: DB,
  e: {
    id: string;
    clientEventId: string;
    standId: string;
    cafeId: string;
    cupId: string | null;
    uid: string | null;
    readAt: number;
    receivedAt: number;
    status: string;
    rejectReason: string | null;
  },
) {
  db.prepare(
    'INSERT INTO stand_events (id, client_event_id, stand_id, cafe_id, cup_id, uid, read_at, received_at, status, reject_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.id, e.clientEventId, e.standId, e.cafeId, e.cupId, e.uid, e.readAt, e.receivedAt, e.status, e.rejectReason);
}

export function openReadsForCafe(db: DB, cafeId: string, since: number) {
  return db
    .prepare(
      `SELECT se.id, se.status, se.read_at AS readAt, se.reject_reason AS rejectReason, se.uid,
              cu.id AS cupId, cu.nickname AS cupNickname, cu.colourway,
              m.id AS memberId, m.display_name AS memberName, m.preferences
       FROM stand_events se
       LEFT JOIN cups cu ON cu.id = se.cup_id
       LEFT JOIN members m ON m.id = cu.member_id
       WHERE se.cafe_id = ? AND se.read_at > ? AND se.status IN ('pending','unknown_cup','unlinked_cup','rejected')
       ORDER BY se.read_at DESC LIMIT 30`,
    )
    .all(cafeId, since) as Record<string, any>[];
}

export function eventWithMember(db: DB, eventId: string) {
  return db
    .prepare('SELECT se.id, se.status, se.cafe_id, se.cup_id, cu.member_id FROM stand_events se LEFT JOIN cups cu ON cu.id = se.cup_id WHERE se.id = ?')
    .get(eventId) as { id: string; status: string; cafe_id: string; cup_id: string | null; member_id: string | null } | undefined;
}

export function markEventConfirmed(db: DB, eventId: string, visitId: string) {
  db.prepare("UPDATE stand_events SET status = 'confirmed', visit_id = ? WHERE id = ?").run(visitId, eventId);
}

/** Returns how many rows changed (0 = not an open read at this café). */
export function dismissOpenEvent(db: DB, eventId: string, cafeId: string): number {
  return Number(
    db.prepare("UPDATE stand_events SET status = 'dismissed' WHERE id = ? AND cafe_id = ? AND status IN ('pending','unknown_cup','unlinked_cup','rejected')").run(eventId, cafeId)
      .changes,
  );
}

/** Newest pending or confirmed read with a linked member at this café since `since`. */
export function latestMemberReadAtCafe(db: DB, cafeId: string, since: number) {
  return db
    .prepare(
      `SELECT se.id AS standEventId, se.status, se.read_at AS readAt, m.id AS memberId, m.display_name AS name
       FROM stand_events se JOIN cups cu ON cu.id = se.cup_id JOIN members m ON m.id = cu.member_id
       WHERE se.cafe_id = ? AND se.status IN ('pending','confirmed') AND se.read_at > ?
       ORDER BY se.read_at DESC LIMIT 1`,
    )
    .get(cafeId, since);
}
