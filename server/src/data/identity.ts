// Data access for sign-in: OTP codes, sessions, members' identity and staff accounts.
// Every SQL statement for this area lives here, so the database engine can change behind it (backlog M1).
import type { DB } from '../db.ts';

export type StaffRole = 'barista' | 'manager';

export function countRecentOtps(db: DB, phone: string, since: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND expires_at > ?').get(phone, since) as { n: number }).n;
}

export function insertOtp(db: DB, phone: string, codeHash: string, expiresAt: number) {
  db.prepare('INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (?, ?, ?)').run(phone, codeHash, expiresAt);
}

export function latestLiveOtp(db: DB, phone: string, at: number) {
  return db
    .prepare('SELECT rowid, code_hash, attempts FROM otp_codes WHERE phone = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1')
    .get(phone, at) as { rowid: number; code_hash: string; attempts: number } | undefined;
}

export function bumpOtpAttempts(db: DB, rowid: number) {
  db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE rowid = ?').run(rowid);
}

export function deleteOtps(db: DB, phone: string) {
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
}

export function memberByPhone(db: DB, phone: string) {
  return db.prepare('SELECT id, display_name FROM members WHERE phone = ?').get(phone) as { id: string; display_name: string | null } | undefined;
}

export function memberIdById(db: DB, memberId: string) {
  return db.prepare('SELECT id FROM members WHERE id = ?').get(memberId) as { id: string } | undefined;
}

export function memberIdByPhone(db: DB, phone: string) {
  return db.prepare('SELECT id FROM members WHERE phone = ?').get(phone) as { id: string } | undefined;
}

export function insertMember(db: DB, memberId: string, phone: string, displayName: string | null, createdAt: number) {
  db.prepare('INSERT INTO members (id, phone, display_name, created_at) VALUES (?, ?, ?, ?)').run(memberId, phone, displayName, createdAt);
}

export function insertSession(db: DB, tokenHash: string, kind: 'member' | 'staff', subjectId: string, expiresAt: number) {
  db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, kind, subjectId, expiresAt);
}

export function sessionByTokenHash(db: DB, tokenHash: string) {
  return db.prepare('SELECT kind, subject_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { kind: 'member' | 'staff'; subject_id: string; expires_at: number }
    | undefined;
}

export function deleteSession(db: DB, tokenHash: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function staffForLogin(db: DB, staffId: string, cafeId: string) {
  return db.prepare('SELECT id, cafe_id, name, pin_hash, role FROM staff WHERE id = ? AND cafe_id = ?').get(staffId, cafeId) as
    | { id: string; cafe_id: string; name: string; pin_hash: string; role: StaffRole }
    | undefined;
}

export function staffCafeAndRole(db: DB, staffId: string) {
  return db.prepare('SELECT cafe_id, role FROM staff WHERE id = ?').get(staffId) as { cafe_id: string; role: StaffRole } | undefined;
}

export function staffList(db: DB, cafeId: string) {
  return db.prepare('SELECT id, name FROM staff WHERE cafe_id = ? ORDER BY name').all(cafeId);
}

// ---- member profile

export function memberPreferencesJson(db: DB, memberId: string): string {
  return (db.prepare('SELECT preferences FROM members WHERE id = ?').get(memberId) as { preferences: string }).preferences;
}

export function setMemberPreferencesJson(db: DB, memberId: string, json: string) {
  db.prepare('UPDATE members SET preferences = ? WHERE id = ?').run(json, memberId);
}

export function setMemberDisplayName(db: DB, memberId: string, name: string | null) {
  db.prepare('UPDATE members SET display_name = ? WHERE id = ?').run(name, memberId);
}

export function memberForStaff(db: DB, memberId: string) {
  return db.prepare('SELECT id, display_name AS name, preferences FROM members WHERE id = ?').get(memberId) as any;
}

export function memberProfile(db: DB, memberId: string) {
  return db.prepare('SELECT id, phone, display_name AS displayName, preferences, created_at AS createdAt FROM members WHERE id = ?').get(memberId) as
    | { id: string; phone: string; displayName: string | null; preferences: string; createdAt: number }
    | undefined;
}
