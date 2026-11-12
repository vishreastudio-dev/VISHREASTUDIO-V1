# API Documentation

| Field | Value |
|---|---|
| Document ID | VS-API-001 |
| Document title | API Documentation |
| Version | 1.0 |
| Status | Current |
| Prepared date | 7 November 2026 |
| Last updated | 7 November 2026 |
| Source of truth | `server.js` (`API_MODULES`, mounted routers) and each module in `api/` |

Related: [Technical Architecture](TECHNICAL_ARCHITECTURE.md) · [Database Schema](DATABASE_SCHEMA.md) · [Security Audit](SECURITY_AUDIT.md)

Only routes that `server.js` mounts are listed. The legacy files `api/admin/{content,customers,dashboard,orders,products}.js` are **not mounted** (verified by the test *legacy admin endpoints are no longer mounted*).

## 1. Conventions

- **Base path:** `/api`. JSON request and response bodies (`Content-Type: application/json`, limit 200 KB).
- **Authentication:** passwordless email code → signed JWT in the HTTP-only cookie `vishrea_auth` (SameSite=Lax, 14 days, revocable via `profiles.sessions_valid_after`). The role is re-read from the database on every request.
- **Access levels** (declared per module as `export const access`):
  - `public`: no session required (some actions inside still require one).
  - `user`: signed-in customer, otherwise `401 unauthorized`.
  - `admin`: admin role *and* (if `ADMIN_ALLOWED_EMAILS` is set) an allow-listed email, otherwise `403 forbidden`.
- **CSRF:** state-changing requests must come from an allowed `Origin`/`Referer` (`lib/http.js` `originGuard`).
- **Rate limits:** global 600/min per IP; per-module limits (`rateLimitPerUser`); sign-in codes and uploads have their own limits. In-memory, single process.
- **Errors:** `{"error": "<code>", "message": "<plain text>", "request_id": "<uuid>"}` with an HTTP status. Common codes: `unauthorized` (401), `forbidden` (403), `not_found`, `method_not_allowed` (405), validation codes such as `invalid_<field>` (400), `conflict`-style codes (409), `rate_limited` (429), `payment_gateway_error` / `payment_gateway_unreachable` (502), `payments_unavailable` (503).
- **Money:** all prices, discounts, shipping and totals are computed on the server; any amount sent by the browser is ignored.

## 2. Authentication — `api/auth.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/start-login` | public | `{email}` → sends a 6-digit code by email (Resend). In development with `AUTH_DEV_OTP_ECHO=true` the code is echoed. Rate-limited. |
| POST | `/api/auth/verify-code` | public | `{email, code}` → sets the session cookie; returns `{user}`. Creates the profile on first sign-in. |
| GET | `/api/auth/session` | public | Current `{user}` or `null`. |
| POST | `/api/auth/signout` | public | Revokes all sessions of the user and clears the cookie. |

Note: the client specification asks for **phone + OTP (WhatsApp, SMS backup)**; the implementation uses **email OTP** (see [Client Decisions](../client/CLIENT_DECISIONS_REQUIRED.md) DEC-07).

## 3. Catalogue and content

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/catalogue` | public | Product list. Query: `q`, `category`, `colour_season`, `featured`, `in_stock`, `size`, `colour`, `occasion` (each repeatable, for example `size=S&size=M`; a size matches only when that size is in stock), `price_min`, `price_max` (whole rupees, on the lowest price), `sort` (`relevance` (the default when `q` is set), `featured`, `newest`, `price_asc`, `price_desc`, `name`), `page`, `limit`. Every word of `q` must appear in the name, category, colour, occasion, material, colour season or description. If nothing matches, misspelt words are corrected once against words from the visible catalogue; the response then has `corrected_query`. Page 1 includes `facets` (`sizes`, `colours`, `occasions` and `price` `{min, max}` among the pieces matching `q` and `category`). Pieces in a drop are hidden until the drop starts and shown only to active members during early access. Member responses are `Cache-Control: private`. |
| GET | `/api/search?q=` | public | Live suggestions for the search panel: up to 6 pieces (best match first), up to 4 categories (`name_match` when the category's own name matches), `total`, `corrected_query`. A query shorter than 2 letters returns `browse`: active categories with live pieces and their counts. Same drop visibility as the catalogue. 120 requests per minute per visitor, then 429 `rate_limited`. |
| GET | `/api/product?slug=` (or `id=`) | public | Product with variants and 4 recommendations; same drop visibility; adds `members_early_access`. 404 `product_not_found`. |
| GET | `/api/content` | public | Instagram links, feedback videos, store settings, `membership_plans` (server prices), referral offer, gift options, legal details (only once verified). |
| GET | `/api/legal?slug=` | public | Legal page body. |
| GET | `/api/payment-config` | public | Razorpay key id and whether payments are configured. |

## 4. Account — `api/account.js` (user)

| Method | Body | Purpose |
|---|---|---|
| GET | — | Profile, membership summary, wearers, addresses, notification preferences, saved looks, colour profile, reward counts. |
| PUT | `{full_name, phone, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in, notifications:{whatsapp,email,sms,marketing}}` | Update profile and message preferences. |
| POST | `{action:'wearer', name, relationship, size_label, bust_cm, waist_cm, hip_cm, length_cm, style_preferences, occasion_preferences, birthday}` | Add a wearer (max `max_wearers`, default 5). |
| PUT / DELETE | `{action:'wearer', id, …}` | Update / delete a wearer. |
| POST | `{action:'address', label, recipient_name, phone, line1, line2, city, state, pincode, is_default}` | Save an address. |
| POST | `{action:'delete_data', confirm:'DELETE'}` | Cancels membership and UPI Autopay, erases personal data, revokes every session, clears the cookie. Orders and invoices are retained. |

## 5. Cart, checkout, orders

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/cart` | user | Lines with server prices, issues (`sold_out`, `early_access`, `reward_unavailable` …) and an estimate. |
| POST | `/api/cart` | user | `{variant_id, quantity}` add; `{action:'merge', items}` merges a guest bag. 409 `members_early_access`, `out_of_stock`. |
| PATCH | `/api/cart` | user | `{item_id, quantity?, use_credit?, reward_entitlement_id?}`. Credit use requires an active membership with unfrozen credits (400 `membership_not_active`). |
| DELETE | `/api/cart` | user | `{item_id}` / `{variant_id}` / `{product_id}` / `{all:true}`. |
| POST | `/api/checkout` | user | `{shipping_method:'delivery'|'pickup'|'bag', shipping_address, gift, gift_message, gst_invoice_requested, buyer_gstin, idempotency_key}`. Holds stock for `reservation_minutes`, debits credits, returns `{order_id, totals, razorpay:{key_id, order_id, amount}}`; ₹0 orders are completed at once (`payment_provider:'credit'`); `bag` orders become `in_bag`. Errors: `cart_empty`, `out_of_stock`, `product_unavailable`, `members_early_access`, `insufficient_credits`, `bag_credit_picks_only`, `premium_cannot_use_credit`. |
| POST | `/api/checkout` | user | `{action:'resume', order_id}` reopen payment; `{action:'cancel', order_id}` release the hold. |
| POST | `/api/payment-verify` | user | `{order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}` → HMAC check + gateway cross-check + capture → order paid. 409 `order_unfulfillable` triggers an automatic refund. |
| GET | `/api/orders` | user | Order list, or `?id=` one order with items, tracking, invoice, exchange. |
| GET / POST | `/api/exchange` | user | List / create `{order_id, claim_type:'exchange'|'damage', reason, evidence_urls[]}`. Windows: `exchange_days`, `damage_report_hours`; damage requires at least one photo. |

## 6. Membership — `api/membership.js` (user)

| Method | Body | Purpose |
|---|---|---|
| GET | — | `membership`, `billing` (status, mandate status, next debit, lock-in, frozen credits, retry policy, `can_pause`, `can_cancel`, `recovery_available`, pause), `renewal`, `pricing.plans`, `credits` (balance, granted/used/expired, expiry days, holding limit), `milestone`, `rewards`, `periods`, `payments` (with invoice numbers), `attempts`, `history`, `ledger`. |
| POST | `{action:'start_checkout', months}` | Creates (or reuses) a Razorpay Subscription: upfront add-on (`months × price − referral discount`) and first monthly debit after the upfront months. Returns `{amount, monthly_amount, first_debit_at, razorpay:{key_id, subscription_id}}`. Errors: `invalid_plan`, `membership_already_active`, `payment_recovery_required`, `payments_unavailable`. |
| POST | `{action:'activate_paid', razorpay_subscription_id, razorpay_payment_id, razorpay_signature}` | Verifies HMAC (`payment_id|subscription_id`), fetches payment and subscription, checks amount, captures, then activates. 503 `payment_confirmation_pending` when the gateway is unreachable (the webhook completes it). Legacy `{razorpay_order_id,…}` one-off orders are still accepted. |
| POST | `{action:'recover'}` | After all retries failed: new mandate, first month charged at authorisation. |
| POST | `{action:'pause'}` / `{action:'resume'}` | One-month pause (once per `pause_frequency_months`, not during lock-in); 409 `pause_in_lock_in`, `pause_unavailable`, `pause_already_scheduled`; 502 `pause_failed` if the gateway refuses (pause undone). |
| POST | `{action:'cancel', reason?}` | After lock-in only (409 `in_lock_in`); cancels the mandate, lapses credits, voids unstarted months. |

## 7. Wardrobe Bag — `api/wardrobe.js` (user)

| Method | Body | Purpose |
|---|---|---|
| GET | — | Saved pieces, rewards, membership, `bag` (waiting pieces, free threshold, fee, open shipment). |
| POST | `{action:'save', product_id}` / DELETE `{product_id}` | Save / remove a piece. |
| POST | `{action:'add_to_bag', variant_id, use:'none'|'credit'|'reward', reward_entitlement_id}` | Move a saved piece to the cart. |
| POST | `{action:'ship_bag', shipping_method, shipping_address, idempotency_key}` | Ship every waiting pick: free for ≥ `free_member_credits_to_ship` or pickup; otherwise returns a Razorpay order for `shipping_fee`. |
| POST | `{action:'confirm_bag_payment', razorpay_order_id, razorpay_payment_id, razorpay_signature}` | Verified payment → orders move to `processing`. |

## 8. Referrals, gifting, colour review, uploads

The "Request a Piece" endpoint (`/api/piece-requests`) was removed on 7 Nov 2026 and now returns 404. `/api/upload` requires a signed-in session.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/referrals?code=` | public | Validate a code (rate-limited): `{valid, reason, offer}`. |
| GET | `/api/referrals` | user | Own code, link, offer, summary, history (masked emails), rewards, `referred_by`. |
| POST | `/api/referrals` | user | `{action:'attribute', code}`; refuses self-referral, a second referrer, existing members. |
| GET | `/api/gifting` | user | Own gift enquiries/purchases. |
| POST | `/api/gifting` | public | Enquiry `{request_type, sender_*, recipient_*, membership_months, quantity, message, submission_key}`. |
| POST | `/api/gifting` | user | `{action:'purchase', gift_mode:'gift_to_her'|'pick_for_her', membership_months, sender_phone, recipient_name, recipient_email, recipient_phone, start_date, wearer_id, message}` → Razorpay order; `{action:'confirm_payment', …}` → code issued and emailed, or membership activated for the gifter; `{action:'redeem', token}` → activates a gift. |
| GET / POST | `/api/colour-review` | user | Read / save the colour profile computed on the device. |
| POST | `/api/upload` | public (rate-limited) | Multipart image/video upload; type detected from bytes; size limits by role. |

## 9. Admin — `api/admin/ops.js` (admin)

`GET /api/admin/ops?section=<name>` with sections: `dashboard`, `settings`, `products`, `product`, `categories`, `orders`, `customers`, `customer`, `memberships`, `credits`, `exchanges`, `loyalty`, `drops`, `sourcing`, `content`, `audit`, `couriers` (`q`, `active=true`), `order_shipments` (`id`), `gift_enquiries`, `gift_enquiry`, `referrals`, `rewards`, `invoices`, `store`, `export` (`type=orders|customers|products|invoices|membership_payments|payment_attempts|bag_shipments`, CSV).

`POST /api/admin/ops?section=<name>` with sections: `settings`, `product`, `product_status`, `category`, `order`, `membership`, `credit`, `exchange`, `gift_enquiry`, `gift_token`, `gift_token_revoke`, `reward`, `drop`, `source`, `loyalty`, `content`, `courier` (create, or update with `id`), `courier_status` (`id`, `is_active`), `store_sale`. `PUT` and `DELETE` are used for edits/removals of the same resources; `DELETE section=courier&id=` succeeds only for a courier no shipment has used (otherwise 409 `courier_in_use`). `section=order` accepts `courier_id` (preferred) or `courier_partner` (courier name, older clients) with `tracking_number`; see [COURIER_MANAGEMENT.md](../COURIER_MANAGEMENT.md).

`POST /api/admin/listing-studio` — AI listing suggestions (requires an AI provider key; see Technical Architecture §7).

Every admin write is recorded in `audit_logs`.

## 10. Webhook — `POST /api/webhooks/razorpay`

- Raw body, `X-Razorpay-Signature` = HMAC-SHA256(`RAZORPAY_WEBHOOK_SECRET`, raw body); invalid → 400.
- Idempotent: `payment_events (provider, event_id)` unique; event id from `X-Razorpay-Event-Id` or a body hash. Processed/ignored events return `{ok:true, duplicate:true}`; failed events are reprocessed on retry (non-2xx makes Razorpay retry).
- Events handled:

| Event | Effect |
|---|---|
| `payment.captured`, `order.paid` | Order, membership (legacy), Wardrobe Bag fee or gift payment marked paid; subscription payments resolved via their invoice. |
| `payment.failed` | Order/membership failure reason; subscription debit attempt recorded. |
| `subscription.authenticated` | Mandate authenticated; upfront payment applied if present. |
| `subscription.activated`, `.paused`, `.resumed`, `.completed` | Mandate status synced. |
| `subscription.charged` | Monthly debit → one month appended, credits on month start, invoice. |
| `subscription.pending` | Retrying: credits frozen, reminder email. |
| `subscription.halted` | All retries failed: membership paused (`pause_reason='payment_failed'`), loyalty count reset. |
| `subscription.cancelled` | Customer cancelled from UPI app → membership cancelled (unless the cancellation was initiated by the app). |
| `refund.processed` | Order or membership payment refunded; stock/credits/rewards reversed per rules; refund email. |

## 11. Health

`GET /api/health` → `{ok, db:'up'|'down', time}` (503 when the database is unreachable).
