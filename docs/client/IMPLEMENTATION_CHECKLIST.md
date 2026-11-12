# Implementation Checklist

| Field | Value |
|---|---|
| Document ID | VS-DEV-001 |
| Document title | Implementation Checklist |
| Version | 1.0 |
| Status | Baseline — generated from VS-REQ-001 |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | [Requirements Traceability Matrix](REQUIREMENTS_TRACEABILITY_MATRIX.md) (every line below is produced from its rows; edit the matrix, then run `node scripts/generate-checklist.js`) |

Legend:
- `[x]` **Verified complete** — proven by an executed automated test or a recorded inspection, with no unverified live dependency.
- `[ ]` **Remaining** — implemented but untested, partial, UI/back-end/database only, or not implemented. The status after each line says which.
- `[!]` **Blocked or awaiting client approval** — see [Client Decisions](CLIENT_DECISIONS_REQUIRED.md) and [Gap Analysis](GAP_ANALYSIS.md).

Summary (127 requirement rows): **16** `[x]`, **92** `[ ]`, **12** `[!]`, **7** not applicable to Release 1.0.

> `[x]` never means "live in production". Nothing is deployed; payment features are proven only against a local Razorpay stand-in and are therefore not marked `[x]`.

## Membership

- [!] **MEM-01** Plan and billing — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: Enable Razorpay Subscriptions + UPI Autopay; sandbox rehearsal
- [x] **MEM-02** Benefits — *VERIFIED COMPLETE*
- [x] **MEM-03** What a credit is — *VERIFIED COMPLETE*
- [ ] **MEM-04** Rollover and expiry — *PARTIALLY IMPLEMENTED*. Remaining: Show per-credit expiry dates (API returns `ledger.expires_at`)
- [!] **MEM-07** Missed payment — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: Razorpay retry config; WhatsApp API (DEC-12)
- [ ] **MEM-08** Pause — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Live Razorpay pause/resume; lock-in pause rule (DEC-05)
- [ ] **MEM-09** Cancel — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Live `subscription.cancelled` check
- [ ] **MEM-12** Any membership as a gift — *PARTIALLY IMPLEMENTED*. Remaining: Autopay gift (DEC-08)
- [ ] **MEM-13** Two gift modes — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Live email delivery; WhatsApp link (blocked)
- [ ] **MEM-14** Pre-booked gifts — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Test the ending reminder
- [ ] **MEM-16** Membership terms page — *PARTIALLY IMPLEMENTED*. Remaining: Update live legal page; owner approval
- [ ] **ACC-01** Wearers in My Vishrea — *PARTIALLY IMPLEMENTED*. Remaining: Per-wearer colour passport
- [ ] **ACC-02** Account contents — *PARTIALLY IMPLEMENTED*. Remaining: See MEM-04, INV-02, SHP-05
- [ ] **ACC-03** Loyalty progress — *PARTIALLY IMPLEMENTED*. Remaining: Depends on LOY-BLD and LOY-P1
- [ ] **ACC-04** Referral and membership controls — *PARTIALLY IMPLEMENTED*. Remaining: WhatsApp/Instagram share buttons
- [x] **ACC-05** Delete my account and data — *VERIFIED COMPLETE*

## Payments and invoicing

- [!] **PAY-01** Razorpay — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: Live keys; Subscriptions/UPI Autopay activation
- [ ] **PAY-02** No cash on delivery — *PARTIALLY IMPLEMENTED*. Remaining: Either wire the switch or remove it (no COD flow requested)
- [x] **PAY-03** Payment lock, never charged twice — *VERIFIED COMPLETE*
- [ ] **INV-01** Automatic GST invoice — *PARTIALLY IMPLEMENTED*. Remaining: Seller legal details (DEC-14); store seller details on each invoice (today read from current settings when displayed, so old invoices change if settings change); membership invoices assume intra-state; HSN falls back to `6204`; bag-fee and gift invoices; accountant GST confirmation
- [ ] **INV-02** Invoice access — *PARTIALLY IMPLEMENTED*. Remaining: PDF generation + email attachment

## Catalogue, customers and AI

- [ ] **CUS-01** Age 18+ — *BACKEND ONLY*. Remaining: Ask and enforce 18+ on first sign-in (server-side)
- [ ] **CUS-02** Wearer profiles — *PARTIALLY IMPLEMENTED*. Remaining: Colour passport per wearer (colour profile is saved per account, `colour_reviews.auth_user_id`)
- [ ] **CUS-03** Wearer switcher — *NOT IMPLEMENTED*. Remaining: Global wearer context + filters
- [ ] **CUS-04** Sizes and Plus measurement filter — *PARTIALLY IMPLEMENTED*. Remaining: Fixed size list; measurement range filter
- [ ] **CUS-05** Occasions vs Premium — *PARTIALLY IMPLEMENTED*. Remaining: Occasion list; force Premium for festive/party/birthday
- [ ] **CUS-06** Gifting — *PARTIALLY IMPLEMENTED*. Remaining: See MEM-12, MEM-15
- [ ] **CAT-01** Admin categories — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Create the launch category set in admin; category CRUD test
- [ ] **CAT-02** Piece record — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Fabric list; automated "no cost exposure" test
- [ ] **CAT-03** Three photos, logo, "1 of 1" — *PARTIALLY IMPLEMENTED*. Remaining: Photo roles (3 required); logo overlay (see BO-01)
- [ ] **CAT-04** Pricing helper — *PARTIALLY IMPLEMENTED*. Remaining: Markup rules setting; margin + slab display (owner to supply rules, DEC-15)
- [x] **CAT-05** GST per piece — *VERIFIED COMPLETE*
- [ ] **CAT-06** One stock, gone within 2 s — *PARTIALLY IMPLEMENTED*. Remaining: Overselling is impossible; display latency can exceed 2 s (cache)
- [ ] **CAT-07** Payment lock and messages — *PARTIALLY IMPLEMENTED*. Remaining: Messages + 3 similar pieces; default 5 min (DEC-09)
- [ ] **CAT-08** 21-day offer rule — *PARTIALLY IMPLEMENTED*. Remaining: Automatic move to offers (needs offer engine, LOY-BLD); stock age is computed from `inventory.updated_at`, which every stock sync resets — use `products.listed_at`
- [x] **CAT-09** Weekly drops + 48 h early access — *VERIFIED COMPLETE*
- [ ] **CAT-10** "Gone to a new home" gallery — *NOT IMPLEMENTED*. Remaining: Gallery page
- [ ] **CAT-11** Gap alerts — *PARTIALLY IMPLEMENTED*. Remaining: Demand signal + weekly alert
- [ ] **BO-01** AI listing studio — *PARTIALLY IMPLEMENTED*. Remaining: Image processing; AI provider credentials (BLOCKED for live use)
- [ ] **AI-PFC** "Picked for your colours" [1.0] — *PARTIALLY IMPLEMENTED*. Remaining: Ranking + home section
- [ ] **AI-01** AI never publishes or prices alone — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Test
- [x] **AI-02** Face photos — *VERIFIED COMPLETE*

## Shopping journey and checkout

- [ ] **LF-01** Sign-in method — *PARTIALLY IMPLEMENTED*. Remaining: Phone OTP needs an SMS/WhatsApp provider (DEC-07)
- [ ] **LF-02** "Who are you shopping for?" step — *NOT IMPLEMENTED*. Remaining: Depends on CUS-03
- [ ] **SHP-01** Colour analysis — *PARTIALLY IMPLEMENTED*. Remaining: Per-wearer passport; full sub-type list; real-device camera test
- [ ] **SHP-02** Home page — *PARTIALLY IMPLEMENTED*. Remaining: Personalised sections
- [ ] **SHP-03** Browse and filter — *PARTIALLY IMPLEMENTED*. Remaining: Size, occasion, price range, Premium filters
- [ ] **SHP-04** Product page — *PARTIALLY IMPLEMENTED*. Remaining: "Style it with" logic; credit-eligibility label check
- [ ] **SHP-05** Look builder — *DATABASE ONLY*. Remaining: Look builder UI + share links
- [x] **SHP-06** Cart — *VERIFIED COMPLETE*
- [ ] **SHP-07** Checkout — *PARTIALLY IMPLEMENTED*. Remaining: Address picker; "UPI first" method order in Razorpay Checkout (no display config today); live Razorpay
- [ ] **SHP-08** Confirmation — *PARTIALLY IMPLEMENTED*. Remaining: PDF invoice attachment; WhatsApp (blocked)
- [ ] **SHP-09** Mobile-first — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Re-check new screens (Membership, Wardrobe Bag, Gifting)

## Rewards and loyalty

- [x] **MEM-10** Member loyalty (6th month) — *VERIFIED COMPLETE*
- [ ] **LOY-BLD** Owner-controlled rule builder — *PARTIALLY IMPLEMENTED*. Remaining: Rule engine in pricing/checkout (DEC-11)
- [ ] **LOY-P1** 6th Order 50% — *NOT IMPLEMENTED*. Remaining: Needs LOY-BLD or a dedicated rule
- [x] **LOY-P2** 6th Month Free Piece — *VERIFIED COMPLETE*
- [ ] **LOY-P5** Face of the Week — *NOT IMPLEMENTED*. Remaining: Voucher engine (LOY-BLD)
- [ ] **LOY-P6** Birthday reward — *DATABASE ONLY*. Remaining: Owner to define reward (DEC-15)
- [ ] **LOY-01** Profit guard — *PARTIALLY IMPLEMENTED*. Remaining: Computed estimate + below-cost warning
- [ ] **LOY-02** Results per rule — *NOT IMPLEMENTED*. Remaining: Depends on LOY-BLD
- [ ] **REV-01** Vishrea Stories — *PARTIALLY IMPLEMENTED*. Remaining: Face of the Week pick
- [ ] **REV-02** Consent before showing a post — *DATABASE ONLY*. Remaining: Consent flow (needs WhatsApp or email link)

## Referrals

- [x] **LOY-P3** Referral reward — *VERIFIED COMPLETE*
- [!] **LOY-P4** Referral welcome — *PENDING CLIENT APPROVAL*. Remaining: Written confirmation of ₹150 vs ₹100 (DEC-01)
- [x] **LOY-03** Referral safety — *VERIFIED COMPLETE*

## Shipping and Wardrobe Bag

- [x] **MEM-05** A credit is a payment — *VERIFIED COMPLETE*
- [ ] **MEM-06** Wardrobe Bag — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Live Razorpay check of ₹99 payment; wearer per pick
- [ ] **MEM-15** Gift packing — *PARTIALLY IMPLEMENTED*. Remaining: Gift flag + message in admin orders; price-free packing slip
- [ ] **SHP-10** Courier set-up — *PARTIALLY IMPLEMENTED*. Remaining: Admin-editable courier list; courier integration proposal
- [x] **SHP-11** India only — *VERIFIED COMPLETE*
- [ ] **SHP-12** Dispatch promise — *PARTIALLY IMPLEMENTED*. Remaining: Dispatch-due indicator in admin
- [ ] **SHP-13** Studio pickup — *PARTIALLY IMPLEMENTED*. Remaining: Credit redemption in the Store Mode UI; test
- [!] **SHP-14** Tracking on WhatsApp — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: WhatsApp API (DEC-12)

## Orders, exchanges and returns

- [ ] **EXC-01** 7-day exchange — *PARTIALLY IMPLEMENTED*. Remaining: Per-piece exchange selection; tests for credit-redeemed and Premium pieces
- [ ] **EXC-02** Didn't like it — *PARTIALLY IMPLEMENTED*. Remaining: Store credit + ₹99 return fee (DEC-16)
- [ ] **EXC-03** Damaged — *PARTIALLY IMPLEMENTED*. Remaining: Refund/exchange choice; test for the photo rule
- [ ] **EXC-04** Manual claim handling — *PARTIALLY IMPLEMENTED*. Remaining: Photo view; restock/write-off with stock update
- [ ] **BO-03** Orders — *PARTIALLY IMPLEMENTED*. Remaining: Gift flag + message; packing slip
- [ ] **BO-05** Exchange and damage queue — *PARTIALLY IMPLEMENTED*. Remaining: Photos, quality check and return tracking on screen (EXC-04)

## Admin and back office

- [ ] **BO-02** Inventory — *PARTIALLY IMPLEMENTED*. Remaining: 21-day automation (CAT-08); gap alerts (CAT-11)
- [ ] **BO-04** Store mode — *PARTIALLY IMPLEMENTED*. Remaining: Razorpay QR; store-mode test
- [ ] **BO-06** Customer records — *PARTIALLY IMPLEMENTED*. Remaining: Owner notes; membership events/attempts in the drill-down
- [ ] **BO-07** Membership operations — *PARTIALLY IMPLEMENTED*. Remaining: Admin screens for the three lists
- [ ] **BO-08** Sourcing log — *PARTIALLY IMPLEMENTED*. Remaining: Supplier performance report
- [ ] **BO-09** Users and roles — *PARTIALLY IMPLEMENTED*. Remaining: Owner/Helper permissions
- [ ] **ADM-01** Dashboard — *PARTIALLY IMPLEMENTED*. Remaining: Profit, churn, acquisition cost (needs NFR-07)
- [ ] **ADM-02** Excel export — *PARTIALLY IMPLEMENTED*. Remaining: Excel (.xlsx) and remaining screens (DEC-17)
- [ ] **ADM-03** Settings, none hard-coded — *PARTIALLY IMPLEMENTED*. Remaining: Wire unused settings; DEC-09
- [ ] **ADM-04** Works on a phone — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Re-test new admin areas
- [ ] **ADM-05** Occasional controls — *PARTIALLY IMPLEMENTED*. Remaining: Users & roles, templates, banner

## Security, privacy and quality

- [ ] **NFR-01** Speed — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Lighthouse/WebPageTest on the deployed site
- [ ] **NFR-02** Drop-time load — *PARTIALLY IMPLEMENTED*. Remaining: Load test; cache latency (CAT-06)
- [ ] **NFR-03** Security — *PARTIALLY IMPLEMENTED*. Remaining: Admin 2-step (DEC-10); backup policy evidence
- [ ] **NFR-04** Privacy (DPDP) — *PARTIALLY IMPLEMENTED*. Remaining: Consent at sign-up; confirm Supabase region is India (DEC-13)
- [ ] **NFR-05** Legal pages — *PARTIALLY IMPLEMENTED*. Remaining: Owner to supply details (DEC-14)
- [ ] **NFR-06** Monitoring — *NOT IMPLEMENTED*. Remaining: Alerting (needs WhatsApp or another channel)
- [ ] **NFR-07** Marketing tracking — *NOT IMPLEMENTED*. Remaining: Tags + consent (DEC-13)
- [x] **NFR-08** Language — *VERIFIED COMPLETE*
- [ ] **NFR-09** Design — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Client design sign-off
- [ ] **NFR-10** Ownership and handover — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Confirm repository/account ownership; handover at release
- [!] **SEC-01** Accounts in Vishrea's name — *PENDING CLIENT APPROVAL*. Remaining: Owner confirmation per account
- [ ] **SEC-02** Secure development — *PARTIALLY IMPLEMENTED*. Remaining: Rotate any credential that ever appeared in git; confirm the repository is private (Security Audit S-16)
- [ ] **SEC-03** Customer data (DPDP) — *PARTIALLY IMPLEMENTED*. Remaining: Confirm staging holds no real customer data
- [x] **SEC-04** Payment data — *VERIFIED COMPLETE*
- [ ] **SEC-05** Access control — *PARTIALLY IMPLEMENTED*. Remaining: 2-step; roles (DEC-10)
- [ ] **SEC-06** Encryption — *IMPLEMENTED — TESTING REQUIRED*. Remaining: Provider confirmation
- [ ] **SEC-07** Pre-launch testing — *NOT IMPLEMENTED*. Remaining: Run before go-live
- [ ] **SEC-08** Incident reporting — *NOT IMPLEMENTED*. Remaining: Incident runbook (see Release Checklist)
- [!] **SEC-09** Third parties — *PENDING CLIENT APPROVAL*. Remaining: Written approval of the list

## Integrations and omnichannel

- [!] **NOT-01** WhatsApp as main channel — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: WhatsApp Business API account and templates (deferred in proposal, DEC-12)
- [ ] **NOT-02** Email and SMS — *PARTIALLY IMPLEMENTED*. Remaining: Verify sender domain; SMS backup (DEC-07)
- [ ] **NOT-03** Message choices — *IMPLEMENTED — TESTING REQUIRED*. Remaining: UI test
- [ ] **OMN-APP** Installable web app — *NOT IMPLEMENTED*. Remaining: PWA manifest + service worker
- [!] **OMN-01** WhatsApp number check — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: Owner/Meta confirmation
- [!] **OMN-02** Instagram Shop links out — *PENDING CLIENT APPROVAL*. Remaining: Deferred in proposal (DEC-12)
- [!] **OMN-03** Live catalogue sync — *PENDING CLIENT APPROVAL*. Remaining: Deferred in proposal (DEC-12)
- [ ] **OMN-04** Clean catalogue photos + structured data — *PARTIALLY IMPLEMENTED*. Remaining: Logo-free image generation (BO-01)
- [ ] **OMN-05** Late clicks — *PARTIALLY IMPLEMENTED*. Remaining: Message + colour/size matching
- [!] **OMN-06** Merchant accounts — *BLOCKED BY EXTERNAL PROVIDER*. Remaining: Deferred in proposal

## Acceptance tests for 1.0 (spec §14)

- [ ] **AT-01** Two customers pay for the same piece: one charged; other sees "This piece just found a new home" — *PARTIALLY IMPLEMENTED*
- [ ] **AT-02** Store-mode sale disappears online within 2 s — *PARTIALLY IMPLEMENTED*
- [!] **AT-03** New member pays 2 months upfront by UPI Autopay; 4 credits; month 2 issues 4 more — *BLOCKED BY EXTERNAL PROVIDER (live UPI Autopay)*
- [x] **AT-04** Credit unused 60 days expires; cancelling lapses all credits — *VERIFIED COMPLETE*
- [!] **AT-05** Autopay fails: 3 retries / 5 days, WhatsApp reminders, credits frozen, then paused — *BLOCKED BY EXTERNAL PROVIDER*
- [ ] **AT-06** Ship 4 credit picks free; ship 2 and pay ₹99 — *IMPLEMENTED — TESTING REQUIRED (live ₹99 payment)*
- [x] **AT-07** Credits cannot be used on Premium — *VERIFIED COMPLETE*
- [ ] **AT-08** ₹2,800 piece with a 15% offer invoiced at 5% (₹2,380) — *PARTIALLY IMPLEMENTED*
- [ ] **AT-09** Non-member's 6th order ≥ ₹4,000 gets 50% off regular pieces — *NOT IMPLEMENTED*
- [x] **AT-10** After 5 paid months, 6th month issues 4 credits + 1 free piece; pause/missed payment resets — *VERIFIED COMPLETE (free piece is a separate reward — DEC-02)*
- [!] **AT-11** Referral credit only after the first payment; new member gets ₹100 off — *PENDING CLIENT APPROVAL (DEC-01)*
- [ ] **AT-12** Gift order adds ₹50; packing slip shows no prices — *PARTIALLY IMPLEMENTED*
- [ ] **AT-13** Cancelling takes no more than two taps — *IMPLEMENTED — TESTING REQUIRED*
- [x] **AT-14** Face photo gone from storage after the result is saved — *VERIFIED COMPLETE*
- [ ] **AT-15** Every §12 setting changeable in admin without code — *PARTIALLY IMPLEMENTED*
- [ ] **AT-16** *(soft launch on the live system)* — *NOT IMPLEMENTED*

## Not applicable to Release 1.0

- **AI-1.1 / AI-2.0** Style my 4, fit confidence, alerts, assistants, planners, try-on, content engine — release 1.1/2.0 or contractual
- **REV-03** Live Instagram feed — release 1.1/2.0 or contractual
- **REV-04** Vishrea Points — release 1.1/2.0 or contractual
- **BO-10** QR tags, scan-to-pack, printing — release 1.1/2.0 or contractual
- **BO-11** Data migration — release 1.1/2.0 or contractual
- **SEC-10** Team confidentiality — release 1.1/2.0 or contractual
- **SEC-11** Exit — release 1.1/2.0 or contractual
