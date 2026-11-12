# Walkin Wardrobe — membership billing and gap closure (7 Nov 2026)

Source of truth: *Website Requirements Specification v1.0* §5 (MEM-01..16), §8 (loyalty, referrals), §12–15, plus the owner's instructions of 7 Nov 2026 (₹150 referral discount, free piece kept as a separate owner-controlled reward).

Statuses: **IMPLEMENTED** · **PARTIALLY IMPLEMENTED** · **NOT IMPLEMENTED** · **BLOCKED BY EXTERNAL PROVIDER** · **PENDING OWNER APPROVAL**.
"Tested" means an automated test runs it against a real PostgreSQL database and a local Razorpay stand-in; nothing below has been run against live Razorpay.

## 1. Requirement matrix

### Membership (spec §5)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| MEM-01 | ₹3,598 upfront for 2 months + UPI Autopay mandate in the same checkout; ₹1,799/month from month 3 | IMPLEMENTED (tested) · BLOCKED BY EXTERNAL PROVIDER until Razorpay Subscriptions + UPI Autopay are enabled on the account | `lib/billing.js` `startSignup`/`verifyCheckout`/`applyRecurringCharge`; test *acceptance: ₹3,598 once…* |
| MEM-02 | 4 credits/month, 48-h early access (Premium incl.), free batched shipping | IMPLEMENTED (tested) | `lib/catalogue.js` `dropVisibleSql`, `lib/cart.js` `isDropLocked`, `lib/bag.js` |
| MEM-03 | 1 credit = 1 shared-pool piece; never Premium; 4 issued at the start of each paid month | IMPLEMENTED (tested) | existing `isCreditEligible`; `grantDuePeriods` |
| MEM-04 | 60-day expiry, max 8 held, frozen during retry, lapse on cancellation | IMPLEMENTED (tested) | `enforceHoldingLimit` (oldest lapse first), `creditsUsable` |
| MEM-05 | Redeeming a credit sells the piece instantly | IMPLEMENTED (tested) | checkout `shipping_method: 'bag'` → order `in_bag`, stock taken |
| MEM-06 | Wardrobe Bag, "Ship my bag", 4+ free else ₹99 | IMPLEMENTED (tested) | `lib/bag.js`, `bag_shipments`, Wardrobe page |
| MEM-07 | 3 retries / 5 days, WhatsApp reminders, credits frozen, pause after failure | IMPLEMENTED (tested) for state handling · retry schedule is configured in the Razorpay dashboard (BLOCKED BY EXTERNAL PROVIDER) · WhatsApp reminders BLOCKED (no WhatsApp API); email reminder sent | `markRetrying`, `markHalted`, `runBillingJobs` |
| MEM-08 | 1-month pause once every 6 months, no charge/credits, keeps expiry, resets loyalty | IMPLEMENTED (tested) | `requestPause` (mandate paused at gateway; undone if that fails), job starts/ends pause |
| MEM-09 | Cancel after lock-in, ≤2 taps, pause/styled-pick offer, UPI-app cancellation = cancellation | IMPLEMENTED (tested) | `requestCancel`, `markMandateCancelled`, Membership page cancel panel |
| MEM-10 | 6th consecutive paid month → 1 free piece, repeats, reset by pause/missed payment | IMPLEMENTED (tested) as a separate free-piece reward (owner instruction), not a 5th credit | `qualifiesForSixMonthReward`; reset in pause & halted paths |
| MEM-12/13 | Any membership as a gift; "Gift to her" link / "I'll pick for her" | IMPLEMENTED (tested) for pre-booked gifts · gifting an autopay membership: NOT IMPLEMENTED | `startGiftPurchase`, `finalizeGiftPurchase` |
| MEM-14 | Pre-booked months (min 2), no autopay; invite to continue at the end | IMPLEMENTED (tested purchase; ending reminder not tested) | `gift_membership_months` [2,3,6,12]; `gift_ending` notice |
| MEM-15 | ₹50 gift packing per box, no prices on slip, message to staff | IMPLEMENTED (existing, tested) | checkout `gift` |
| MEM-16 | Membership terms page | IMPLEMENTED for new installs · live legal page must be edited in Admin (DB copy wins) | `content/policies.js` |

### Loyalty and referrals (spec §8)

| Item | Status | Notes |
|---|---|---|
| 6th-month free piece | IMPLEMENTED (tested) | Redeemable only on owner-selected pieces/categories (Admin → Settings → Free-piece rewards; empty by default) |
| Referral code, attribution, self-referral, one referrer | IMPLEMENTED (tested, existing) | |
| ₹150 off the first 2 months | IMPLEMENTED (tested) | Spec says ₹100; ₹150 per owner instruction — PENDING OWNER APPROVAL of the spec change |
| Referrer free piece after first payment, once | IMPLEMENTED (tested) | Monthly debits never add more |
| Reward expiry | NOT IMPLEMENTED | Rewards do not expire; no rule given |
| Duplicate-account abuse detection | NOT IMPLEMENTED | Spec tags abuse detection as 1.1 |
| Loyalty & Offers Builder applied in pricing; 6th-order 50% rule | NOT IMPLEMENTED | Rules can be stored but pricing ignores them (unchanged) |

### Gap areas A–J

| Area | Status | What exists now |
|---|---|---|
| A. Payment recovery & mandates | IMPLEMENTED (tested) | Mandate cancel/halt/complete/pause/resume events; failed attempts recorded; recovery with a fresh mandate retires the old one at the gateway; overdue mandates re-synced from Razorpay by the job when a webhook is missed; credits only after gateway confirmation |
| B. Credits & lifecycle | IMPLEMENTED (tested) | Separate `status` / `billing_status` / frozen credits; expiry kept during pause; non-negative balance (DB check); cancellation stops billing, keeps orders |
| C. Reward engine | PARTIALLY IMPLEMENTED | See loyalty table |
| D. Inventory concurrency | IMPLEMENTED (existing, tested) · status values reserved/exchanged/returned: PARTIAL | New: before/after stock audit (`inventory_adjusted`) |
| E. Exchanges & refunds | PARTIALLY IMPLEMENTED | New: damage claims require photos; customer emailed on every status change; refund notice. Missing: stock reconciliation after exchange/return |
| F. GST & invoices | PARTIALLY IMPLEMENTED | Every membership debit invoiced (tested); invoice numbers shown to members; CSV exports for membership payments, autopay attempts, bag shipments. Missing: PDF invoices, credit notes, invoice for the ₹99 bag fee and online gifts |
| G. Notifications | PARTIALLY IMPLEMENTED | Central `notify()` with templates, preferences, marketing consent, dedupe and a `notifications` log; email via Resend. WhatsApp: BLOCKED BY EXTERNAL PROVIDER (logged as `provider_not_configured`) |
| H. Admin audit & permissions | PARTIALLY IMPLEMENTED | Audit coverage extended. Missing: Owner/Helper role split, admin 2FA (NFR-03/SEC-05) |
| I. Customer account | IMPLEMENTED | Next debit, mandate status, frozen credits, payment + invoice history, autopay attempts, pause/cancel history, notification preferences, self-service deletion (stops billing, revokes sessions) |
| J. Loyalty & Offers Builder | NOT IMPLEMENTED | Unchanged |

## 2. Changed files

New: `lib/billing.js`, `lib/bag.js`, `migrations/018_membership_rules_correction.sql`, `migrations/019_membership_billing_engine.sql`, `test/walkin-wardrobe.test.js`, this document.
Backend: `api/{account,cart,catalogue,checkout,exchange,gifting,membership,product,wardrobe}.js`, `api/admin/ops.js`, `api/webhooks/razorpay.js`, `lib/{cart,catalogue,gifts,membership,notify,payments,pricing,products-admin,razorpay,referrals,seo,settings}.js`, `server.js`.
Frontend: `pages/{Membership,Wardrobe,Checkout,Gifting,Account,Admin,AdminExtras,Home}.jsx`, `lib/payments.js`, `content/{faqs,policies}.js`, `index.css`.
Tests: `test/helpers.js` (Razorpay plans/subscriptions/invoices stand-in), `test/remediation.test.js`, `test/platform.test.js`.

## 3. Migrations

- **018** — 6th-month rule → consecutive months; `renewal_grace_days` 5; backfill of referrers missed under the old rule.
- **019** — `billing_status`/`mandate_status`/lock-in/pause columns; `billing_plans`, `membership_subscriptions`, `membership_payment_attempts`, `membership_events`, `bag_shipments`, `notifications`; order status `in_bag`; online-gift columns; settings `membership_plan_months` = [2] (6-month prepaid sign-up retired), `membership_lock_in_months` 2, `credit_holding_limit` 8, `pause_length_months` 1, `autopay_retry_count` 3, `autopay_retry_days` 5, `subscription_total_count` 120, gift durations [2,3,6,12]. Existing prepaid members are marked `billing_status = 'prepaid'` and keep their paid months.

Both are forward-only and idempotent. Applied to the staging database on 7 Nov 2026; **not** applied to production.

## 4. API and webhooks

`POST /api/membership`
- `start_checkout {months}` → `{amount, monthly_amount, first_debit_at, razorpay:{key_id, subscription_id}}`; reuses an unanswered request for 30 min.
- `activate_paid {razorpay_subscription_id, razorpay_payment_id, razorpay_signature}` → verifies the HMAC, fetches payment and subscription from Razorpay, checks amount; 503 `payment_confirmation_pending` if the gateway is unreachable (the webhook completes it).
- `recover` (after every retry failed) → new mandate, first month charged immediately.
- `pause` · `resume` · `cancel {reason?}` (409 `pause_in_lock_in` / `in_lock_in`).
- `GET` adds `billing` (status, mandate, next debit, lock-in, frozen credits, retry policy, can_pause/can_cancel, recovery_available), `attempts`, `history`.

`POST /api/wardrobe` `ship_bag {shipping_method, shipping_address, idempotency_key}` · `confirm_bag_payment {...razorpay}`; `GET` adds `bag`.
`POST /api/checkout` accepts `shipping_method: 'bag'` (credit/free-piece picks only).
`POST /api/gifting` `purchase {gift_mode, membership_months, ...}` · `confirm_payment {...razorpay}`.
`POST /api/account` `delete_data {confirm:'DELETE'}`; `PUT` accepts `notifications {whatsapp,email,sms,marketing}`.
`GET /api/admin/ops?section=export&type=membership_payments|payment_attempts|bag_shipments`.

Webhook `POST /api/webhooks/razorpay` (HMAC over the raw body, replay-safe via `payment_events`):
`payment.captured` (orders, membership, bag, gift, subscription payments via invoice) · `payment.failed` (records subscription attempts) · `subscription.authenticated|activated|charged|pending|halted|cancelled|completed|paused|resumed` · `refund.processed`.
Subscribe all of these in the Razorpay dashboard.

## 5. Security review (this change)

- Credits are issued only after the server confirms the payment with Razorpay or receives a signed webhook; a browser success alone never activates anything (tested: forged signature, wrong amount, another customer's mandate).
- All money amounts come from the server; gateway amounts are compared before capture; duplicate events, concurrent verify + webhook, and replays apply once (tested).
- A debit received after cancellation is marked `refund_required`, never converted into membership time (tested).
- A pause that cannot be applied at the gateway is rolled back, so no debit happens while the member believes she is paused (tested).
- Unpaid online gifts cannot be invoiced or issued a code by an admin (tested).
- Member-only (early-access) responses are `Cache-Control: private` and excluded from the sitemap.
- **Finding:** the confidential specification PDF is in the working tree under `docs/specifications/` and untracked; the spec forbids publishing it — do not commit it to any shared repository.
- Not changed and still open: admin 2FA, Owner/Helper separation, in-memory rate limiting (single process), RLS (not used — the app connects as one server role).

## 6. Automated test results

`npm test` on 7 Nov 2026 against a local PostgreSQL 18: **140 tests, 140 passed, 0 skipped**. New or rewritten scenarios include: upfront + mandate, month-3 debit, three failed retries with frozen credits, pause after exhausted retries, recovery and reactivation, retry success keeping the cycle aligned, one-month pause, gateway pause failure, cancellation after lock-in, UPI-app cancellation, 8-credit limit, 48-h early access (catalogue, product, cart, checkout, sitemap), Wardrobe Bag thresholds and verified ₹99 payment, 6th-month reward once, referral ₹150 and single reward, duplicate/delayed webhooks, gift modes, notifications log and dedupe, account deletion, admin export permission.

## 7. Integration verification

| Integration | Verified | How |
|---|---|---|
| Razorpay Subscriptions / UPI Autopay | **No** | Only against the local stand-in. Needs a sandbox run (see checklist). |
| Razorpay one-off orders (bag fee, gifts) | Stand-in only | Same order flow as existing checkout |
| Resend email | Not in this change | Templates logged; real sending depends on the verified sender domain |
| WhatsApp Business API | **No** | Not integrated; every message is logged as skipped |

## 8. Remaining blockers

1. Razorpay must enable Subscriptions and UPI Autopay on the account and confirm: an upfront **add-on charged at authorisation** with a **future `start_at`** for UPI mandates; the mandate amount ceiling; retry configuration of 3 attempts over 5 days; and whether `subscription.charged` is also sent for the authorisation payment (the code handles both).
2. Pausing is refused during the 2-month lock-in because Razorpay can only pause an *active* subscription; confirm whether the owner wants pauses during lock-in.
3. WhatsApp Business API (number +91 6364116567) for reminders and gift links.
4. Accountant to confirm GST on the membership (18% assumed), the ₹99 bag fee and gift memberships.

## 9. Deployment checklist (do not deploy without approval)

1. Razorpay dashboard: enable Subscriptions + UPI Autopay; set retries; add webhook events listed in §4; keep `RAZORPAY_WEBHOOK_SECRET` in the host's secret store.
2. Sandbox rehearsal with test keys: join, verify ₹3,598 + mandate, wait for (or trigger) the month-3 debit, fail a debit, cancel from a UPI app.
3. Back up production; run `npm run migrate` (018, 019).
4. Admin → Settings: choose free-piece eligible pieces/categories; review lock-in, holding limit, retries; edit the live Membership terms page.
5. Deploy the server and the built storefront; confirm `/api/health`; watch `jobs.billing_failed` logs.
6. Existing prepaid members keep their months and are offered autopay when they end.

## 10. Needs the owner's decision

- ₹150 (instruction) vs ₹100 (spec) referral welcome discount.
- Free piece as a separate reward on chosen pieces (instruction) vs a 5th credit (spec MEM-10).
- Retiring the 6-month prepaid sign-up (spec has only 2 months upfront + monthly).
- Pause during the lock-in; reward expiry; whether early resume from a pause is allowed (implemented).
- Gifting an autopay (non-prepaid) membership.
- Phase-2 items requested in the gap list but not built here: Loyalty & Offers Builder in pricing, 6th-order 50%, PDF invoices and credit notes, exchange stock reconciliation, Owner/Helper roles, admin 2FA.
