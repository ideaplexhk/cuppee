// Counter stand: the bridge posts raw reads (batched, so an offline queue can replay),
// the café tablet polls the feed and staff confirm each read into a visit.

import type { DB } from '../db.ts';
import { tx } from '../db.ts';
import type { Config } from '../config.ts';
import { resolveTap } from './cups.ts';
import { recordVisit } from './loyalty.ts';
import { HttpError, id, now, sha256 } from '../lib/util.ts';

export type StandEventIn = {
  eventId: string;     // generated on the stand, stable across retries
  readAt: number;      // ms epoch on the stand's clock
  picc?: string;
  cmac?: string;
  uid?: string;
};

export function authStand(db: DB, standId: string | undefined, key: string | undefined) {
  if (!standId || !key) throw new HttpError(401, 'stand_auth');
  const s = db.prepare('SELECT id, cafe_id, key_hash FROM stands WHERE id = ?').get(standId) as { id: string; cafe_id: string; key_hash: string } | undefined;
  if (!s || s.key_hash !== sha256(key)) throw new HttpError(401, 'stand_auth');
  db.prepare('UPDATE stands SET last_seen_at = ? WHERE id = ?').run(now(), s.id);
  return { standId: s.id, cafeId: s.cafe_id };
}

export function ingestEvents(db: DB, cfg: Config, standId: string, cafeId: string, events: StandEventIn[]) {
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
    const existing = db.prepare('SELECT id, status FROM stand_events WHERE stand_id = ? AND client_event_id = ?').get(standId, e.eventId) as
      | { id: string; status: string }
      | undefined;
    if (existing) {
      results.push({ eventId: e.eventId, status: existing.status, id: existing.id });
      continue;
    }
    // Don't trust a stand clock that is far in the future.
    const readAt = Math.min(e.readAt, received);

    tx(db, () => {
      const r = resolveTap(db, cfg, { picc: e.picc, cmac: e.cmac, uid: e.uid });
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
          const dup = db
            .prepare("SELECT id FROM stand_events WHERE cup_id = ? AND cafe_id = ? AND status IN ('pending','confirmed') AND ABS(read_at - ?) < ? LIMIT 1")
            .get(cupId, cafeId, readAt, cfg.debounceMs);
          status = dup ? 'duplicate' : 'pending';
        }
      }
      const seId = id('se');
      db.prepare(
        'INSERT INTO stand_events (id, client_event_id, stand_id, cafe_id, cup_id, uid, read_at, received_at, status, reject_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(seId, e.eventId, standId, cafeId, cupId, uid, readAt, received, status, reason);
      results.push({ eventId: e.eventId, status, id: seId });
    });
  }
  return { results };
}

/** What the café tablet shows: open reads, newest first, with who the member is. */
export function staffFeed(db: DB, cfg: Config, cafeId: string) {
  const since = now() - cfg.pendingTtlMs;
  const rows = db
    .prepare(
      `SELECT se.id, se.status, se.read_at AS readAt, se.reject_reason AS rejectReason, se.uid,
              cu.id AS cupId, cu.nickname AS cupNickname, cu.colourway,
              m.id AS memberId, m.display_name AS memberName, m.preferences
       FROM stand_events se
       LEFT JOIN cups cu ON cu.id = se.cup_id
       LEFT JOIN members m ON m.id = cu.member_id
       WHERE se.cafe_id = ? AND se.read_at > ? AND se.status IN ('pending','unknown_cup','unlinked_cup','rejected')
       ORDER BY se.read_at DESC LIMIT 30`,
    )
    .all(cafeId, since) as Record<string, any>[];
  const lastVisit = db.prepare('SELECT created_at FROM visits WHERE member_id = ? AND cafe_id = ? ORDER BY created_at DESC LIMIT 1');
  const stampQ = db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM ledger WHERE member_id = ? AND cafe_id = ? AND unit = 'stamp'");
  const goal = (db.prepare('SELECT stamp_goal FROM cafes WHERE id = ?').get(cafeId) as { stamp_goal: number }).stamp_goal;
  return rows.map((r) => {
    const base = { id: r.id, status: r.status, readAt: r.readAt, rejectReason: r.rejectReason, uid: r.uid };
    if (!r.memberId) return { ...base, member: null };
    const lv = lastVisit.get(r.memberId, cafeId) as { created_at: number } | undefined;
    const s = (stampQ.get(r.memberId, cafeId) as { n: number }).n;
    return {
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
    };
  });
}

export function confirmEvent(db: DB, cfg: Config, staff: { staffId: string; cafeId: string }, eventId: string) {
  return tx(db, () => {
    const se = db
      .prepare('SELECT se.id, se.status, se.cafe_id, se.cup_id, cu.member_id FROM stand_events se LEFT JOIN cups cu ON cu.id = se.cup_id WHERE se.id = ?')
      .get(eventId) as { id: string; status: string; cafe_id: string; cup_id: string | null; member_id: string | null } | undefined;
    if (!se || se.cafe_id !== staff.cafeId) throw new HttpError(404, 'event_not_found');
    if (se.status !== 'pending') throw new HttpError(409, 'event_not_pending', `Event is ${se.status}`);
    if (!se.member_id) throw new HttpError(409, 'no_member');
    const v = recordVisit(db, cfg, { memberId: se.member_id, cafeId: se.cafe_id, cupId: se.cup_id, source: 'stand', staffId: staff.staffId });
    db.prepare("UPDATE stand_events SET status = 'confirmed', visit_id = ? WHERE id = ?").run(v.visitId, se.id);
    return v;
  });
}

export function dismissEvent(db: DB, staff: { cafeId: string }, eventId: string) {
  const r = db.prepare("UPDATE stand_events SET status = 'dismissed' WHERE id = ? AND cafe_id = ? AND status IN ('pending','unknown_cup','unlinked_cup','rejected')").run(eventId, staff.cafeId);
  if (r.changes === 0) throw new HttpError(404, 'event_not_found');
}
