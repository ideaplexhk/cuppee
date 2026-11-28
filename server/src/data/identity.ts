// Data access for sign-in: OTP codes, sessions, members' identity and staff accounts.
// Every SQL statement for this area lives here, so the database engine can change behind it (backlog M1).
import type { DB } from '../db.ts';

export type StaffRole = 'barista' | 'manager';

export async function countRecentOtps(db: DB, phone: string, since: number): Promise<number> {
  return (await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM otp_codes WHERE phone = $1 AND expires_at > $2', [phone, since]))!.n;
}

export async function insertOtp(db: DB, phone: string, codeHash: string, expiresAt: number) {
  await db.run('INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)', [phone, codeHash, expiresAt]);
}

export function latestLiveOtp(db: DB, phone: string, at: number) {
  return db.one<{ id: number; code_hash: string; attempts: number }>(
    'SELECT id, code_hash, attempts FROM otp_codes WHERE phone = $1 AND expires_at > $2 ORDER BY expires_at DESC, id DESC LIMIT 1',
    [phone, at],
  );
}

export async function bumpOtpAttempts(db: DB, otpId: number) {
  await db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otpId]);
}

export async function deleteOtps(db: DB, phone: string) {
  await db.run('DELETE FROM otp_codes WHERE phone = $1', [phone]);
}

export function memberByPhone(db: DB, phone: string) {
  return db.one<{ id: string; display_name: string | null }>('SELECT id, display_name FROM members WHERE phone = $1', [phone]);
}

export function memberIdById(db: DB, memberId: string) {
  return db.one<{ id: string }>('SELECT id FROM members WHERE id = $1', [memberId]);
}

export function memberIdByPhone(db: DB, phone: string) {
  return db.one<{ id: string }>('SELECT id FROM members WHERE phone = $1', [phone]);
}

export async function insertMember(db: DB, memberId: string, phone: string, displayName: string | null, createdAt: number) {
  await db.run('INSERT INTO members (id, phone, display_name, created_at) VALUES ($1, $2, $3, $4)', [memberId, phone, displayName, createdAt]);
}

export async function insertSession(db: DB, tokenHash: string, kind: 'member' | 'staff', subjectId: string, expiresAt: number) {
  await db.run('INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES ($1, $2, $3, $4)', [tokenHash, kind, subjectId, expiresAt]);
}

export function sessionByTokenHash(db: DB, tokenHash: string) {
  return db.one<{ kind: 'member' | 'staff'; subject_id: string; expires_at: number }>(
    'SELECT kind, subject_id, expires_at FROM sessions WHERE token_hash = $1',
    [tokenHash],
  );
}

export async function deleteSession(db: DB, tokenHash: string) {
  await db.run('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export function staffForLogin(db: DB, staffId: string, cafeId: string) {
  return db.one<{ id: string; cafe_id: string; name: string; pin_hash: string; role: StaffRole }>(
    'SELECT id, cafe_id, name, pin_hash, role FROM staff WHERE id = $1 AND cafe_id = $2',
    [staffId, cafeId],
  );
}

export function staffCafeAndRole(db: DB, staffId: string) {
  return db.one<{ cafe_id: string; role: StaffRole }>('SELECT cafe_id, role FROM staff WHERE id = $1', [staffId]);
}

export function staffList(db: DB, cafeId: string) {
  return db.all<{ id: string; name: string }>('SELECT id, name FROM staff WHERE cafe_id = $1 ORDER BY name COLLATE "C"', [cafeId]);
}

// ---- member profile

export async function memberPreferencesJson(db: DB, memberId: string): Promise<string> {
  return (await db.one<{ preferences: string }>('SELECT preferences FROM members WHERE id = $1', [memberId]))!.preferences;
}

export async function setMemberPreferencesJson(db: DB, memberId: string, json: string) {
  await db.run('UPDATE members SET preferences = $1 WHERE id = $2', [json, memberId]);
}

export async function setMemberDisplayName(db: DB, memberId: string, name: string | null) {
  await db.run('UPDATE members SET display_name = $1 WHERE id = $2', [name, memberId]);
}

export function memberForStaff(db: DB, memberId: string) {
  return db.one<{ id: string; name: string | null; preferences: string }>('SELECT id, display_name AS name, preferences FROM members WHERE id = $1', [memberId]);
}

export function memberProfile(db: DB, memberId: string) {
  return db.one<{ id: string; phone: string; displayName: string | null; preferences: string; createdAt: number }>(
    'SELECT id, phone, display_name AS "displayName", preferences, created_at AS "createdAt" FROM members WHERE id = $1',
    [memberId],
  );
}
