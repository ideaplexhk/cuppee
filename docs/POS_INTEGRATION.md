# POS integration

The POS for CoHee, For Single and Pow Pow is **not chosen yet**, so CUPPEE talks to POS systems through
a neutral adapter layer. Nothing in the membership app depends on a specific POS.

## What the POS link adds

Without a POS, the stand + tablet flow already works: a cup lands, staff tap **Confirm visit**, the member
gets a stamp and beans. A POS link adds:

| With POS | Why it matters |
| --- | --- |
| Spend-based beans (default 1 bean per HK$10, per café) | Rewards big orders, not just visits |
| Real drink history (`lastOrder`) shown on the tablet | "Your usual?" without the member typing it |
| Refunds/voids reverse the spend beans | Ledger stays honest |
| Order-to-visit data for KPIs | Visits, spend per member, repeat rate per café |

## Two directions

```
 POS ──(1) order webhook──▶ CUPPEE   POST /v1/pos/{provider}/webhook
 POS ◀─(2) who's at counter── CUPPEE GET  /v1/pos/{provider}/counter?location={id}
```

1. **Order webhook (required).** After each paid order, refund or void, the POS (or middleware) posts it to CUPPEE.
2. **Counter lookup (optional).** A POS that can call out asks "which member's cup is on the stand right now?"
   and attaches `member_ref` to the order, so matching is exact instead of time-based.

## How an order is matched to a member

1. `member_ref` on the order: a scanned CUPPEE card code (`CUPPEE1.…`), a member id (`mem_…`) or a phone number.
2. Otherwise: the **single** confirmed visit at that café within ±10 minutes (`POS_MATCH_WINDOW_MINUTES`)
   that has no order yet.
3. Two or more candidates → left **unmatched**. CUPPEE never guesses between two customers.

A member identified only at the POS (no stand visit) gets a visit recorded from the order.

## The `generic` adapter (use this first)

Any POS export, Zapier/Make scenario or small script can send this format.

```http
POST /v1/pos/generic/webhook
Content-Type: application/json
X-Cuppee-Signature: sha256=<hex HMAC-SHA256 of the raw body, key = POS_GENERIC_SECRET>

{
  "orders": [{
    "id": "r-1001",                     // unique per POS, reused for refunds
    "location_id": "cohee-01",          // = cafes.pos_location_ref
    "created_at": "2026-11-27T09:12:00+08:00",
    "total": 52,                        // HK$ paid
    "status": "paid",                   // paid | refunded | void
    "member_ref": "CUPPEE1.mem_…",      // optional
    "items": [{ "name": "Flat white", "qty": 1, "price": 52, "sku": "FW", "modifiers": ["Oat milk"] }]
  }]
}
```

Response per order: `matched` / `unmatched` / `duplicate` / `reversed` / `unknown_location` / `ignored_unpaid`.
Resending the same order id is safe.

Counter lookup:

```http
GET /v1/pos/generic/counter?location=cohee-01
X-Cuppee-Key: <POS_GENERIC_SECRET>
→ { "member": { "memberId": "mem_…", "name": "Kit", "status": "confirmed", "readAt": 1795794591725 } | null }
```

## Adding a real POS later

1. Create `server/src/pos/<name>.ts` implementing `PosAdapter` (`server/src/pos/types.ts`):
   - `verify(req, secret)`: check that POS's webhook signature.
   - `parse(req)`: map its payload to `NormalizedOrder[]`.
2. Register it in `server/src/pos/index.ts` and add its secret to `config.ts` (`posSecrets`).
3. Set `pos_provider` and `pos_location_ref` for each café in `server/seed/seed-data.json`.
4. Add a test with a captured real webhook body.

Questions to ask each candidate POS (Eats365, Loyverse, iCHEF, Square, etc.):

- Does it send a webhook per order and refund? If not, can it export via API on a schedule?
- Can it show a third-party customer/loyalty id on the order, or call an external URL at checkout?
- Does it expose item modifiers (milk, sugar) in the webhook?
- Per-location ids for multi-café groups?
- Cost of API access on the plan each café would use.

If a POS can only export, a small scheduled job can poll it and call `ingestOrder()` with the same `NormalizedOrder` shape.

## Payments

Out of scope on purpose. A multi-café prepaid wallet is stored value under HKMA rules. Payment stays on each
café's own POS/terminal; CUPPEE only reads the result. Revisit with a licensed SVF partner if needed.
