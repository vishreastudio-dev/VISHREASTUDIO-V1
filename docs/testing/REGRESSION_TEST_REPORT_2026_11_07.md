# Regression Test Report

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Command | `npm test` (`node --test --test-concurrency=1 "test/*.test.js"`) |
| Database | Throwaway local PostgreSQL 18 on `127.0.0.1:55432`; a fresh database per run, all migrations applied, demo catalogue seeded. The staging database was **not** used |
| Payments | In-process Razorpay stand-in issuing real HMAC signatures (no network) |

## 1. Results

| Run | When | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|---|
| Baseline (before any change) | start of work | 140 | 140 | 0 | 0 |
| Final (all changes) | end of work | **151** | **151** | 0 | 0 |

Front end: `vite build` succeeds; `oxlint` reports warnings only (no errors), the same categories as before.

## 2. Suites (final run)

| File | Tests | Covers |
|---|---|---|
| `platform.test.js` | 48 | Sign-in/OTP, access control, pricing and checkout, payment verification and refunds, races for the last unit, membership and credits, admin catalogue, uploads, exchanges, tracked dispatch journey, transport security, retired Request a Piece API |
| `remediation.test.js` | 48 | Membership lifecycle (₹3,598 upfront with UPI Autopay mandate, ₹1,799 from month 3, retries/freeze/pause/recovery, lock-in cancellation, mandate cancel from UPI app), 8-credit limit and expiry, 6th-month free piece, referrals (₹150 discount, one reward, refund revocation), gift enquiries and codes, security fixes |
| `walkin-wardrobe.test.js` | 10 | Wardrobe Bag (₹99 below 4 pieces, free at 4+, pickup free), 48-hour early access, online gifts (no autopay, ₹50 packing), account deletion, notifications |
| `couriers-inventory.test.js` (**new**) | 8 | Courier seed, authorization (401/403), validation and uniqueness, dispatch with stored link, history preserved after template edit and deactivation, deactivated courier not selectable, delete only when unused, studio pickup, sold-out/restock/variant availability, guest cache vs member bypass, admin write clears the cache |
| `couriers-unit.test.js` (**new**) | 3 | Tracking-link generation and encoding, https-only, admin preview = server link, AWB validation |
| `pricing.test.js` | 10 | Price, GST slabs, shipping, membership prices |
| `production.test.js` | 8 | Production mode: HTTPS redirect, HSTS/CSP, OTP never echoed, errors without internals |
| `seo.test.js` | 7 | Server-rendered SEO, sitemap, structured data |
| `notify.test.js` | 4 | E-mail notifications |
| `razorpay-signature.test.js`, `razorpay-gateway.test.js` | 4 | Signature vectors, gateway flow |
| `migration-rehearsal.test.js` | 1 | 015–021 on a production-shaped schema, data preserved, re-run no-op; **new assertions**: pre-021 dispatched order linked to its courier with a tracking link; courier seed not duplicated; retired `piece_requests` data retained |

## 3. Tests changed

| Test | Change | Reason |
|---|---|---|
| `customers cannot read each other's orders or piece requests` | renamed; piece-request half removed | Feature removed |
| `piece requests reject script URLs and foreign attachments` | replaced by `the retired Request a Piece API is gone` | Feature removed |
| `type comes from bytes; scripts, SVG and guest video are refused` | now signs in first; asserts a guest upload is 401 | Uploads require a session |
| Transport security / production tests | use `/api/auth/start-login` instead of `/api/piece-requests` as the sample public POST | Endpoint removed; the assertions (origin guard, JSON-only, HTTPS, malformed JSON) are unchanged |

## 4. Manual verification (browser)

| Check | Result |
|---|---|
| Homepage, dev server: API requests, duplicates, cancellations | 4 requests, all 200, 0 duplicates, 0 cancelled (before: 8, 2 cancelled) |
| Homepage, production build: total requests | 14 (4 API) |
| New arrivals render; sold-out piece shows SOLD OUT | yes (screenshot in the work log) |
| Request a Piece absent from home, product, contact, catalogue, account, admin | yes |
| Catalogue (production): 3 API calls, sold-out badges, responsive images | yes |

## 5. Not verified here

Real Razorpay (orders, UPI Autopay mandates, webhooks from the internet), Resend delivery, the admin Couriers screen against the **staging** database (migration 021 is not applied there), multi-instance deployment, iOS/Android browsers.
