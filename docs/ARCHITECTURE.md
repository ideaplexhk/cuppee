# CUPPEE membership: architecture (v0.1)

```
 Member phone (Expo app)            Café tablet (same app, staff mode)
   card QR · stamps · map              live stand feed · confirm · redeem
            │                                   │ polls 1 s
            └───────────────┬───────────────────┘
                            ▼
                 CUPPEE API  (server/, Node 22, SQLite)
                            ▲                    ▲
     POST /v1/stand/events  │                    │  POST /v1/pos/{provider}/webhook
                            │                    │
       Stand bridge (stand-bridge/)          Café POS (any, via adapter)
       ACR122U + cradle under the cup
```

## Pieces

| Folder | What | Runs on |
| --- | --- | --- |
| `server/` | API, SQLite database, NTAG 424 SUN verification, loyalty rules, POS adapters. No runtime dependencies. | Any Node 22.18+ host |
| `app/` | Expo (SDK 58) app. Member tabs: Card, Rewards, Cafés, Me. Staff mode for the counter tablet. | iOS / Android (dev build for NFC) |
| `stand-bridge/` | Reads the cup on the counter stand and posts events, queueing up to 100 when offline. | PC / mini PC / Raspberry Pi with the reader |

## Data layer (backlog M1.1)

All SQL lives in `server/src/data/`, one module per area: `identity` (OTP, sessions, members, staff), `cups`,
`loyalty` (cafés, menus, visits, ledger, rewards), `stand`, `pos` and `catalogue` (seed and set-up). Services,
routes and the seed script call these functions and never run SQL themselves; `server/test/data-layer.test.ts`
fails if they do. This is the seam for the move to PostgreSQL (M1.2, M1.3).

PostgreSQL schema (M1.2): `server/migrations/NNNN_name.sql`, applied in order by `server/src/migrate.ts`
(`DATABASE_URL=... node src/migrate.ts`). Each file runs in its own transaction and is recorded with a checksum in
`schema_migrations`; an applied file that is later edited is refused, so changes always go in a new file.
`0001_init.sql` matches the SQLite tables, with money as `NUMERIC(10,2)` and an `id` on `otp_codes`. The server
still runs on SQLite until the port (M1.3).

## Identity: how a cup proves it's real

- **Phase 1 cups (NTAG 424 DNA).** The chip serves a URL with a fresh encrypted UID + counter and a CMAC on every
  read (SUN). The server decrypts it, checks the CMAC and requires the counter to go up. A copied URL or a cloned
  UID is rejected (`replayed_tap`, `sun_required`). Verified against NXP AN12196's published example.
- **Phase 0 cups (NTAG 213 stickers).** UID only. Accepted while `ALLOW_UID_ONLY=1`; switch off once all cups are 424.
- **Fallback.** Laser-etched QR on the base (`cups.qr_code`) for linking, and a rotating member-card QR on the phone
  (new code every 30 s, generated offline) for visits without a cup.

## Loyalty model (proposal, all values per café in the seed file)

- **Stamps**: one per confirmed visit, per café. `stamp_goal` (default 9) → `stamp_reward` (café-funded).
- **Beans**: network points usable at any partner café. `beans_per_visit` (10) plus spend beans from the POS
  (1 per HK$10). Redeemed for network rewards (`rewards` table).
- **Anti-farming**: one award per member per café per 15 min (`VISIT_COOLDOWN_MINUTES`); the cup stand debounces
  re-placement within 30 s (`DEBOUNCE_SECONDS`), as in the prototype spec §3.4.
- Ledger is append-only; balances are sums, so every point can be traced to a visit, order or redemption.

## Stand flow (spec §3.4)

1. Cup lands → bridge reads it → `stand_events` row: `pending`, `duplicate`, `unknown_cup`, `unlinked_cup` or `rejected`.
2. Tablet shows pending reads with name, usual drink, stamps, and "stamp card complete" when due.
3. Staff **Confirm visit** → visit + stamp + beans. **Not this order** dismisses it.
4. Every read keeps timestamp, café, stand and confirmation state for KPIs.

Speed target from the spec: landing to on-screen ≤ 1.5 s. Polling at 1 s on shop Wi-Fi meets it; switch to
server-sent events if needed.

## Security notes before launch

- Replace dev secrets: `CARD_SECRET`, `POS_GENERIC_SECRET`, SDM keys (`NODE_ENV=production` refuses defaults).
- Real SMS provider for OTP (`server/src/lib/sms.ts`).
- HTTPS only (put the API behind a reverse proxy / managed host).
- Staff list endpoint is public so a tablet can pick a name; PINs are hashed (scrypt). Consider per-tablet pairing.
- Personal data (phone, preferences, visits): needs a privacy notice under Hong Kong's PDPO before launch.
