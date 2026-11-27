# CUPPEE backlog

Ordered. The agent takes the first `todo` task whose `Blocked by` questions (see `QUESTIONS.md`) are answered.
Status: `todo` · `doing` · `blocked` · `review` (PR open) · `done`. The owner may reorder or edit anything here.

## M0. Agent harness: make self-proof real

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M0.1 | Make `scripts/verify.sh` green | Installs deps, type-checks and tests `server/`, `stand-bridge/`, `app/`; exits non-zero on any failure; CI workflow runs it on every PR | | done |
| M0.2 | Pin app dependencies | Replace `*` versions in `app/package.json` with the Expo SDK 58 versions from `expo install --fix`; commit the lockfile | | done |
| M0.3 | Screenshot harness | `scripts/verify.sh --screens` serves the app on web, signs in with dev seed data, and saves PNGs of the screens in `scripts/screens.json` at 1280×800 and 1180×820, in `en` and `zh-HK` | M2.1 for the language part | review |

## M1. PostgreSQL (decision 2026-11-28)

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M1.1 | Data-access layer | All SQL goes through one module per area; services no longer import `node:sqlite` directly; tests unchanged and green | | todo |
| M1.2 | Postgres schema and migrations | Plain SQL migration files with a tiny runner; schema matches today's tables; `cafe_id` on every café-owned row | | todo |
| M1.3 | Port services and tests to Postgres | Server runs on `pg`; tests run against a real Postgres (CI service, local Docker or embedded); SQLite removed | M1.1, M1.2 | todo |
| M1.4 | Multi-café isolation tests | Tests prove staff of café A cannot read or change café B's data | M1.3 | todo |

## M2. Two languages

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M2.1 | i18n framework | All existing app strings moved to `en` and `zh-HK` files; language switch in member profile and staff mode; a test fails if a key is missing in either language | | todo |

## M3. POS core (counter service)

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M3.1 | Menu and modifiers model | Categories, items (EN/ZH names, price), modifier groups (required/optional, price deltas); API for staff to read; seed menu for CoHee | Q3 (menu) for real data; dev seed is fine without it | todo |
| M3.2 | Café mode setting | Each café is `counter` or `pos`; staff mode opens the matching screen | | todo |
| M3.3 | POS order screen | Category grid, one-tap modifiers sheet, cart, notes, takeaway/dine-in, totals; screenshots at both tablet sizes | M3.1, M3.2 | todo |
| M3.4 | Orders and offline outbox | Orders and lines saved on the tablet first with client UUIDs, synced to the API, idempotent retries; test that a retried sync never duplicates | M3.3 | todo |
| M3.5 | Cup tap attaches member | A stand read or QR scan attaches the member to the open order; tap with no open order starts one; double tap ignored; stamps and beans awarded on payment | M3.4 | todo |
| M3.6 | Cash payment and voids | Cash with change; void before close with manager PIN; append-only audit log | M3.4 | todo |

## M4. KPay payments

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M4.1 | Payment adapter + mock KPay terminal | `PaymentTerminal` interface; a mock terminal server that approves, declines, times out and drops the connection on request; POS flow tested against all four | M3.4 | todo |
| M4.2 | Manual KPay fallback | Barista records an amount, payment method and KPay reference when the link is down | M4.1 | todo |
| M4.3 | Real KPay terminal adapter | Implements KPay's LAN API (App ID/Secret, terminal IP) | Q1 (KPay spec) | blocked |

## M5. Printing

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M5.1 | Bar ticket printing | ESC/POS over LAN behind a `Printer` adapter with a mock that saves tickets as text for tests; EN/ZH item names | M3.4 | todo |

## M6. Online pickup orders (paid at the counter)

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M6.1 | Customer order page | Web page per café (link/QR), menu from M3.1, pickup time, phone sign-in for members, bilingual | M3.1, Q8 | todo |
| M6.2 | Live online queue on the tablet | Orders arrive by SSE/WebSocket within 2 s; Awaiting pickup list; café can pause online orders or add busy minutes | M6.1 | todo |
| M6.3 | Pickup and pay | Cup tap, QR or order number recalls the order into the till; paid through M4 | M6.2, M4.1 | todo |
| M6.4 | Expiry, no-shows, make-ahead | Unpaid orders expire; no-shows counted; make-ahead for members with a clean history | Q4 | blocked |
| M6.5 | Heartbeat | Order page shows the café as closed when its tablet has been offline > 60 s | M6.2 | todo |

## M7. Reader on the tablet

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M7.1 | Android USB reader | ACR122U read directly by the Android tablet, producing the same stand events as the bridge; bridge stays supported | M3.5 | todo |
| M7.2 | iPad reader option | Recommend and integrate a reader that works with iPad (e.g. a Bluetooth model) | Q9 | blocked |

## M8. Reports and CrewBook

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M8.1 | Daily reports | Sales, payment-method totals, top items, member sales, cash-up per café per day | M3.6, M4.1 | todo |
| M8.2 | CrewBook staff sync | Staff and roles come from CrewBook | Q2 (CrewBook API) | blocked |
| M8.3 | CrewBook till sync | Each shift's sales by payment method sent to CrewBook's till close | Q2 | blocked |

## M9. Counter mode and the KPay channel

| ID | Task | Acceptance criteria | Blocked by | Status |
| --- | --- | --- | --- | --- |
| M9.1 | Counter mode shows online orders | Online orders appear in Counter mode for keying into the café's own POS | M6.2 | todo |
| M9.2 | KPay channel perks | Perks applied at the KPay terminal for Counter-mode cafés | Q1, KPay partner approval | blocked |
