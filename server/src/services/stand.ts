// Counter stand: the bridge posts raw reads (batched, so an offline queue can replay),
// the café tablet polls the feed and staff confirm each read into a visit.

import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import type { Config } from '../config.ts';
import { resolveTap } from './cups.ts';
import { recordVisit } from './loyalty.ts';
import { HttpError, id, now, sha256 } from '../lib/util.ts';
import * as data from '../data/stand.ts';
import { cafeStampGoal, lastVisitAtCafe, stampBalance } from '../data/loyalty.ts';

export type StandEventIn = {
  eventId: string;     // generated on the stand, stable across retries
  readAt: number;      // ms epoch on the stand's clock
  picc?: string;
  cmac?: string;
  uid?: string;
};

export async function authStand(db: DB, standId: string | undefined, key: string | undefined) {
  if (!standId || !key) throw new HttpError(401, 'stand_auth');
  const s = await data.standById(db, standId);
  if (!s || s.key_hash !== sha256(key)) throw new HttpError(401, 'stand_auth');
  await data.touchStand(db, s.id, now());
  return { standId: s.id, cafeId: s.cafe_id };
}

export async function ingestEvents(db: DB, cfg: Config, standId: string, cafeId: string, events: StandEventIn[]) {
  if (!Array.isArray(events) || events.length === 0) throw new HttpError(400, 'no_events');
  if (events.length > 100) throw new HttpError(400, 'too_many_events', 'Max 100 events per batch');
  const received = now();
  const results: { eventId: string; status: string; id?: string }[] = [];
  // Oldest first so debounce compares in the order the stand saw them.
  const sorted = [...events].sort((a, b) => a.readAt - b.readAt);

  for (const e of sorted) {
    if (!e?.eventId || typeof e.readAt !== 'number') {
      results.push({ eventId: String(e?.eventId), status: 'invalid' });
      continue;
    }
    const existing = await data.eventByClientId(db, standId, e.eventId);
    if (existing) {
      results.push({ eventId: e.eventId, status: existing.status, id: existing.id });
      continue;
    }
    // Don't trust a stand clock that is far in the future.
    const readAt = Math.min(e.readAt, received);

    // The closure returns its result rather than pushing it, so a retried transaction cannot report an event twice.
    const result = await tx(db, async () => {
      const r = await resolveTap(db, cfg, { picc: e.picc, cmac: e.cmac, uid: e.uid });
      let status: string;
      let cupId: string | null = null;
      let reason: string | null = null;
      const uid = r.uid ?? null;
      if (!r.ok) {
        status = 'rejected';
        reason = r.reason;
      } else if (!r.cup) {
        status = 'unknown_cup';
      } else {
        cupId = r.cup.id;
        if (!r.cup.member_id) {
          status = 'unlinked_cup';
        } else {
          // Same cup re-placed on the same café's stand within the debounce window = one order.
          const dup = await data.nearbyReadOfCup(db, cupId, cafeId, readAt, cfg.debounceMs);
          status = dup ? 'duplicate' : 'pending';
        }
      }
      const seId = id('se');
      await data.insertStandEvent(db, {
        id: seId,
        clientEventId: e.eventId,
        standId,
        cafeId,
        cupId,
        uid,
        readAt,
        receivedAt: received,
        status,
        rejectReason: reason,
      });
      return { eventId: e.eventId, status, id: seId };
    });
    results.push(result);
  }
  return { results };
}

/** What the café tablet shows: open reads, newest first, with who the member is. */
export async function staffFeed(db: DB, cfg: Config, cafeId: string) {
  const since = now() - cfg.pendingTtlMs;
  const rows = await data.openReadsForCafe(db, cafeId, since);
  const goal = await cafeStampGoal(db, cafeId);
  const out = [];
  for (const r of rows) {
    const base = { id: r.id, status: r.status, readAt: r.readAt, rejectReason: r.rejectReason, uid: r.uid };
    if (!r.memberId) {
      out.push({ ...base, member: null });
      continue;
    }
    const lv = await lastVisitAtCafe(db, r.memberId, cafeId);
    const s = await stampBalance(db, r.memberId, cafeId);
    out.push({
      ...base,
      cup: { id: r.cupId, nickname: r.cupNickname, colourway: r.colourway },
      member: {
        id: r.memberId,
        name: r.memberName,
        preferences: JSON.parse(r.preferences ?? '{}'),
        stamps: s,
        stampGoal: goal,
        stampCardReady: s >= goal,
        lastVisitAt: lv?.created_at ?? null,
        recentVisit: !!lv && now() - lv.created_at < cfg.visitCooldownMs,
      },
    });
  }
  return out;
}

export async function confirmEvent(db: DB, cfg: Config, staff: { staffId: string; cafeId: string }, eventId: string) {
  return tx(db, async () => {
    const se = await data.eventWithMember(db, eventId);
    if (!se || se.cafe_id !== staff.cafeId) throw new HttpError(404, 'event_not_found');
    if (se.status !== 'pending') throw new HttpError(409, 'event_not_pending', `Event is ${se.status}`);
    if (!se.member_id) throw new HttpError(409, 'no_member');
    const v = await recordVisit(db, cfg, { memberId: se.member_id, cafeId: se.cafe_id, cupId: se.cup_id, source: 'stand', staffId: staff.staffId });
    await data.markEventConfirmed(db, se.id, v.visitId);
    return v;
  });
}

export async function dismissEvent(db: DB, staff: { cafeId: string }, eventId: string) {
  if ((await data.dismissOpenEvent(db, eventId, staff.cafeId)) === 0) throw new HttpError(404, 'event_not_found');
}
