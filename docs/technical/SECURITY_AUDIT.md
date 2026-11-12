# Security Audit

| Field | Value |
|---|---|
| Document ID | VS-SEC-001 |
| Document title | Security Audit |
| Version | 1.0 |
| Status | Current — code-level review; no external penetration test performed |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | Source code, staging catalogue checks and `npm test` / `npm audit` of 7 Nov 2026; spec §13 (NFR-03/04) and §15 (SEC-01…11) |

Related: [Test Report](TEST_REPORT.md) · [Technical Architecture](TECHNICAL_ARCHITECTURE.md) · [Release Checklist](../client/RELEASE_CHECKLIST.md) · earlier reviews: `../archive/2026-11-02-production-audit/PRODUCTION_AUDIT.md` (2 Nov), `../archive/2026-11-05-remediation-audit/VISHREA_AUDIT_REMEDIATION_REPORT.md` (5 Nov)

## 1. Controls in place (with evidence)

| Area | Control | Evidence | Verified by |
|---|---|---|---|
| Authentication | Passwordless 6-digit e-mail codes: hashed with a pepper, single-use, attempt-limited, resend-throttled; never echoed in production | `lib/auth.js`, `api/auth.js` | P authentication tests; PD "OTP is never echoed…" |
| Sessions | HS256 JWT in an HTTP-only, SameSite=Lax cookie; role re-read from the database per request; server-side revocation (sign-out, account deletion) | `lib/auth.js` `extractUser`, `sessions_valid_after` | P "sign-out revokes the session server-side"; W deletion test |
| Authorisation | Module-level `access` (`public`/`user`/`admin`); admin requires role + optional e-mail allow-list; customers cannot read others' orders | `server.js` `mountModule`; `lib/auth.js` `isAdminRow` | P access-control tests; R allow-list test; W export permission test |
| Database exposure | Server-only access as table owner; RLS enabled on all tables; Supabase `anon`/`authenticated` have no table privileges | `migrations/013` lockdown | Staging check 7 Nov: 0 tables without RLS, 0 readable |
| SQL injection | Parameterised queries throughout; dynamic SQL limited to server-derived values (column lists, drop visibility with integer hours/boolean) | `lib/db.js`; `lib/catalogue.js` `dropVisibleSql` | Code review |
| CSRF | Origin/Referer allow-list for state-changing requests; JSON-only bodies; SameSite cookie | `lib/http.js` `originGuard` | P "…cross-origin mutations are refused" |
| Transport and headers | HTTPS redirect, HSTS, enforcing CSP in production, nosniff, frame protections | `lib/http.js` | PD tests |
| Rate limiting | Global 600/min/IP, per-module limits, sign-in and upload limits, webhook limit | `lib/rate-limit.js` | P "rate limiting returns 429" |
| Uploads | Type from bytes (JPG/PNG/WEBP/MP4/MOV), SVG/HTML refused, size limits per role, random names, sandboxed CSP when served | `api/upload.js`, `lib/uploads.js`, `server.js` | P upload tests; PR sniffing test |
| Payments — orders | Server-computed amounts; HMAC verification; gateway cross-check; capture only for the expected amount; idempotent finalisation; automatic refunds for duplicates, late payments and unfulfillable orders | `lib/payments.js`, `api/payment-verify.js` | P payment tests |
| Payments — membership | Subscription signature `payment_id|subscription_id`; payment and mandate fetched from Razorpay before activation (no activation on the signature alone); amount checked; one upfront charge per mandate (unique index); debits after cancellation marked `refund_required` | `lib/billing.js` | R billing tests |
| Webhooks | HMAC over raw body; replay/duplicate protection via `payment_events (provider, event_id)`; failed events reprocessed on retry | `api/webhooks/razorpay.js` | P webhook test; R forged-webhook test |
| Inventory integrity | Atomic conditional stock updates; per-customer checkout lock; idempotency keys; reservation expiry sweep | `lib/inventory.js`, `api/checkout.js` | P race tests (2 buyers/1 piece; 20 buyers/3 units) |
| Credit ledger integrity | Ledger + cached balance; `credits_balance >= 0` check constraint; unique grant per paid month; FIFO expiry; reversal once per order | `lib/credits.js`, `lib/membership.js`, migrations 013/017 | P credit tests; R acceptance test |
| Referral fraud | Self-referral, second referrer and existing members refused; reward only after verified first payment; revoked/flagged on refund | `lib/referrals.js` | R referral tests |
| Privacy | Colour analysis on device (only derived attributes stored); self-service deletion stops billing, erases personal data and revokes sessions; marketing requires opt-in | `pages/SkinToneAnalysis.jsx`, `api/colour-review.js`, `api/account.js`, `lib/notify.js` | P colour test; W deletion and notification tests |
| Secrets | `.env` git-ignored (only `*.example` files tracked); production refuses a weak `JWT_SECRET` or non-HTTPS origin; development refuses a remote database unless explicitly allowed | `.gitignore`; `lib/config.js` | `git ls-files`; PD startup-guard tests |
| Audit trail | `audit_logs` for admin actions, payments, settings (before/after), stock adjustments (before/after), membership events | `lib/audit.js` | R settings audit test |
| Error handling | Errors return a code, message and request id; no stack traces to clients | `lib/http.js` `errorHandler` | PD "errors do not leak internals" |

## 2. Findings

| ID | Finding | Severity | Status | Remediation |
|---|---|---|---|---|
| S-01 | Admin panel has no two-step verification (NFR-03, SEC-05) | **High** | Open (DEC-10) | TOTP or second-factor step for admin sign-in; shorter admin session |
| S-02 | No Owner/Helper separation; every admin has every permission (BO-09, SEC-05) | Medium | Open (DEC-10) | Per-section permissions |
| S-03 | `body-parser` < 1.20.9 denial of service (GHSA-27r3-jxmh-p828) | High | **Fixed** 7 Nov (lockfile) | Keep `npm audit` in the release gate |
| S-04 | Concurrent duplicate `subscription.charged` delivery returned 500 | Medium | **Fixed** 7 Nov (`lib/billing.js`) | Covered by P "a repeated subscription charge allocates credits once" |
| S-05 | No vulnerability scan or penetration test yet (SEC-07) | High (process) | Open | Run against staging before go-live |
| S-06 | No incident-response runbook (SEC-08, CERT-In 6 h) | Medium (process) | Open | Runbook in the release pack |
| S-07 | Order payment verification marks an order paid on a valid signature when Razorpay is unreachable; reconciliation re-checks and refunds/restocks if the amount is wrong | Low | Accepted design (tested: P "gateway unreachable at verify…") | Membership activation is stricter (waits for the gateway or webhook) |
| S-08 | Rate limits are in memory per process | Low | Open | Shared store if more than one instance runs (DEC-25) |
| S-09 | Backups (daily, 30 days), restore drill, India data residency and encryption at rest not evidenced | Medium | Open (DEC-13) | Provider confirmation + restore drill |
| S-10 | Uploads on local disk unless `UPLOADS_DIR` points to persistent storage | Medium (availability) | Open (DEC-25) | Persistent volume or object storage |
| S-11 | The confidential client specification and proposal are in the working tree; the proposal PDF is **tracked by git**. The specification prohibits disclosure to public repositories | Medium (contractual) | Open | Keep the repository private; consider removing client PDFs from version control (owner approval) |
| S-12 | No admin alerting on payment/checkout failures (NFR-06) | Medium | Open | Alert channel |
| S-13 | Audit log has no tamper protection or retention policy statement (kept indefinitely) | Low | Open | Document ≥ 1-year retention; restrict deletes |
| S-14 | Staging database is hosted remotely and accessed from a developer machine with `ALLOW_REMOTE_DATABASE=true` (session-only) | Low | Process | Confirm staging holds no real customer data (SEC-03) |
| S-15 | 29 frontend lint warnings (no errors) | Low | Open | Clean up (P2-09) |
| S-16 | Git history contains values matching secret patterns (long `JWT_SECRET`, Razorpay/Resend/OpenAI/Supabase key formats) in commits `b106e8e` (18 Oct) and `18aae1d` (6 Nov), files `.env.example`, `start.ps1`, `../archive/SYSTEM_FLOW_AND_CHECKLIST.md`. Values were deliberately not read; they may be placeholders or generated development secrets (`lib/config.js` already rejects known development JWT secrets) | **High until verified** | Open | Treat as exposed: rotate `JWT_SECRET`, `OTP_PEPPER`, Razorpay keys and webhook secret, Resend key, database password and any Supabase keys; keep the repository private; consider history rewriting only with owner approval |
| S-17 | Migrations 014–019 created tables without explicitly enabling RLS (staging had it via the hosting platform's defaults) | Medium | **Fixed** 7 Nov — migration `020_rls_all_tables.sql` enables RLS on every public table and revokes Supabase roles; applied to staging (0 tables without RLS) | Keep the guarded block in future migrations |
| S-18 | The privacy policy names only Razorpay as a processor; Resend, the database host and the optional AI provider are not listed (SEC-09) | Low | Open | Update the privacy policy after DEC SEC-01/09 |
| S-19 | Invoices read seller details from current settings when displayed, so a settings change alters old invoices | Medium (compliance) | Open | Snapshot seller details on `invoice_records` (INV-01) |

## 3. Areas reviewed with no new finding

Payment signature verification, webhook idempotency, duplicate-transaction prevention, inventory races, credit ledger integrity, file upload validation, input validation (`lib/validate.js`), secret handling in code, error responses, cost/supplier data never exposed publicly (checked live), RLS/privileges on staging.

## 4. What only live credentials can prove

Razorpay Subscriptions/UPI Autopay behaviour, Razorpay webhook delivery from the internet, Resend domain verification and delivery, WhatsApp delivery, hosting TLS configuration, backups and restore.
