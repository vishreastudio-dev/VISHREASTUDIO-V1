# Security Review — 7 November 2026 change set

| Field | Value |
|---|---|
| Scope | Everything changed in this work (courier management, removal of Request a Piece, uploads, caching, API layer, health, background jobs, build/static serving) plus a re-check of payment, membership, inventory, admin and customer-data paths |
| Baseline | [technical/SECURITY_AUDIT](technical/SECURITY_AUDIT.md) (VS-SEC-001) remains the full control inventory and open-findings list; this document records what changed |
| Method | Code review, automated tests, `npm audit`, bundle scan, `git ls-files` |

## 1. Checks run

| Check | Result |
|---|---|
| `npm audit --omit=dev` (server) | 0 vulnerabilities |
| `npm audit` (storefront) | 0 vulnerabilities |
| Secrets in the production bundle (`rzp_*`, JWT-shaped strings, `sk-`, `re_`, Supabase keys) | none found; no `import.meta.env` usage in the storefront |
| Tracked environment files | only `*.example` files; `.env` and `vishrea-react/.env` are ignored |
| Test suite incl. new authorization tests | 151/151 pass ([REGRESSION_TEST_REPORT](REGRESSION_TEST_REPORT.md)) |

## 2. Findings and changes in this work

| ID | Area | Finding | Severity | Status |
|---|---|---|---|---|
| R-01 | Uploads | Anonymous visitors could write image files to disk (the only reason was piece-request attachments) | Medium | **Fixed** — `/api/upload` requires a session; rate limit keyed by user; test `guest uploads … are refused` |
| R-02 | Removed feature | `/api/piece-requests` accepted anonymous submissions with personal data | Low (surface) | **Removed** — endpoint returns 404; admin section returns 400; data retained in the table, not readable through the app |
| R-03 | Couriers — authorization | New admin sections | — | Behind the existing `access = 'admin'` module guard + allow-list; tests: anonymous 401, customer 403 for read and write |
| R-04 | Couriers — tracking links (XSS / open redirect) | Admin-entered URL templates become customer links | Medium (by design) | Templates must be `https://`; the AWB is URL-encoded and may only change path/query (a template whose host depends on the AWB is refused); generated links must parse as `https`; the customer UI renders a link only if it starts with `https://`; React escapes all text; AWBs limited to letters, digits and `space . _ / -`. Unit and integration tests |
| R-05 | Couriers — input validation | name 2–80 chars, unique case-insensitively; phone via `phone()`; website `https` only; text fields length-capped; sort order bounded | — | Implemented in `lib/couriers.js`; tests |
| R-06 | Couriers — data integrity | Deleting a courier used by any shipment | — | Refused (409 `courier_in_use`) and blocked by `ON DELETE RESTRICT`; deactivation keeps history |
| R-07 | Cache isolation (server) | A shared cache must never serve personalised data | High (if wrong) | Only guest/non-member catalogue, product and content responses are cached; member requests bypass it (test asserts `private` and no `X-Cache`); session, account, orders, bag, checkout, payments and admin are never cached (`no-store`) |
| R-08 | Cache isolation (browser) | Shared GET layer could show one account's data to the next user on a shared device | Medium (if wrong) | Private endpoints are only de-duplicated in flight (no reuse window); all cached GETs are dropped when the signed-in user changes |
| R-09 | Cache poisoning / memory | Random slugs/queries could fill the server cache | Low | Bounded to 500 entries, short TTL; worst case is a lower hit rate |
| R-10 | Health endpoint | New pool/process figures | Low | Shown only outside production or to admins |
| R-11 | Background jobs | Duplicate runs if several instances start | Medium (correctness) | Advisory lock; one runner at a time |
| R-12 | Static assets | Precompressed asset route | Low | File name reduced with `path.basename`, only `.js`/`.css` under `dist/assets`, `Vary: Accept-Encoding` |
| R-13 | Client env file | `vishrea-react/.env` contains a Supabase **anon** key that the code never reads | Low | Recommend deleting the file (anon keys are public by design; RLS lockdown already denies them) |
| R-14 | Logging | Dispatch log line includes courier name and AWB | Low | Not sensitive; no passwords, OTPs, tokens, payment secrets or addresses are logged (unchanged scrubbing in `lib/log.js`) |

## 3. Re-checked, unchanged

Payment signature + gateway verification, webhook HMAC over raw body and event de-duplication, server-side pricing, atomic stock take and release, credit ledger constraints, OTP hashing/attempt limits, session revocation, origin guard (CSRF), security headers/CSP, admin allow-list, parameterised SQL (the new courier and cache code uses bound parameters only; the only interpolated SQL fragments are fixed column lists and server-derived integers, as before), error responses without stack traces in production.

## 4. Open items carried from VS-SEC-001 (not addressed here)

S-01 admin two-step verification, S-02 role separation, S-05 penetration test, S-08 in-memory rate limits (now also listed in the scalability plan), S-10 uploads on local disk, S-16 rotation of values found in git history. These need owner decisions or infrastructure.
