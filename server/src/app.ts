import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { DB } from './db.ts';
import type { Config } from './config.ts';
import type { SmsSender } from './lib/sms.ts';
import { HttpError, safeEq } from './lib/util.ts';
import { authenticate, logout, requestOtp, staffLogin, verifyOtp, type Principal } from './services/auth.ts';
import { linkCup, listCups, unlinkCup } from './services/cups.ts';
import { parseSunUrl } from './lib/sun.ts';
import { CARD_WINDOW_MS, cardKeyFor, verifyCardCode } from './services/card.ts';
import { listCafes, listRewards, memberSummary, recordVisit, redeemReward, redeemStampCard, stamps, beans, getCafe } from './services/loyalty.ts';
import { authStand, confirmEvent, dismissEvent, ingestEvents, staffFeed } from './services/stand.ts';
import { counterMember, handleWebhook } from './pos/index.ts';
import { tx } from './db.ts';
import { memberForStaff, memberPreferencesJson, setMemberDisplayName, setMemberPreferencesJson, staffList } from './data/identity.ts';

type Ctx = {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  rawBody: string;
  principal: Principal | null;
};
type Handler = (c: Ctx) => unknown | Promise<unknown>;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { method, re, keys, handler };
}

function member(c: Ctx) {
  if (c.principal?.kind !== 'member') throw new HttpError(401, 'login_required');
  return c.principal;
}
function staff(c: Ctx) {
  if (c.principal?.kind !== 'staff') throw new HttpError(401, 'staff_login_required');
  return c.principal;
}

/** Accept a tap from the app as a full SUN URL, its parts, a UID or an etched QR. */
function tapFromBody(b: any) {
  if (typeof b?.url === 'string') {
    const p = parseSunUrl(b.url);
    if (p) return { picc: p.picc, cmac: p.cmac };
  }
  return { picc: b?.picc, cmac: b?.cmac, uid: b?.uid, qr: b?.qr };
}

export function buildRoutes(db: DB, cfg: Config, sms: SmsSender): Route[] {
  return [
    route('GET', '/health', () => ({ ok: true })),

    // ---- member auth
    route('POST', '/v1/auth/otp/request', (c) => requestOtp(db, cfg, sms, c.body?.phone)),
    route('POST', '/v1/auth/otp/verify', (c) => verifyOtp(db, c.body?.phone, c.body?.code, c.body?.displayName)),
    route('POST', '/v1/auth/logout', async (c) => (await logout(db, c.req.headers.authorization), { ok: true })),

    // ---- member
    route('GET', '/v1/me', (c) => memberSummary(db, member(c).memberId)),
    route('PATCH', '/v1/me', async (c) => {
      const { memberId } = member(c);
      const name = typeof c.body?.displayName === 'string' ? c.body.displayName.trim().slice(0, 40) : undefined;
      const prefs = c.body?.preferences && typeof c.body.preferences === 'object' ? c.body.preferences : undefined;
      if (name !== undefined) await setMemberDisplayName(db, memberId, name || null);
      if (prefs) {
        const cur = JSON.parse(await memberPreferencesJson(db, memberId));
        const allowed = ['drink', 'milk', 'sweetness', 'temperature', 'notes'];
        for (const k of allowed) if (k in prefs) cur[k] = String(prefs[k]).slice(0, 80);
        await setMemberPreferencesJson(db, memberId, JSON.stringify(cur));
      }
      return memberSummary(db, memberId);
    }),
    // The app derives rotating QR codes locally from this key, so the card works offline.
    route('GET', '/v1/me/card', (c) => {
      const { memberId } = member(c);
      return { memberId, cardKey: cardKeyFor(cfg.cardSecret, memberId), windowMs: CARD_WINDOW_MS, serverTime: Date.now() };
    }),
    route('GET', '/v1/me/cups', (c) => listCups(db, member(c).memberId)),
    route('POST', '/v1/me/cups', (c) => tx(db, () => linkCup(db, cfg, member(c).memberId, tapFromBody(c.body), c.body?.nickname))),
    route('DELETE', '/v1/me/cups/:id', async (c) => (await unlinkCup(db, member(c).memberId, c.params.id), { ok: true })),

    // ---- public catalogue
    route('GET', '/v1/cafes', () => listCafes(db)),
    route('GET', '/v1/rewards', () => listRewards(db)),

    // ---- staff (café tablet)
    route('GET', '/v1/staff/cafes/:cafeId/staff', (c) => staffList(db, c.params.cafeId)),
    route('POST', '/v1/staff/login', (c) => staffLogin(db, c.body?.cafeId, c.body?.staffId, c.body?.pin)),
    route('GET', '/v1/staff/feed', async (c) => {
      const s = staff(c);
      return { cafe: { id: s.cafeId, name: (await getCafe(db, s.cafeId)).name }, events: await staffFeed(db, cfg, s.cafeId), serverTime: Date.now() };
    }),
    route('POST', '/v1/staff/events/:id/confirm', (c) => confirmEvent(db, cfg, staff(c), c.params.id)),
    route('POST', '/v1/staff/events/:id/dismiss', async (c) => (await dismissEvent(db, staff(c), c.params.id), { ok: true })),
    // Fallback when a member has no cup with them: scan the QR on their phone.
    route('POST', '/v1/staff/card/lookup', async (c) => {
      const s = staff(c);
      const memberId = verifyCardCode(cfg.cardSecret, c.body?.code);
      if (!memberId) throw new HttpError(400, 'card_expired', 'Card code expired. Ask the member to refresh.');
      const m = (await memberForStaff(db, memberId))!;
      const cafe = await getCafe(db, s.cafeId);
      const st = await stamps(db, memberId, s.cafeId);
      return { member: { ...m, preferences: JSON.parse(m.preferences) }, stamps: st, stampGoal: cafe.stamp_goal, stampCardReady: st >= cafe.stamp_goal, beans: await beans(db, memberId) };
    }),
    route('POST', '/v1/staff/visits', (c) => {
      const s = staff(c);
      const memberId = verifyCardCode(cfg.cardSecret, c.body?.code);
      if (!memberId) throw new HttpError(400, 'card_expired');
      return tx(db, () => recordVisit(db, cfg, { memberId, cafeId: s.cafeId, source: 'card_qr', staffId: s.staffId }));
    }),
    route('POST', '/v1/staff/redeem/stamp-card', (c) => {
      const s = staff(c);
      return tx(db, () => redeemStampCard(db, String(c.body?.memberId), s.cafeId, s.staffId));
    }),
    route('POST', '/v1/staff/redeem/reward', (c) => {
      const s = staff(c);
      return tx(db, () => redeemReward(db, String(c.body?.memberId), s.cafeId, String(c.body?.rewardId), s.staffId));
    }),
    route('GET', '/v1/staff/member/:id/balances', async (c) => {
      const s = staff(c);
      const cafe = await getCafe(db, s.cafeId);
      const st = await stamps(db, c.params.id, s.cafeId);
      return {
        stamps: st,
        stampGoal: cafe.stamp_goal,
        stampCardReady: st >= cafe.stamp_goal,
        stampReward: cafe.stamp_reward,
        beans: await beans(db, c.params.id),
        rewards: await listRewards(db),
      };
    }),

    // ---- counter stand bridge
    route('POST', '/v1/stand/events', async (c) => {
      const s = await authStand(db, c.req.headers['x-stand-id'] as string, c.req.headers['x-stand-key'] as string);
      return ingestEvents(db, cfg, s.standId, s.cafeId, c.body?.events);
    }),

    // ---- POS
    route('POST', '/v1/pos/:provider/webhook', (c) => handleWebhook(db, cfg, c.params.provider, { headers: c.req.headers, rawBody: c.rawBody })),
    route('GET', '/v1/pos/:provider/counter', (c) => {
      const secret = cfg.posSecrets[c.params.provider] ?? '';
      const key = String(c.req.headers['x-cuppee-key'] ?? '');
      if (!secret || !safeEq(key, secret)) throw new HttpError(401, 'bad_key');
      return counterMember(db, c.params.provider, c.query.get('location') ?? '');
    }),
  ];
}

const MAX_BODY = 256 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (ch: Buffer) => {
      size += ch.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'body_too_large'));
        req.destroy();
      } else chunks.push(ch);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-stand-id, x-stand-key, x-cuppee-key, x-cuppee-signature',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

export function createApp(db: DB, cfg: Config, sms: SmsSender) {
  const routes = buildRoutes(db, cfg, sms);
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, undefined);
      const url = new URL(req.url ?? '/', 'http://localhost');
      let matched: Route | undefined;
      let m: RegExpExecArray | null = null;
      let pathMatched = false;
      for (const r of routes) {
        m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) {
          matched = r;
          break;
        }
      }
      if (!matched || !m) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
      const params: Record<string, string> = {};
      matched.keys.forEach((k, i) => (params[k] = decodeURIComponent(m![i + 1])));
      const rawBody = req.method === 'GET' ? '' : await readBody(req);
      let body: any = {};
      if (rawBody && String(req.headers['content-type'] ?? '').includes('json')) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new HttpError(400, 'bad_json');
        }
      }
      // One serializable transaction per request (see db.ts): the request either happens whole or not at all, and
      // concurrent requests behave as if they ran one after another, as they did on SQLite.
      const handler = matched.handler;
      // An HttpError still commits what the handler wrote before it (a counted wrong OTP attempt), as on SQLite;
      // routes that must be all-or-nothing wrap their work in tx(), which undoes it on any error.
      const out = await tx(
        db,
        async () => {
          const principal = await authenticate(db, req.headers.authorization);
          return handler({ req, params, query: url.searchParams, body, rawBody, principal });
        },
        { commitOn: (e) => e instanceof HttpError },
      );
      send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      send(res, 500, { error: 'server_error' });
    }
  });
}
