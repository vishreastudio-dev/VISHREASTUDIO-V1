# Vishrea Studio

> Curated womenswear, limited-edition one-of-one silhouettes, and the **Walkin Wardrobe** membership platform ([vishreastudio.com](https://vishreastudio.com)).

[![Production Readiness](https://img.shields.io/badge/Production%20Status-READY%20(GO)-brightgreen)](docs/audits/SUPABASE_AUTH_FINAL_INDEPENDENT_VERIFICATION.md)
[![Test Suite](https://img.shields.io/badge/Tests-75%2F75%20Passing-success)](docs/maintenance/POST_CLEANUP_REGRESSION_REPORT.md)
[![Architecture](https://img.shields.io/badge/Architecture-Modular%20Monolith-blue)](docs/architecture/SUPABASE_AUTH_ARCHITECTURE.md)
[![SEO & AEO](https://img.shields.io/badge/SEO%2FAEO%2FGEO-Optimized-purple)](docs/seo/PREMIUM_PRO_SEO_AEO_GEO_REPORT.md)

---

## 1. Project Overview

Vishrea Studio is an independent fashion label and physical atelier based in Electronic City Phase 2, Bengaluru, India. The digital platform provides:
- **One-of-One Silhouettes**: A digital storefront where exclusive pieces are sold once and never restocked.
- **Walkin Wardrobe Membership**: A recurring private wardrobe tier offering monthly credits, 48-hour early drop access, complimentary batched courier delivery, and styling consultations.
- **On-Device Personal Styling**: Privacy-preserving on-device facial tone analysis matching apparel palettes to individual undertones without photo upload.
- **Owner Admin Console**: A phone-friendly operational dashboard managing products, orders, exchanges, members, store credits, and business metrics.

---

## 2. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, React Router 7, Vite 8, Tailwind CSS, Lucide Icons, MediaPipe Face Detection |
| **Backend** | Node.js (≥ 20 LTS), Express 4, Native ESM |
| **Database** | PostgreSQL 16+ via `pg` connection pooling (Supabase Session Pooler) |
| **Authentication** | Supabase Auth Email OTP + Backend HTTP-Only JWT Cookie Exchange |
| **Payments** | Razorpay (Orders, Subscriptions, Auto-refunds, Idempotent Webhooks) |
| **Storage** | Supabase Storage (S3-compatible multi-bucket driver with signed upload URLs) |
| **Email Service** | Resend (Transactional OTP codes, order confirmations, dispatch tracking) |
| **Testing** | Node.js native test runner (`node --test`), k6 Load Engine, Newman Postman Runner |
| **Code Quality** | Biome / Oxlint, Brotli Precompression (`scripts/precompress.js`) |

---

## 3. Architecture Overview

Vishrea Studio is structured as a **modular monolith** with server-side rendered OpenGraph metadata and static precompression:
1. **API Layer (`api/`)**: Domain-specific REST routers handling request validation, rate limiting, and response serialization.
2. **Business Logic Layer (`lib/`)**: Pure services handling inventory reservations, pricing calculations, credits, and memberships.
3. **Database Migrations (`migrations/`)**: 30 forward-only, transactional SQL migrations tracked in `_schema_migrations`.
4. **Client Layer (`vishrea-react/`)**: High-performance React 19 single-page application precompressed with Brotli for sub-second page loads.
5. **AI Discoverability (`llms.txt`, SSR SEO)**: Dynamic Schema.org `ClothingStore` and `Product` JSON-LD graphs with GeoCoordinates and LLM knowledge grounding.

Detailed architecture specifications: [docs/architecture/SUPABASE_AUTH_ARCHITECTURE.md](docs/architecture/SUPABASE_AUTH_ARCHITECTURE.md).

---

## 4. Repository Structure

```text
VISHREA-STUDIO/
├── api/             # REST API endpoint definitions (Express routers)
├── lib/             # Business logic: pricing, inventory, billing, auth, storage, SEO
├── migrations/      # Sequential PostgreSQL migrations (001–030)
├── public/          # Static assets served by backend SSR router
├── scripts/         # Operational, migration, load testing & maintenance CLI scripts
│   └── validation/  # Reusable integration and security audit scripts
├── test/            # Node.js native test runner suites (*.test.js)
├── tests/qa/        # Newman (Postman), k6 load scripts, end-to-end integration
├── postman/         # Postman collection & environment configuration
├── seo-rules/       # Accessibility, performance, and Schema.org standards
├── vishrea-react/   # React 19 / Vite storefront client application
│   ├── public/      # Favicons, robots.txt, llms.txt, llms-full.txt
│   └── src/         # Storefront components, pages, context, and styles
├── docs/            # Centralized documentation organized by functional domain
│   ├── architecture/
│   ├── database/
│   ├── security/
│   ├── setup/
│   ├── deployment/
│   ├── testing/
│   ├── audits/
│   ├── seo/
│   └── maintenance/
├── .env.example              # Baseline configuration template
├── .env.development.example  # Development configuration template
├── .env.production.example   # Production configuration template
├── package.json              # Backend package manifest
├── server.js                 # Express application entrypoint
├── start.ps1                 # Windows automated launcher
└── start.sh                  # Linux / VPS automated launcher
```

---

## 5. Development Prerequisites

- **Node.js**: `v20.0.0` or higher (LTS recommended)
- **NPM**: `v10.0.0` or higher
- **PostgreSQL**: Local PostgreSQL 14+ instance or remote Supabase project
- **Git**: Installed and configured

---

## 6. Installation Instructions

Clone the repository and install dependencies for both the root backend and the React frontend:

```bash
# 1. Install backend dependencies
npm install

# 2. Install storefront dependencies
cd vishrea-react && npm install && cd ..
```

---

## 7. Environment Setup

Choose between local isolated development or production configuration templates:

```bash
# For local development:
cp .env.development.example .env

# For production deployment:
cp .env.production.example .env.production
```

Key environment variables:
- `JWT_SECRET`: High-entropy 64+ hex string (`node -e "console.log(crypto.randomBytes(48).toString('hex'))"`).
- `DATABASE_URL`: PostgreSQL connection string (supports SSL and poolers).
- `SUPABASE_URL` & `SUPABASE_ANON_KEY`: Supabase project configuration for client auth.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-side service key (never exposed to frontend).
- `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`: Razorpay gateway credentials.
- `STORAGE_DRIVER`: `local` for offline development; `supabase` for cloud staging/production.

---

## 8. Development Commands

```bash
# Start backend API with nodemon live reload (http://localhost:3000)
npm run dev

# Start frontend Vite dev server (http://localhost:5173)
npm run dev:client

# Automated one-click bootstrap (Windows PowerShell)
.\start.ps1

# Automated one-click bootstrap (Linux / macOS / VPS)
./start.sh
```

---

## 9. Frontend Build Commands

```bash
# Production storefront build with Brotli precompression
npm run build

# Build client assets only
npm run build:client
```

Build outputs are generated in `vishrea-react/dist/` and precompressed to `.br` archives saving over 77% transfer bandwidth.

---

## 10. Backend Start Commands

```bash
# Run production Node.js server
npm start
```

---

## 11. Database Migration Instructions

Migrations are strictly sequential (`migrations/001_*.sql` through `migrations/030_*.sql`):

```bash
# Apply pending migrations
npm run migrate

# Seed demo catalogue data (development only; never in production)
npm run seed:demo

# Verify migration idempotency
node scripts/validation/test_migrations_idempotency.js
```

---

## 12. Testing Commands

```bash
# Execute complete test suite (75 tests, 100% pass)
npm test

# Run focused unit tests (pricing, signatures, gateway)
npm run test:unit

# Start isolated Docker PostgreSQL test database
npm run test:docker

# Stop Docker test database
npm run test:docker:stop

# Run k6 API load test
npm run loadtest
```

---

## 13. Lint Commands

```bash
# Run Oxlint / Biome static analysis across storefront code
npm run lint
```

---

## 14. SEO, AEO & GEO Validation

```bash
# Verify server-rendered SEO tags and Schema.org GeoCoordinates
node -e "import('./lib/seo.js').then(async m => console.log(await m.pageMeta({ path: '/', headers: {} })))"

# Test API endpoint discoverability and robots.txt
node scripts/validation/test_all_endpoints.js
```

Static AI discoverability files:
- `/llms.txt`: Standard LLM overview.
- `/llms-full.txt`: Full markdown knowledge base for Answer Engines.
- `/robots.txt`: AI crawler permissions for `GPTBot`, `PerplexityBot`, `ClaudeBot`.

---

## 15. Deployment Architecture

```text
[ Client Browser / AI Bot ]
             │
             ▼
   [ Cloudflare / CDN ]
   (SSL, DDoS, Edge Cache)
             │
     ┌───────┴───────┐
     ▼               ▼
[ Vercel SPA ]   [ Render / VPS ]
(Static Bundle)  (Express API / SSR Node)
                     │
             ┌───────┴───────┐
             ▼               ▼
     [ Supabase DB ]  [ Supabase S3 ]
     (PostgreSQL 16)  (Storage Buckets)
```

---

## 16. Vercel Frontend Configuration

For deploying the React SPA on Vercel:
- **Root Directory**: `vishrea-react`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**:
  - `VITE_SUPABASE_URL`: `https://<project-ref>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY`: `<anon-key>`

---

## 17. Render Backend Configuration

For deploying the Express server on Render:
- **Environment**: Node
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Environment Variables**: Configure from [.env.production.example](file:///d:/Projects/VDEV/VISHREA-STUDIO-main%20-%20Copy/.env.production.example). Ensure `TRUST_PROXY=1` is set.

---

## 18. Supabase Configuration

1. **Database**: Managed PostgreSQL with Session Pooler on port `5432`.
2. **Authentication**: Enable Email OTP provider in Supabase Dashboard.
3. **Storage Buckets**: Run bucket bootstrap script:
   ```bash
   npm run storage:setup
   ```
   Buckets configured: `product-images`, `homepage-banners`, `instagram-media`, `customer-feedback`, `exchange-evidence`, `media-archive`.

---

## 19. Razorpay TEST / LIVE Separation

- **Development/Staging**: Use `rzp_test_*` credentials. Razorpay webhook secret must match `RAZORPAY_WEBHOOK_SECRET`.
- **Production**: Use `rzp_live_*` credentials.
- **Safety Guarantee**: In-process Razorpay stand-in issues real cryptographic HMAC signatures during unit testing (`test/razorpay-signature.test.js`) without triggering live banking APIs.

---

## 20. Troubleshooting Guide

- **Port 3000 In Use**: Set `PORT=3001` in `.env`.
- **Database Connection Refused**: Verify PostgreSQL is running or verify Supabase connection string and network access.
- **JWT_SECRET Startup Error**: Production refuses weak keys. Generate a strong key with `crypto.randomBytes(48).toString('hex')`.
- **Remote Database Opt-In Warning**: In development, connecting to remote databases requires `ALLOW_REMOTE_DATABASE=true`.

---

## 21. Security Guidelines

1. **Zero Secret Leaks**: Never prefix sensitive backend variables with `VITE_`.
2. **Service-Role Key Isolation**: The Supabase service-role key bypasses RLS and must only exist in backend server environments.
3. **Audit Trail**: Administrative actions (inventory adjustments, cancellations, manual discounts) are permanently recorded in the `audit_logs` table.

---

## 22. Backup and Restore Instructions

```bash
# Database backup via pg_dump
pg_dump -Fc "$DATABASE_URL" > vishrea_backup_$(date +%F).dump

# Database restore via pg_restore
pg_restore --clean --if-exists -d "$DATABASE_URL" vishrea_backup_YYYY-MM-DD.dump
```

---

## 23. Documentation Navigation

- Master Documentation Index: [docs/README.md](docs/README.md)
- Repository Maintenance Guide: [docs/maintenance/REPOSITORY_MAINTENANCE_GUIDE.md](docs/maintenance/REPOSITORY_MAINTENANCE_GUIDE.md)
- Supabase Authentication Architecture: [docs/architecture/SUPABASE_AUTH_ARCHITECTURE.md](docs/architecture/SUPABASE_AUTH_ARCHITECTURE.md)
- Complete UI & Interaction Audit: [docs/testing/COMPLETE_UI_VISUAL_QA_REPORT.md](docs/testing/COMPLETE_UI_VISUAL_QA_REPORT.md)
- Premium Pro SEO, AEO & GEO Report: [docs/seo/PREMIUM_PRO_SEO_AEO_GEO_REPORT.md](docs/seo/PREMIUM_PRO_SEO_AEO_GEO_REPORT.md)
