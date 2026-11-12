# Development Evidence

| Field | Value |
|---|---|
| Document ID | VS-EVD-001 |
| Document title | Development Evidence |
| Version | 1.0 |
| Status | Current |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | Repository working tree, `git log`, test runs and staging checks of 7 Nov 2026 |

Related: [Requirements Traceability Matrix](../client/REQUIREMENTS_TRACEABILITY_MATRIX.md) · [Test Report](TEST_REPORT.md) · [Changelog](../client/CHANGELOG.md)

Only evidence that exists and was checked is listed. Nothing here is inferred from other documents.

## 1. Repository and version control

| Item | Evidence |
|---|---|
| Remote | `origin https://github.com/vishreastudio-dev/VISHREA-STUDIO.git` |
| Commits | 7 on the current branch: `b106e8e` (initial platform), `a8e9da5` (Supabase DB, SEO kit, reels, 3-image upload, Request a Piece), `1c7d5c5` (slug routing, CRUD, cascade delete), `4977865`, `ef9bbdf`, `64f96a1` (membership page design), `18aae1d` (platform audit, production hardening, journey verifications) |
| Uncommitted work | All remediation (5 Nov) and the 7 Nov changes (billing engine, Wardrobe Bag, early access, gifts, notifications, audit fixes) are **not committed**: 41 modified tracked files and 17 untracked files (5 source/test/migration files, the documentation set and the client specification PDF) at the time of writing (`git status --short`). Commit before release, excluding the client PDF (Security Audit S-11). |
| Secrets | `.env` is git-ignored; tracked env files are `.env.example`, `.env.development.example`, `.env.production.example`, `vishrea-react/.env.example` (`git ls-files`) |

## 2. Feature evidence

| Area | Source files and functions | API | Tables / migrations | Tests |
|---|---|---|---|---|
| Sign-in and sessions | `api/auth.js` (`/start-login`, `/verify-code`, `/signout`); `lib/auth.js` (`generateOtp`, `hashOtp`, `extractUser`) | `/api/auth/*` | `profiles`, `auth_otps` (013) | P authentication (5); PD OTP echo |
| Catalogue & product | `api/catalogue.js`; `api/product.js`; `lib/catalogue.js` (`fetchProduct`, `dropVisibleSql`, `hasEarlyAccess`) | `/api/catalogue`, `/api/product` | `products`, `product_variants`, `categories`, `drop_settings` (002, 010, 013) | P "malformed product data…"; R colour-season filter; W early access (2); S (7) |
| Admin catalogue | `lib/products-admin.js` (`saveProduct`, stock delta + `inventory_adjusted` audit); `Admin.jsx` product editor (drop select) | `POST /api/admin/ops?section=product` | `products`, `product_variants`, `audit_logs` | P admin catalogue (3) |
| Cart and checkout | `api/cart.js` (`addLine`, early-access check); `lib/cart.js` (`loadCartLines`, `isDropLocked`); `api/checkout.js` (`startCheckout`, bag method) | `/api/cart`, `/api/checkout` | `carts`, `cart_items`, `orders`, `order_items`, `inventory_reservations` | P pricing/checkout (6); W bag (2) |
| Payments and refunds | `lib/payments.js` (`finalizeOrderPayment`, `refundDuplicatePayment`, `reconcilePayments`, `finalizeMembershipPayment`); `api/payment-verify.js`; `lib/razorpay.js` | `/api/payment-verify`, `/api/webhooks/razorpay` | `payment_events`, `invoice_records` (013, 016) | P payment verification (16); G (2); SG (2) |
| Membership billing engine | `lib/billing.js` (`startSignup`, `verifyCheckout`, `applyFirstPayment`, `applyRecurringCharge`, `markRetrying`, `markHalted`, `markMandateCancelled`, `requestPause`, `requestResume`, `requestCancel`, `startRecovery`, `runBillingJobs`, `creditsUsable`); `api/membership.js`; `pages/Membership.jsx` | `/api/membership` | `memberships`, `membership_subscriptions`, `membership_payments`, `membership_payment_attempts`, `membership_events`, `billing_plans` (019) | R membership lifecycle (12) |
| Credits | `lib/credits.js` (`spendableFromLedger`, `reconcileExpiredCredits`); `lib/membership.js` (`grantDuePeriods`, `enforceHoldingLimit`) | — | `credit_ledger`, `membership_periods` (010, 017) | P credits (6); PR FIFO; R acceptance |
| 6th-month reward | `lib/membership.js` (`qualifiesForSixMonthReward`, `issueMilestoneReward`, `milestoneProgress`, `resetConsecutiveMonths`); `lib/rewards.js` | — | `reward_entitlements` (017, 018) | R six-month (6) |
| Referrals | `lib/referrals.js` (`attributeReferral`, `referralDiscountFor`, `referralForFirstPayment`, `qualifyReferral`); `api/referrals.js`; `pages/Account.jsx` `Referrals` | `/api/referrals` | `referrals`, `customer_profiles.referral_code` (017, 018) | R referrals (6), refund reversal (2) |
| Wardrobe Bag | `lib/bag.js` (`shipBag`, `finalizeBagShipment`, `confirmBagPayment`, `expireBagShipments`); `api/wardrobe.js`; `pages/Wardrobe.jsx`; `pages/Checkout.jsx` (bag option) | `/api/wardrobe` | `bag_shipments`, `orders.status = 'in_bag'` (019) | W (2) |
| Gifting | `lib/gifts.js` (`startGiftPurchase`, `finalizeGiftPurchase`, `issueGiftToken`, `redeemGiftToken`); `api/gifting.js`; `pages/Gifting.jsx`, `GiftRedeem.jsx` | `/api/gifting` | `admin_gift_enquiries`, `gift_memberships` (017, 019) | R gift enquiries (4); W gifts (3) |
| Exchanges | `api/exchange.js` (photo rule for damage); `api/admin/ops.js` `section=exchange` (+ customer e-mail) | `/api/exchange` | `exchanges` | P exchanges (1); R transitions |
| Notifications | `lib/notify.js` (`notify`, templates, `sendDispatchNotification`, `sendOtpEmail`) | — | `notifications`, `notification_preferences` (010, 019) | N (4); W notifications (1) |
| Account and privacy | `api/account.js` (wearers, addresses, preferences, `delete_data`); `pages/Account.jsx` (`ProfileForm`, `Wearers`, `DeleteAccount`) | `/api/account` | `customer_profiles`, `wearer_profiles`, `addresses` | W deletion (1); R drill-down |
| Colour analysis | `pages/SkinToneAnalysis.jsx`; `lib/colourEngine.js`; `api/colour-review.js` | `/api/colour-review` | `colour_reviews` (009) | P "colour profile accepts derived attributes only" |
| Admin operations | `api/admin/ops.js` (dashboard, settings, orders, store sale, exports, gift workflow, referrals, rewards); `lib/settings-admin.js`; `Admin.jsx`, `AdminExtras.jsx` | `/api/admin/ops` | `app_settings`, `audit_logs`, `store_sales` | R security & remaining fixes (19); W export permission |
| SEO | `lib/seo.js` | SSR on all page routes, `/sitemap.xml`, `/robots.txt` | — | S (7) |
| Security platform | `lib/http.js`, `lib/rate-limit.js`, `lib/config.js`, `lib/uploads.js`, `api/upload.js` | — | RLS lockdown (013) | P transport/upload (5); PD (8) |

## 3. Verification results recorded on 7 Nov 2026

| Check | Result |
|---|---|
| `npm test` | 140/140 pass (after fixes D-01 and D-02), 27 suites, 0 skipped |
| `npm audit --omit=dev` (root) / `npm audit` (frontend) | 0 / 0 vulnerabilities after `npm audit fix --omit=dev` |
| `npx oxlint` | 0 errors, 29 warnings |
| `npm run build:client` | Success |
| Staging catalogue | 20/20 migrations; 56 tables; RLS on all; nothing readable by `anon`/`authenticated` |
| Staging public APIs | `/api/catalogue` and `/api/product` contain no `cost_price` or `supplier` fields; `/api/content` returns one membership plan (2 months, ₹3,598, 6th-month offer) |
| Browser render (local dev server) | Membership page renders the "first 2 months + UPI Autopay" plan and FAQ (screenshot taken 7 Nov in the IDE browser; not stored in the repository) |

## 4. Earlier evidence still valid

- `docs/archive/2026-11-02-production-audit/PRODUCTION_VERIFICATION.md` (2 Nov) — production-mode and payment audit method.
- `docs/archive/2026-11-05-remediation-audit/VISHREA_UI_UX_FUNCTIONAL_AUDIT.md`, `docs/archive/2026-11-05-remediation-audit/VISHREA_IMPLEMENTATION_AUDIT.md` (5 Nov) — manual browser QA at 6 widths (18 customer URLs, 22 admin URLs, 12 customer and 9 admin journeys). The 7 Nov screens (Membership billing, Wardrobe Bag shipping, Gifting purchase, Account preferences/deletion) were **not** part of that round.
- `docs/archive/2026-11-05-remediation-audit/VISHREA_AUDIT_REMEDIATION_REPORT.md` (5 Nov) — remediation and business decisions BD-1…BD-8. BD-1 ("prepaid only, never charged automatically") is **superseded** by the 7 Nov billing engine; BD-3 is superseded by the consecutive-month rule.
- `docs/archive/2026-11-07-walkin-wardrobe-implementation-notes.md` (7 Nov) — billing engine implementation notes.

## 5. Evidence not available

- No screenshots or recordings are stored in the repository.
- No live Razorpay, Resend or WhatsApp transaction records.
- No performance, load, backup-restore or penetration-test reports.
