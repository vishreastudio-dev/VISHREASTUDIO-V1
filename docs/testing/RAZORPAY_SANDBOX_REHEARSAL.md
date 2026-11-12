# Razorpay sandbox (Test Mode) rehearsal

Date: 2026-11-11 (IST). Isolated sandbox only. No live keys, no real money, no production data.

## Status

| Area | Status |
|---|---|
| Genuine Razorpay TEST payments: Product, Membership, Gift, Wardrobe Bag | **Done.** Every flow completed a real Test Mode transaction, passed backend signature verification, and updated the correct sandbox database records (§5–§10) |
| Local webhook-handler tests with signed fixtures | **Done.** 45 cases (§8.2). These prove the handler's behaviour, **not** Razorpay delivery |
| Real Razorpay webhook delivery | **Not tested.** The owner decided to register the TEST webhook only once the production or staging domain has HTTPS (§8.1, §14) |
| Owner's own manual payments in Chrome | Pending. The sandbox is still running for this (§16) |
| **Overall payment integration** | **Not complete.** Real webhook delivery is still unverified |

## 1. Environment and database

| Item | Value |
|---|---|
| App | `server.js` at **`http://127.0.0.1:3200`**, started by `scratch/sandbox/start.mjs` (log: `scratch/sandbox/server.log`) |
| Environment | `scratch/sandbox/sandbox-env.mjs`: the isolated QA environment (`tests/qa/qa-env.mjs`) with only the port, database and gateway changed |
| Database | Local `postgresql://postgres@127.0.0.1:55432/vishrea_sandbox`, separate from `vishrea_qa` and `vishrea_dev`. All 23 migrations, demo seed, and one fixture product `qa-checkout-stock` (SKU `SBX-CHECKOUT-M`, ₹1,999, stock 20) |
| Customers | `sbx-user-1…6@qa.test`. Sign-in uses the development code shown on the login page (`@qa.test` only) |
| Email | Resend disabled. Notifications are written to the dev log and the `notifications` table as `provider_not_configured` |
| Remote database | `ALLOW_REMOTE_DATABASE=false`; production guard armed |
| Browser | Desktop Chrome with an isolated profile, driven by the agent. The user typed the subscription test card themselves |
| Normal QA | Unchanged. `tests/qa/qa-env.mjs` still selects the stand-in (`RAZORPAY_API_BASE=http://127.0.0.1:3190`). Confirmed with `node tests/qa/stack.mjs env` |

## 2. Genuine Razorpay Test Mode was used

- `RAZORPAY_API_BASE=https://api.razorpay.com/v1`. The `.env` key ID starts with `rzp_test_`, and `sandbox-env.mjs` refuses to start with any other key.
- `lib/config.js` enables the local stand-in completion only for a loopback API host. Here it is off. Every `complete_local` / `complete_local_checkout` call returned **404**.
- Hosted Checkout opened from `checkout.razorpay.com` with the "Test Mode" ribbon. Bank steps ran on Razorpay's demo bank page (`api.razorpay.com/v1/gateway/mocksharp/payment`).
- Every outcome below was cross-checked through the Razorpay TEST API (`GET /orders/{id}`, `/orders/{id}/payments`, `/payments/{id}`, `/subscriptions/{id}`, `/invoices`), not just the browser screen.

## 3. Gateway configuration (secrets redacted)

| Setting | Value |
|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_…` (from `.env`) |
| `RAZORPAY_KEY_SECRET` | Set in `.env`. Loaded into the app process only; never printed, logged or written to the repository |
| `RAZORPAY_WEBHOOK_SECRET` | Set in `.env` (64 characters). **Not used**: no webhook was registered. The fixture tests used a random, run-only secret |
| `RAZORPAY_MEMBERSHIP_PLAN_ID` | Empty, so the app created a monthly ₹1,799 plan in the TEST account (`plan_TymkWl7cdnDZlS`) |
| Subscriptions API | Available on the TEST account (preflight returned 200 for `/orders`, `/payments`, `/plans`, `/subscriptions`) |

## 4. Checkout flows tested

| Flow | Customer | What was paid |
|---|---|---|
| A. Product | sbx-user-1 | 2 × QA Checkout Stock, studio pickup, ₹3,998 |
| B. Membership (current model) | sbx-user-1 | ₹3,598 for 2 months, then a ₹1,799 monthly mandate. 4 credits at activation |
| C. Gift | sbx-user-1 (buyer) | Gift to her, 2 months, ₹3,598: one gift starting 18 Nov 2026 for sbx-user-4, one starting immediately for sbx-user-5 |
| D. Wardrobe Bag | sbx-user-1 | 1 piece taken with a credit, delivery, ₹99 shipping (fewer than 4 pieces) |

Not changed: the membership model. No ₹10,794 prepaid plan was added, and Autopay was not removed. The gift form's existing "6 months · ₹10,794" duration option is not the membership plan and was not touched.

## 5. Razorpay TEST references

| Flow | Razorpay order / subscription | Payments (status on Razorpay) |
|---|---|---|
| Product | `order_TymlwlvRnvNHV9` (₹3,998) | `pay_TymnmvPxze5VDJ`, `pay_TymoVmavPOni6N` created, never completed (Cursor's built-in browser could not open the bank page); `pay_Tyn0Qnkq5bRhtA` **failed**; `pay_Tyn2Y4NuVXX2rb` **captured** |
| Product, cancelled | `order_Tyn5mPibDQIn8G` (₹1,999) | None (checkout closed) |
| Membership | `sub_Tyn7OIyrqLXOG2` (card mandate, `authenticated`); invoice `inv_Tyn7P0DqgJ4NEs` paid 359800 | `pay_TynBQNk6cN29WG` **captured** |
| Membership, abandoned | `sub_TymkX0yKxBcTKw` (sbx-user-2, `created`) | None |
| Gift GE-1001 | `order_TynLsMzpkMXjKW` | `pay_TynMI5cwyZ30pK` **failed**; `pay_TynNWTg2RWw1HM` **captured** |
| Gift GE-1002 | `order_TynQzD3Lt9EFld` | None (replay target) |
| Gift GE-1003 | `order_TynRZukaqa0Wcs` | None (checkout cancelled) |
| Gift GE-1004 | `order_TynUPoATJyoUWr` | `pay_TynUlhV7ZjdK3j` **captured** (netbanking) |
| Bag shipment `7685803d` | `order_Tyna74GSFZ86J2` (₹99) | `pay_TynaJXOEkdQiFH` **failed**, then checkout closed |
| Bag shipment `0d66b2cc` | `order_TyndSfI6wYyutr` (₹99) | `pay_TyndfcME6mKnt4` **captured** |

## 6. Payment outcomes

| Flow | Scenario | Customer saw | Backend result |
|---|---|---|---|
| Product | Failure (demo bank "Failure") | Payment not completed; can retry | Order stays `pending_payment`; nothing sold |
| Product | Retry, success | Order confirmation | Order `processing` / `paid`; invoice `VS/2026-27/000001`; stock 20 → 18 committed |
| Product | Cancel (closed checkout) | Payment not completed | Order `c09b5825` `cancelled` (`cancelled_by_customer`); stock hold released |
| Membership | Success (card mandate) | Active, 4 credits, next payment ₹1,799 on 11 Jan 2027 | Membership `active`/`active`, 4 credits (+4 ledger, expiring 2027-01-10), paid through 2027-01-11, invoice `VS/2026-27/000002`, audit `membership_paid` |
| Gift | Failure | Payment not completed | GE-1001 stays `pending`: no code, no notification, no paid audit |
| Gift | Retry, success, starts 18 Nov | "Done — Sandbox Recipient will receive an email with her activation link." | GE-1001 `invoiced`, one code (2 months, valid to 2027-02-15), `gift_received` notification logged, audits `gift_purchase_paid` and `gift_token_issued` |
| Gift | Second purchase with the form still filled, then cancel | "Payment not completed. Nothing was charged." | GE-1003 created and left `pending`; no code (see defect 1) |
| Gift | Success, immediate start | Success message | GE-1004 `invoiced`, one code |
| Gift | Recipient redeems (sbx-user-5) | Membership active | `active`/`prepaid`, `gift = true`, 4 credits (+4 `gift_membership`), paid through 2027-01-11, no Autopay, code `redeemed`, audit `gift_redeemed` |
| Bag | Credit pick | "Added to your Wardrobe Bag…" | Order `a4762d21` `in_bag`; credits 4 → 3 (−1 `redemption`); stock 18 → 17 |
| Bag | Failure | "Payment could not be completed" (Razorpay) | Shipment `7685803d` stays `pending_payment`; piece stays `in_bag` |
| Bag | Cancel (closed checkout, "Yes, exit") | "Shipping was not paid. Your pieces are still waiting in your bag." | Nothing moved |
| Bag | Retry, success | "Your 1 pieces are being packed…" | New shipment `0d66b2cc` `paid` with `pay_TyndfcME6mKnt4`; the older unpaid shipment `cancelled`; order `processing`/delivery, linked to the shipment; credits and stock unchanged (3, 17); audit `bag_shipping_paid` |

## 7. Signature verification

| Flow | Check | Result |
|---|---|---|
| Product | Genuine Checkout signature (`order_id|payment_id`) | Accepted; order paid |
| Product | Forged / stand-in-signed signature | **400 `invalid_payment_signature`**; audit `payment_signature_invalid` (3 rows over the run) |
| Membership | Genuine subscription signature (`payment_id|subscription_id`) | Accepted; membership activated |
| Membership | Invalid signature | **400**; audit `membership_signature_invalid` |
| Membership | Valid HMAC replayed to another customer's open subscription | **400 `mandate_not_authorised`** |
| Gift | Genuine signature | Accepted |
| Gift | Invalid signature | **400 `invalid_payment_signature`** (not audited, see defect 2) |
| Bag | Genuine signature | Accepted |
| Bag | Invalid signature | **400 `invalid_payment_signature`** (not audited, see defect 2) |

For the replay tests the script recomputed valid HMACs with the TEST secret, simulating an attacker who holds a valid signature. The secret was never printed.

## 8. Webhook results

### 8.1 Real Razorpay webhook delivery — NOT TESTED

- No webhook was registered in the Razorpay dashboard at any point. `payment_events` in `vishrea_sandbox` has **0 rows**, so every genuine payment above was confirmed through the browser callback and backend verification only.
- A temporary `cloudflared` quick tunnel was prepared behind a filter that forwarded only `POST /api/webhooks/razorpay`. On re-check, `GET /`, `/api/health`, `/membership` and `/admin` returned 404, `POST /api/admin/ops` returned 404, and an unsigned webhook POST returned 400. Registration needed the owner's approval, and the owner decided not to use a tunnel. The tunnel and filter were stopped (the hostname now returns 502).
- To do before LIVE: register a TEST Mode webhook against the production or staging HTTPS domain and verify delivery (§14).

### 8.2 Local webhook-handler tests with signed fixtures

**These do not prove Razorpay delivery.** Script: `scratch/sandbox/webhook-fixtures.mjs`.

Setup:
- `vishrea_sandbox` was cloned to a throwaway database, `vishrea_wh_fixture`. It was dropped afterwards.
- A second app instance ran on `127.0.0.1:3202` with a random, run-only webhook secret, background jobs off, and `RAZORPAY_AUTO_REFUND=false`, so no refund was sent to Razorpay.
- Payloads were built from the genuine TEST entities in §5, fetched read-only from the Razorpay API. Where a new payment or refund was needed, the IDs were clearly synthetic: `pay_FIXTURE…` and `rfnd_FIXTURE…`.
- Each case records the HTTP result and which database facts changed. The full output is in `scratch/sandbox/webhook-fixtures-result.json`.

| # | Case | HTTP / outcome | Database change |
|---|---|---|---|
| A1 | Unsigned | 400 `invalid_signature` | None |
| A2 | Signed with a different secret | 400 `invalid_signature` | None |
| A3 | Body changed after signing (amount −100) | 400 `invalid_signature` | None |
| A4 | Valid signature, malformed JSON | 400 `invalid_json` | None |
| A5 | Unsupported event type | 200 `ignored` | None |
| A6 | `payment.captured` with no payload | 200 `ignored` | None |
| A7 | 1.1 MB body | 413 `payload_too_large` | None |
| A8 | `order.paid` for an unknown order | 200 `ignored` | None |
| B1 | `order.paid`, genuine product payment (already verified by browser) | 200 `already_paid` | None |
| B2 | `payment.captured`, same payment, new event ID | 200 `already_paid` | None |
| B3 | B1 redelivered with the same event ID | 200 `duplicate` | None |
| B4 | 5 concurrent deliveries, one event ID | 1 × `already_paid`, 4 × `duplicate` | None |
| B5 | `payment.authorized` | 200 `ignored` | None |
| B6 | `payment.failed` (genuine failed attempt) after the order was paid | 200 `processed` | None (paid order untouched) |
| B7 | `order.paid` with a second, different payment for the paid order | 200 `duplicate_payment` | Refund claim recorded (auto-refund off in this run) |
| B8 | `refund.processed`, partial ₹10 | 200 `partial` | Order stays paid |
| B9 | `refund.processed`, full | 200 `processed` | Order → `refunded`; stock 17 → 19 (2 units returned) |
| B10 | Same full refund, new event ID | 200 `already_paid` | None (stock not returned twice) |
| C1 | `order.paid`, genuine gift GE-1001 | 200 `already_paid` | None |
| C2 | GE-1002, wrong amount (₹1) | 200 `amount_mismatch` | None |
| C3 | GE-1002, currency USD | 200 `amount_mismatch` | None |
| C4 | GE-1002 paid by webhook only: 5 concurrent `payment.captured`, distinct event IDs | 1 × `paid`, 4 × `already_paid` | GE-1002 → `invoiced`; exactly one new gift code |
| C5 | GE-1003 paid by webhook only | 200 `paid` | GE-1003 → `invoiced`; one code |
| C6 | GE-1003, second different payment | 200 `duplicate_payment` | No second code |
| D1 | `order.paid`, genuine bag payment | 200 `already_paid` | None |
| D2 | `order.paid` for the superseded (cancelled) shipment | 200 `refund_required` | Refund claim recorded; nothing moved |
| D3 | Second, different payment for the paid shipment | 200 `duplicate_payment` | Refund claim recorded |
| D4 | `refund.processed` for the bag shipping payment | 200 `ignored` | None (see defect 7) |
| E1 | `subscription.authenticated` with the upfront payment | 200 `already_paid` | None (credits not re-granted) |
| E2 | `payment.captured`, genuine upfront mandate payment | 200 `already_paid` | None |
| E3 | `subscription.activated` | 200 `processed` | Mandate `authenticated` → `active` |
| E4 | `subscription.charged` carrying the upfront payment | 200 `already_paid` | None (no extra month or credits) |
| E5 | `subscription.charged`, new ₹1,799 debit | 200 `paid` | One renewal payment; paid through 2027-01-11 → 2027-02-11; one new month; one invoice |
| E6 | E5 again, new event ID | 200 `already_paid` | None |
| E7 | Next debit, 5 concurrent, distinct event IDs | 1 × `paid`, 4 × `already_paid` | Exactly one more month (paid through → 2027-03-11), one invoice |
| E8 | `subscription.charged` in USD | 200 `currency_mismatch` | None |
| E9 | `payment.failed` for a mandate debit | 200 `processed` | None |
| E10 | `subscription.pending` | 200 `processed` | Billing `active` → `retrying`; mandate `pending` |
| E11 | `subscription.halted` | 200 `processed` | Membership `paused` / `halted` |
| E12 | `subscription.resumed` | 200 `processed` | Mandate → `active`; membership stays `paused`/`halted` until a successful debit |
| E13 | `subscription.paused` | 200 `processed` | Mandate → `paused` |
| E14 | `subscription.cancelled` (customer cancelled the mandate in the UPI app) | 200 `processed` | Membership `cancelled`; 3 unused credits forfeited (one ledger row); 3 unstarted months voided (MEM-09) |
| E15 | Late `subscription.activated` after cancellation | 200 `processed` | None (stays cancelled) |
| E16 | `subscription.completed` | 200 `processed` | None |
| E17 | `subscription.charged` for an unknown subscription | 200 `ignored` | None |
| E18 | `refund.processed`, full refund of the upfront membership payment | 200 `processed` | Payment `refunded`; paid through recalculated to 2026-12-11 |

The renewal debits (E5, E7) add paid months whose credits are granted when each month starts, so the balance did not change at debit time. That matches the monthly-credit design.

Across all 45 cases, no duplicate order, gift code, renewal, credit grant or stock movement was created by a repeated or concurrent event.

## 9. Database verification

Read with `scratch/sandbox/inspect*.mjs` and `facts.mjs`. None of these scripts write.

| Table | Final state in `vishrea_sandbox` |
|---|---|
| `orders` | `3ce62815` processing/paid (₹3,998, `pay_Tyn2Y4NuVXX2rb`); `c09b5825` cancelled; `a4762d21` processing/paid credit pick (₹0, 1 credit, linked to shipment `0d66b2cc`) |
| `invoice_records` | `VS/2026-27/000001` (product ₹3,998), `000002` (membership ₹3,598), `000003` (credit pick ₹0). None for gift purchases or the ₹99 bag fee (see defect 6) |
| `memberships` | sbx-user-1 active/active, 3 credits, paid through 2027-01-11, mandate `sub_Tyn7OIyrqLXOG2`; sbx-user-5 active/prepaid gift, 4 credits; sbx-user-2 pending_payment (abandoned) |
| `credit_ledger` | sbx-user-1: +4 `membership_payment`, −1 `redemption`; sbx-user-5: +4 `gift_membership` |
| `membership_payments` | One `paid` (`pay_TynBQNk6cN29WG`), one `pending` (sbx-user-2) |
| `admin_gift_enquiries` / `gift_memberships` | GE-1001 and GE-1004 `invoiced`; GE-1002 and GE-1003 `pending`. Two codes: one waiting for 18 Nov, one `redeemed` by sbx-user-5 |
| `bag_shipments` | `7685803d` cancelled (failed attempt), `0d66b2cc` paid |
| `product_variants` | `SBX-CHECKOUT-M` stock 17: 20 − 2 (product) − 1 (credit pick). The cancelled order's hold was released |
| `payment_events` | 0 (no webhook registered) |

No database row was edited by hand to make a payment look successful. Every change came from the app's own endpoints.

## 10. Failure and duplicate handling (genuine payments)

| Check | Product | Membership | Gift | Bag |
|---|---|---|---|---|
| Repeat verify with the genuine signature | Idempotent | 200 active, still 4 credits, 1 ledger row | `already_paid`, counts unchanged | 200, unchanged |
| 5 concurrent verifies | Idempotent | Same; 1 paid row | 1 code, 1 email, 1 paid audit | 1 paid shipment, 1 audit |
| Stand-in completion endpoint | 404 | 404 | 404 | 404 |
| Another customer submits the genuine payment | 404 | 404 | 404 | 404 (also `complete_local`) |
| Genuine payment replayed to a different order with a valid HMAC | Rejected | 400 `mandate_not_authorised` | 400 `amount_mismatch` (GE-1002 stays pending) | 400 `amount_mismatch` (old shipment) |
| Start again while already paid/active | — | 409 `membership_already_active` | — | Same idempotency key returns the paid shipment; empty bag returns 400 `bag_empty` |
| Gift redeemed before its start date | — | — | 409 `gift_not_started` ("This gift starts on 18 Nov 2026…") | — |
| Gift code reused (same or other user) | — | — | 409 `gift_already_redeemed`; random or malformed code 400 `invalid_gift_code` | — |

The sandbox app was restarted three times during the fixture setup. Health returned 200 each time, and sandbox records were unchanged afterwards.

## 11. Refund results

- **No genuine Razorpay refund was made.** The app refunds automatically only for duplicate or orphaned payments, and none happened with the genuine payments. The admin "refunded" order status does not call the Razorpay refund API. A real refund is issued from the Razorpay dashboard, and the app then updates through the `refund.processed` webhook.
- Fixture results (§8.2, B7–B10, D2–D4, E18):
  - A full product refund returns stock once and is not repeated on redelivery.
  - Partial refunds are recorded without reversing the order.
  - A membership refund voids the unstarted months it paid for.
  - Duplicate and orphaned payments create a refund claim.
  - Bag shipping and gift refunds are ignored by the handler (defect 7).
- To do before LIVE: one real low-value order refunded from the dashboard, with webhook delivery confirmed (already step 6 of the go-live checklist).

## 12. Evidence

- Screenshots were reviewed live during the run but not saved to the repository, so that no card entry, OTP or key ID is captured. Customer-facing messages are quoted in §6.
- Sanitised evidence on this machine (git-ignored `scratch/sandbox/`): `webhook-fixtures-result.json`, `npm-test.log`, `server.log`. The server log contains development gift links, so do not share it.
- All Razorpay references are listed in §5 and can be checked in the TEST dashboard.

## 13. Tests passed, failed, skipped and blocked

| Item | Result |
|---|---|
| Genuine TEST payments: 4 flows, success + failure + cancel + retry | **Passed** |
| Backend signature checks (§7) | **Passed** |
| Duplicate, concurrency, ownership and replay checks (§10) | **Passed** |
| Signed webhook fixtures (45 cases) | **Passed** (outcomes as designed; observations in §15) |
| `npm test` | **207 passed, 0 failed, 0 skipped** (includes the signature, gateway, payment and webhook suites) |
| `npm run lint` | **0 errors**, 30 warnings (React hook/ref warnings in existing pages, none from this rehearsal) |
| `npm run build` | **Passed** |
| Stand-in still selected for normal QA | **Confirmed** by configuration (`node tests/qa/stack.mjs env`). Newman was not re-run, because the owner asked that the stand-in not be used during this rehearsal |
| Production configuration | **Unchanged**. No application source, `.env*` or config file was edited; all rehearsal scripts are in the git-ignored `scratch/sandbox/` |
| Real webhook delivery, dedup and retry from Razorpay | **Blocked**: needs an HTTPS domain (owner decision) |
| UPI Autopay mandate and the 11 Jan 2027 debit | **Blocked in Test Mode**: the mandate was rehearsed with a test card; real UPI Autopay and scheduled debits need a live, activated account |
| Genuine dashboard refund | **Not run** (see §11) |
| Expired checkout window, network interruption, mobile layout of hosted Checkout | **Not run** in this session |

## 14. Remaining dashboard configuration

1. **Webhook (TEST first, then LIVE).** Once the production or staging HTTPS domain is up:
   - Add `https://<domain>/api/webhooks/razorpay` in **Test Mode**, with the `RAZORPAY_WEBHOOK_SECRET` from the server environment.
   - Subscribe to: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`.
   - Confirm 2xx deliveries and `payment_events` rows. Then repeat with a new secret in **Live Mode**.
2. **Membership plan.** Create the ₹1,799 monthly plan in each mode and set `RAZORPAY_MEMBERSHIP_PLAN_ID`, so the app does not create its own plan.
3. **Business name.** The demo bank page showed the account's registered business name, not "Vishrea Studio". Check the display name in the dashboard settings.
4. **UPI Autopay.** Must be enabled on the live account before launch.
5. **Live keys.** Only on the production host, never in a developer `.env`.

## 15. Defects and observations

No application code was changed during the rehearsal. The pre-production remediation phase later fixed most of these with regression tests: see `docs/testing/PRE_PRODUCTION_REMEDIATION_REPORT.md`. The fixes have not yet been re-run against Razorpay Test Mode.

| # | Area | Finding | Severity | Status after remediation |
|---|---|---|---|---|
| 1 | Gift UI | After a successful purchase the form stays filled and the Pay button stays enabled. A second click opened a new paid checkout (GE-1003, cancelled here). Clear or disable the form after success | Medium | Fixed (browser and server) |
| 2 | Gift / Bag | An invalid payment signature is rejected but not written to the audit log. Product and membership do audit it | Low | Fixed |
| 3 | Membership UI | Says "UPI Autopay set up" when the mandate is a card | Low (copy) | Fixed |
| 4 | Bag UI | "Your 1 pieces are being packed" (plural). The ship-bag form inputs render unstyled | Low | Fixed (styling not checked visually yet) |
| 5 | Membership | Checkout verification relies on the subscription HMAC to bind the payment to the subscription; it does not compare the subscription ID returned by the API. The replay test was still rejected | Low (hardening) | Fixed: invoice → subscription check |
| 6 | Invoices | No `invoice_records` row for gift purchases or the ₹99 bag shipping fee. Owner or accountant to confirm whether these need GST invoices | To confirm | Pending decision D1 |
| 7 | Refunds | `refund.processed` for a bag shipping or gift payment is ignored, so such refunds are not reflected in the app | Low | Fixed (migration 024) |
| 8 | Refunds | The admin "refunded" status does not call the Razorpay refund API; refunds are made in the dashboard | Process note | Unchanged (process) |
| 9 | Mandate cancel | After `subscription.cancelled` voids unstarted months, `paid_through` is not recalculated (fixture E14) | Low | Fixed |
| 10 | Mandate resume | `subscription.resumed` reactivates the mandate, but the membership stays paused until the next successful debit (E12). Confirm this is intended | To confirm | Confirmed intended; locked by a test |
| 11 | Mandate data | The upfront mandate payment row does not store its Razorpay invoice ID, so a later event for that invoice falls back to an API lookup | Low | Fixed (stored at verification) |

## 16. Owner manual payment run (pending)

The sandbox stays up for the owner's own payments in Chrome:

- URL: **`http://127.0.0.1:3200`**
- Sign in as `sbx-user-1@qa.test` … `sbx-user-6@qa.test`. The development code appears on the login page.
- Use only Razorpay's documented Test Mode methods. Netbanking leads to the demo bank page with Success and Failure buttons.
- The sandbox app still runs the build from before the remediation phase. To test the fixes there, apply migration 024 to `vishrea_sandbox` and restart the app (an approved step).
- Current state: sbx-user-1 has an active membership with 3 credits; sbx-user-5 has an active gift membership; sbx-user-2, 3, 4 and 6 have no membership. GE-1001 (for sbx-user-4) starts on 18 Nov 2026.

Results of the owner's run will be added here.
