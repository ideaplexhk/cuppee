// Same algorithm as server/src/services/card.ts. The key is the per-member key from GET /v1/me/card
// (the string itself is the HMAC key, exactly as on the server).
import { base64url, hmacSha256, utf8 } from './hmac';

export function cardCode(cardKey: string, memberId: string, windowMs: number, at: number): string {
  const w = Math.floor(at / windowMs);
  const sig = base64url(hmacSha256(utf8(cardKey), utf8(`${memberId}.${w}`))).slice(0, 16);
  return `CUPPEE1.${memberId}.${w}.${sig}`;
}

/** Milliseconds until the code changes, for the countdown ring. */
export function msUntilNext(windowMs: number, at: number): number {
  return windowMs - (at % windowMs);
}
