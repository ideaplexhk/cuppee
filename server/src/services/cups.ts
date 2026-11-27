import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { verifySun } from '../lib/sun.ts';
import { HttpError, id, now } from '../lib/util.ts';

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

/** What a tap gives us: a SUN URL's parameters (NTAG 424), a bare UID (NTAG 213 / Phase 0) or the etched QR. */
export type TapInput = { picc?: string; cmac?: string; uid?: string; qr?: string };

export type ResolveResult =
  | { ok: true; cup: CupRow | null; uid: string }
  | { ok: false; reason: string; uid?: string };

/**
 * Identify the cup behind a tap. For NTAG 424 the SUN counter must move forward,
 * which rejects copied URLs. commitCounter=false lets callers check without consuming the tap.
 */
export function resolveTap(db: DB, cfg: Config, t: TapInput, commitCounter = true): ResolveResult {
  if (t.picc && t.cmac) {
    const r = verifySun(t.picc, t.cmac, cfg.sdmMetaReadKey, cfg.sdmFileReadKey);
    if (!r.ok) return { ok: false, reason: r.reason };
    const cup = db.prepare('SELECT * FROM cups WHERE uid = ?').get(r.uid) as CupRow | undefined;
    if (!cup) return { ok: true, cup: null, uid: r.uid };
    if (r.counter <= cup.sun_counter) return { ok: false, reason: 'replayed_tap', uid: r.uid };
    if (commitCounter) db.prepare('UPDATE cups SET sun_counter = ? WHERE id = ?').run(r.counter, cup.id);
    return { ok: true, cup, uid: r.uid };
  }
  if (t.qr) {
    const cup = db.prepare('SELECT * FROM cups WHERE qr_code = ?').get(t.qr.trim()) as CupRow | undefined;
    if (!cup) return { ok: false, reason: 'unknown_qr' };
    return { ok: true, cup, uid: cup.uid };
  }
  if (t.uid) {
    const uid = t.uid.replace(/[:\s]/g, '').toUpperCase();
    if (!/^[0-9A-F]{8,20}$/.test(uid)) return { ok: false, reason: 'bad_uid' };
    const cup = db.prepare('SELECT * FROM cups WHERE uid = ?').get(uid) as CupRow | undefined;
    // A bare UID can be copied by any phone, so NTAG 424 cups must always present a SUN message.
    if (cup?.tag_type === 'ntag424' || !cfg.allowUidOnly) return { ok: false, reason: 'sun_required', uid };
    return { ok: true, cup: cup ?? null, uid };
  }
  return { ok: false, reason: 'no_tap_data' };
}

/** Register a manufactured cup (done at packing / by admin). */
export function registerCup(db: DB, uid: string, tagType: 'ntag424' | 'ntag213', qr?: string, colourway?: string) {
  const cupId = id('cup');
  db.prepare('INSERT INTO cups (id, uid, tag_type, qr_code, colourway, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cupId, uid.toUpperCase(), tagType, qr ?? null, colourway ?? null, now());
  return cupId;
}

export function linkCup(db: DB, cfg: Config, memberId: string, tap: TapInput, nickname?: string) {
  const r = resolveTap(db, cfg, tap);
  if (!r.ok) throw new HttpError(400, r.reason, 'We could not read that cup. Try tapping again.');
  if (!r.cup) throw new HttpError(404, 'unknown_cup', 'This cup is not registered with CUPPEE.');
  if (r.cup.member_id && r.cup.member_id !== memberId) throw new HttpError(409, 'cup_taken', 'This cup is already linked to another member.');
  db.prepare('UPDATE cups SET member_id = ?, nickname = COALESCE(?, nickname), linked_at = COALESCE(linked_at, ?) WHERE id = ?')
    .run(memberId, nickname?.trim() || null, now(), r.cup.id);
  return listCups(db, memberId).find((c) => c.id === r.cup!.id)!;
}

export function unlinkCup(db: DB, memberId: string, cupId: string) {
  const res = db.prepare('UPDATE cups SET member_id = NULL, nickname = NULL, linked_at = NULL WHERE id = ? AND member_id = ?').run(cupId, memberId);
  if (res.changes === 0) throw new HttpError(404, 'not_found');
}

export function listCups(db: DB, memberId: string) {
  return db
    .prepare('SELECT id, uid, tag_type AS tagType, colourway, nickname, linked_at AS linkedAt FROM cups WHERE member_id = ? ORDER BY linked_at')
    .all(memberId) as { id: string; uid: string; tagType: string; colourway: string | null; nickname: string | null; linkedAt: number }[];
}
