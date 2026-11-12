# Requirements Traceability Matrix

| Field | Value |
|---|---|
| Document ID | VS-REQ-001 |
| Document title | Requirements Traceability Matrix |
| Version | 1.0 |
| Status | Baseline for client review |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | Website Requirements Specification v1.0 (6 Oct 2026, `docs/specifications/…v1.0 (1).pdf`) · client clarifications of 7 Nov 2026 · V1 Proposal VDEV-VS-V1-2026-10 (unsigned copy) · source code at the working tree of 7 Nov 2026 |

Related: [Implementation Checklist](IMPLEMENTATION_CHECKLIST.md) · [Gap Analysis](GAP_ANALYSIS.md) · [Development Evidence](../technical/DEVELOPMENT_EVIDENCE.md) · [Client Decisions](CLIENT_DECISIONS_REQUIRED.md) · [Test Report](../technical/TEST_REPORT.md)

## How to read this matrix

**Requirement precedence** (conflicts are recorded, never silently resolved):
1. Latest explicitly approved client clarification (7 Nov 2026: ₹150 referral discount on the first 2 months; 6th-month free piece as a separate reward on owner-selected pieces; billing as 2 months upfront + monthly UPI Autopay).
2. Requirements Specification v1.0.
3. Approved changes: V1 Proposal VDEV-VS-V1-2026-10 (defers WhatsApp API, Google/Meta catalogue, Instagram API; adds skin-tone analysis). The copy in the repository has **blank signature blocks**, so its deferrals are treated as *pending client approval* (DEC-12).
4. Existing documentation · 5. Implementation.

**Statuses** (exact):
- **VERIFIED COMPLETE** — behaviour proven by an executed automated test against a real PostgreSQL database (7 Nov 2026 run, 140/140), or by a direct inspection check recorded here, *and* it does not depend on an unverified live third-party service.
- **IMPLEMENTED — TESTING REQUIRED** — code exists end-to-end; not covered by an automated test, or covered only against the local Razorpay/e-mail stand-ins.
- **PARTIALLY IMPLEMENTED** · **UI ONLY** · **BACKEND ONLY** · **DATABASE ONLY** · **NOT IMPLEMENTED** · **BLOCKED BY EXTERNAL PROVIDER** · **PENDING CLIENT APPROVAL** · **NOT APPLICABLE** (release 1.1/2.0, or contractual).

**Deployment:** nothing is deployed to production. The application runs locally against a staging database (migrations 001–020 applied). "Deployed" is therefore *No* for every row.

**Test file keys:** P = `test/platform.test.js`, R = `test/remediation.test.js`, W = `test/walkin-wardrobe.test.js`, PR = `test/pricing.test.js`, PD = `test/production.test.js`, S = `test/seo.test.js`, N = `test/notify.test.js`, G = `test/razorpay-gateway.test.js`, SG = `test/razorpay-signature.test.js`, M = `test/migration-rehearsal.test.js`. Test names are quoted from the files.

## 1. Customers (§3)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| CUS-01 | Age 18+ | Confirm 18+ at sign-up; no under-18 accounts | `customer_profiles.age_confirmed` column; the account API accepts the value but nothing asks for it (My Vishrea only re-sends the stored value) and sign-in creates accounts without it | `api/account.js` PUT; `pages/Account.jsx` ProfileForm (no age field); `pages/Login.jsx` (e-mail only); `api/auth.js` `/verify-code` | None | BACKEND ONLY | Ask and enforce 18+ on first sign-in (server-side) |
| CUS-02 | Wearer profiles | Up to 5 per account: name, size, bust/waist/hip/length, colour passport, style & occasion prefs, birthday; add/edit/delete | Wearers CRUD with all fields except a per-wearer colour passport; limit from `max_wearers` | `api/account.js` `action:'wearer'` (POST/PUT/DELETE), `wearerValues`; `pages/Account.jsx` `Wearers`; table `wearer_profiles` | W "I'll pick for her" creates a wearer; R "admin customer drill-down returns wearers…" | PARTIALLY IMPLEMENTED | Colour passport per wearer (colour profile is saved per account, `colour_reviews.auth_user_id`) |
| CUS-03 | Wearer switcher | "Shopping for: …" on every page changes size filter, colour matches, recommendations | None found (searched "Shopping for", wearer context) | — | None | NOT IMPLEMENTED | Global wearer context + filters |
| CUS-04 | Sizes and Plus measurement filter | XS…5XL + Plus; measurements on every piece; filter by measurement | Free-text `size_label` per variant; measurements stored and shown on product page; no measurement filter | `products.bust_cm…length_cm`, `pages/ProductDetail.jsx` "Measurements"; `api/catalogue.js` (no size/measurement filter) | None | PARTIALLY IMPLEMENTED | Fixed size list; measurement range filter |
| CUS-05 | Occasions vs Premium | Office/Everyday/Travel shared pool; Festive/Party/Birthday always Premium | `occasion` free text; Premium via badge/`credit_eligible`; rule not enforced | `lib/products-admin.js` `saveProduct` (`credit_eligible` default from badge) | PR "…Premium is never credit-eligible" | PARTIALLY IMPLEMENTED | Occasion list; force Premium for festive/party/birthday |
| CUS-06 | Gifting | As MEM-12…15 | See MEM-12…15 | — | — | PARTIALLY IMPLEMENTED | See MEM-12, MEM-15 |

## 2. Catalogue and inventory (§4)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| CAT-01 | Admin categories | Add, rename, hide, reorder; launch set incl. Skirts, Tops, Pants, Night Suits, Dresses, Kurtis, Coords, Festive, Party, Birthday | Category CRUD with `is_active`, `sort_order`; seed lacks Night Suits, Kurtis and the Premium categories Festive, Party, Birthday | `api/admin/ops.js` POST `section=category`; `migrations/005_v1_catalogue_seed.sql`; `content/categories.js` | R "a product can be made reward-eligible … deleting it keeps Settings saveable" (indirect) | IMPLEMENTED — TESTING REQUIRED | Create the launch category set in admin; category CRUD test |
| CAT-02 | Piece record | Auto ID, category, occasion, size+measurements, colour, colour season/sub-type, fabric (+list), GST-inclusive price, Premium flag, admin-only cost & supplier, status, date listed | All fields present; fabric free text only; cost/supplier never returned by public APIs (checked live on staging) | `products` (cost_price_inr, supplier_name, listed_at, colour_season…); `lib/catalogue.js` `normalizeProduct` | P "size-specific pricing, duplicate sizes rejected…"; inspection 7 Nov: `/api/catalogue`, `/api/product` contain no cost/supplier | IMPLEMENTED — TESTING REQUIRED | Fabric list; automated "no cost exposure" test |
| CAT-03 | Three photos, logo, "1 of 1" | Front, fabric close-up, model view with logo; "1 of 1" badge | Up to 8 images per piece; "1 of 1" badge on cards; no photo roles, no logo overlay | `lib/products-admin.js` (images ≤ 8), `components/ProductCard.jsx:27`; `product_photos.photo_type` unused | P "type comes from bytes…" (uploads) | PARTIALLY IMPLEMENTED | Photo roles (3 required); logo overlay (see BO-01) |
| CAT-04 | Pricing helper | Cost → suggested price from markup rules; show margin and GST slab | AI listing studio suggests a price; no markup-rule helper, margin or slab display | `api/admin/listing-studio.js` (`suggested_price_inr`) | None | PARTIALLY IMPLEMENTED | Markup rules setting; margin + slab display (owner to supply rules, DEC-15) |
| CAT-05 | GST per piece | 5% ≤ ₹2,500, 18% above, after discounts; admin settings | Per-piece slab on effective (sale) price; `gst_threshold`, `gst_rate_low/high` settings | `lib/pricing.js` `gstRateFor`, `calculateCartPrice` | PR "GST slab by per-piece value and inclusive extraction"; P "server ignores client prices and computes GST-inclusive totals" | VERIFIED COMPLETE | Offer-based discounts do not exist yet (see LOY-BLD) |
| CAT-06 | One stock, gone within 2 s | Sold anywhere → disappears everywhere within 2 s | Single stock in `product_variants`; atomic stock take for online, credit and store sales; catalogue responses cached up to 30 s (`Cache-Control`) | `lib/inventory.js` `takeStock`; `api/admin/ops.js` `storeSale`; `api/catalogue.js` (`max-age=30`) | P "two customers racing for the same one-of-one: exactly one wins" | PARTIALLY IMPLEMENTED | Overselling is impossible; display latency can exceed 2 s (cache) |
| CAT-07 | Payment lock and messages | Lock ≤ 5 min; "Someone is checking out this piece right now"; sold piece leaves carts with "This piece just found a new home" + 3 similar pieces | Stock hold during checkout (`reservation_minutes`, default **15**, min 5); generic sold-out issue in cart; messages and similar-piece suggestions absent | `api/checkout.js` `reserve`; `lib/cart.js` `loadCartLines` issues; `lib/settings.js` `reservation_minutes` | P "gateway failure releases the stock hold"; "expired hold + late webhook…" | PARTIALLY IMPLEMENTED | Messages + 3 similar pieces; default 5 min (DEC-09) |
| CAT-08 | 21-day offer rule | Unsold 21 days → offers automatically; dashboard stock by age | Dashboard stock-age buckets; `offer_after_days` setting defined but not used | `api/admin/ops.js` `dashboard` (stockAge); `lib/settings.js` `offer_after_days` | R "dashboard reports membership revenue…" | PARTIALLY IMPLEMENTED | Automatic move to offers (needs offer engine, LOY-BLD); stock age is computed from `inventory.updated_at`, which every stock sync resets — use `products.listed_at` |
| CAT-09 | Weekly drops + 48 h early access | Owner sets drop time; members 48 h early access incl. Premium | Drops admin; pieces assigned to a drop; hidden before start, members-only until public | `lib/catalogue.js` `dropVisibleSql`, `hasEarlyAccess`; `lib/cart.js` `isDropLocked`; `Admin.jsx` product "Drop" select | W "a piece in a drop is members-only until the drop goes public…"; W "a drop that has not started is hidden…" | VERIFIED COMPLETE | Drops are scheduled one by one (no recurring weekly template) |
| CAT-10 | "Gone to a new home" gallery | Gallery of sold pieces | None found | — | None | NOT IMPLEMENTED | Gallery page |
| CAT-11 | Gap alerts | Weekly member demand vs stock by size and colour season | Dashboard lists lowest stock by size/season; no demand comparison, no weekly alert | `api/admin/ops.js` `dashboard` (gaps) | None | PARTIALLY IMPLEMENTED | Demand signal + weekly alert |

## 3. Walkin Wardrobe membership (§5)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| MEM-01 | Plan and billing | ₹1,799/month incl. GST; 2 months at sign-up (lock-in); then monthly UPI Autopay via Razorpay; cards/net banking accepted | Razorpay Subscription: upfront add-on (₹3,598) + mandate in one checkout; first ₹1,799 debit after 2 months; lock-in 2 months | `lib/billing.js` `startSignup`, `verifyCheckout`, `applyRecurringCharge`; `migrations/019`; `pages/Membership.jsx` | R "acceptance: ₹3,598 once with the mandate…" (local Razorpay stand-in) | BLOCKED BY EXTERNAL PROVIDER | Enable Razorpay Subscriptions + UPI Autopay; sandbox rehearsal |
| MEM-02 | Benefits | 4 credits/month, 48 h early access (Premium incl.), free batched shipping, members can buy anything | All four implemented | `lib/membership.js` `grantDuePeriods`; `lib/catalogue.js`; `lib/bag.js` | R "a 2-month membership grants 4 credits per paid month…"; W early-access and bag tests | VERIFIED COMPLETE | — |
| MEM-03 | What a credit is | 1 credit = 1 shared-pool piece, never Premium, 4 at the start of each paid month | Implemented | `lib/pricing.js` `isCreditEligible`; `lib/membership.js` | P "credit redemption is atomic and premium pieces are excluded"; R "a 2-month membership grants 4 credits…" | VERIFIED COMPLETE | — |
| MEM-04 | Rollover and expiry | 60-day expiry, max 8, dates shown, frozen during retry, lapse on cancellation | Expiry, 8-credit limit (oldest lapse first), freeze, lapse implemented; UI shows the expiry rule and counts, not per-credit dates | `lib/credits.js`; `lib/membership.js` `enforceHoldingLimit`; `lib/billing.js` `creditsUsable` | P "expired credits cannot be redeemed…"; R acceptance (limit), "a failed debit freezes credits…", "cancellation opens after the lock-in…" | PARTIALLY IMPLEMENTED | Show per-credit expiry dates (API returns `ledger.expires_at`) |
| MEM-05 | A credit is a payment | Redeeming sells the piece instantly | Credit picks sold at once (`in_bag` orders) | `api/checkout.js` (`shipping_method:'bag'`) | W "credit picks are sold at once and wait in the bag…" | VERIFIED COMPLETE | — |
| MEM-06 | Wardrobe Bag | Picks wait until "Ship my bag"; 4+ free, else ₹99; credits for any wearer | Implemented; ₹99 paid via Razorpay and confirmed server-side; no per-wearer assignment on picks | `lib/bag.js`; `pages/Wardrobe.jsx`; table `bag_shipments` | W both Wardrobe Bag tests (Razorpay stand-in) | IMPLEMENTED — TESTING REQUIRED | Live Razorpay check of ₹99 payment; wearer per pick |
| MEM-07 | Missed payment | 3 retries / 5 days, WhatsApp reminders, credits frozen, then pause | State machine implemented (retrying → halted → paused, recovery); email reminder; retry schedule is a Razorpay dashboard setting; no WhatsApp | `lib/billing.js` `markRetrying`, `markHalted`, `startRecovery` | R "a failed debit freezes credits during the retries…", "a debit that succeeds on a retry…" | BLOCKED BY EXTERNAL PROVIDER | Razorpay retry config; WhatsApp API (DEC-12) |
| MEM-08 | Pause | 1 month once per 6 months; no charge/credits; credits keep expiry (proposed); resets loyalty count | Implemented; mandate paused at Razorpay; refused during lock-in | `lib/billing.js` `requestPause`, `requestResume`, `runBillingJobs` | R "one-month pause…", "a pause that fails at the gateway is undone…" | IMPLEMENTED — TESTING REQUIRED | Live Razorpay pause/resume; lock-in pause rule (DEC-05) |
| MEM-09 | Cancel | After lock-in, ≤ 2 taps, offer pause or styled pick, redeemed pieces still ship, credits lapse, UPI-app cancellation = cancellation | Implemented (cancel panel offers pause; "styled pick" is a text prompt to WhatsApp the studio) | `lib/billing.js` `requestCancel`, `markMandateCancelled`; `pages/Membership.jsx` cancel panel | R "cancellation opens after the lock-in…", "cancelling the UPI mandate from the customer's UPI app…" | IMPLEMENTED — TESTING REQUIRED | Live `subscription.cancelled` check |
| MEM-10 | Member loyalty (6th month) | After 5 consecutive paid months, 6th month includes one free piece **as one extra credit (5 that month)**; repeats; pause/missed payment resets | Free piece issued as a separate reward entitlement (client clarification 7 Nov), redeemable on owner-selected pieces; repeats every 6 consecutive paid months; reset on pause and on halted payment | `lib/membership.js` `qualifiesForSixMonthReward`, `issueMilestoneReward`, `resetConsecutiveMonths`; `migrations/018` | R "2 upfront months + 4 autopay debits: the 6th consecutive paid month brings one free piece, exactly once"; "one-month pause… resets the count" | VERIFIED COMPLETE | Conflict with spec wording logged (DEC-02); owner must select eligible pieces (DEC-03) |
| MEM-12 | Any membership as a gift | Same terms (₹1,799/month, 2 months upfront, lock-in) | Gift purchases are pre-booked (prepaid, no autopay); gifting an autopay membership not available | `lib/gifts.js` `startGiftPurchase` | W gift tests | PARTIALLY IMPLEMENTED | Autopay gift (DEC-08) |
| MEM-13 | Two gift modes | (a) activation link on WhatsApp and email; (b) gifter picks via her wearer profile, boxes to her address | (a) one-time link by email (WhatsApp blocked); (b) membership on gifter's account tied to a wearer | `lib/gifts.js` `finalizeGiftPurchase`, `redeemGiftToken` | W "'Gift to her'…", "'I'll pick for her'…" | IMPLEMENTED — TESTING REQUIRED | Live email delivery; WhatsApp link (blocked) |
| MEM-14 | Pre-booked gifts | Prepay ≥ 2 months (3, 6, 12), no autopay; invite to continue at the end | Implemented; `gift_ending` reminder 7 days before the end | `lib/gifts.js`; `lib/billing.js` `runBillingJobs` (gift_ending) | W "gift durations are pre-booked months of at least 2…" | IMPLEMENTED — TESTING REQUIRED | Test the ending reminder |
| MEM-15 | Gift packing | +₹50 per gift box, packing slip without prices, gifter message shown to staff | ₹50 fee and message stored on the order; no packing slip; admin order list does not flag gifts | `lib/pricing.js` (`gift_packing_fee`); `api/checkout.js` | W "…a gift box adds ₹50 packing at checkout"; PR "cart totals: shipping, gift…" | PARTIALLY IMPLEMENTED | Gift flag + message in admin orders; price-free packing slip |
| MEM-16 | Membership terms page | Terms covering all of the above | Terms text updated in `content/policies.js`; live database copy is older (admin-edited pages take precedence) | `vishrea-react/src/content/policies.js`; `legal_pages` | R "legal details are published only after the owner marks them verified" | PARTIALLY IMPLEMENTED | Update live legal page; owner approval |

## 4. Shopping journey (§6)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| LF-01 *(derived from §6 launch flow)* | Sign-in method | Phone number + OTP via WhatsApp, SMS backup; no passwords; "Just browse" without sign-in | Passwordless **email** OTP; catalogue browsable without sign-in | `api/auth.js` `/start-login`, `/verify-code` | P "OTP is single-use, attempt-limited…"; PD "OTP is never echoed…" | PARTIALLY IMPLEMENTED | Phone OTP needs an SMS/WhatsApp provider (DEC-07) |
| LF-02 *(derived)* | "Who are you shopping for?" step | Choose wearer, then colour analysis, then filtered shopping | Not present | — | None | NOT IMPLEMENTED | Depends on CUS-03 |
| SHP-01 | Colour analysis | Camera or upload; 4 seasons with sub-types; saved as the wearer's colour passport; photo deleted immediately | On-device analysis (camera or file); the server accepts 8 seasonal categories (`api/colour-review.js` `COLOUR_SEASONS`), not the full set of sub-types; only derived attributes are sent to the server; saved per account, not per wearer | `pages/SkinToneAnalysis.jsx` (getUserMedia, file input); `lib/colourEngine.js`; `api/colour-review.js` | P "colour profile accepts derived attributes only"; R "catalogue filters by colour season; colour profile stores the season" | PARTIALLY IMPLEMENTED | Per-wearer passport; full sub-type list; real-device camera test |
| SHP-02 | Home page | Signed in: "Picked for your colours", this week's drop, categories; members: credits with expiry dates and early-access countdown | Categories and membership promotion; none of the personalised blocks | `pages/Home.jsx` | None | PARTIALLY IMPLEMENTED | Personalised sections |
| SHP-03 | Browse and filter | Size (per wearer; Plus measurement), category, occasion, colour season, price, regular/Premium | Category, colour season, search, in-stock, price sort | `api/catalogue.js` query params; `pages/Catalogue.jsx` | R "catalogue filters by colour season…" | PARTIALLY IMPLEMENTED | Size, occasion, price range, Premium filters |
| SHP-04 | Product page | 3 photos, "1 of 1", measurements, fabric, price, Premium label, "Style it with", credit eligibility | Photos, badge, measurements, material, per-size price, 4 related pieces; no "Style it with" by colour | `pages/ProductDetail.jsx`; `api/product.js` | S "product page: unique title… Product schema with per-size offers" | PARTIALLY IMPLEMENTED | "Style it with" logic; credit-eligibility label check |
| SHP-05 | Look builder | Combine, save, share to WhatsApp/Instagram with link back | Tables `saved_looks`, `saved_look_items`; no customer UI | `migrations/010`; `api/account.js` (lists saved looks) | None | DATABASE ONLY | Look builder UI + share links |
| SHP-06 | Cart | Per-piece credit or pay; Premium always paid; keep buying after credits run out | Implemented | `api/cart.js` PATCH `use_credit`; `lib/pricing.js` | P "credit redemption is atomic and premium pieces are excluded" | VERIFIED COMPLETE | — |
| SHP-07 | Checkout | Saved addresses; shipping shown before payment; gift option (+₹50, prices hidden, message); prepaid Razorpay, UPI first | Shipping/gift/Razorpay implemented; addresses can be saved but no picker at checkout | `api/checkout.js`; `pages/Checkout.jsx`; `api/account.js` `action:'address'` | P checkout and payment tests (Razorpay stand-in) | PARTIALLY IMPLEMENTED | Address picker; "UPI first" method order in Razorpay Checkout (no display config today); live Razorpay |
| SHP-08 | Confirmation | On screen, WhatsApp and email with invoice attached | On-screen; email confirmation (`order_confirmed`) without attachment; no WhatsApp | `lib/payments.js` `finalizeOrderPayment` → `notify`; `pages/OrderDetail.jsx` | W notifications test (logging); N dispatch email tests | PARTIALLY IMPLEMENTED | PDF invoice attachment; WhatsApp (blocked) |
| SHP-09 | Mobile-first | Every screen phone-first | Responsive CSS; manual QA at 6 widths on 5 Nov 2026 | `docs/archive/2026-11-05-remediation-audit/VISHREA_UI_UX_FUNCTIONAL_AUDIT.md` | Manual only | IMPLEMENTED — TESTING REQUIRED | Re-check new screens (Membership, Wardrobe Bag, Gifting) |

## 5. Payments, shipping, invoicing, exchanges (§7)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| PAY-01 | Razorpay | UPI first, cards, net banking, wallets; UPI Autopay for memberships | Orders, verification, capture, refunds, webhooks; subscriptions for membership | `lib/razorpay.js`; `api/payment-verify.js`; `lib/billing.js` | G "order → authorize → verify signature → capture → refund"; SG; P payment tests (stand-in) | BLOCKED BY EXTERNAL PROVIDER | Live keys; Subscriptions/UPI Autopay activation |
| PAY-02 | No cash on delivery | COD off; admin switch default off | No COD path exists; `cod_enabled` setting exists but has no effect | `lib/settings.js` `cod_enabled` | None | PARTIALLY IMPLEMENTED | Either wire the switch or remove it (no COD flow requested) |
| PAY-03 | Payment lock, never charged twice | Lock only during payment (≤ 5 min); never two charges for one piece | Holds, first payment wins, late/duplicate payments refunded automatically | `lib/inventory.js`; `lib/payments.js` `finalizeOrderPayment`, `refundDuplicatePayment` | P "two customers racing…", "expired hold + late payment… refund, no oversell", "a second capture… refunded once" | VERIFIED COMPLETE | Default hold 15 min vs spec 5 (DEC-09) |
| SHP-10 | Courier set-up | Configurable in admin | Courier names/tracking URLs in a code constant; tracking number entered by admin | `vishrea-react/src/lib/couriers.js`; `api/admin/ops.js` `updateOrder` | P "catalogue → bag → pay → tracked dispatch…" | PARTIALLY IMPLEMENTED | Admin-editable courier list; courier integration proposal |
| SHP-11 | India only | Domestic model, extensible | Indian states validated; place-of-supply GST | `lib/validate.js` `indianState`; `lib/pricing.js` | P "inter-state delivery uses IGST; pickup is free and intra-state" | VERIFIED COMPLETE | — |
| SHP-12 | Dispatch promise | 48 h after order or "Ship my bag" | `dispatch_hours` setting; text in Wardrobe Bag email; no SLA tracking | `lib/settings.js`; `lib/notify.js` `bag_shipped` | None | PARTIALLY IMPLEMENTED | Dispatch-due indicator in admin |
| SHP-13 | Studio pickup | Free pickup; in-person credit redemption | Pickup free at checkout and for the Wardrobe Bag; store-mode API accepts `payment_mode:'credit'`, but the Store Mode screen offers only UPI/Card/Cash with no customer field | `lib/pricing.js` `calculateShipping`; `api/admin/ops.js` `storeSale`; `Admin.jsx` Store Mode | P "inter-state… pickup is free"; W "…studio pickup is free" | PARTIALLY IMPLEMENTED | Credit redemption in the Store Mode UI; test |
| SHP-14 | Tracking on WhatsApp | Tracking updates on WhatsApp | Dispatch email | `lib/notify.js` `sendDispatchNotification` | N "dispatch email goes to Resend…" | BLOCKED BY EXTERNAL PROVIDER | WhatsApp API (DEC-12) |
| INV-01 | Automatic GST invoice | Every paid order and membership charge, registered name, HSN, slab per piece | `invoice_records` for orders and membership payments (incl. each autopay debit); HSN per line; seller details from settings (not yet supplied); no invoice for the ₹99 bag fee or online gift purchases | `lib/payments.js` `createOrderInvoice`, `finalizeMembershipPayment` | R acceptance ("every debit is invoiced") | PARTIALLY IMPLEMENTED | Seller legal details (DEC-14); store seller details on each invoice (today read from current settings when displayed, so old invoices change if settings change); membership invoices assume intra-state; HSN falls back to `6204`; bag-fee and gift invoices; accountant GST confirmation |
| INV-02 | Invoice access | Emailed, downloadable in My Vishrea, bulk export | Invoice viewable/printable on the order page; numbers listed on Membership page; CSV export; not e-mailed as a document; no PDF | `pages/OrderDetail.jsx` (print); `api/admin/ops.js` export `invoices` | P "CSV export neutralises spreadsheet formulas" | PARTIALLY IMPLEMENTED | PDF generation + email attachment |
| EXC-01 | 7-day exchange | Every piece incl. credit and Premium | Window from `delivered_at`, `exchange_days`; no Premium/credit exclusion; a request covers the whole order (no per-piece selection) | `api/exchange.js` | P "requires a delivered paid order, inside the window, one open request at a time" | PARTIALLY IMPLEMENTED | Per-piece exchange selection; tests for credit-redeemed and Premium pieces |
| EXC-02 | Didn't like it | Exchange only (another piece or store credit); ₹99 return shipping paid by customer | Request recorded; no store credit, no return fee | `api/exchange.js` | None | PARTIALLY IMPLEMENTED | Store credit + ₹99 return fee (DEC-16) |
| EXC-03 | Damaged | Within 24 h with photos; Vishrea pays return; customer chooses refund or exchange | 24 h window; photos now required; resolution is free text | `api/exchange.js` (`damage_photos_required`) | P exchange window test | PARTIALLY IMPLEMENTED | Refund/exchange choice; test for the photo rule |
| EXC-04 | Manual claim handling | Admin queue with photos; approve/reject, book return, quality check, restock or write off | Queue with transitions, resolution, quality check, return tracking; photos not shown in the admin list; no restock/write-off action | `api/admin/ops.js` `section=exchange`; `Admin.jsx` exchanges | R "exchange updates validate the id and the transition" | PARTIALLY IMPLEMENTED | Photo view; restock/write-off with stock update |

## 6. Accounts, notifications, loyalty, referrals (§8)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| ACC-01 | Wearers in My Vishrea | Up to 5 with colour passport and measurements; add/edit/delete | As CUS-02 | `pages/Account.jsx` `Wearers` | See CUS-02 | PARTIALLY IMPLEMENTED | Per-wearer colour passport |
| ACC-02 | Account contents | Credits with expiry dates, Wardrobe Bag, orders & tracking, exchanges, downloadable invoices, saved looks | All except per-credit dates, PDF invoices and saved looks | `pages/Account.jsx`, `Wardrobe.jsx`, `Orders.jsx`, `OrderDetail.jsx`, `Membership.jsx` | P "catalogue → bag → pay → tracked dispatch → delivered → exchange" | PARTIALLY IMPLEMENTED | See MEM-04, INV-02, SHP-05 |
| ACC-03 | Loyalty progress | e.g. "Month 4 of 6 to your free piece", "1 more order to your 50% order"; new rules appear automatically | 6th-month progress on the Membership page; no order-count progress or rule-driven progress | `pages/Membership.jsx` milestone block; `lib/membership.js` `milestoneProgress` | R six-month tests (`milestone.current_month`) | PARTIALLY IMPLEMENTED | Depends on LOY-BLD and LOY-P1 |
| ACC-04 | Referral and membership controls | Referral code with share buttons; pause, cancel, gift | Code + copy-link; pause/resume/cancel; gifting page | `pages/Account.jsx` `Referrals`; `pages/Membership.jsx`; `pages/Gifting.jsx` | R referral tests; R pause/cancel tests | PARTIALLY IMPLEMENTED | WhatsApp/Instagram share buttons |
| ACC-05 | Delete my account and data | Self-service | Typed confirmation; cancels membership and mandate; erases personal data; revokes sessions | `api/account.js` `delete_data`; `pages/Account.jsx` `DeleteAccount` | W "'Delete my account and data' needs a typed confirmation, stops billing first…" | VERIFIED COMPLETE | — |
| NOT-01 | WhatsApp as main channel | Business API on +91 6364116567 for drops, orders, tracking, credits, payment reminders | Every notification logs a WhatsApp record as `provider_not_configured` | `lib/notify.js` `notify` | W "…WhatsApp is recorded as not configured…" | BLOCKED BY EXTERNAL PROVIDER | WhatsApp Business API account and templates (deferred in proposal, DEC-12) |
| NOT-02 | Email and SMS | Email for invoices/receipts; SMS only as OTP backup | Email via Resend for codes and notifications; no SMS | `lib/notify.js` | N tests (stand-in) | PARTIALLY IMPLEMENTED | Verify sender domain; SMS backup (DEC-07) |
| NOT-03 | Message choices | Customers choose messages; marketing needs opt-in | Preferences (WhatsApp, email, marketing) in My Vishrea; `notify` honours them | `pages/Account.jsx` ProfileForm; `lib/notify.js` | W notifications test (marketing consent) | IMPLEMENTED — TESTING REQUIRED | UI test |
| LOY-BLD *(derived: "Loyalty & Offers Builder")* | Owner-controlled rule builder | Who/when/reward/applies-to/limits/run; all programmes built with it | Rules can be created, edited and paused in admin and stored; **pricing never applies them** | `api/admin/ops.js` `section=loyalty`; `Admin.jsx` loyalty; tables `loyalty_rules`, `pricing_rules`, `loyalty_events` | None | PARTIALLY IMPLEMENTED | Rule engine in pricing/checkout (DEC-11) |
| LOY-P1 *(derived)* | 6th Order 50% | Non-members: after 5 orders, 6th order ≥ ₹4,000 → 50% off regular pieces; repeats | None found | — | None | NOT IMPLEMENTED | Needs LOY-BLD or a dedicated rule |
| LOY-P2 *(derived)* | 6th Month Free Piece | As MEM-10 | As MEM-10 | — | — | VERIFIED COMPLETE | As MEM-10 |
| LOY-P3 *(derived)* | Referral reward | Referrer gets 1 free piece credit when the new member pays her first 2 months; one per new member | Referrer reward entitlement on the friend's first membership payment; idempotent; revoked/flagged on refund | `lib/referrals.js` `referralForFirstPayment`, `qualifyReferral` | R "new customer gets ₹150 off…; referrer earns one free piece once", "monthly autopay debits… never earn the referrer another piece" | VERIFIED COMPLETE | Live payment check |
| LOY-P4 *(derived)* | Referral welcome | First payment **₹100 off** (spec) | **₹150 off** the first 2 months (client clarification 7 Nov) | `lib/referrals.js` `referralDiscountFor`; setting `referral_discount_inr` | R "new customer gets ₹150 off the first 2-month membership only…" | PENDING CLIENT APPROVAL | Written confirmation of ₹150 vs ₹100 (DEC-01) |
| LOY-P5 *(derived)* | Face of the Week | ₹500 voucher on Premium dresses, 30 days, no stacking (proposed) | None found | — | None | NOT IMPLEMENTED | Voucher engine (LOY-BLD) |
| LOY-P6 *(derived)* | Birthday reward | Set by the owner in the builder | Birthday stored on wearers; no reward | `wearer_profiles.birthday` | None | DATABASE ONLY | Owner to define reward (DEC-15) |
| LOY-01 | Profit guard | Estimated monthly cost; warn if any piece sells below cost + GST | Admin can type an estimated cost on a rule; no calculation or warning | `api/admin/ops.js:721` (`estimated_monthly_cost`); `Admin.jsx:1366` | None | PARTIALLY IMPLEMENTED | Computed estimate + below-cost warning |
| LOY-02 | Results per rule | Redemptions, cost, revenue per rule | `loyalty_events` table never written | `migrations/010` | None | NOT IMPLEMENTED | Depends on LOY-BLD |
| LOY-03 | Referral safety | Referrer credit only after the new member's first 2-month payment succeeds | Implemented server-side after verified payment | `lib/payments.js` `finalizeMembershipPayment` → `qualifyReferral` | R "an existing member cannot claim…; a failed payment earns nothing" | VERIFIED COMPLETE | — |
| REV-01 | Vishrea Stories | Owner uploads screenshots/videos of tagged posts; Face of the Week on home page | Instagram link cards and up to 3 customer videos (≤ 10 s) managed in admin; no Face of the Week | `api/admin/ops.js` `section=content`; `instagram_content`, `feedback_videos` | P "videos over 10 seconds are rejected server-side and only 3 may be live" | PARTIALLY IMPLEMENTED | Face of the Week pick |
| REV-02 | Consent before showing a post | One-tap consent link on WhatsApp | `story_consents` table only | `migrations/010` | None | DATABASE ONLY | Consent flow (needs WhatsApp or email link) |
| REV-03 | Live Instagram feed | [2.0] | — | — | — | NOT APPLICABLE | — |
| REV-04 | Vishrea Points | [2.0] | — | — | — | NOT APPLICABLE | — |

## 7. Back office (§9)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| BO-01 | AI listing studio | 3 photos + cost + supplier → background removal, logo, tags, title, description, price; owner approves and schedules into a drop | AI text suggestions (title, description, tags, colour season, price) from owner-entered facts; no image processing; owner approval required; drop assignment in the product editor | `api/admin/listing-studio.js`; `lib/ai.js`; `Admin.jsx` listing studio | None (needs an AI provider key) | PARTIALLY IMPLEMENTED | Image processing; AI provider credentials (BLOCKED for live use) |
| BO-02 | Inventory | Live status, stock age with 21-day rule, gap alerts | Product/variant stock, stock-age buckets, low-stock list | `api/admin/ops.js` `dashboard`, `products` | P admin catalogue tests | PARTIALLY IMPLEMENTED | 21-day automation (CAT-08); gap alerts (CAT-11) |
| BO-03 | Orders | List to fulfil; packed/dispatched/tracking by hand; gift orders flagged with message; prices hidden on slip | Order list with status, tracking, filters; gift flag/message not shown in admin list; no packing slip | `api/admin/ops.js` `updateOrder`; `Admin.jsx` orders | P "unpaid orders cannot be dispatched"; R "abandoned checkouts are hidden…" | PARTIALLY IMPLEMENTED | Gift flag + message; packing slip |
| BO-04 | Store mode | Search/browse, sell by UPI QR via Razorpay or member credits; invoice on WhatsApp; gone online instantly | Store sale takes stock atomically, records payment mode (upi/cash/card/credit), creates invoice; no Razorpay QR; no WhatsApp | `api/admin/ops.js` `storeSale` | None | PARTIALLY IMPLEMENTED | Razorpay QR; store-mode test |
| BO-05 | Exchange and damage queue | Manual entry and review | Admin queue with status transitions and resolution; the API accepts quality check and return tracking but the screen does not show or edit them, nor the photos | `api/admin/ops.js` `section=exchange`; `Admin.jsx` exchanges | R "exchange updates validate the id and the transition" | PARTIALLY IMPLEMENTED | Photos, quality check and return tracking on screen (EXC-04) |
| BO-06 | Customer records | Wearers, orders, credits, loyalty progress, membership history, owner notes | Drill-down with wearers, membership + months, orders, colour, rewards, referrals, credit ledger; no owner notes | `api/admin/ops.js` `section=customer`; `AdminExtras.jsx` `CustomerDetail` | R "admin customer drill-down returns wearers, membership…" | PARTIALLY IMPLEMENTED | Owner notes; membership events/attempts in the drill-down |
| BO-07 | Membership operations | Lists of failed payments, pauses, cancellations with reasons | Data captured (`membership_events`, `membership_payment_attempts`, `cancel_reason`); CSV export of attempts and payments; no dedicated admin lists | `lib/billing.js`; `api/admin/ops.js` export `payment_attempts` | W "customers cannot use admin billing data or exports" | PARTIALLY IMPLEMENTED | Admin screens for the three lists |
| BO-08 | Sourcing log | Batches with supplier, cost, date; pieces link to supplier; best sources | Sourcing batches and product sources in admin; no "sells best" report | `api/admin/ops.js` `section=source`/`sourcing`; tables `sourcing_batches`, `product_sources` | None | PARTIALLY IMPLEMENTED | Supplier performance report |
| BO-09 | Users and roles | Owner and Helper from day one; every action logged | Single admin role (+ e-mail allow-list); broad audit log | `lib/auth.js` `hasAdminRole`, `adminAllowlist`; `lib/audit.js` | R "an admin email allowlist limits admin access…" | PARTIALLY IMPLEMENTED | Owner/Helper permissions |
| BO-10 | QR tags, scan-to-pack, printing | [2.0] | — | — | — | NOT APPLICABLE | — |
| BO-11 | Data migration | [2.0] | — | — | — | NOT APPLICABLE | — |

## 8. Omnichannel (§10)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| OMN-APP *(derived)* | Installable web app | Installs to home screen with drop alerts | No manifest or service worker found | — | None | NOT IMPLEMENTED | PWA manifest + service worker |
| OMN-01 | WhatsApp number check | Confirm +91 6364116567 can be used | External | — | — | BLOCKED BY EXTERNAL PROVIDER | Owner/Meta confirmation |
| OMN-02 | Instagram Shop links out | Intended behaviour | Instagram Shop not set up | — | — | PENDING CLIENT APPROVAL | Deferred in proposal (DEC-12) |
| OMN-03 | Live catalogue sync | Google and Meta live APIs; sold pieces removed ≤ 5 min; drops only after public | Not implemented (early-access exclusion already holds for the sitemap) | — | — | PENDING CLIENT APPROVAL | Deferred in proposal (DEC-12) |
| OMN-04 | Clean catalogue photos + structured data | Logo-free main photo; Product structured data | `catalogue_image_url` field; Product JSON-LD with per-size offers | `lib/seo.js`; `products.catalogue_image_url` | S "product page: … Product schema with per-size offers" | PARTIALLY IMPLEMENTED | Logo-free image generation (BO-01) |
| OMN-05 | Late clicks | Sold piece shows "This piece found a new home" + similar pieces in her colours/size | Sold-out state and 4 related pieces (not colour/size matched) | `pages/ProductDetail.jsx`; `api/product.js` | None | PARTIALLY IMPLEMENTED | Message + colour/size matching |
| OMN-06 | Merchant accounts | Google Merchant Center, Meta Commerce Manager in Vishrea's name | External | — | — | BLOCKED BY EXTERNAL PROVIDER | Deferred in proposal |

## 9. AI capabilities (§11)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| AI-PFC *(derived)* | "Picked for your colours" [1.0] | Rank pieces by colour season and size per member | Colour-season filter only; no ranking | `api/catalogue.js` `colour_season` | R "catalogue filters by colour season…" | PARTIALLY IMPLEMENTED | Ranking + home section |
| AI-01 | AI never publishes or prices alone | Owner approval required | Listing studio returns `approval_required:true`; never writes products | `api/admin/listing-studio.js` | None | IMPLEMENTED — TESTING REQUIRED | Test |
| AI-02 | Face photos | Processed only for analysis, deleted immediately, never used for training | Analysis runs in the browser; server accepts derived attributes only | `pages/SkinToneAnalysis.jsx`; `api/colour-review.js` | P "colour profile accepts derived attributes only" | VERIFIED COMPLETE | — |
| AI-1.1 / AI-2.0 | Style my 4, fit confidence, alerts, assistants, planners, try-on, content engine | [1.1]/[2.0] | — | — | — | NOT APPLICABLE | — |

## 10. Admin panel (§12)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| ADM-01 *(derived)* | Dashboard | Active/new/cancelled members; revenue and profit; credits issued/used/expired; stock and age; gaps; acquisition cost by channel | Revenue (orders + membership), active members, credits issued/used, stock age, gaps, failed payments; no profit, cancellations per month or acquisition cost | `api/admin/ops.js` `dashboard` | R "dashboard reports membership revenue and honours a date range" | PARTIALLY IMPLEMENTED | Profit, churn, acquisition cost (needs NFR-07) |
| ADM-02 *(derived)* | Excel export | Every screen and report | CSV exports for orders, customers, products, invoices, membership payments, autopay attempts, bag shipments | `api/admin/ops.js` `exportCsv` | P "CSV export neutralises spreadsheet formulas"; W export permission test | PARTIALLY IMPLEMENTED | Excel (.xlsx) and remaining screens (DEC-17) |
| ADM-03 *(derived)* | Settings, none hard-coded | All §12 defaults editable | 40+ typed settings with audit; gaps: `offer_after_days`, `dispatch_hours`, `cod_enabled`, `renewal_window_days` defined but unused; legacy seed keys `payment_lock_minutes`, `pause_months`, `autopay_retries`, `drop_public_at` unused; several numbers hard-coded in copy and dashboard buckets; drop day/time is per drop; payment lock default 15 min (spec 5) | `lib/settings.js` `SETTING_META`; `lib/settings-admin.js` | R settings tests (types, validation, view) | PARTIALLY IMPLEMENTED | Wire unused settings; DEC-09 |
| ADM-04 *(derived)* | Works on a phone | Full admin on mobile | Manual QA at 2 widths (5 Nov) | `docs/archive/2026-11-05-remediation-audit/VISHREA_UI_UX_FUNCTIONAL_AUDIT.md` | Manual | IMPLEMENTED — TESTING REQUIRED | Re-test new admin areas |
| ADM-05 *(derived)* | Occasional controls | Categories, builder, settings, users & roles, legal pages, message templates, home banner and tagline | Categories, settings, legal pages, content; no users & roles screen, message templates or banner editor | `Admin.jsx`, `AdminExtras.jsx` | R settings/legal tests | PARTIALLY IMPLEMENTED | Users & roles, templates, banner |

## 11. Quality, security, privacy and ownership (§13)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| NFR-01 | Speed | < 2.5 s on 4G phones | Code-split SPA, cached assets, SSR meta; no measurement on record | `server.js` static caching; Vite build | None | IMPLEMENTED — TESTING REQUIRED | Lighthouse/WebPageTest on the deployed site |
| NFR-02 | Drop-time load | 10× year-1 peak; sold piece gone ≤ 2 s; never sold twice | Concurrency-safe stock (tested); no load test | `lib/inventory.js` | P "twenty buyers for three units…", "two customers racing…" | PARTIALLY IMPLEMENTED | Load test; cache latency (CAT-06) |
| NFR-03 | Security | Razorpay holds card data; OTP customers; 2-step admin; HTTPS; daily backups 30 days | Razorpay only; OTP login; HTTPS/HSTS in production; no admin 2-step; backups depend on the hosting plan (not verified) | `lib/http.js`; `api/auth.js` | PD "plain HTTP is redirected…", "HSTS and an enforcing CSP…" | PARTIALLY IMPLEMENTED | Admin 2-step (DEC-10); backup policy evidence |
| NFR-04 | Privacy (DPDP) | Consent at sign-up; face photos deleted; data in India; self-service deletion | On-device analysis; deletion verified; marketing opt-in; no consent step at sign-up; database region not verified | `api/account.js` `delete_data` | W deletion test; P colour test | PARTIALLY IMPLEMENTED | Consent at sign-up; confirm Supabase region is India (DEC-13) |
| NFR-05 | Legal pages | Privacy, terms, exchange & damage, membership terms, business name/address, grievance officer | Pages exist; business and grievance details are settings published only after owner verification (not yet supplied) | `api/legal.js`; `content/policies.js`; settings `seller_*`, `grievance_officer_*` | R "legal details are published only after the owner marks them verified" | PARTIALLY IMPLEMENTED | Owner to supply details (DEC-14) |
| NFR-06 | Monitoring | Instant WhatsApp alert on checkout/payment failure; 99.5% uptime | Structured logs and `/api/health`; no alerting | `lib/log.js`; `server.js` health | PD "plain HTTP… health stays reachable" | NOT IMPLEMENTED | Alerting (needs WhatsApp or another channel) |
| NFR-07 | Marketing tracking | Google Analytics, Meta pixel → acquisition cost | None found | — | None | NOT IMPLEMENTED | Tags + consent (DEC-13) |
| NFR-08 | Language | English only in 1.0 | English UI | `vishrea-react/src` (inspection) | Inspection | VERIFIED COMPLETE | — |
| NFR-09 | Design | Minimal luxury, mobile-first, readable, on-brand | Implemented design system | `vishrea-react/src/index.css` | Manual QA (5 Nov) | IMPLEMENTED — TESTING REQUIRED | Client design sign-off |
| NFR-10 | Ownership and handover | Code, domain, data and accounts owned by Vishrea; handover notes | Remote `github.com/vishreastudio-dev/VISHREA-STUDIO`; handover notes in `docs/` | `git remote -v` | Inspection | IMPLEMENTED — TESTING REQUIRED | Confirm repository/account ownership; handover at release |

## 12. Security clause (§15)

| Requirement ID | Requirement | Client expectation | Existing implementation | Evidence / file path | Test status | Current status | Remaining work |
|---|---|---|---|---|---|---|---|
| SEC-01 | Accounts in Vishrea's name | All accounts owned by Vishrea; named logins | Not verifiable from code | — | — | PENDING CLIENT APPROVAL | Owner confirmation per account |
| SEC-02 | Secure development | OWASP practices; no secrets in source; private repository | `.env` git-ignored, only examples tracked; parameterised SQL; CSP, CSRF origin guard, rate limits | `.gitignore`; `lib/http.js`; `lib/db.js` | P "security headers are set and cross-origin mutations are refused", "rate limiting returns 429"; inspection `git ls-files`; history check found secret-like values in commits `b106e8e` and `18aae1d` (`.env.example`, `start.ps1`, `../archive/SYSTEM_FLOW_AND_CHECKLIST.md`; values not inspected) | PARTIALLY IMPLEMENTED | Rotate any credential that ever appeared in git; confirm the repository is private (Security Audit S-16) |
| SEC-03 | Customer data (DPDP) | No real data on personal devices/test environments; test data dummy | Automated tests use throwaway databases with generated data; staging connects to a hosted database from a developer machine | `test/helpers.js` | Inspection | PARTIALLY IMPLEMENTED | Confirm staging holds no real customer data |
| SEC-04 | Payment data | No card/UPI details handled | Razorpay Checkout only | `lib/razorpay.js` | SG, G | VERIFIED COMPLETE | — |
| SEC-05 | Access control | Admin 2-step; least-privilege roles; audit log ≥ 1 year | Audit log (no deletion job); single admin role; no 2-step | `lib/audit.js`; `lib/auth.js` | R allow-list test | PARTIALLY IMPLEMENTED | 2-step; roles (DEC-10) |
| SEC-06 | Encryption | TLS everywhere; data and backups encrypted at rest | TLS enforced in production; at-rest encryption is a hosting-provider property (not verified) | `lib/http.js` `httpsRedirect`; `lib/db.js` SSL | PD HTTPS tests | IMPLEMENTED — TESTING REQUIRED | Provider confirmation |
| SEC-07 | Pre-launch testing | Vulnerability scan + basic penetration test; fix critical/high | Not performed | — | — | NOT IMPLEMENTED | Run before go-live |
| SEC-08 | Incident reporting | Report within 6 h (CERT-In) | No runbook | — | — | NOT IMPLEMENTED | Incident runbook (see Release Checklist) |
| SEC-09 | Third parties | Owner's written approval | Razorpay, Resend, hosted PostgreSQL (Supabase), optional OpenAI | `.env.example` | — | PENDING CLIENT APPROVAL | Written approval of the list |
| SEC-10 | Team confidentiality | Signed undertakings | Contractual | — | — | NOT APPLICABLE | — |
| SEC-11 | Exit | Hand over and delete data | At engagement end | — | — | NOT APPLICABLE | — |

## 13. Acceptance tests for 1.0 (§14)

| ID | Acceptance test (client wording, abridged) | Automated evidence | Status |
|---|---|---|---|
| AT-01 | Two customers pay for the same piece: one charged; other sees "This piece just found a new home" | P "two customers racing for the same one-of-one: exactly one wins" (message text not implemented) | PARTIALLY IMPLEMENTED |
| AT-02 | Store-mode sale disappears online within 2 s | No test; catalogue cache up to 30 s | PARTIALLY IMPLEMENTED |
| AT-03 | New member pays 2 months upfront by UPI Autopay; 4 credits; month 2 issues 4 more | R "acceptance: ₹3,598 once with the mandate…" (stand-in) | BLOCKED BY EXTERNAL PROVIDER (live UPI Autopay) |
| AT-04 | Credit unused 60 days expires; cancelling lapses all credits | P "expired credits cannot be redeemed…"; R cancellation test | VERIFIED COMPLETE |
| AT-05 | Autopay fails: 3 retries / 5 days, WhatsApp reminders, credits frozen, then paused | R "a failed debit freezes credits…" (stand-in; no WhatsApp) | BLOCKED BY EXTERNAL PROVIDER |
| AT-06 | Ship 4 credit picks free; ship 2 and pay ₹99 | W Wardrobe Bag tests | IMPLEMENTED — TESTING REQUIRED (live ₹99 payment) |
| AT-07 | Credits cannot be used on Premium | P "credit redemption is atomic and premium pieces are excluded" | VERIFIED COMPLETE |
| AT-08 | ₹2,800 piece with a 15% offer invoiced at 5% (₹2,380) | PR GST slab test covers sale prices; percentage offers do not exist | PARTIALLY IMPLEMENTED |
| AT-09 | Non-member's 6th order ≥ ₹4,000 gets 50% off regular pieces | None | NOT IMPLEMENTED |
| AT-10 | After 5 paid months, 6th month issues 4 credits + 1 free piece; pause/missed payment resets | R six-month test; pause and halted tests | VERIFIED COMPLETE (free piece is a separate reward — DEC-02) |
| AT-11 | Referral credit only after the first payment; new member gets ₹100 off | R referral tests (₹150 per clarification) | PENDING CLIENT APPROVAL (DEC-01) |
| AT-12 | Gift order adds ₹50; packing slip shows no prices | W "…a gift box adds ₹50 packing at checkout" (no packing slip) | PARTIALLY IMPLEMENTED |
| AT-13 | Cancelling takes no more than two taps | Membership page: "Cancel membership" → "Confirm cancellation" (inspection) | IMPLEMENTED — TESTING REQUIRED |
| AT-14 | Face photo gone from storage after the result is saved | P "colour profile accepts derived attributes only" (photo never uploaded) | VERIFIED COMPLETE |
| AT-15 | Every §12 setting changeable in admin without code | R settings tests; unused settings listed in ADM-03 | PARTIALLY IMPLEMENTED |
| AT-16 | *(soft launch on the live system)* | Not started | NOT IMPLEMENTED |

## 14. Totals (client requirement rows, §1–§12)

| Status | Count |
|---|---|
| VERIFIED COMPLETE | 16 |
| IMPLEMENTED — TESTING REQUIRED | 15 |
| PARTIALLY IMPLEMENTED | 62 |
| BACKEND ONLY | 1 |
| DATABASE ONLY | 3 |
| NOT IMPLEMENTED | 11 |
| BLOCKED BY EXTERNAL PROVIDER | 7 |
| PENDING CLIENT APPROVAL | 5 |
| NOT APPLICABLE | 7 |
| **Total rows** | **127** |

Counted from the rows above on 7 Nov 2026 (revised after the independent per-area audits: CUS-01, EXC-01, BO-05, SHP-13 and SEC-02 were downgraded on new evidence). Of the 127 rows, 110 carry the client's original IDs, 16 are marked *derived* (requirements the specification states without an ID: launch flow, loyalty programmes and builder, installable app, "Picked for your colours", admin panel items) and 1 groups the [1.1]/[2.0] AI items. Acceptance tests (§13) are counted separately: 4 verified complete, 2 implemented — testing required, 5 partially implemented, 2 not implemented, 2 blocked by an external provider, 1 pending client approval (16 in total).

## 15. Technical enhancements not explicitly required by the client

| Ref | Enhancement | Evidence | Status |
|---|---|---|---|
| ENH-01 | Piece requests ("Request a piece") | `api/piece-requests.js`, table `piece_requests` | IMPLEMENTED — TESTING REQUIRED (P "piece requests reject script URLs…") |
| ENH-02 | SEO kit: server-rendered meta, JSON-LD, sitemap, robots | `lib/seo.js`; S (7 tests) | VERIFIED COMPLETE |
| ENH-03 | Payment reconciliation job (recheck, automatic refunds with retries) | `lib/payments.js` `reconcilePayments` | VERIFIED COMPLETE (P reconciliation tests; stand-in) |
| ENH-04 | Duplicate-capture and late-payment automatic refunds | `lib/payments.js` | VERIFIED COMPLETE (stand-in) |
| ENH-05 | Admin e-mail allow-list | `lib/auth.js` | VERIFIED COMPLETE |
| ENH-06 | Typed settings with before/after audit | `lib/settings-admin.js` | VERIFIED COMPLETE |
| ENH-07 | Gift enquiry workflow (corporate/bulk) with hashed one-time codes | `lib/gifts.js`; R gift enquiry tests | VERIFIED COMPLETE |
| ENH-08 | Renewal grace period for prepaid/gift members (`renewal_grace_days`) | `lib/membership.js` `isWithinRenewalGrace` | IMPLEMENTED — TESTING REQUIRED |
| ENH-09 | Notification log with de-duplication | `lib/notify.js`, table `notifications` | VERIFIED COMPLETE |
| ENH-10 | Overdue-mandate re-sync from Razorpay when webhooks are missed | `lib/billing.js` `runBillingJobs` | IMPLEMENTED — TESTING REQUIRED |
| ENH-11 | Before/after stock adjustment audit | `lib/products-admin.js` (`inventory_adjusted`) | IMPLEMENTED — TESTING REQUIRED |
| ENH-12 | Production guards (weak secret, non-HTTPS origin, remote DB in development) | `lib/config.js`; PD tests | VERIFIED COMPLETE |
