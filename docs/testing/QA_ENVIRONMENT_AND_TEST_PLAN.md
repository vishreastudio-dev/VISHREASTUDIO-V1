# QA environment and test plan

Status: **environment ready and verified; awaiting owner approval before functional, security and
load tests run.** Prepared 2026-11-09.

## 1. Isolation: what was proven (measured)

`node tests/qa/stack.mjs verify`: **17/17 PASS**.

| Check | Result |
|---|---|
| All 22 keys in the developer `.env` are explicitly overridden or blanked for QA; no sensitive live value is reused | PASS |
| The QA environment is built from scratch (OS variables only), never from `process.env` | PASS |
| Effective config: DB `127.0.0.1/vishrea_qa`, storage `local`, no Supabase URL or key, Razorpay → `127.0.0.1:3190` stand-in, Resend disabled | PASS |
| Production guard armed in QA with the live ref, and the QA config is not targeted | PASS |
| `server.js` with the live Supabase Storage URL → refused (fake key) | PASS |
| `server.js` with the live database host → refused, even with `ALLOW_REMOTE_DATABASE=true` (fake password) | PASS |
| `server.js` with the **real live `.env`** plus the guard armed → refused before connecting | PASS |
| `migrate`, `storage:setup --fix`, `media:migrate apply`, `media:rollback`, `media:orphans --delete` with the real live `.env` → all refused | PASS |

Smoke test, `node tests/qa/smoke.mjs`: **7/7 PASS**.
- The QA admin signs in with the echoed code; no email is sent.
- An upload lands in `scratch/qa/uploads`, not Supabase and not `public/uploads`.
- Bag and checkout succeed.
- The Razorpay order is created on the local stand-in.
- The order is stored in `vishrea_qa`.
- The server log shows no Resend or Supabase traffic.

The live-connected dev server on `:3000` is not used by any QA step.

## 2. Environment

| Component | Value |
|---|---|
| App under test | `server.js` on `http://127.0.0.1:3100` (one Node process, `DB_POOL_MAX=10`, as in production code) |
| Database | local PostgreSQL 18, `127.0.0.1:55432/vishrea_qa` (refuses non-local or non-QA names) |
| Data | 412 products, 953 variants, 1,000 synthetic customers `qa-user-N@qa.test`, 1 QA admin. Stock fixtures: `qa-checkout-stock` (100,000), `qa-last-unit` (1), `qa-five-left` (5 in M) |
| Payments | `tests/qa/razorpay-standin.mjs` on `:3190`, Razorpay API shape. Failure modes: `ok`, `timeout`, `error500`, `garbage` |
| Email | disabled (`RESEND_API_KEY=`); notifications only logged |
| Media | local driver, `scratch/qa/uploads` |
| Secrets | random QA-only values in `scratch/qa/secrets.json` (git-ignored) |
| Load generator | k6 v2.3.0, portable, `scratch/tools/` (checksum-verified, not installed system-wide) |
| API runner | Newman via `npx` (not added to `package.json`) |
| Machine | one laptop: i5-1235U, 12 logical CPUs, 20 GB RAM, Windows. **Generator, app and database share it**, so results describe this machine, not production |

Commands:

```powershell
node tests/qa/stack.mjs verify                  # isolation + guard proof
node tests/qa/stack.mjs up --profile=security   # functional + security runs
node tests/qa/stack.mjs up --profile=load       # load runs
node tests/qa/stack.mjs env --profile=load      # effective environment, secrets masked
node tests/qa/stack.mjs status | down
node tests/qa/smoke.mjs
```

### Profiles: kept separate; nothing is disabled globally

| | `security` | `load` |
|---|---|---|
| Rate limits | **on** | **on** |
| Client identity for limits | socket IP; `X-Forwarded-For` ignored (spoofing tested) | `TRUST_PROXY=1`: each virtual user sends its own synthetic `X-Forwarded-For`, as behind the production proxy |
| CSP, origin/CSRF checks, auth, validation | on | on |
| Sign-in | real OTP flow (code echoed locally) | pre-signed QA session tokens for synthetic users (same secret as the QA server) |

## 3. Test plan

### Phase A: API inventory

Every route is read from `server.js` and `api/**`, none invented. For each route the inventory records:
- method, path, authentication and role;
- inputs and validation;
- status codes;
- rate limits;
- tables;
- external services.

Output: `docs/testing/API_INVENTORY.md`.

### Phase B: Postman / Newman (security profile)

`postman/Vishrea_Studio_API.postman_collection.json` and
`postman/Vishrea_Studio_Development.postman_environment.json`. The environment holds `baseUrl` and
QA emails only, with no secrets; session cookies are captured at runtime.

- **Folders:**
  1. Authentication
  2. Customer
  3. Catalogue
  4. Product details
  5. Search and filters
  6. Shopping bag
  7. Checkout
  8. Razorpay (stand-in plus signed webhook)
  9. Membership
  10. Credits and rewards
  11. Referrals
  12. Gift memberships
  13. Orders
  14. Exchanges
  15. Media uploads
  16. Colour analysis
  17. Admin
  18. Security
  19. Error handling
- **Each endpoint is tested with:**
  - a valid request;
  - missing fields and wrong types;
  - invalid IDs;
  - no session (401);
  - a customer on admin routes (403);
  - a tampered token or wrong secret, and an expired token;
  - malformed JSON;
  - duplicate submissions;
  - boundary values.
- **Assertions:** status, response schema, required fields, the error envelope
  (`error`, `message`, `request_id`), response time, and no stack traces, secrets or internal
  hosts.
- **Output:** a Newman HTML and JSON report in `docs/testing/newman/`.
- **Database and external failures:** these go in Phase E, because Postman cannot stop a database.

### Phase C: security tests (security profile; Postman folder 18 plus scripted cases)

**Injection and input:**
- SQL injection in search, filters, slugs and IDs;
- stored XSS in profile, address and admin text fields;
- path traversal;
- upload type spoofing and oversized uploads.

**Access control:**
- IDOR on orders, exchanges, evidence, addresses and membership;
- one customer reading another customer's data;
- a customer calling admin routes;
- a customer trying to change their own credits, prices, approvals or payment status.

**Payments:**
- amount manipulation at checkout and verification;
- webhook signature failure, duplicate delivery and replay;
- duplicate payment-verify calls.

**Sessions and limits:**
- OTP brute force and rate-limit bypass with `X-Forwarded-For` (should fail in this profile);
- cookie flags;
- CSRF/origin checks;
- sensitive data exposure in errors and headers.

**Media:**
- invalid or expired signed media links.

Output: `docs/testing/API_SECURITY_REPORT.md`.

### Phase D: k6 load (load profile)

Scripts:
- `tests/load/k6-vishrea-load-test.js`: scenarios A–D;
- `tests/load/k6-api-stress-test.js`: scenario F and the breaking point;
- `tests/load/README.md`.

Think time is 1–5 s between steps, randomised. Each virtual user has its own synthetic IP and session.

| Scenario | Shape |
|---|---|
| A. Ramp | 10 → 50 → 100 → 250 → 500 → 750 → 1,000 VUs, gradual stages (about 1–2 min each), never a burst |
| B. Browsing mix | home 15 %, catalogue 25 %, product detail 30 % (including image fetch), search/filters 15 %, profile 5 %, bag 10 % |
| C. Checkout pressure | add to bag, change quantity, checkout (stand-in order), order status. **Contention:** many buyers on `qa-last-unit` (1) and `qa-five-left` (5), with expected sold count ≤ stock. **Duplicates:** repeated checkout and payment-verify for one order |
| D. Membership | plans and info, purchase initiation (stand-in), credit balance, reward eligibility, referral validation. Local DB only |
| E. Media | concurrent uploads of synthetic images, invalid types, oversized files, signed-link requests, all to the local driver. Real Supabase latency is **pending the development Supabase project** |
| F. Stress, spike, recovery | hold 1,000 VUs; step beyond (1,250 / 1,500 / 2,000) to find the breaking point; sudden spike 100 → 1,000 in 10 s; ramp down and confirm recovery |

**Metrics:**
- **Requests:** requests per second; p50, p90, p95 and p99 latency per endpoint group; 4xx and 5xx
  rates; failed requests; VUs actually achieved, reported if k6 cannot reach the target.
- **Server:** `/api/health` sampled every second (pool total, idle and waiting; RSS; heap; CPU);
  event-loop lag measured as the latency of that cheap endpoint; process CPU and memory from Windows.
- **Database:** `pg_stat_activity` (connections, waiting, longest transaction), lock waits and
  deadlocks (`pg_stat_database`), and `pg_stat_statements` if available.
- **Correctness:** `product_variants.stock_quantity` and holds before and after (no overselling);
  duplicate successful payments = 0.

**Targets (from your brief):**

| Metric | Target |
|---|---|
| p50 | < 200 ms |
| p95 | < 500 ms |
| p99 | < 1 s |
| 5xx and failed requests | < 1 % |
| DB connection errors | 0 |
| Crashes | 0 |
| Overselling | 0 |
| Duplicate payment processing | 0 |

**Stop conditions:** abort a stage if the error rate exceeds 20 % for 60 s, or the machine's memory
exceeds 90 %. The stage is reported as the breaking point, not hidden.

### Phase E: failure and recovery (security profile)

- PostgreSQL stopped (`pg_ctl stop` on the **test** cluster only), then restarted;
- connection exhaustion (`DB_POOL_MAX=2` run);
- slow queries (`pg_sleep` session holding locks);
- Razorpay stand-in in `timeout`, `error500` and `garbage` modes;
- storage timeouts (local driver with an unwritable directory);
- client disconnects mid-request;
- an unexpected exception path.

Expected each time: graceful errors, no stack traces, no duplicate orders or payments, no partial
membership activation, consistent stock, and recovery.

### Phase F: reports

- **API and testing reports:**
  - `docs/testing/API_INVENTORY.md`;
  - Newman reports;
  - `docs/testing/API_SECURITY_REPORT.md`.
- **Performance and capacity:**
  - `docs/testing/VISHREA_BACKEND_PERFORMANCE_REPORT.md` (the 1,000-user report);
  - `docs/testing/DATABASE_CAPACITY_ANALYSIS.md` (pool, connections, queries, indexes and locks);
  - production capacity recommendations, inside the performance report.
- **Readiness:** an updated GO/NO-GO in `docs/security/FINAL_STORAGE_PRODUCTION_READINESS.md`.

**Measured results are labelled as measured; estimates are labelled as estimates.**

## 4. Known limitations (stated up front)

1. Everything runs on one laptop. k6, Node and PostgreSQL compete for 12 logical CPUs, so the results
   are a lower bound for this machine and **not** a production capacity figure.
2. Production hosting specs and the Supabase plan and pooler limits are unknown. The production
   capacity statement will be a model based on measured per-process throughput, clearly marked as an
   estimate.
3. The local PostgreSQL has no network latency. Supabase adds about 2–20 ms per query depending on
   region and pooler; this is an estimate, and will be measured once the development project exists.
4. Real Supabase Storage latency (scenario E) needs the development Supabase project.
