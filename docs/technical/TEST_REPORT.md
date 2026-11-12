# Test Report

| Field | Value |
|---|---|
| Document ID | VS-TST-001 |
| Document title | Test Report |
| Version | 1.0 |
| Status | Current |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | Commands executed on the development machine on 7 Nov 2026 (outputs quoted below) |

Related: [Requirements Traceability Matrix](../client/REQUIREMENTS_TRACEABILITY_MATRIX.md) · [Security Audit](SECURITY_AUDIT.md) · [Development Evidence](DEVELOPMENT_EVIDENCE.md)

## 1. Environment

| Item | Value |
|---|---|
| Runtime | Node.js 24.18.0 (Windows 10.0.26200) |
| Test runner | Node built-in `node --test --test-concurrency=1 "test/*.test.js"` (`npm test`) |
| Database | Throwaway PostgreSQL 18.6 cluster on `127.0.0.1:55432` (trust auth, in the user's temp folder). Each run creates `vishrea_ci_<pid>`, applies migrations 001–020 and the demo seed, and drops it afterwards. |
| Payment gateway | Local Razorpay stand-in (`test/helpers.js` `startGatewayMock`): orders, payments, capture, refunds, **plans, subscriptions, invoices**, issuing real HMAC-SHA256 signatures with test secrets |
| E-mail | Resend disabled (`RESEND_API_KEY` empty); messages are logged |
| Real third-party calls | None |

## 2. Executed commands and actual results

| # | Command | Result |
|---|---|---|
| 1 | `npm test` (start of audit) | 140 tests, 27 suites: **139 pass, 1 fail**, 0 skipped. Failure: *a repeated subscription charge allocates credits once* — 500 from the webhook (defect D-01, §5) |
| 2 | `npm test` × 2 (after the D-01 fix) | 140 / 140 pass, 0 skipped, both runs |
| 3 | `npm audit --omit=dev` | 1 high (`body-parser` < 1.20.9, GHSA-27r3-jxmh-p828) → `npm audit fix --omit=dev` → **0 vulnerabilities** |
| 4 | `npm test` (after the dependency fix) | **140 / 140 pass**, 27 suites, 0 fail, 0 cancelled, 0 skipped, 0 todo, 42.8 s |
| 5 | `npm audit` in `vishrea-react/` | 0 vulnerabilities |
| 6 | `npx oxlint` in `vishrea-react/` (`npm run lint`) | **0 errors, 29 warnings** (React hook dependency, refs during render, setState in effect) |
| 7 | `node --check` on all 59 back-end files (`api/`, `lib/`, `scripts/`, `server.js`) | 0 failures |
| 8 | `npm run build:client` | Vite build succeeded |
| 9 | Type checking | Not applicable — the project is JavaScript without TypeScript or JSDoc type checking |
| 10 | Migration verification | Every test run applies 001–020 to an empty database; `migration-rehearsal.test.js` applies 015–017 to a live-shaped legacy schema and re-runs them; staging database: 20/20 applied |
| 11 | `npm test`, `npm run build:client`, `npm run migrate` (after migration 020 and the Drops copy fix) | 140/140 pass, 0 skipped; build succeeded; staging 20/20 migrations, 0 tables without RLS |
| 12 | Staging read-only checks | RLS enabled on all tables; no table readable by `anon`/`authenticated`; public APIs return no cost price or supplier |

## 3. Coverage by test file

| File | Tests | Covers |
|---|---|---|
| `platform.test.js` | 48 | OTP sign-in, sessions, access control, server pricing and GST, one-of-one races, payment verification, webhooks, late/duplicate payments, refunds and reconciliation, credits, admin catalogue, CSV export, uploads, exchanges, end-to-end journey, headers, rate limiting |
| `remediation.test.js` | 48 | Membership billing engine (upfront + mandate, monthly debits, retries, halt, recovery, pause, cancel, UPI-app cancellation, forged webhooks), 8-credit limit, 6th-month reward, referrals, reward refund reversal, gift enquiries, settings, legal publication, admin filters, dashboard, customer drill-down |
| `walkin-wardrobe.test.js` | 10 | Wardrobe Bag (₹99 / free / pickup), 48 h early access, online gifts (both modes), ₹50 gift packing, account deletion, admin export permissions, notification log |
| `pricing.test.js` | 10 | Unit: sale price, GST slab, cart totals, paise rounding, membership price, reward eligibility, credit FIFO expiry, video caps, upload sniffing |
| `production.test.js` | 8 | HTTPS redirect, HSTS/CSP, OTP never echoed, error hygiene, robots, startup guards, remote-database guard |
| `seo.test.js` | 7 | Server-rendered meta, Product/FAQ schema, canonical URLs, 404s, noindex, sitemap |
| `notify.test.js` | 4 | Dispatch and sign-in e-mails through a stubbed Resend |
| `razorpay-gateway.test.js` | 2 | Gateway client order/capture/refund; safe 502s |
| `razorpay-signature.test.js` | 2 | Payment and webhook HMAC verification |
| `migration-rehearsal.test.js` | 1 | Migrations 015–017 on a legacy-shaped schema |
| **Total** | **140** | |

Requirement-level mapping is in the Traceability Matrix ("Test status" column).

## 4. Not tested (and why)

| Area | Why it cannot be tested here | What is needed |
|---|---|---|
| Live Razorpay (orders, Subscriptions, UPI Autopay, retries, pause/resume, mandate cancellation from a UPI app) | Only a local stand-in is available; Subscriptions are not enabled on the account | Sandbox keys with Subscriptions; manual rehearsal (Release Checklist §3) |
| E-mail delivery (Resend) | Disabled in tests by design | Verified sender domain; send test |
| WhatsApp | No provider integrated | WhatsApp Business API |
| Camera colour analysis on real phones | Needs devices | Manual on Android Chrome and iPhone Safari |
| Browser end-to-end flows | No automated browser suite | Manual QA (last full round 5 Nov 2026, `../archive/2026-11-05-remediation-audit/VISHREA_UI_UX_FUNCTIONAL_AUDIT.md`); new screens (Membership, Wardrobe Bag, Gifting, Account preferences/deletion) built and rendered on 7 Nov but not walked through end to end |
| Performance (NFR-01) and load (NFR-02) | Needs a deployed environment | Lighthouse on 4G profile; load test |
| Backups and restore | Hosting-provider feature | Restore drill |
| Vulnerability scan / penetration test (SEC-07) | Needs a deployed environment and an external tool | Scan before go-live |

## 5. Defects found during this audit

| ID | Defect | Severity | Found by | Fix | Verified by |
|---|---|---|---|---|---|
| D-01 | Two concurrent deliveries of the same `subscription.charged` event could fail with HTTP 500: the insert de-duplicated on payment id only, while a second unique index (Razorpay invoice id) raised a violation. Razorpay would retry, so no double charge, but the event errored. | Medium | `npm test` run 1 | `lib/billing.js` `applyRecurringCharge`: `ON CONFLICT DO NOTHING` (any unique constraint) | `npm test` runs 2–4 (140/140) |
| D-02 | `body-parser` < 1.20.9 (via Express) vulnerable to denial of service through trailing bytes after a compressed body | High (dependency) | `npm audit` | `npm audit fix --omit=dev` → body-parser 1.20.9 (lockfile only) | `npm audit` 0; `npm test` 140/140 |
