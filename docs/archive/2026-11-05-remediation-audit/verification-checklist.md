# V1 Feature Verification & Acceptance Checklist

> **Superseded (7 Nov 2026).** This 5 Nov checklist predates the billing engine and was scored against the proposal, not the client specification. The current checklist is [`../../client/IMPLEMENTATION_CHECKLIST.md`](../../client/IMPLEMENTATION_CHECKLIST.md) (VS-DEV-001), generated from [`../../client/REQUIREMENTS_TRACEABILITY_MATRIX.md`](../../client/REQUIREMENTS_TRACEABILITY_MATRIX.md). Kept for history.

Each line states what is implemented and how it was verified (see `docs/archive/2026-11-05-remediation-audit/VISHREA_AUDIT_REMEDIATION_REPORT.md`).
`[x]` implemented and verified on an isolated database · `[ ]` open (owner action or blocked).

## 1. Storefront & core commerce
- [x] Home, catalogue (category, search, sort, in-stock, colour-season filter), product detail with per-size price/SKU/stock
- [x] Bag: add / update / remove, guest bag merged at sign-in, wardrobe credit and free-piece reward on eligible lines
- [x] Checkout: server-side prices and GST, studio pickup free / ₹99 delivery, phone required, idempotent, one-of-one never oversold
- [x] Razorpay: server order, HMAC verification, gateway cross-check, webhook de-duplication, late payments, automatic refunds (local gateway stand-in)
- [ ] Razorpay live keys, live webhook and a real sandbox payment through the modal (owner / staging)
- [x] GST invoice per paid order with seller legal name, address and GSTIN **when set in Settings**
- [ ] Seller legal name, address, GSTIN and grievance officer details entered (owner)

## 2. Walkin Wardrobe membership
- [x] 2-month (₹3,598) and 6-month (₹10,794) prepaid plans; nothing renews automatically
- [x] 4 credits granted at the start of every paid month (8 for a 2-month plan), once per month
- [x] Membership expires when the paid period ends; renewal at expiry or within the renewal window
- [x] Six-month progress; one free piece issued at the start of the 6th consecutive paid month, exactly once
- [x] Credits expire 60 days after grant; Premium pieces excluded
- [ ] Maximum credit balance, pause effect on paid period and credits, 6-month prepaid qualification (owner decisions — settings ready)

## 3. Wardrobe Bag, referrals, gifting
- [x] Save to Wardrobe Bag (PDP), Wardrobe Bag page, move to bag with credit or free-piece reward
- [x] Referral code and link per customer; ₹150 off a new customer's first 2-month membership; referrer earns one free piece when that payment is verified
- [x] Gift enquiry form (individual / corporate); admin processes → invoices → issues one-time hashed redemption codes; recipient redeems
- [ ] Refund-after-reward reversal policy (owner decision — rewards are flagged, not revoked)

## 4. Orders & exchanges
- [x] Order history, live tracking, printable invoice
- [x] Exchange / damage request with optional photos; admin transitions validated

## 5. On-device colour analysis
- [x] Photo / camera analysis in the browser (Canvas + CIELAB, fixed face-area sampling — no MediaPipe); no image is uploaded or stored
- [x] Saved colour profile (undertone, season, palette) shown in the account and to the admin; catalogue filter by season

## 6. Admin (`/admin`)
- [x] Products (credit eligibility, colour season), categories, orders, customers with drill-down, memberships with status override, credits, rewards, referrals, gift enquiries, exchanges, Store Mode, content (videos ≤10 s, ≤3 live; Instagram links; legal and pickup editors), invoices, settings, audit log
- [ ] AI Listing Studio needs `OPENAI_API_KEY` (optional)

## 7. Security & operations
- [x] Production refuses weak/leaked JWT secrets, OTP echo, missing Razorpay/DB/https configuration
- [x] Development refuses a remote database unless explicitly allowed; never echoes OTPs against one
- [x] Bootstrap admin only when no admin exists
- [ ] Rotate JWT secret, review live admin accounts, verify Resend domain, run migrations 015–017 on production (owner-approved, see report)
