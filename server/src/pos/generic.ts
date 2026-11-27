// "generic" adapter: CUPPEE's own documented webhook format (docs/POS_INTEGRATION.md).
// Any POS, middleware (Zapier/Make) or a café's own script can post this.
//
// Header:  X-Cuppee-Signature: sha256=<hex HMAC-SHA256 of the raw body with the shared secret>
// Body:    { "orders": [ { "id", "location_id", "created_at" (ISO or ms), "total", "status",
//                          "member_ref"?, "items": [ { "name", "qty", "price", "sku"?, "modifiers"? } ] } ] }

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NormalizedOrder, PosAdapter, WebhookRequest } from './types.ts';

function header(req: WebhookRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export const genericAdapter: PosAdapter = {
  name: 'generic',

  verify(req, secret) {
    const sig = header(req, 'x-cuppee-signature');
    if (!sig?.startsWith('sha256=') || !secret) return false;
    const want = createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(sig.slice(7));
    const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parse(req) {
    const body = JSON.parse(req.rawBody);
    const list: any[] = Array.isArray(body?.orders) ? body.orders : [];
    return list.map((o): NormalizedOrder => {
      if (!o?.id || !o?.location_id) throw new Error('order.id and order.location_id are required');
      const at = typeof o.created_at === 'number' ? o.created_at : Date.parse(o.created_at);
      if (!Number.isFinite(at)) throw new Error(`order ${o.id}: bad created_at`);
      return {
        externalId: String(o.id),
        locationRef: String(o.location_id),
        orderedAt: at,
        totalHkd: Number(o.total) || 0,
        status: o.status === 'refunded' || o.status === 'void' ? o.status : 'paid',
        memberRef: o.member_ref ? String(o.member_ref) : undefined,
        items: (Array.isArray(o.items) ? o.items : []).map((i: any) => ({
          name: String(i.name ?? ''),
          qty: Number(i.qty ?? 1),
          priceHkd: Number(i.price ?? 0),
          posItemRef: i.sku ? String(i.sku) : undefined,
          modifiers: Array.isArray(i.modifiers) ? i.modifiers.map(String) : undefined,
        })),
      };
    });
  },
};
