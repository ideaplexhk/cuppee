// Data access for counter stands and their reads (stand events). Every SQL statement for this area lives here
// (backlog M1).
import type { DB } from '../db.ts';

export function standById(db: DB, standId: string) {
  return db.one<{ id: string; cafe_id: string; key_hash: string }>('SELECT id, cafe_id, key_hash FROM stands WHERE id = $1', [standId]);
}

export async function touchStand(db: DB, standId: string, at: number) {
  await db.run('UPDATE stands SET last_seen_at = $1 WHERE id = $2', [at, standId]);
}

export function eventByClientId(db: DB, standId: string, clientEventId: string) {
  return db.one<{ id: string; status: string }>('SELECT id, status FROM stand_events WHERE stand_id = $1 AND client_event_id = $2', [standId, clientEventId]);
}

/** A pending or confirmed read of the same cup at the same café within the debounce window, if any. */
export function nearbyReadOfCup(db: DB, cupId: string, cafeId: string, readAt: number, windowMs: number) {
  return db.one(
    "SELECT id FROM stand_events WHERE cup_id = $1 AND cafe_id = $2 AND status IN ('pending','confirmed') AND ABS(read_at - $3::bigint) < $4 LIMIT 1",
    [cupId, cafeId, readAt, windowMs],
  );
}

export async function insertStandEvent(
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
  await db.run(
    'INSERT INTO stand_events (id, client_event_id, stand_id, cafe_id, cup_id, uid, read_at, received_at, status, reject_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [e.id, e.clientEventId, e.standId, e.cafeId, e.cupId, e.uid, e.readAt, e.receivedAt, e.status, e.rejectReason],
  );
}

export function openReadsForCafe(db: DB, cafeId: string, since: number) {
  return db.all<Record<string, any>>(
    `SELECT se.id, se.status, se.read_at AS "readAt", se.reject_reason AS "rejectReason", se.uid,
            cu.id AS "cupId", cu.nickname AS "cupNickname", cu.colourway,
            m.id AS "memberId", m.display_name AS "memberName", m.preferences
     FROM stand_events se
     LEFT JOIN cups cu ON cu.id = se.cup_id
     LEFT JOIN members m ON m.id = cu.member_id
     WHERE se.cafe_id = $1 AND se.read_at > $2 AND se.status IN ('pending','unknown_cup','unlinked_cup','rejected')
     ORDER BY se.read_at DESC LIMIT 30`,
    [cafeId, since],
  );
}

export function eventWithMember(db: DB, eventId: string) {
  return db.one<{ id: string; status: string; cafe_id: string; cup_id: string | null; member_id: string | null }>(
    'SELECT se.id, se.status, se.cafe_id, se.cup_id, cu.member_id FROM stand_events se LEFT JOIN cups cu ON cu.id = se.cup_id WHERE se.id = $1',
    [eventId],
  );
}

export async function markEventConfirmed(db: DB, eventId: string, visitId: string) {
  await db.run("UPDATE stand_events SET status = 'confirmed', visit_id = $1 WHERE id = $2", [visitId, eventId]);
}

/** Returns how many rows changed (0 = not an open read at this café). */
export function dismissOpenEvent(db: DB, eventId: string, cafeId: string): Promise<number> {
  return db.run(
    "UPDATE stand_events SET status = 'dismissed' WHERE id = $1 AND cafe_id = $2 AND status IN ('pending','unknown_cup','unlinked_cup','rejected')",
    [eventId, cafeId],
  );
}

/** Newest pending or confirmed read with a linked member at this café since `since`. */
export function latestMemberReadAtCafe(db: DB, cafeId: string, since: number) {
  return db.one<{ standEventId: string; status: string; readAt: number; memberId: string; name: string | null }>(
    `SELECT se.id AS "standEventId", se.status, se.read_at AS "readAt", m.id AS "memberId", m.display_name AS name
     FROM stand_events se JOIN cups cu ON cu.id = se.cup_id JOIN members m ON m.id = cu.member_id
     WHERE se.cafe_id = $1 AND se.status IN ('pending','confirmed') AND se.read_at > $2
     ORDER BY se.read_at DESC LIMIT 1`,
    [cafeId, since],
  );
}
