// Data access for cups. Every SQL statement for this area lives here (backlog M1).
import type { DB } from '../db.ts';

export type CupRow = {
  id: string;
  uid: string;
  tag_type: 'ntag424' | 'ntag213';
  sun_counter: number;
  qr_code: string | null;
  colourway: string | null;
  member_id: string | null;
  nickname: string | null;
};

export function cupByUid(db: DB, uid: string) {
  return db.prepare('SELECT * FROM cups WHERE uid = ?').get(uid) as CupRow | undefined;
}

export function cupByQr(db: DB, qr: string) {
  return db.prepare('SELECT * FROM cups WHERE qr_code = ?').get(qr) as CupRow | undefined;
}

export function setSunCounter(db: DB, cupId: string, counter: number) {
  db.prepare('UPDATE cups SET sun_counter = ? WHERE id = ?').run(counter, cupId);
}

export function insertCup(db: DB, cupId: string, uid: string, tagType: 'ntag424' | 'ntag213', qr: string | null, colourway: string | null, createdAt: number) {
  db.prepare('INSERT INTO cups (id, uid, tag_type, qr_code, colourway, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cupId, uid, tagType, qr, colourway, createdAt);
}

export function linkCupToMember(db: DB, cupId: string, memberId: string, nickname: string | null, linkedAt: number) {
  db.prepare('UPDATE cups SET member_id = ?, nickname = COALESCE(?, nickname), linked_at = COALESCE(linked_at, ?) WHERE id = ?').run(memberId, nickname, linkedAt, cupId);
}

/** Returns how many rows changed (0 = not this member's cup). */
export function unlinkMemberCup(db: DB, cupId: string, memberId: string): number {
  return Number(db.prepare('UPDATE cups SET member_id = NULL, nickname = NULL, linked_at = NULL WHERE id = ? AND member_id = ?').run(cupId, memberId).changes);
}

export function cupsOfMember(db: DB, memberId: string) {
  return db
    .prepare('SELECT id, uid, tag_type AS tagType, colourway, nickname, linked_at AS linkedAt FROM cups WHERE member_id = ? ORDER BY linked_at')
    .all(memberId) as { id: string; uid: string; tagType: string; colourway: string | null; nickname: string | null; linkedAt: number }[];
}
