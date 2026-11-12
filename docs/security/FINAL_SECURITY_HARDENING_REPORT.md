# Final security hardening report

Date: 2026-11-11. Scope: review of the controls already tested, plus the local payment stand-in added the same day. No production host, live webhook, or customer record was touched. No application code was changed in this pass: the open items are host configuration or an owner decision, not a defect that can be closed safely here.

Earlier evidence, not repeated as new testing: `docs/production/SECURITY_AUDIT.md`, Newman security 437/437, storage tests, and `npm test` **207/207** on 2026-11-11 after the payment-isolation change.

## Verdict: CONDITIONAL PASS

The application’s own checks (sessions, OTP, admin role, payments, webhooks, uploads, headers) held in QA. Production is not verified until the host secrets, HTTPS, Razorpay webhook, Resend, and backups are in place. Automated tests do not prove those.

## Controls already in place

| Area | What the code does | Still needs the host |
|---|---|---|
| OTP | Peppered hash, 10-minute TTL, counted attempts, single use, resend and IP limits. The code is not logged. `debug_code` is omitted in production (`test/production.test.js`). The console line in `lib/notify.js` runs only when not production and email is not configured. | Resend domain, `AUTH_DEV_OTP_ECHO` unset |
| Session | HS256 only. Cookie is HttpOnly and SameSite=Lax, Secure in production. Role and `sessions_valid_after` are read from the database each request. Sign-out in the same second as issue was fixed earlier. | `JWT_SECRET` rotation, HTTPS so `Secure` applies |
| Admin | `access: 'admin'` is enforced in `server.js` before the handler. Allow-list emails as well. Demotion clears the session. Refunds and credit changes go through those routes. | Do not add a second factor in this pass: it would change sign-in for the live admins. Recommend step-up only after the owner agrees. |
| Payments | Prices are computed on the server. Checkout and subscription signatures are HMAC. Webhook HMAC uses the raw body and an event id. Local stand-in confirmation exists only when `RAZORPAY_API_BASE` is loopback; otherwise those actions 404. The browser cannot set the mode. | Live keys, webhook URL, and a real payment plus refund |
| Uploads and evidence | Bytes are sniffed. Customers can upload evidence only. Private objects use short signed links, not `/uploads`. | Supabase bucket policies on the live project |
| API | Origin guard on cookie writes, CORS allow-list, CSP, nosniff, frame deny, rate limits, parameterised SQL, JSON errors with `request_id` and no stack in production | `APP_ORIGIN`, `CORS_ORIGINS` without the tunnel, `TRUST_PROXY=1`, `FORCE_HTTPS=true` |
| Privacy | Colour analysis stays on the device (account copy). Account deletion is implemented and tested. OTP logs store the email domain, not the address or the code. | Retention of invoices is intentional |

## This pass

| Check | Result |
|---|---|
| `node scripts/check-environment.js` | RESULT OK. Database host `127.0.0.1`, not the production project. Storage local. Resend disabled. Guard armed. The Razorpay line is the developer `.env` (test keys on `api.razorpay.com`). The QA server does not load that file. |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm test` (re-run, no code change this pass) | **207 pass, 0 fail** (exit 0, ~63s) |
| `npm run lint` | exit 0. Existing oxlint warnings only; no new errors |
| `npm run build` | exit 0. Vite production build, then precompress 15497 KB → 3509 KB brotli |
| New code | None. No new vulnerability met the bar for a safe patch. |
| Admin MFA | Not added. It would change sign-in for existing admins. Owner decision. |
| Membership billing | Not changed. |

## Pre-production remediation update (2026-11-11)

Payment-related hardening, with regression tests in `test/pre-production-remediation.test.js` (details: `docs/testing/PRE_PRODUCTION_REMEDIATION_REPORT.md`):
- Membership verification now confirms through the Razorpay invoice that the payment belongs to the checkout's subscription. Otherwise it returns 400 and writes audit `membership_payment_mismatch`.
- Invalid gift and Wardrobe Bag payment signatures are audited (`gift_payment_signature_invalid`, `bag_payment_signature_invalid`).
- A paid gift's submission key cannot open a second checkout, and another customer's key is refused.
- Gift and bag refunds are idempotent per Razorpay refund ID.

`npm test` 226/226. Real webhook delivery remains unverified.

## Remaining owner actions

1. Production secrets, HTTPS, `TRUST_PROXY`, `FORCE_HTTPS`, and remove any trycloudflare origin (`FINAL_GO_LIVE_CHECKLIST.md` §3).
2. New `JWT_SECRET` and `OTP_PEPPER`. Unset `AUTH_DEV_OTP_ECHO` and `ALLOW_REMOTE_DATABASE`.
3. Razorpay live webhook and a recorded sandbox or live low-value payment and refund.
4. Resend SPF and DKIM.
5. Confirm Supabase backups and that `exchange-evidence` is private on the live project (`npm run storage:setup` is read-only).
6. Decide whether admins need a second step for refunds and credit changes. Not required for the current tested model.
7. Approve the commit. Nothing from this review was committed.

## What was not proven

Live TLS, the real webhook secret, production database network rules, PITR restore, and that no secret remains in git history. Those are host checks, not QA checks.
