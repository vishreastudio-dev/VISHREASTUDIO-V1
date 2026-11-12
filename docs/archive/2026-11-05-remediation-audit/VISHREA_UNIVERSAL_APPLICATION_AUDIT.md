# Vishrea Studio — Universal Application Journey, Route, API & Requirements Compliance Audit (V1 / Release 1.0)

| Item | Value |
|---|---|
| Audit date | 5 November 2026 |
| Repository | `d:\VDEV\VS Karnataka` (branch state: 118 uncommitted changes on top of `64f96a1`) |
| Phase | **Phase 1 — audit only.** No application source, database record, environment variable or business rule was changed. |
| Companion files | `VISHREA_ROUTE_API_TRACEABILITY.csv`, `VISHREA_UNIVERSAL_JOURNEY_TEST_CASES.md`, `VISHREA_DEVELOPER_ACTION_REGISTER.md` |
| Final verdict | **NOT APPROVED FOR V1 RELEASE** (justification in §20) |

---

## 1. Executive summary

The commerce core is well engineered and verified. Server-authoritative pricing and GST, atomic one-of-one inventory, idempotent checkout, Razorpay signature and gateway cross-checks, webhook de-duplication, late-payment handling and automatic refunds are all implemented. Each passed both the project's 78-test suite (0 failures, integration suites actually executed against an isolated database) and the audit's own probes. Catalogue, product detail, bag, checkout, order tracking, GST invoice generation, exchanges, Store Mode, Instagram links and customer videos work end to end.

The V1 **membership business model** does not. A customer pays ₹3,598 for two months and receives **4 credits in total** (not 4 per month). When the prepaid period ends, nothing happens: the membership stays `active` indefinitely, no renewal is charged, and no further credits are issued. Recurring payment was never set up, and there is no maximum credit balance. The **Wardrobe Bag**, **offers/referrals customer application**, **admin skin-tone review** and **admin customer drill-down (wearer profiles, order history)** have backend pieces but no working user journey.

Five configuration and security items are release blockers on their own:

- The local `.env` runs development mode with sign-in codes echoed in the API response, against the **live Supabase database**, with a public tunnel origin configured.
- A JWT signing secret is hard-coded in the tracked `start.ps1`, and the active secret has the same length and prefix.
- **All 4 live accounts are administrators**, including a test-domain account.
- The bootstrap admin email is re-promoted on every login.
- No email provider is configured, so production sign-in is impossible.

**Requirement scorecard (61 scored V1 requirements, §15):** 34 PASS · 13 PARTIAL · 3 FAIL · 5 NOT IMPLEMENTED · 6 BLOCKED.

---

## 2. Method, environment and evidence

| Evidence type | What was done | Where |
|---|---|---|
| Requirements | Extracted all 14 pages of `docs/specifications/VDEV_Vishrea_Studio_V1_Proposal_Revised (2).pdf` (PyMuPDF) | §3 |
| Static trace | Read every file in `server.js`, `api/**`, `lib/**`, `scripts/**`, `migrations/**` and every page/component in `vishrea-react/src` | §5–§9 |
| Automated suite | `npm test` → **78 tests, 13 suites, 78 pass, 0 fail, 0 skipped**, 14.3 s. First run skipped integration suites (no reachable DB), so a throw-away PostgreSQL 18 cluster was created with the installed binaries (`initdb` in `%TEMP%`, port 55432, trust auth) and the suite was rerun | §16 |
| Lint / build | `npm run lint` → 0 errors, 21 warnings (React hook style). `vite build` into a temp folder → success in 208 ms. Content-hashed bundle names are **identical** to the deployed `vishrea-react/dist`, so the built site is the current source | §16 |
| Audit probes | 20 targeted probes (P01–P20) through the project harness (isolated DB + local Razorpay stand-in) | §16 |
| HTTP | Status/redirect sweep of 32 URLs against an isolated app instance on `:3100` (own seeded DB `vishrea_audit`) | §10 |
| Browser | Cursor browser against `:3100`: visitor + customer journeys, Razorpay **test-mode** modal launch, responsive measurement at 360 / 390 / 768 / 1366 / 1440 | §14 |
| Live DB | Read-only (`BEGIN READ ONLY … ROLLBACK`) queries against the `.env` `DATABASE_URL` (Supabase, PostgreSQL 17.11) | §8, §18 |
| Bundle scan | Searched fresh and deployed bundles for `supabase`, JWT/`eyJ`, `rzp_test_/rzp_live_`, `sk-…`, `SERVICE_ROLE` → **no matches** | §13 |

No real payment, real email, production write, migration or environment change was made. Opening the checkout modal created one **Razorpay test-mode order (₹5,299)** in the configured test account. No payment was attempted, and the order expires on its own.

---

## 3. Approved V1 scope and requirement catalogue

### 3.1 Sources and conflicts

| # | Conflict | Sources | Audit treatment |
|---|---|---|---|
| C-01 | Proposal p.3/p.8 specify **Supabase Auth and Supabase Storage**. The implementation uses its own JWT HTTP-only cookie auth, native `pg`, and local-disk uploads (`public/uploads`). | Proposal vs code; audit brief requires preserving JWT/`pg` | Not scored as a failure (architecture preserved per brief). Local-disk uploads are a production risk (DEF-22). |
| C-02 | Proposal p.3: “₹1,799/month plan, initial payment flow, **recurring payment setup where supported**”. Code and `.env.example`: one upfront order (monthly × 2), autopay “added later”. | Proposal vs `lib/config.js` comment | Scored NOT IMPLEMENTED (DEF-03). Owner decision BD-1. |
| C-03 | Proposal p.3: credit rules “frozen before implementation”. **No frozen-rules document** exists (rollover length, max balance, pause effect). | Proposal vs repository | Values in code (60-day expiry, 2 upfront months, pause once/6 months) are reported but cannot be confirmed (BLOCKED values, BD-2). |
| C-04 | Proposal p.5 names Vercel hosting. The app is a long-running Express process with a 60 s background job and local uploads. | Proposal vs `server.js` | Deployment target must be decided (BD-6, DEF-22). |
| C-05 | `../SYSTEM_FLOW_AND_CHECKLIST.md` and `docs/archive/2026-11-05-remediation-audit/verification-checklist.md` claim MediaPipe FaceMesh, a catalogue Colour Harmony filter, subscription webhooks activating membership, ≤30 s **and** ≤10 s videos, exchange photo upload. None of these match the code. | Project docs vs code | Docs treated as unreliable (DOC-01). |
| C-06 | Previous audit (`docs/VISHREA_COMPLETE_APPLICATION_JOURNEY_AUDIT.md`) marks AI Listing Studio PASS (§19) **and** PARTIAL (§5/§8). It marks Gifting and Membership PASS while the flows dead-end or under-issue credits, and gives “92%” with no defined denominator. | Previous audit | Re-validated in §19. |

### 3.2 Scored V1 requirements (proposal pages 3, 4, 5, 7, 9)

| Area | IDs | Requirement (proposal wording) |
|---|---|---|
| Customer website | V1-CW-01…13 | 01 responsive storefront/home · 02 catalogue · 03 product detail · 04 login · 05 profile management · 06 cart · 07 checkout · 08 orders · 09 tracking · 10 GST invoice · 11 exchange request · 12 studio pickup + ₹99 shipping · 13 mobile-first journeys |
| Product & inventory | V1-PI-01…06 | create/edit/remove · categories · pricing · images · availability/status · one-of-one inventory |
| Membership | V1-MB-01…05 | ₹1,799/month plan · initial payment · recurring setup where supported · membership status · pause/resume/cancel |
| Credits | V1-CR-01…06 | 4 credits/month · balance · rollover/expiry · redemption · maximum balance · Premium restriction |
| Wardrobe Bag | V1-WB-01 | save eligible items for later credit redemption |
| Wearer profiles | V1-WP-01 | basic profile management |
| Orders & exchanges | V1-OX-01…03 | order management · payment status · exchange/damage admin handling |
| Gifting | V1-GF-01 | basic gifting within checkout/account flow |
| Skin-tone | V1-ST-01…05 | photo/camera analysis · category/undertone result · saved profile attribute · raw image deletable/not retained · attribute used for recommendations |
| Admin | V1-AD-01…11 | products · inventory · orders · customers (accounts, wearer profiles, membership, credits, order history) · offers & referrals (rules **and customer-facing application**) · Store Mode · dashboard · CSV export · AI skin-tone review · Instagram links · ≤3 customer videos ~10 s |
| Integrations | V1-IN-01…02 | Razorpay checkout/verification · Razorpay membership payment workflow |
| Security & readiness | V1-SQ-01,02,03,04,05,07,08 | HTTPS · secrets outside source · authenticated access & role separation · payment credentials stay with Razorpay · DB access controls & backups · testing · production deployment/smoke test |

**Approved optional / limited (listed, not scored):** OPT-AI-01 AI Listing Studio (“limited content assistance”).
**Out of V1 scope (NOT APPLICABLE):** WhatsApp API, Google Merchant/Meta catalogue, Instagram API/shop sync, advanced AI, native apps, virtual try-on, advanced analytics, international shipping, Release 1.1 (Style My 4, drop alerts, …) and 2.0 items.
**Unapproved additions (present, not scored):** piece requests (ADD-PR-01), drops (ADD-DR-01 — data only), sourcing log, audit log viewer, saved looks tables, SEO kit, saved addresses (OBS-03 — not named in the proposal).

---

## 4. Repository and architecture map

| Layer | Implementation | Notes |
|---|---|---|
| Frontend | `vishrea-react/` — React 19.2, React Router 7.18, Vite 8.3, `lucide-react`; single API client `src/lib/api.js`; global state `src/context/StoreContext.jsx` | 17 pages, 8 components, lazy-loaded account/admin chunks |
| Backend | `server.js` Express 4 modular monolith; `API_MODULES` loader (`access`, `methods`, `rateLimitPerUser`); routers `api/auth.js`, `api/upload.js`, `api/webhooks/razorpay.js` | Middleware order: requestId → httpsRedirect → securityHeaders → CORS(`/api`) → cookies → global rate limit → **webhook (raw body)** → originGuard (CSRF) → user resolution → upload → JSON 200 kb |
| Domain libs | `lib/pricing.js` (sole money calculator), `inventory.js`, `payments.js`, `credits.js`, `razorpay.js` (REST, HMAC), `catalogue.js`, `products-admin.js`, `settings.js`, `validate.js`, `uploads.js`, `notify.js` (Resend), `seo.js`, `rate-limit.js` (in-memory), `audit.js`, `ai.js` | |
| Database | PostgreSQL via `pg` Pool (`lib/db.js`, `db.tx` transactions, advisory locks, `FOR UPDATE`) | 46 tables, 0 views, 1 trigger (`trg_piece_request_number`), RLS enabled on all tables (app connects as owner) |
| Migrations | `migrations/001…016.sql` + `scripts/migrate.js` (`_schema_migrations`) | Live DB records 001–014 only (§8). Separate `supabase_complete_schema.sql` (27 tables) is not used by the runner |
| Background jobs | `startBackgroundJobs()` every 60 s: `sweepExpiredOrders`, `reconcilePayments` (re-check unconfirmed, retry refunds, retry duplicate refunds) | **No membership renewal/expiry job** |
| External | Razorpay REST (orders, payments, capture, refund, subscription cancel), Resend email, OpenAI-compatible chat API | |
| SSR/SEO | `lib/seo.js pageMeta` injects head/JSON-LD/noscript, real 404 status, 301 for legacy URLs; `/robots.txt`, `/sitemap.xml` | |

---

## 5. Customer universal journey

| Stage | Result | Key evidence | Defects |
|---|---|---|---|
| A. Entry & discovery (home, header, footer, categories, banners) | PASS | HTTP 200; 19 header/footer links clicked in browser all rendered; request-piece modal opens, Escape closes, focus returns | Header “Search” only opens `/catalogue`; label mismatches (“Trousers” vs “Pants”, “Co-ord sets” vs “Coord Sets”); Unsplash placeholder imagery (DEF-39) |
| B. Catalogue & PDP | PASS | Search (form submit → 4 results for “dress”), sort `price_asc` reorders ₹3,490→₹5,200, in-stock filter, category links, Back/Forward restore URL+state; PDP size change updates price (₹5,200→₹5,400) and SKU (`PSCD-S`→`PSCD-M`); invalid slug/category → 404 | No colour-harmony filter (DEF-12); search box keeps stale text after category change (Low) |
| C. Authentication & account | Login PASS (dev) / BLOCKED (prod email). Account PARTIAL | OTP single-use, 5 attempts, throttled, cookie `HttpOnly; SameSite=Lax; Max-Age=1209600`, cookie not readable by JS, no token in `localStorage`; customer → `/admin/products` redirected to `/account` | Account page has **no** profile edit, wearer profiles, addresses, referral, Wardrobe Bag, gift list, saved colour profile, notification prefs or data deletion (DEF-07, DEF-08, DEF-05, DEF-06, DEF-12) |
| D. Cart & checkout | PASS (logic) / PARTIAL (usability) | Guest add → bag count 1; remove; guest bag merged on login; server prices only; GST slabs; pickup ₹0; idempotent; Razorpay **test-mode modal opened at ₹5,299** (₹5,200 + ₹99) | Checkout and gifting inputs render at **9 px** with a 13 px-tall `select` (DEF-40); no saved-address picker (OBS-03); phone optional server-side for delivery (DEF-26); guest-bag thumbnail shows placeholder image (DEF-41) |
| E. Razorpay & reconciliation | PASS (mock gateway) / BLOCKED (real sandbox completion — cross-origin iframe) | 20+ automated payment tests (§16) | DEF-20 (live keys/webhook), DEF-35 (Low) |
| F. Orders & fulfilment | PASS | Owner-scoped list/detail; 400 for malformed id, 404 for unknown/foreign; live tracker polling | Invoice lacks seller GSTIN/legal details (DEF-21); damage claim has no photo upload (DEF-24) |
| G. Membership & credits | **FAIL** | P03: ₹3,598 → 4 credits; after `renewal_at` passes status stays `active`; pause does not extend `renewal_at`; balance reached 104 (no cap) | DEF-01, DEF-02, DEF-03, DEF-04, DEF-31, DEF-32 |
| H. Other features | Wearer profiles PARTIAL (API only) · Wardrobe Bag NOT IMPLEMENTED · Referrals NOT IMPLEMENTED · Gifting PARTIAL (checkout packing works; gift membership dead-ends) · Skin-tone PASS analysis / PARTIAL profile use · Piece requests PASS (unapproved addition) · Reels PASS · Notifications: dispatch email only, requires Resend | P04, P05, P06, P11, P15 | DEF-05, DEF-06, DEF-07, DEF-10, DEF-12 |

Feature implementation classification (brief §4-H):

| Feature | Classification |
|---|---|
| Wearer profiles | Implemented only in backend |
| Saved addresses | Implemented only in backend (create only); outside explicit V1 scope |
| Wardrobe Bag | Implemented only in backend (`ship` action is a no-op) |
| Customer referrals | Implemented only in backend (code generation only; not redeemable) |
| Offers (loyalty rules) | Admin data entry only; no pricing effect (non-functional placeholder) |
| Colour harmony / skin-tone | Fully accessible analysis; saved attribute partially integrated |
| Piece requests | Fully implemented (unapproved addition) |
| Instagram / reels | Fully implemented |
| Exchange workflow | Fully implemented (basic) |
| Gift membership | Partially integrated (record without payment or admin view) |
| Drops / early access | Admin data only; not enforced on storefront; promised in UI copy |

---

## 6. Admin universal journey

Admin UI sections (from `SECTIONS` in `Admin.jsx`) and backend modules:

| Module | URL | Result | Evidence / gap |
|---|---|---|---|
| Login & access | `/login` → `/admin` | PASS (code) / FAIL (bootstrap + live data) | Customer 403, anonymous 401 on all admin APIs (P10). Bootstrap email re-promoted on every login (P12). 4/4 live profiles admin (§18) |
| Overview dashboard | `/admin` | PASS | API revenue ₹3,990 = DB ₹3,990 (P17). Membership revenue not shown; no date range (DEF-30) |
| Products | `/admin/products` | PASS | Variant matrix, SKU uniqueness, sale < price, stale-stock 409, archive-if-sold (AUTO) |
| Categories | `/admin/categories` | PASS | CRUD + hide; delete nulls product category |
| AI Listing Studio | `/admin/listing` | BLOCKED | 502 “enter the listing manually” — `OPENAI_API_KEY` empty (P10) |
| Orders | `/admin/orders` | PASS | State machine, unpaid cannot ship, tracking required for tracked couriers, dispatch email (logged without Resend) |
| Piece requests | `/admin/piece-requests` | PASS (addition) | Filters, notes, status |
| Customers | `/admin/customers` | PARTIAL | List only; **no drill-down, no wearer profiles, no order history, no colour profile** (DEF-11) |
| Membership | `/admin/memberships` | PARTIAL | Read-only table; backend override not wired (DEF-29) |
| Credits | `/admin/credits` | PASS | Manual adjustment, never negative, expiring grants |
| Exchanges | `/admin/exchanges` | PARTIAL | Status + resolution; unknown id returns 200; no transition rules (DEF-25); no evidence display |
| Offers & Loyalty | `/admin/loyalty` | NOT IMPLEMENTED (effect) | Rules stored; page itself says “checkout pricing does not apply them automatically” (P07, DEF-06) |
| Drops | `/admin/drops` | Placeholder (addition) | `drop_settings` has no runtime reader |
| Sourcing | `/admin/sourcing` | PASS (addition) | Insert/list |
| Store Mode | `/admin/store` | PASS | Atomic stock take, paid+delivered order, invoice `VS/2026-27/000002` (P16); UI has no member-credit sale or customer email |
| Content & Legal | `/admin/content` | PASS (Instagram, videos) / PARTIAL (legal, store) | Videos ≤10 s and ≤3 live enforced server-side; legal pages and store pickup settings are list-only in UI (DEF-38) |
| Invoices | `/admin/invoices` | PASS | List + CSV |
| Audit log | `/admin/audit` | PASS (addition) | |
| **Settings** | none | Missing UI; API defect | Editable settings exist only via `POST /api/admin/ops?section=settings`; int/money stored as JSON strings (P01, DEF-13) |
| **Gifts, referrals, colour reviews** | none | NOT IMPLEMENTED | No admin view (DEF-10, DEF-06, DEF-11) |

Admin browser rendering: the earlier browser run did not reach the admin section. Later admin sign-in in the browser was refused by the browser automation guard (session change). Admin UI behaviour is therefore evidenced by API probes, the automated suite and code trace, **not** by visual browser verification (limitation L-04).

---

## 7. Complete frontend route inventory

| Route ID | Path | Component | User | Auth | Permission | Entry point | Direct URL (server) | APIs | Database | Actions → destination | Req ID | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 | `/` | `Home` | Visitor | No | — | Logo, nav | 200 | catalogue?featured, content | products, feedback_videos, instagram_content | Shop → `/catalogue`; categories → `/catalogue/:c`; Request a piece → modal; membership → `/membership` | CW-01 | PASS |
| R02 | `/catalogue` | `Catalogue` | Visitor | No | — | Nav “Shop”, footer | 200 | catalogue | products, variants, categories | search `?q`, sort `?sort`, `?in_stock`, load more, card → PDP | CW-02 | PASS |
| R03 | `/catalogue/:category` | `Catalogue` | Visitor | No | — | Nav, footer, sidebar | 200 / 404 unknown | catalogue?category | categories | as R02 | CW-02 | PASS |
| R04 | `/catalogue?category=x` | server redirect | Visitor | No | — | Legacy links | 301 → R03 | — | — | — | CW-02 | PASS |
| R05 | `/product/:slug` (or uuid → 301 slug) | `ProductDetail` | Visitor | No | — | Cards, recommendations | 200 / 404 | product, cart (POST), piece-requests | products, variants, cart_items | Add to bag; Buy now → `/cart`; request modal | CW-03 | PASS |
| R06 | `/cart` | `Cart` | Visitor/Customer | No | — | Header Bag | 200 noindex | cart GET/PATCH/DELETE | cart_items | Continue → `/checkout` or `/login?next=/checkout` | CW-06 | PASS |
| R07 | `/checkout` | `Checkout` (RequireAuth) | Customer | Yes | user | Cart | 200 shell → login redirect | checkout, payment-verify, orders?id | orders, order_items, reservations | Pay → Razorpay → `/orders/:id?placed=1`; resume/cancel | CW-07 | PASS (DEF-40 UI) |
| R08 | `/membership` | `Membership` | Visitor/Customer | Partial | user for actions | Nav, footer | 200 | membership | memberships, credit_ledger | Start → Razorpay; pause/resume/cancel | MB-* | PARTIAL |
| R09 | `/orders` | `Orders` (RequireAuth) | Customer | Yes | user | Account nav, footer | 200 shell → login | orders | orders | View details → R10 | CW-08 | PASS |
| R10 | `/orders/:id` | `OrderDetail` (RequireAuth) | Customer | Yes | owner | R09, post-payment | 200 shell; 400/404 → NotFound | orders?id, exchange, checkout(resume) | orders, invoice_records, exchanges | Complete payment; print; exchange submit | CW-08/09/10/11 | PASS |
| R11 | `/skin-tone` | `SkinToneAnalysis` | Visitor | No (save: yes) | — | Nav, account nav | 200 | catalogue, colour-review POST | colour_reviews | Choose photo / camera → result; Save → `/login?next=/skin-tone` if guest | ST-* | PARTIAL |
| R12 | `/login` | `Login` | Visitor | No | — | Header, guards | 200 noindex | auth/start-login, verify-code | auth_otps, profiles | → `next` (safe) or `/account` / `/admin` | CW-04 | PASS / BLOCKED prod |
| R13 | `/account` | `Account` (RequireAuth) | Customer | Yes | user | Header | 200 shell → login | account, orders?limit=1, piece-requests?scope=mine | customer_profiles, memberships | Manage membership, orders, admin link (admins), sign out | CW-05 | PARTIAL |
| R14 | `/admin/:section?` | `Admin` (RequireAuth admin) | Admin | Yes | admin | Account card, mobile menu | 200 shell; guest → login; customer → `/account`; unknown section → `/admin` | admin/ops, listing-studio, upload, piece-requests PATCH | many | 17 sections | AD-* | PARTIAL |
| R15 | `/gifting` | `Gifting` | Visitor | Submit: yes | user | Nav, footer | 200 | gifting POST | gifts | Create gift (401 message, no link for guests) | GF-01 | PARTIAL |
| R16 | `/contact` | `Contact` | Visitor | No | — | Footer | 200 | piece-requests | piece_requests | WhatsApp `wa.me`, `tel:`, request modal | — | PASS (address/email missing, DEF-43) |
| R17 | `/legal` | `Legal` → Navigate | Visitor | No | — | — | **404** then client → `/legal/privacy` | legal | legal_pages | — | — | FAIL (Low, DEF-27) |
| R18 | `/legal?slug=x` | server redirect | Visitor | No | — | Admin “view” link | 301 → R19 | — | — | — | — | PASS |
| R19 | `/legal/:slug` | `Legal` | Visitor | No | — | Footer, contact | 200 / 404 unknown | legal | legal_pages | related policy links | — | PASS |
| R20 | `*` | `NotFound` | Any | No | — | Any bad URL | 404 | — | — | Home / catalogue links | — | PASS |
| R21 | `/coming-soon*` | server redirect | Any | — | — | Legacy | 301 → `/` | — | — | — | — | PASS |
| R22 | `/admin.html` | server redirect | Any | — | — | Legacy | 301 → `/admin` | — | — | — | — | PASS |
| R23 | `/robots.txt`, `/sitemap.xml` | server | Crawler | — | — | — | 200 | — | products, categories, legal_pages | — | SQ | PASS |
| R24 | `/uploads/*` | static (sandbox CSP) | Any | — | — | Media | 200 | — | files | — | — | PASS |

---

## 8. Complete backend API inventory

All modules mounted by `server.js`. “Access” is enforced centrally in `mountModule` (401 if not signed in, 403 if not admin) before the handler runs. All mutations pass `originGuard` (Origin/Referer must match; JSON body required).

| Method | Path | Handler | Access | Validation / business logic | Tables | Frontend caller | Req | Evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/health` | `server.js` | public | `SELECT 1` → 200/503 | — | ops | SYS | HTTP 200 | PASS |
| POST | `/api/auth/start-login` | `api/auth.js` | public, 20/15 min IP, 5/15 min email | OTP HMAC with pepper; 30 s resend throttle; dev echo only if non-prod | auth_otps | `StoreContext` | CW-04 | AUTO | PASS |
| POST | `/api/auth/verify-code` | `api/auth.js` | public, 30/15 min | attempt++ before compare; single-use delete; profile upsert; **bootstrap admin promotion on every login** | auth_otps, profiles, customer_profiles, audit_logs | `StoreContext` | CW-04/SQ-03 | AUTO, P12 | PASS / DEF-15 |
| GET | `/api/auth/session` | `api/auth.js` | public | role from DB | profiles | `StoreContext` | CW-04 | AUTO | PASS |
| POST | `/api/auth/signout` | `api/auth.js` | public | `sessions_valid_after = now()` | profiles | `StoreContext` | CW-04 | AUTO | PASS |
| POST | `/api/upload` | `api/upload.js` | public (images ≤5 MB), admin (images ≤10 MB, video ≤40 MB, ≤10 s) | type from magic bytes; 20/h | disk | `uploadFile` (admin, request modal) | AD-11/PI-04 | AUTO, P13 | PASS (DEF-22, DEF-33) |
| POST | `/api/webhooks/razorpay` | `api/webhooks/razorpay.js` | HMAC raw body, 600/min | dedupe `payment_events`; captured/order.paid, failed, subscription.charged/halted/cancelled, refund.processed | payment_events, orders, membership_payments, memberships | Razorpay | IN-01/02 | AUTO | PASS |
| GET | `/api/catalogue` | `api/catalogue.js` | public | q (escaped LIKE), category, featured, in_stock, sort whitelist, paging | products, variants, categories | Home, Catalogue, SkinTone | CW-02 | AUTO, P18 | PASS (no colour filter) |
| GET | `/api/product` | `api/product.js` | public | slug or uuid; 4 recommendations | products, variants, categories | PDP | CW-03 | HTTP | PASS |
| GET | `/api/content` | `api/content.js` | public | ≤3 videos, 12 Instagram | instagram_content, feedback_videos, store_settings | Home | AD-10/11 | CODE | PASS |
| GET | `/api/legal` | `api/legal.js` | public | DB or bundled fallback | legal_pages | Legal | — | HTTP | PASS |
| GET | `/api/payment-config` | `api/payment-config.js` | public | publishable key only | — | **none** | IN-01 | CODE | PASS (unused) |
| GET/POST/PATCH/DELETE | `/api/cart` | `api/cart.js` | user, 120/min | variant required; qty caps; merge with savepoints; Premium credit block | carts, cart_items | StoreContext, Cart | CW-06 | AUTO | PASS |
| POST | `/api/checkout` (start/resume/cancel) | `api/checkout.js` | user, 12/min | idempotency key + fingerprint + advisory lock; server prices; reservations; credit debit; gateway order | orders, order_items, reservations, variants, memberships, credit_ledger | Checkout, OrderDetail | CW-07 | AUTO | PASS (DEF-26) |
| POST | `/api/payment-verify` | `api/payment-verify.js` | user, 20/min | HMAC over **stored** gateway order id; fetch/capture; amount/currency; finalize once | orders, invoice_records, reservations, cart_items | Checkout, OrderDetail | IN-01 | AUTO | PASS (DEF-35) |
| GET | `/api/orders` (list / `?id=`) | `api/orders.js` | user (owner) | uuid; owner scope | orders, order_items, invoice_records, exchanges | Orders, OrderDetail, payments.js | CW-08 | AUTO, P18 | PASS |
| GET/PUT/POST/DELETE | `/api/account` | `api/account.js` | user, 60/min | profile upsert; wearer CRUD (≤`max_wearers`); address **create only**; delete_data | customer_profiles, wearer_profiles, addresses, notification_preferences, … | **GET only** (Account) | CW-05/WP-01 | P11 | PARTIAL |
| GET/POST | `/api/membership` | `api/membership.js` | user, 20/min | start_checkout (upfront), activate_paid, pause/resume/cancel | memberships, membership_payments, credit_ledger, invoice_records | Membership | MB-*/CR-* | AUTO, P03 | PARTIAL (DEF-01…04) |
| GET/POST | `/api/colour-review` | `api/colour-review.js` | user, 30/h | rejects image fields; ≥3 hex colours; **no season** | colour_reviews | POST only (SkinTone) | ST-03/04 | AUTO, P15 | PARTIAL |
| GET/POST | `/api/exchange` | `api/exchange.js` | user, 20/h | paid + delivered, 7 d / 24 h windows, one open | exchanges | POST only (OrderDetail) | CW-11 | AUTO | PASS |
| GET/POST | `/api/gifting` | `api/gifting.js` | user, 20/h | server amount; **no payment** | gifts | POST only (Gifting) | GF-01 | P05 | FAIL |
| GET/POST | `/api/referrals` | `api/referrals.js` | user, 20/h | self-referral block, 50 cap; **no redemption** | referrals | **none** | AD-05 | P06 | NOT IMPLEMENTED (journey) |
| GET/POST/DELETE | `/api/wardrobe` | `api/wardrobe.js` | user | save/remove; `ship` returns count only | wardrobe_items | **none** | WB-01 | P04 | NOT IMPLEMENTED (journey) |
| GET/POST/PATCH | `/api/piece-requests` | `api/piece-requests.js` | public POST (8/h), user GET, admin PATCH | URL/attachment validation | piece_requests | Modal, Account, Admin | ADD-PR-01 | AUTO | PASS |
| GET/POST/PUT/DELETE | `/api/admin/ops?section=…` | `api/admin/ops.js` | admin, 240/min | 20 GET sections, 15 write sections, 4 delete sections (see §6) | most tables | Admin | AD-* | AUTO, P01/P07/P09/P16/P17 | PASS with DEF-13, DEF-25 |
| POST | `/api/admin/listing-studio` | `api/admin/listing-studio.js` | admin, 60/h | prompt with owner facts; JSON parse; approval required | — | Admin | OPT-AI-01 | P10 | BLOCKED |
| GET | `/api/admin/dashboard`, `/products`, `/orders`, `/customers`, `/content` | `api/admin/*.js` | admin | read-only legacy | various | **none** | — | P10 | Unused (DEF-28) |
| ALL | `/api/*` unknown | `server.js` | — | 404 JSON | — | — | — | HTTP | PASS |

Duplicate/conflicting routes: none conflict. Legacy read endpoints duplicate `admin/ops` reads. `PATCH /api/piece-requests` and `POST /api/admin/ops?section=piece_request` both update piece requests through the same `updatePieceRequest` function (consistent).

---

## 9. Frontend–backend–database traceability (major actions)

| User action | Component → handler | API | Server chain | DB operation | Visible outcome | Verdict |
|---|---|---|---|---|---|---|
| Add to bag (signed in) | `ProductDetail.add` → `StoreContext.addToCart` | POST `/api/cart` | `mountModule(user)` → `cart.addLine` (variant active, stock ≥1, qty cap) | `INSERT … ON CONFLICT (cart_id, variant_id)` | Bag count, “Added to your bag.” | Complete |
| Place order | `Checkout.submit` | POST `/api/checkout` | idempotency → advisory lock → `loadCartLines` → `calculateCartPrice` → `reserve` (`takeStock`) → credit debit → `razorpay.createOrder` | orders, order_items, reservations, variants −qty | Razorpay modal (test mode, ₹5,299 observed) | Complete |
| Confirm payment | `openRazorpay.handler` → `api('/api/payment-verify')` | POST `/api/payment-verify` | HMAC(stored order id) → `fetchPayment` → capture → `finalizeOrderPayment` | orders paid, reservations committed, invoice, cart cleared | `/orders/:id?placed=1` “Thank you — your order is confirmed.” | Complete (mock) |
| Dismiss payment | `ondismiss` → phase `dismissed` | POST `/api/checkout` resume/cancel | `expireOrder` | reservations released | “Pieces held until …” / “Checkout cancelled …” | Complete |
| Exchange request | `OrderDetail.exchange` | POST `/api/exchange` | windows, one-open check | INSERT exchanges | “Request received …” | Complete (no evidence upload) |
| Buy membership | `Membership.handleAction('activate')` | POST `/api/membership` ×2 | `createOrder` → `finalizeMembershipPayment` (+4 credits, renewal +2 months, invoice) | memberships, membership_payments, credit_ledger, invoice_records | “Welcome … 4 credits are ready.” | Chain complete; **business rule wrong** |
| Membership renewal | — | — | **none** | — | “Next refresh” date passes silently | **Broken** |
| Save to Wardrobe Bag | **no UI** | (`/api/wardrobe`) | — | — | — | **Unreachable** |
| Apply referral/offer | **no UI** | (`/api/referrals`, `loyalty_rules`) | not read by pricing | — | — | **Unreachable** |
| Create gift membership | `Gifting.handleSubmit` | POST `/api/gifting` | insert `draft` | gifts | “Our studio team will contact you” — no admin view | **Dead end** |
| Save colour profile | `SkinToneAnalysis.handleSave` | POST `/api/colour-review` | forbidden image fields; palette | colour_reviews (no season) | “Saved to your Vishrea profile.” — never read back | **Partial** |
| Admin dispatch | `Admin` dispatch modal → `post('order')` | POST `/api/admin/ops?section=order` | `FULFILMENT_FLOW`, tracking required → `notifyDispatched` | orders, audit_logs | Toast; customer tracker updates within 15 s | Complete |
| Admin store sale | `handleStoreSale` | POST `…section=store_sale` | `storeSale` → `takeStock` → invoice | orders, order_items, store_sales, invoice_records | “Sale recorded · invoice …” | Complete |
| Admin settings | **no UI** | POST `…section=settings` | type check then **string overwrite** | app_settings | — | Defective (P01) |

Buttons/links without effect or with the wrong target: header “Search” (opens catalogue, does not focus search). Membership “early access to selected drops” and gifting “48-hour early access” are promises with no implementation. Apart from these, no handler-less buttons were found, and every `onClick`/`onSubmit` resolves to an API call or navigation. Frontend features using mock/hardcoded data: gifting price label `₹3,598` hardcoded; home editorial images from Unsplash; membership fallback pricing object (overwritten by API when signed in).

---

## 10. Direct URL, link and deep-link audit

32 URLs were requested directly against the isolated server (no cookies). Protected routes were then opened in the browser signed out and signed in as a customer.

| URL | Server | Browser final result | Status |
|---|---|---|---|
| `/`, `/catalogue`, `/catalogue/dresses`, `/product/the-wine-slip-dress`, `/membership`, `/skin-tone`, `/gifting`, `/contact`, `/login`, `/legal/privacy`, `/robots.txt`, `/sitemap.xml`, `/api/health` | 200 | Render correctly | PASS |
| `/catalogue?category=dresses` · `/legal?slug=terms` · `/coming-soon` · `/admin.html` · `/catalogue/` | 301 → clean URL | Correct | PASS |
| `/catalogue/not-a-cat` · `/product/nope` · `/legal/zzz` · `/random/page` · `/api/nope` | 404 | Branded not-found page / JSON 404 | PASS |
| `/cart`, `/checkout`, `/account`, `/orders`, `/orders/<uuid>`, `/admin`, `/admin/products`, `/admin/bogus` | 200 shell with `X-Robots-Tag: noindex` | Signed out → `/login?next=…`; customer on `/admin*` → `/account`; refresh keeps session | PASS |
| `/legal` | **404** | Client redirects to `/legal/privacy` | FAIL (Low) — DEF-27 |
| Browser Back/Forward on catalogue filters | — | URL and filter state restored | PASS |
| External links | — | `wa.me/916364116567`, `tel:`, Instagram (`rel="noopener noreferrer"`) | PASS |
| Callback/return URLs | — | Razorpay uses JS handler (no redirect URL); webhook URL is configured in Razorpay dashboard (not verifiable) | BLOCKED (dashboard) |
| Framing | — | Same-origin iframe of app pages blocked (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) | PASS |

---

## 11. Role and permission matrix

Roles in code: **visitor** (no session), **customer** (`profiles.role='customer'`), **admin** (`is_admin` or role `admin`/`owner`). Role is read from the database on every request (`auth.extractUser`), never from token claims.

| Resource | Visitor | Customer | Admin | Unauthorized behaviour |
|---|---|---|---|---|
| Storefront pages, catalogue, product, content, legal, payment-config | ✔ | ✔ | ✔ | — |
| Piece request submit, guest image upload | ✔ (rate-limited) | ✔ | ✔ | 429 when exceeded |
| `/cart` page | ✔ (local bag) | ✔ (server bag) | ✔ | — |
| `/api/cart`, `/checkout`, `/api/payment-verify`, `/orders*`, `/api/account`, `/api/membership`, `/api/colour-review`, `/api/exchange`, `/api/gifting`, `/api/referrals`, `/api/wardrobe` | ✘ 401 / login redirect | ✔ own records only | ✔ own records only | 401; foreign ids → 404 (AUTO, P11) |
| Piece-request list/detail | ✘ 401 | own only | all | 404 for foreign |
| Piece-request PATCH, `/api/admin/*`, video upload | ✘ 401 | ✘ 403 | ✔ | 403 + `security.admin_denied` log (P10) |
| `/admin/*` pages | → login | → `/account` | ✔ | UI guard only; APIs enforce independently |

Horizontal escalation (customer B → A's order, piece request, wearer): blocked (AUTO, P11). Vertical escalation via request parameters or frontend state: blocked, because role comes from the DB. Vertical escalation via **configuration**: possible, for three reasons. The bootstrap email is re-promoted on login (DEF-15). Dev OTP echo runs against the live DB (DEF-17). And if the hard-coded JWT secret is in use, a token can be forged for any known `auth_user_id`, including an admin's (DEF-18).

---

## 12. Business logic and data integrity

| Rule | Implementation | Verified | Result |
|---|---|---|---|
| Server-authoritative pricing | `lib/pricing.js` only; client totals ignored | AUTO tamper test | PASS |
| Variant / sale price | sale applies only if `< price`; DB CHECK `sale ≤ price` | AUTO | PASS |
| GST | prices GST-inclusive; 5 % ≤ ₹2,500 per piece, else 18 %; CGST+SGST intra-state, IGST inter-state; shipping/packing at highest line rate | AUTO | PASS |
| Shipping | ₹99 delivery, ₹0 pickup, ₹0 when ≥4 credits redeemed by active member | AUTO | PASS |
| Membership price | ₹1,799 × 2 upfront = ₹3,598, 18 % GST extracted for invoice | P03 | PASS (C-02 model question) |
| Credits per month | **4 per payment covering 2 months** | P03 | FAIL (DEF-02) |
| Credit expiry / rollover | 60-day FIFO, reconciled on read/checkout | AUTO | PASS (value unconfirmed, C-03) |
| Maximum balance | none | P03 (104) | NOT IMPLEMENTED (DEF-04) |
| Premium restriction | badge text contains “premium” | AUTO | PASS (fragile, DEF-37) |
| Reservation | 15 min (5–60 bound), swept every 60 s | AUTO | PASS |
| Exchange rules | paid + delivered; exchange ≤7 days, damage ≤24 h; one open per order (unique index) | AUTO | PASS |
| One-of-one | qty cap 1 in cart/admin; conditional decrement; DB `CHECK stock_quantity >= 0` | AUTO race tests; live: 0 negative stock, 0 one-of-one >1 | PASS |
| Concurrency | sorted-variant locking; advisory locks for checkout, membership, wearers, video publish | AUTO (20 buyers / 3 units) | PASS |
| Idempotency | unique indexes on idempotency key, Razorpay order/payment ids, invoice per order/membership payment, ledger (order, reason), webhook event id | Schema + AUTO | PASS |
| Order states | `FULFILMENT_FLOW`; unpaid cannot ship; cancel paid → `refund_required` + restock + credit reversal | AUTO | PASS |
| Refunds | automatic for unfulfillable/duplicate captures; bounded retries (8) with backoff; deterministic receipt | AUTO | PASS |
| Data ownership | every customer query scoped by `auth_user_id` | AUTO, P11 | PASS |
| Referential integrity | FKs exist for catalogue/order lines; **no FK from user-owned tables to `profiles`** (text `auth_user_id`, `store_walkin`) | Schema | Observation |
| Settings types | int/money saved as JSON strings | P01 | FAIL (Low, DEF-13) |

Frontend and backend rules match. The frontend shows estimates only and always defers to server totals. Copy-level mismatches (monthly credits, early access) are covered in DEF-31.

---

## 13. Security and reliability findings

This is a **code-and-configuration security verification with targeted probes**, not a penetration test.

| Area | Finding | Result |
|---|---|---|
| Authentication bypass | None found; tokens HS256 with algorithm pinned; revocation by `sessions_valid_after` | PASS |
| Authorization / IDOR | Central access enforcement; owner-scoped queries | PASS |
| SQL injection | All queries parameterised; dynamic identifiers only from fixed key lists / whitelists (`SORTS`, `Object.keys(fields)`) | PASS |
| XSS | React escaping; no `dangerouslySetInnerHTML`; uploads served with `sandbox` CSP and `nosniff`; SVG/HTML refused | PASS |
| CSRF | `originGuard` + JSON-only bodies + SameSite=Lax | PASS (dev allows any `*.trycloudflare.com`, DEF-34) |
| Mass assignment | Explicit field lists in every writer | PASS |
| OTP handling | Peppered HMAC, timing-safe compare, attempt-before-compare, single-use | PASS |
| Cookies | HttpOnly, SameSite=Lax, Secure in prod/HTTPS, 14 days | PASS |
| CORS | Same-origin default; explicit list | PASS |
| Rate limiting | Global 600/min/IP; OTP, checkout, upload, webhook, per-module limits; in-memory (single instance only) | PASS |
| Upload validation | Magic-byte sniffing, size limits, MP4 duration parsing | PASS (guest uploads not cleaned, DEF-33) |
| Payment & webhook signatures | Timing-safe HMAC; raw body for webhook | PASS |
| Error leakage | Production returns generic messages | PASS |
| HTTPS | Prod: redirect + HSTS + `upgrade-insecure-requests`; refuses non-https `APP_ORIGIN` | PASS (code) / BLOCKED (deployment) |
| Secrets | `.env` git-ignored; bundle clean; **hard-coded JWT secret in tracked `start.ps1`** (pushed to `github.com/vishreastudio-dev/VISHREA-STUDIO`); active secret has same length/prefix | **FAIL (DEF-18)** |
| Environment hygiene | `.env`: `NODE_ENV=development`, `AUTH_DEV_OTP_ECHO=true`, live Supabase `DATABASE_URL`, tunnel origin in `CORS_ORIGINS`. No tunnel process was running at audit time | **FAIL (latent, DEF-17)** |
| Admin population | 4/4 live profiles admin, incl. `@vishrea.test` | **FAIL (DEF-16)** |
| Supabase anon key | `vishrea-react/.env` holds `VITE_SUPABASE_ANON_KEY` (unused by source, not in bundle). RLS is enabled on all tables | Observation — remove unused key |
| Reliability: DB down | `/api/health` 503; handlers 500 generic. **Observed during audit:** a Windows PostgreSQL shared-memory fault caused `ECONNRESET`. The app logged errors and recovered automatically once the DB returned, with no restart needed | PASS |
| Reliability: gateway down | Hold released on order-create failure; verify falls back to signature + reconciliation | PASS |
| Reliability: email down | Dispatch never blocks admin; OTP returns 502/503 | PASS |
| Missing configuration | Production refuses to start without DB URL, Razorpay keys/webhook secret, strong JWT, https origin | PASS |

---

## 14. Responsive and usability verification (browser-measured)

Horizontal overflow (`documentElement.scrollWidth` vs `clientWidth`), measured in the browser with device emulation:

| Page | 360 | 390 | 768 | 1366 | 1440 |
|---|---|---|---|---|---|
| `/` | 360/360 no | 390/390 no | 768/768 no | 1351/1351 no | no (visitor run) |
| `/catalogue` | no | no | no | no | no |
| `/product/premium-silk-column-dress` | no | no | no | no | no |
| `/cart` | no | no | no | no | no |
| `/checkout` | no | — | — | — | no |
| `/account`, `/orders`, `/gifting` | no | — | — | — | — |
| `/membership`, `/skin-tone` | no | no | no | no | no |
| `/admin` | not measured (L-04) | | | | |

| Usability check | Result | Defect |
|---|---|---|
| Checkout form controls | All inputs **9 px** font; State `select` **13 px tall** (root cause: `.checkout-form label{font-size:9px}` + `input{font:inherit}`; no `select` padding) | DEF-40 (Medium) |
| Gifting form controls | Same: 9 px inputs, 13 px `select` | DEF-40 |
| Catalogue sort `select` | 11 px font, 24 px tall | DEF-44 (Low) |
| Mobile menu | Opens, `aria-expanded=true`, 8 links, closes on Escape | PASS |
| Skip link | First tab stop; focus-visible outline defined (2 px); skip-link outline low contrast on dark bar | PASS (Low note, DEF-45) |
| Request-piece modal | Dialog, Escape closes, focus returns to trigger | PASS |
| Loading / error / empty states | Present on catalogue, PDP, cart, orders, account, admin | PASS |
| Membership CTA | Primary “Sign in to start” sits ~1,640 px down at 1440 width (below the fold) | DEF-45 (Low) |
| Guest-bag thumbnail | Placeholder `/assets/editorial.jpg` instead of product image until sign-in | DEF-41 (Low) |
| Gifting guest message | “Please sign in to create a gift.” has no link or live region | DEF-42 (Low) |
| Contact page | No email, street address or grievance-officer details | DEF-43 (Medium) |

Screenshots were captured during the browser runs, including `vs-rsp-checkout-360.png` saved in the Cursor screenshots folder. Camera capture, Razorpay modal completion, and admin pages at mobile widths were not exercised (§18).

---

## 15. Requirements traceability matrix (scored)

| Req ID | Requirement | User | Frontend route | Backend API | Database | Acceptance criteria | Test case | Result | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| V1-CW-01 | Responsive storefront home | Visitor | `/` | catalogue, content | products, content | Renders, links work | TC-CUS-001 | PASS | HTTP, browser |
| V1-CW-02 | Catalogue | Visitor | `/catalogue[/:c]` | catalogue | products, categories | Filter, sort, search, 404 unknown | TC-CUS-002…006 | PASS | browser, AUTO |
| V1-CW-03 | Product detail | Visitor | `/product/:slug` | product | variants | Price/SKU/stock per size | TC-CUS-007…011 | PASS | browser, HTTP |
| V1-CW-04 | Login | Visitor | `/login` | auth/* | auth_otps, profiles | Code by email | TC-CUS-020…026 | BLOCKED | Works in dev; prod needs Resend (DEF-19) |
| V1-CW-05 | Profile management | Customer | `/account` | PUT account | customer_profiles | Edit & persist | TC-CUS-027 | PARTIAL | No UI (DEF-08) |
| V1-CW-06 | Cart | Visitor/Customer | `/cart` | cart | cart_items | Add/update/remove/merge | TC-CUS-030…036 | PASS | browser, AUTO |
| V1-CW-07 | Checkout | Customer | `/checkout` | checkout | orders, reservations | Server totals, holds, idempotent | TC-CUS-040…049 | PASS | AUTO, browser (DEF-26 low) |
| V1-CW-08 | Orders | Customer | `/orders[/:id]` | orders | orders | Own only | TC-CUS-050…054 | PASS | AUTO, P18 |
| V1-CW-09 | Tracking | Customer | `/orders/:id` | orders | orders | Live status, courier link | TC-CUS-055 | PASS | AUTO journey |
| V1-CW-10 | GST invoice | Customer | `/orders/:id` | orders | invoice_records | Complete GST invoice | TC-CUS-056 | PARTIAL | Seller GSTIN/legal details missing (DEF-21) |
| V1-CW-11 | Exchange request | Customer | `/orders/:id` | exchange | exchanges | Windows, one open | TC-CUS-057…059 | PASS | AUTO |
| V1-CW-12 | Pickup + ₹99 | Customer | `/checkout` | checkout | — | ₹0 / ₹99 | TC-CUS-043 | PASS | AUTO |
| V1-CW-13 | Mobile-first journeys | All | storefront | — | — | No overflow; usable controls | TC-RSP-* | PARTIAL | No overflow; 9 px checkout inputs (DEF-40) |
| V1-PI-01 | Product create/edit/remove | Admin | `/admin/products` | ops product | products, variants | Atomic, archive if sold | TC-ADM-010…015 | PASS | AUTO |
| V1-PI-02 | Categories | Admin | `/admin/categories` | ops category | categories | CRUD reflects on storefront | TC-ADM-017 | PASS | CODE+AUTO |
| V1-PI-03 | Pricing | Admin | `/admin/products` | ops product | variants | Per-size, sale < price | TC-ADM-011/012 | PASS | AUTO |
| V1-PI-04 | Images | Admin | `/admin/products` | upload | disk | Type-checked upload | TC-ADM-016 | PASS | AUTO (storage risk DEF-22) |
| V1-PI-05 | Availability/status | Admin | `/admin/products` | ops product_status | products | Hide/publish | TC-ADM-014 | PASS | CODE |
| V1-PI-06 | One-of-one inventory | Admin/Customer | PDP, admin | checkout, ops | variants | Never oversold | TC-CUS-045, TC-ADM-019 | PASS | AUTO, live DB |
| V1-MB-01 | ₹1,799 plan visibility | Visitor | `/membership` | membership | app_settings | Accurate plan & terms | TC-MEM-001 | PARTIAL | Copy promises monthly credits/early access (DEF-31) |
| V1-MB-02 | Initial payment | Customer | `/membership` | membership | membership_payments | Paid once, bound to user | TC-MEM-002…004 | PASS | AUTO, P03 |
| V1-MB-03 | Recurring setup where supported | Customer | `/membership` | — | — | Autopay | TC-MEM-005 | NOT IMPLEMENTED | DEF-03 |
| V1-MB-04 | Membership status lifecycle | System | `/membership` | — | memberships | Lapse/renew after period | TC-MEM-006 | FAIL | P03 (DEF-01) |
| V1-MB-05 | Pause/resume/cancel | Customer | `/membership` | membership | memberships | Rules applied | TC-MEM-007…009 | PARTIAL | Pause doesn't extend period; paused credit toggle (DEF-01, DEF-32) |
| V1-CR-01 | 4 credits/month | System | — | — | credit_ledger | 4 per paid month | TC-MEM-010 | FAIL | P03 (DEF-02) |
| V1-CR-02 | Balance | Customer | membership/account/cart | several | memberships | Consistent | TC-MEM-011 | PASS | browser |
| V1-CR-03 | Rollover/expiry | System | — | membership | credit_ledger | FIFO expiry | TC-MEM-012 | PASS | AUTO |
| V1-CR-04 | Redemption | Customer | `/cart` | cart, checkout | credit_ledger | Atomic | TC-MEM-013 | PASS | AUTO |
| V1-CR-05 | Maximum balance | System | — | — | memberships | Cap enforced | TC-MEM-015 | NOT IMPLEMENTED | P03 (DEF-04) |
| V1-CR-06 | Premium restriction | Customer | `/cart` | cart | products.badge | Premium refused | TC-MEM-016 | PASS | AUTO |
| V1-WB-01 | Wardrobe Bag | Member | none | wardrobe | wardrobe_items | Save → redeem | TC-MEM-017 | NOT IMPLEMENTED | P04 (DEF-05) |
| V1-WP-01 | Wearer profiles | Customer | none | account | wearer_profiles | Basic CRUD | TC-CUS-028 | PARTIAL | API only (DEF-07) |
| V1-OX-01 | Order management | Admin | `/admin/orders` | ops order | orders | State machine | TC-ADM-020…023 | PASS | AUTO |
| V1-OX-02 | Payment status | Customer/Admin | orders pages | orders, ops | orders | Accurate | TC-PAY-* | PASS | AUTO |
| V1-OX-03 | Exchange admin handling | Admin | `/admin/exchanges` | ops exchange | exchanges | Valid transitions | TC-ADM-050/051 | PARTIAL | P09 (DEF-25) |
| V1-GF-01 | Basic gifting | Customer | `/checkout`, `/gifting` | checkout, gifting | orders.gift, gifts | Working gift flow | TC-CUS-060/061 | PARTIAL | Packing PASS; gift membership dead end (DEF-10) |
| V1-ST-01 | Photo/camera analysis | Visitor | `/skin-tone` | — | — | On-device result | TC-ST-001…003 | PASS | CODE+browser |
| V1-ST-02 | Category/undertone result | Visitor | `/skin-tone` | — | — | Undertone, depth, season | TC-ST-002 | PASS | CODE |
| V1-ST-03 | Saved profile attribute | Customer | `/skin-tone` | colour-review | colour_reviews | Stored and reusable | TC-ST-004/005 | PARTIAL | P15 (DEF-12) |
| V1-ST-04 | Raw image not retained | Visitor | `/skin-tone` | colour-review | raw_image_key NULL | Never uploaded | TC-ST-006 | PASS | AUTO, code |
| V1-ST-05 | Recommendations from attribute | Visitor | `/skin-tone`, `/catalogue` | catalogue | products.colour_season | Matching pieces | TC-ST-007, TC-CUS-013 | PARTIAL | P08 (DEF-12) |
| V1-AD-01 | Admin products | Admin | `/admin/products` | ops | products | CRUD | TC-ADM-010 | PASS | AUTO |
| V1-AD-02 | Admin inventory | Admin | `/admin/products` | ops | variants | Stock edits safe | TC-ADM-013 | PASS | AUTO |
| V1-AD-03 | Admin orders | Admin | `/admin/orders` | ops | orders | View, payment, customer, exchanges | TC-ADM-020 | PASS | AUTO |
| V1-AD-04 | Admin customers | Admin | `/admin/customers` | ops customers | customer_profiles | Wearers, membership, credits, order history | TC-ADM-030…033 | PARTIAL | DEF-11, DEF-29 |
| V1-AD-05 | Offers & referrals | Admin/Customer | `/admin/loyalty` | ops loyalty, referrals | loyalty_rules, referrals | Customer-facing application | TC-ADM-040, TC-CUS-062 | NOT IMPLEMENTED | P06, P07 (DEF-06) |
| V1-AD-06 | Store Mode | Admin | `/admin/store` | ops store_sale | orders, store_sales | Sale + invoice | TC-ADM-045 | PASS | P16 |
| V1-AD-07 | Dashboard | Admin | `/admin` | ops dashboard | many | Accurate KPIs | TC-ADM-001 | PASS | P17 |
| V1-AD-08 | CSV export | Admin | admin | ops export | many | Safe CSV | TC-ADM-003 | PASS | AUTO |
| V1-AD-09 | AI skin-tone review | Admin | none | — | colour_reviews | Owner can view | TC-ST-008 | NOT IMPLEMENTED | DEF-11 |
| V1-AD-10 | Instagram links | Admin | `/admin/content` | ops content | instagram_content | Add/update/remove | TC-ADM-047 | PASS | CODE, live row |
| V1-AD-11 | ≤3 videos ~10 s | Admin | `/admin/content` | upload, ops content | feedback_videos | Server-enforced | TC-ADM-048/049 | PASS | AUTO |
| V1-IN-01 | Razorpay checkout & verification | Customer | `/checkout` | checkout, verify, webhook | orders | End to end | TC-PAY-001…014 | BLOCKED | Mock end-to-end PASS; real sandbox completion not automatable; live keys/webhook missing (DEF-20) |
| V1-IN-02 | Razorpay membership workflow | Customer | `/membership` | membership | membership_payments | End to end | TC-MEM-002…004 | BLOCKED | Mock PASS; same limits |
| V1-SQ-01 | HTTPS/TLS | All | — | — | — | Enforced in prod | production.test.js | BLOCKED | Code PASS; deployment not available |
| V1-SQ-02 | Secrets outside source | Ops | — | — | — | No secrets in tracked files | TC-SEC-017 | FAIL | DEF-18 |
| V1-SQ-03 | Authenticated access & role separation | All | — | all | profiles | Least privilege | TC-SEC-001…006, 019 | PARTIAL | Code PASS; DEF-15/16/17 |
| V1-SQ-04 | Payment data stays with Razorpay | Customer | — | — | — | No card data stored | CODE | PASS | Only ids/signatures stored |
| V1-SQ-05 | DB access controls & backups | Ops | — | — | all | RLS/backups | LIVE-RO | BLOCKED | RLS on; backup plan not visible |
| V1-SQ-07 | Testing | — | — | — | — | Functional/payment/responsive tests | §16 | PARTIAL | 78 backend tests; no frontend/E2E suite |
| V1-SQ-08 | Production deployment & smoke test | Ops | — | — | — | Live, smoke-tested | — | BLOCKED | Not deployed/accessible; config blockers |

**Totals (61):** PASS 34 · PARTIAL 13 · FAIL 3 · NOT IMPLEMENTED 5 · BLOCKED 6. Optional OPT-AI-01: BLOCKED (no key).

---

## 16. Test execution results

| Activity | Command / method | Result |
|---|---|---|
| Static inspection | full read of backend, frontend, migrations, scripts | done |
| Lint | `npm run lint` (oxlint) | 0 errors, 21 warnings |
| Build | `vite build --outDir %TEMP%\vaudit\dist` | success; hashes equal deployed `dist` |
| Unit tests | `pricing`, `razorpay-signature`, `razorpay-gateway`, `notify` | all pass |
| Integration/API/DB/auth tests | `platform.test.js` (43 tests), `production.test.js` (7), `seo.test.js` (7) | all pass, not skipped |
| Full suite | `npm test` | **78/78 pass**, 13 suites |
| Audit probes | 20 probes, harness-based | 20/20 executed; outcomes below |
| Browser route tests | visitor + customer + direct URLs | done (admin UI not reached — L-04) |
| Payment sandbox | Razorpay test-mode modal launched (₹5,299); completion inside cross-origin iframe not automatable | BLOCKED |
| Responsive | 5 widths, up to 10 pages | done (§14) |
| Regression | n/a (no fixes in Phase 1) | — |

Probe outcomes (verbatim values):

| Probe | Observation |
|---|---|
| P01 | after saving settings: `credits_per_month:string:"4"`, `max_video_seconds:string:"10"`, `shipping_fee:string:"120"`, `gst_rate_low:number:5`, `cod_enabled:boolean:false`; cart shipping then 120 (runtime coerces) |
| P02 | `shipping_fee:"abc"` → 400; `max_video_seconds:30` → 400 |
| P03 | membership checkout amount 3598; after activation `active`, credits 4, `renewal_at` +2 months; after forcing `renewal_at` 10 days in the past → still `active`, credits 4; pause → 200, `renewal_at` unchanged; admin +100 → balance 104 |
| P04 | wardrobe save 200 (1 item); `ship` 200 `{"ok":true,"eligible_count":1,"message":"Wardrobe Bag is ready for checkout."}`; orders created 0 |
| P05 | gift 201, amount 3598, status `draft`; admin sections `gifts`/`gifting` → 400 unknown; payment orders 0 |
| P06 | referral code `VISHREA-xxxxxxxx` issued; checkout with that code: subtotal 1590, total 1689 (no effect) |
| P07 | active 50 % loyalty rule; cart subtotal 4880, total 4979 (no effect) |
| P08 | catalogue total 9; with `colour_season`/`season`/`palette` params → still 9 |
| P09 | admin update of non-existent exchange id → 200 |
| P10 | 6 admin endpoints: customer 403, anonymous 401, admin 200; listing studio customer 403, admin 502 |
| P11 | foreign wearer update 404, foreign delete 200 (row intact); address update/delete → 400 `unsupported_action` |
| P12 | bootstrap admin demoted in DB, logs in → `is_admin: true` |
| P13 | anonymous image upload → 201 |
| P14 | delivery checkout without phone → 201 |
| P15 | colour review stored keys exclude `season`; admin customer row keys exclude wearer/colour data |
| P16 | store sale 200, invoice `VS/2026-27/000002` |
| P17 | dashboard revenue 3990 = DB 3990; membership revenue 3598 not included |
| P18 | unknown section 400; bad order id 400; missing order 404; bad product 404; SQLi strings 200 (safe); PUT catalogue 405; unknown API 404 |
| P19 | `Set-Cookie: vishrea_auth=<redacted>; Max-Age=1209600; Path=/; HttpOnly; SameSite=Lax` |
| P20 | paused member: credit toggle PATCH 200; checkout 400 `insufficient_credits` |

---

## 17. Defect register

Severity: **Critical** blocks release / risks money or account takeover · **High** V1 requirement missing or broken · **Medium** partial feature, compliance or usability gap · **Low** hygiene.

| ID | Sev | Req | Journey / route / API / DB | Steps to reproduce | Expected | Actual | Root cause | Business impact | Recommended fix | Regression test | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEF-01 | Critical | MB-03, MB-04, MB-05 | Membership · `/membership` · none · `memberships.renewal_at` | Activate; move `renewal_at` into the past; GET membership | Renew or lapse | Stays `active`; no charge; pause doesn't extend period | No lifecycle job; nothing reads `renewal_at` | Members keep “active” status without paying; core revenue model broken | Lifecycle pass per BD-1 | TC-MEM-006/007 | P03 | Open |
| DEF-02 | High | CR-01 | Credits · — · `finalizeMembershipPayment` · `credit_ledger` | Pay 2 months | 8 credits (4/month) or 4 each month | 4 total | One grant per payment | Members under-served vs advertised offer | Per-month allocation | TC-MEM-010 | P03 | Open |
| DEF-03 | High | MB-03 | Membership · `/api/membership` | Look for autopay | Recurring setup where supported | Upfront one-time order only | Deferred (config comment) | Manual renewals impossible today (see DEF-01) | Per BD-1 | TC-MEM-005 | code, `.env.example` | Open (decision) |
| DEF-04 | Medium | CR-05 | Credits · `adjustCredits`, membership payment | Grant +100 | Capped | 104 | No cap | Liability growth | Cap per BD-2 | TC-MEM-015 | P03 | Open (decision) |
| DEF-05 | High | WB-01 | Wardrobe Bag · none · `/api/wardrobe` · `wardrobe_items` | Look for save action on PDP/account | Save → view → redeem | No UI; `ship` no-op | Frontend never built | Core V1 membership experience missing | Build UI + redeem path | TC-MEM-017 | P04, grep | Open |
| DEF-06 | High | AD-05 | Offers/referrals · `/admin/loyalty`, `/api/referrals` | Create rule / code; check out | Discount/credit applied | No effect; no customer UI | Pricing never reads rules/codes | Promised V1 feature absent | Implement per BD-3 | TC-ADM-040, TC-CUS-062 | P06, P07 | Open (decision) |
| DEF-07 | Medium | WP-01 | Account · none · `/api/account action=wearer` | Look for wearer section | Basic CRUD UI | API only | UI not built | Feature invisible | Build UI | TC-CUS-028 | P11 | Open |
| DEF-08 | Medium | CW-05 | Account · `/account` · PUT `/api/account` | Try to edit name/phone | Edit form | Read-only page | UI not built | Customers can't manage profile | Build form | TC-CUS-027 | browser, grep | Open |
| DEF-10 | High | GF-01 | Gifting · `/gifting` · `/api/gifting` · `gifts` | Create gift | Paid or admin-handled | `draft`, no payment, no admin view | Flow incomplete | Customers believe a gift is arranged; nobody sees it | Per BD-4 | TC-CUS-061 | P05 | Open (decision) |
| DEF-11 | High | AD-04, AD-09 | Admin customers · `/admin/customers` | Open a customer | Wearers, order history, colour profile | List only | Not built | Owner can't serve members | Customer detail view | TC-ADM-030, TC-ST-008 | P15, code | Open |
| DEF-12 | Medium | ST-03, ST-05 | Skin-tone · `/skin-tone`, `/catalogue` · colour-review, catalogue | Save profile; reload on other device; filter catalogue | Reusable attribute driving recommendations | Season not stored; never read back; catalogue ignores it; live `colour_season` values `AW26`/null | API/UI gaps, free-text admin field | Weak V1 skin-tone value | Store season; show; filter; constrain values | TC-ST-004/005/007 | P08, P15, LIVE-RO | Open |
| DEF-13 | Low | AD (settings) | `POST /api/admin/ops?section=settings` · `app_settings` | Save numeric settings | JSON numbers | JSON strings | `if/else` chain falls to `text()` | Low today (runtime coerces known keys); keys outside defaults stay strings | Fix chain | TC-ADM-070 | P01 | Open |
| DEF-14 | Low | Ops | `_schema_migrations` (live) | Read table | 001–016 | 001–014; 016 DDL already present; `max_video_seconds`=30 | Manual DDL, runner not rerun | None functional (10 s hard cap) | Run migrate after backup | read-only query | LIVE-RO | Open |
| DEF-15 | Critical | SQ-03 | Auth · `api/auth.js verify-code` | Demote bootstrap admin; log in | Stays demoted | Re-promoted | Promotion on every login | Demoted/compromised mailbox regains admin; `vishrea.com` ≠ `vishreastudio.com` | Bootstrap only when no admin | TC-SEC-006 | P12 | Open |
| DEF-16 | Critical | SQ-03 | Live `profiles` | Query admins | Only staff | 4/4 admin incl. `@vishrea.test` | Testing/bootstrapping on live DB | Excess privilege | Owner review; demote | TC-SEC-019 | LIVE-RO | Open (owner) |
| DEF-17 | Critical | SQ-02, SQ-03 | `.env` | Read config | Prod settings for live DB | Dev + OTP echo + live DB + tunnel origin | Local dev pointed at live DB | If exposed: anyone signs in as any user incl. admin | Separate DBs; prod config | TC-SEC-018 | config read (masked) | Open |
| DEF-18 | Critical | SQ-02 | `start.ps1`/`start.sh` (tracked, pushed) | `git ls-files` | No secret literals | Hard-coded JWT secret; active secret same length/prefix; passes prod weak-check | Bootstrap script convenience | Token forgery for known user ids | Remove literal; rotate | TC-SEC-017 | code, masked `.env` | Open |
| DEF-19 | Critical | CW-04 | Auth · production | `NODE_ENV=production`, request code | Email sent | 503 | `RESEND_API_KEY` empty | Nobody can sign in in production | Configure Resend | TC-CUS-023 | production.test.js, `.env` | Open (config) |
| DEF-20 | High | IN-01, IN-02 | Payments | Inspect config | Live keys + webhook | `rzp_test_…`; `APP_ORIGIN` unset; webhook unverified | Pre-launch | No real revenue | Live keys, webhook, ₹1 smoke test | TC-PAY-010/014 | `.env` (masked) | Open (config) |
| DEF-21 | Medium | CW-10 | Invoice · `invoice_records` | View invoice | Seller GSTIN, name, address | `seller_gstin` empty; legal name/address null | Business data missing | Non-compliant tax invoice | Set data; print it | TC-CUS-056 | LIVE-RO, `site.config.js` | Open (owner) |
| DEF-22 | Medium | SQ-08, PI-04, AD-11 | Uploads · `public/uploads` | Deploy to ephemeral host | Files persist | Local disk only | C-01/C-04 | Lost product images/videos | Persistent storage | deploy smoke | code | Open (decision) |
| DEF-23 | Low | OPT-AI-01 | `/admin/listing` | Generate | Suggestion | 502 | No API key | Manual entry only | Add key (optional) | TC-ADM-060 | P10 | Open (optional) |
| DEF-24 | Low | CW-11 | `/orders/:id` damage claim | Raise damage | Photo option | None | UI not wired to `evidence_urls` | Weaker claims | Add upload | TC-CUS-059 | code | Open |
| DEF-25 | Low | OX-03 | `…section=exchange` | Update unknown id | 404 | 200 | No rowCount / transition check | Silent admin errors | Validate | TC-ADM-051 | P09 | Open |
| DEF-26 | Low | CW-07 | `/api/checkout` | Delivery without phone | 400 | 201 | Phone required only for pickup | Courier contact missing (API clients) | Require phone | TC-CUS-041 | P14 | Open |
| DEF-27 | Low | — | `/legal` | GET | 301 | 404 then client redirect | `pageMeta` handles only `?slug=` | SEO/status noise | Server 301 | TC-URL-010 | HTTP | Open |
| DEF-28 | Low | — | `/api/admin/{dashboard,products,orders,customers,content}` | — | Removed or used | Mounted, unused | Legacy | Maintenance surface | Unmount | TC-SEC-007 | P10, grep | Open |
| DEF-29 | Low | AD-04 | `/admin/memberships` | Try to change status | Possible | Read-only | Not wired | Owner needs DB to fix a member | Wire existing API | TC-ADM-032 | code | Open |
| DEF-30 | Low | AD-07 | Dashboard | Compare revenue | Clear revenue view | Membership revenue excluded; no date range | Scope | Understated revenue | Add both | TC-ADM-001 | P17 | Open |
| DEF-31 | Medium | MB-01 | `/membership`, `/gifting`, `/` copy | Read promises | Accurate | “Four credits every month”, “48-hour early access”, “Next refresh” | Copy ahead of implementation | Consumer-protection risk | Align copy or implement | content review | browser, code | Open |
| DEF-32 | Low | MB-05, CR-04 | `/cart` paused member | Tick credit; check out | Clear block | Toggle allowed; misleading error | Status not checked in UI/PATCH | Confusion | Gate on `active` | TC-MEM-014 | P20 | Open |
| DEF-33 | Low | Security | `/api/upload` guest | Upload anonymously | Bounded | 201, files never cleaned | Guest attachments for requests | Storage abuse | Orphan cleanup | new | P13 | Open |
| DEF-34 | Low | Security | `lib/config.js isAllowedOrigin` (dev) | Origin `*.trycloudflare.com` | Rejected unless listed | Accepted with credentials | Dev convenience | Amplifies DEF-17 | Explicit list only | TC-SEC-008 | code | Open |
| DEF-35 | Low | IN-01, IN-02 | `payment-verify`, `membership activate_paid` | Gateway 4xx on fetch; mismatched authorized amount | Reject | Treated as “unreachable” (paid on signature, reconciled later); membership captures before mismatch check | Error classification | Small reconciliation window | Classify 4xx; check before capture | TC-PAY-008 variant | code | Open |
| DEF-37 | Low | CR-06 | Premium rule | Badge “Prem.” | Excluded | Eligible | Free-text match | Rule bypass by typo | Boolean flag | TC-MEM-016 | code | Open |
| DEF-38 | Low | Content | `/admin/content` | Edit legal body / pickup settings | Editable | List only | UI not built | Developer needed for policy text | Editors | manual | code | Open |
| DEF-39 | Low | CW-01 | `/` | View editorial strips | Studio imagery | Unsplash stock | Placeholder | Brand/launch content | Replace | visual | code | Open |
| DEF-40 | Medium | CW-13, CW-07 | `/checkout`, `/gifting` | Open on phone | ≥16 px inputs, ≥44 px controls | 9 px inputs; 13 px `select` | CSS inheritance (§14) | Hard-to-read checkout; iOS zoom on focus | Fix CSS | TC-RSP-005 | browser computed styles | Open |
| DEF-41 | Low | CW-06 | `/cart` guest | Add as guest; open bag | Product thumbnail | Placeholder image | Guest line image lookup | Trust | Use product image | TC-CUS-030 | browser | Open |
| DEF-42 | Low | GF-01 | `/gifting` guest | Submit | Sign-in link | Plain text, no live region | UI | Friction | Link + `role=status` | TC-CUS-063 | browser | Open |
| DEF-43 | Medium | Compliance | `/contact` | View | Full address, email, grievance officer | Bengaluru only, no email | Business data missing (`SITE` nulls) | E-commerce rules compliance risk | Add details (BD-7) | manual | browser, `site.config.js` | Open (owner) |
| DEF-44 | Low | CW-02 | `/catalogue` | Sort select; change category after search | Readable; cleared search | 11 px/24 px select; stale search text | CSS / state | Minor | Fix | TC-RSP-002 | browser | Open |
| DEF-45 | Low | CW-13 | `/membership`, skip link | View at 1440 | CTA above fold; visible focus | CTA ~1,640 px down; low-contrast skip outline | Layout | Conversion/a11y | Adjust | TC-RSP-008 | browser | Open |
| DOC-01 | Low | — | Docs | Compare docs to code | Accurate | Multiple false claims (C-05, C-06) | Docs not maintained | Misleads owner/developer | Correct docs | review | §3.1 | Open |

(DEF-09 and DEF-36 were folded into OBS-03 and DOC-01.)

Observations (not defects): OBS-01 unused tables `pricing_rules`, `payment_locks`, `product_photos`, `product_sources`, `story_consents`. OBS-02 no FK from user-owned tables to `profiles`. OBS-03 saved addresses backend-only, create-only (not explicit in V1). OBS-04 unused `VITE_SUPABASE_ANON_KEY` in `vishrea-react/.env`. OBS-05 `GET /api/payment-config`, `GET /api/exchange`, `GET /api/gifting`, `GET /api/colour-review` have no frontend caller.

---

## 18. Evidence, limitations and blocked verification

| ID | Limitation | What is needed |
|---|---|---|
| L-01 | Real Razorpay sandbox **completion** not executed: the modal is a cross-origin iframe the automation cannot operate. Launch with test keys was verified (₹5,299). | A person completes one test-mode payment on staging (test card/UPI) for order and membership flows. |
| L-02 | Production/staging deployment not available: HTTPS, domain routing, webhook delivery, backups, `APP_ORIGIN` unverifiable. | Staging URL + Razorpay dashboard access. |
| L-03 | Email delivery not tested end to end (no `RESEND_API_KEY`). | Resend key on staging. |
| L-04 | Admin UI not visually verified in the browser. The browser run ended before the admin section, and the automation guard then refused further sign-in/sign-out. Admin behaviour is evidenced by API probes, the automated suite and code. | Owner/developer walkthrough of `/admin/*` at desktop and 390 px. |
| L-05 | Camera capture and analysis on real photos not exercised (no camera/photo in automation). | Manual test on a phone. |
| L-06 | Docker Desktop was not running; tests used a throw-away PostgreSQL 18 cluster created from the installed binaries in `%TEMP%`. | — |
| L-07 | The live DB was inspected read-only; its data are partly test data (4 admins, demo products). Requirement results were therefore established on isolated seeded data. | — |
| L-08 | The proposal does not contain frozen numeric credit/membership rules (C-03). | Signed rules document. |
| L-09 | Not a penetration test. | Optional external test before launch. |

Live database snapshot (read-only): migrations 001–014 recorded. 46 tables. `app_settings` values all JSON numbers today, with `max_video_seconds = 30`. Counts: profiles 4 (all admin), customers 4, products 9 (9 live, 1 variant each, 2 sold out), orders 3 (1 processing/paid, 1 delivered/paid, 1 expired), memberships 1 (`pending_payment`), wearers 0, addresses 0, wardrobe 0, referrals 0, gifts 0, colour reviews 0, videos 0, Instagram 1, exchanges 1, invoices 2, payment events 3, legal pages 5. Negative stock 0, one-of-one >1 unit 0, stale pending orders 0, paid-unchecked 0. RLS enabled on every table.

---

## 19. Previous audit findings — revalidation

| # | Previous finding | Reproduced? | Source files | DB / test evidence | Actual impact | Req | Resolution |
|---|---|---|---|---|---|---|---|
| 1 | Settings stored as JSON strings | **Yes** (int and money only; percent/bool correct) | `api/admin/ops.js` 438–453 | P01; live values currently numbers (no admin save since) | Low: `getSettings` coerces keys present in `SETTING_DEFAULTS` | AD | DEF-13 |
| 2 | Migrations 015/016 tracking inconsistent | **Yes** | `migrations/015…016`, `scripts/migrate.js` | Live `_schema_migrations` ends at 014; 016 columns and both indexes exist | None functional | Ops | DEF-14 |
| 3 | `max_video_seconds` DB 30 vs code 10 | **Yes (data) / not a functional defect** | `lib/settings.js customerVideoLimits` (min with hard cap 10), `api/upload.js` | live value 30; AUTO rejects >10 s | Cosmetic | AD-11 | DEF-14 |
| 4 | Wearer profiles backend-only | **Yes** | `api/account.js`, `Account.jsx` | P11; grep: no caller | Requirement PARTIAL | WP-01 | DEF-07 |
| 5 | Saved addresses not integrated | **Yes**, and the API lacks update/delete | `api/account.js` | P11 | Not explicit V1 scope | — | OBS-03 |
| 6 | Wardrobe Bag lacks customer actions | **Yes**, and `ship` is a no-op | `api/wardrobe.js` | P04 | V1 feature missing | WB-01 | DEF-05 |
| 7 | Referrals lack account UI | **Yes**, and codes are not redeemable anywhere | `api/referrals.js` | P06 | V1 feature missing | AD-05 | DEF-06 |
| 8 | Catalogue Colour Harmony filter missing | **Yes** | `api/catalogue.js`, `Catalogue.jsx` | P08 | Filter itself is not a V1 line item. Recommendation use of the attribute is (PARTIAL) | ST-05 | DEF-12 |
| 9 | Membership uses one-time order | **Yes, and more severe than reported**: 4 credits for 2 months, no renewal, no lapse | `api/membership.js`, `lib/payments.js` | P03 | Core business model broken | MB-03/04, CR-01 | DEF-01/02/03 |
| 10 | Legacy admin controllers mounted, unused | **Yes**; read-only and admin-guarded | `api/admin/*.js`, `server.js` | P10 | Hygiene | — | DEF-28 |
| 11 | Resend not configured | **Yes** | `.env` | production.test.js fails closed | Production sign-in impossible | CW-04 | DEF-19 |
| 12 | Razorpay test credentials | **Yes** (`rzp_test_…`); test-mode modal launch verified | `.env` | browser | No live revenue | IN-01 | DEF-20 |
| 13 | AI Listing Studio failure | **Yes**, config only (`OPENAI_API_KEY` empty) → clean 502 + manual entry | `api/admin/listing-studio.js`, `lib/ai.js` | P10 | Optional feature unavailable | OPT-AI-01 | DEF-23 |

Contradictions resolved: AI Listing Studio is **BLOCKED**, not PASS. Gifting is **PARTIAL** (gift membership FAIL), not PASS. Membership is **FAIL/NOT IMPLEMENTED** for lifecycle, recurring and monthly credits, not PASS. The previous “92 % ready” figure is withdrawn (no denominator). The previous claim that all routes were browser-tested is unsupported by any evidence in that document. The previous audit also missed DEF-15 to DEF-18 (security/configuration) and DEF-10/11/40/43.

---

## 20. Final acceptance verdict

### 20.1 Scores (each with its own denominator)

| # | Dimension | Score | Basis |
|---|---|---|---|
| 1 | V1 requirements compliance | **34 / 61 PASS** (13 partial, 3 fail, 5 not implemented, 6 blocked) | §15 |
| 2 | Customer journey completion | **10 / 18 stages PASS** (3 partial, 1 fail, 2 not implemented, 2 blocked) | Stages: discovery, catalogue, PDP, cart, checkout, orders/tracking, exchange, membership purchase, credit redemption, skin-tone analysis = PASS; account/profile, invoice, gifting = PARTIAL; membership lifecycle = FAIL; Wardrobe Bag, referrals = NOT IMPLEMENTED; production sign-in, real payment completion = BLOCKED |
| 3 | Admin journey completion | **11 / 17 sections PASS** (3 partial, 2 no-effect placeholders, 1 blocked) + 3 missing modules (settings UI, gifts/referrals, colour review) | §6 |
| 4 | Frontend route integrity | **23 / 24 route entries correct** (`/legal` 404 status) | §7, §10 |
| 5 | Backend API integrity | Access control correct on **100 %** of probed endpoints. 4 behaviour defects (settings types, exchange unknown id, delivery phone, address update/delete) | §8, P10 |
| 6 | Frontend–backend integration | **5 API surfaces with no customer UI** (wardrobe, referrals, account writes, colour-review read, gifting read) + 5 unused legacy admin endpoints + 1 admin API without UI (settings) | §8 OBS-05 |
| 7 | Database & data integrity | Strong (constraints, unique idempotency indexes, no negative stock). Migration tracking drift, string settings, unused tables, test data and test admin in live DB | §12, §18 |
| 8 | Direct URL & link integrity | **31 / 32 direct URLs** behave as expected; 19/19 sampled header/footer links correct | §10 |
| 9 | Authentication & authorization | Code: PASS (all probes). Configuration/data: **4 Critical findings** (DEF-15/16/17/18) | §11, §13 |
| 10 | Payment & order reliability | Orders: 20+ automated payment scenarios PASS on the mock gateway, with real sandbox completion BLOCKED. Membership payments: lifecycle FAIL | §16 |
| 11 | Security verification | 18 control areas reviewed; 2 FAIL (secrets, environment), 1 FAIL (live admin data), rest PASS; not a pen test | §13 |
| 12 | Responsive & usability | **0 overflow** across 5 widths. 1 Medium (9 px checkout/gift inputs), 1 Medium (contact compliance), several Low. Admin at mobile widths not verified | §14 |

### 20.2 Classification summary

- **Fully working V1 features:** storefront, catalogue, product detail, cart and guest merge, checkout pricing/GST/shipping, one-of-one inventory, order history, tracking, exchange request and window rules, studio pickup/₹99, product/category/inventory admin, order admin, credit ledger admin, Store Mode, dashboard (basic), CSV export, Instagram links, customer videos (≤3, ≤10 s), on-device skin-tone analysis with zero image upload, credit balance/expiry/redemption/Premium restriction, initial membership payment.
- **Partially working:** profile management (view only), wearer profiles (API only), GST invoice (seller details missing), pause/resume/cancel, membership plan copy, gifting, saved colour profile and recommendations, admin customers/memberships/exchanges, role separation (config), mobile-first checkout usability, testing coverage.
- **Broken:** membership lifecycle/renewal, monthly credit allocation, gift membership flow, admin settings type handling.
- **Missing:** recurring payment setup, maximum credit balance, Wardrobe Bag journey, offers/referrals customer application, admin skin-tone review.
- **Blocked verification:** production sign-in email, real Razorpay sandbox completion, live keys/webhook, HTTPS/deployment, DB backups, admin visual walkthrough, camera capture.
- **Out-of-scope roadmap:** WhatsApp, Google/Meta, Instagram API, advanced AI, native apps, virtual try-on, advanced analytics, Release 1.1/2.0 items.
- **Production configuration blockers:** DEF-17, DEF-18, DEF-19, DEF-20, DEF-21, DEF-22, DEF-43.
- **Critical release blockers:** DEF-01, DEF-15, DEF-16, DEF-17, DEF-18, DEF-19.

### 20.3 Verdict

## NOT APPROVED FOR V1 RELEASE

**Justification.** The requirement-level evidence shows three of the proposal's own “core business model retained in V1” items failing or missing: V1-MB-04 (FAIL), V1-CR-01 (FAIL) and V1-MB-03 (NOT IMPLEMENTED). Three more included V1 features have no working user journey: V1-WB-01, V1-AD-05 and V1-AD-09. The journey-level evidence shows the membership journey ending in an indefinitely “active” membership with no payment and no further credits (P03). Independently of features, four Critical security/configuration findings (DEF-15 to DEF-18) and the missing email provider (DEF-19) would let the wrong people administer the store, or nobody sign in at all.

The transactional foundation (orders, payments, inventory, invoices) is strong and verified. With the P0 and P1 items in `VISHREA_DEVELOPER_ACTION_REGISTER.md` completed and retested, and business decisions BD-1 to BD-7 recorded, the application is a realistic candidate for **APPROVED WITH DOCUMENTED CONDITIONS**.

---

## 21. Phase status

- **Phase 1 (audit):** complete. Deliverables written under `docs/`. No application code, data or configuration changed.
- **Phase 2 (developer review):** use `VISHREA_DEVELOPER_ACTION_REGISTER.md`, which lists, for every item, what was required, what exists, where it fails, the expected behaviour and its retest.
- **Phase 3 (remediation):** not started. Begins only after the owner approves the scope and answers BD-1 to BD-7.
