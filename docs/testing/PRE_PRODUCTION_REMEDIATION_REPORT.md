# Pre-production remediation report

Date: 2026-11-11. Scope: the findings in `docs/testing/RAZORPAY_SANDBOX_REHEARSAL.md` §15.

- Nothing was committed, pushed or deployed.
- No production secret, domain, live Razorpay setting, customer mandate or admin account was touched.
- No webhook was registered and no tunnel was created.
- The membership price and billing model are unchanged.

The evidence is the automated test suite, which uses an in-process test gateway. The local Razorpay stand-in is **not** used as evidence of genuine gateway behaviour. The sandbox and Razorpay Test Mode validation of these fixes is in §7.

## 1. Fixed

| # | Finding | Fix | Regression tests (`test/pre-production-remediation.test.js` unless stated) |
|---|---|---|---|
| 1 | **Gift double purchase.** After a paid gift the form stayed filled with Pay enabled; a second click opened a new paid checkout | **Browser** (`Gifting.jsx`): after payment the form is replaced by a "Gift paid — thank you" panel. "Buy another gift" opens an empty form (only the buyer's phone, gift type and length are kept) with a new submission key. A synchronous in-flight guard blocks a second submit before re-render. **Server** (`lib/gifts.js`): the submission key of a paid gift returns **409 `gift_already_paid`**. Concurrent submits with one key create one enquiry and one Razorpay order (the insert is conflict-safe instead of failing with a 500). Another customer's key returns **409 `submission_key_in_use`** | "the submission key of a paid gift cannot open a second checkout"; "concurrent submits with one key create one gift and one gateway order"; "another customer cannot reuse someone else's submission key"; unit test "after a paid gift the form is emptied…" |
| 2 | **Refunds of gifts and bag shipping fees were ignored** by `refund.processed` | New migration `024_gift_bag_refunds.sql`:<br>• Table `payment_refunds`: one row per Razorpay refund ID.<br>• `refunded_amount_paise`, `refund_status` (`partial` / `refunded`) and `refunded_at` columns on gift enquiries and bag shipments.<br>Each refund counts once, even when redelivered under a new event ID.<br>**Gift:** a full refund revokes unredeemed codes and blocks reissuing (409 `gift_refunded`). A membership already activated from the gift is **kept** and flagged with audit `gift_refund_after_redemption` (pending decision D2).<br>**Bag:** only the fee is refunded; stock, credits and fulfilment are unchanged.<br>The customer gets a `refund_processed` notification that names the gift or the bag fee | "a full refund revokes the unredeemed code, counts once, notifies the buyer and blocks reissue"; "a partial refund is recorded without revoking; a second partial … marks it refunded"; "a refund after the gift was redeemed keeps the membership and flags it"; "a revoked code cannot be redeemed"; "a full fee refund is recorded once; stock, credits and fulfilment are unchanged"; "a partial fee refund is marked partial" |
| 4 | **Membership verification** relied on the HMAC alone to bind the payment to the subscription | `verifyCheckout` (`lib/billing.js`) now fetches the payment's invoice from Razorpay. The invoice's `subscription_id` must equal the checkout's subscription, and its `payment_id`, when present, must equal the payment. This runs before capture. Otherwise: **400 `payment_subscription_mismatch`** and audit `membership_payment_mismatch`. The invoice ID is now stored on the upfront payment row (fixes the earlier finding that it was missing). The field shape was checked read-only against the genuine TEST payment `pay_TynBQNk6cN29WG`: the payment has `invoice_id`, and the invoice names `sub_Tyn7OIyrqLXOG2` | "a payment whose invoice names another subscription is refused, even with a valid signature"; "a payment with no subscription invoice is refused"; "the genuine mandate payment activates and its invoice id is stored"; existing membership suites unchanged |
| 5a | **`paid_through` not recalculated after cancellation**, so an admin could reactivate months that were already voided | `cancelMembershipTx` now recalculates `paid_through` / `renewal_at` from the months that are not voided. This uses the shared `syncPaidThrough` (`lib/membership.js`), which the membership-refund path now also uses. The month in progress stays paid; credits, forfeiture and voiding rules are unchanged | "cancellation moves paid-through to the end of the month in progress; that month is kept"; "a mandate cancelled from the UPI app also recalculates paid-through"; existing "cancellation … admin cannot reactivate" (`test/remediation.test.js`) still passes |
| 5b | **`subscription.resumed` after a halt** left the membership paused | Investigated; **no code change**. A halted membership is restored only by money: a successful debit, or a recovery mandate (`startRecovery`). The customer-pause resume paths (`requestResume`, the pause-end job) reactivate the membership themselves; the webhook only syncs the mandate. Locked in with a test | "subscription.resumed after a halt resumes the mandate only; the membership waits for a successful debit" (credits stay frozen) |
| 6 | **Invalid gift and bag signatures were not audited** | `gift_payment_signature_invalid` and `bag_payment_signature_invalid` are written with the customer, the record and the payment ID, plus a warning log line. This matches the product and membership flows | "gift and Wardrobe Bag confirmations with a forged signature are refused and audited" |
| 7 | **Copy** | The mandate status now reads "Autopay set up" / "Autopay active" (a mandate can be a card). The bag message reads "Your 1 piece is being packed" / "Your N pieces are being packed" (`vishrea-react/src/lib/customerCopy.js`). The ship-bag form now uses the existing `checkout-form` class, so it gets the site's standard label and input styles. On phones that class made the inputs too wide (found in §7.3); three scoped rules under `.bag-panel .bag-form` in `index.css` let the fields shrink to their column | Unit tests "mandate status never claims UPI…" and "the Wardrobe Bag message is singular…". Styling checked in a browser on desktop and at 400 px (§7.3) |

Supporting changes:
- `test/helpers.js`: the in-process gateway's `/__checkout` now creates an invoice for the payment, as Razorpay does.
- `tests/qa/razorpay-standin.mjs`: the QA stand-in creates invoices for mandate payments and serves `GET /invoices/{id}`, so normal QA membership checkout keeps working with check 4.

## 2. Investigated, not changed: invoices (finding 3)

The app writes `invoice_records` for product orders (`VS/yyyy-yy/nnnnnn`, goods GST per line) and membership payments (membership GST rate, intra-state). It writes none for:

- **Online gift purchases.** `calculateMembershipPrice` already computes the membership GST rate, taxable value and tax for the gift price, but no invoice number is issued. The enquiry's `invoice_reference` is set to the Razorpay payment ID, and its status reads `invoiced`.
- **The ₹99 Wardrobe Bag shipping fee.** `bagShipmentFee` already computes tax at the lower goods rate (`gst_rate_low`), GST-inclusive, but no invoice is issued. The credit-pick order behind it has a ₹0 invoice.

No invoice logic was added, because the GST treatment is not a coding decision. See decision D1.

## 3. Pending owner / accountant decisions

| # | Decision | Options |
|---|---|---|
| D1 | **GST invoices for gift purchases and bag shipping fees** | (a) Gift: issue a GST invoice at purchase, like a membership payment (membership rate, SAC to be confirmed), **or** treat it as a voucher, invoiced at redemption under voucher time-of-supply rules. (b) Bag fee: a separate invoice at the goods rate already used in pricing, or a supplementary line on the credit-pick order's invoice. Implementation is small once the rule is confirmed |
| D2 | **A gift refunded after it was redeemed** | Currently the membership is kept and the refund is flagged. Alternatives: end the gift membership, or void its unstarted months, as a membership refund does |
| D3 | **Refunds for already-shipped bag fees** | Currently only the fee is marked refunded; no order or stock change. Confirm that this is the intended policy |
| D4 | **Mandate copy** | Neutral "Autopay" wording was used. If only UPI mandates are to be offered, the dashboard payment methods should be limited to UPI instead |

## 4. Remaining launch blockers (unchanged by this phase)

1. **Real Razorpay webhook delivery** has not been verified. Register a TEST Mode webhook on the HTTPS staging or production domain and confirm deliveries before switching to live keys. This includes `refund.processed`: in §7.5 the refunds were genuine, but the delivery was a local signed post.
2. **Gateway-to-app refund delivery.** Two genuine Test Mode refunds were issued through the Razorpay TEST API, not the Dashboard (§7.5). Razorpay delivering the resulting `refund.processed` to the app is still unverified and depends on item 1.
3. Owner actions in `docs/production/FINAL_GO_LIVE_CHECKLIST.md` §3: production secrets, live keys, Resend, legal details, backup, release approval.
4. Decision D1 before taking real gift or shipping-fee payments, if GST invoices are required for them.

## 5. Test results

| Check | Result |
|---|---|
| `node --test test/pre-production-remediation.test.js` | **19 passed, 0 failed** |
| `npm test` | **226 passed, 0 failed, 0 skipped** (was 207; +19 new) |
| `npm run lint` | **0 errors**, 30 warnings (unchanged; none in the changed files) |
| `npm run build` | **Passed** |
| Browser check of the new gift panel and bag form | Done in §7.3 |
| Genuine Razorpay Test Mode re-run of the changed flows | Gift, bag and refunds done in §7.4–7.5. Membership was started but no payment exists. Three read-only checks found it unpaid (§7.7) |

After the post-remediation validation (§7: the allow-list hardening and the bag-form CSS fix):

| Check | Result |
|---|---|
| `npm test` | **226 passed, 0 failed, 0 skipped** |
| `npm run lint` | **0 errors**, 30 warnings (the same existing warnings) |
| `npm run build` | **Passed** (rebuilt after the CSS fix) |

## 6. Risks and follow-ups

- **Migration 024 must run before the new code.** `npm run migrate` on each database (sandbox, QA, production) before restarting the app; otherwise `refund.processed` for a gift or bag fee will fail and Razorpay will keep retrying it. It is additive only.
- **Running processes:**
  - The sandbox app on `:3200` was migrated and restarted on the new code (§7.2).
  - The QA app on `:3100` and QA stand-in on `:3190` still run the old server code. Both serve the shared `vishrea-react/dist` build.
  - The new membership check needs the updated stand-in (invoice support). Restart both QA processes together.
- **Membership check depends on Razorpay's invoice link.** Verification makes one extra read call to Razorpay (`GET /invoices/{id}`). If that call is unavailable, the checkout stays `pending_confirmation`, which already happens when Razorpay can't be reached, and the signed webhook completes it. Re-run one genuine TEST membership checkout to confirm.
- **Refund events the handler still ignores:** a `refund.processed` for a duplicate or orphaned payment that was never stored on a gift or shipment (for example, a fee paid for a superseded shipment). Those refunds are tracked as `duplicate_refund` claims in `payment_events`.
- **A refunded gift or bag fee keeps its main status.** After a full refund the gift enquiry still reads `invoiced` and the bag shipment still reads `paid`; the refund is held in `refund_status` / `refunded_amount_paise`. Since §7.6 the customer's gift list, the admin gift screens and the bag CSV show it.

## 7. Post-remediation validation (2026-11-11)

Only the local sandbox was used: app `127.0.0.1:3200`, database `vishrea_sandbox` on local PostgreSQL `127.0.0.1:55432`, `rzp_test_` keys, Resend off, `ALLOW_REMOTE_DATABASE=false`.

- No production database, live key, webhook registration, tunnel, deployment, commit or push.
- No change to membership pricing, the billing model, existing mandates or the four admin accounts.
- No customer data or media was deleted.

### 7.1 Diff review

- Only the remediation files listed in §1 changed. `.env` and the configuration are untouched.
- **SQL:** all values are parameterised. One hardening was made: `applyEntityRefund` (`lib/payments.js`) put the table name into the SQL. It now refuses any table or entity type outside a fixed allow-list (gift enquiries and bag shipments).
- **Refund matching:**
  - Refunds are matched by `provider_payment_id` under `FOR UPDATE` row locks.
  - Each refund is counted once by its Razorpay refund ID (`payment_refunds`, `ON CONFLICT DO NOTHING`).
  - The refunded total is capped at the amount paid.
- **Authorisation:** refunds are applied only from the signature-checked webhook. No customer or admin endpoint writes refund state.

### 7.2 Sandbox backup and migration

- **Database check:** the database was identified before any change. It is `vishrea_sandbox`, 7 profiles, all `@qa.test`.
- **Backup:** `pg_dump` to `scratch/sandbox/backups/vishrea_sandbox_pre024_20261111.dump` (177,453 bytes, SHA-256 starting `D2F0D9F9EAB3F814`).
  - It was restored into a throw-away database and compared: 61 tables and 246 rows, no differences.
  - The throw-away database was then dropped.
- **Migration 024:**
  - Applied to the sandbox only, at 2026-11-11T09:11:38Z.
  - A second run reported "Already applied".
  - Running the SQL twice inside a rolled-back transaction succeeded, so it is idempotent.
  - The table, columns, constraints and indexes were verified.
- **Restart:** only the sandbox app was restarted. The QA app (`:3100`) and stand-in (`:3190`) were not touched.

### 7.3 Browser checks

Desktop Chrome, isolated profile, signed in as `sbx-user-1`. Screenshots are in `docs/testing/evidence/post-remediation/`.

| Check | Result | Evidence |
|---|---|---|
| Wardrobe Bag form styling, desktop | **Pass.** Standard labels and inputs, three columns | `01-bag-form-desktop.png`, `09-bag-form-desktop-after-fix.png` |
| Wardrobe Bag form, phone (DevTools, 400 px wide) | **Failed, then fixed.** The `checkout-form` input sizing forced a three-column, 560 px form; the page grew to 635 px, the heading was cut off and the fields ran off-screen. Removing the class in DevTools proved the cause. After the CSS fix: page 400 px, one 307 px column, 16 px inputs (49 px tall), no overflow. Desktop is unchanged | `07-bag-form-mobile-overflow.png`, `08-bag-form-mobile-fixed.png` |
| Gift form, phone (400 px) | **Pass.** Single column, no overflow; the "Payment not completed. Nothing was charged." message is readable | `06-gift-mobile-cancelled.png` |
| Bag paid message | **Pass.** "Your 1 piece is being packed." | `02-bag-paid-copy.png` |
| Rapid repeated clicks | **Pass.** Bag: the button disabled itself ("Working…") and exactly one shipment was created. Gift: three quick clicks on Pay created exactly one enquiry (GE-1005) and one Razorpay order | Database check |
| Failed payment and retry | **Pass.** First attempt with the TEST bank's Failure option: payment failed, and Razorpay offered a retry. The retry succeeded on the same order | `03-gift-payment-failed.png` |
| Gift success panel | **Pass.** "Gift paid — thank you. QA Gift Recipient Seven will receive an email with her activation link." with a "Buy another gift" button; the paid form is gone | `04-gift-success-panel.png` |
| "Buy another gift" | **Pass.** Recipient fields cleared; gift type, length and the buyer's phone kept (`05-gift-buy-another-reset.png`). The next Pay created a new enquiry, GE-1006, with a different submission key (key prefix `2d878e39`, against GE-1005's `03ac8c8e`). That checkout was cancelled and GE-1006 stays `pending` | Database check |
| Membership checkout after the invoice check | **Not completed.** See §7.4 | |

### 7.4 Genuine Razorpay Test Mode payments

All payments were made on Razorpay's hosted TEST checkout, which showed the "Test Mode" banner, with the TEST bank page. Payment status on Razorpay was read back through the TEST API.

| Flow | Razorpay IDs | Result |
|---|---|---|
| Wardrobe Bag shipping (₹99) | `order_TyofFOCDKAsnLY` → `pay_Tyog8SRtR2nMpr` captured (netbanking) | Shipment `10c59dfb` paid; its order moved from `in_bag` to `processing`. Stock and credits unchanged by the payment |
| Gift, failed attempt | `order_Tyoiaz4jwWvK4N` → `pay_Tyojx2wLsPrjdZ` failed | GE-1005 stayed unpaid |
| Gift, retry (₹3,598) | same order → `pay_Tyolxm2cPBmYOo` captured | GE-1005 paid; one gift code issued; audits `gift_purchase_paid`, `gift_token_issued` |
| Membership (`sbx-user-3`) | `sub_TyozKnP9v4rOPX`, invoice `inv_TyozLSCftm3XVd` (₹3,598, `issued`) | **Not completed.** The hosted checkout opened correctly (₹3,598 now, then ₹1,799 a month). Mandate authorisation needs payment credentials, which the owner enters. As of 16:35 IST both the subscription and the membership are still unpaid (§7.7) |

The invoice and subscription check is covered by the automated tests in §1 (finding 4). Genuine Test Mode activation through it has **not** been verified yet.

### 7.5 Genuine Test Mode refunds and the `refund.processed` handler

**Refunds:** two genuine full refunds were issued with the TEST key through the Razorpay API (`POST /payments/{id}/refund`), as the owner approved. They were not issued from the Dashboard. Razorpay then reported both refunds `processed` and both payments `refunded` / `full`.

| Refund | Payment | Amount |
|---|---|---|
| `rfnd_Typh6HYJhTY0nV` | gift `pay_Tyolxm2cPBmYOo` | ₹3,598 |
| `rfnd_Typh90dvsCIr8b` | bag `pay_Tyog8SRtR2nMpr` | ₹99 |

**Delivery — not Razorpay delivery:** no webhook is registered and no tunnel exists, so Razorpay could not deliver the event. Instead, `scratch/sandbox/post-refund-webhook.mjs` posted a `refund.processed` body to the sandbox webhook endpoint, signed with the sandbox webhook secret (the secret was not printed). The body contains the genuine refund and payment entities, fetched back from Razorpay.

| Delivery | Gift | Bag |
|---|---|---|
| First delivery (event ID 1) | 200 `processed`:<br>• one `payment_refunds` row<br>• GE-1005 `refund_status = refunded`, `refunded_amount_paise = 359800`, `refunded_at` set<br>• the issued code became `revoked` by `razorpay_webhook`<br>• audit `gift_refunded`<br>• refund notice recorded once (email skipped: Resend off) | 200 `processed`:<br>• one `payment_refunds` row<br>• shipment `refund_status = refunded`, `9900`<br>• audit `bag_shipping_refunded`<br>• notice recorded once |
| Same event ID again (a Razorpay retry) | 200 `duplicate: true`; nothing changed | 200 `duplicate: true`; nothing changed |
| New event ID, same refund | 200 `already_refunded`; no second row, audit or notice | 200 `already_refunded`; no second row, audit or notice |

**Unrelated records:** compared with the snapshot taken before the browser checks (`scratch/sandbox/baseline.mjs compare`), every change traces to a step above:

- **Bag picks:** `sbx-user-1` credits went 3 → 1, `SBX-CHECKOUT-M` stock 17 → 15, two credit orders and two ₹0 invoices. These come from two credit bag picks, one for the paid shipment and one for the phone layout check.
- **Gifts:** GE-1005 (paid, then refunded) and GE-1006 (pending).
- **Bag shipment:** `10c59dfb`, paid and then fee-refunded.
- **Membership:** `sbx-user-3`'s pending membership and subscription.

No other customer, membership, order, credit balance or stock row changed. The refunds did not change the bag's order, stock or credits.

### 7.6 Follow-up fixes after validation

Recording the refunds worked, but nothing displayed them:

- **Customer:** a refunded gift appeared as `invoiced` in the buyer's account.
- **Admin:** the gift screens showed no refund and still offered "Generate redemption code". The server already refuses that with 409 `gift_refunded`.
- **Bag CSV:** the shipments export had no refund columns.

Fixes (display only; no refund policy changed):

| File | Change |
|---|---|
| `api/gifting.js` | The customer gift list returns `refund_status` |
| `vishrea-react/src/pages/Account.jsx` | Gift enquiries show "refunded" or "… · partly refunded" |
| `vishrea-react/src/pages/AdminExtras.jsx` | The gift list and detail show a refunded / partly refunded badge and the refunded amount and time. "Generate redemption code" is hidden for a fully refunded gift |
| `api/admin/ops.js` | The bag shipments CSV adds `refund_status`, `refunded_amount_paise` and `refunded_at`. **Existing bug fixed:** every admin CSV wrote timestamps as JSON-quoted text (`"2026-…"` inside the cell); they are now plain ISO values |

**Tests:** the full gift refund and full bag fee refund tests now also check:

- the buyer's gift list and the admin gift list return `refunded`;
- the CSV refund columns;
- a plain ISO timestamp in the CSV.

`npm test` 226/226, lint 0 errors (30 existing warnings), build passed.

**Sandbox check:** after restarting only the sandbox app, the API was called as `sbx-user-1` and the sandbox QA admin.

- GE-1005 shows `refund_status: refunded` to its buyer and in the admin gift list (₹3,598 refunded).
- The bag CSV row for `10c59dfb` reads `refunded`, `9900`, `2026-11-11T10:20:24.763Z`.

**Visual check in the browser:** done in Chrome on the sandbox, signed in as the sandbox QA admin. Phone width means DevTools device mode at 400 px.

| View | Result | Evidence |
|---|---|---|
| Customer gift list (`sbx-user-1`) | GE-1005 reads "refunded" | `11-customer-gift-refunded.png` |
| Admin gift list, desktop | GE-1005 reads "invoiced" with a REFUNDED badge | `12-admin-gift-list-refunded-desktop.png` |
| Admin gift detail, desktop | REFUNDED badge and "Razorpay refunded ₹3,598 on 11 Nov 2026, 3:50 pm." No "Generate redemption code" button | `13-admin-gift-detail-refunded-desktop.png` |
| Admin gift list, phone | The table scrolls sideways, as before. In the status column GE-1005 shows "invoiced" with the REFUNDED badge underneath | `14-admin-gift-list-refunded-mobile.png` |
| Admin gift detail, phone | Badge, amount and time readable inside the modal | `15-admin-gift-detail-refunded-mobile.png` |

Two more display fixes came out of this check (CSS only; `npm test` 226/226, lint 0 errors / 30 existing warnings, build passed):

- **Badge style.** The admin `.status good/warn/bad` classes have no CSS, so a plain "refunded" word blended into the status text. The badge now uses a small outlined `.refund-flag` style.
- **Admin modals on phones (existing issue).** `.form-grid` used `1fr 1fr`, which cannot shrink below the inputs' natural width. At 400 px the grid was 357 px inside a 304 px card, so every full-width row ran 9 px past the screen and long text was cut off (for example the recipient email). It now uses `minmax(0, 1fr)`, and fields and inputs have `min-width: 0`. After the fix the columns are 144 px each, everything fits in the card, and desktop is unchanged. Only the redemption-codes data table is wider than the card, and it scrolls.

**Also checked, no change needed:** pressing "Join" again reuses a pending, unauthorised membership subscription for the same amounts (`lib/billing.js`) rather than creating a new one.

### 7.7 Membership verification for `sbx-user-3` (`sub_TyozKnP9v4rOPX`)

The owner reported that the TEST membership authorisation was completed. `node scratch/sandbox/verify-sbx3-membership.mjs` was run three times: 16:01, 16:20 and 16:35 IST. It only reads, from the Razorpay TEST API and the sandbox database. Nothing was activated, edited or paid again.

**All three runs found no payment.** The latest run, 16:35 IST:

- **Razorpay subscription:** `created`. `auth_attempts` 0, `paid_count` 0, no payment method. Plan `plan_TymkWl7cdnDZlS` at 179,900 paise, 120 cycles, first charge set for 2027-01-11.
- **Razorpay invoice `inv_TyozLSCftm3XVd`:** `issued`, 359,800 paise, `subscription_id` = `sub_TyozKnP9v4rOPX`, `payment_id` null, `paid_at` null.
- **Razorpay account:** no payment of any kind since 15:00 IST (`scratch/sandbox/recent-activity.mjs`).
- **Sandbox database:**
  - one membership, `pending_payment` / `pending_authorisation`, 0 credits;
  - one subscription row, `created`;
  - one `pending` ₹3,598 upfront payment row with no payment or invoice ID;
  - no periods, credit grants, GST invoice rows, webhook events or notifications;
  - membership events: only `mandate_requested`;
  - no `payment_subscription_mismatch` audits.

The incognito window where the checkout runs still showed Razorpay's EMandate (HDFC) form with empty fields and "Please enter a valid account number" (`10-membership-checkout-not-submitted.png`). The authorisation was most likely never submitted.

| # | Check | Result |
|---|---|---|
| 1 | ₹3,598 payment captured | **Not verified.** No payment exists |
| 2 | The payment carries an invoice ID | **Not verified.** No payment |
| 3 | The invoice's `subscription_id` is `sub_TyozKnP9v4rOPX` | Matches on the issued invoice. Not tied to any payment yet |
| 4 | The invoice's `payment_id` matches the payment | **Not verified.** The invoice has no payment |
| 5 | Membership active | **Not done.** `pending_payment` |
| 6 | Exactly four credits | **Not done.** 0 credits, no grants |
| 7 | Payment row paid, ₹3,598, with payment ID | **Not done.** `pending`, no payment ID |
| 8 | Invoice and subscription IDs stored on the payment | **Not done** |
| 9 | Monthly ₹1,799 | Correct in Razorpay (179,900), the subscription row and the membership. Billing dates not set, as expected before payment |
| 10 | GST invoice record | **Not done.** None |
| 11 | Webhook or verification events | **Not done.** None |
| 12 | No duplicate subscription, membership or credits, and no unrelated changes | **Pass.** One of each, no extra grants, no other customer or order changed |

**Script fix:** `persisted_invoice_id_matches` reported `true` when there was no payment, because two missing values compared equal. It now needs a real invoice ID on the payment; the corrected script reports `false`.

**Status:** genuine Test Mode membership activation through the invoice check is **still unverified**. Next step: the owner submits the TEST mandate in the open incognito checkout, using Razorpay's documented TEST credentials, and then the script is run again.
