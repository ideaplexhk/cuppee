# CUPPEE direction

Owner: Solee. The build agent reads this first on every run. Decisions here override every other document.

## What we are building

CUPPEE is the membership cup for Hong Kong's independent specialty cafés. A customer owns a design-led cup with an
NFC tag; they land it on the counter stand at any partner café, the barista sees who they are and their usual order,
and their stamps, beans and perks apply.

For cafés, CUPPEE launches together with **CrewBook** (crewbookhk.com: rosters, payroll, till close) as one product
family. CrewBook runs the staff and the money count; CUPPEE runs customers and the counter.

## The café software: one app, two modes

| | CUPPEE Counter (console) | CUPPEE POS (full) |
| --- | --- | --- |
| For | Cafés that keep their own POS | CoHee, new cafés, cafés that want to switch |
| Cup check-in, usual order, stamps, beans, perks | Yes | Yes |
| Online pickup orders | Shown on the tablet; barista keys them into their POS | Land in the till, ready to pay |
| Payment | Café's own POS; KPay channel later if KPay allows partner perks | KPay terminal, integrated over the shop LAN |
| Receipts, bar tickets, reports | Their POS | Yes |
| CrewBook till sync | Member and perk totals | Full sales by payment method |
| Price | Free | Free |

The POS is deliberately simple and free. Its job is to bring new cafés into the network, not to out-feature
Eats365 or iChef. Existing cafés with their own POS are the first market; new cafés are the later market.

## v1 POS scope

Counter service only: menu, categories, modifiers (size, milk, sugar, ice, extra shot), cart, takeaway or dine-in,
cash and KPay payment, manual KPay entry as fallback, void before settlement, bar ticket printing, daily sales and
payment-method totals, staff PIN login with roles. Online pickup orders paid at the counter.

Not in v1: tables, split bills, delivery platforms, inventory, kitchen display, online prepayment, stored value.

## Online orders

Customers order ahead on a web page (no app needed) and pay on the KPay terminal at pickup. Default: the drink is made
after check-in and payment. Members with a clean history may have it made ahead; no-shows switch that off for them.
Exact numbers (expiry time, no-show limit) are open questions.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-11-27 | Payments go through the café's KPay terminal in integrated mode; CUPPEE never touches card data. |
| 2026-11-27 | No stored value or multi-café wallet at launch. |
| 2026-11-27 | The cup is the membership card: NFC (NTAG 424 DNA with SUN) on a counter reader, QR on the cup or in the app, phone number as fallback. Not long-range UHF RFID. |
| 2026-11-27 | One app, two modes (Counter console and full POS); POS is free and simple. |
| 2026-11-27 | Launch bundled with CrewBook. Integration order: CrewBook, then the KPay channel, then the 2–3 most common POS systems from a survey of CrewBook customers. |
| 2026-11-27 | Online orders are paid at the counter in v1; prepay through KPay later. |
| 2026-11-28 | First build target: POS v1 code, extending the existing membership repo (not a new repo). |
| 2026-11-28 | Database: move to PostgreSQL now (from Node's built-in SQLite). |
| 2026-11-28 | Loyalty stays as stamps per café (café-funded) plus beans (network points). |
| 2026-11-28 | Counter stand: support both a reader plugged straight into the Android tablet and the separate stand bridge. |
| 2026-11-28 | Target both Android tablets and iPads from the start. |
| 2026-11-28 | Languages: English and Traditional Chinese (Hong Kong), switchable. |
| 2026-11-28 | Agent works in a GitHub repo through pull requests, decides code details itself and asks on product calls. |
| 2026-11-28 | The agent merges its own PRs when CI is green on the current head and the reviewer has passed that exact commit (CLAUDE.md step 9). Changes to the agent's own rules, gates or the owner's decisions (CLAUDE.md, .claude/, DIRECTION, QUESTIONS, BACKLOG except a task's own Status cell, scripts/, .github/, tsconfigs, package.json scripts) always wait for the owner. Product calls still go to the owner. |
| 2026-11-28 | Runs back-to-back overnight: hourly from 23:00 to 07:00 HK time, plus on demand. |
| 2026-11-28 | Self-proof: automated tests and type checks, screenshots of changed screens, and an independent reviewer agent on every PR. |

## Rollout (from the blueprint)

| Phase | When | What |
| --- | --- | --- |
| 0. Foundations | Dec 2026 – Jan 2027 | KPay agreement and test terminal, CrewBook customer survey, tag wash tests, v1 build |
| 1. CoHee pilot | Feb – Apr 2027 | Full POS at CoHee shops, 30–50 cup beta, online pickup orders |
| 2. First wave | May – Jul 2027 | 5–10 cafés on the Counter console with CrewBook |
| 3. Scale | Aug – Dec 2027 | Free POS for new cafés, first POS integrations, production cups |

The agent's backlog is ordered so that everything Phase 1 needs is ready by February 2027.
