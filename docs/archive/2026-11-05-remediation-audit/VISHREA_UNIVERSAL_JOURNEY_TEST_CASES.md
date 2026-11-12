# Vishrea Studio — Universal Journey Test Cases (V1 / Release 1.0)

> Companion to `VISHREA_UNIVERSAL_APPLICATION_AUDIT.md`. Requirement IDs refer to the requirement catalogue in that document (§3). Defect IDs refer to its defect register (§17).
>
> **Evidence sources used in the Status column**
> - **AUTO** — the project's own suite (`npm test`): 78 tests, 13 suites, 0 failures, run against an isolated throw-away PostgreSQL 18 cluster on `127.0.0.1:55432` with a local Razorpay stand-in (`test/helpers.js`).
> - **PROBE** — audit-specific probes (`P01`–`P20`) run through the same harness; script kept outside the repository at `%TEMP%\vaudit\probe.test.mjs`. Results are quoted verbatim in the audit report §16.
> - **HTTP** — direct `curl` / `Invoke-WebRequest` requests against an isolated app instance (`http://localhost:3100`, own seeded database `vishrea_audit`).
> - **BROWSER** — interactive checks in the Cursor browser against the same isolated instance.
> - **CODE** — static trace only (stated explicitly; never counted as PASS on its own for a user journey).
> - **LIVE-RO** — read-only `BEGIN READ ONLY` queries against the configured live Supabase database.
>
> No live payment, real email, or production write was performed.

---

## 1. Customer journey — discovery and catalogue

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-CUS-001 | Home | Visitor, signed out | Open `/` | Hero, categories, new arrivals, membership strip, request strip render; HTTP 200 | HTTP 200; server-rendered title/canonical; featured grid from API | `Home.jsx` | `GET /api/catalogue?featured=true&limit=4`, `GET /api/content` | `products`, `feedback_videos`, `instagram_content` | PASS (HTTP, BROWSER) | — |
| TC-CUS-002 | Catalogue | Visitor | Open `/catalogue` | Grid of active products with count | 9 demo pieces, count shown | `Catalogue.jsx` | `api/catalogue.js` | `products ⨝ product_variants` (variant_count > 0) | PASS (HTTP, BROWSER) | — |
| TC-CUS-003 | Catalogue search | Visitor | Search “dress” | URL `?q=dress`; matching pieces | Query param set; parameterised `LIKE` | `Catalogue.jsx setParam('q')` | `api/catalogue.js` (escaped `%`/`_`) | `products.name/description/color` | PASS (BROWSER) | — |
| TC-CUS-004 | Catalogue sort / in-stock | Visitor | Sort “Price low→high”; tick In stock | Re-query; URL `sort=price_asc&in_stock=true` | Whitelisted sort map; `vs.in_stock` filter | `Catalogue.jsx` | `SORTS` whitelist | — | PASS (BROWSER) | — |
| TC-CUS-005 | Category deep link | Visitor | Open `/catalogue/dresses` directly | Category page, HTTP 200 | 200 | `Catalogue.jsx` | `lib/seo.js pageMeta` | `categories` | PASS (HTTP) | — |
| TC-CUS-006 | Invalid category | Visitor | Open `/catalogue/not-a-cat` | Not-found page, HTTP 404 | 404 + `NotFound` | `Catalogue.jsx` → `NotFound` | `pageMeta` 404 | — | PASS (HTTP) | — |
| TC-CUS-007 | Product detail | Visitor | Open `/product/the-wine-slip-dress` | Gallery, price incl. GST, size(s), SKU, stock copy | 200; JSON-LD per-size offers (seo.test) | `ProductDetail.jsx` | `api/product.js` | `products`, `product_variants` | PASS (HTTP, AUTO) | — |
| TC-CUS-008 | Invalid product | Visitor | Open `/product/nope` | 404 page | 404 | `NotFound` | `fetchProduct` → null | — | PASS (HTTP) | — |
| TC-CUS-009 | Sale price | Visitor | View variant with sale price | Effective price = sale only if lower | `calculateProductPrice` | PDP | `lib/pricing.js` | `product_variants.sale_price_inr` CHECK ≤ price | PASS (AUTO) | — |
| TC-CUS-010 | One-of-one quantity | Visitor | View one-of-one | No quantity stepper; max qty 1 | Stepper hidden; server caps qty 1 | PDP | `api/cart.js addLine` maxQty 1 | — | PASS (CODE+AUTO) | — |
| TC-CUS-011 | Sold-out size | Visitor | Try to add sold-out size | Button disabled; server 409 if forced | `disabled={!v.in_stock}`; 409 `out_of_stock` | PDP | `addLine` | `stock_quantity < 1` | PASS (AUTO) | — |
| TC-CUS-012 | Wardrobe Bag save on PDP | Member | Look for “Save to Wardrobe Bag” | Action exists (V1-WB-01) | **No such action anywhere in UI** | none | `api/wardrobe.js` never called | `wardrobe_items` (0 rows live) | FAIL | DEF-05 |
| TC-CUS-013 | Colour-harmony filter | Visitor with saved palette | Filter catalogue by palette/season | Recommendation use of profile attribute (V1-ST-05) | API ignores `colour_season`/`season`/`palette` params (9 of 9 returned) | `Catalogue.jsx` has no control | `api/catalogue.js` | `products.colour_season` | FAIL (PROBE P08) | DEF-12 |

## 2. Customer journey — authentication and account

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-CUS-020 | Request OTP | Visitor | Enter email → Continue | Code issued; resend throttled 30 s | 200; throttle 429 (AUTO) | `Login.jsx` | `POST /api/auth/start-login` | `auth_otps` upsert | PASS (AUTO) | — |
| TC-CUS-021 | Verify OTP | Code requested | Enter correct code | Session cookie set; redirect to `next` or `/account` | 200; `Set-Cookie: vishrea_auth=…; HttpOnly; SameSite=Lax; Max-Age=1209600` | `Login.jsx` | `POST /api/auth/verify-code` | `auth_otps` delete; `profiles`, `customer_profiles` upsert | PASS (AUTO, PROBE P19) | — |
| TC-CUS-022 | Wrong / replayed code | Code requested | Enter wrong code ×6; replay used code | 400; 5-attempt limit; replay rejected | As expected | — | attempts counted before compare | — | PASS (AUTO) | — |
| TC-CUS-023 | Production OTP delivery | `NODE_ENV=production`, no `RESEND_API_KEY` | Request code | Email sent | 503 `otp_delivery_unavailable` — fails closed | — | `lib/notify.js` | — | BLOCKED (config) | DEF-19 |
| TC-CUS-024 | Open-redirect guard | Visitor | `/login?next=//evil.com` | Ignored | `safeNext` rejects | `Login.jsx` | — | — | PASS (CODE) | — |
| TC-CUS-025 | Session persistence | Signed in | Refresh `/account` | Still signed in | `GET /api/auth/session` restores user | `StoreContext.jsx` | `auth.extractUser` (role from DB) | `profiles` | PASS (BROWSER) | — |
| TC-CUS-026 | Sign-out revocation | Signed in | Sign out; reuse old cookie | 401 with old token | `sessions_valid_after` revokes | `StoreContext.signOut` | `POST /api/auth/signout` | `profiles.sessions_valid_after` | PASS (AUTO) | — |
| TC-CUS-027 | Edit profile | Signed in | Change name / phone on `/account` | Form saves (V1-CW-05) | **No form**; `PUT /api/account` has no caller | `Account.jsx` read-only | `api/account.js` PUT | `customer_profiles` | FAIL | DEF-08 |
| TC-CUS-028 | Wearer profiles | Signed in | Add wearer on `/account` | Basic management (V1-WP-01) | **No UI**; API works (201) | none | `api/account.js action=wearer` | `wearer_profiles` | FAIL (UI) / PASS (API, PROBE P11) | DEF-07 |
| TC-CUS-029 | Saved addresses | Signed in | Save / reuse address at checkout | (not explicit V1) | No UI; API create only; update/delete → 400 `unsupported_action` | none | `api/account.js action=address` | `addresses` | N/A (observation) | OBS-03 |
| TC-CUS-029a | Protected page while signed out | Visitor | Open `/account`, `/orders`, `/checkout` directly | Redirect to `/login?next=…` | Redirects (React guard); APIs 401 | `RequireAuth.jsx` | `mountModule` 401 | — | PASS (BROWSER, AUTO) | — |

## 3. Customer journey — cart, checkout, payment

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-CUS-030 | Guest add to bag | Visitor | Add piece | Bag count +1; stored locally | Count 0→1, “Added to your bag.”; guest bag thumbnail shows placeholder `/assets/editorial.jpg` | `StoreContext.addToCart` | — | — | PASS (BROWSER) | DEF-41 (Low) |
| TC-CUS-031 | Guest bag merge on login | Guest bag has item | Sign in | Item appears in account bag | `POST /api/cart {action:'merge'}` with per-line savepoint | `StoreContext` | `api/cart.js` | `carts`, `cart_items` | PASS (BROWSER) | — |
| TC-CUS-032 | Update quantity | Multi-unit item in bag | + / − | Capped by stock (≤10) | Server `int(..., max)` | `Cart.jsx` | `PATCH /api/cart` | `cart_items.quantity` | PASS (CODE+AUTO) | — |
| TC-CUS-033 | Remove item | Item in bag | Remove | Item gone; totals refresh | 200 + fresh view | `Cart.jsx` | `DELETE /api/cart` | `cart_items` | PASS (BROWSER) | — |
| TC-CUS-034 | Stock changed after add | Item in bag; stock → 0 | Open bag / checkout | Line flagged; checkout blocked 409 | `issue=sold_out`; 409 | `Cart.jsx ISSUE_COPY` | `loadCartLines` | — | PASS (AUTO) | — |
| TC-CUS-035 | Stale price | Admin changes price after add | Checkout | Charged current DB price | DB price used | — | `calculateCartPrice` | — | PASS (AUTO) | — |
| TC-CUS-036 | Client price tampering | Signed in | POST checkout with forged `total`/`price` | Ignored | Ignored | — | “Server prices only” | — | PASS (AUTO) | — |
| TC-CUS-040 | Checkout validation | Signed in | Submit without PIN / bad GSTIN | 400 with field message | `invalid_pincode`, `invalid_gstin` | `Checkout.jsx` | `parseAddress`, `gstin()` | — | PASS (CODE+AUTO) | — |
| TC-CUS-041 | Delivery without phone | Signed in | POST delivery address with no phone (API) | Rejected (courier needs phone) | **201 accepted** | UI requires phone | `parseAddress` phone required only for pickup | `orders.shipping_address` | FAIL (PROBE P14) | DEF-26 |
| TC-CUS-042 | GST slabs | Bag ≤ ₹2,500 and > ₹2,500 | Checkout | 5 % / 18 % inclusive extraction; CGST+SGST intra-state, IGST inter-state | Correct | invoice sheet | `lib/pricing.js` | `orders.cgst/sgst/igst` | PASS (AUTO) | — |
| TC-CUS-043 | Pickup vs ₹99 | Signed in | Choose pickup | Shipping 0; place of supply Karnataka | Correct | `Checkout.jsx` | `calculateShipping` | — | PASS (AUTO) | — |
| TC-CUS-044 | Gift packing | Signed in | Tick gift packing | +₹50, message stored | Correct | `Checkout.jsx` | `calculateCartPrice` | `orders.gift*` | PASS (AUTO) | — |
| TC-CUS-045 | One-of-one race | Two buyers | Simultaneous checkout | Exactly one wins; other 409 | Correct | — | `takeStock` conditional update | `CHECK stock_quantity >= 0` | PASS (AUTO) | — |
| TC-CUS-046 | Double submit | Signed in | Click pay twice / refresh | One order, one hold | Idempotency key + fingerprint + advisory lock | `Checkout.jsx idemKey` | `api/checkout.js` | `uq_orders_idempotency` | PASS (AUTO) | — |
| TC-CUS-047 | Gateway order failure | Gateway 500 | Checkout | Hold released; 502 | Correct | — | `attachGatewayOrder` → `expireOrder` | reservations released | PASS (AUTO) | — |
| TC-CUS-048 | Payment dismissed | Razorpay modal open | Close modal | “Pieces held until …”; Complete payment / Cancel | Modal opened in Test Mode at ₹5,299 (BROWSER); closing it could not be automated (cross-origin iframe). Dismiss path verified in code; hold behaviour in AUTO | `Checkout.jsx phase=dismissed` | — | hold remains | PASS (AUTO+CODE) / BLOCKED (BROWSER dismiss) | — |
| TC-CUS-049 | Cancel and release | Dismissed | Cancel and release pieces | Order cancelled; stock back | Correct | `Checkout.jsx cancel` | `action=cancel` → `expireOrder` | `orders.status=cancelled` | PASS (AUTO) | — |
| TC-PAY-001 | Valid payment | Pending order | Complete payment | Paid; invoice; bag cleared | Correct | `Checkout.jsx` | `POST /api/payment-verify` | `orders`, `invoice_records`, `cart_items` | PASS (AUTO) | — |
| TC-PAY-002 | Bad signature / foreign order | Pending order | Forge signature / other user's order | 400 / 404 | Correct | — | `verifyPaymentSignature` (timing-safe) | audit `payment_signature_invalid` | PASS (AUTO) | — |
| TC-PAY-003 | Duplicate verify | Paid | Verify again | Idempotent `duplicate:true` | Correct | — | early return | one invoice | PASS (AUTO) | — |
| TC-PAY-004 | Amount mismatch | Gateway reports wrong amount | Verify | Not marked paid | Correct | — | `fetchPayment` cross-check | — | PASS (AUTO) | — |
| TC-PAY-005 | Second capture on paid order | Paid | Second payment arrives | Auto-refund once | Correct | — | `refundDuplicatePayment` | `payment_events` claim row | PASS (AUTO) | — |
| TC-PAY-006 | Late payment, stock available | Hold expired | Webhook arrives | Re-acquire stock; paid | Correct | — | `reacquireReservations` | — | PASS (AUTO) | — |
| TC-PAY-007 | Late payment, stock sold | Hold expired; piece sold | Webhook arrives | `refund_required` → refund; no oversell | Correct | — | `markRefundRequired` | — | PASS (AUTO) | — |
| TC-PAY-008 | Gateway unreachable at verify | Gateway down | Verify | Paid on signature; reconciled later | Correct | `waitForPaid` poll | `recheckUnconfirmedPayments` | `gateway_checked_at` | PASS (AUTO) | DEF-35 (Low note) |
| TC-PAY-009 | Refund failure retry | Gateway refund 500 | Reconciliation | Retried with backoff, bounded | Correct | — | `retryPendingRefunds` | `refund_attempts` | PASS (AUTO) | — |
| TC-PAY-010 | Real Razorpay sandbox modal | Test keys | Complete test payment in modal | Paid end to end | Not executable: Razorpay Checkout is a cross-origin iframe the automation cannot drive | — | — | — | BLOCKED | — |
| TC-PAY-011 | Webhook bad signature | — | POST with wrong signature | 400 | Correct | — | `verifyWebhookSignature` raw body | — | PASS (AUTO) | — |
| TC-PAY-012 | Webhook duplicate delivery | — | Same event twice | One state change | Correct | — | `payment_events` `ON CONFLICT` | — | PASS (AUTO) | — |
| TC-PAY-013 | Full vs partial refund webhook | Paid unshipped / delivered | `refund.processed` | Full unshipped → restock; partial/delivered → recorded only | Correct | — | `handleRefundProcessed` | — | PASS (AUTO) | — |
| TC-PAY-014 | Live webhook configuration | Production | Razorpay dashboard → webhook | Configured to `https://<domain>/api/webhooks/razorpay` | Not verifiable from repository | — | — | — | BLOCKED | DEF-20 |

## 4. Customer journey — orders, tracking, invoice, exchange

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-CUS-050 | Order list | Customer with orders | Open `/orders` | Own orders only, status labels | Correct | `Orders.jsx` | `api/orders.js` scoped `auth_user_id` | `orders` | PASS (AUTO) | — |
| TC-CUS-051 | Order detail | Own order | Open `/orders/:id` | Items, totals, tracker, invoice | Correct | `OrderDetail.jsx` | `GET /api/orders?id=` | `orders`, `order_items`, `invoice_records` | PASS (AUTO) | — |
| TC-CUS-052 | Foreign order id | Customer B | Open A's order | 404, no data | Correct | `NotFound` | owner-scoped query | — | PASS (AUTO) | — |
| TC-CUS-053 | Malformed / unknown id | Customer | `/orders/not-a-uuid`, unknown uuid | 400 / 404 → NotFound | 400 / 404 | `OrderDetail` 400/404 → NotFound | `uuid()` | — | PASS (PROBE P18) | — |
| TC-CUS-054 | Order deep link signed out | Visitor | Open `/orders/<uuid>` | Login redirect | Redirect (React); server noindex 200 shell | `RequireAuth` | — | — | PASS (HTTP, BROWSER) | — |
| TC-CUS-055 | Live tracking | Dispatched order | Wait on page | Poll every 15 s; toast on change; courier link | Correct | `OrderTracker`, `useLiveOrder` | — | — | PASS (AUTO journey) | — |
| TC-CUS-056 | GST invoice | Paid order | View / print invoice | Sequential number, HSN, GST split, seller GSTIN | Number and split correct; **seller GSTIN empty in live settings; legal name/address null** | `OrderDetail` invoice sheet | `createOrderInvoice` | live `app_settings.seller_gstin = ""` | PARTIAL (LIVE-RO) | DEF-21 |
| TC-CUS-057 | Exchange in window | Delivered ≤ 7 days | Submit size exchange | `requested`; one open per order | Correct | `OrderDetail` form | `api/exchange.js` | `exchanges`, `uq_exchanges_open_per_order` | PASS (AUTO) | — |
| TC-CUS-058 | Damage outside 24 h / exchange outside 7 d / undelivered | — | Submit | 400 with window message | Correct | — | window checks | — | PASS (AUTO) | — |
| TC-CUS-059 | Damage photo evidence | Delivered | Attach photo to damage claim | Photo upload offered | **No upload control**; API accepts `evidence_urls` but UI never sends | `OrderDetail.jsx` | `api/exchange.js` | `exchanges.evidence_urls` | PARTIAL | DEF-24 |

## 5. Membership, credits, Wardrobe Bag, gifting, referrals

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-MEM-001 | Plan visibility | Visitor | Open `/membership` | ₹1,799/month, terms | ₹1,799/month, “₹3,598 for the first 2 months”, FAQ | `Membership.jsx` | `api/membership.js view` | `app_settings` | PASS (BROWSER) | DEF-31 (copy) |
| TC-MEM-002 | Start membership | Signed in, inactive | Start → pay | Razorpay order for ₹3,598 | `amount 3598` | `Membership.jsx` | `start_checkout` | `memberships`, `membership_payments` | PASS (PROBE P03) | — |
| TC-MEM-003 | Activate after payment | Payment done | Verify | Active; credits allocated once | Active, 4 credits | — | `activate_paid` → `finalizeMembershipPayment` | `credit_ledger`, `invoice_records` | PASS (AUTO, PROBE P03) | — |
| TC-MEM-004 | Payment for another user / replay | — | Replay or foreign signature | Rejected | Correct | — | bound to `membership_payments.auth_user_id` | — | PASS (AUTO) | — |
| TC-MEM-005 | Recurring setup | Active | Autopay | Razorpay subscription “where supported” | **Not implemented** (one-time order only) | — | no `createSubscription` | `autopay_subscription_id` never set | NOT IMPLEMENTED | DEF-03 |
| TC-MEM-006 | Renewal / lapse | Prepaid period ended | Time passes | Renew (charge) or lapse to inactive | **Stays `active` forever; no charge; no credits** | — | nothing reads `renewal_at` | `memberships.renewal_at` | FAIL (PROBE P03) | DEF-01 |
| TC-MEM-007 | Pause | Active | Pause | Paused; once per 6 months | Paused; `renewal_at` not extended | `Membership.jsx` | `action=pause` | `pause_used_at` | PARTIAL (PROBE P03) | DEF-01 |
| TC-MEM-008 | Resume | Paused | Resume | Active | Correct | — | `action=resume` | — | PASS (PROBE P03) | — |
| TC-MEM-009 | Cancel | Active | Cancel | Cancelled; unused credits forfeited | Correct | confirm dialog | `action=cancel` | `credit_ledger cancellation_forfeit` | PASS (CODE+AUTO) | — |
| TC-MEM-010 | 4 credits per month | Paid 2 months upfront | Check balance in month 1 and month 2 | 4 + 4 (or 8) | **4 total for 2 paid months**; no monthly grant | `Membership.jsx` “Four credits every month” | single grant per payment | `credit_ledger` one +4 row | FAIL (PROBE P03) | DEF-02 |
| TC-MEM-011 | Balance display | Member | View `/membership`, `/account`, `/cart` | Consistent balance | All three read `memberships.credits_balance`; browser saw 0 / “—” for a non-member | 3 pages | 3 APIs | `memberships.credits_balance` | PASS (CODE + BROWSER non-member) | — |
| TC-MEM-012 | Expiry / rollover | Grant older than 60 days | Open membership | Expired credits written off once | Correct | — | `reconcileExpiredCredits` | `expiry` ledger row | PASS (AUTO) | — |
| TC-MEM-013 | Redeem credit | Member with credit | Tick “Use wardrobe credit”; checkout | Line free; credit debited atomically | Correct | `Cart.jsx` | `api/checkout.js` | `credit_ledger redemption` | PASS (AUTO) | — |
| TC-MEM-014 | Paused member redeem | Paused member | Tick credit; checkout | Toggle hidden or clear message | Toggle allowed (PATCH 200); checkout 400 `insufficient_credits` (misleading) | `Cart.jsx` | `api/cart.js` PATCH | — | FAIL (Low, PROBE P20) | DEF-32 |
| TC-MEM-015 | Maximum balance | Member | Grants exceed cap | Capped | **No cap** — balance reached 104 | — | `adjustCredits` | — | NOT IMPLEMENTED (PROBE P03) | DEF-04 |
| TC-MEM-016 | Premium restriction | Premium piece | Tick credit | Refused | `premium_cannot_use_credit` | `Cart.jsx` hides toggle | `isCreditEligible` (badge text) | `products.badge` | PASS (AUTO) | DEF-37 (fragile) |
| TC-MEM-017 | Wardrobe Bag journey | Member | Save → view → redeem from Wardrobe Bag | Working journey | **No UI**; `ship` returns a message only, creates nothing | none | `api/wardrobe.js` | `wardrobe_items` | NOT IMPLEMENTED (PROBE P04) | DEF-05 |
| TC-CUS-060 | Gift packing at checkout | Signed in | Gift option | ₹50 added | Correct | `Checkout.jsx` | pricing | `orders.gift_packing_fee` | PASS (AUTO) | — |
| TC-CUS-061 | Gift membership | Signed in | Create gift on `/gifting` | Payment or admin-visible request | Saved as `draft` with ₹3,598 amount, **no payment, no admin view** | `Gifting.jsx` | `api/gifting.js` | `gifts` | FAIL (PROBE P05) | DEF-10 |
| TC-CUS-062 | Referral | Signed in | Get / share / redeem code | Customer-facing application | API issues code; **no UI; code ignored at checkout** | none | `api/referrals.js` | `referrals` | NOT IMPLEMENTED (PROBE P06) | DEF-06 |
| TC-CUS-063 | Gifting while signed out | Visitor | Submit gift form | Sign-in prompt | “Please sign in to create a gift.” (no link) | `Gifting.jsx` | 401 | — | PASS (BROWSER) | — |

## 6. Skin-tone analysis

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-ST-001 | Page load | Visitor | Open `/skin-tone` | Upload + camera controls, privacy copy | Renders | `SkinToneAnalysis.jsx` | — | — | PASS (BROWSER) | — |
| TC-ST-002 | Upload analysis | Visitor | Choose front-facing photo | Undertone, depth, season, palette | Canvas → CIELAB, fixed central oval (no face detection / MediaPipe) | `lib/colourEngine.js` | none | none | PASS (CODE; photo not supplied in automation) | DOC-01 |
| TC-ST-003 | Unusable photo | Visitor | Photo without skin in centre | Friendly error | `analyseImage` throws message | — | — | — | PASS (CODE) | — |
| TC-ST-004 | Save profile | Signed in | Save to my colour profile | Saved attribute incl. result category | Saved undertone + palette; **season (category) not stored** | `handleSave` | `POST /api/colour-review` | `colour_reviews` | PARTIAL (PROBE P15) | DEF-12 |
| TC-ST-005 | Saved profile reuse | Signed in, saved | Open account / another device | Profile shown | `GET /api/colour-review` never called; only `localStorage` | — | — | — | FAIL | DEF-12 |
| TC-ST-006 | Raw image privacy | — | POST with `image`/`photo` field | Rejected; no upload | 400 `raw_image_not_accepted`; page never calls upload | — | `FORBIDDEN_FIELDS` | `raw_image_key NULL` | PASS (AUTO) | — |
| TC-ST-007 | In-page recommendations | Result shown | View “Pieces in your colours” | Matching pieces | Client-side match on `colour_season` or colour words; live data has `colour_season` null/“AW26” | — | `GET /api/catalogue?limit=48&in_stock=true` | live `products.colour_season` | PARTIAL (LIVE-RO) | DEF-12 |
| TC-ST-008 | Admin skin-tone review | Admin | View customer colour profile | Visible to owner (V1-AD-09) | No admin section reads `colour_reviews` | — | — | — | NOT IMPLEMENTED | DEF-11 |

## 7. Admin journey

| Test ID | Journey | Starting state | User action | Expected result | Actual result | Frontend evidence | Backend evidence | Database evidence | Status | Defect ID |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-ADM-001 | Dashboard | Admin | Open `/admin` | KPIs from DB | API revenue ₹3,990 = DB paid-order revenue ₹3,990; membership revenue ₹3,598 not in KPI | `Admin.jsx` dashboard | `dashboard()` | multiple | PASS (PROBE P17) | DEF-30 (Low) |
| TC-ADM-002 | Dashboard API failure | Admin | API error | Error state with retry | `ErrorState` | `loadError` | — | — | PASS (CODE) | — |
| TC-ADM-003 | CSV export | Admin | Export orders/customers/invoices | CSV; formula injection neutralised | Correct | `<a href=…export>` | `exportCsv` | — | PASS (AUTO) | — |
| TC-ADM-010 | Create product | Admin | New piece with sizes/prices | Saved; visible on storefront | Correct | product modal | `saveProduct` (tx) | `products`, `product_variants` | PASS (AUTO) | — |
| TC-ADM-011 | Duplicate size / SKU | Admin | Save duplicate | 422 | Correct | — | `parseVariants` | `uq_product_variants_*` | PASS (AUTO) | — |
| TC-ADM-012 | Sale ≥ price | Admin | Save | 422 `invalid_sale_price` | Correct | — | — | CHECK | PASS (CODE) | — |
| TC-ADM-013 | Stale stock edit | Units held in checkout | Save edited stock | 409 `stock_changed` | Correct | `stock_base` | delta update | — | PASS (AUTO) | — |
| TC-ADM-014 | Hide / publish | Admin | Toggle visibility | Disappears/appears on storefront | Correct | `product_status` | — | `products.is_active` | PASS (CODE) | — |
| TC-ADM-015 | Delete sold product | Has orders | Delete | Archived, history kept | Correct | — | `deleteOrArchiveProduct` | `archived_at` | PASS (AUTO) | — |
| TC-ADM-016 | Product image upload | Admin | Upload JPG/PNG/WEBP | Stored; type from bytes | Correct; stored on local disk | `uploadFile` | `api/upload.js`, `sniff` | `public/uploads` | PASS (AUTO) | DEF-22 (storage) |
| TC-ADM-017 | Category CRUD | Admin | Create/edit/hide/delete | Persisted; storefront updates | Correct | categories section | `section=category` | `categories` | PASS (CODE+AUTO; admin UI not browser-verified, L-04) | — |
| TC-ADM-019 | One-of-one stock > 1 | Admin | Save qty 2 on one-of-one | 422 | Correct | — | `one_of_one_stock` | — | PASS (CODE) | — |
| TC-ADM-020 | Order list & filter | Admin | Filter by payment status | Filtered list | Correct | orders section | `section=orders&payment_status=` | — | PASS (CODE) | — |
| TC-ADM-021 | Dispatch with tracking | Paid order | Mark dispatched w/ courier + AWB | Status, tracking, email (if provider) | Correct; email logged only without Resend | dispatch modal | `updateOrder`, `notifyDispatched` | `orders.dispatch_at` | PASS (AUTO) | — |
| TC-ADM-022 | Unpaid dispatch | Pending order | Mark dispatched | 409 | Correct | — | `FULFILMENT_FLOW` | — | PASS (AUTO) | — |
| TC-ADM-023 | Cancel paid order | Paid unshipped | Cancel | Stock back; `refund_required` | Correct | — | `updateOrder` | — | PASS (CODE+AUTO) | — |
| TC-ADM-030 | Customer list | Admin | Open `/admin/customers` | Accounts, membership, credits, order history, wearer profiles (V1-AD-04) | Name, email, phone, membership, credits, order **count**, consent; **no drill-down, no wearers, no order history, no colour profile** | customers section | `section=customers` | — | PARTIAL (PROBE P15, BROWSER) | DEF-11 |
| TC-ADM-032 | Membership monitor | Admin | Change member status | Possible (backend supports) | Read-only table in UI | memberships section | `section=membership` (unused) | — | PARTIAL | DEF-29 |
| TC-ADM-033 | Credit adjustment | Admin | ±credits with reason | Ledger row; no negative | Correct | credit modal | `adjustCredits` | `credit_ledger` | PASS (AUTO) | — |
| TC-ADM-040 | Offer rule applied | Admin creates active 50 % rule | Customer checks out | Discount applied (V1-AD-05) | **No effect** (cart total unchanged); UI itself says rules are “recorded for planning” | loyalty section | `section=loyalty` | `loyalty_rules` | NOT IMPLEMENTED (PROBE P07) | DEF-06 |
| TC-ADM-045 | Store Mode sale | Admin | Sell a piece (cash/UPI/card) | Paid+delivered order, stock −1, invoice | Correct, invoice `VS/2026-27/000002` | store section | `storeSale` | `orders`, `store_sales`, `invoice_records` | PASS (PROBE P16) | — |
| TC-ADM-047 | Instagram link | Admin | Add/publish/delete link | Appears on home | Correct | content section | `saveContent type=instagram` | `instagram_content` | PASS (CODE, live row present) | — |
| TC-ADM-048 | Video > 10 s | Admin | Upload 15 s MP4 | 422 | Correct | video modal | `mp4DurationSeconds` | — | PASS (AUTO) | — |
| TC-ADM-049 | 4th live video | 3 live | Publish 4th | 409 | Correct | — | advisory lock + count | — | PASS (AUTO) | — |
| TC-ADM-050 | Exchange status update | Admin | Approve / reject with note | Persisted; customer sees status | Correct for valid id | exchanges section | `section=exchange` | `exchanges` | PASS (CODE) | — |
| TC-ADM-051 | Exchange unknown id | Admin (API) | Update non-existent id | 404 | **200 `ok`** | — | no rowCount check | — | FAIL (Low, PROBE P09) | DEF-25 |
| TC-ADM-060 | AI Listing Studio | Admin, no `OPENAI_API_KEY` | Generate | Suggestion (optional) | 502 “enter the listing manually” | listing section | `listing-studio.js` | — | BLOCKED (PROBE P10) | DEF-23 |
| TC-ADM-070 | Settings write via API | Admin | POST numeric settings | Stored as JSON numbers | `shipping_fee:"120"`, `credits_per_month:"4"`, `max_video_seconds:"10"` stored as **strings**; runtime still coerces | no UI | `handleWrite section=settings` | `app_settings` `jsonb_typeof=string` | FAIL (Low, PROBE P01) | DEF-13 |
| TC-ADM-071 | Settings validation | Admin | `shipping_fee:"abc"`, `max_video_seconds:30` | 400 | 400 / 400 | — | `money()`, cap check | — | PASS (PROBE P02) | — |

## 8. Direct URL, redirect and deep-link tests (HTTP against isolated instance)

| Test ID | URL | Signed-out server status | Expected final behaviour | Actual | Status | Defect |
|---|---|---|---|---|---|---|
| TC-URL-001 | `/` | 200 | Home | Home | PASS | — |
| TC-URL-002 | `/catalogue/` | 301 → `/catalogue` | Trailing slash removed | 301 | PASS | — |
| TC-URL-003 | `/catalogue/dresses` | 200 | Category | 200 | PASS | — |
| TC-URL-004 | `/catalogue?category=dresses` | 301 → `/catalogue/dresses` | Clean URL | 301 | PASS | — |
| TC-URL-005 | `/catalogue/not-a-cat` | 404 | Not found | 404 | PASS | — |
| TC-URL-006 | `/product/the-wine-slip-dress` | 200 | PDP | 200 | PASS | — |
| TC-URL-007 | `/product/nope` | 404 | Not found | 404 | PASS | — |
| TC-URL-008 | `/checkout`, `/account`, `/orders`, `/orders/<uuid>` | 200 shell + `X-Robots-Tag: noindex` | Client redirect to `/login?next=…` | Redirect (BROWSER) | PASS | — |
| TC-URL-009 | `/admin`, `/admin/products`, `/admin/bogus` | 200 shell | Guest → login; customer → `/account`; admin + bogus → `/admin` | Guest → `/login?next=…` and customer → `/account` (BROWSER); admin + bogus → `/admin` (CODE: `Navigate` in `Admin.jsx`) | PASS | — |
| TC-URL-010 | `/legal` | **404** then client redirect to `/legal/privacy` | 301/200 | 404 status | FAIL (Low) | DEF-27 |
| TC-URL-011 | `/legal?slug=terms` | 301 → `/legal/terms` | Clean URL | 301 | PASS | — |
| TC-URL-012 | `/legal/zzz` | 404 | Not found | 404 | PASS | — |
| TC-URL-013 | `/random/page` | 404 | Not found page | 404 | PASS | — |
| TC-URL-014 | `/coming-soon` | 301 → `/` | Home | 301 | PASS | — |
| TC-URL-015 | `/admin.html` | 301 → `/admin` | Admin | 301 | PASS | — |
| TC-URL-016 | `/api/nope` | 404 JSON | API not found | 404 | PASS | — |
| TC-URL-017 | `/robots.txt`, `/sitemap.xml` | 200 | Dev: `Disallow: /`; prod: allow + sitemap | 200 | PASS | — |
| TC-URL-018 | Admin legal “view” link `/legal?slug=privacy` | 301 → `/legal/privacy` | Opens policy | 301 | PASS | — |

## 9. Security and permission tests

| Test ID | Scenario | Expected | Actual | Evidence | Status | Defect |
|---|---|---|---|---|---|---|
| TC-SEC-001 | Anonymous → `/api/admin/ops`, `/api/admin/*` | 401 | 401 (all 6 admin modules) | PROBE P10 | PASS | — |
| TC-SEC-002 | Customer → `/api/admin/*`, listing studio, PATCH piece-requests | 403 | 403 | PROBE P10 | PASS | — |
| TC-SEC-003 | Customer edits/deletes another customer's wearer | 404 / no effect | Update 404; delete returns 200 but row intact | PROBE P11 | PASS | — |
| TC-SEC-004 | Customer reads another's order / piece request | 404 | 404 | AUTO | PASS | — |
| TC-SEC-005 | Role from token claims | Role from DB each request | `extractUser` reads `profiles` | CODE + AUTO | PASS | — |
| TC-SEC-006 | Bootstrap admin demoted then logs in | Stays demoted | **Re-promoted to admin** | PROBE P12 | FAIL | DEF-15 |
| TC-SEC-007 | Legacy admin endpoints | Admin-only | 200 admin / 403 customer / 401 anon | PROBE P10 | PASS (dead code) | DEF-28 |
| TC-SEC-008 | Cross-origin cookie mutation | 403 `origin_not_allowed` | 403 | AUTO | PASS | — |
| TC-SEC-009 | Non-JSON body mutation | 415 | 415 | AUTO / CODE | PASS | — |
| TC-SEC-010 | SQL-injection strings in catalogue | Safe 200 | 200, parameterised | PROBE P18 | PASS | — |
| TC-SEC-011 | Script / SVG / HTML upload | 415 | 415 | AUTO | PASS | — |
| TC-SEC-012 | Guest upload | Limited | 201 for anonymous image (20/h/IP); no orphan cleanup | PROBE P13 | PASS with note | DEF-33 |
| TC-SEC-013 | Cookie flags | HttpOnly, SameSite, Secure in prod | `HttpOnly; SameSite=Lax`; Secure in prod/HTTPS | PROBE P19, CODE | PASS | — |
| TC-SEC-014 | Token not in JS storage/URL | Absent | Not in `localStorage`/URL; login response has no token | AUTO | PASS | — |
| TC-SEC-015 | Security headers | CSP, XFO DENY, nosniff, HSTS (prod) | Present; CSP report-only in dev, enforce in prod | HTTP + production.test.js | PASS | — |
| TC-SEC-016 | Prod error leakage | Generic message | Generic | production.test.js | PASS | — |
| TC-SEC-017 | Weak JWT secret in prod | Refuse start | Refuses `<32` chars or known placeholders; **the hard-coded dev secret in tracked `start.ps1` would pass** | CODE | FAIL | DEF-18 |
| TC-SEC-018 | Dev OTP echo exposure | Never with live data | `.env`: development + `AUTH_DEV_OTP_ECHO=true` + live Supabase DB + tunnel origin | LIVE-RO / config | FAIL (latent) | DEF-17 |
| TC-SEC-019 | Live admin population | Only owner/staff | 4 of 4 live profiles are admins incl. `@vishrea.test` | LIVE-RO | FAIL | DEF-16 |
| TC-SEC-020 | Rate limiting | 429 | 429 | AUTO | PASS | — |

## 10. Responsive and usability tests

Measured in the browser with device emulation (`scrollWidth` vs `clientWidth`; computed font-size/height of form controls). “OK” = no horizontal overflow.

| Test ID | Page | 360 | 390 | 768 | 1366 | 1440 | Status | Defect |
|---|---|---|---|---|---|---|---|---|
| TC-RSP-001 | `/` | OK | OK | OK | OK | OK | PASS | DEF-39 (imagery) |
| TC-RSP-002 | `/catalogue` | OK | OK | OK | OK | OK | PASS (sort select 11 px / 24 px) | DEF-44 |
| TC-RSP-003 | `/product/:slug` | OK | OK | OK | OK | OK | PASS | — |
| TC-RSP-004 | `/cart` | OK | OK | OK | OK | OK | PASS | DEF-41 |
| TC-RSP-005 | `/checkout` | OK, inputs 9 px, State select 13 px tall | not measured | not measured | not measured | OK, inputs 9 px | FAIL (usability) | DEF-40 |
| TC-RSP-005a | `/gifting` | OK, inputs 9 px, select 13 px tall | — | — | — | inputs 9 px | FAIL (usability) | DEF-40 |
| TC-RSP-005b | `/account`, `/orders`, `/membership`, `/skin-tone` | OK | OK (membership, skin-tone) | OK (membership, skin-tone) | OK (membership, skin-tone) | OK | PASS | DEF-45 (membership CTA below fold) |
| TC-RSP-006 | `/admin` | not measured | not measured | not measured | not measured | not measured | BLOCKED (L-04) | — |
| TC-RSP-007 | Mobile menu open / links / Escape | — | menu opens, `aria-expanded=true`, 8 links, Escape closes | n/a | n/a | n/a | PASS | — |
| TC-RSP-008 | Skip link first tab stop + focus-visible outline | n/a | n/a | n/a | n/a | skip link first; 2 px outline; low contrast on dark bar | PASS (Low note) | DEF-45 |
| TC-RSP-009 | Request-piece modal keyboard | n/a | n/a | n/a | n/a | Escape closes, focus returns to trigger | PASS | — |

## 11. Regression set required after remediation

Every defect fix must be accompanied by an automated test in `test/platform.test.js` (or a new suite) using the existing harness, plus re-running the full suite. Minimum regression IDs: TC-MEM-005/006/007/010/014/015/017, TC-CUS-012/013/027/028/041/059/061/062, TC-ST-004/005/007/008, TC-ADM-030/032/040/051/070, TC-SEC-006/017/018/019, TC-URL-010, all TC-PAY-* and TC-CUS-04x (unchanged money paths must stay green).
