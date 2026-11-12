# Vishrea Studio — Production Verification

Audit date: 2 Nov 2026. Evidence is from the source tree and from `npm test` on this machine. Nothing below is inferred from a previous report.

## How this was verified

`npm test` runs Node’s built-in test runner (`node --test --test-concurrency=1 test/*.test.js`).

Integration tests use a throwaway PostgreSQL database (created per run, dropped afterwards) and a local stand-in for the Razorpay REST API. The stand-in issues real HMAC-SHA256 signatures with the test secret. The application code under test is the same code that serves checkout, webhooks and inventory.

Result on 2 Nov 2026:

```text
tests 74
suites 13
pass 74
fail 0
skipped 0
duration_ms 15889
```

Breakdown:

| File | Tests | Result |
| --- | --- | --- |
| `test/platform.test.js` | 48 | pass |
| `test/pricing.test.js` | 8 | pass |
| `test/production.test.js` | 7 | pass |
| `test/seo.test.js` | 7 | pass |
| `test/razorpay-gateway.test.js` | 2 | pass |
| `test/razorpay-signature.test.js` | 2 | pass |

This run did **not** open a browser, did **not** call live Razorpay, did **not** measure page weight or latency, and did **not** generate 1,000 / 10,000 / 100,000-user load. Those items stay BLOCKED or PARTIAL in the audit.

## Commands

```text
npm test
```

PostgreSQL was reachable on this machine, so the integration suites ran. They do not use `DATABASE_URL` from `.env`.

## Checks and evidence

| Check | Status | Evidence |
| --- | --- | --- |
| OTP single-use, attempt limit, no admin-by-email | PASS | `platform.test.js` authentication |
| Session cookie is HttpOnly; sign-out revokes server-side | PASS | authentication tests |
| Customer cannot call admin APIs | PASS | access control |
| Customer cannot read another customer’s order | PASS | access control + journey poll test |
| Server price ignores client price; GST intra/inter state | PASS | pricing tests + `pricing.test.js` |
| One-of-one race: exactly one buyer | PASS | two customers racing |
| Stock 3, 20 buyers: 3 succeed, stock never negative | PASS | twenty buyers |
| Double checkout reuses one hold | PASS | double-submitted checkout |
| Gateway order failure releases stock | PASS | gateway failure test |
| Bad signature, foreign order, wrong order id rejected | PASS | payment verification |
| Duplicate verify is idempotent; one invoice | PASS | valid payment applied once |
| Amount mismatch does not mark paid | PASS | amount mismatch test |
| Webhook bad signature rejected; 5 duplicate deliveries, one paid order | PASS | webhook test |
| Webhook body is not stored with email or phone | PASS | same test asserts payload has no `secret-buyer` |
| Failed payment keeps hold; cancel releases stock | PASS | failed payment test |
| Late webhook re-acquires stock, or refunds if sold | PASS | expired hold tests |
| Second capture on a paid order refunded once | PASS | second capture test |
| Two simultaneous refunds of one unfulfillable payment: one Razorpay refund | PASS | simultaneous refunds |
| Gateway fetch down at verify: paid, `gateway_checked_at` NULL, then confirmed by `reconcilePayments` | PASS | gateway unreachable at verify |
| Gateway fetch down + tampered amount: reconciliation flags, refunds, restocks, audits once | PASS | tampered amount reconciliation |
| Refund 5xx: `refund_attempts = 1`, no retry inside backoff, retried and `refunded` after backoff | PASS | refund retry |
| Failed duplicate-capture refund retried once, never twice | PASS | duplicate-capture retry |
| Admin positive credit grant receives the standard expiry | PASS | admin credit test |
| Cookie mutation without Origin/Referer → 403; Referer alone → 200; no cookie → not required | PASS | transport security test |
| Partial refund does not restock or flip payment status | PASS | refund matrix |
| Full refund of an unshipped order returns stock | PASS | refund matrix |
| Full refund of a delivered order keeps `delivered` and does not restock | PASS | refund matrix |
| Membership activation bound to its own payment; credits once | PASS | membership tests |
| Premium pieces cannot use credits | PASS | credit redemption |
| Expired credits cannot be spent; one expiry ledger row | PASS | expired credits |
| Cancel of an unshipped credit order restores the credit and the unit | PASS | cancelling credit order |
| Duplicate subscription charge grants credits once | PASS | repeated subscription charge |
| Admin stock edit uses a delta and conflicts if stock moved | PASS | stale stock edits |
| Sold product is archived, order line kept | PASS | deleting a sold product |
| Unpaid order cannot be dispatched | PASS | unpaid orders |
| CSV formula injection neutralised | PASS | CSV export |
| SVG/HTML upload refused; guest video refused; upload CSP sandboxed | PASS | uploads |
| Video over 10s refused even if the setting says 30; fourth live video refused | PASS | videos over 10 seconds |
| HTTP redirect / HSTS / CSP in production mode | PASS | `production.test.js` (app started with `NODE_ENV=production` in-process) |
| Weak JWT secret refused in production mode | PASS | production mode |
| Product, FAQ, canonical, noindex, sitemap | PASS | `seo.test.js` |
| Live Razorpay payment and live webhook | BLOCKED | No live call was made |
| Production TLS, HSTS on the public host, cookie Secure flag in the real browser | BLOCKED | Requires the deployed host |
| Browser walkthrough of homepage, PDP, cart, checkout, admin, 320–1440px | BLOCKED | Not executed this pass |
| Load at 10 / 100 / 1,000 / 10,000 concurrent users | BLOCKED | Not executed |
| `.env` committed | PASS for this clone | `git check-ignore` matches `.env`; `git log --all -- .env` is empty |

## Release gate (code under test)

| Gate | Result |
| --- | --- |
| Critical security defects still failing tests | 0 |
| Critical payment defects still failing tests | 0 |
| Critical inventory defects still failing tests | 0 |
| Critical authorization defects still failing tests | 0 |
| Critical data-integrity defects still failing tests | 0 |
| Critical checkout defects still failing tests | 0 |
| Regression failures | 0 |

Go-live still depends on the blockers in `PRODUCTION_AUDIT.md`. A green local suite is not a production certificate.
