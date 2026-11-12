# QA security test report

Date: 2026-11-11. Same isolated stack and `security` profile as the functional run. Folders: `00 Setup`
and `18 Security` (74 requests). Tokens for expired, wrong-secret and `alg=none` JWTs were generated in
memory and passed with `--env-var`. The JSON and HTML exports have those values scrubbed.

Accepted result:

| | Total | Failed |
|---|---:|---:|
| Requests | 74 | 0 |
| Assertions | 437 | 0 |
| Newman exit code | 0 |

Raw: `scratch/qa/raw/newman-security-2026-11-11T03-35-00-661Z.json`. HTML:
`docs/testing/newman/newman-security-2026-11-11T03-35-00-661Z.html`.

## What was exercised

- Authentication: missing token, expired token, wrong secret, `alg=none`, tampered payload, sign-out revocation.
- Authorisation: customer against admin routes, one customer against another's order, bag, exchange and evidence.
- CSRF: foreign `Origin`, missing `Origin`/`Referer` on a cookie write, foreign `Referer`, same-origin allowed.
- CORS: a preflight from `https://evil.example` does not receive `Access-Control-Allow-Origin` for that origin.
- Injection and input: SQL-like strings, XSS text stored as JSON, prototype-pollution keys ignored, oversized body (413), malformed JSON (400).
- Media: private evidence is not served from `/uploads`; path traversal is not served.
- Payments: bad signature, replay, webhook with a bad signature.
- Headers: `nosniff`, no `X-Powered-By`, API CSP `default-src 'none'`, and no stack trace or secret in bodies.

## The one assertion that failed before the accepted run

`OPTIONS /api/account` with `Origin: https://evil.example` returned **405** `method_not_allowed`.
The response did **not** echo that origin. A browser still refuses the preflight. The collection now
accepts 405 as well as 204, 200 and 404, and still fails if the allow-origin header equals the foreign
origin. The application was not given an `OPTIONS` handler.

A second security run, started immediately, received **429** `rate_limited` on the fourth new sign-in.
That is the 20-starts-per-15-minutes-per-IP control, still enabled. Restarting the QA process cleared
the in-memory window; the limits were not turned off. The accepted run is the one after that restart.

## Findings

No critical or high security defect in this run.

Low: there is no successful `OPTIONS` handler. Cross-origin browser calls fail closed. Same-origin
use (the shop and the admin UI) does not need that preflight.

Residual: `text()` now rejects U+0000, and `email`, `phone` and `gstin` go through `text()`. A string
that reaches PostgreSQL without `text()` can still produce a 500 in development (a generic message in
production). This run did not find another such field.
