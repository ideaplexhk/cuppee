import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { HttpError, checkPin, id, normalisePhone, now, sha256, sixDigits, token } from '../lib/util.ts';
import type { SmsSender } from '../lib/sms.ts';

const OTP_TTL = 5 * 60_000;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const MEMBER_SESSION_TTL = 90 * 24 * 3600_000;
const STAFF_SESSION_TTL = 14 * 3600_000; // one shift

export type Principal =
  | { kind: 'member'; memberId: string }
  | { kind: 'staff'; staffId: string; cafeId: string; role: 'barista' | 'manager' };

export function requestOtp(db: DB, cfg: Config, sms: SmsSender, rawPhone: string) {
  const phone = normalisePhone(rawPhone ?? '');
  if (!phone) throw new HttpError(400, 'invalid_phone', 'Enter a valid phone number');
  const t = now();
  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND expires_at > ?')
    .get(phone, t - 3600_000 + OTP_TTL) as { n: number };
  if (recent.n >= OTP_MAX_PER_HOUR) throw new HttpError(429, 'too_many_codes', 'Too many codes requested. Try again later.');
  const code = sixDigits();
  db.prepare('INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (?, ?, ?)').run(phone, sha256(`${phone}:${code}`), t + OTP_TTL);
  sms.send(phone, `Your CUPPEE code is ${code}. It expires in 5 minutes.`);
  return { phone, devCode: cfg.devMode ? code : undefined };
}

export function verifyOtp(db: DB, rawPhone: string, code: string, displayName?: string) {
  const phone = normalisePhone(rawPhone ?? '');
  if (!phone || !/^\d{6}$/.test(code ?? '')) throw new HttpError(400, 'invalid_code');
  const t = now();
  const row = db
    .prepare('SELECT rowid, code_hash, attempts FROM otp_codes WHERE phone = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1')
    .get(phone, t) as { rowid: number; code_hash: string; attempts: number } | undefined;
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(401, 'code_expired', 'Code expired. Request a new one.');
  if (row.code_hash !== sha256(`${phone}:${code}`)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE rowid = ?').run(row.rowid);
    throw new HttpError(401, 'wrong_code', 'That code is not right.');
  }
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);

  let member = db.prepare('SELECT id, display_name FROM members WHERE phone = ?').get(phone) as
    | { id: string; display_name: string | null }
    | undefined;
  const isNew = !member;
  if (!member) {
    member = { id: id('mem'), display_name: displayName?.trim() || null };
    db.prepare('INSERT INTO members (id, phone, display_name, created_at) VALUES (?, ?, ?, ?)').run(member.id, phone, member.display_name, t);
  }
  const tok = token();
  db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, ?, ?, ?)').run(sha256(tok), 'member', member.id, t + MEMBER_SESSION_TTL);
  return { token: tok, memberId: member.id, isNew };
}

export function staffLogin(db: DB, cafeId: string, staffId: string, pin: string) {
  const s = db.prepare('SELECT id, cafe_id, name, pin_hash, role FROM staff WHERE id = ? AND cafe_id = ?').get(staffId ?? '', cafeId ?? '') as
    | { id: string; cafe_id: string; name: string; pin_hash: string; role: 'barista' | 'manager' }
    | undefined;
  if (!s || !checkPin(String(pin ?? ''), s.pin_hash)) throw new HttpError(401, 'wrong_pin', 'Wrong staff PIN');
  const tok = token();
  db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, ?, ?, ?)').run(sha256(tok), 'staff', s.id, now() + STAFF_SESSION_TTL);
  return { token: tok, staff: { id: s.id, name: s.name, role: s.role, cafeId: s.cafe_id } };
}

export function authenticate(db: DB, authHeader: string | undefined): Principal | null {
  const m = /^Bearer (.+)$/.exec(authHeader ?? '');
  if (!m) return null;
  const s = db.prepare('SELECT kind, subject_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(m[1])) as
    | { kind: 'member' | 'staff'; subject_id: string; expires_at: number }
    | undefined;
  if (!s || s.expires_at < now()) return null;
  if (s.kind === 'member') return { kind: 'member', memberId: s.subject_id };
  const st = db.prepare('SELECT cafe_id, role FROM staff WHERE id = ?').get(s.subject_id) as { cafe_id: string; role: 'barista' | 'manager' } | undefined;
  if (!st) return null;
  return { kind: 'staff', staffId: s.subject_id, cafeId: st.cafe_id, role: st.role };
}

export function logout(db: DB, authHeader: string | undefined) {
  const m = /^Bearer (.+)$/.exec(authHeader ?? '');
  if (m) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(m[1]));
}
