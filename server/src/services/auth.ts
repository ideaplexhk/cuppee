import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { HttpError, checkPin, id, normalisePhone, now, sha256, sixDigits, token } from '../lib/util.ts';
import type { SmsSender } from '../lib/sms.ts';
import * as data from '../data/identity.ts';

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
  const recent = data.countRecentOtps(db, phone, t - 3600_000 + OTP_TTL);
  if (recent >= OTP_MAX_PER_HOUR) throw new HttpError(429, 'too_many_codes', 'Too many codes requested. Try again later.');
  const code = sixDigits();
  data.insertOtp(db, phone, sha256(`${phone}:${code}`), t + OTP_TTL);
  sms.send(phone, `Your CUPPEE code is ${code}. It expires in 5 minutes.`);
  return { phone, devCode: cfg.devMode ? code : undefined };
}

export function verifyOtp(db: DB, rawPhone: string, code: string, displayName?: string) {
  const phone = normalisePhone(rawPhone ?? '');
  if (!phone || !/^\d{6}$/.test(code ?? '')) throw new HttpError(400, 'invalid_code');
  const t = now();
  const row = data.latestLiveOtp(db, phone, t);
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(401, 'code_expired', 'Code expired. Request a new one.');
  if (row.code_hash !== sha256(`${phone}:${code}`)) {
    data.bumpOtpAttempts(db, row.rowid);
    throw new HttpError(401, 'wrong_code', 'That code is not right.');
  }
  data.deleteOtps(db, phone);

  let member = data.memberByPhone(db, phone);
  const isNew = !member;
  if (!member) {
    member = { id: id('mem'), display_name: displayName?.trim() || null };
    data.insertMember(db, member.id, phone, member.display_name, t);
  }
  const tok = token();
  data.insertSession(db, sha256(tok), 'member', member.id, t + MEMBER_SESSION_TTL);
  return { token: tok, memberId: member.id, isNew };
}

export function staffLogin(db: DB, cafeId: string, staffId: string, pin: string) {
  const s = data.staffForLogin(db, staffId ?? '', cafeId ?? '');
  if (!s || !checkPin(String(pin ?? ''), s.pin_hash)) throw new HttpError(401, 'wrong_pin', 'Wrong staff PIN');
  const tok = token();
  data.insertSession(db, sha256(tok), 'staff', s.id, now() + STAFF_SESSION_TTL);
  return { token: tok, staff: { id: s.id, name: s.name, role: s.role, cafeId: s.cafe_id } };
}

export function authenticate(db: DB, authHeader: string | undefined): Principal | null {
  const m = /^Bearer (.+)$/.exec(authHeader ?? '');
  if (!m) return null;
  const s = data.sessionByTokenHash(db, sha256(m[1]));
  if (!s || s.expires_at < now()) return null;
  if (s.kind === 'member') return { kind: 'member', memberId: s.subject_id };
  const st = data.staffCafeAndRole(db, s.subject_id);
  if (!st) return null;
  return { kind: 'staff', staffId: s.subject_id, cafeId: st.cafe_id, role: st.role };
}

export function logout(db: DB, authHeader: string | undefined) {
  const m = /^Bearer (.+)$/.exec(authHeader ?? '');
  if (m) data.deleteSession(db, sha256(m[1]));
}
