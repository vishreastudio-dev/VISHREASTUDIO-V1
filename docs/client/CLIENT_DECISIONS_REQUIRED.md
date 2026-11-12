# Client Decisions Required

| Field | Value |
|---|---|
| Document ID | VS-DEC-001 |
| Document title | Client Decisions Required |
| Version | 1.0 |
| Status | Open — awaiting owner (Suma S. Hubballi) |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | Requirements Specification v1.0 · client clarifications of 7 Nov 2026 · V1 Proposal VDEV-VS-V1-2026-10 · [Requirements Traceability Matrix](REQUIREMENTS_TRACEABILITY_MATRIX.md) |

Each item names the requirement, the question, why it matters, what is implemented today, and which work is blocked. Nothing below has been decided by the developer; where code already exists, it follows the stated current behaviour and can be changed through Settings unless noted.

## A. Conflicts between sources

| ID | Requirement | Question | Why it matters | Current behaviour | Blocked work |
|---|---|---|---|---|---|
| DEC-01 | LOY-P4, AT-11 | Is the referral welcome discount **₹150 off the first 2 months** (clarification 7 Nov) or **₹100 off the first payment** (spec §8, AT-11)? | Changes the amount charged at sign-up and the acceptance test | ₹150 (`referral_discount_inr`, editable) | Sign-off of AT-11 |
| DEC-02 | MEM-10, AT-10 | Is the 6th-month free piece a **separate reward on owner-selected pieces** (clarification) or **one extra credit that month (5 credits)** (spec)? | A credit can be spent on any shared-pool piece; a reward only on selected pieces | Separate reward entitlement | Sign-off of AT-10 |
| DEC-03 | MEM-10, LOY-P3 | Which pieces or categories can be taken with a free-piece reward, and is there a price ceiling? | **No piece is eligible today**, so rewards cannot be redeemed | Empty selection (Settings → Free-piece rewards) | Redemption of every free-piece reward |
| DEC-04 | MEM-01 | Retire the 6-month prepaid sign-up, as the spec has only "2 months upfront then monthly"? | Existing prepaid members keep their months; new members can only join on autopay | Only the 2-month + autopay sign-up is on sale (migration 019) | — (confirm) |
| DEC-12 | NOT-01, SHP-14, OMN-02/03/06, REV-02 | The V1 Proposal defers the WhatsApp Business API, Google/Meta catalogue sync and the Instagram API. The repository copy is **unsigned**. Is the proposal accepted as the V1 scope? | Determines whether WhatsApp notifications, catalogue sync and consent links are V1 work or a later phase | Treated as pending: email is used; WhatsApp is logged as "not configured" | NOT-01, MEM-07 reminders, SHP-14, OMN-03, REV-02 |
| DEC-07 | LF-01, NOT-02 | Spec: phone number + OTP by WhatsApp with SMS backup. Built: email OTP. Accept email OTP for V1, or add an SMS/WhatsApp OTP provider? | Changes sign-in for every customer and requires a paid provider | Email OTP (Resend) | LF-01, NOT-02 |
| DEC-09 | CAT-07, PAY-03 | Payment lock: spec default **5 minutes**; built default **15 minutes** (UPI approvals can take longer). Which default? | Shorter holds free pieces sooner; too short can expire mid-payment (late payments are refunded automatically) | 15 min (`reservation_minutes`, 5–60) | — |

## B. Membership and billing rules

| ID | Requirement | Question | Why it matters | Current behaviour | Blocked work |
|---|---|---|---|---|---|
| DEC-05 | MEM-08 | May a member pause during the 2-month lock-in? | Razorpay can pause only an *active* subscription, which starts at the first monthly debit | Pause refused until the lock-in ends | — |
| DEC-20 | MEM-08 | Spec marks "credits keep their original expiry during a pause" as *proposed*. Confirm. | Credits issued just before a pause may expire during it | Credits keep their original expiry | — |
| DEC-22 | MEM-08 | May a member end a pause early? | Affects billing date and the loyalty count | Allowed ("Resume now") | — |
| DEC-23 | MEM-10 | Do gifted (prepaid) months count toward the 6th-month free piece? | Gift recipients who continue on autopay | Gifted months never earn the piece | — |
| DEC-06 | MEM-10, LOY-P3 | Do free-piece rewards expire? If so, after how long? | Unlimited liability on the books | Rewards do not expire | Reward expiry |
| DEC-08 | MEM-12 | Should a gift also be possible as an **autopay** membership paid by the gifter (spec: "same terms")? | Needs a mandate on the gifter's account for someone else's membership | Gifts are prepaid only (2/3/6/12 months) | MEM-12 completion |
| DEC-19 | MEM-06 (spec open item) | Do a member's *paid* pieces shipped together with a free Wardrobe Bag shipment travel free? | Shipping charge on mixed shipments | Paid pieces check out separately with their own shipping | — |

## C. Referrals and rewards

| ID | Requirement | Question | Why it matters | Current behaviour | Blocked work |
|---|---|---|---|---|---|
| DEC-21a | LOY-P3 | Beneficiary: is the reward always 1 free piece for the referrer, and does the new member receive anything besides the discount? | Prevents confusion with the 6th-month reward | Referrer: 1 reward (configurable 1–5); new member: discount only | — |
| DEC-21b | LOY-P3 | If the friend's first payment is refunded or she cancels in the lock-in, is the referrer's reward withdrawn? | Fraud exposure | Refund: unused reward revoked, used reward flagged for review; cancellation alone does not revoke | — |
| DEC-21c | LOY-P3 | Duplicate-account prevention: what counts as the same person (same phone, same address, same payment instrument)? | Spec tags abuse detection as [1.1]; today only e-mail identity and "never paid before" are checked | Self-referral and second referrer refused; existing members refused | Stronger abuse checks |
| DEC-24 | LOY-P5 | Face of the Week ₹500 voucher: confirm value, 30-day validity (proposed) and non-stacking | Needs a voucher engine | Not implemented | LOY-P5 |
| DEC-15 | CAT-04, LOY-P6 | Supply markup rules for the pricing helper and define the birthday reward | Spec open items | Not implemented | CAT-04, LOY-P6 |
| DEC-11 | LOY-BLD, LOY-P1 | Scope of the Loyalty & Offers Builder in V1: full builder (spec) or "basic V1 offer/referral rules" (proposal)? | The builder drives the 6th-order 50% rule, Face of the Week, birthday and 21-day offers | Rules can be stored but are not applied | LOY-BLD, LOY-P1, CAT-08, AT-08, AT-09 |

## D. Operations, compliance and accounts

| ID | Requirement | Question | Why it matters | Current behaviour | Blocked work |
|---|---|---|---|---|---|
| DEC-10 | NFR-03, SEC-05, BO-09 | Approve the approach for admin two-step verification (authenticator app vs e-mail second factor) and define what a Helper may and may not do | Security clause requirement; production blocker | Single admin role, e-mail code login, allow-list | Admin 2-step, roles |
| DEC-13 | NFR-04, NFR-07 | Confirm the database region is in India; approve Google Analytics / Meta pixel with a consent banner | DPDP data residency and consent | Region not verified; no analytics | NFR-04, NFR-07 |
| DEC-14 | NFR-05, INV-01 | Provide legal business name, address, GSTIN, grievance officer name/e-mail/phone | Required on invoices and legal pages | Not published until supplied and verified | Production invoices |
| DEC-18 | INV-01 (spec open item) | Accountant to confirm GST on the membership fee (18% assumed), credit redemptions, the ₹99 Wardrobe Bag fee and gift memberships | Invoice correctness | 18% on membership; 5%/18% slab on pieces; no invoice yet for the bag fee or online gifts | Bag-fee and gift invoices |
| DEC-16 | EXC-02 | "Didn't like it" exchanges: implement store credit and the ₹99 return fee in V1? | Needs a stored-value balance (previously ruled out) and a payment step | Requests recorded, handled manually | EXC-02 |
| DEC-17 | ADM-02 | Is CSV acceptable instead of Excel (.xlsx) for exports? | .xlsx needs an extra library | CSV | ADM-02 |
| DEC-25 | NFR-10 | Hosting target: the proposal names Vercel; the app is a long-running Node server with background jobs and local uploads | Determines deployment and upload storage | Not deployed | Release |
| DEC-26 | — | Approve deletion of unused legacy items (5 unmounted admin files; tables `gifts`, `offers`, `payment_locks`) | Housekeeping; no functional effect | Left in place | — |
| SEC-01/09 | SEC-01, SEC-09 | Confirm every account (hosting, repository, domain, Razorpay, Resend, database, AI) is in Vishrea's name and approve the third-party list | Contractual | Unknown | Handover |
