# Vishrea Studio — Developer Action Register (V1 remediation)

> **Status: PHASE 2 — for developer and owner review. No item below has been implemented.** Remediation (Phase 3) starts only after the owner approves the scope, and any item marked **Business decision** is answered in writing.
>
> Source: `docs/archive/2026-11-05-remediation-audit/VISHREA_UNIVERSAL_APPLICATION_AUDIT.md` (defect register §17, requirement catalogue §3). Architecture is unchanged for every item: React 19 + Vite + React Router, Express modular monolith, native `pg`, JWT HTTP-only cookie auth, Razorpay only, on-device colour analysis.
>
> Priority key — **P0** release blocker · **P1** must fix for V1 sign-off · **P2** fix before or during soft launch · **P3** hygiene / optional.

## 0. Business decisions required before coding (owner)

| # | Decision | Why it blocks | Affects |
|---|---|---|---|
| BD-1 | Membership billing model: (a) Razorpay Subscriptions autopay at ₹1,799/month, or (b) keep upfront prepaid orders and add a **renewal checkout** when the prepaid period ends. The proposal says “recurring payment setup where supported”; `.env.example` and `lib/config.js` say autopay was deferred. | Determines DEF-01/02/03 design | V1-MB-03, V1-MB-04, V1-CR-01 |
| BD-2 | Credit rules: credits per paid month (4 confirmed), **maximum balance** (value?), rollover/expiry length (code uses 60 days), whether paused months accrue credits, whether pause extends the paid period. Proposal says rules are “frozen before implementation”; no frozen-rules document exists in the repository. | DEF-02, DEF-04, DEF-32 | V1-CR-01/03/05, V1-MB-05 |
| BD-3 | Offers & referrals V1 rule set: what a referral earns (credit? discount?), for whom, and how an offer is applied (code at checkout? automatic?). | DEF-06 | V1-AD-05 |
| BD-4 | Gift membership: is it in V1? If yes — paid at creation (Razorpay) and redeemed by the recipient, or a lead handled offline by admin? | DEF-10 | V1-GF-01 |
| BD-5 | Which administrator emails are legitimate. Confirm ownership of the `vishrea.com` domain used by `DEFAULT_ADMIN_EMAIL` (the brand domain is `vishreastudio.com`). | DEF-15, DEF-16 | V1-SQ-03 |
| BD-6 | Hosting target. The proposal names Vercel; the implementation is a long-running Express process with a 60-second background job and local-disk uploads, which needs a persistent Node host or object storage. | DEF-22 | V1-SQ-08 |
| BD-7 | Seller legal name, GSTIN, registered address, support email, opening hours for invoices and the contact page. | DEF-21 | V1-CW-10 |

## 1. P0 — Release blockers

| Priority | Requirement ID | Defect ID | Expected correction | Acceptance criteria | Retest |
|---|---|---|---|---|---|
| P0 | V1-SQ-02, V1-SQ-03 | DEF-17 | Never run `NODE_ENV=development` / `AUTH_DEV_OTP_ECHO=true` against the live Supabase database or behind a public tunnel. Use a separate dev/staging database. Remove the trycloudflare origin from the live configuration. | Live `.env` has `NODE_ENV=production`, `AUTH_DEV_OTP_ECHO` unset/false, `APP_ORIGIN=https://<domain>`, `CORS_ORIGINS` empty; staging uses its own DB. | TC-SEC-018; `production.test.js` “OTP is never echoed”. |
| P0 | V1-SQ-02 | DEF-18 | Remove the hard-coded `JWT_SECRET` value from tracked `start.ps1` / `start.sh` (generate a random one when creating `.env`). Rotate the live `JWT_SECRET` (invalidates all sessions) and `OTP_PEPPER`. Extend the weak-secret check in `lib/config.js` to reject the old literal. | No secret literal in any tracked file (`git grep -n JWT_SECRET=` shows only empty placeholders); server refuses to start with the old value in production. | TC-SEC-017; `production.test.js` weak-secret case extended. |
| P0 | V1-SQ-03 | DEF-16 | Owner reviews the 4 live admin profiles; demote or deactivate non-staff accounts, delete or deactivate the `@vishrea.test` test account. (Data change — owner-approved, with backup.) | `SELECT email, role FROM profiles WHERE is_admin` lists only approved staff. | TC-SEC-019 (read-only query). |
| P0 | V1-SQ-03 | DEF-15 | `api/auth.js verify-code`: promote `DEFAULT_ADMIN_EMAIL` **only when no admin exists** (matching `scripts/migrate.js` and `.env.example` wording), never on every login. Set `DEFAULT_ADMIN_EMAIL` to a mailbox on a domain the business controls. | A demoted bootstrap admin who logs in stays a customer. | TC-SEC-006 (new automated test). |
| P0 | V1-CW-04 | DEF-19 | Configure `RESEND_API_KEY`, verify the sender domain, set `EMAIL_FROM`. | Production sign-in sends a real code; `/api/auth/start-login` returns 200 in production. | TC-CUS-023 on staging; `notify.test.js`. |
| P0 | V1-IN-01 | DEF-20 | Live Razorpay keys, live webhook pointing at `https://<domain>/api/webhooks/razorpay` with `RAZORPAY_WEBHOOK_SECRET`, `APP_ORIGIN` set. Keep test keys on staging. | Staging: one sandbox payment end-to-end through the real modal; production: ₹1 smoke test approved by owner, then refunded. | TC-PAY-010, TC-PAY-014. |
| P0 | V1-MB-03, V1-MB-04 | DEF-01 | Implement membership lifecycle per BD-1: a scheduled pass (alongside `sweepExpiredOrders`) that, when `renewal_at` passes, either renews (subscription charge / renewal order) or moves the membership to a lapsed status (`inactive`/`payment_failed`); pausing extends `renewal_at` by the paused time if BD-2 says so; the customer can pay for the next period. | A membership whose `renewal_at` is in the past is never `active` without a paid period; a lapsed member can renew from `/membership`; webhook `subscription.charged` path (if chosen) covered. | TC-MEM-005/006/007 automated with time travel (as in probe P03). |
| P0 | V1-CR-01 | DEF-02 | Allocate credits **per paid month** (4 at the start of each paid month, or 4 × months up front — per BD-2), idempotently, with the configured expiry. | Paying for 2 months yields the agreed total; each grant appears once in `credit_ledger`. | TC-MEM-010 automated. |

## 2. P1 — Required for V1 sign-off

| Priority | Requirement ID | Defect ID | Expected correction | Acceptance criteria | Retest |
|---|---|---|---|---|---|
| P1 | V1-WB-01 | DEF-05 | Customer Wardrobe Bag: “Save to Wardrobe Bag” on PDP for eligible (non-Premium) pieces; Wardrobe Bag list in account/membership with availability; “Move to bag & use credit” action that adds the variant to the cart with `use_credit=true`. Replace the no-op `ship` action or remove it. | Member saves, views, removes and redeems a piece through UI only; non-members see a membership prompt. | TC-MEM-017, TC-CUS-012. |
| P1 | V1-AD-05 | DEF-06 | Implement the BD-3 rule set server-side in `lib/pricing.js` (never client-side): referral code entry at checkout or account, validation, reward application, `loyalty_rules` evaluation for active rules within budget; show referral code + share in `/account`; admin sees referral status. | Applying a valid code changes the server-computed total/credits exactly per rule; invalid/self/expired codes are rejected; totals in Razorpay order match. | TC-CUS-062, TC-ADM-040 automated. |
| P1 | V1-AD-04, V1-AD-09 | DEF-11 | Admin customer detail view: profile, wearer profiles, membership + credits, order history list, latest colour profile (undertone, season, palette, date) with owner control over its use. | From `/admin/customers` the owner opens a customer and sees all five areas. | TC-ADM-030, TC-ST-008. |
| P1 | V1-WP-01 | DEF-07 | Wearer profiles UI in `/account`: list, add, edit, delete (respecting `max_wearers`). | CRUD works through UI; another customer cannot touch them. | TC-CUS-028, TC-SEC-003. |
| P1 | V1-CW-05 | DEF-08 | Profile edit form in `/account` (name, phone, optional GSTIN, notification preferences) using existing `PUT /api/account`. | Changes persist and are prefilled on checkout. | TC-CUS-027. |
| P1 | V1-ST-03, V1-ST-05 | DEF-12 | Store the season/category with the colour review (add column via new migration), show the saved profile in `/account` (load with `GET /api/colour-review`), and use it for recommendations (e.g. catalogue “In my colours” filter server-side on `colour_season`, or documented palette matching). Admin product form should constrain `colour_season` to the engine's 8 season names. | Saved profile survives a new device; catalogue filter returns only matching pieces; admin can tag pieces with valid seasons. | TC-ST-004/005/007, TC-CUS-013. |
| P1 | V1-GF-01 | DEF-10 | Per BD-4: either make gift membership a paid Razorpay flow with recipient activation, or show gifts in admin as leads with status handling. Remove claims the system cannot honour. | No gift record is created that nobody can see or pay for. | TC-CUS-061. |
| P1 | V1-MB-01 | DEF-31 | Align customer-facing copy with implemented rules: “Four credits every month”, “Next refresh”, “48-hour early access to drops”, “4 credits each paid month”. Either implement drop early access or remove the promise. | Every promise on `/membership`, `/gifting`, `/` is backed by working behaviour. | Content review + TC-MEM-001. |
| P1 | V1-CR-05 | DEF-04 | Enforce the BD-2 maximum balance on every grant (membership payment, admin adjustment, reversal) with a ledger note when capped. | Balance can never exceed the cap. | TC-MEM-015 automated. |
| P1 | V1-CW-10 | DEF-21 | Set `seller_gstin` and seller legal details (BD-7); print seller name, address and GSTIN on the invoice sheet; offer membership invoices to the customer. | Printed invoice shows seller GSTIN/name/address, buyer GSTIN when given. | TC-CUS-056. |
| P1 | V1-CW-13, V1-CW-07 | DEF-40 | Checkout and gifting form controls: stop inputs inheriting the 9 px label size (`.checkout-form input, select, textarea { font-size: 16px }`), give `select` the same padding/height as inputs. Labels may stay small caps. | At 360/390 px every checkout/gifting control computes ≥16 px font and ≥44 px height; no iOS zoom on focus. | TC-RSP-005, TC-RSP-005a. |
| P1 | Compliance | DEF-43 | Contact page and footer: registered business name, full address, support email, grievance officer name/contact (per BD-7), populated from `site.config.js`. | Details visible on `/contact` and in policy pages. | Manual + TC-CUS-070. |
| P1 | V1-SQ-08, V1-AD-11, V1-PI-04 | DEF-22 | Per BD-6: deploy to a persistent Node host with `UPLOADS_DIR` on persistent storage (or move uploads to object storage) and back it up. | Uploaded product images and videos survive a redeploy/restart. | Deploy smoke test. |

## 3. P2 — Fix before or during soft launch

| Priority | Requirement ID | Defect ID | Expected correction | Acceptance criteria | Retest |
|---|---|---|---|---|---|
| P2 | V1-AD-04 | DEF-29 | Wire the existing membership status override and credit set into the admin Membership table (with confirmation and audit). | Admin can pause/cancel/reactivate a member from UI. | TC-ADM-032. |
| P2 | V1-CW-11 | DEF-24 | Add optional photo upload to the damage claim form (existing `/api/upload` + `evidence_urls`); show evidence thumbnails in admin exchanges. | Damage claim carries up to 5 images visible to admin. | TC-CUS-059. |
| P2 | V1-OX-03 | DEF-25 | Exchange update: 404 for unknown id; allowed transitions (`requested→review→approved/rejected→completed`); optional customer email on decision. | Invalid id or transition rejected. | TC-ADM-051. |
| P2 | V1-MB-05, V1-CR-04 | DEF-32 | Hide the “Use wardrobe credit” toggle unless membership is `active`; return `membership_not_active` (not `insufficient_credits`) at checkout. | Paused member sees why credits are unavailable. | TC-MEM-014. |
| P2 | V1-CW-07 | DEF-26 | Require phone for delivery orders server-side. | API rejects delivery without phone. | TC-CUS-041. |
| P2 | Ops | DEF-14 | After a backup and owner approval, run `npm run migrate` against the live DB to record 015 and 016 (both idempotent; 016's DDL already exists). | `_schema_migrations` lists 015 and 016; `max_video_seconds` = 10. | Read-only query. |
| P2 | Ops | DEF-13 | Fix the `if/else` chain in `api/admin/ops.js` settings writer so `money`/`int` stay numbers; optionally add a Settings section to the admin UI for the editable keys. | `jsonb_typeof(value)='number'` after saving numeric settings. | TC-ADM-070 automated. |
| P2 | V1-AD-07 | DEF-30 | Dashboard: include membership revenue (separately labelled) and a date-range selector. | KPIs reconcile to `orders` + `membership_payments`. | TC-ADM-001. |
| P2 | Security | DEF-33 | Guest uploads: keep the rate limit, add periodic cleanup of upload files not referenced by any row after N days. | Orphans removed; referenced files kept. | New test. |
| P2 | Security | DEF-34 | Development origin allowance for `*.trycloudflare.com`: require explicit `CORS_ORIGINS` instead of a wildcard. | Arbitrary tunnel origins rejected unless listed. | TC-SEC-008 variant. |
| P2 | V1-CW-02 | DEF-44 | Catalogue sort `select` readable (≥14 px, ≥40 px tall); clear the search input when the category changes. | Computed styles meet minimums; no stale search text. | TC-RSP-002. |
| P2 | V1-CW-06 | DEF-41 | Guest-bag lines show the product image (store `image_url`/`images[0]` in the guest line). | Guest bag thumbnail matches PDP image. | TC-CUS-030. |
| P2 | V1-GF-01 | DEF-42 | Gifting guest message links to `/login?next=/gifting` and uses `role="status"`. | Guest can sign in from the message. | TC-CUS-063. |
| P2 | V1-CW-13 | DEF-45 | Membership primary CTA visible above the fold; higher-contrast skip-link focus outline. | CTA in first viewport at 390 and 1440; outline contrast ≥3:1. | TC-RSP-008. |

## 4. P3 — Hygiene and optional

| Priority | Requirement ID | Defect ID | Expected correction | Acceptance criteria | Retest |
|---|---|---|---|---|---|
| P3 | Routing | DEF-27 | Serve `/legal` as 301 → `/legal/privacy` (server) instead of 404. | `curl -I /legal` → 301. | TC-URL-010. |
| P3 | Code | DEF-28 | Remove the unused legacy admin modules (`api/admin/dashboard|products|orders|customers|content.js`) from `API_MODULES` after confirming no external caller. | Not mounted; admin UI unaffected. | TC-SEC-007 updated. |
| P3 | Payments | DEF-35 | `payment-verify`: treat a Razorpay 4xx on `fetchPayment` as a rejection, not “unreachable”; in membership activation, validate amount before capturing. | Unit tests for both branches. | TC-PAY-008 variant. |
| P3 | Credits | DEF-37 | Replace free-text “premium” badge detection with an explicit `credit_eligible` boolean on products. | Eligibility independent of badge text. | TC-MEM-016. |
| P3 | Content | DEF-38 | Admin editors for legal page body and store pickup settings (backend exists). | Owner edits legal text without a developer. | Manual. |
| P3 | Content | DEF-39 | Replace Unsplash placeholder imagery on home with studio assets. | No third-party stock images. | Visual. |
| P3 | Optional | DEF-23 | Configure `OPENAI_API_KEY` if the owner wants AI Listing Studio. | Suggestion returned; admin approves before save. | TC-ADM-060. |
| P3 | Docs | DOC-01 | Correct `../SYSTEM_FLOW_AND_CHECKLIST.md`, `docs/archive/2026-11-05-remediation-audit/verification-checklist.md` and the previous audit (MediaPipe, colour harmony filter, subscription, 30 s videos, “16 modules”, gift flow). Remove or reconcile `supabase_complete_schema.sql` with `migrations/`. | Docs describe the code. | Review. |
| P3 | Schema | OBS-01 | Decide on unused tables (`pricing_rules`, `payment_locks`, `product_photos`, `product_sources`, `story_consents`): keep for roadmap or drop in a migration. | Documented decision. | — |
| P3 | Observation | OBS-03 | Saved addresses (not explicit in V1): if wanted, add address update/delete API and a picker in checkout. | — | TC-CUS-029. |

## 5. Retest protocol

1. Every P0/P1 fix lands with an automated test in the existing harness (`test/helpers.js`), using time travel via SQL where dates matter (pattern used in audit probe P03).
2. Full suite (`npm test`) must stay at 0 failures with the integration suites **not skipped** (set `TEST_DATABASE_URL` or run the Docker/local cluster).
3. `npm run lint` 0 errors; `npm run build` succeeds.
4. Browser regression at 360/390/768/1366/1440 on `/`, `/catalogue`, PDP, `/cart`, `/checkout`, `/account`, `/membership`, `/admin/*`.
5. Staging sandbox payment through the real Razorpay modal (orders and membership), webhook delivery confirmed in `payment_events`.
6. Have the change independently code-reviewed before any push.
