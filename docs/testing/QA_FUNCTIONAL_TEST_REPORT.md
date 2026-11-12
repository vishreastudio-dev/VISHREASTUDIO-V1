# QA functional test report

Date: 2026-11-11. Target: isolated stack only, `http://127.0.0.1:3100`, Razorpay stand-in
`http://127.0.0.1:3190`, database `127.0.0.1:55432/vishrea_qa`. Profile: `security` (rate limits on,
`TRUST_PROXY` off). No call reached Supabase, Resend, or `api.razorpay.com`.

Collection: `postman/Vishrea_Studio_API.postman_collection.json` (372 requests). Functional folders are
00–17 and 19 (312 requests). Raw result:
`scratch/qa/raw/newman-functional-2026-11-11T03-30-59-728Z.json`. HTML:
`docs/testing/newman/newman-functional-2026-11-11T03-30-59-728Z.html`.

## Result

| | Total | Failed |
|---|---:|---:|
| Requests | 312 | 0 |
| Assertions | 1,873 | 0 |
| Newman exit code | 0 | |

The 9 November run of the same folders had 1,871 assertions and 38 failures. Those are classified below.
This re-run is the result that counts.

## What the 38 earlier failures were

| Count | Request area | Cause | Change |
|---:|---|---|---|
| 33 | Catalogue, product, content, carousel, legal | The shared assertion required `Cache-Control: no-store`. Those GET routes intentionally send `public` or `private` with `max-age`. | Assertion now accepts `no-store` or `public`/`private, max-age=N`, and still rejects a `public` cache on an authenticated response outside those routes. Application cache headers were not changed. |
| 1 | `POST /api/payment-verify` | The test required `invoice_number` to be a string. The handler re-reads the order after `createOrderInvoice`. The re-run received a string. | No application change in this session. |
| 1 | Duplicate payment `409` | The earlier export had no `request_id`. `api/payment-verify.js` includes `request_id` on that `409`, and the re-run passed the envelope check. | No application change in this session. |
| 1 | `POST /api/membership` `start_checkout` | HTTP 502. The stand-in had no `POST /plans`, so `ensurePlan` received a 404 and the app correctly returned `payment_gateway_error`. | `tests/qa/razorpay-standin.mjs` now implements `POST /plans` and `GET /plans/:id`, echoing the amount. Re-run: checkout accepted. |
| 1 | Truncated PNG upload | The fixture was the first 40 characters of a valid PNG's base64, which still decoded as a 16×16 PNG (HTTP 201). | The fixture is now a 16-byte PNG signature. Re-run: HTTP 422 `unreadable_image`. |
| 1 | `PUT /api/account` with U+0000 in `full_name` | HTTP 500. PostgreSQL rejects a null byte in UTF-8. | `lib/validate.js` `text()` rejects U+0000 with HTTP 400 `invalid_<field>` before any query. Confirmed by `test/validate.test.js`, this Newman run, and the failure-recovery run. |

## Coverage that passed on the re-run

Authentication (including OTP throttle and session revocation), account validation, catalogue and product
reads, search, bag, checkout with client prices ignored and idempotency, payment verify against the
stand-in, membership checkout, credits, referrals, gifts, orders, exchanges, local uploads, colour
analysis, admin catalogue operations, and malformed-body handling.

Synthetic users created by the run stay in `vishrea_qa` (`qa-pm-*@qa.test`). Stock fixtures were not
wiped. The checkout fixture's variant quantities still sum to 299,999 after failure recovery, the same
total the recovery run observed before and after the database outage.
