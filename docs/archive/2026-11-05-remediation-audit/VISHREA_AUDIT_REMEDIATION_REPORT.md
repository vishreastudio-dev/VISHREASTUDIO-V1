# Vishrea Studio — V1 Audit Remediation Report

| Item | Value |
|---|---|
| Date | 5 November 2026 |
| Baseline | `docs/archive/2026-11-05-remediation-audit/VISHREA_UNIVERSAL_APPLICATION_AUDIT.md`, `VISHREA_DEVELOPER_ACTION_REGISTER.md`, `VISHREA_UNIVERSAL_JOURNEY_TEST_CASES.md`, `VISHREA_ROUTE_API_TRACEABILITY.csv` |
| Architecture | Unchanged: React 19 + Vite + React Router · Express modular monolith · native `pg` · JWT HTTP-only cookie · Razorpay · on-device colour analysis |
| Production | **Not touched.** No production migration, data change, role change, secret rotation, live payment or deployment was performed. |
| Result | **READY FOR OWNER REVIEW** (see §18). Final business rules: §16 |

Verification used an isolated throw-away PostgreSQL 18 cluster (`127.0.0.1:55432`), the project's local Razorpay stand-in, and an isolated app instance started **outside the project directory**, so it could not read `.env`. No email was sent and no external API was called.

---

## 1. Summary

| Area | Outcome |
|---|---|
| Security baseline (DEF-15/17/18/34/35) | Code fixed and tested. Live secret rotation, admin review and `.env` separation **need owner action** (§6). |
| Production email (DEF-19) | Resend key placed in the git-ignored `.env`; OTP echo turned off there. **Delivery not verified.** The sender domain must be verified in Resend (§6.4). |
| Membership lifecycle (DEF-01/02/03) | Prepaid renewal-at-expiry model. 4 credits for every paid month, granted when the month starts. Expiry, optional early-renewal window (default off), history. |
| Six-month offer | One free-piece entitlement when the member's **6th consecutive paid month** starts (then the 12th, 18th, …), whether prepaid as 6 months or reached by renewing — never at purchase, exactly once per qualifying month. A pause, or renewing more than `renewal_grace_days` (5) after the paid period ends, restarts the count (MEM-10; corrected in migration 018, §5). |
| Business-rule clarification | No wallet or monetary credit added. The invented credit cap and pause-credit settings were removed. Rewards are eligible only for pieces/categories the owner selects (default none). Refunds revoke unused rewards and flag used ones. Central typed admin Settings with audit history (§16). |
| Referrals (DEF-06) | Per-customer code and link, server-side attribution, ₹150 off a new customer's first membership when it is the 2-month one (₹3,448), referrer free piece when the friend's first membership payment of any duration is verified. |
| Gift enquiries (DEF-10) | Enquiry form (individual / corporate) → `/admin/gift-enquiries` (pending → processed → invoiced) → one-time hashed redemption codes → recipient activation. |
| Wardrobe Bag (DEF-05) | Save from product page, Wardrobe Bag page, move to bag with credit or free-piece reward. No-op `ship` action removed. |
| Remaining P1–P3 | Implemented: DEF-07, 08, 11, 12, 13, 21 (data-ready), 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 37, 38, 40, 41, 42, 43 (data-ready), 44, 45, DOC-01. Documented only: DEF-04, 14, 20, 22, 23, 39, OBS-01, OBS-03. |
| Tests | **126 / 126 pass**, 21 suites, 0 skipped (was 78 before remediation, 109 before the clarification, 123 before the QA round). Lint: 0 errors, 27 warnings. Production build succeeds. |

---

## 2. Finding-by-finding record

| Finding | Root cause (verified in code) | Change made | Verified by |
|---|---|---|---|
| DEF-17 dev config against live DB, OTP echo, tunnel origin | Nothing stopped development mode from using a remote database or echoing codes | `lib/config.js`: production refuses `AUTH_DEV_OTP_ECHO=true`. Development refuses a remote `DATABASE_URL` unless `ALLOW_REMOTE_DATABASE=true`, and never echoes OTPs against a remote DB. New `.env.production.example` and `.env.development.example`. Local `.env`: `AUTH_DEV_OTP_ECHO=false` | `production.test.js` (2 new tests) |
| DEF-18 hard-coded JWT secret | Literal fallback in tracked `start.ps1` / `start.sh` | Scripts generate a random secret. `isWeakSecret()` rejects known leaked literals, <32 chars, placeholders and low-entropy values. Production also checks `OTP_PEPPER` when set | `production.test.js` (leaked literal, `x`×48 rejected) |
| DEF-15 bootstrap re-promotion | `verify-code` promoted `DEFAULT_ADMIN_EMAIL` on every login | Promotion only while **no active admin exists**, under an advisory lock | `remediation.test.js` “bootstrap admin email is not re-promoted” |
| DEF-16 4/4 live admins | Data | **No account changed.** Read-only `scripts/list-admins.js` lists them for the owner (§16.6). Optional `ADMIN_ALLOWED_EMAILS` allowlist limits access to owner-approved emails without touching roles | `remediation.test.js` allowlist test |
| DEF-34 wildcard tunnel origins | `*.trycloudflare.com` allowed in development | Removed; tunnels must be listed in `CORS_ORIGINS` | code |
| DEF-35 gateway 4xx treated as outage | All gateway errors were classed as “unreachable” | `lib/razorpay.js` exposes `upstreamStatus`. A 4xx lookup now rejects verification. Membership activation checks the amount **before** capture | full suite |
| DEF-01 membership never expires/renews | No job read `renewal_at` | `lib/membership.js`: paid months stored as `membership_periods`, `paid_through` tracked, `expireLapsedMemberships` in the 60 s job and on every membership read/checkout | `remediation.test.js` (expiry, renewal, failed payment, duplicates) |
| DEF-02 4 credits per 2 months | One grant per payment | One grant per paid month, when that month starts, idempotent by period | “a 2-month membership grants 4 credits per paid month (8 in total), once” |
| DEF-03 no recurring setup | Deferred | Kept prepaid; **no autopay introduced** (BD-1). Existing `subscription.charged` webhook path now appends paid months correctly | updated platform test |
| DEF-04 credit cap | No rule | **No cap implemented.** The interim `max_credit_balance` setting was removed in the clarification: no approved rule requires it | settings validation test (`unknown_setting`) |
| DEF-05 Wardrobe Bag | Backend only; `ship` no-op | PDP “Save to Wardrobe Bag”, `/wardrobe` page, `add_to_bag` with `none` / `credit` / `reward` | remediation test + browser |
| DEF-06 offers/referrals not applied | Pricing never read codes | Referral attribution + discount + referrer reward (§10). **Loyalty “offer rules” remain planning records** (no offer-code rule set approved) | remediation tests |
| DEF-07 wearer UI | Not built | Account: list / add / edit / delete. Foreign or unknown ids → 404 | browser (created “Me · M · bust 86 cm”) |
| DEF-08 profile edit | Not built | Account “Your details” form (`PUT /api/account`) | browser (phone persisted) |
| DEF-10 gift dead end | Draft row without payment or admin view | §11 | remediation tests + browser (GE-1001 → code issued) |
| DEF-11 admin customer view | List only | “Open” → drill-down: profile, membership + months, wearers, colour profile, orders, rewards/referrals, credit ledger | remediation test + browser |
| DEF-12 colour profile unused | Season not stored; never read | `colour_reviews.season`. Account shows it with “Shop pieces in …”. Catalogue `colour_season` filter + “In my colours”. Admin product season is a select of the 8 engine seasons (server-validated) | remediation test |
| DEF-13 settings stored as strings | `if/else` chain fell through to `text()` | One typed registry (`lib/settings.js` `SETTING_META`) drives storage, validation (`lib/settings-admin.js`), calculations and the admin **Settings** screen. Lists, references, cross-field rules, before/after audit | remediation tests (types, validation, view, audit) |
| DEF-14 015/016 unrecorded | Manual DDL | Migration rehearsal on a live-shaped DB proves 015, 016 and 017 apply and are idempotent (§13). Production run needs approval | `migration-rehearsal.test.js` |
| DEF-21 invoice seller details | Values empty | `seller_legal_name`, `seller_address` settings (plus existing GSTIN) printed on the invoice when set | code; values pending owner |
| DEF-22 local-disk uploads | Hosting | `.env.production.example` requires a persistent `UPLOADS_DIR`. Settings shows read-only storage health (§16.7). Hosting not migrated | settings view test + browser |
| DEF-24 damage photos | UI never sent evidence | Up to 5 photos via existing type-checked upload | code |
| DEF-25 exchange updates | No id check / transitions | 404 for unknown id. Allowed transitions enforced. Resolution required for approve/reject. UI shows only valid next states | remediation test |
| DEF-26 delivery without phone | Phone optional server-side | Required for all orders | remediation test |
| DEF-27 `/legal` 404 | Not handled | 301 → `/legal/privacy` | remediation test + HTTP |
| DEF-28 legacy admin modules | Unused but mounted | Unmounted from `API_MODULES` (now 404). Files `api/admin/{dashboard,products,orders,customers,content}.js` remain on disk for owner-approved deletion | remediation test |
| DEF-29 membership override | Not wired | Status select in admin Membership. Reactivation refused without a paid period; admin cancel voids unstarted months | remediation test |
| DEF-30 dashboard | Orders only, month only | Membership revenue, total revenue, date range, gift enquiries pending, memberships ending in 7 days | remediation test + browser |
| DEF-31 unbacked promises | Copy ahead of features | Removed “early access to drops” / “48-hour early access” from membership, home, gifting, FAQ and meta. Drops admin text says it is a planning record | code review |
| DEF-32 paused-member credit | Misleading error | `membership_not_active` at cart toggle and checkout | remediation test |
| DEF-33 orphan uploads | No cleanup | `cleanOrphanUploads` (opt-in `UPLOAD_ORPHAN_CLEANUP_DAYS`, every 6 h, only unreferenced files older than N days) | code |
| DEF-37 Premium text match | Badge text only | `products.credit_eligible` for **membership credits** (Premium always excluded; flag can exclude more). Backfilled from badge. Free-piece rewards use their own owner-selected eligibility (§16.4) | pricing + remediation tests |
| DEF-38 legal / pickup editors | Not built | Content & Legal: policy editor and studio-pickup form | browser render |
| DEF-40 9 px checkout inputs | `label{9px}` + `input{font:inherit}` | Controls 16 px, ≥46 px tall; `select` padded | browser: checkout/gifting 16 px / 46–49 px |
| DEF-41 guest thumbnail | Missing category/image on guest line | Guest line stores image and category | code |
| DEF-42 gift guest message | Plain text | Gifting is now a guest-friendly enquiry; redemption page links to sign-in | browser |
| DEF-43 contact compliance | Data missing | Legal name, address, GSTIN and grievance officer are entered in Settings → Legal information and published on the contact page **only after** “Owner has verified these details” is ticked | legal visibility test + browser; data pending owner |
| DEF-44 sort select / stale search | CSS / state | Sort 13 px / 40 px. Search box follows the URL | browser |
| DEF-45 CTA below fold, focus | Layout | Membership CTA inside the first card (496 px from top at 1440×900). Visible `:focus-visible` outlines | browser |
| DEF-23 AI Listing Studio | No key | Unchanged (optional) | — |
| DEF-39 Unsplash imagery | Content | Unchanged (needs studio photography) | — |
| DOC-01 | Docs not maintained | `docs/archive/2026-11-05-remediation-audit/verification-checklist.md` rewritten; accuracy note on `../SYSTEM_FLOW_AND_CHECKLIST.md` | — |

---

## 3. Membership billing lifecycle (BD-1: prepaid renewal at expiry)

1. The customer chooses **2 months (₹3,598)** or **6 months (₹10,794)**. The server computes price × months, minus a referral discount if eligible. Razorpay receives the server amount, and `activate_paid` / the webhook must match it.
2. A verified payment (signature + gateway cross-check, or a signed webhook) appends one `membership_periods` row per month:
   - While running (`active`/`paused` and `paid_through` in the future), the new months start at `paid_through` and the streak continues.
   - Otherwise they start now and the streak restarts at 1.
3. `memberships.paid_through` is the end of the last month (`renewal_at` kept in sync for legacy readers).
4. **Expiry:** when `paid_through` passes, the status becomes `expired`. This runs in the 60-second job and before any membership read or checkout. Nothing is charged.
5. **Renewal:** allowed once the paid period has ended (`renewal_window_days` = 0, confirmed). The owner may set a positive early-renewal window (proposal, not enabled) so renewals can stay consecutive.
6. **Never extends the membership:** a failed, cancelled, pending or unverified payment. Duplicate verify/webhook calls are idempotent (`membership_payments` row lock, unique `(membership_payment_id, month_index)`).
7. **Cancellation:** forfeits unused credits (existing rule) and voids months that have not started.
8. **History:** `/membership` lists payments (plan, type `purchase`/`renewal`, amount, discount, status) and monthly periods.

## 4. Credit allocation and expiry (BD-2)

- 4 credits (`credits_per_month`) per paid month, granted when the month starts. One `credit_ledger` row per month, unique on `membership_period_id`.
- Expiry: 60 days after grant (`credit_expiry_days`, existing approved behaviour), FIFO. Expired credits are written off once and cannot be redeemed. Membership expiry and credit expiry are independent, but credits can only be **spent** while the membership is `active`.
- The customer sees available / granted / used / expired / forfeited totals, derived from the ledger.
- These are the **existing membership usage credits** (one credit = one eligible piece). They are not money, not a wallet and not convertible. No credit cap, pause-credit rule or new rollover rule exists: the interim `max_credit_balance` and `pause_credit_policy` settings were removed. Paid months are credited when they start, as before; a pause only stops credits being spent and does not extend the paid period (unchanged behaviour).

## 5. Six-month reward calculation

- **Rule (`six_month_reward_qualification = consecutive_months`, default since migration 018, MEM-10):** when the member's 6th, 12th, … consecutive **paid** month **starts**, one `reward_entitlements` row (`six_month_milestone`) is issued — on a 6-month prepaid plan or after renewals (2 + 2 + 2). It is never issued at purchase and never for gifted or admin months.
- **What keeps the count:** a renewal while the membership is running, or within `renewal_grace_days` (default 5) after the paid period ends; the new months start at payment and continue the count. **What resets it:** a pause (customer or admin; unstarted paid months are renumbered from 1), a cancellation, or a renewal after the grace period.
- Idempotent: unique on the qualifying month (`uq_reward_milestone_period`), granted inside the row-locked lifecycle transaction. Duplicate events and concurrent refreshes cannot issue twice. A refunded plan voids its unstarted months, so month 6 never starts and nothing is issued.
- **Earlier rule (selectable, not the default):** `six_month_plan` issues the piece only in month 6 of a paid 6-month prepaid plan.
- Redemption: one piece the owner has made reward-eligible (§16.4), quantity 1, through the bag or Wardrobe Bag:
  - Reserved at checkout, redeemed on payment.
  - Released if the order expires, is cancelled or is refunded unshipped.
  - Standard shipping applies (pickup free, ₹99 delivery): **no shipping benefit invented**.

## 6. Security status and owner procedures

### 6.1 Status
| Item | Status |
|---|---|
| Supabase configuration | App refuses a remote DB in development unless opted in. The local `.env` still points at the live Supabase DB, so **the dev server will now refuse to start** until you either use a local DB (recommended, `.env.development.example`) or add `ALLOW_REMOTE_DATABASE=true` knowingly. The Supabase anon key in `vishrea-react/.env` is unused and can be deleted. |
| JWT secrets | No literals in tracked files. Weak/leaked secrets refused in production. **Live secret not rotated** (§6.2). |
| OTP handling | Never echoed in production (startup refuses). Never echoed against a remote DB. Local `.env` set to `AUTH_DEV_OTP_ECHO=false`. |
| Administrator authorization | Server-side `admin` access on every admin API (tests). Role is read from the database on every request. Bootstrap only without an existing admin and only for an allowlisted email when `ADMIN_ALLOWED_EMAILS` is set. **Live roles unchanged** (§16.6). Production logs a warning while the allowlist is unset. |
| Email delivery | Key configured locally. Sender `onboarding@resend.dev` only delivers to the Resend account owner. **Verify `vishreastudio.com` in Resend** and set `EMAIL_FROM` before production. The key was shared in chat: rotate it in the Resend dashboard once live. |
| Razorpay | Test keys only. HMAC, idempotency, amount/currency checks and late-payment handling unchanged and green. Live activation: §6.5. |
| Production migrations | Rehearsed (§13). Not run on production. |

### 6.2 JWT secret rotation (controlled; signs everyone out)
1. Generate on the server: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Do the same for `OTP_PEPPER`.
2. Set both in the host's secret store; deploy in a low-traffic window.
3. All sessions become invalid (customers sign in again with a code). Outstanding OTP codes stop working; customers request a new one.
4. Confirm with `GET /api/health` and one admin sign-in.

### 6.3 Administrator review (read-only first; changes only after owner approval and a backup)
Preferred: `node scripts/list-admins.js` (read-only transaction; prints email, role, created, last admin action and allowlist status). Then set `ADMIN_ALLOWED_EMAILS` to the approved emails and restart; nothing in the database changes. The SQL below is only for a later, separately approved clean-up.
```sql
SELECT auth_user_id, email, role, is_admin, is_active, created_at FROM profiles WHERE is_admin OR role IN ('admin','owner') ORDER BY created_at;
-- After the owner names the accounts to keep (example — do not run without approval):
-- UPDATE profiles SET is_admin = false, role = 'customer', sessions_valid_after = now() WHERE email = '<account to demote>';
-- UPDATE profiles SET is_active = false, sessions_valid_after = now() WHERE email = 'owner@vishrea.test';
```

### 6.4 Email activation
Resend dashboard → add and verify `vishreastudio.com` (DNS) → set `EMAIL_FROM=Vishrea Studio <no-reply@vishreastudio.com>` → sign in once on staging.

### 6.5 Razorpay production activation (owner approval required)
Live key id/secret in the secret store. Dashboard webhook `https://vishreastudio.com/api/webhooks/razorpay` with events `payment.captured`, `order.paid`, `payment.failed`, `refund.processed` (plus `subscription.*` only if autopay is approved) and `RAZORPAY_WEBHOOK_SECRET`. Staging sandbox payment through the real modal for an order and a membership. Then a ₹1 approved production smoke test, refunded.

---

## 7. Database changes — `migrations/017_membership_lifecycle_rewards.sql`

Forward-only, idempotent (`IF NOT EXISTS`, `NOT VALID` checks, `ON CONFLICT DO NOTHING`), no deletes.

| Object | Change |
|---|---|
| `memberships` | + `started_at`, `paid_through`, `expired_at`, `cancelled_at`; backfill `paid_through = renewal_at` |
| `membership_payments` | + `months`, `list_amount`, `discount_amount` (≥0), `referral_id`, `kind` (`purchase`/`renewal`), `refunded_at`; check `months 1–24` |
| **`membership_periods`** (new) | one row per paid/gifted month: source, payment or gift ref, `month_index`, `streak_month`, `starts_at`/`ends_at`, credits, `credits_granted_at`, `voided_at`; unique `(membership_payment_id, month_index)` and `(gift_membership_id, month_index)`; FK to memberships, payments, gifts |
| `credit_ledger` | + `membership_period_id` (unique). The one-row-per-payment unique index is replaced by per-period uniqueness (legacy rows keep a partial unique index) |
| **`reward_entitlements`** (new) | kind `six_month_milestone`/`referral`, status `available`/`reserved`/`redeemed`/`void`, `sequence_no` (≥1), order link, flag and void audit fields; unique per qualifying month and per `(referral, sequence_no)` |
| `cart_items`, `order_items` | + `reward_entitlement_id` (unique when set); `orders` + `rewards_used` |
| `products` | + `credit_eligible` (backfilled false for Premium badges) |
| `colour_reviews` | + `season` |
| `customer_profiles` | + `referral_code` (unique) |
| `referrals` | + `referred_user_id` (unique), `attributed_at`, `qualified_at`, `qualifying_payment_id`, `discount_amount`, `updated_at`; status check |
| **`admin_gift_enquiries`** (new) | sender/recipient/company, type, months (1–24 in the schema; the offered durations come from Settings, default 2/6), quantity (1–100), message, status (`pending`/`processed`/`invoiced`), notes, invoice ref/amount, who/when changed, submission key (unique) |
| **`gift_memberships`** (new) | enquiry FK, months, **`token_hash` (unique)**, `token_hint`, status (`issued`/`redeemed`/`revoked`), expiry, redeemed by/at, membership link, revoked by/at |
| `app_settings` | new typed keys (inserted only if absent): `membership_plan_months` [2,6], `renewal_window_days` 0, `six_month_reward_enabled` true, `six_month_reward_qualification` "six_month_plan", `reward_eligible_category_ids` [], `reward_eligible_product_ids` [], `reward_max_price_inr` 0, `referral_discount_inr` 150, `referral_plan_months` 2, `referrer_reward_quantity` 1, `gift_enquiry_types` ["individual","corporate"], `gift_membership_months` [2,6], `gift_token_valid_days` 90, `seller_legal_name`/`seller_address`/`grievance_officer_name`/`_email`/`_phone` "", `legal_details_verified` false |

The legacy `gifts` table is untouched (0 live rows). It is no longer written by the app.

**Migration 017 was edited in place during the clarification** (settings list, `sequence_no`, gift month range). This is safe only because 017 has never been applied to production or any shared database; it was applied solely to throw-away test databases. Once it runs anywhere persistent, further changes must go in a new migration.

## 8. API changes

| Method | Path | Auth | Change |
|---|---|---|---|
| GET | `/api/membership` | user | adds `renewal`, `pricing.plans` (2 and 6 months, with referral discount if eligible), `credits` summary, `milestone`, `rewards`, `periods`, `payments` |
| POST | `/api/membership` `start_checkout` | user | `months` (2 or 6); renewal window; server discount; stores months/list/discount/referral/kind |
| POST | `/api/membership` `activate_paid` / `pause` / `resume` / `cancel` | user | amount checked before capture; cancel voids unstarted months |
| GET | `/api/content` | public | adds `membership_plans`, `referral_discount_inr`, `referral_plan_months`, `gift_options` (months + server price), `gift_enquiry_types`, and `legal` (null until the owner marks legal details verified) |
| GET | `/api/referrals?code=` | public | validate a code (rate-limited) |
| GET | `/api/referrals` | user | own code, link, summary, history (masked emails), rewards |
| POST | `/api/referrals` `{action:'attribute', code}` | user | first attribution only; self/existing-member refused |
| GET/POST/DELETE | `/api/wardrobe` | user | `save`, `add_to_bag` (`use`: none / credit / reward); returns sizes and rewards; `ship` removed |
| PATCH | `/api/cart` | user | `reward_entitlement_id`; credit toggle requires an active membership |
| POST | `/api/checkout` | user | reward reservation; `membership_not_active`; phone required |
| POST | `/api/gifting` | public | gift enquiry (validated, rate-limited, duplicate-safe) |
| POST | `/api/gifting` `{action:'redeem', token}` | user | one-time redemption |
| GET | `/api/gifting` | user | own enquiries |
| POST | `/api/colour-review` | user | accepts `season` (8 values) |
| GET | `/api/catalogue` | public | `colour_season` filter |
| GET | `/api/account` | user | adds `colour_profile`, `rewards`, `max_wearers`, `paid_through` |
| GET | `/api/admin/ops?section=` | admin | new: `customer`, `gift_enquiries`, `gift_enquiry`, `referrals`, `rewards`; `dashboard` accepts `from`/`to`; `settings` returns groups, typed metadata with value/default/confirmed/help, fixed rules, eligible-item options, upload storage health, administrators (read-only) and the last 20 changes. No secrets or environment values |
| POST | `/api/admin/ops?section=` | admin | new: `gift_enquiry`, `gift_token`, `gift_token_revoke`, `reward`; `settings` validates every value against its declared type, references and cross-field rules, rejects unknown keys, writes only changed values and audits before/after; fixed `exchange`; `membership` adds `expired` and the paid-period guard |
| — | `/api/admin/{dashboard,products,orders,customers,content}` | — | unmounted (404) |
| POST | `/api/webhooks/razorpay` | HMAC | membership refunds (void future months; revoke unused rewards, flag used ones); subscription charges record months |

## 9. Frontend changes

New pages: `Wardrobe.jsx` (`/wardrobe`), `GiftRedeem.jsx` (`/gift/redeem`), `AdminExtras.jsx`. Rewritten: `Membership.jsx`, `Account.jsx`, `Gifting.jsx`. Updated: `App.jsx`, `AccountNav.jsx`, `StoreContext.jsx` (referral capture + attribution, guest image), `ProductDetail.jsx`, `Cart.jsx`, `Checkout.jsx`, `Catalogue.jsx`, `SkinToneAnalysis.jsx`, `OrderDetail.jsx`, `Contact.jsx`, `Home.jsx`, `Admin.jsx` (new sections, drill-down, status override, exchange transitions, product season/eligibility, dashboard range), `faqs.js`, `pages.js`, `site.config.js`, `index.css`.

The clarification also changed these pages:

- **`AdminExtras.jsx` Settings:** rebuilt from the API metadata, with typed inputs, list checkboxes, searchable piece/category pickers, confirmed/proposal badges, fixed rules, storage health, administrators and change history.
- **`Membership.jsx`:** six-month progress shown for the confirmed rule.
- **`Gifting.jsx`:** durations, prices and types come from Settings.
- **`Cart.jsx` / `Wardrobe.jsx`:** the reward option appears only on owner-selected pieces.
- **`Contact.jsx`:** legal details appear only once verified.

## 10. Referral attribution and reward issuance

1. A visitor opens `/?ref=CODE`. The browser validates it with `GET /api/referrals?code=` and keeps it in `localStorage` for 30 days.
2. After sign-in, the browser calls `attribute`. The server checks:
   - the code exists and is not the customer's own;
   - the customer has no paid membership;
   - no attribution exists for the customer.

   It then records it under an advisory lock. The first attribution wins and never changes.
3. Discount: only on the `referral_plan_months` plan (**2 months**), only while the attribution is `attributed` and the customer has never paid for a membership. Amount = `referral_discount_inr` (150), so ₹3,598 → **₹3,448**. It never stacks: no other membership offer exists.
4. When the customer's first membership payment is verified — the discounted 2-month one, or an undiscounted first membership of another duration — inside the same transaction:
   - the referral becomes `qualified`;
   - `referrer_reward_quantity` (default 1) `referral` entitlements are issued to the referrer, unique per `(referral, sequence_no)`.

   Pending, failed, cancelled or unverified payments earn nothing.
5. A full refund of the qualifying payment marks the referral `refunded` and applies the reward reversal rule (§16.5): an unused reward is revoked; a reward already used is flagged for admin review in **Rewards**.

## 11. Gift enquiry workflow and redemption-token security

1. **Enquiry:** guest or customer, individual or corporate (company name, quantity). Validated client- and server-side, rate-limited, and duplicate-safe (submission key + 10-minute same-content check). Nothing is charged or activated.
2. **Admin** (`/admin/gift-enquiries`): search/filter, detail, notes, invoice reference/amount. Status `pending → processed → invoiced` (invoice reference required); who and when are recorded.
3. **Codes:** only once invoiced, at most `quantity` live codes.
   - Each code is `crypto.randomBytes(24)` (base64url, 192 bits).
   - Only its SHA-256 hash and last 4 characters are stored.
   - The full code and link (`/gift/redeem#CODE`) are shown once. The code sits in the URL **fragment**, so it is never sent to servers or logs.
   - Codes expire after `gift_token_valid_days` (90) and can be revoked.
4. **Redemption:** requires sign-in.
   - The code row is locked and checked: issued, unexpired, and the enquiry is invoiced.
   - It is marked `redeemed` atomically (one-time).
   - The gifted months are then appended through the same lifecycle (credits each month, counts toward the streak).

## 12. Tests and results

| Suite | Tests | Result |
|---|---|---|
| `platform.test.js` (existing, 2 tests updated to the new credit rule) | 48 | pass |
| `remediation.test.js` (new; 28 → 41 in the clarification) | 41 | pass |
| `migration-rehearsal.test.js` (new; asserts the new typed defaults and that no cap/pause keys exist) | 1 | pass |
| `production.test.js` (+1 test, +4 assertions) | 8 | pass |
| `pricing.test.js` (+2 tests) | 10 | pass |
| `seo.test.js` (7), `notify.test.js` (4), `razorpay-*.test.js` (4) | 15 | pass |
| **Total (`npm test`, 5 Nov 2026, isolated PostgreSQL 18)** | **123** | **123 pass, 0 fail, 0 skipped**, 21 suites |

Tests added or changed in the clarification:

- **Six-month:** progress month by month; no second reward after the plan ends; three consecutive 2-month renewals earn **nothing** under the confirmed rule; the `consecutive_months` alternative earns one and resets on a lapse.
- **Renewal:** default renewal only after the paid period ends (window 0). The window test now sets 7 days explicitly.
- **Reward eligibility:** nothing eligible by default; product list; category list; price limit; stale reward line refused at checkout after the owner removes the category; refused attempts change nothing.
- **Refund reversal:** unused referral reward revoked with audit, credits untouched, repeated refund event idempotent; used six-month reward flagged (order unchanged); reward revoked while a checkout held it → that order is refunded, not fulfilled.
- **Referrals:** configurable referrer reward quantity (2), idempotent on event re-delivery.
- **Gifts:** durations and enquiry types follow Settings.
- **Settings:** JSON types (number/boolean/array), list sorting, before/after audit; refusal of removed keys (`max_credit_balance`, `pause_credit_policy`), unknown keys, bad types, unknown ids, out-of-range values and inconsistent combinations; customers get 403; view contains no secrets or absolute paths.
- **Legal:** details hidden until verified.
- **Admins:** allowlist limits access (case-insensitive) without changing the role.

New-test coverage includes:

- **Membership:** 2-month = 8 credits once; expiry; renewal after expiry restarts the streak; renewal refused outside the window and contiguous inside it; failed/unverified payment never extends; duplicate webhook + verify = one payment; paused-member message; cancel voids future months; no admin reactivation without a paid period.
- **Six-month offer:** priced; no reward at purchase; reward exactly once at the 6th month under concurrent refreshes; consecutive renewals reach the reward; a lapse resets progress.
- **Rewards:** Premium refused; redemption once; delivery still charged; reward released when the hold is cancelled.
- **Referrals:** valid/invalid/own code; self-referral; ₹150 only on 2 months; gateway amount 344800; referrer reward once with concurrent webhooks; existing member refused; checkout alone earns nothing; refund flags the reward.
- **Gifts:** individual/corporate; invalid input; duplicate submit; non-admin 403; transitions; token gating, one-per-quantity, hash-only storage, never re-shown, sign-in required, invalid/expired/revoked/duplicate redemption.
- **Security and the remaining fixes:** bootstrap admin, settings types, exchange 404, phone required, colour season filter/storage, dashboard range, admin drill-down permissions, `/legal` 301, legacy endpoints 404.

Two existing assertions were changed because the business rule changed (BD-2):

- `platform.test.js` “a repeated subscription charge allocates credits once” now expects 4 credits immediately and 8 once the charged months start (was 8 immediately).
- The Premium test now relies on the explicit eligibility rule.

**Browser verification** (isolated instance, real Chromium):

- **Membership:** plans and offer text render.
- **Account:** profile save persisted the phone; a wearer was added and listed.
- **Wardrobe Bag:** saved from the product page, then moved to the bag (count 1).
- **Gifting:** a guest-style enquiry was validated and submitted as GE-1001.
- **Admin:** processed → invoiced → code issued; only `…SpqI` is shown afterwards.
- **Other admin sections:** Settings (29 typed fields), Rewards, Referrals, customer drill-down (6 sections) and the dashboard KPIs render.
- **Responsive:** no horizontal overflow at 360 and 1440 px on any new or changed storefront page. Checkout and gifting controls are 16 px and 46–49 px tall.
- **Clarification (fresh local DB `vishrea_settings_ui`, migrations 001–017 + demo seed):**
  - Settings renders 8 editable groups plus Hosting & uploads, Administrators and Change history.
  - 22 “Confirmed” and 23 “Owner to confirm” badges; 10 fixed rules; 2 searchable pickers (11 categories, 9 pieces).
  - Storage panel: app-folder warning, 13 files.
  - Ticking one eligible piece and saving stored it; the history entry shows the editor’s email and the changed key.
  - The contact page shows no legal or grievance details while they are unverified.

**Not verified:**
- real Razorpay modal completion (cross-origin iframe; needs a person on staging);
- real email delivery (no external calls made);
- camera analysis on a device;
- admin pages at 360 px beyond the overflow check.

## 13. Deployment instructions (production — owner-approved window only)

1. Take a Supabase backup (PITR or `pg_dump`) and confirm it restores.
2. Rehearse: `npm test` (includes `migration-rehearsal.test.js`, which reproduces the live state 001–014 + manual 016 + `max_video_seconds = 30`).
3. Set production secrets per `.env.production.example`.
4. Read-only pre-check: `SELECT filename FROM _schema_migrations ORDER BY 1;` (expect 001–014).
5. Run `NODE_ENV=production DATABASE_URL=<prod> npm run migrate`. This applies 015 (video cap 10 s), 016 (no-op DDL + recording) and 017 (new tables and columns; brief locks for `ALTER TABLE ADD COLUMN` on small tables). Each file runs in its own transaction.
6. `npm run build`, deploy, and confirm `GET /api/health` = 200.
7. Smoke test on production: sign-in email, catalogue, the membership page shows both plans, the admin Settings page loads, and `GET /legal` returns 301.

## 14. Rollback and recovery

- **Application:** redeploy the previous build. Migration 017 only adds columns and tables, so the previous code runs against the migrated schema. Credits for months 2+ of new memberships would then not be granted until the new code returns, and those periods remain recorded.
- **Database:** forward-only. To undo 017 before any new data exists, restore the backup. If data exists, the new tables can be left in place harmlessly. Do not drop `membership_periods` while memberships rely on it.
- **Index change:** 017 replaced `uq_credit_ledger_membership_payment`. If the old code must run for long, recreate it only if no payment has two period rows:
  ```sql
  CREATE UNIQUE INDEX uq_credit_ledger_membership_payment ON credit_ledger (membership_payment_id) WHERE membership_payment_id IS NOT NULL;
  ```
- **Config guard:** set `ALLOW_REMOTE_DATABASE=true` only for an intentional remote dev/staging database.

## 15. Remaining blockers

- Live JWT/OTP secret rotation (§6.2), live admin review (§6.3), local `.env` still on the live DB (dev now refuses it).
- Resend domain verification. Razorpay live keys, webhook and a sandbox modal payment.
- Production migration 015–017 in an approved window with a backup.
- Seller legal name, address, GSTIN; grievance officer (BD-8, §16.8); persistent upload storage on the chosen host (BD-7, §16.7).
- Owner selection of reward-eligible pieces/categories (until then no reward can be redeemed) and the approved admin list (§16.6).

## 16. Final business rules (clarification of 5 November 2026)

Every editable value lives in **Admin → Settings**. It is defined once in `lib/settings.js` (`SETTING_META`: type, group, default, confirmed flag, label), validated by `lib/settings-admin.js`, stored in `app_settings`, and every change is audited with before/after values (`audit_logs`, action `update_settings`). Each field carries a badge:

- **Confirmed:** the business rule given in the clarification.
- **Owner to confirm:** an existing working default that no one has approved yet.

Secrets and environment values are never returned by the Settings API.

### 16.1 Credits — does a credit system exist? Why no wallet?

- **Yes, it already existed before this work:**
  - membership usage credits (`credit_ledger`, `memberships.credits_balance`, the cart “use credit” toggle, the Premium exclusion and the original tests);
  - the proposal (p. 3/7) lists 4 credits per month, balance, expiry, redemption and the Premium restriction.
- **What a credit is:** one credit lets a member take one eligible piece. Credits are **not money**: they cannot be bought, topped up, transferred or refunded, and nothing is converted into or out of them.
- **What is unchanged:**
  - 4 credits per paid month (confirmed);
  - credits are granted when each month starts;
  - 60-day expiry, FIFO (existing behaviour, owner to confirm);
  - credits can be spent only while the membership is active.
- **What was removed:** the interim `max_credit_balance` and `pause_credit_policy` settings and their logic. No approved rule requires a cap, a pause-credit rule or new rollover rules.
- **No wallet.** No stored-value balance, monetary credit or wallet table was created. A wallet would hold customer money, which needs its own approval and accounting/RBI treatment, and nothing in the confirmed rules needs one.
- **Rewards are not credits.** Free-piece rewards are separate `reward_entitlements`, each for one piece, and never increase a credit balance.

### 16.2 Membership and renewal (BD-1)

- Prepaid only, never charged automatically.
- A membership is extended only by a payment verified on the server (signature + gateway check, or a signed webhook). Failed, pending, cancelled or unverified payments never extend it.
- Durations on sale: `membership_plan_months` [2, 6] (confirmed), at ₹1,799 per month (confirmed). The default selection is `membership_upfront_months` = 2.
- Renewal opens once the paid period has ended (`renewal_window_days` = 0, confirmed). An early-renewal window can be set (proposal; off).

### 16.3 Six-month reward (BD-3)

- **Corrected (migration 018):** `six_month_reward_qualification` = `consecutive_months` (Settings → Membership). One free piece is issued when the member's **6th consecutive paid month starts**, prepaid or renewed, and every 6 consecutive paid months after that. Never at purchase, and never for gifted or admin months. A pause, a cancellation or a renewal more than `renewal_grace_days` after the paid period ends restarts the count.
- **Issued once:** a unique index on the qualifying month plus the row-locked lifecycle transaction. Tests cover concurrent refreshes, the plan ending, and repeated events.
- **Earlier rule, selectable:** `six_month_plan`, which rewards only month 6 of a paid 6-month prepaid plan.

### 16.4 Free-piece eligibility (BD-4)

- **Where it is set:** Settings → Free-piece rewards:
  - `reward_eligible_product_ids` (pieces) and `reward_eligible_category_ids` (categories), both default **empty, so nothing is eligible** (confirmed);
  - optional `reward_max_price_inr` (0 = no limit; proposal).
- **Checked on the server** at every step (`lib/rewards.js`): attaching the reward in the bag or Wardrobe Bag, and again at checkout. A stale line is refused if the owner changes the selection.
- **One-time redemption:** stock and one-time use are enforced by the existing reservation and status checks. The reward covers one unit of one piece; standard shipping applies. It is not money and cannot be exchanged for credits or a discount.

### 16.5 Refund reversal (BD-5)

When the membership payment that earned a reward is fully refunded (signed `refund.processed` webhook):

| Reward state | Result | Audit |
|---|---|---|
| Available, or held by an unpaid checkout | **Revoked** (`status = void`, `void_reason = source_payment_refunded`, `voided_by = razorpay_webhook`). If a checkout held it, that order cannot be paid as free: the payment goes to refund review. | `reward_revoked` per reward |
| Already redeemed on a paid order | **Flagged for admin review** (`flag_reason = source_payment_refunded`). The order is not changed. | `reward_flagged` per reward |

- **Same rule for both kinds:** the referral reward (via the referral’s qualifying payment) and the six-month reward (via its source payment).
- **What never changes:** no money is deducted, no credit balance is touched, and nothing goes negative.
- **Repeat-safe:** repeated refund events change nothing further.
- **Partial refunds:** only audited.

### 16.6 Administrators (BD-6)

`node scripts/list-admins.js` (a read-only transaction) found these active admin accounts on the live database on 5 Nov 2026. **None was changed, demoted or deactivated.**

| Account | Created | Last admin login | Status |
|---|---|---|---|
| admin@vishrea.com | 2026-10-18 | 2026-11-05 | awaiting owner decision |
| owner@vishrea.test | 2026-10-21 | never | awaiting owner decision (test-style address) |
| intellibytevaishal@gmail.com | 2026-10-24 | 2026-11-02 | awaiting owner decision |
| kavya01@gmail.com | 2026-10-24 | never | awaiting owner decision |

- **Restricting access without changing accounts:** set `ADMIN_ALLOWED_EMAILS` to the emails the owner approves, then restart.
  - An account then needs both an admin role and an approved email.
  - Roles in the database stay as they are.
  - A new admin cannot be bootstrapped unless the email is on the list.
  - Production logs a warning while the list is unset.
- **Where to see it:** Settings → Administrators shows every admin-role account, whether it is on the list, and whether it currently has access (read-only).
- **Authorization** is server-side on every admin API.

### 16.7 Hosting and uploads (BD-7)

- **Strategy:** keep the current long-running Node host, and set `UPLOADS_DIR` to a persistent disk on that host (`.env.production.example`).
- **No migration:** no hosting migration was made, and none will be without approval.
- **Storage health:** Settings → Hosting & uploads shows it read-only:
  - whether a dedicated directory is configured, exists and is writable;
  - file count and size, size limits and accepted types;
  - orphan clean-up status;
  - a warning while files live inside the app folder.
- **Limits:** customer images 5 MB, admin images 10 MB, videos 40 MB. Images are jpg/png/webp and videos mp4/mov, checked by file signature; SVG/HTML are never accepted.
- **Not exposed:** no absolute path.

### 16.8 Legal information (BD-8) — missing, supplied by owner

- **Not provided yet:**
  - legal business name;
  - registered/business address;
  - GSTIN (if registered);
  - grievance officer name, email and phone.
- **Where they go:** Settings → Legal information. The state of supply is Karnataka (confirmed).
- **Nothing invented:** no value was made up, and nothing is published until the owner ticks **“Owner has verified these details”**. The server refuses that tick until name, address and officer name/email are filled in.
- **Already removed:** the placeholder `SITE.grievanceOfficer` entry.

### 16.9 Preserved rules (unchanged)

- **Referrals:**
  - ₹150 off (`referral_discount_inr`) a new customer’s first `referral_plan_months` = 2-month membership (₹3,448);
  - first-time customers only; no stacking; self, second-referrer and repeat discounts refused;
  - the referrer’s reward (`referrer_reward_quantity` = 1) is issued only after verified payment.
- **Gift enquiries:**
  - types `gift_enquiry_types` (individual, corporate) and durations `gift_membership_months` (2, 6) are now configurable;
  - status flow pending → processed → invoiced;
  - one-time hashed redemption codes valid for `gift_token_valid_days` (90; owner to confirm).

### 16.10 Decisions still open for the owner

| Decision | Current behaviour | Where |
|---|---|---|
| Choose reward-eligible pieces/categories (and optional price limit) | None eligible, so rewards cannot be redeemed yet | Settings → Free-piece rewards |
| Approve admin accounts | 4 admins, unchanged; no allowlist set | `ADMIN_ALLOWED_EMAILS` (§16.6) |
| Supply legal details | Not published | Settings → Legal information |
| Confirm “Owner to confirm” defaults | e.g. 60-day credit expiry, 90-day gift code validity, GST rates, checkout hold, pause frequency | Settings (badged) |
| Persistent upload disk | App folder | Hosting configuration (`UPLOADS_DIR`) |
| Offer codes / autopay / online gift payment | Not implemented | Separate approval |
| Legacy files | Unmounted | Approve deletion of the 5 legacy admin files and the unused `gifts` table |

## 16A. End-to-end QA round (5 November 2026)

Full record: `VISHREA_IMPLEMENTATION_AUDIT.md` and `VISHREA_UI_UX_FUNCTIONAL_AUDIT.md`.

The application was walked end to end in a real browser on an isolated instance:

- 18 customer URLs at 6 widths, 5 protected URLs, and 22 admin URLs at 2 widths;
- 30 direct URL loads;
- 12 customer journeys and 9 admin journeys;
- security checks from outside the browser.

The findings: no P0 or P1 defect; 10 P2 and 8 P3 defects fixed; 2 P3 items left open (functional audit §9).

| Area | Change |
|---|---|
| Admin search and filters | `api/admin/ops.js`: products (name or SKU, state incl. out of stock / low stock, category, include archived), orders (ID prefix, customer, email, invoice, tracking; status; payment status), customers (name, email, phone digits; membership). All values validated, parameterised SQL. `Admin.jsx`: shared filter bar, "no matches" empty states, filter kept after edits |
| Validation messages | `lib/validate.js` `label()` — API messages use plain field names; whole-number ranges read naturally |
| Field-level errors | `vishrea-react/src/lib/fieldErrors.js`; used by Account (profile, wearers), Gifting and Login: the field is marked invalid, linked to the message and focused |
| Reward eligibility | Product editor checkbox (`reward_eligible`) updates the Settings list through the same validation and audit; deleting a product or category removes it from the lists (`lib/settings-admin.js`) |
| Membership | `start_checkout` refuses before writing anything when payments are unavailable |
| Accessibility | Admin dialogs: role, title, Escape, focus, named close buttons. 22 labels linked; keyboard count cards; keyboard-reachable image upload; admin focus ring; touch-screen link targets; labelled gift code fields with copy buttons |
| Copy | Home, Membership and FAQ copy now match the confirmed six-month rule |
| Small fixes | Product page saved state and single success message; "Page not found" titles for unknown category and policy |

**Tests:** `npm test` passes **126/126** (21 suites, 0 skipped). Three tests are new: admin filters, the product reward toggle with clean-up on delete, and plain-language messages. Lint: 0 errors, 27 warnings. Production build succeeds.

**Still not verified (blocked here):**

- the real Razorpay payment window;
- email delivery;
- camera colour analysis.

## 17. Out of scope (unchanged, by instruction)

WhatsApp API, Google/Meta, Instagram API, advanced AI, virtual try-on, native apps, drop early-access gating, saved-address picker (OBS-03), unused tables (OBS-01). No framework, ORM, database, payment-gateway or authentication change.

## 18. Deployment readiness

**READY FOR OWNER REVIEW.** The code-level remediation and the business-rule clarification are implemented and verified on isolated infrastructure:

- 126/126 tests;
- end-to-end QA in a real browser (§16A);
- lint with 0 errors;
- production build;
- browser checks of the Settings screen and contact page.

It is **not** ready for production approval until all of the following are done:

- the §15 blockers and the §16.10 decisions are resolved;
- migration 017 is run in an approved window with a backup;
- a staging run with real Razorpay sandbox payments and real email delivery has passed.

Nothing has been pushed. Before any push, the change still needs an independent code review and the owner’s approval.
