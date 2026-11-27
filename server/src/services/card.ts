// Rotating member-card QR. The phone shows CUPPEE1.<memberId>.<window>.<sig>, where window
// changes every 30 s, so a screenshot stops working quickly. No network needed on the phone:
// the app gets the signing material once per session (see /me/card).

import { hmac, safeEq } from '../lib/util.ts';

export const CARD_WINDOW_MS = 30_000;

export function cardKeyFor(secret: string, memberId: string): string {
  // Per-member derived key: the app only ever learns its own key.
  return hmac(secret, `card-key:${memberId}`);
}

export function cardCode(memberKey: string, memberId: string, at = Date.now()): string {
  const w = Math.floor(at / CARD_WINDOW_MS);
  return `CUPPEE1.${memberId}.${w}.${hmac(memberKey, `${memberId}.${w}`).slice(0, 16)}`;
}

/** Returns the member id if the code is valid for the current or previous window. */
export function verifyCardCode(secret: string, code: string, at = Date.now()): string | null {
  const m = /^CUPPEE1\.([A-Za-z0-9_\-]+)\.(\d+)\.([A-Za-z0-9_\-]{16})$/.exec((code ?? '').trim());
  if (!m) return null;
  const [, memberId, wStr, sig] = m;
  const w = Number(wStr);
  const current = Math.floor(at / CARD_WINDOW_MS);
  if (w !== current && w !== current - 1) return null;
  const key = cardKeyFor(secret, memberId);
  return safeEq(hmac(key, `${memberId}.${w}`).slice(0, 16), sig) ? memberId : null;
}
