# VISHREA STUDIO — Repository Maintenance Guide

**Audience:** Core Engineers, Technical Leads, and DevOps Maintainers  
**Version:** 1.0.0 (Post-Cleanup Standard)  
**Last Updated:** November 22, 2026  

---

## 1. Architectural Philosophy & Structure

VISHREA STUDIO is architected as a **modular monolith** with a dedicated React SPA storefront. To maintain repository cleanliness and system stability, all developers must adhere to the standardized directory responsibilities outlined below.

```text
VISHREA-STUDIO/
├── api/             # REST API endpoint definitions (Express routers)
├── lib/             # Monolithic business logic modules & database wrappers
├── migrations/      # Sequential, forward-only PostgreSQL migrations (001–999)
├── public/          # Static assets served by backend SSR router
├── scripts/         # Operational, migration, load testing & maintenance CLI scripts
│   └── validation/  # Reusable integration and security audit scripts
├── test/            # Node.js native test runner suites (*.test.js)
├── tests/qa/        # Newman (Postman), k6 load scripts, end-to-end integration
├── postman/         # Postman collection & environment configuration
├── seo-rules/       # Accessibility, performance, and Schema.org standards
├── vishrea-react/   # React 19 / Vite storefront client application
└── docs/            # Centralized documentation organized by functional domain
```

---

## 2. Code Placement Standards

### A. Backend Business Logic (`lib/`)
- Place domain logic, database queries, external API integrations, and validation in `lib/`.
- Every module should export focused, testable pure functions or clear service objects (e.g. `lib/pricing.js`, `lib/billing.js`, `lib/supabase.js`).
- Never write direct SQL queries inside route controllers; delegate database interaction to `lib/` modules or `lib/db.js`.

### B. REST API Route Controllers (`api/`)
- Place HTTP request parsing, rate limiting, and response serialization in `api/`.
- Administrative endpoints belong in `api/admin/`.
- External webhooks belong in `api/webhooks/`.
- Handlers must be wrapped in `h(async (req, res) => { ... })` from `lib/http.js` for centralized error propagation.

### C. Frontend Code (`vishrea-react/src/`)
- Storefront components belong in `src/components/`.
- Page views belong in `src/pages/`.
- Shared client state (auth, bag, cart) belongs in `src/context/StoreContext.jsx`.
- Client utilities, schemas, and API clients belong in `src/lib/`.
- Never place backend Node.js packages into `vishrea-react/package.json`, and never place frontend-only packages in the root `package.json`.

---

## 3. Database Migration Standards (`migrations/`)

1. **Sequential Naming**: Name every new migration with a 3-digit zero-padded prefix followed by a snake_case description:
   ```
   migrations/031_add_sample_feature.sql
   ```
2. **Forward-Only & Idempotent**: Write idempotent SQL using `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, or safe check constraints:
   ```sql
   ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url text;
   ```
3. **Execution**: Always execute migrations via `npm run migrate`. The migration runner tracks applied files in `_schema_migrations` inside a dedicated transaction per file.
4. **Never Modify Past Migrations**: Migrations that have already been applied to staging or production databases (`001` to `030`) must never be edited. Any correction must be authored as a new migration file.

---

## 4. Testing Standards (`test/` vs. `tests/qa/`)

| Test Type | Location | Execution Command | Tooling |
| :--- | :--- | :--- | :--- |
| **Unit & Integration** | `test/*.test.js` | `npm test` | Node.js built-in test runner (`node --test`) |
| **Focused Unit** | `test/pricing.test.js`, etc. | `npm run test:unit` | Node.js built-in test runner |
| **API Load Testing** | `tests/qa/k6/shop.js` | `npm run loadtest` | k6 Load Engine |
| **Postman API Tests** | `tests/qa/postman/` | `node tests/qa/run-newman.mjs` | Newman CLI |
| **Validation Utilities**| `scripts/validation/` | `node scripts/validation/<script>.js` | Native Node ESM scripts |

- All new backend logic must be accompanied by unit tests in `test/`.
- Do not check in mock data inside production modules; place test fixtures in `test/helpers.js` or dedicated test mocks.

---

## 5. Documentation Standards (`docs/`)

Never place loose Markdown reports in the root directory. Store all documentation in the appropriate `docs/` subdirectory:

- `docs/architecture/` — System architecture, module design, API optimization.
- `docs/database/` — Schema documentation, inventory logic, migration plans.
- `docs/security/` — Threat modeling, auth security audits, secret policies.
- `docs/setup/` — Developer onboarding, Supabase setup, local database configuration.
- `docs/deployment/` — Vercel/Render guides, production runbooks, go-live checklists.
- `docs/testing/` — QA reports, visual regression findings, responsive matrices.
- `docs/audits/` — Formal implementation audits, third-party verifications.
- `docs/seo/` — Pro SEO, AEO, and GEO verification reports.
- `docs/maintenance/` — Repository maintenance guides, changelogs, cleanup logs.

Whenever a new document is added, update the master index in [docs/README.md](file:///d:/Projects/VDEV/VISHREA-STUDIO-main%20-%20Copy/docs/README.md).

---

## 6. Environment and Secret Management

1. **Strict Git Exclusion**: All real credential files (`.env`, `.env.local`, `.env.production`, `*.env`) must remain in `.gitignore`.
2. **Template Synchronization**: When adding a new environment variable:
   - Add it with documentation and placeholders to `.env.example`.
   - Add it to `.env.development.example` (with dev defaults).
   - Add it to `.env.production.example` (with production instructions).
3. **Frontend Isolation**:
   - The React storefront must never receive service-role credentials, database connection strings, or SMTP passwords.
   - Only public client keys (such as `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`) may be exposed to the client.

---

## 7. Git Hygiene & Commit Discipline

- **Run Pre-Commit Checks**: Before staging files, ensure all tests and linters pass:
  ```bash
  npm test
  npm run lint
  npm run build
  ```
- **Never Force Push**: Never use `git push --force` on `main`.
- **Never Rewrite History**: Avoid rebasing shared branches or deleting historical migration commits.
