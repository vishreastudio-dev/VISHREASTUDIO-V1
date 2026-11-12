# Vishrea Studio — final go-live checklist

Date: 2026-11-11. Prepared on the isolated QA stack only (API `127.0.0.1:3100`, Razorpay stand-in `:3190`,
PostgreSQL `127.0.0.1:55432/vishrea_qa`). Production, live Razorpay charges, Resend and the live Supabase project
were not touched. Nothing was committed, pushed, deployed or deleted.

Browser UI/UX evidence is in `docs/production/UI_UX_AUDIT.md`. The release decision is in
`docs/production/FINAL_APPLICATION_AUDIT.md`.

## Verdict: CONDITIONAL GO

11 November update: local QA no longer opens hosted Razorpay for membership, product, gift, or Wardrobe Bag checkout. That is stand-in evidence only. Live Razorpay, Resend, legal details, backup, and release approval are still required. The membership on sale is still 2 months plus UPI Autopay. A no-autopay 6-month prepay is an owner decision and was not applied.

11 November Razorpay **Test Mode** rehearsal (details: `docs/testing/RAZORPAY_SANDBOX_REHEARSAL.md`). Run against the real Razorpay TEST API with an isolated local database, `vishrea_sandbox`; no live keys and no stand-in.
- **Evidenced:** genuine TEST payments completed for product, membership (₹3,598 + ₹1,799 mandate), gift and Wardrobe Bag shipping. Backend signature verification passed, the correct records updated, and the entitlements activated.
- Failure, cancel, retry, duplicate, concurrent, replay and other-customer attempts were all handled with no duplicate order, credit, gift code or stock movement.
- The webhook handler passed 45 signed local fixture cases. These are not Razorpay delivery.
- **Not yet evidenced:** real webhook delivery (no webhook was registered; the owner chose to do this on the HTTPS domain), real UPI Autopay and scheduled debits (not possible in Test Mode), and a genuine dashboard refund.
- `npm test` 207/207, lint 0 errors, build passed.

11 November pre-production remediation (details: `docs/testing/PRE_PRODUCTION_REMEDIATION_REPORT.md`). Not committed or deployed.
- **Fixed, with regression tests** (`test/pre-production-remediation.test.js`, 19 tests):
  - gift double purchase (browser and server);
  - `refund.processed` for gift purchases and bag shipping fees (new additive migration `024_gift_bag_refunds.sql`);
  - membership payment ↔ subscription check through the Razorpay invoice;
  - `paid_through` after cancellation;
  - audit of invalid gift and bag signatures;
  - mandate and bag copy, and bag form styling.
- `npm test` 226/226, lint 0 errors, build passed.
- **Pending owner/accountant decisions:**
  - D1: GST invoices for gift purchases and the ₹99 bag fee (none are issued today).
  - D2: a gift refunded after redemption keeps the membership and is flagged.
  - D3: bag fee refund policy.
  - D4: Autopay wording, or limit mandates to UPI.
- **Not yet done:**
  - Apply migration 024 on the QA and production databases before deploying this code. The sandbox is done.
  - Complete one genuine TEST membership checkout through the new invoice/subscription check. Still open on 11 November, 16:35 IST: Razorpay has no payment for `sub_TyozKnP9v4rOPX`.

11 November post-remediation validation (details: `docs/testing/PRE_PRODUCTION_REMEDIATION_REPORT.md` §7). Sandbox only; not committed or deployed.
- **Sandbox database:** backed up, and the restore was verified. Migration 024 was applied to `vishrea_sandbox` only and is idempotent. Only the sandbox app was restarted.
- **Browser, verified:**
  - gift success panel;
  - "Buy another gift" clears the form and the next purchase uses a new submission key;
  - repeated clicks create one gift or shipment;
  - failed TEST payment, then a successful retry;
  - bag form styling on desktop;
  - gift form at phone width.
- **Bag form on phones:** at 400 px the form overflowed. This was caused by the remediation's `checkout-form` class. It was fixed with scoped CSS and re-checked on phone and desktop.
- **Genuine TEST payments:** bag shipping fee, and a gift (failed attempt, then paid on retry).
- **Genuine TEST refunds:** both were full refunds issued through the Razorpay TEST API, not the Dashboard. Each was handled once and correctly:
  - the gift refund revoked the unredeemed code;
  - the bag refund changed only the fee.

  Duplicate and redelivered events changed nothing, and no unrelated record changed.
- **Refund delivery was local:** `refund.processed` was a locally signed post built from the genuine refund entities. It is **not** Razorpay delivery.
- **Refunds shown on screen (§7.6):** refunds now appear in the customer gift list, the admin gift list and detail (badge, refunded amount and time; no reissue button), and the bag CSV. Checked in the browser on desktop and at 400 px (screenshots 11–15). Admin modals at phone width also had text cut off by 9 px; this existing issue was fixed with CSS.
- **Membership for `sbx-user-3` (§7.7):** checked read-only at 16:01, 16:20 and 16:35 IST after the owner reported the authorisation complete. Each time there was **no payment**:
  - subscription `sub_TyozKnP9v4rOPX` still `created`, with 0 authorisation attempts;
  - invoice `inv_TyozLSCftm3XVd` `issued`, with no payment;
  - membership `pending_payment` with 0 credits.

  The checkout window still showed an unsubmitted EMandate form. Monthly ₹1,799 is correct, and there are no duplicates or unrelated changes. Nothing was activated or edited by hand.
- **Not yet evidenced:**
  - genuine TEST membership activation through the new invoice check (the mandate authorisation has not reached Razorpay);
  - real Razorpay webhook delivery, including `refund.processed`;
  - a Dashboard-initiated refund.
- `npm test` 226/226, lint 0 errors (30 existing warnings), build passed (re-run after the display fixes).

Launch still depends on the owner actions below. No new code defect from the 2026-11-11 browser walkthrough
is a launch blocker. Local development isolation was rechecked the same day and is **armed and local**
(`node scripts/check-environment.js` → RESULT OK). The earlier note that the developer `.env` still pointed
at production is out of date.

## Status buckets (2026-11-11 browser pass)

### 1. Verified and complete

- Isolated QA health: HTTP 200, `db: up` (2026-11-11, `GET /api/health` on port 3100).
- QA API process is `server.js` started by `tests/qa/stack.mjs` with `qaEnv()` only (local Postgres `vishrea_qa`, local storage, empty Resend key, Razorpay API base `127.0.0.1:3190`, guard armed). Stand-in process: `tests/qa/razorpay-standin.mjs 3190`.
- Developer `.env` (names and targets only, no secrets printed): `NODE_ENV=development`, database host `127.0.0.1`, storage driver local, Resend disabled, Razorpay host `api.razorpay.com` with test keys, `PRODUCTION_SUPABASE_PROJECT_REF` set, guard armed, `check-environment.js` RESULT OK.
- Prior regression evidence in §1 below, plus the session result **206/206** (SEO, product FAQ, sign-out) reported before this browser pass. This pass changed no application code, so that suite was not rerun.
- Browser journeys in `UI_UX_AUDIT.md`: home, catalogue, category, product, search, guest bag, OTP sign-in, account, membership, checkout up to the hosted payment sheet, orders, contact, policies linked from contact, admin gate, QA admin console, 390×844 layout.
- Production `robots.txt` behaviour is covered by `test/production.test.js` (private paths disallowed, the whole site is not). On this QA server, `robots.txt` is `Disallow: /` because `NODE_ENV` is not production (`server.js`).

### 2. Fixed and retested

No application code was changed in this browser pass. Earlier cycle fixes remain those in the table under §1 (null-byte 500 → 400).

### 3. Owner action required

Items 1–6 in §3 below: production secrets, live Razorpay, Resend SPF/DKIM, grievance officer, backup, release approval. Also DNS, HTTPS/`TRUST_PROXY`/`FORCE_HTTPS`, and Supabase storage on the production host (deployment §4).

### 4. Launch blockers

The owner actions in §3. None of them are code defects that can be closed from this machine.

### 5. Post-launch improvements

- Mobile header hides Search (`hide-sm`); the menu has Shop but no Search link. Desktop Search is present. Categories still work on a phone.
- Search result pages are `noindex` and keep the title “Shop All Pieces” while the H1 is the query. Safe, not unique.
- Homepage had two Unsplash URLs with `naturalWidth` 0 on first inspection (third-party). Product images served from `/assets/` loaded.
- Occasion and price-band landing pages, reviews, and a public trust page: `COMPETITOR_UX_RESEARCH.md` §(b). Do not add ratings until real reviews exist.
- Optional owner decisions already listed under §3 (orphan uploads, REVIEW media, git history, homepage slides).

A browser checkout on the QA stack created **awaiting-payment** order `#015471BD` (Premium Silk Column Dress, Small, studio pickup, ₹5,200) for `qa-user-1@qa.test`. The payment sheet was Razorpay’s hosted page (`checkout.razorpay.com` / `api.razorpay.com`). No card was entered and no capture was completed. The QA stand-in covers the server Orders API; the browser widget is still Razorpay’s public script, which is what production uses.

## Earlier evidence (unchanged)

The application is release-ready on the tests below, and no release-blocking code defect remains.
Launch depends on the owner actions in §3; none of them can be done from this machine.

## 1. Tests actually run (2026-11-09 to 2026-11-11)

| Check | Result | Evidence |
|---|---|---|
| Automated regression `npm test` | **201 / 201** pass | 2026-11-11 09:10 IST |
| Functional API (Newman, 312 requests) | **1,873 / 1,873** assertions | `docs/testing/QA_FUNCTIONAL_TEST_REPORT.md` |
| Security API (Newman, 74 requests) | **437 / 437** assertions | `docs/testing/QA_SECURITY_TEST_REPORT.md` |
| Failure and recovery | **18 / 18** | `docs/testing/QA_FAILURE_RECOVERY_REPORT.md` |
| Final smoke (health, admin sign-in, upload, bag, checkout, local stand-in order, no Resend or Supabase traffic) | **7 / 7** | `tests/qa/smoke.mjs` |
| Production build + precompress | pass | `npm run build`, 15.5 MB → 3.5 MB brotli |
| Lint | 0 errors (existing warnings only) | `npm run lint` |
| Secret markers in the frontend build (`service_role`, key-secret names, `rzp_live_`) | **0** | scan of `vishrea-react/dist` |
| `.env` files tracked in git | **0** | `git ls-files` |

### Load (k6 v2.3.0, `load` profile, rate limits on, think time 1–3 s)

Each virtual user mixes browsing, search, account, bag add and remove, and about 1 in 8 iterations runs a
full checkout. That checkout creates a stand-in Razorpay payment, verifies the signature, then repeats the
verify.

| VUs | Duration | Requests | Throughput | Failed | p50 | p95 | p99 | Checkout p95 | DB pool peak / waiting | Paid orders = invoices = stock drop | Duplicate payments |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|
| 10 | 1 min | 445 | 4.5 req/s | 0 % | 20 ms | 65 ms | 114 ms | 88 ms | 10 / 0 | 14 = 14 = 13 ¹ | 0 |
| 50 | 2 min | 3,955 | 25.2 req/s | 0 % | 15 ms | 36 ms | 54 ms | 56 ms | 10 / 0 | 105 = 105 = 105 | 0 |
| 100 | 3 min | 11,230 | 51.4 req/s | 0 % | 12 ms | 31 ms | 43 ms | 47 ms | 10 / 0 | 269 = 269 = 269 | 0 |

¹ An unrelated smoke-test order from before the run expired during it and released one unit; the order
records match.

Every repeat payment verification was idempotent: 269 of 269 at 100 VUs, with no duplicate charge and no
negative stock. Peak server memory was 202 MB. No bottleneck appeared, so 500 and 1,000 VUs were not run.
These figures come from one laptop running the app, PostgreSQL and k6 together. They show behaviour, not a
production capacity number. Raw files are in `scratch/qa/raw/k6-*`.

### Defects found and fixed in this release cycle

| Severity | Defect | Fix | Verified by |
|---|---|---|---|
| High | A null byte in any text field returned HTTP 500 | `lib/validate.js` `text()` now returns 400 `invalid_<field>` | unit test, Newman, recovery run, 201/201 |
| — | QA harness gaps: stand-in had no plans API; some test expectations were wrong | test tooling only | re-runs above |

No open critical or high defect.

### Business-critical workflows covered

Catalogue and inventory (including last unit and sold-out sizes), membership purchase and credits,
referral and reward eligibility, gift memberships, Razorpay checkout with signature check, webhook
signature and duplicate delivery, orders, exchanges, admin-only routes, and private customer evidence
(signed links only, never under `/uploads`). They are covered by the 201 automated tests and the Newman
folders 06–17 and 18. At load, checkout, payment and invoices were also checked.

## 2. Security audit (code and configuration, read-only)

| Area | Status |
|---|---|
| JWT | HS256 only; production refuses a weak or known `JWT_SECRET`. Role and revocation are read from the DB per request. Expired, wrong-secret and `alg=none` tokens are rejected (tested) |
| OTP | hashed with `OTP_PEPPER`; attempts counted before compare; single use; 30 s resend; 5 per 15 min per email, 20 per IP; code echo refused in production |
| Session cookie | `HttpOnly`, `SameSite=Lax`, `Secure` in production |
| CORS and CSRF | allow-list only; cookie writes need same-origin `Origin`/`Referer`; a foreign preflight receives no allow-origin header |
| Rate limits | global 600 per minute per IP, plus per-user write limits; left on for every test |
| Uploads | type detected from file bytes; dimension and size limits; random names; customers limited to private evidence; orphan `/uploads` files return 404 |
| Payments | client totals ignored; checkout signature HMAC; webhook HMAC over the raw body; idempotent verify and webhook |
| Errors and headers | generic 500 in production with no stack trace; API `default-src 'none'`; `nosniff`; `X-Frame-Options: DENY`; HSTS in production |
| Secrets | none in the build or in git; the service-role key is backend only |

## 3. Production blockers — exact owner actions

1. **Production host secrets** (host secret store, never git or `VITE_*`):
   - `NODE_ENV=production`
   - `APP_ORIGIN` and `PUBLIC_SITE_URL` set to the https domain
   - `CORS_ORIGINS` limited to that domain; **remove the trycloudflare tunnel**
   - `DATABASE_URL` set to the production database, with `DATABASE_SSL=true`
   - new random `JWT_SECRET` and `OTP_PEPPER`, at least 48 bytes each
   - `STORAGE_DRIVER=supabase`, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the live project
   - `PRODUCTION_SUPABASE_PROJECT_REF` set to the live ref
   - `ALLOW_REMOTE_DATABASE` and `AUTH_DEV_OTP_ECHO` **unset**
   - `TRUST_PROXY=1` when behind one proxy, and `FORCE_HTTPS=true`
2. **Razorpay live mode:** live `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Add a webhook to `https://<domain>/api/webhooks/razorpay` with a new `RAZORPAY_WEBHOOK_SECRET`, subscribed to:
   - `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`
   - `subscription.authenticated`, `activated`, `charged`, `pending`, `halted`, `paused`, `resumed`, `cancelled`, `completed`

   Enable subscriptions on the live account.

   Before switching to live keys, register the same webhook in **Test Mode** against the HTTPS domain and confirm 2xx deliveries and `payment_events` rows. This has not been done yet (`docs/testing/RAZORPAY_SANDBOX_REHEARSAL.md` §8.1, §14). Also set `RAZORPAY_MEMBERSHIP_PLAN_ID` to a ₹1,799 monthly plan created in the dashboard; when it is empty, the app creates its own plan.
3. **Resend:** verify the sender domain (SPF and DKIM) and set `RESEND_API_KEY` and `EMAIL_FROM` on that domain.
4. **Legal details:** enter the seller's legal details and the **grievance officer** (name, email, phone) in Admin → Settings, and review the policy pages. The Contact page hides them until they are set.
5. **Database backup:** confirm the Supabase plan's daily or point-in-time backups. Take a manual `pg_dump` immediately before deploy.
6. **Approve the release commit:** the working tree has about 124 uncommitted changes, plus the staged untracking of 7 `public/uploads` files. Approve the commit and push; nothing has been committed yet.
7. **Security sign-off is conditional.** See `docs/security/FINAL_SECURITY_HARDENING_REPORT.md`. QA controls passed earlier (Newman security 437/437, `npm audit --omit=dev` 0 on 2026-11-11). Admin MFA was not added. Confirm HTTPS, webhook, Resend, backups, and secret rotation on the host before launch.
8. **Local isolation — done on this machine (2026-11-11).** `node scripts/check-environment.js` reported database host `127.0.0.1` (not the production project), storage on local disk, Resend disabled, guard armed, RESULT OK. Razorpay in the developer `.env` is test keys against `api.razorpay.com`, not live keys. Keep `PRODUCTION_SUPABASE_PROJECT_REF` set. Do not point `DATABASE_URL` or `SUPABASE_URL` at the live project; startup will refuse that combination. QA never loads `.env` (`tests/qa/qa-env.mjs`).

These are your decisions and **do not block launch**:
- delete the 7 backed-up orphan files (backup checksum `08aa9a957df8`; command in `FINAL_STORAGE_PRODUCTION_READINESS.md` §15.4);
- keep or delete the 6 REVIEW media files (5 customer portraits, 1 unused video);
- purge git history of the 7 committed uploads, or accept that exposure in a private repository;
- re-activate the 2 homepage slides (optionally with the recommended WebP exports).

## 4. Deployment steps (after §3)

1. On the host, with production variables loaded: `npm ci`, then `npm run build`.
2. `npm run migrate`: applies any pending migrations. `023_media_objects` was applied on 2026-11-09. **`024_gift_bag_refunds` is new and must be applied before the new code starts** (so far applied only to the local `vishrea_sandbox`). All migrations are additive.
3. `npm run storage:setup`: read-only. All 6 buckets should report `ok`.
4. `npm start`. Startup refuses a weak secret, a non-Supabase storage driver, a missing Razorpay secret, or a project reference mismatch.
5. Point DNS or the proxy at the new release.

## 5. Rollback

- **Application:** redeploy the previous build. Migrations 022 and 023 are additive, so older code still runs.
- **Media:** `npm run media:rollback -- --results=scratch/media-migration/results-2026-11-09T07-56-47-574Z.json --production`. The local originals are intact.
- **Data:** restore the pre-deploy `pg_dump` or Supabase point-in-time backup (owner decision).
- **Payments:** disable the webhook in the Razorpay dashboard if the app is offline for long. Razorpay retries events, and processing is idempotent.

## 6. Post-launch verification (first hour)

1. `GET /api/health` returns 200 with `db: up`. In production, pool figures are shown to admins only.
2. Check response headers: HSTS, CSP, `nosniff`, and no `X-Powered-By`.
3. Sign in with the owner's email. The code must arrive from the verified domain.
4. Catalogue and product images load from the Supabase public URL. A legacy `/uploads/...` path returns 404.
5. As admin, upload one product image. Its reference must be a Supabase URL.
6. Make one real low-value order and refund it (owner). Confirm it shows **paid**, has an invoice, stock decreased, and the Razorpay dashboard shows the webhook delivered with 2xx.
7. In admin, check the audit log and the notification log for the actions above.
8. Watch server logs for `razorpay.api_error`, `storage.*` and `internal_error` for 24 hours.
