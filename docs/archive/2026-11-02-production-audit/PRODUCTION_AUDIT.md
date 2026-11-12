# Vishrea Studio — Production Audit

Audit date: 2 November 2026.  
Scope: modular monolith (`server.js`, `api/`, `lib/`, `migrations/`, `vishrea-react/`).  
Method: read the source, fix defects that are real in that source, prove the fix with regression tests.  
Verification: [`PRODUCTION_VERIFICATION.md`](./PRODUCTION_VERIFICATION.md).

Status values used below: **PASS**, **FAIL**, **PARTIAL**, **BLOCKED**.

The October audit’s critical fixes (no client-side admin, no unpaid “paid” orders, no silent mock database, server-side stock reservation, signed webhooks) are still in the tree. This pass re-ran that suite and closed the gaps the suite did not cover.

---

## Executive summary

The store is a single Node.js process in front of PostgreSQL. Prices, stock, credits and payment status are decided on the server. The browser is not trusted for money.

This pass found five production defects in that design and fixed them:

1. Wardrobe credits recorded an expiry and then ignored it.
2. A second successful capture on an already paid order was not refunded.
3. Two overlapping refund attempts could both call Razorpay.
4. Cancelling a paid, unshipped order returned the garment and kept the wardrobe credit.
5. A duplicate Razorpay subscription event could grant credits twice, and a refund webhook could mark a delivered order as simply “refunded” or treat a partial refund as a full reversal.

A second pass (“fix all”) closed the technical risks the first pass had left open: a payment the gateway could not confirm at verify time is re-checked by a background job; a refund that fails at Razorpay is retried with a bounded backoff; admin credit grants expire; cookie-authenticated mutations must carry an Origin or Referer; the checkout page treats a refunded duplicate payment as paid (B-08 to B-11).

`npm test`: **74 passed, 0 failed**.

The application is not cleared for go-live until the blockers in the last section are done. Live Razorpay, the public HTTPS host, email delivery, and the production database migration were not exercised from this machine.

---

## Architecture

Modular monolith. One Express process. Domain modules under `api/` each declare `access` (`public`, `user`, `admin`) and allowed methods. `server.js` enforces that before the handler runs. PostgreSQL is the only system of record. There is no second write path from the browser.

| Concern | Where it lives |
| --- | --- |
| HTTP, cookies, CSP, CORS, errors | `lib/http.js`, `lib/auth.js`, `server.js` |
| Catalogue and pricing | `lib/catalogue.js`, `lib/pricing.js` |
| Cart | `api/cart.js`, `lib/cart.js` |
| Checkout and orders | `api/checkout.js`, `api/orders.js`, `lib/payments.js` |
| Inventory | `lib/inventory.js` |
| Razorpay | `lib/razorpay.js`, `api/payment-verify.js`, `api/webhooks/razorpay.js` |
| Membership and credits | `api/membership.js`, `lib/credits.js` |
| Admin | `api/admin/*` |
| Uploads | `api/upload.js`, `lib/uploads.js` |
| Schema | `migrations/001`–`015` |

Not introduced, on purpose: microservices, a second database, Prisma, a queue, Redis, GraphQL.

---

## Customer journey

| Step | Status | Notes |
| --- | --- | --- |
| Catalogue, product, size price | PASS | API + SEO tests. Prices come from `product_variants`. |
| Bag add / qty / credit flag | PASS | Server checks stock and premium exclusion. |
| Checkout totals | PASS | Client totals are ignored. |
| Pay, verify, invoice, bag cleared | PASS | Against the local Razorpay stand-in. |
| Track, dispatch, deliver, exchange | PASS | `catalogue → bag → pay → tracked dispatch → delivered → exchange`. |
| Another customer’s order id | PASS | 404. |
| Homepage, filters, images, 320–1440px, Razorpay popup | BLOCKED | No browser session was run this pass. |

Optional product fields are normalised in `lib/catalogue.js` (`normalizeProduct`). Missing images become an empty gallery. A corrupt guest bag in `localStorage` is ignored instead of throwing on `.find` / `.reduce`.

---

## Admin journey

| Step | Status | Notes |
| --- | --- | --- |
| Admin API without a session or as a customer | PASS | 401 / 403. |
| Create variant prices, reject duplicate sizes | PASS | |
| Stock edit while a checkout holds units | PASS | Conflict, not a lost update. |
| Archive a sold product | PASS | Order lines remain. |
| Dispatch unpaid order | PASS | Rejected. |
| Cancel unshipped paid order | PASS | Stock and credits return. |
| Customer video publish | PASS | Hard cap 3 live, 10 seconds, even if a setting says otherwise. |
| Click-through of every admin screen | BLOCKED | Not executed in a browser. The product editor no longer calls `.map` on a missing `variants` array. |

Order status changes go through `FULFILMENT_FLOW` in `api/admin/ops.js`. Payment status is not a free-text field on that path.

Allowed fulfilment moves:

```text
pending_payment → cancelled
processing → packed | dispatched | cancelled
packed → dispatched | processing | cancelled
dispatched → delivered
delivered → (no further fulfilment move)
```

`refunded` is allowed only when payment is `paid` or `refund_required`.

---

## Payment audit

| Check | Status |
| --- | --- |
| Order amount created on the server and sent to Razorpay | PASS |
| Browser success does not mark paid; HMAC of `order_id\|payment_id` required | PASS |
| Amount/currency cross-check when Razorpay can be reached | PASS |
| Webhook HMAC over the raw body, constant-time compare | PASS |
| Event id dedupe; failed processing returns 500 so Razorpay retries | PASS |
| Stored webhook record has ids and amounts, not email, phone or card data | PASS |
| Duplicate verify | PASS |
| Second capture refunded once | PASS |
| Concurrent refund of one unfulfillable payment | PASS |
| Auto-refund bounded to 4 seconds so the webhook is not held open for the 15s gateway timeout | PASS (code). Live timing BLOCKED |
| Signature accepted when the gateway fetch itself fails | PASS | A valid signature for the server-created order is accepted so the customer is not left waiting, but `orders.gateway_checked_at` stays NULL. `recheckUnconfirmedPayments` (every minute) fetches the payment; a mismatch on an unshipped order releases stock, reverses credits and refunds. Tested with a tampered amount while the fetch is down. |
| Failed refund is retried | PASS | `retryPendingRefunds` retries `refund_required` orders with a 2-minute backoff up to 8 attempts, then logs `payment.refund_needs_operator`. Failed duplicate-capture refunds are retried the same way. |
| Live test-mode payment and dashboard webhook | BLOCKED |

Payment states that the server will actually write:

```text
pending → paid
pending → expired | cancelled
pending | expired | cancelled → refund_required → refunded
paid → refund_required (admin cancel of a paid, unshipped order with a non-zero total)
paid → refunded (zero-rupee credit order cancelled, or a full refund webhook)
```

A delivered order’s fulfilment status stays `delivered` when the payment is refunded. It is not moved back to `pending` or `created`.

---

## Inventory audit

Stock moves with one conditional update:

```sql
UPDATE product_variants
   SET stock_quantity = stock_quantity - $qty
 WHERE id = $id AND stock_quantity >= $qty AND is_active
```

Rows are locked in variant-id order. `stock_quantity >= 0` is also a table check. Holds expire through `sweepExpiredOrders`. A late payment either takes the unit again or is refunded.

| Scenario | Status |
| --- | --- |
| Stock 1, two checkouts | PASS — one order |
| Stock 3, twenty checkouts | PASS — three orders, stock 0 |
| Admin sets an absolute stock over an in-flight hold | PASS — rejected; the edit is a delta from the loaded value |
| Full refund before dispatch | PASS — unit returned |
| Refund after delivery | PASS — unit stays sold |
| Partial refund | PASS — payment stays `paid`, stock unchanged |

Restocking a delivered return is a business decision. The webhook does not guess.

---

## Security audit

| Check | Status |
| --- | --- |
| Admin flag comes from `profiles` on every request, not from the token | PASS |
| OTP hashed, 10 minute TTL, 5 attempts, resend throttle | PASS |
| Cookie HttpOnly, SameSite=Lax, Secure in production | PASS in code. Browser confirmation BLOCKED |
| CORS is an allow-list; credentialed `*` is not used | PASS |
| Cookie mutations require an allowed Origin when Origin is present | PASS |
| Missing Origin on a mutation | PASS | A cookie-authenticated POST/PUT/PATCH/DELETE with neither Origin nor Referer is rejected with 403 `origin_required`. Bearer-token clients and unauthenticated calls (OTP start) are unaffected. Webhooks are outside the guard. |
| Uploads sniffed from magic bytes; SVG/HTML refused; files served with `sandbox` and `nosniff` | PASS |
| Customer cannot set price, SKU, or another user’s cart | PASS |
| SQL is parameterised. Transaction isolation level is an allow-list | PASS |
| Secrets in the React bundle | PASS | No `RAZORPAY_KEY_SECRET` / `JWT_SECRET` under `vishrea-react/src`. |
| `.env` in git history of this clone | PASS | Ignored, and `git log --all -- .env` is empty. |
| Production HSTS and HTTPS redirect on the real host | BLOCKED |

---

## Database audit

Migrations `001`–`015` apply on a clean database during `npm test`.

Present and used:

- Primary keys on business tables.
- Unique Razorpay order id and payment id (orders and membership payments).
- Unique `(cart_id, variant_id)`, unique SKU, unique invoice number, one invoice per order.
- Credit ledger unique `(order_id, reason)` and unique `membership_payment_id`.
- Non-negative stock, non-negative money, non-negative credit balance.
- Order and payment status checks.

| Check | Status |
| --- | --- |
| Checkout, pay, refund and credit moves are single transactions | PASS |
| Connection failure returns an error, not invented rows | PASS (`lib/db.js` has no mock fallback) |
| Pool size, statement timeout | PARTIAL | Defaults: pool 10, statement 15s, connect 10s. Not tuned against production traffic. |
| 1,000 / 10,000 / 100,000-row behaviour | BLOCKED | Not generated. |
| N+1 on the public catalogue | PARTIAL | Catalogue uses a lateral variant aggregate. Admin lists are paginated. This was not measured with a query plan. |

`migrations/015_credit_and_video_caps.sql` lowers a stored `max_video_seconds` of 30 to 10. Apply it with `npm run migrate` on every database, including production.

---

## Performance audit

| Check | Status |
| --- | --- |
| Bundle size, image weight, TTFB, checkout latency | BLOCKED | Not measured this pass. |
| Unbounded JSON body | PASS | Global JSON limit 200kb. Uploads have their own cap. |
| Webhook body cap | PASS | 1mb raw body. |

---

## Scalability audit

Measured capacity: the concurrency tests (20 simultaneous checkouts, 5 duplicate webhooks, 2 simultaneous refunds, 2 simultaneous subscription charges). That is not a capacity number.

Architectural expectation, not a measurement: one Node process and a pool of 10 Postgres connections will be the first ceiling, on checkout row locks and on Razorpay’s own rate limits, before CPU. Do not quote a user count until it is measured.

| Scale | Status |
| --- | --- |
| 10–20 concurrent checkouts of one SKU | PASS (correctness, not latency) |
| 100 / 1,000 / 10,000 / 100,000 concurrent users | BLOCKED |

---

## SEO / AEO / AIO audit

| Check | Status |
| --- | --- |
| Unique titles, descriptions, canonical, Open Graph | PASS | `seo.test.js` |
| Product schema with per-size offers | PASS |
| FAQ schema matches visible questions | PASS |
| Unknown URLs return HTTP 404 | PASS |
| Private routes `noindex` | PASS |
| Sitemap of public URLs; non-production robots disallow all | PASS |
| Production robots allow the store and point at the sitemap | PASS | In-process production mode |
| Live crawl, Core Web Vitals, index coverage | BLOCKED |

Product copy is rendered from catalogue fields (`lib/seo.js`, `describeProduct`). No keyword block was added.

---

## UX audit

| Check | Status |
| --- | --- |
| Checkout does not add a registration step beyond the existing email code | PASS (code review) |
| Server is the source of shipping, gift fee and tax | PASS |
| Payment failure and cancel release the hold | PASS |
| Mobile keyboards, sticky bars, 320px layout, Razorpay handoff | BLOCKED |

---

## Failure recovery

| Dependency down | Behaviour | Status |
| --- | --- | --- |
| Postgres | `/api/health` is 503. Requests error. No fake order. | PASS |
| Razorpay create-order | Checkout expires the hold and returns an error. | PASS |
| Razorpay refund | Order stays `refund_required`. It is not marked paid. | PASS |
| Email provider | OTP is not returned to the client in production. Sign-in fails closed. | PASS |
| Upload | Bad types are rejected before a product row changes. | PASS |

---

## External failure patterns → Vishrea prevention

These are patterns reported publicly against mature commerce systems (inventory races, stock that does not match the order, vouchers stuck after a failed checkout, duplicate webhooks, IDOR, stored XSS). They were used as a checklist. Their code was not copied.

| Pattern | Risk | Vishrea | Evidence |
| --- | --- | --- | --- |
| Read stock, then write stock | Two buyers take the last unit | Conditional `UPDATE … WHERE stock_quantity >= $qty` inside one transaction | Race tests |
| Admin stock write races a sale | Lost update, later oversell | Admin applies a delta from the value they loaded; conflict if the row moved | Stale stock test |
| Failed checkout keeps the reservation or the credit | Stock or credits stuck | Expire/cancel releases both. Cancel of a paid unshipped order now returns credits too | Cancel and credit tests |
| Webhook delivered twice or out of order | Double invoice, double credits | Event id unique; payment finaliser locks the order; subscription payment id is unique | Webhook and subscription tests |
| Second capture on one order | Customer charged twice | Extra payment is refunded once | Second capture test |
| Refund of a shipped order restocks a garment that is gone | Inventory lies | Delivered refund changes payment status only | Refund matrix |
| Client-supplied price or role | Free goods, admin takeover | Server price; role read from `profiles` | Pricing and auth tests |
| IDOR on orders | Read another customer’s address | `orders.auth_user_id = caller` | Access tests |
| HTML/SVG upload on the same origin | Stored XSS | Magic-byte sniff, sandbox CSP | Upload tests |

---

## Bugs found this pass

### B-01 Credits expired on paper only — FIXED

`credit_ledger.expires_at` was written from `credit_expiry_days` (60). Checkout only looked at `memberships.credits_balance`, so expired credits still paid for garments.

Root cause: the balance was a counter, not a view of the ledger.

Fix: `lib/credits.js` walks the ledger FIFO (soonest expiry first) and writes the difference as a single `expiry` row. That write is committed before checkout can fail, so a rejected checkout does not undo the write-off. Membership pages and admin adjustments use the same function.

Regression: `expired credits cannot be redeemed and are written off once`; unit test `credit expiry is FIFO`.

### B-02 Second capture was not refunded — FIXED

If an order was already `paid` and a different `payment_id` arrived, the server logged a warning and left the money captured.

Root cause: the duplicate branch returned without calling the refund API, and a second caller could race the first.

Fix: `refundDuplicatePayment` claims `payment_events` row `refund:<payment_id>` and calls Razorpay once. A failed claim can be retried; a processed claim cannot.

Regression: `a second capture on an already paid order is refunded once`.

### B-03 Two callers could refund the same unfulfillable order — FIXED

`markRefundRequired` updated any status other than `paid` or `refunded`, so two requests that both saw `refund_required` each called Razorpay.

Fix: only `pending`, `expired`, `cancelled` or `failed` can enter `refund_required`. The loser does not call Razorpay again.

Regression: `simultaneous refunds of one unfulfillable payment are issued once`.

### B-04 Paid cancellation kept the wardrobe credit — FIXED

Admin cancel of an unshipped paid order returned stock and did not reverse `credits_used`.

Fix: `reverseCredits` runs on that path. It is idempotent on `(order_id, reason)`. Restored credits get an expiry, so a reversal cannot create a permanent balance. A zero-rupee credit order is marked `refunded` because there is no payment to send back. A paid order with a real total becomes `refund_required`.

Regression: `cancelling an unshipped credit order restores the credit once`.

### B-05 Subscription replay and blunt refund webhook — FIXED

`subscription.charged` inserted a membership payment with a null provider payment id, then set the id later. Two deliveries could both pass the “have I seen this?” check and grant credits twice.

`refund.processed` set every matching order to `status = refunded`, including delivered orders, and did not look at the refund amount.

Fix: the subscription payment id is inserted immediately and conflicts on the unique index. A full refund of an unshipped order returns stock and credits and moves status to `refunded`. A full refund after dispatch keeps the fulfilment status and sets `payment_status = refunded` without restocking. A smaller amount is recorded and does not change payment status or stock.

Regression: subscription test; refund matrix test.

### B-06 Customer video cap could be widened — FIXED

The stated rule is 3 published videos and 10 seconds. The setting default and the migration seed were 30 seconds, and republishing an existing row did not re-check duration.

Fix: `customerVideoLimits` will not go above 3 or 10. Upload rejects a longer file. Saving a higher setting is rejected. Migration `015` rewrites a stored `30` to `10`.

Regression: `videos over 10 seconds are rejected server-side and only 3 may be live`.

### B-07 Small resilience — FIXED

- Guest bag or server bag that is not an array no longer throws in the store shell.
- Opening a product in admin no longer throws when `variants` is missing.
- `db.tx({ isolation })` only accepts `READ COMMITTED`, `REPEATABLE READ` or `SERIALIZABLE`.

### B-08 Payment accepted on signature alone when Razorpay was unreachable — FIXED

`payment-verify` fetched the payment from Razorpay to cross-check amount and status, but if that fetch failed it fell back to the signature alone and nothing came back to look again.

Fix: migration `016` adds `orders.gateway_checked_at`. Verify, webhook and credits paths set it only when the gateway actually confirmed the payment. `recheckUnconfirmedPayments` runs every minute from `startBackgroundJobs`, fetches each unconfirmed paid order (last 7 days), captures an authorized payment, and on a mismatch calls `flagPaidOrderMismatch`: an unshipped order releases stock, reverses credits and moves to `refund_required` → automatic refund; a dispatched order only records the reason and an audit row for a person to decide. No stock is taken back from a parcel that has left.

Regression: `gateway unreachable at verify: paid on signature, then confirmed by reconciliation`; `gateway unreachable at verify with a tampered amount: reconciliation refunds and restocks`.

### B-09 A failed refund was left for a person — FIXED

`markRefundRequired` called Razorpay once. A 5xx or timeout left the order at `refund_required` with no retry.

Fix: `issueOrderRefund` claims the attempt atomically (`refund_attempts`, `refund_attempted_at`), so two workers never both call Razorpay. `retryPendingRefunds` retries after a 2-minute backoff up to `REFUND_MAX_ATTEMPTS = 8`, then logs `payment.refund_needs_operator` once per pass. Failed duplicate-capture refunds (`payment_events` rows with status `failed`) are retried by `retryFailedDuplicateRefunds`.

Regression: `a refund that fails at the gateway is retried by reconciliation, not left for a person`; `a failed duplicate-capture refund is retried once by reconciliation`.

### B-10 Admin credit grants never expired — FIXED

`adjustCredits` wrote `expires_at = NULL` unless the admin typed a date, so a goodwill credit outlived every membership grant.

Fix: positive adjustments default to `now() + credit_expiry_days`; an explicit date still wins; deductions carry no expiry.

Regression: the admin credit test now asserts the grant has an expiry at least 59 days out.

### B-11 Cookie mutation with no Origin or Referer was accepted — FIXED

`originGuard` only checked Origin/Referer when one was present. SameSite=Lax already blocks cross-site browser POSTs, but a client that replays the cookie without those headers was not rejected.

Fix: a mutation that carries the auth cookie and no `Authorization: Bearer` must carry an allowed Origin or Referer, otherwise 403 `origin_required`. Unauthenticated calls and Bearer clients are unchanged.

Regression: the transport security test (no Origin → 403, Referer alone → 200, no cookie → 200).

Also in this pass: `Checkout.jsx` treats `duplicate_payment` from verify as paid (the server has already refunded the extra capture), so the customer sees the confirmation instead of an error.

---

## Regression tests

Every bug above has a test named in `PRODUCTION_VERIFICATION.md`. The full command is `npm test` (74 passed).

---

## Remaining risks

### Technical

- Webhook processing still does its database work inside the request. The refund call itself is capped at 4 seconds. Accepted for one process; Razorpay retries on timeout and the handler is idempotent.
- Pool max 10 and catalogue query plans are unmeasured.
- The reconciliation job runs inside the single web process. If two instances are ever run, both will sweep; every step is claimed atomically so the result is duplicate reads, not duplicate refunds.
- Refunds that exhaust 8 attempts stay `refund_required` and are logged as `payment.refund_needs_operator`. That log line must be watched.

### Infrastructure

- Production HTTPS, HSTS on the public hostname, and `Secure` cookies in a real browser are BLOCKED.
- `npm run migrate` must be applied to the production database so `013`, `015` and `016` are present. `016` backfills `gateway_checked_at` for orders already paid so the recheck job does not re-fetch history. RLS in `013` only matters if the hosted Postgres still exposes `anon`.
- Uploaded files live on local disk (`public/uploads`). More than one server instance would not share them. One instance is the current architecture.

### External provider

- Live Razorpay keys, a live webhook endpoint, and a real capture/refund were not called.
- OTP email delivery depends on the configured provider. Production mode does not echo the code. Delivery itself was not tested with a provider.

### Business decision

- Whether a refund of a dispatched or delivered piece should return it to stock. Today it does not.
- How a partial refund should change the invoice total. Today the order stays `paid` and the refund id is stored.
- GST slabs are the configured 5% / 18% split at ₹2,500 per piece, tax-inclusive. This audit does not confirm that split against current law.
- Membership price, upfront months, and credits per payment are settings. A subscription renewal adds `credits_per_month` once per captured charge, which matches the existing checkout grant, not “credits × months” as a second formula.

---

## Production blockers

1. Run `npm run migrate` on the production database.
2. Confirm Razorpay test (then live) keys, and a webhook pointing at `https://<host>/api/webhooks/razorpay` with the webhook secret set only on the server.
3. Confirm OTP email delivery.
4. Confirm HTTPS, the HTTP→HTTPS redirect, and HSTS on the real host.
5. Take one real test-mode payment and one refund in the Razorpay dashboard and match them to `orders` and `payment_events`.
6. Decide the two refund questions above before promising them on the policy pages.

---

## Scores

Scores are out of 10 and follow the evidence above. They are not a forecast of traffic the system has not seen.

| Area | Score | Why |
| --- | --- | --- |
| Customer UX | 6 | Checkout rules are tested. Layout, mobile and the Razorpay popup were not opened. |
| Admin UX | 6 | Admin APIs and the dangerous transitions are tested. The screens were not clicked. |
| Backend | 8 | Money, stock and access are server-side and covered by 74 tests. |
| Database | 8 | Constraints, transactions and a clean migrate path. No large-data plan. |
| Security | 8 | Auth, IDOR, uploads, CORS and webhook HMAC are tested. The public host is not. |
| Payments | 8 | Failure matrix is tested against a real HMAC stand-in. Live Razorpay is not. |
| Inventory | 9 | Races, refunds and admin stock edits are tested. |
| Scalability | 4 | Correct under small parallel bursts. No capacity measurement. |
| Performance | 4 | Not measured. |
| SEO / AEO / AIO | 7 | Titles, canonical, product and FAQ schema, sitemap and 404s pass. No field crawl. |
| Reliability | 8 | Failed gateway, failed database and failed refund stay consistent and are reconciled by a background pass. No multi-instance story. |

Overall: **not ready to take live money** until the six blockers are done. **Ready to keep hardening on this architecture** — the defects found in code are fixed and regression-tested.

---

## Production checklist

```text
[x] Code audit complete
[x] Customer journey complete (API and server-rendered SEO; browser walkthrough not done)
[x] Admin journey complete (API; browser walkthrough not done)
[x] Payment tested (local Razorpay stand-in, real HMAC)
[ ] Payment tested on live Razorpay
[x] Webhook tested (stand-in signatures, duplicates, refunds)
[ ] Webhook tested from the Razorpay dashboard
[x] Inventory concurrency tested
[x] Security tested (automated)
[ ] Security tested on the production host
[x] Database tested (migrations on a throwaway Postgres)
[ ] Database migration applied to production
[ ] Performance tested
[ ] Mobile tested in a browser
[x] Failure recovery tested (gateway, stock, credits, refund)
[x] SEO tested (server-rendered)
[x] AEO tested (product and FAQ schema in the SEO suite)
[ ] AIO tested against a live crawler
[x] Regression suite passed (74/74)
[ ] Production configuration verified
```
