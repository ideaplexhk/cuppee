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
  return db.one<CupRow>('SELECT * FROM cups WHERE uid = $1', [uid]);
}

export function cupByQr(db: DB, qr: string) {
  return db.one<CupRow>('SELECT * FROM cups WHERE qr_code = $1', [qr]);
}

export async function setSunCounter(db: DB, cupId: string, counter: number) {
  await db.run('UPDATE cups SET sun_counter = $1 WHERE id = $2', [counter, cupId]);
}

export async function insertCup(db: DB, cupId: string, uid: string, tagType: 'ntag424' | 'ntag213', qr: string | null, colourway: string | null, createdAt: number) {
  await db.run('INSERT INTO cups (id, uid, tag_type, qr_code, colourway, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [cupId, uid, tagType, qr, colourway, createdAt]);
}

export async function linkCupToMember(db: DB, cupId: string, memberId: string, nickname: string | null, linkedAt: number) {
  await db.run('UPDATE cups SET member_id = $1, nickname = COALESCE($2, nickname), linked_at = COALESCE(linked_at, $3) WHERE id = $4', [memberId, nickname, linkedAt, cupId]);
}

/** Returns how many rows changed (0 = not this member's cup). */
export function unlinkMemberCup(db: DB, cupId: string, memberId: string): Promise<number> {
  return db.run('UPDATE cups SET member_id = NULL, nickname = NULL, linked_at = NULL WHERE id = $1 AND member_id = $2', [cupId, memberId]);
}

export function cupsOfMember(db: DB, memberId: string) {
  return db.all<{ id: string; uid: string; tagType: string; colourway: string | null; nickname: string | null; linkedAt: number }>(
    'SELECT id, uid, tag_type AS "tagType", colourway, nickname, linked_at AS "linkedAt" FROM cups WHERE member_id = $1 ORDER BY linked_at',
    [memberId],
  );
}
