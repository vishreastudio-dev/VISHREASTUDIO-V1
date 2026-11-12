# Project Status — Optimization & Enhancement (7 November 2026)

**State:** implemented and tested locally; **not deployed**; migration `021` **not applied** to staging or production. Awaiting approval.

## 1. Delivered

| Item | Status | Evidence |
|---|---|---|
| Homepage `catalogue`/`content` failures and cancellations | Fixed at the root (dev API restarts; StrictMode + abort; duplicate session/bag) | [PERFORMANCE_AUDIT](PERFORMANCE_AUDIT.md) §2–3 |
| Request a Piece removed everywhere | Done; table and data retained | [IMPLEMENTATION_CHANGELOG](IMPLEMENTATION_CHANGELOG.md) §2 |
| Sold-out badges (shop, categories, search, featured, product page, recommendations, bag) | Done, from server stock, variant-aware | [SOLD_OUT_INVENTORY_LOGIC](SOLD_OUT_INVENTORY_LOGIC.md) |
| Courier management in Admin + dispatch + customer tracking + history | Done | [COURIER_MANAGEMENT](COURIER_MANAGEMENT.md) |
| API request reduction, caching, compression, images | Done (homepage 8 → 4 API calls in dev; JS/CSS −74 % on the wire) | [API_OPTIMIZATION](API_OPTIMIZATION.md) |
| Database review, EXPLAIN, pooling | Done; no index needed; migration 021 | [DATABASE_OPTIMIZATION](DATABASE_OPTIMIZATION.md) |
| Load test 100/500/1,000 VUs, checkout, last-unit race | Done locally (500 VUs: 640 → 1,497 req/s, p95 1.46 s → 132 ms; no oversell) | [LOAD_TEST_REPORT](LOAD_TEST_REPORT.md) |
| Multi-instance readiness | Background jobs lock-guarded; remaining items listed | [SCALABILITY_ASSESSMENT](SCALABILITY_ASSESSMENT.md) |
| Security review of the change set | Done; guest uploads closed | [SECURITY_REVIEW](SECURITY_REVIEW.md) |
| Regression | 151/151 tests pass (140 before) | [REGRESSION_TEST_REPORT](REGRESSION_TEST_REPORT.md) |
| Architecture audit | Modular monolith retained | [MASTER_ARCHITECTURE_AUDIT](MASTER_ARCHITECTURE_AUDIT.md) |

Business rules (₹3,598 upfront + UPI Autopay, ₹1,799 from month 3, credits and 8-credit limit, Wardrobe Bag shipping ₹99 / free at 4+, 48-hour early access, 6th-month reward, referral ₹150, gifts without autopay, refunds/exchanges) were not changed and their existing tests pass.

## 2. Needs approval / action before release

1. **Apply `migrations/021_courier_management.sql`** to staging (`npm run migrate`), verify, then production — before deploying this code. Until then, order and dispatch pages error on a database without it.
2. Deploy with `npm run build` (now also precompresses assets).
3. Restart the local dev backend so nodemon picks up `nodemon.json`.
4. Decide whether to drop the retained `piece_requests` table (deletes customer data).
5. Delete `vishrea-react/.env` (unused Supabase anon key).

## 3. Known limits and next steps

- Load figures are from a laptop with a local database — not production capacity ([LOAD_TEST_REPORT](LOAD_TEST_REPORT.md) §3). Repeat on a production-like staging stack.
- Uploaded product photos are not resized or converted to WebP/AVIF (needs an image pipeline or CDN).
- Guest bags are re-validated only at sign-in (checkout is protected).
- For more than one instance: shared rate limiting, shared uploads, connection budget ([SCALABILITY_ASSESSMENT](SCALABILITY_ASSESSMENT.md) §3).
- Open items from the earlier security audit (admin 2FA, role separation, penetration test, secret rotation) remain open.

## 4. External dependencies not exercised here

Razorpay (live/test API, UPI Autopay, internet webhooks), Resend delivery, Supabase plan connection limits, hosting/TLS/CDN.
