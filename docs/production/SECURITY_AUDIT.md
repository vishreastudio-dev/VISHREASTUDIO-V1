# Security audit

Date: 2026-11-11. Method: source review plus tests on the isolated QA stack only. No production request,
real payment or real email was made. Detailed evidence:
- `docs/testing/QA_SECURITY_TEST_REPORT.md` (437/437 assertions);
- `docs/testing/QA_FAILURE_RECOVERY_REPORT.md` (18/18);
- `docs/security/STORAGE_SECURITY_TESTS.md`;
- `docs/security/FINAL_STORAGE_PRODUCTION_READINESS.md`.

## Findings this cycle

| Severity | Finding | Status |
|---|---|---|
| High | Session revocation compared whole seconds: signing out in the same second the token was issued left that cookie valid | **Fixed** (`api/auth.js`, `lib/auth.js`, `lib/admins.js`); regression test added; 202/202 |
| High | A null byte in a text field returned HTTP 500 (database UTF-8 error) | **Fixed** earlier this cycle (`lib/validate.js`); unit test added |
| Low | No successful `OPTIONS` handler; a foreign preflight gets 405 | Accepted. It fails closed, and same-origin use is unaffected |
| Low | A string sent to PostgreSQL without `text()` could still raise a 500 on a null byte | Open. None found in Newman, fuzz or journey runs |

No critical finding. No open high finding.

## Control review

| Area | Implementation | Verified by |
|---|---|---|
| Session token | HS256 only (`algorithms: ['HS256']`); production refuses a weak or known `JWT_SECRET`; HttpOnly, `SameSite=Lax`, and `Secure` in production; never in a response body | Newman 18 (expired, wrong secret, `alg=none`, tampered); platform tests |
| Server-side state | Role, `is_active` and `sessions_valid_after` are read per request; claims are never trusted for the role | Tests: demoted admin, disabled account |
| OTP | Peppered hash; 10-minute TTL; attempt counted before compare; single-use delete; resend throttle; per-email and per-IP limits; echo refused in production and against any remote database | Journey, Newman 01, config guards |
| Authorisation | Each module declares access (`public`, `user`, `admin`); admins also need the allow-list; queries are scoped by `auth_user_id` (IDOR) | Newman 18: another customer's order, bag, exchange and evidence → 404 or 403 |
| SQL injection | Parameterised `pg` queries only; no string-built SQL found on user input | Newman injection probes |
| XSS | The API returns JSON with `default-src 'none'`; the SPA renders through React escaping; storefront CSP allow-lists only Razorpay and Instagram | Newman XSS probe |
| CSRF and CORS | `originGuard` on every non-GET `/api` except webhooks; a cookie write needs a same-origin `Origin` or `Referer`; CORS uses an allow-list with credentials | Newman 18 |
| Rate limits | Global 600 per minute per IP, per-user write limits, OTP limits; `TRUST_PROXY` controls the client IP | Left on in every test, including k6 |
| Uploads | Type detected from file bytes (no SVG or HTML); size and dimension caps; random server names; customers limited to private evidence; deduplicated by SHA-256 | Newman 15 and 18; storage tests |
| Private evidence | `exchange-evidence` is a private bucket; access is by signed URL for 300 s; the local driver uses HMAC links; it is never reachable under `/uploads` | Storage tests (tampered, reused or expired links → 400) |
| Path traversal | `/uploads` serves only allow-listed names that are still referenced; `..` is rejected | `test/uploads-access.test.js` |
| Payments | Server-side prices; checkout signature `HMAC(order|payment)`; amounts cross-checked with the gateway; idempotent verify; duplicate payment → refund | Newman 08; k6 (269 of 269 repeat verifies idempotent) |
| Webhook | HMAC over the raw body; mounted before the JSON parser; event-ID deduplication; replay ignored | Newman 18; platform tests |
| Errors | `{error, message, request_id}`; generic 500 in production; no stack traces | Newman "no internals leaked" on every response |
| Headers | API CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production | Newman common checks |
| Secrets | None in the frontend build or git (marker scan = 0; no tracked `.env`); service-role key backend only | 2026-11-11 scans |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities in the backend and the frontend | 2026-11-11 |
| Personal data | Account deletion erases profile, wearers, addresses, colour profile, looks and bag, and keeps invoices; admin customer exports are admin-only | Platform tests |

## Not verified (owner or host)

The production secret store, live Razorpay webhook configuration, Resend domain (SPF and DKIM), HTTPS
termination and proxy headers on the host. See `FINAL_GO_LIVE_CHECKLIST.md` §3.
