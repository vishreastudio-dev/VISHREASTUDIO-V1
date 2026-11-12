# Release Checklist

| Field | Value |
|---|---|
| Document ID | VS-REL-001 |
| Document title | Production Release Checklist |
| Version | 1.0 |
| Status | In progress — features built and tested; live set-up and approval pending |
| Prepared date | 7 November 2026 |
| Last updated | 11 November 2026 |
| Source of truth | [Gap Analysis](GAP_ANALYSIS.md) P0 items · [Security Audit](../technical/SECURITY_AUDIT.md) · [Client Decisions](CLIENT_DECISIONS_REQUIRED.md) |

Every box must be ticked, with the name of the person and the date, before production. **Do not deploy without the owner's written approval (§10).**

## Client update — 11 November 2026

This section is what you can send the studio. Nothing below is live on the public site yet. Payments below were checked on a local stand-in, not on Razorpay’s live account.

**How to read the boxes:** [x] means built and tested on the test shop. [ ] means still to do. A ticked box does not mean it is live: payments were tested with a stand-in, not your Razorpay account.

**Progress at a glance:** the shop, accounts, checkout, membership, gifts, Wardrobe Bag, colour analysis, admin, and security checks are built and tested. What is left is mostly your accounts and approvals: Razorpay live, email domain, legal details, web address, backup, and sign-off.

### Shop and catalogue

- [x] Home page with the studio edit and homepage carousel (managed from admin)
- [x] Catalogue by category, with search
- [x] Product page: photos, sizes, price, delivery and exchange notes
- [x] Questions on a product page
- [x] Sold-out pieces marked; a sold-out size cannot be added to the bag
- [x] “Request a Piece” removed from the shop and admin
- [x] Search titles, page descriptions, and sitemap for Google
- [ ] Search link on the mobile menu (desktop has it; mobile planned after launch)

### Sign-in and account

- [x] Sign in with an email code; no password
- [x] Guest bag kept after sign-in
- [x] Profile, addresses, and notification choices
- [x] Sign out ends the session on the server too
- [x] “Delete my account and data”: needs a typed confirmation and stops billing first
- [ ] 18+ confirmation required at sign-up (the field is saved today but sign-up does not require it yet; decision P0-03)

### Bag, checkout, and orders

- [x] Home delivery ₹99 or free studio pickup in Bengaluru; prices include GST
- [x] Prices worked out by the server; the browser cannot change them
- [x] Payment step built for Razorpay (UPI, cards, net banking), tested with a stand-in
- [x] A failed or cancelled payment never confirms an order; no double charge on retry
- [x] Orders page, order tracking, and invoices
- [x] Exchange and damage requests from the order, with private photo evidence
- [ ] Real payment and refund on your live Razorpay account

### Walkin Wardrobe membership

- [x] Join for ₹3,598 for the first 2 months; 4 credits when the membership starts
- [x] Monthly ₹1,799 by UPI Autopay after the first 2 months (built; tested with a stand-in)
- [x] Credits expire after 60 days
- [x] Free piece tied to the 6th paid month, not to the day you join
- [x] Save pieces and use credits on eligible pieces
- [x] Pause, resume, and cancel
- [x] A failed membership payment never activates the membership
- [ ] Razorpay Subscriptions and UPI Autopay switched on in your live account
- [ ] Your written decision if you want **no autopay** and a **6-month prepay of ₹10,794** instead (today's shop sells 2 months then monthly autopay; changing it affects existing mandates)

### Wardrobe Bag and gifts

- [x] Ship the Wardrobe Bag: free studio pickup, ₹99, or free when 4 or more pieces ship together
- [x] Buy a gift membership
- [x] Redeem a gift code

### Colour analysis

- [x] Find your colours on the phone
- [x] The photo stays on the phone; it is never uploaded or stored
- [ ] Check on real Android Chrome and iPhone Safari after launch

### Help and policies

- [x] Help & contact, shipping, returns, damage, privacy, and terms pages
- [ ] Your legal name, address, and grievance officer entered in Admin → Settings (Contact page hides them until set)
- [ ] Your review of the policy wording

### Studio admin

- [x] Orders: dispatch, store sale, refunds
- [x] Catalogue, stock, and photos
- [x] Membership, credits, and billing records
- [x] Courier companies; tracking links follow the courier picked at dispatch
- [x] Settings: prices, shipping, membership rules, GST
- [x] Only approved admin accounts can open admin; customers are turned away by the server
- [x] Admin changes recorded with who, what, and when
- [ ] Second sign-in step for admins on refunds and credit changes (optional; your decision)

### Security and testing

- [x] 207 automated tests passed, 0 failed (11 Nov 2026)
- [x] Dependency check: 0 known vulnerabilities (11 Nov 2026)
- [x] Security review: sign-in, sessions, admin access, payments, uploads, private files (verdict: conditional pass, pending live set-up)
- [x] Test copy kept separate from live data; no live customer records used in testing
- [x] Production website build succeeds

### Still pending — needs you

- [ ] Approve this release and the uncommitted work (nothing committed or deployed yet)
- [ ] Razorpay live account: keys, webhook, Subscriptions and UPI Autopay
- [ ] Email domain verified with Resend (SPF and DKIM)
- [ ] Legal details and grievance officer in Admin → Settings
- [ ] Website address, DNS, and HTTPS
- [ ] Database backup immediately before go-live
- [ ] First real low-value order and refund after launch, on your Razorpay account

The sections below are the release controls. Each one is ticked only when there is evidence for it.

## 1. Scope and approvals

- [ ] V1 scope confirmed in writing: signed V1 Proposal or written decisions on DEC-12 (WhatsApp, Google/Meta, Instagram)
- [ ] All P0 decisions answered: DEC-01, DEC-02, DEC-03, DEC-10, DEC-13, DEC-14, DEC-18, DEC-25
- [ ] Third-party list approved (SEC-09): Razorpay, Resend, PostgreSQL host, hosting provider, optional AI provider
- [ ] Every account is in Vishrea Studio's name with named logins (SEC-01)

## 2. Code and build

- [ ] All work committed; the client specification PDF is not committed to a shared repository (S-11)
- [ ] Independent code review of the release diff
- [ ] `npm ci` (root and `vishrea-react/`) on the release machine
- [x] `npm run build` — passed 11 Nov 2026
- [x] `npm test` → 140/140 (or more) with 0 skipped, against a disposable PostgreSQL — **207/207, 0 skipped, 11 Nov 2026**
- [x] `npm audit --omit=dev` → 0 high/critical; `npm run lint` → 0 errors — **0 vulnerabilities; lint 0 errors, 11 Nov 2026**
- [ ] Admin two-step verification and Owner/Helper roles in place (P0-02)
- [ ] 18+ and consent at sign-up (P0-03)

## 3. Payments (Razorpay)

- [ ] Live account KYC complete; **Subscriptions and UPI Autopay enabled**
- [ ] Retry policy set to 3 attempts over 5 days (matches `autopay_retry_count` / `autopay_retry_days`)
- [ ] Webhook URL `https://<domain>/api/webhooks/razorpay` with events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `subscription.authenticated`, `.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, `.completed`, `.paused`, `.resumed`
- [ ] `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` set in the host's secret store (never in files committed to git)
- [ ] Every credential that has ever appeared in git history rotated before go-live (Security Audit S-16): JWT secret, OTP pepper, Razorpay keys and webhook secret, Resend key, database password, Supabase keys
- [ ] Sandbox rehearsal recorded: order paid by UPI; refund; membership sign-up ₹3,598 + mandate; month-3 ₹1,799 debit (or Razorpay test trigger); failed debit → retries → paused; recovery; pause/resume; cancel from the UPI app; Wardrobe Bag ₹99; online gift
- [ ] Optional `RAZORPAY_MEMBERSHIP_PLAN_ID` matches ₹1,799 monthly (otherwise the app creates the plan)

## 4. Configuration

- [ ] `NODE_ENV=production`, strong `JWT_SECRET` and `OTP_PEPPER`, `APP_ORIGIN` https, `TRUST_PROXY` set for the proxy
- [ ] `ADMIN_ALLOWED_EMAILS` = owner-approved admins
- [ ] `RESEND_API_KEY`, `EMAIL_FROM` with a verified sender domain; test delivery
- [ ] `UPLOADS_DIR` on persistent storage
- [ ] `ALLOW_REMOTE_DATABASE` **unset** in production; `DATABASE_SSL=true`
- [ ] Admin → Settings reviewed: prices, upfront/lock-in, credits, expiry, holding limit, pause, retries, early access, payment lock (DEC-09), shipping, gift packing, GST, exchange windows; free-piece eligible pieces (DEC-03); legal details entered and **verified** (DEC-14)
- [ ] Live legal pages updated (privacy, terms incl. membership terms, exchange & damage) (MEM-16, NFR-05)

## 5. Database and migrations

- [ ] Production backup taken immediately before migrating; restore tested on a copy
- [ ] `npm run migrate` applied migrations up to 020; `_schema_migrations` shows 20 rows
- [ ] RLS/privilege check: no table readable by `anon`/`authenticated`
- [ ] Database region confirmed in India; encryption at rest confirmed (DEC-13)

## 6. Security

- [ ] Vulnerability scan and basic penetration test on staging; critical/high fixed; report shared (SEC-07)
- [ ] HTTPS only; HSTS and CSP active (check response headers)
- [ ] Incident-response runbook agreed (owner contact, 6-hour reporting) (SEC-08)
- [ ] Audit-log retention ≥ 1 year confirmed (SEC-05)

## 7. Monitoring and operations

- [ ] Uptime monitor on `/api/health`
- [ ] Log shipping/retention; alert on `jobs.*_failed`, `webhook.processing_failed`, `payment.refund_needs_operator` (NFR-06)
- [ ] Daily backups retained 30 days (NFR-03); restore drill done
- [ ] Owner knows where to see failed payments, pauses and cancellations (CSV exports today; BO-07)

## 8. Smoke test on production

- [ ] Home, catalogue, product, sign-in (code received), bag, checkout with a real low-value payment, refund
- [ ] Membership sign-up with a real UPI mandate (owner's own account), then cancel after test as agreed
- [ ] Admin: order dispatch, store sale, settings save
- [ ] Mobile check on Android Chrome and iPhone Safari (incl. camera colour analysis)

## 9. Rollback

- [ ] Previous build kept and re-deployable
- [ ] Database restore point recorded; migrations are forward-only, so rollback = restore backup + previous build
- [ ] Razorpay webhook can be disabled from the dashboard during rollback

## 10. Final approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Owner (Vishrea Studio) | | | |
| Developer (V Dev) | | | |
