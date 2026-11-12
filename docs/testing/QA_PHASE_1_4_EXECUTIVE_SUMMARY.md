# QA phases 1–4 — executive summary

Date: 2026-11-11. Isolated stack only: API `:3100`, Razorpay stand-in `:3190`, PostgreSQL
`127.0.0.1:55432/vishrea_qa`, `security` profile (rate limits on). Production Supabase, Resend and
live Razorpay were not used. No k6 run was started.

## Results

| Phase | Result |
|---|---|
| 1. API inventory | Written earlier: `docs/testing/QA_API_INVENTORY.md`. The cache-control row now records the public `max-age` exceptions. |
| 2. Functional Newman | **Pass.** 312 requests, 1,873 assertions, 0 failed. `docs/testing/QA_FUNCTIONAL_TEST_REPORT.md` |
| 3. Security Newman | **Pass.** 74 requests, 437 assertions, 0 failed. `docs/testing/QA_SECURITY_TEST_REPORT.md` |
| 4. Failure and recovery | **Pass.** 18/18. `docs/testing/QA_FAILURE_RECOVERY_REPORT.md` |
| Regression | **Pass.** `npm test`: 201 tests, 0 failed (includes the new null-byte tests). |

## Critical and high findings

One high defect, now fixed:

- **Null byte in text fields returned HTTP 500.** `PUT /api/account` with U+0000 in `full_name` reached PostgreSQL and failed UTF-8 validation. `text()` now returns HTTP 400 `invalid_full_name` (and the same for every other field that uses `text()`). Confirmed by unit tests, Newman and the recovery script.

No critical finding. No open high finding.

## Defects fixed, and the regression

| Defect | Fix | Re-check |
|---|---|---|
| Null byte → 500 | `lib/validate.js` | `test/validate.test.js`; Newman "null byte in text"; recovery script; full `npm test` 201/201 |
| Membership checkout 502 against the stand-in | Stand-in `POST /plans` (QA double only; application logic unchanged) | Functional Newman membership requests passed |
| Newman false failures (public cache, truncated PNG that was still valid, CORS 405) | Collection expectations | Functional 1,873/1,873; security 437/437 |

The 9 November functional run's invoice-number and `request_id` failures were not reproduced. The current payment-verify handler returns both, and the 11 November run passed those assertions.

## Remaining risks

- A string that is sent to PostgreSQL without `text()` can still 500 on a null byte. No second field showed up in these runs.
- `OPTIONS` is not implemented. Foreign preflight gets 405 and no allow-origin header. Same-origin traffic is unaffected.
- The production guard is still unarmed until `PRODUCTION_SUPABASE_PROJECT_REF` is set. The developer `.env` still points at the live project. QA does not load it.
- Seven uploaded files remain on disk and in git history, untracked in the index, pending a separate deletion decision.
- These runs are one laptop. They are not a capacity measurement.
- Load-test login storms will hit the real OTP rate limit (a back-to-back security run already received 429). The load profile needs pre-issued tokens, not thousands of `start-login` calls.

## Load-testing phase

**Ready to start, once you approve it.** Functional, security, and failure-recovery passed with rate
limits left on, on the isolated stack. k6 v2.3.0 is already in `scratch/tools` and was not run.

Not ready for production cut-over. That decision stays CONDITIONAL in
`docs/security/FINAL_STORAGE_PRODUCTION_READINESS.md`.
