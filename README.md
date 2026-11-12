# Vishrea Studio

Online store and **Vishrea's Walkin Wardrobe** membership platform for one-of-one curated womenswear (vishreastudio.com).

| | |
|---|---|
| Status | In development — **not in production** ([Project Status](docs/client/PROJECT_STATUS.md)) |
| Last updated | 11 November 2026 |
| Requirements | Website Requirements Specification v1.0 (client, confidential) — traced in [docs/client/REQUIREMENTS_TRACEABILITY_MATRIX.md](docs/client/REQUIREMENTS_TRACEABILITY_MATRIX.md) |

## 1. Business objectives

- Sell one-of-one pieces across India; every piece is sold once and never restocked.
- Grow a recurring base through the ₹1,799/month Walkin Wardrobe membership: 4 credits a month, 48-hour early access to drops, free batched shipping, a free piece every 6th consecutive month.
- Run the business with an owner and one helper from a phone-friendly admin panel where every business number is a setting.

## 2. Main features (implemented)

- Storefront: home, catalogue with colour-season filter, product pages with per-size prices, bag, checkout (delivery ₹99, free studio pickup, gift packing ₹50), orders with tracking, exchange and damage requests.
- Catalogue search: a search panel from the header icon (full screen on phones) with live category and product suggestions, keyboard navigation, recent searches kept on the device, and correction of misspelt words against the live catalogue. The results page filters by category, in-stock size, colour, occasion, price and availability, sorts by best match, price, newness or name, and keeps every filter in the URL. Details: [docs/technical/API_DOCUMENTATION.md](docs/technical/API_DOCUMENTATION.md) (`/api/catalogue`, `/api/search`).
- One-of-one inventory with race-safe stock holds and automatic refunds for late or duplicate payments.
- Razorpay payments with server-side pricing, signature and gateway verification, signed idempotent webhooks, reconciliation.
- Walkin Wardrobe billing engine: 2 months upfront with a UPI Autopay mandate, monthly debits, retries with frozen credits, pause after failed retries, recovery, one-month pause, cancellation after the lock-in.
- Credits: 4 per paid month, 60-day expiry, at most 8 held, Premium excluded; Wardrobe Bag with "Ship my bag" (free for 4+).
- 6th-month free piece, referrals (code, ₹150 welcome discount, referrer reward), gift memberships (two modes, pre-booked months).
- On-device colour analysis (photo never leaves the device).
- Admin: dashboard, products, drops with member early access, orders, store mode, exchanges, customers, memberships, credits, gifts, referrals, rewards, settings, legal pages, content, CSV exports, audit log.
- Account: wearer profiles, addresses, notification preferences, referral code, self-service account deletion.

What is partial, missing or blocked is listed in [docs/client/GAP_ANALYSIS.md](docs/client/GAP_ANALYSIS.md).

## 3. Technology stack

| Layer | Technology |
|---|---|
| Front end | React 19, React Router 7, Vite 8, plain CSS, oxlint |
| Back end | Node.js ≥ 20, Express 4 (single long-running process with background jobs) |
| Database | PostgreSQL via `pg` (Supabase-hosted for staging; any PostgreSQL works) |
| Auth | Passwordless e-mail code + HTTP-only JWT cookie (no Supabase Auth) |
| Payments | Razorpay (orders, refunds, plans, subscriptions, webhooks) |
| E-mail | Resend |
| Tests | Node built-in test runner, real PostgreSQL, local Razorpay stand-in |

Architecture: [docs/technical/TECHNICAL_ARCHITECTURE.md](docs/technical/TECHNICAL_ARCHITECTURE.md).

## 4. Repository structure

```
api/                 REST modules (one file per area); api/admin/ops.js = admin API; api/webhooks/razorpay.js
lib/                 Business logic: billing, membership, credits, payments, pricing, inventory, referrals, gifts, bag, notify, auth, settings…
migrations/          SQL migrations 001–024 (applied in order by scripts/migrate.js)
scripts/             migrate.js, seed-demo.sql, list-admins.js, webhook-selftest.js
test/                Integration and unit tests (npm test)
vishrea-react/       React SPA (src/pages, src/components, src/lib, src/content)
docs/                Documentation (index: docs/README.md): client/ (share with owner), technical/ (handover),
                     specifications/ (client's confidential documents), archive/ (superseded history)
server.js            HTTP server, API mounting, SPA/SEO rendering, background jobs
start.ps1 / start.sh Bootstrap scripts
```

## 5. Installation

Prerequisites: Node.js ≥ 20, npm, PostgreSQL 14+ (local or hosted).

```bash
npm install
cd vishrea-react && npm install && cd ..
cp .env.example .env        # then edit .env
npm run migrate             # create/upgrade the schema
npm run seed:demo           # optional demo catalogue (never in production)
npm run build               # build the storefront
npm start                   # http://localhost:3000
```

Windows/Linux bootstrap: `.\start.ps1` or `./start.sh` (creates `.env` from the example, installs, builds, migrates, starts).

## 6. Environment configuration

Configured in `.env` (git-ignored; see `.env.example`, `.env.development.example`, `.env.production.example`). Key variables:

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT`, `APP_ORIGIN`, `CORS_ORIGINS`, `TRUST_PROXY`, `FORCE_HTTPS`, `CSP_MODE` | Runtime and transport |
| `JWT_SECRET`, `SESSION_DAYS`, `OTP_PEPPER` | Sessions and sign-in codes (production refuses weak secrets) |
| `DEFAULT_ADMIN_EMAIL`, `ADMIN_ALLOWED_EMAILS` | First admin bootstrap; admin allow-list |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA_FILE`, `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS` | Database |
| `ALLOW_REMOTE_DATABASE` | Development refuses a remote database unless `true` (never set in production) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_MEMBERSHIP_PLAN_ID`, `RAZORPAY_AUTO_REFUND` | Payments |
| `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_DEV_OTP_ECHO` | E-mail; dev-only code echo |
| `UPLOADS_DIR`, `UPLOAD_ORPHAN_CLEANUP_DAYS` | Upload storage |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_MODEL` | Optional AI listing assistant |

Business values (prices, fees, days, limits) are **not** environment variables: they live in the `app_settings` table and are edited in Admin → Settings.

## 7. Database setup and migrations

- `npm run migrate` applies every `migrations/*.sql` not yet in `_schema_migrations`, one transaction per file. Migrations are forward-only and re-runnable.
- Back up before migrating a shared database. Schema reference: [docs/technical/DATABASE_SCHEMA.md](docs/technical/DATABASE_SCHEMA.md).

## 8. Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | API server with nodemon (port 3000) |
| `npm run dev:client` | Vite dev server (port 5173, proxies `/api`) |
| `npm run build` | Build the storefront into `vishrea-react/dist` |
| `npm run lint` | oxlint on the storefront |
| `npm run migrate` / `npm run seed:demo` | Schema / demo data |
| `node scripts/list-admins.js` | List admin accounts (read-only) |

## 9. Testing

```bash
npm test             # all suites (unit + integration)
npm run test:unit    # unit suites only (no database)
```

Integration suites need a disposable PostgreSQL. The harness tries, in order: `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`, `postgresql://postgres@127.0.0.1:55432/postgres` (`npm run test:docker` starts one), then `127.0.0.1:5432` (with `PGPASSWORD`). Each run creates and drops its own database; payments use a local Razorpay stand-in. Latest result (11 November 2026): **249/249 pass**, including the catalogue search suite (`test/catalogue-search.test.js`). Earlier report: [docs/technical/TEST_REPORT.md](docs/technical/TEST_REPORT.md).

## 10. Deployment

Not yet deployed. The app needs a long-running Node.js host (background jobs every 60 s), PostgreSQL, persistent `UPLOADS_DIR`, HTTPS, and a public webhook URL registered in Razorpay. Follow [docs/client/RELEASE_CHECKLIST.md](docs/client/RELEASE_CHECKLIST.md); do not deploy without the owner's approval.

## 11. External integrations

Razorpay (payments, subscriptions — Subscriptions/UPI Autopay must be enabled on the account), Resend (e-mail), optional OpenAI-compatible API. WhatsApp Business API and Google/Meta catalogue sync are not integrated. Details: [docs/technical/TECHNICAL_ARCHITECTURE.md §7](docs/technical/TECHNICAL_ARCHITECTURE.md).

## 12. Security notes

Server-side prices and payment verification, signed idempotent webhooks, race-safe stock, CSRF origin guard, CSP/HSTS, byte-level upload checks, RLS lockdown for hosted PostgreSQL, secrets only in environment variables. Open items (admin two-step verification, roles, pre-launch scan): [docs/technical/SECURITY_AUDIT.md](docs/technical/SECURITY_AUDIT.md). The client specification is confidential — keep the repository private.

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Development is pointed at a remote DATABASE_URL" at start | Use a local database, or set `ALLOW_REMOTE_DATABASE=true` for a staging database (never production) |
| Integration tests skipped ("PostgreSQL unavailable") | Start a test database (`npm run test:docker`) or set `TEST_DATABASE_URL` |
| Membership checkout returns `payments_unavailable` | Razorpay keys missing |
| Membership checkout fails at the gateway | Razorpay Subscriptions not enabled on the account |
| Sign-in code not received | `RESEND_API_KEY`/`EMAIL_FROM` not set or sender domain not verified (in development set `AUTH_DEV_OTP_ECHO=true`) |
| Storefront 503 "build not found" | Run `npm run build` or use `npm run dev:client` |
| `nodemon` crash "EBUSY … watch" | A file in the project is locked (e.g. an open PDF); run `npx nodemon --ignore docs/ server.js` |

## 14. Documentation index

See [docs/README.md](docs/README.md).
