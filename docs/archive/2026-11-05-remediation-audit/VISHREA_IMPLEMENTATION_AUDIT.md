# Vishrea Studio — Implementation Audit (current code)

| Item | Value |
|---|---|
| Date | 5 November 2026 |
| Scope | The code as it stands after the V1 remediation and the business-rule clarification, verified against the running application |
| Method | Code inspection; an isolated app instance on a throw-away PostgreSQL 18 database (demo seed); a real Chromium browser; `npm test` |
| Production | Not touched. No production data, migration, role, secret or payment was used or changed. |
| Companion documents | `VISHREA_UI_UX_FUNCTIONAL_AUDIT.md` (journeys, buttons, fields, responsive, accessibility) · `VISHREA_AUDIT_REMEDIATION_REPORT.md` (changes and status) |

Earlier audit findings (`VISHREA_UNIVERSAL_APPLICATION_AUDIT.md`, `VISHREA_DEVELOPER_ACTION_REGISTER.md`) were re-checked against the current code rather than assumed open. Their status is in the remediation report §2.

## 1. Architecture (unchanged)

| Layer | Implementation |
|---|---|
| Frontend | React 19 + Vite + React Router (`vishrea-react/src`, 46 source files) |
| Backend | Express modular monolith (`server.js`, `api/`, `lib/`: 53 files) |
| Database | PostgreSQL via native `pg` (`lib/db.js`: pooled client, `db.tx()` transactions, advisory and row locks) |
| Auth | Email one-time code → JWT in an HTTP-only `SameSite=Lax` cookie (`Secure` in production). Role and active state are read from the database on every request. |
| Payments | Razorpay only. Server-computed amounts, HMAC signature checks, a signed and idempotent webhook, and a reconciliation job. |
| Hosting | Long-running Node process. Uploads go to `UPLOADS_DIR` (persistent disk required in production). Database: Supabase PostgreSQL. |
| Colour analysis | On-device in the browser. Raw photos are never uploaded; only the resulting season is stored. |

API modules are mounted from `API_MODULES` in `server.js`. Each module declares:

- `access`: `public`, `user` or `admin`, enforced on the server before the handler runs;
- the HTTP methods it accepts;
- an optional per-user rate limit.

All state-changing requests also pass `originGuard`, which acts as CSRF protection.

## 2. Frontend routes (from `App.jsx`)

| Route | Access | Notes |
|---|---|---|
| `/` | public | Home |
| `/catalogue`, `/catalogue/:category` | public | Search, in-stock filter, sort, category; colour-season filter |
| `/product/:slug` | public | Sizes, stock, add to bag, buy now, Wardrobe Bag, request a piece |
| `/cart` | public (guest bag) | Server bag for signed-in customers |
| `/checkout` | user | Delivery/pickup, address, GST invoice, gift packing |
| `/membership` | public (purchase needs sign-in) | 2- and 6-month prepaid plans, progress, rewards, history |
| `/orders`, `/orders/:id` | user | Tracker, invoice, exchange/damage request |
| `/skin-tone` | public | On-device colour analysis |
| `/login` | public | Email code sign-in; first sign-in creates the account (no separate registration) |
| `/account` | user | Profile, wearers, colour profile, referrals, gift enquiries, piece requests |
| `/wardrobe` | user | Wardrobe Bag |
| `/gifting`, `/gift/redeem` | public / redeem needs sign-in | Gift enquiry; one-time code redemption |
| `/contact`, `/legal`, `/legal/:slug` | public | Legal details shown only once verified in Settings |
| `/admin/:section?` | admin | 21 sections (below) |
| `*` | public | 404 page |

**Admin sections:** Overview, Products, Categories, AI Listing Studio, Orders, Piece Requests, Customers, Membership, Credits, Rewards, Referrals, Gift Enquiries, Exchanges, Offers & Loyalty, Drops, Sourcing, Store Mode, Content & Legal, Invoices, Settings and Audit Log.

## 3. API inventory

| Path | Access | Methods |
|---|---|---|
| `/api/auth/*` (`start-login`, `verify-code`, `session`, `signout`) | public | GET/POST |
| `/api/catalogue`, `/api/product`, `/api/content`, `/api/legal`, `/api/payment-config` | public | GET |
| `/api/gifting` | public (redeem and history need sign-in) | GET/POST |
| `/api/referrals` | public (own data needs sign-in) | GET/POST |
| `/api/piece-requests` | public (read needs sign-in; updates are admin-only) | GET/POST/PATCH |
| `/api/account`, `/api/cart`, `/api/wardrobe`, `/api/colour-review`, `/api/exchange`, `/api/orders` | user | various |
| `/api/membership` | user | GET/POST (`start_checkout`, `activate_paid`, `pause`, `resume`, `cancel`) |
| `/api/checkout`, `/api/payment-verify` | user | POST |
| `/api/upload` | user (staff for video) | POST (type checked by file signature) |
| `/api/webhooks/razorpay` | HMAC signature | POST |
| `/api/admin/ops` | admin | GET and POST/PUT/DELETE sections (below) |
| `/api/admin/listing-studio` | admin | POST (needs an AI key; optional) |
| `/api/health`, `/robots.txt`, `/sitemap.xml` | public | GET |

**`/api/admin/ops` read sections:** dashboard, settings, products, product, categories, orders, customers, memberships, credits, exchanges, loyalty, drops, sourcing, content, audit, piece_requests, customer, gift_enquiries, gift_enquiry, referrals, rewards, invoices, store, export, listing.

**`/api/admin/ops` write sections:** settings, category, product, product_status, order, membership, credit, exchange, gift_enquiry, gift_token, gift_token_revoke, reward, loyalty, drop, source, content, store_sale, piece_request.

## 4. Database

There are 50 tables after migrations 001–017. The main groups:

- **Identity:** `profiles`, `customer_profiles`, `wearer_profiles`, `auth_otps`.
- **Catalogue:** `categories`, `products`, `product_variants`, `inventory`, `inventory_reservations`, `product_photos`.
- **Commerce:** `carts`, `cart_items`, `orders`, `order_items`, `invoice_records`, `payment_events`, `payment_locks`, `exchanges`, `store_sales`.
- **Membership:** `memberships`, `membership_payments`, `membership_periods`, `credit_ledger`.
- **Rewards and referrals:** `reward_entitlements`, `referrals`.
- **Gifts:** `admin_gift_enquiries`, `gift_memberships` (legacy `gifts` unused).
- **Wardrobe and colour:** `wardrobe_items`, `colour_reviews`, `saved_looks`, `saved_look_items`.
- **Operations:** `piece_requests`, `app_settings`, `audit_logs`, `legal_pages`, `store_settings`, `loyalty_rules`, `offers`, `drop_settings`, `sourcing_batches`, `product_sources`, `instagram_content`, `feedback_videos`, `notification_preferences`, `story_consents`, `pricing_rules`, `loyalty_events`, `addresses`.

Migrations are forward-only and tracked in `_schema_migrations`. The live database records 001–014 (016's changes were applied by hand). Migrations 015–017 still need an approved production window.

## 5. Features present (verified working in this audit)

1. **Sign-in:** email code sign-in with throttling, wrong- and expired-code handling, session expiry, and server-side admin checks.
2. **Shopping:** catalogue, search, filters, product page, bag, checkout, order tracking, tax invoice, exchange requests and stock reservation.
3. **Membership:** prepaid 2- and 6-month plans, 4 credits per paid month, expiry and renewal, a six-month reward (month 6 of the 6-month plan), and progress display.
4. **Referrals:** ₹150 off a first 2-month membership, attribution, and the referrer's free piece after a verified payment.
5. **Free-piece rewards:** eligibility chosen by the owner, server-checked redemption, and the refund reversal rule.
6. **Gifts:** enquiry → processed → invoiced → one-time hashed code → redemption.
7. **Wardrobe Bag:** save a piece, then move it to the bag with a credit or a free-piece reward.
8. **Admin:** dashboard, products (with images and reward eligibility), inventory, orders and fulfilment, customers and drill-down, memberships, credits, rewards, referrals, gift enquiries, exchanges, content and legal, invoices, typed Settings with audit history, and the audit log.

## 6. Defects found in this audit and priorities

Defects were prioritized P0 → P3; the full list with root causes and fixes is in `VISHREA_UI_UX_FUNCTIONAL_AUDIT.md` §9. Summary:

| Severity | Found | Fixed | Open |
|---|---|---|---|
| P0 (payments, auth, data exposure, duplicates) | 0 | — | 0 |
| P1 (broken journeys or workflows) | 0 | — | 0 |
| P2 (validation, search/filter, accessibility, saved state) | 10 | 10 | 0 |
| P3 (polish) | 10 | 8 | 2 |

No P0 or P1 defect was found. The P0 areas re-checked were:

- the session cookie;
- admin authorization at both the API and the page;
- customer ownership checks;
- protection against foreign-origin requests;
- file-type checks on uploads;
- the sign-in code throttle;
- payment amount and signature checks (automated tests);
- duplicate-submit protection on orders, gift enquiries, gift redemption, exchanges and rewards.
