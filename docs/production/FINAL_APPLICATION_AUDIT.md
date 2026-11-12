# Vishrea Studio — final application audit

Date: 2026-11-11. Decision: **CONDITIONAL GO**.

The shop, account, membership, and admin flows exercised in the browser work on the isolated QA stack. Launch is blocked by owner configuration (live secrets, Razorpay, Resend, legal identity, backup, and an approved release), not by an open critical code defect found in this pass.

Nothing here was committed, pushed, or deployed. Production data was not modified.

## Evidence (do not duplicate the source reports)

| Area | Result | Document |
|---|---|---|
| Security | Newman 437/437; controls summarised | `docs/production/SECURITY_AUDIT.md` |
| Sign-in and onboarding | QA OTP, no real email | `docs/production/CUSTOMER_ONBOARDING_FLOW.md` |
| Architecture and storage | Local QA storage; production storage plan | `docs/production/ARCHITECTURE_AND_STORAGE_AUDIT.md` |
| Competitor UX | Public pages only; recommendations, not copied copy | `docs/production/COMPETITOR_UX_RESEARCH.md` |
| Browser UI/UX and on-page SEO | This pass | `docs/production/UI_UX_AUDIT.md` |
| Go-live steps | Owner actions, deploy, rollback, first hour | `docs/production/FINAL_GO_LIVE_CHECKLIST.md` |
| API functional / security / recovery | 1,873/1,873, 437/437, 18/18 | `docs/testing/QA_FUNCTIONAL_TEST_REPORT.md`, `QA_SECURITY_TEST_REPORT.md`, `QA_FAILURE_RECOVERY_REPORT.md` |

Regression recorded on the checklist: `npm test` 201/201 at 09:10 IST, then a later full run reported as **206/206** including SEO, product FAQ, and sign-out. This browser pass did not change code, so tests, lint, and the production build were not run again. The last recorded build had no `service_role`, secret-key names, or `rzp_live_` in `vishrea-react/dist`.

Load figures (one laptop, not a capacity claim) stay in the checklist: 100 VUs, 0% failed requests, checkout idempotent.

## SEO, AEO, and GEO (what was actually seen)

Verified in the browser on home, `/catalogue/dresses`, and the silk dress product: unique titles and descriptions, canonical URLs on the public site host, one H1, Open Graph tags on the home page, product image alt text, and valid JSON-LD including Product and Offer and a visible product FAQ. Search results are `noindex`. Account, admin, cart, checkout, and login send `noindex`. Sitemap URLs use `https://vishreastudio.com/`. Business name on these pages is Vishrea Studio; phone on Help & contact is `+91 6364116567`; the public address is city-level until legal settings are filled.

QA `robots.txt` is `Disallow: /`. Production robots allow the shop and disallow private paths (`test/production.test.js`). That distinction matters: do not judge indexing from the QA file.

No ranking, AI-recommendation, or shopping-graph inclusion is claimed. AggregateRating was not added. Low-stock copy is tied to quantity, not a countdown.

Remaining SEO work is post-launch: unique title on noindexed search URLs, mobile Search link, occasion or price landing pages, reviews only after real reviews exist, full street address and grievance officer when the owner enters them.

## Local development isolation

`node scripts/check-environment.js` on 2026-11-11: development, database host `127.0.0.1` and not the production project, storage local, Resend disabled, production guard armed, RESULT OK. Razorpay in that file is test keys on `api.razorpay.com` (not `rzp_live_`). The QA server does not load `.env`. The checklist’s older “development still uses production” line is withdrawn.

## Remaining defects and risks

- No critical or high UI defect from this walkthrough.
- Medium: Search is hidden at 390px (`UI_UX_AUDIT.md`).
- Product checkout in the browser can still open Razorpay’s hosted sheet against a stand-in order id. Membership checkout on the QA stand-in no longer does that: see `docs/testing/MEMBERSHIP_PAYMENT_FAILURE_INVESTIGATION.md`. Order `#015471BD` may still be awaiting payment on the QA database from the earlier UI pass.
- Legal seller details and grievance officer are still empty by design until Admin → Settings.
- Uncommitted work remains. Do not commit until the owner asks.

## Owner decisions that block launch

1. Production environment and secrets (`NODE_ENV`, origins, database, JWT, OTP pepper, Supabase storage, guard ref, proxy and HTTPS). Remove any trycloudflare origin.
2. Razorpay live keys, webhook, and subscription events listed in the checklist.
3. Resend domain authentication (SPF and DKIM) and from-address.
4. Grievance officer and seller legal details.
5. Database backup or point-in-time restore confirmed, plus a manual dump before deploy.
6. Approve the release commit. Nothing has been committed from this audit.

DNS, the HTTPS proxy, and Supabase bucket check are part of the same deploy, not extra product work.

## Decision

**CONDITIONAL GO.** Ship after the owner actions above. Do not wait on mobile search, extra landing pages, or review markup.
