# Vishrea Studio — UI/UX & Functional Audit

| Item | Value |
|---|---|
| Date | 5 November 2026 |
| Environment | Isolated app instance (`127.0.0.1:3100`) on a throw-away PostgreSQL 18 database with the demo seed; real Chromium driven through the DOM (real click, input and keyboard events); `npm test` on a separate isolated database |
| Not available here | Razorpay keys (so no real payment window), email delivery and a camera |
| Production | Not touched |

**How "verified" is used below:** an action was performed in the browser (or through the API where stated), and its result was read back from the page and, where relevant, from the database. Anything not exercised is marked **Not tested** or **Blocked**.

---

## 1. Route inventory and results

The router (`App.jsx`) defines **21 route patterns**. The admin router has **21 sections** plus a fallback for unknown sections.

### 1.1 Automated route sweep

Every route below was visited through in-app navigation. On each page, a probe recorded:

- horizontal overflow and the elements causing it;
- images without `alt` text, and broken images;
- form fields without an associated label;
- buttons with no accessible name;
- dead links (`href="#"`, empty, or `javascript:`);
- the number of `<h1>` headings;
- console errors, uncaught exceptions and failed API calls.

| Set | URLs | Widths | Result |
|---|---|---|---|
| Customer / guest | 18 URLs: `/`, `/catalogue`, `/catalogue/dresses`, `/catalogue/skirts` (empty category), `/catalogue?q=zzzz` (no results), 2 product pages, `/product/does-not-exist`, `/cart`, `/membership`, `/skin-tone`, `/login`, `/gifting`, `/gift/redeem`, `/contact`, `/legal/privacy`, `/legal/returns`, `/no-such-page` | 360, 390, 768, 1024, 1366, 1440 | 0 overflow, 0 console errors, 0 unlabelled fields, 0 unnamed buttons, 0 dead links, 1 `<h1>` each. Only the expected 404 for the missing product failed. Small text links (18–21 px) were flagged and fixed (§9, D17). |
| Protected, signed out | `/orders`, `/account`, `/wardrobe`, `/checkout`, `/admin` | 1440 | Each redirects to `/login?next=…` |
| Admin | all 21 sections + `/admin/nope` | 1024 and 360 | 0 page overflow (wide tables scroll inside their containers), 0 console errors, 0 failed API calls. Unlabelled fields were found in AI Listing Studio and Piece Requests, and fixed (D8). |
| Customer signed in as admin URL | `/admin`, `/api/admin/ops` | — | `/admin` redirects to `/account`; the API returns 403 |

### 1.2 Direct URL load, refresh and missing resources

The server's HTTP status was checked for 30 URLs.

| Result | URLs |
|---|---|
| 200 | All valid pages |
| 404 | Unknown category, product, policy and page; `/api/nope`; `/uploads/../server.js` (path traversal blocked) |
| 3xx redirect | `/legal`, `/admin.html`, `/coming-soon` (the automated tests confirm these are 301) |
| `noindex` | All private pages (cart, checkout, orders, login, account, admin, wardrobe, redeem) |

Missing resources inside the app:

- **Bad IDs:** an unknown or malformed order ID shows the 404 page.
- **Unknown section:** an unknown admin section redirects to Overview.
- **Page titles:** an unknown category or policy now gets the title "Page not found" (D16).

---

## 2. Customer journeys

| Journey | Steps verified | Result |
|---|---|---|
| Visitor | Home, navigation (desktop and 360 px mobile menu: open, 48 px links, scroll lock, Escape, link closes it), catalogue search/filter/sort, empty category, no-results search, product page with size selection and stock, add to bag, bag count, membership pricing, gifting, contact, legal pages, footer links | Pass |
| Registration / sign-in | Invalid email (now caught in the browser), code requested, resend disabled for 30 s, wrong code (rejected, field cleared), correct code → `/account`, header switches to "Account". A second code within 30 s → 429. | Pass. There is no separate registration: the first sign-in creates the account (by design). |
| Session | Signing out behind the page's back → the next API call flips the header to "Sign in"; protected pages redirect to `/login?next=`; private API responses are `no-store` | Pass |
| Account | Profile: invalid phone and GSTIN refused with field-level errors; valid save persists after reload. Wearer: name required, measurement range enforced, saved and listed. Referral link shown; copy falls back to "Copy the link above" when clipboard access is unavailable. | Pass |
| Purchase | Preselected first in-stock size, add to bag, second size, remove item (totals update ₹10,699 → ₹5,299), checkout. Required fields use browser validation (focuses the first invalid field); a short PIN code is refused. Valid form → server returns 503 "Online payment is not available right now. Your bag has been kept." | Pass to the payment step. The **real Razorpay window is blocked** (no keys here). Signature, amount, duplicate and late-payment paths are covered by the automated suite (simulated Razorpay server). |
| Free-piece order | Save to Wardrobe Bag → "Claim free piece" → bag shows −₹1,799 → studio pickup → order confirmed (₹0). Database: one order, reward redeemed, stock 1 → 0. A double-clicked submit did not create a duplicate. | Pass |
| Orders | Order list, order page (tracker, tax invoice VS/2026-27/000001, print/save), 404 for unknown or malformed IDs | Pass |
| Exchange | After admin marks the order delivered: request with reason; database shows one request (no duplicate on repeat submit) | Pass |
| Membership | Plans (2 months ₹3,598 / 6 months ₹10,794 with the free-piece offer), selection, start → "Payments are not configured yet" (no keys) | Pass to the payment step. **Payment blocked** here; the automated suite covers activation, renewal, expiry, rewards and refunds. |
| Referral | Referrer copies link → new visitor opens `/?ref=CODE` → offer stored → signs in → attributed → 2-month plan ₹3,598 → **₹3,448** "Referral discount −₹150"; 6-month plan not discounted | Pass |
| Gift enquiry | Field validation (name, email, phone, recipient, recipient email), durations and types from Settings, double-click → one enquiry (GE-1002) | Pass |
| Gift redemption | Recipient opens the one-time link → code read from the link and then cleared from the address bar → activate (double-click) → membership active 6 months, 4 credits → reusing the code returns 409 | Pass |

## 3. Admin journeys

| Journey | Steps verified | Result |
|---|---|---|
| Admin authorization | Customer → `/admin` redirected; admin API 403. Admin → `/login` redirects to `/admin`. | Pass |
| Dashboard | Loads with date range and KPIs | Pass (statistics come from database queries; the automated suite checks membership revenue and the range) |
| Products | Search by name, search by SKU (new), state and category filters (new), out-of-stock filter, empty-filter message, create piece with a real PNG upload, reward eligibility from the product editor (new), live in shop at ₹1,999, edit sale price → shop shows ₹1,799 | Pass |
| Product validation (API) | Empty name, negative price, sale ≥ price, one-of-one stock > 1, negative stock: all refused with readable messages; a `<script>` name is stored as text and every display path escapes it | Pass |
| Orders | Search by ID prefix, status and payment filters (new). Server refuses invalid transitions (processing → delivered; expired → processing). Packed → Dispatch dialog (studio pickup preset) → Delivered. | Pass |
| Customers | Search by name, email and phone digits (new); membership filter (new); drill-down (membership, wearers, colour, orders, rewards and referrals, credit ledger) | Pass |
| Gift enquiries | List, detail, Mark processed, "Mark invoiced" refused without an invoice reference, notes and invoice saved, Mark invoiced, generate code (shown once; only `…NepH` kept), Revoke available | Pass |
| Settings | Typed groups, eligible-piece picker, save and audit (earlier round); reward toggle from the product editor appears in the Settings history | Pass |
| Inventory concurrency, credits, rewards, refunds, referral rewards, membership override | Automated suite | Pass (126/126) |
| Not exercised in the browser | Drops, Sourcing, Loyalty rule creation, Store Mode sale, customer video upload, AI Listing Studio (needs a key), category edit beyond opening the dialog, credit adjustment | Not tested in this round |

## 4. Button and interactive-element inventory (exercised)

| Route | Element | Expected | Actual | API | Status |
|---|---|---|---|---|---|
| all | Menu toggle (mobile) | Open/close menu, Escape closes | As expected | — | Pass |
| `/login` | Continue / Sign in / Resend / Use another email | Request code / verify / resend after 30 s | As expected; disabled while busy | `/api/auth/*` | Pass |
| `/product/:slug` | Size buttons | Select size (radio semantics) | As expected | — | Pass |
| `/product/:slug` | Add to bag / Buy now | Add; buy now opens bag | As expected | `/api/cart` | Pass |
| `/product/:slug` | Save to Wardrobe Bag | Save, then show saved state | Saved; now becomes "In your Wardrobe Bag · View →" (D15) | `/api/wardrobe` | Pass (fixed) |
| `/cart` | − / + / Remove / Use credit / Use free-piece reward / Continue to checkout | Update the bag | As expected; − disabled at 1, + disabled at stock | `/api/cart` | Pass |
| `/checkout` | Delivery/Pickup, GST, gift packing, Continue to payment | Validate and create the order | As expected (payment step blocked without keys) | `/api/checkout` | Pass / Blocked |
| `/membership` | Plan cards, Start | Select plan, start payment | As expected; 503 shown without keys | `/api/membership` | Pass / Blocked |
| `/wardrobe` | Add to bag / Claim free piece / Remove | Move to bag | As expected; navigates to the bag | `/api/wardrobe` | Pass |
| `/account` | Save details / Add wearer / Edit / Delete / Save wearer / Cancel / Copy link / Sign out | Save and persist | As expected (sign-out tested through the API) | `/api/account`, `/api/referrals` | Pass |
| `/orders/:id` | Print / save invoice, Submit request | Print; create exchange | As expected | `/api/exchange` | Pass |
| `/gifting` | Individual/Corporate, Send gift enquiry | Validate and submit once | As expected | `/api/gifting` | Pass |
| `/gift/redeem` | Activate membership | One-time activation | As expected | `/api/gifting` | Pass |
| `/admin/products` | Search / filters / Clear / Add piece / Upload / reward checkbox / Save piece | Server-side filter; create | As expected | `/api/admin/ops`, `/api/upload` | Pass (new) |
| `/admin/orders` | Search / filters / Packed / Dispatched (dialog) / Delivered / Cancelled | Allowed transitions only | As expected | `/api/admin/ops?section=order` | Pass |
| `/admin/customers` | Search / filter / Open | Drill-down | As expected | `/api/admin/ops` | Pass (new filters) |
| `/admin/gift-enquiries` | Open / Save notes & invoice / Mark processed / Mark invoiced / Generate code / Copy link and code (new) / Revoke | Workflow | As expected | `/api/admin/ops` | Pass |
| `/admin/piece-requests` | Status count cards | Filter by status | Worked by mouse only; now buttons with keyboard support (D9) | — | Pass (fixed) |
| `/admin/*` dialogs | Close, Escape | Close dialog | No Escape and unnamed close buttons; fixed (D7) | — | Pass (fixed) |

The probe also checked every button on every swept URL (18 customer, 5 protected and 22 admin) for an accessible name: none was missing one. There was **no visible button that did nothing**. "Dispatched" opens a dialog that the first probe missed only because it lacked `role="dialog"` (D7).

## 5. Field validation matrix (tested)

| Form | Field | Client check | Server check | Message | Verified |
|---|---|---|---|---|---|
| Login | Email | format (new) | format, ≤254 | "Please enter a valid email address…" / "A valid email address is required" | yes |
| Login | Code | 6 digits only | hash match, expiry, attempts | "That code is incorrect or has expired…" | yes |
| Profile | Full name | ≤120 | ≤120 | readable | — |
| Profile | Mobile | type=tel | 7–15 digits, `+ ( ) - space` | "A valid phone number is required" (field marked) | yes |
| Profile | GSTIN | ≤15 | GST pattern | "GSTIN must be a valid 15-character GST number" (field marked) | yes |
| Wearer | Name | required (new) | ≤80 | "Please add a name for this wearer." | yes |
| Wearer | Bust/Waist/Hip/Length | 1–400 (new) | 1–400 | "Measurements must be numbers in centimetres (1–400)." / server: "Bust (cm) must be a number between 1 and 400" | yes |
| Checkout | Name, mobile, address, city, PIN, state | browser required/pattern | server validation | browser messages, focus on first invalid field | yes |
| Gifting | Sender name/email/phone, company (corporate), recipient name (individual), recipient email, quantity 1–100 (new) | yes | yes | field-specific, field marked and focused (new) | yes |
| Gifting | Duration / type | options from Settings | `oneOf` Settings values | 400 for an unlisted value | yes (automated) |
| Exchange | Reason / photos ≤5 | select, file types | server enum, image signature check | — | yes |
| Product editor | Name, price, sale, stock, SKU | required, min | required, ≥0, sale < price, one-of-one ≤1 | readable messages | yes (API) |
| Settings | All 45 values | typed inputs | type, range, list, reference, cross-field | readable messages | yes (automated) |
| Upload | Image type/size | `accept` | file signature (SVG/HTML refused), size limit | "Only JPG, PNG or WEBP images…" (415) | yes |
| Admin filters | Status / payment / membership / state / category | select | `oneOf` / UUID | 400 for unknown values | yes (automated) |

Indian phone numbers with spaces, `+91` and dashes are accepted; there is no name or address character restriction beyond length.

## 6. Frontend → backend → database traceability (spot checks)

| Action | Path verified |
|---|---|
| Save profile | form → `PUT /api/account` (user) → `customer_profiles` update → response → form state → reload shows saved values |
| Free-piece order | Wardrobe "Claim free piece" → `POST /api/wardrobe add_to_bag` → `cart_items.reward_entitlement_id` → `POST /api/checkout` → `orders` (₹0, rewards_used 1) + `reward_entitlements.status = redeemed` + variant stock 0 |
| Gift redemption | `/gift/redeem#code` → `POST /api/gifting redeem` → `gift_memberships.status = redeemed` + 6 `membership_periods` + credits → page shows paid-through date |
| Reward eligibility from product editor | checkbox → `POST /api/admin/ops?section=product {reward_eligible}` → `app_settings.reward_eligible_product_ids` + `audit_logs update_settings` → Settings history |
| Order fulfilment | Packed/Dispatched/Delivered → `POST /api/admin/ops?section=order` → `orders.status` (transition table enforced) → customer tracker |

No broken link between page, API and database was found.

## 7. Responsive results

| Width | Customer routes | Admin routes |
|---|---|---|
| 360 | Pass | Pass (tables scroll inside their containers) |
| 390 | Pass | — |
| 768 | Pass | — |
| 1024 | Pass | Pass |
| 1366 | Pass | — |
| 1440 | Pass | — |

The Settings dialogs fit at 360 px. Text links on touch screens now have a 44 px minimum target (D17).

## 8. Accessibility findings

The baseline was already good:

- skip link;
- labelled main, footer and breadcrumb navigation;
- size buttons with radio semantics;
- `aria-live` stock and price;
- visible `:focus-visible` outlines;
- 16 px form controls.

The issues found are listed in §9:

- D7: admin dialogs had no dialog role, no Escape and no focus handling;
- D8: unlabelled admin fields;
- D9: mouse-only count cards;
- D10: hidden file input;
- D11: weak focus ring on admin fields;
- D12: unlabelled read-only code fields;
- D4: errors not tied to their fields.

Colour contrast was not measured with a tool in this round.

**Screenshots:** the browser tool captured only the top of the page in this environment, so no screenshots are included. Every result above comes from DOM and database checks.

## 9. Defects found in this audit

| ID | Sev | Where | Defect | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| D1 | P2 | Home, Membership, FAQ | Copy said staying six consecutive months earns the piece; the confirmed rule is month 6 of the 6-month plan | Copy predates the clarification | Copy now names the 6-month plan | Fixed |
| D2 | P2 | Admin Products/Orders/Customers | No search or filters; the orders and customers APIs had no search | Never built | Server-side `q` + filters (validated, parameterised); shared filter bar; "no matches" empty state; filter kept after edits | Fixed |
| D3 | P2 | API validation | Messages exposed internal field names ("sender_name is required", "bust_cm must be…", "between -Infinity and Infinity") | Generic validators used the raw field key | `label()` turns keys into plain words; range wording fixed | Fixed |
| D4 | P2 | Account, Wearer, Gifting, Login | Errors shown only as one message; field not marked or focused | No field mapping | `lib/fieldErrors.js` maps server codes and client checks to the field (`aria-invalid`, `aria-errormessage`, focus, cleared on input) | Fixed |
| D5 | P2 | Settings | Deleting a product or category left its ID in the reward lists, so the Rewards group could no longer be saved | No clean-up on delete | Deleted products and categories are removed from the lists (audited) | Fixed |
| D6 | P2 | Membership | Starting a membership while payments were unavailable left the account "Awaiting payment" | Record written before the gateway check | 503 before anything is written | Fixed |
| D7 | P2 | Admin dialogs (7) | No `role="dialog"`/name; 6 close buttons unnamed; no Escape; focus not moved | Inconsistent dialog markup | Role, title link, labelled close buttons; one Escape handler and initial focus | Fixed |
| D8 | P2 | Admin forms | 20 fields without labels (AI Listing Studio ×3, category/drop/sourcing/loyalty/credit dialogs ×17) + 2 Piece Requests filters | Labels without `htmlFor` | Labels linked; filters labelled | Fixed |
| D9 | P2 | Piece Requests | Status count cards worked by mouse only | `onClick` on `<article>` | Button role, `tabIndex`, Enter/Space, `aria-pressed` | Fixed |
| D10 | P2 | Product editor | Image upload not reachable by keyboard | `display:none` file input | Visually hidden input with a focus ring on the tile | Fixed |
| D11 | P3 | Admin fields | Focus shown only by a border tint | `outline: none` | Added focus ring | Fixed |
| D12 | P3 | Gift codes | Code and link fields unlabelled; no copy buttons | — | Labels + Copy link / Copy code | Fixed |
| D13 | P3 | Product editor | "Credits & free-piece rewards" label was wrong after the clarification; no reward control | — | Relabelled to credits only; added a reward checkbox tied to Settings | Fixed |
| D14 | P3 | Product page | "Added to your bag" and "already in your bag" shown together | Two messages | Only the banner is shown | Fixed |
| D15 | P3 | Product page | Saving to the Wardrobe Bag kept the button unchanged | No saved state | Becomes a link to the Wardrobe Bag | Fixed |
| D16 | P3 | Unknown category / policy | Title "Vishrea Studio" / "Policies" instead of "Page not found" | Parent page title effect ran after the 404 page's | Parent page waits when showing the 404 | Fixed |
| D17 | P3 | Touch screens | Text links 18–21 px tall | Inline text links | 44 px minimum on touch screens | Fixed |
| D18 | P3 | Login | No browser-side email check | — | Format check before sending | Fixed |
| O1 | P3 | Checkout | When payments are unavailable an order is created and immediately expired (bag kept) | Existing design | Not changed; shows as "expired" in admin | Open |
| O2 | P3 | Checkout | Button says "Continue to payment" even when the total will be ₹0 | Total known only after the server builds the order | Not changed | Open |

**Reviewed and not a defect:**

- the first in-stock size is preselected;
- the Wardrobe Bag's "Claim free piece" confirms by opening the bag;
- a stale customer page appeared once after an API-level sign-out; this did not reproduce, private API responses are `no-store`, and the server returned the correct session.

## 10. Remaining issues and limits

1. **Blocked:** the real Razorpay payment window, real email delivery, and the camera-based colour analysis on a device.
2. **Not tested in the browser this round:** Drops, Sourcing, Loyalty and credit-adjustment dialogs (labels fixed, behaviour not exercised); Store Mode sale; customer video upload; AI Listing Studio; and the piece-request modal submission.
3. **Not done:** colour-contrast measurement with a tool, and a screen-reader walk-through.
4. **Lint warnings:** 27 remain (mostly React `set-state-in-effect`), with 0 errors.
