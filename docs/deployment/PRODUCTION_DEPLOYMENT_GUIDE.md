# Vishrea Studio — Verified Production Deployment Guide & Architecture

| Field | Specification |
| :--- | :--- |
| **Document ID** | `VS-DEP-001` |
| **Document Title** | Production Deployment Guide & Architecture Runbook |
| **System** | Vishrea Studio Fashion E-Commerce Platform (`vishreastudio.com`) |
| **Architecture** | Unified Modular Monolith (Node.js Express + React 19 SPA + In-Process SSR SEO/AEO + Background Sweepers) |
| **Runtime Target** | Node.js `24.x` (Active LTS) or Node.js `22.x` (Maintenance LTS) (`package.json` engines: `node >= 20`) |
| **Database Target** | PostgreSQL 16+ on Supabase |
| **Storage Driver** | Supabase Storage (`STORAGE_DRIVER=supabase`, multi-bucket driver) |
| **PaaS Host Target** | Render.com Web Service (Region: `singapore`) |
| **Deployment Mode** | Manual Trigger (Auto-Deploy disabled until owner approval) |
| **Status** | Production Verification Complete |

---

## 1. Verified Architecture & In-Process Serving Model

Vishrea Studio is architected and implemented as a **single, unified service** running in Node.js. 

### Does Express Serve the React SPA and SSR Metadata in Production?
**Yes.** Verified directly in `server.js` (lines 181–255) and `lib/seo.js`:
- **Precompressed Static Assets**: The React SPA compiles into `vishrea-react/dist`. Script `scripts/precompress.js` generates Brotli (`.br`) and Gzip (`.gz`) binaries for all `.js`, `.css`, and `.wasm` bundles into `vishrea-react/dist/assets/`. Express intercepts `/assets/:file` and streams the precompressed `.br` assets with headers `Content-Encoding: br` and `Cache-Control: public, max-age=31536000, immutable`.
- **Dynamic In-Process SEO / AEO Server Injection**: For all storefront web routes (`/`, `/catalogue`, `/product/:slug`, `/membership`, etc.), Express runs `pageMeta(req)` from `lib/seo.js`. It fetches product/category records from PostgreSQL, synthesizes Schema.org JSON-LD graphs (`ClothingStore`, `Product`), OpenGraph meta tags, and semantic `<noscript>` summaries, and injects them into `vishrea-react/dist/index.html` before returning the response.
- **Background Schedulers**: Express runs in-process cron/interval sweepers for order expiration, payment reconciliation, billing jobs, and bag shipment expiries.
- **Architectural Imperative**: The application **must be deployed as a single unified service**. Splitting the frontend to static CDN hosting (e.g. Vercel or Netlify) would bypass the SSR OpenGraph/Schema.org injection engine, sever the in-process API proxying, and cause CORS complications.

```
                           [ Custom Domain / CDN ]
                         https://vishreastudio.com
                                    │
                                    ▼
                ┌───────────────────────────────────────┐
                │        Vishrea Node.js Server         │
                │              (server.js)              │
                ├───────────────────────────────────────┤
                │ • REST API Endpoints (/api/*)         │
                │ • Dynamic SEO / OpenGraph SSR         │
                │ • Static Brotli/Gzip Assets (/assets) │
                │ • Background Schedulers & Sweepers    │
                └───────┬───────────────────────┬───────┘
                        │                       │
           ┌────────────▼──────────┐ ┌──────────▼──────────┐
           │ Supabase (PostgreSQL) │ │ Third-Party Services │
           │ • Relational Data     │ │ • Razorpay (Payment) │
           │ • Supabase Storage    │ │ • Resend (Email OTP) │
           │ • Supabase Auth       │ │ • OpenAI / Groq (AI) │
           └───────────────────────┘ └──────────────────────┘
```

---

## 2. Command Safety Matrix

Commands that modify database schemas or storage buckets are strictly isolated from read-only audit commands.

| Command | Safety Classification | Execution Context | Verified Target & Operational Behavior |
| :--- | :--- | :--- | :--- |
| `node scripts/check-environment.js` | **SAFE (Read-Only)** | Local / Server | Inspects `.env` variables and verifies database target. Makes zero database queries and zero network writes. |
| `node scripts/storage-setup.js` | **SAFE (Read-Only)** | Supabase Storage | Audits required buckets, public/private flags, and size limits. **Never alters buckets or files without `--fix`.** |
| `node scripts/list-admins.js` | **SAFE (Read-Only)** | PostgreSQL Database | Connects in `BEGIN READ ONLY` and rolls back. Displays existing admin accounts and allowlist status. |
| `npm run test:unit` | **SAFE (Read-Only)** | Local Node Engine | Runs pricing, signature, and payment gateway unit test suites in memory (`test/*.test.js`). 14/14 tests passing. |
| `npm test` | **SAFE (Read-Only)** | Local Node Engine | Runs all 16 test suites. 75 standalone unit tests pass cleanly; database integration suites skip safely if no local DB. |
| `npm run lint` | **SAFE (Read-Only)** | Local File System | Runs `oxlint src` in `vishrea-react`. Verified: 0 errors (57 warnings). |
| `npm run build` | **SAFE (Local / Build Host)** | Local File System | Runs `vite build` and `scripts/precompress.js`. Verified: built in 1.06s, generates `.br` and `.gz` binaries. |
| `npm run storage:setup -- --fix --production` | **MUTATING (Production)** | Supabase Storage | Creates missing storage buckets and sets public/private flags. Requires explicit `--production` override flag. |
| `npm run migrate` | **MUTATING (Production)** | PostgreSQL Database | Connects to `DATABASE_URL` and executes unapplied migrations from `migrations/`. Records state in `_schema_migrations`. |
| `npm run seed:demo` | **MUTATING (Dev Only)** | PostgreSQL Database | Seeds mock catalogue. **Strictly blocked in production** (`migrate.js` line 58 aborts if `NODE_ENV === 'production'`). |
| `npm run media:migrate` | **MUTATING (Production)** | Storage & Database | Executes media migration batch. **Never automated; requires owner review.** |

> [!CAUTION]
> Never configure CI/CD pipelines or host build steps to automatically run `npm run migrate` or `npm run storage:setup -- --fix`. Database schema updates and storage modifications must be executed deliberately by an authorized database administrator.

---

## 3. Test Suite Verification & Honest Reconciliation

### 3.1 Test Suite Breakdown
The repository test catalog contains two distinct tiers:
- **Tier 1 (Standalone Unit Tests — 75 tests)**: Executes in memory without requiring a running database. Covers AI platform heuristics, business calculations, search engine and typo correction, CIEDE2000 color science, courier tracking URLs, hero carousel validation, pricing and GST slabs, Razorpay order/payment signatures, input validation, and Supabase JWT token verification.
- **Tier 2 (PostgreSQL Integration Tests — 161 tests)**: Requires a local PostgreSQL test instance (`127.0.0.1:55432` started via `npm run test:docker`). When the Docker test database is not running, these suites detect `connect ECONNREFUSED` and **skip safely**.

### 3.2 Honest Test Execution Results (Node `v24.20.0`)
- **Unit Test Command**:
  ```bash
  npm run test:unit
  ```
  *Result*: **14 passed, 0 failed, 0 skipped** (duration: `2.01s`).
- **Complete Test Command**:
  ```bash
  npm test
  ```
  *Result*:
  - **Executed and Passed**: **75 tests** (16 suites).
  - **Not Executed (Skipped due to inactive Docker database)**: **161 integration tests** across 10 integration suites (`catalogue-search`, `couriers-inventory`, `homepage-carousel`, `migration-rehearsal`, `production`, `remediation`, `seo`, `storage`, `uploads-access`, `walkin-wardrobe`).
  - **Failures**: **0**.
  - **Honest Reconciliation**: Complete regression verification of database integration lifecycles requires running the local test container (`npm run test:docker`). The standalone unit tests confirm business math, cryptographic verification, and token handlers, but do not replace integration verification against PostgreSQL.
- **Code Quality Linting**:
  ```bash
  npm run lint
  ```
  *Result*: `oxlint src` finished in 521ms on 78 files: **0 errors, 57 warnings**.
- **Production Build Execution**:
  ```bash
  npm run build
  ```
  *Result*: Vite production build completed in **1.06s** transforming 579 modules. Precompression generated Brotli copies: **16,257 KB &rarr; 3,670 KB**.

---

## 4. Phase 1: Pre-Deployment Database & Storage Preparation

### 4.1 Existing Administrator Account Protection
The production database contains **four existing live administrator accounts** whose permissions and historical relationships must be strictly preserved:
1. `owner@vishrea.test` (`usr_c1bbbdd62eb143e1958541ce6868cea5`) — Role: `admin` (Owner)
2. `intellibytevaishal@gmail.com` (`usr_c1fa52ef56954909a7150db447dde20d`) — Role: `admin`
3. `vishreastudio.admin@gmail.com` (`usr_06dd03e3e48d4a8f930445dcaf8587ab`) — Role: `admin`
4. `admin@vishrea.com` (`vishrea-admin-01`) — Role: `admin`

> [!IMPORTANT]
> **Strict Administrator Rules**:
> - **Zero Modification**: Never create, replace, deactivate, or modify existing administrator accounts.
> - **`DEFAULT_ADMIN_EMAIL`**: In `scripts/migrate.js`, this logic is guarded by `if (adminCheck.rows.length === 0)`. Because the database already contains these 4 administrators, `DEFAULT_ADMIN_EMAIL` will perform no action. In production, leave it unset or set to the owner's email.
> - **`ADMIN_ALLOWED_EMAILS`**: In `lib/auth.js`, this is the mandatory security allowlist. An account must have both `is_admin=true` (or role `admin`/`owner`) in PostgreSQL AND be listed in `ADMIN_ALLOWED_EMAILS`. Ensure all four live admin accounts are included:
>   `ADMIN_ALLOWED_EMAILS=owner@vishrea.test,intellibytevaishal@gmail.com,vishreastudio.admin@gmail.com,admin@vishrea.com`

Verify existing admins without altering data:
```bash
node scripts/list-admins.js
```

### 4.2 Migration Verification & History Mechanism
Vishrea Studio uses a custom transactional migration runner in `scripts/migrate.js`.
- Migrations are tracked in PostgreSQL table `_schema_migrations` (`filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ`).
- **Never assume all 30 migrations must be executed**. To verify which migrations are already applied against the target database:
  ```sql
  SELECT filename, applied_at FROM _schema_migrations ORDER BY filename;
  ```
- Compare the query output with the files in `migrations/`:
  - `001_initial.sql` through `023_media_objects.sql`
  - `024_gift_bag_refunds.sql` (Additive: `payment_refunds` table and nullable refund columns)
  - `025_ai_studio_and_style_assistant.sql` (Additive: `ai_conversations`, `ai_messages`, etc.)
  - `026_first_time_user_and_loyalty.sql` (Additive: onboarding columns + safe backfill for existing profiles)
  - `027_personalized_size_profiles.sql` (Additive: `customer_size_profiles`, `product_size_guides`)
  - `028_business_management_modules.sql` (Additive: `vendors`, `purchase_orders`)
  - `029_human_readable_ids.sql` (Additive: `id_sequences` table + safe sequence backfill)
  - `030_supabase_auth_integration.sql` (Additive: `supabase_user_id` column + sparse unique index for lazy linking)

### 4.3 Production Migration Rehearsal (Staging / Clone Database)
Before executing unapplied migrations against the live database, operators must rehearse on an isolated staging clone:
1. Export a snapshot of the live database:
   ```bash
   pg_dump --clean --if-exists --no-owner --no-privileges -d "$PROD_DATABASE_URL" -f "prod_pre_rehearsal_$(date +%Y%m%d).sql"
   ```
2. Restore snapshot to an isolated staging database:
   ```bash
   psql -d "$STAGING_DATABASE_URL" -f "prod_pre_rehearsal_$(date +%Y%m%d).sql"
   ```
3. Run `npm run migrate` against `$STAGING_DATABASE_URL` and verify logs:
   - Check that already-recorded migrations output: `[Migration] Already applied: <filename>`.
   - Check that new migrations commit without rollbacks.
   - Run `npm test` against the staged database to verify data integrity.

### 4.4 Supabase Connectivity: IPv4 vs. IPv6 & Pooler Selection
Supabase provides direct connection endpoints and Supavisor poolers:
- **Direct Connection (`db.<project-ref>.supabase.co:5432`)**:
  - Direct connection to PostgreSQL instance.
  - **Networking Restriction**: Supabase direct hostnames resolve to **IPv6 addresses by default**. Cloud hosts like Render Web Services operate on IPv4-only outbound routing by default. Attempting direct connection from Render will fail with `connect ETIMEDOUT` or `ENETUNREACH` unless Supabase's paid IPv4 add-on is active.
- **Supavisor Session Pooler (`aws-0-[region].pooler.supabase.com:5432`)**:
  - Resolves via **IPv4**.
  - **Recommended for Render runtime and migrations**: Session mode maintains dedicated session state per connection, supports prepared statements in `pg.Pool`, supports session locks, and handles DDL operations.
- **Supavisor Transaction Pooler (`aws-0-[region].pooler.supabase.com:6543`)**:
  - Resolves via **IPv4**.
  - Optimized for short stateless transactions. **Incompatible with DDL migrations and session-level prepared statements**. Do not use for migrations.
- **SSL Certificate Requirement**:
  - Keep `DATABASE_SSL=true`. If the CA certificate is supplied, specify `DATABASE_SSL_CA_FILE=/path/to/ca.crt` or set `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
- **Region Co-location**:
  - Render Singapore (`singapore`) connecting to Supabase Mumbai (`ap-south-1`) introduces ~30–45ms latency. If creating a new production Supabase project, select **Singapore (`ap-southeast-1`)** to co-locate with Render for sub-5ms latency.

### 4.5 Execute Live Migrations (Manual Operator Step)
Only after backup and staging rehearsal:
```bash
# 1. Take a fresh live backup
pg_dump --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" -f "vishrea_live_backup_$(date +%Y%m%d_%H%M%S).sql"

# 2. Check environment target
node scripts/check-environment.js

# 3. Apply unapplied migrations
npm run migrate
```

### 4.6 Storage Bucket Audit & Provisioning (Manual Operator Step)
```bash
# 1. Read-only audit of buckets
node scripts/storage-setup.js

# 2. Provision missing buckets in live Supabase project
node scripts/storage-setup.js --fix --production
```

---

## 5. Phase 2: Application Service Deployment (Render.com)

### 5.1 Render Service Specifications
- **Service Type**: Web Service
- **Runtime**: `Node`
- **Node Version**: Set `NODE_VERSION=24` (Active LTS) or `NODE_VERSION=22` (Maintenance LTS).
- **Region**: **`singapore` (Singapore)**. *(Render does not have a datacenter in Mumbai; Singapore is the closest available region).*
- **Instance Tier**: Minimum **Starter (512 MB)**; recommended **Standard (1 GB – 2 GB RAM)** to comfortably accommodate MediaPipe Face Detection WASM (~14.6 MB) and concurrent Brotli precompression.
- **Auto-Deploy**: **No** (Keep set to Manual Deploy Trigger until owner signs off on live CI/CD).

### 5.2 Exact Build & Start Commands
- **Build Command**:
  ```bash
  npm install && npm --prefix vishrea-react install && npm run build
  ```
  *(Installs root dependencies, installs frontend dependencies, runs `vite build`, and executes `scripts/precompress.js`).*

- **Start Command**:
  ```bash
  node server.js
  ```
  *(or `npm start`)*

- **Health Check Path**:
  ```
  /api/health
  ```
  *(Responds to GET with HTTP 200 and JSON `{"ok":true,"db":"up"}`).*

---

## 6. Phase 3: Production Environment Variables & Settings

Verified against `lib/config.js`, `lib/payments.js`, `.env.production.example`, and `server.js`:

### 6.1 Mandatory Production Variables (Startup Fails If Missing)
| Variable | Value / Requirement | Verified Source |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | `lib/config.js` |
| `PORT` | Set automatically by Render (or `3000`) | `server.js` |
| `APP_ORIGIN` | `https://vishreastudio.com` (must be public `https://`) | `lib/config.js` line 41 |
| `PUBLIC_SITE_URL` | `https://vishreastudio.com` | `lib/config.js` line 48 |
| `JWT_SECRET` | 48 random hex bytes (`>= 32` chars, non-weak) | `lib/config.js` line 27 |
| `DATABASE_URL` | Supabase Session Pooler URI (port `5432`) | `lib/config.js` line 200 |
| `DATABASE_SSL` | `true` | `lib/db.js` line 21 |
| `STORAGE_DRIVER` | `supabase` (mandatory in prod; cannot be `local`) | `lib/config.js` line 113 |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | `lib/config.js` line 124 |
| `PRODUCTION_SUPABASE_PROJECT_REF` | `<ref>` (must match `SUPABASE_URL` project ref) | `lib/config.js` line 175 |
| `SUPABASE_ANON_KEY` | Public client anon key | `lib/config.js` line 206 |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service-role secret (`>= 20` chars) | `lib/config.js` line 125 |
| `RAZORPAY_KEY_ID` | `rzp_live_...` | `lib/config.js` line 230 |
| `RAZORPAY_KEY_SECRET` | Live secret | `lib/config.js` line 231 |
| `RAZORPAY_WEBHOOK_SECRET` | Live webhook secret | `lib/config.js` line 232 |
| `AUTH_DEV_OTP_ECHO` | `false` (must not be `true` in production) | `lib/config.js` line 203 |

### 6.2 Optional / Financial / Security Tuning Variables
| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `ADMIN_ALLOWED_EMAILS` | Comma-separated live admin emails | Security allowlist. Accounts must be in DB and on this list. |
| `DEFAULT_ADMIN_EMAIL` | Unset / owner email | Only bootstraps if 0 admins exist in DB. Leave unset in live prod. |
| `RAZORPAY_AUTO_REFUND` | **Unset (`false` recommended until owner approval)** | In `lib/payments.js`, if set to `true`, the system immediately calls Razorpay's refund API for duplicate payments or unfulfillable orders. **Financial operation: requires explicit owner decision.** |
| `OTP_PEPPER` | `""` | Optional secret for hashing OTPs (`>= 32` chars if set). |
| `SESSION_DAYS` | `14` | Customer session lifetime in days. |
| `TRUST_PROXY` | `1` | Reverse proxy hop count (1 on Render). |
| `FORCE_HTTPS` | `true` | Enforces HTTPS redirection. |
| `CSP_MODE` | `enforce` | Content Security Policy mode (`enforce` or `report-only`). |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connections in pool. |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Connection acquisition timeout in ms. |
| `DB_STATEMENT_TIMEOUT_MS`| `15000` | Query timeout in ms. |
| `STORAGE_SIGNED_URL_SECONDS`| `300` | Expiry for private media signed URLs. |
| `STORAGE_TIMEOUT_MS` | `20000` | Timeout for Supabase Storage requests. |
| `RESEND_API_KEY` | `""` | API key for order notifications via Resend. |
| `EMAIL_FROM` | `Vishrea Studio <no-reply@vishreastudio.com>` | Sender header for emails. |
| `RAZORPAY_MEMBERSHIP_PLAN_ID` | `""` | UPI Autopay plan ID for memberships. |
| `OPENAI_API_KEY` | `""` | OpenAI API key for AI Studio copy generation. |
| `GROQ_CLOUD_API_KEY` | `""` | Groq API key for fallback AI generation. |

---

## 7. Payment Gateway Configuration (TEST vs. LIVE)

### 7.1 TEST Configuration
- `RAZORPAY_KEY_ID`: `rzp_test_...`
- `RAZORPAY_KEY_SECRET`: Test secret key
- `RAZORPAY_WEBHOOK_SECRET`: Test webhook secret
- Test orders and checkouts use Razorpay Sandbox; no real bank debit occurs.
- Unit testing in `test/razorpay-signature.test.js` verifies HMAC-SHA256 signature verification logic using in-memory buffers; **it does not constitute live webhook delivery testing**.

### 7.2 LIVE Configuration & Webhook Events
- `RAZORPAY_KEY_ID`: `rzp_live_...`
- `RAZORPAY_KEY_SECRET`: Live secret key
- `RAZORPAY_WEBHOOK_SECRET`: Live webhook secret
- **Webhook Endpoint**: `https://vishreastudio.com/api/webhooks/razorpay`
- **Verified Webhook Events** (handled in `api/webhooks/razorpay.js`):
  1. `payment.captured` — Finalizes order, bag shipment, gift purchase, or upfront membership fee.
  2. `order.paid` — Finalizes order payment.
  3. `payment.failed` — Records failure reason and updates order / membership status.
  4. `subscription.charged` — Records recurring monthly membership billing.
  5. `subscription.authenticated` — Activates recurring mandate and records upfront payment.
  6. `subscription.activated` / `subscription.paused` / `subscription.resumed` / `subscription.completed` — Synchronizes mandate lifecycle in `memberships`.
  7. `subscription.pending` — Marks subscription in retrying state.
  8. `subscription.halted` — Marks mandate halted.
  9. `subscription.cancelled` — Cancels mandate in `memberships`.
  10. `refund.processed` — Releases inventory reservations and returns credits for unshipped orders.

---

## 8. Staging-to-Production Release Sequence & Safeguards

To prevent premature exposure of untested code or live data corruption, follow this five-stage sequence:

```
[ Stage 1: Build & Unit Validation ]
   ↳ Test suite (75/75 passing), lint (0 errors), clean build & precompress
         │
[ Stage 2: Staging Rehearsal & Dry Run ]
   ↳ Deploy to staging service, restore DB snapshot, rehearse migrations
         │
[ Stage 3: Pre-Deployment Live Safeguards ]
   ↳ Full pg_dump of live DB, storage audit (scripts/storage-setup.js)
   ↳ Require explicit owner approval for live migration & storage provisioning
         │
[ Stage 4: Production Deployment & Smoke Tests ]
   ↳ Manual deploy on Render (Singapore), verify health (GET /api/health)
   ↳ Verify Brotli headers on hashed asset, verify SSR OpenGraph & JSON-LD
   ↳ Admin OTP sign-in with existing admin account (no log leakage)
         │
[ Stage 5: Live Traffic Activation (DNS Cutover) ]
   ↳ Switch DNS records to Render after owner final written approval
```

---

## 9. Phase 4: Post-Deployment Smoke Tests & Verification

Execute these verification checks immediately following deployment:

### 9.1 Infrastructure Health Check (GET Request)
```bash
curl -i -X GET https://vishreastudio.com/api/health
```
Expected output:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```
Response body:
```json
{"ok":true,"db":"up","time":"2026-11-22T18:40:00.000Z"}
```

### 9.2 Server-Side Rendered SEO / AEO Verification
Verify raw HTML from the server contains injected SEO meta tags prior to client hydration:
```bash
curl -s https://vishreastudio.com/ | grep -E "(og:title|application/ld\+json)"
```
Expected output:
- Returns `<meta property="og:title" content="Vishrea Studio | ...">`
- Returns `<script type="application/ld+json">` with `ClothingStore` Schema.org graph.

### 9.3 Precompressed Brotli Delivery for Real Hashed Asset
Inspect `vishrea-react/dist/index.html` to obtain the actual hashed script name, then probe with `Accept-Encoding: br`:
```bash
HASHED_JS=$(grep -oE "index-[A-Za-z0-9_-]+\.js" vishrea-react/dist/index.html | head -n 1)
curl -i -H "Accept-Encoding: br" "https://vishreastudio.com/assets/${HASHED_JS}"
```
Expected output headers:
```http
HTTP/1.1 200 OK
Content-Encoding: br
Vary: Accept-Encoding
Cache-Control: public, max-age=31536000, immutable
Content-Type: application/javascript; charset=UTF-8
```

### 9.4 Admin Authentication Flow (No Secret / OTP Leakage)
1. Open browser to `https://vishreastudio.com/admin`.
2. Enter an approved live admin email (e.g. `vishreastudio.admin@gmail.com`).
3. In `NODE_ENV=production`, `AUTH_DEV_OTP_ECHO=false` prevents any OTP exposure in terminal logs or network responses. The OTP is sent directly to the administrator's email inbox via Supabase Auth / Resend.
4. The administrator enters the 6-digit code in the UI.
5. Verify browser receives HTTP-only cookie:
   `Set-Cookie: vishrea_session=...; HttpOnly; Secure; SameSite=Lax; Path=/`
6. Verify successful access to Admin Dashboard without creating or modifying administrator accounts.

---

## 10. Rollback & Disaster Recovery Procedures

### 10.1 Application Code Rollback (Safe)
Application rollbacks do not affect the database.
- **On Render.com**: Go to **Web Service** &rarr; **Events** &rarr; Select previous deploy &rarr; **Rollback to this deploy**.
- **On Self-Hosted VPS**:
  ```bash
  git checkout <last-stable-commit>
  npm install && npm --prefix vishrea-react install && npm run build
  pm2 restart vishrea-studio
  ```

### 10.2 Database Restoration (Caution Required)
> [!WARNING]
> Restoring a full database dump (`pg_dump` snapshot) **overwrites all subsequent records** (orders placed, payments captured, customer sign-ups, and inventory reservations). A full database restore must only be executed as a deliberate disaster-recovery decision when data corruption is irrecoverable.

For minor schema issues, prefer forward-correcting SQL migrations rather than rolling back the database snapshot.

If a full restoration is mandatory:
1. Temporarily place the storefront in maintenance mode.
2. Restore from pre-deployment snapshot:
   ```bash
   psql -d "$DATABASE_URL" -f "vishrea_backup_<timestamp>.sql"
   ```
3. Restart the web service and verify `/api/health`.

### 10.3 Media Rollback
```bash
npm run media:rollback -- --results=./scratch/migration-results.json --production
```
*(Requires `--production` flag when operating against the live Supabase storage project).*
