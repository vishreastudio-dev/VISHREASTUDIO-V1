# Changelog

| Field | Value |
|---|---|
| Document ID | VS-CHG-001 |
| Document title | Changelog |
| Version | 1.0 |
| Status | Current |
| Prepared date | 7 November 2026 |
| Last updated | 11 November 2026 |
| Source of truth | Working tree changes (`git status`, `git diff`) and the session record of 7 Nov 2026 |

Dates are when the change was made in the working tree. None of the entries below is committed or deployed yet.

## 11 November 2026 — Test payments stay on the local stand-in

### Changed
- Product checkout, gift membership checkout, and Wardrobe Bag shipping now follow the server’s payment mode. When the server is pointed at the local stand-in, the browser shows a local confirm / fail / cancel sheet and does not open Razorpay’s website.
- Membership checkout already did this on 11 November.

### Not changed
- The membership on sale is still ₹3,598 for 2 months, then ₹1,799 a month by UPI Autopay. A 6-month prepay with no autopay is not switched on. That needs the owner’s written decision before any customer mandate is touched.

## 7 November 2026 — Optimization, couriers and sold-out badges

Details: [../PROJECT_STATUS.md](../PROJECT_STATUS.md) and [../IMPLEMENTATION_CHANGELOG.md](../IMPLEMENTATION_CHANGELOG.md).

### Changed for customers
- "Request a Piece" removed from the website and the admin panel (past requests are kept in the database, not shown).
- Pieces with no stock show a **SOLD OUT** badge on every listing and the product page; a size that is gone is disabled while other sizes stay buyable.
- The homepage loads its new arrivals and content reliably, with no duplicate or cancelled requests; the site downloads about 74 % less JavaScript/CSS, and busy periods are handled about twice as fast in local load tests.
- Order tracking links come from the courier chosen at dispatch.

### Changed for the studio
- **Admin → Couriers**: add, edit, search, activate/deactivate and (if never used) delete courier companies, with tracking URL templates — no code change needed for a new courier.
- Dispatch offers the active couriers, previews the customer's tracking link and shows the order's shipment history.

### Needs approval
- Database migration `021_courier_management.sql` (staging, then production) before this version is deployed.

## 7 November 2026 — Master audit and documentation pass

### Fixed
- **D-01** `lib/billing.js` `applyRecurringCharge`: concurrent duplicate `subscription.charged` deliveries could return HTTP 500 (unique invoice index) — insert now ignores any duplicate (`ON CONFLICT DO NOTHING`).
- **D-02** `package-lock.json`: `body-parser` 1.20.9 (was < 1.20.9; GHSA-27r3-jxmh-p828, high) via `npm audit fix --omit=dev`.

### Added after the per-area audits
- `migrations/020_rls_all_tables.sql`: explicit RLS and Supabase-role revoke for every public table (tables from 014–019 previously relied on hosting defaults). Applied to staging.
- `scripts/generate-checklist.js`: regenerates `docs/client/IMPLEMENTATION_CHECKLIST.md` from the traceability matrix.
- `vishrea-react/src/pages/Admin.jsx`: Drops panel text no longer claims early access is unenforced.
- Matrix revised on new evidence: CUS-01 → BACKEND ONLY; EXC-01, BO-05, SHP-13, SEC-02 → PARTIALLY IMPLEMENTED; extra remaining work for CAT-01, SHP-01, SHP-07, INV-01, CAT-08, ADM-03. Security findings S-16 (possible credentials in git history), S-17 (fixed), S-18, S-19 added.

### Added (documentation, `docs/`)
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` (VS-REQ-001), `IMPLEMENTATION_CHECKLIST.md` (VS-DEV-001), `GAP_ANALYSIS.md` (VS-GAP-001), `../technical/DEVELOPMENT_EVIDENCE.md` (VS-EVD-001), `../technical/TECHNICAL_ARCHITECTURE.md` (VS-ARC-001), `../technical/DATABASE_SCHEMA.md` (VS-DB-001), `../technical/API_DOCUMENTATION.md` (VS-API-001), `../technical/TEST_REPORT.md` (VS-TST-001), `../technical/SECURITY_AUDIT.md` (VS-SEC-001), `CLIENT_DECISIONS_REQUIRED.md` (VS-DEC-001), `CHANGELOG.md` (VS-CHG-001), `PROJECT_STATUS.md` (VS-PRJ-001), `RELEASE_CHECKLIST.md` (VS-REL-001), `docs/README.md` (index).

### Changed (documentation)
- `README.md` (root) rewritten to match the code (stack, setup, testing, configuration, documentation index).
- Superseded-content notices added at the top of `../archive/SYSTEM_FLOW_AND_CHECKLIST.md`, `docs/archive/2026-11-05-remediation-audit/verification-checklist.md` and `docs/specifications/README.md` (the latter now lists both client documents).

## 7 November 2026 — Walkin Wardrobe billing engine and selected features

- Membership billing on Razorpay Subscriptions: ₹3,598 upfront with the UPI Autopay mandate, ₹1,799 monthly from month 3; retries → credits frozen → pause; recovery mandate; one-month pause; cancellation after lock-in; UPI-app cancellation (`lib/billing.js`, `api/membership.js`, webhook handlers, migration 019).
- 8-credit holding limit (`enforceHoldingLimit`); credits frozen during retries (`creditsUsable`).
- Wardrobe Bag: credit picks held as `in_bag` orders; "Ship my bag" free for 4+, ₹99 otherwise, free pickup (`lib/bag.js`).
- 48-hour member early access enforced in catalogue, product page, cart, checkout and sitemap.
- Online gift memberships: "Gift to her" and "I'll pick for her", pre-booked 2/3/6/12 months.
- Central notification service with preferences, consent and a log (`lib/notify.js`); order, exchange, refund, membership and reminder e-mails.
- Account: notification preferences; self-service deletion that stops billing and revokes sessions.
- Damage claims require photos; membership payments/attempts/bag exports; stock adjustment audit.
- Settings: lock-in, holding limit, pause length, retry policy, mandate length; 6-month prepaid sign-up retired.
- Tests: 140 (new `walkin-wardrobe.test.js`; membership tests rewritten for autopay).

## 7 November 2026 — Membership and referral rule correction (migration 018)

- 6th-month free piece follows consecutive paid months (prepaid or continued), repeating every 6; pause and missed payment reset the count.
- Referrer reward on the friend's first membership payment of any duration; ₹150 discount on the 2-month membership; backfill of missed referrer rewards.

## 5 November 2026 and earlier

See `docs/archive/2026-11-05-remediation-audit/VISHREA_AUDIT_REMEDIATION_REPORT.md` (remediation, business decisions BD-1…BD-8, 126/126 tests at the time) and `docs/archive/2026-11-02-production-audit/PRODUCTION_AUDIT.md` (2 Nov). Git history: 7 commits up to `18aae1d`.
