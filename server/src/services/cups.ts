import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import { verifySun } from '../lib/sun.ts';
import { HttpError, id, now } from '../lib/util.ts';
import * as data from '../data/cups.ts';
import type { CupRow } from '../data/cups.ts';

export type { CupRow } from '../data/cups.ts';

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
    const cup = data.cupByUid(db, r.uid);
    if (!cup) return { ok: true, cup: null, uid: r.uid };
    if (r.counter <= cup.sun_counter) return { ok: false, reason: 'replayed_tap', uid: r.uid };
    if (commitCounter) data.setSunCounter(db, cup.id, r.counter);
    return { ok: true, cup, uid: r.uid };
  }
  if (t.qr) {
    const cup = data.cupByQr(db, t.qr.trim());
    if (!cup) return { ok: false, reason: 'unknown_qr' };
    return { ok: true, cup, uid: cup.uid };
  }
  if (t.uid) {
    const uid = t.uid.replace(/[:\s]/g, '').toUpperCase();
    if (!/^[0-9A-F]{8,20}$/.test(uid)) return { ok: false, reason: 'bad_uid' };
    const cup = data.cupByUid(db, uid);
    // A bare UID can be copied by any phone, so NTAG 424 cups must always present a SUN message.
    if (cup?.tag_type === 'ntag424' || !cfg.allowUidOnly) return { ok: false, reason: 'sun_required', uid };
    return { ok: true, cup: cup ?? null, uid };
  }
  return { ok: false, reason: 'no_tap_data' };
}

/** Register a manufactured cup (done at packing / by admin). */
export function registerCup(db: DB, uid: string, tagType: 'ntag424' | 'ntag213', qr?: string, colourway?: string) {
  const cupId = id('cup');
  data.insertCup(db, cupId, uid.toUpperCase(), tagType, qr ?? null, colourway ?? null, now());
  return cupId;
}

export function linkCup(db: DB, cfg: Config, memberId: string, tap: TapInput, nickname?: string) {
  const r = resolveTap(db, cfg, tap);
  if (!r.ok) throw new HttpError(400, r.reason, 'We could not read that cup. Try tapping again.');
  if (!r.cup) throw new HttpError(404, 'unknown_cup', 'This cup is not registered with CUPPEE.');
  if (r.cup.member_id && r.cup.member_id !== memberId) throw new HttpError(409, 'cup_taken', 'This cup is already linked to another member.');
  data.linkCupToMember(db, r.cup.id, memberId, nickname?.trim() || null, now());
  return listCups(db, memberId).find((c) => c.id === r.cup!.id)!;
}

export function unlinkCup(db: DB, memberId: string, cupId: string) {
  if (data.unlinkMemberCup(db, cupId, memberId) === 0) throw new HttpError(404, 'not_found');
}

export function listCups(db: DB, memberId: string) {
  return data.cupsOfMember(db, memberId);
}
