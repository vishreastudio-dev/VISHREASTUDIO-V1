# QA API inventory (Phase 1)

Source-based: every route below was read from `server.js`, `api/**` and `lib/**` on 2026-11-09, and
none is invented. Access metadata was printed from the modules themselves
(`node tests/qa/inventory-meta.mjs`, raw output in `scratch/qa/raw/inventory-meta.json`).

## Cross-cutting behaviour (applies to every `/api` route)

| Concern | Behaviour (source) |
|---|---|
| Error envelope | `{ error: <code>, message, details?, request_id }`; `X-Request-Id` header (`lib/http.js` `sendError`) |
| Auth | `Authorization: Bearer <jwt>` takes precedence, otherwise the `vishrea_auth` cookie. HS256 only. Role, active flag and revocation (`sessions_valid_after`) come from the DB on every request (`lib/auth.js`) |
| Module gate | each module exports `access` (`public`, `user` or `admin`) and `methods`. Disallowed method → 405 with `Allow`; no session on `user`/`admin` → 401; non-admin on `admin` → 403 (`server.js` `mountModule`) |
| CSRF | non-GET `/api/*` (except webhooks): `Origin`/`Referer` must be same-origin or allowed, else 403 `origin_not_allowed`. Cookie-authenticated writes with neither header → 403 `origin_required`. A body that is not JSON → 415 (`originGuard`) |
| Body limits | JSON 200 KB (413 `payload_too_large`); upload up to about 57 MB for admins and about 7 MB for customers (pre-checked on `Content-Length`) |
| Global rate limit | `api_global` 600 requests per minute per client IP |
| Per-user write limit | per module (table below); applies to POST, PUT, PATCH and DELETE, keyed by user ID |
| Headers on `/api` | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, no `X-Powered-By`. `Cache-Control` is `no-store` except public catalogue, product, content, homepage carousel and legal responses, which set `public` or `private` with a short `max-age` |
| DB error mapping | `22P02` → 400 `invalid_identifier`; `23505` → 409; `23514` → 422; `23503` → 409; other → 500 `internal_error`. The message is generic in production; development shows the error message, never the stack |

## Routes

Columns:
- **Auth:** `-` public, `U` signed-in user, `A` admin.
- **Write limit:** the per-user write limit for the module.

### Authentication: `api/auth.js` (Express router)

| Method | Path | Auth | Input | Success | Errors | Limits | Tables | External |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/auth/session` | - | — | 200 `{ user \| null }` | — | global | profiles | — |
| POST | `/api/auth/start-login` | - | `{ email }` | 200 `{ ok, message, expires_in_minutes, debug_code? }` (code only outside production with echo on) | 400 `invalid_email`, 429 `otp_throttled` (30 s resend, 5 per 15 min per email), 429 `rate_limited` | 20 per 15 min per IP, 5 per 15 min per email | auth_otps | **Resend** (sign-in code email) |
| POST | `/api/auth/verify-code` | - | `{ email, code: 6 digits }` | 200 `{ ok, user }` + `Set-Cookie: vishrea_auth` (HttpOnly, SameSite=Lax, Secure in production) | 400 `invalid_code` (attempts counted before compare, single use), 403 `account_disabled` | 30 per 15 min per IP | auth_otps, profiles, customer_profiles, audit_logs | — |
| POST | `/api/auth/signout` | (U) | — | 200 `{ ok }`; revokes all sessions (`sessions_valid_after`) | — | global | profiles, audit_logs | — |

### Customer and account

| Method | Path / action | Auth | Input | Success | Main errors | Write limit | Tables | External |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/account` | U | — | 200 `{ user, profile, membership, wearers, max_wearers, addresses, notifications, saved_looks, colour_profile, rewards }` | 401 | 60/min | customer_profiles, memberships, wearer_profiles, addresses, notification_preferences, saved_looks, colour_reviews, reward_entitlements, app_settings | — |
| PUT | `/api/account` | U | `full_name ≤120, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in, notifications{}` | 200 `{ profile }` | 400 field validation | 60/min | customer_profiles, notification_preferences | — |
| POST | `/api/account` `action=wearer` | U | `name*, relationship, size_label, bust/waist/hip/length_cm (1–400), style/occasion prefs, birthday` | 201 `{ wearer }` | 400 `max_wearers_reached`, `invalid_*_cm` | 60/min | wearer_profiles | — |
| PUT / DELETE | `/api/account` `action=wearer` | U | `id` + fields | 200 | 404 `wearer_not_found` (owner-scoped), 400 invalid UUID | 60/min | wearer_profiles | — |
| POST | `/api/account` `action=address` | U | `recipient_name*, phone*, line1*, city*, state* (Indian state), pincode* (6 digits), label, line2, is_default` | 201 `{ address }` | 400 | 60/min | addresses | — |
| POST | `/api/account` `action=delete_data` | U | `confirm: "DELETE"` | 200; erases app data, revokes sessions, cancels membership | 400 `confirmation_required` | 60/min | many (see source) | **Razorpay** (cancel subscription) |

### Catalogue, product, search and content

| Method | Path | Auth | Input | Success | Errors | Notes |
|---|---|---|---|---|---|---|
| GET | `/api/catalogue` | - | `q ≤80, category, colour_season, featured, in_stock, sort ∈ {featured, newest, price_asc, price_desc, name}, page, limit ≤100` | 200 `{ products[], total, page, limit, categories[] }` | — | Parameterised SQL; `LIKE` wildcards escaped; unknown sort → `featured`; guests cached 10 s (`X-Cache`); members are never shared-cached. Tables: products, categories, product_variants, drop_settings |
| GET | `/api/product?slug=` or `?id=` | - | slug or UUID (≤120) | 200 `{ product, recommendations[4] }` | 400 `slug_required`, 404 `product_not_found` | Early-access drops hidden from non-members |
| GET | `/api/content` | - | — | 200 `{ instagram, feedback_videos, store, membership_plans, referral_discount_inr, gift_options, gift_enquiry_types, legal }` | — | Cached 30 s |
| GET | `/api/homepage-carousel` | - | — | 200 `{ settings, slides[] }` (published, active, in-schedule only) | — | Cached 30 s |
| GET | `/api/legal[?slug=]` | - | slug ≤60 | 200 `{ pages[] }` / `{ page }` | — | legal_pages + bundled fallback |
| GET | `/api/payment-config` | - | — | 200 `{ razorpay_key_id, configured }` | — | Publishable key only |

### Shopping bag: `/api/cart` (U, 120 writes/min)

| Method | Input | Success | Errors | Tables |
|---|---|---|---|---|
| GET | — | 200 `{ items[], estimate{}, membership, rewards_available }` | 401 | carts, cart_items, product_variants, products, memberships, reward_entitlements |
| POST | `{ variant_id, quantity 1..10 (1 for one-of-one) }` or `{ action: "merge", items[≤30] }` | 200 cart view | 400 `variant_required`/invalid UUID/quantity, 404 `product_unavailable`, 409 `out_of_stock`, 409 `members_early_access`, 400 `cart_full` (30 lines) | same |
| PATCH | `{ item_id, quantity?, use_credit?, reward_entitlement_id? }` | 200 | 404 `cart_item_not_found` (owner-scoped), 400 `premium_cannot_use_credit` / `membership_not_active`, 404 `reward_not_found`, 409 `reward_in_use` | same |
| DELETE | `{ item_id \| variant_id \| product_id }` or `{ all: true }` | 200 | 400 `item_required` | same |

### Checkout and payments

| Method | Path / action | Auth | Input | Success | Errors | Limit | Tables | External |
|---|---|---|---|---|---|---|---|---|
| POST | `/api/checkout` (start) | U | `shipping_method ∈ {delivery, pickup, bag}`, `shipping_address{name, phone, line1, city, state, pincode}`, `gift, gift_message ≤300, gst_invoice_requested, buyer_gstin, idempotency_key ≤80` (or `Idempotency-Key` header) | 201 `{ order_id, status, payment_status, expires_at, totals, razorpay{ key_id, order_id, amount }, payment_provider }`; reuse → 200 | 400 `cart_empty`, field validation, 409 `out_of_stock` / `product_unavailable` / `members_early_access`, 400 `insufficient_credits`, 503 `payments_unavailable`, 502 gateway errors | 12/min | orders, order_items, inventory_reservations, product_variants, memberships, credit_ledger, audit_logs | **Razorpay** create order |
| POST | `/api/checkout` `action=resume` / `cancel` | U | `order_id` | 200 | 404 `order_not_found` (owner-scoped), 409 `payment_window_closed` | 12/min | orders, reservations | Razorpay |
| POST | `/api/payment-verify` | U | `order_id, razorpay_payment_id, razorpay_signature, razorpay_order_id?` | 200 `{ ok, status: "paid", invoice_number }` / `{ duplicate: true }` | 400 `invalid_payment_signature`, `payment_order_mismatch`, `no_gateway_order`, `amount_mismatch`, `payment_not_verified`; 404; 409 `duplicate_payment` / `order_unfulfillable` / `payment_not_applied` | 20/min | orders, payments, invoice_records, inventory, audit_logs | **Razorpay** fetch / capture / refund |
| POST | `/api/webhooks/razorpay` | signature | raw body + `X-Razorpay-Signature`, `X-Razorpay-Event-Id` | 200 `{ ok, outcome }` / `{ duplicate: true }` | 400 `invalid_signature`, `invalid_json`; 500 `webhook_processing_failed` (Razorpay retries) | 600/min | payment_events, orders, membership_*, bag_shipments, admin_gift_enquiries, audit_logs | — |

### Membership, credits, rewards, referrals and gifts

| Method | Path / action | Auth | Input | Success | Errors | Limit | External |
|---|---|---|---|---|---|---|---|
| GET | `/api/membership` | U | — | 200 `{ membership, billing, renewal, pricing{ plans[] }, credits, milestone, rewards, periods, payments, attempts, history, ledger }` | 401 | 20/min | — |
| POST | `/api/membership` `start_checkout` | U | `months` ∈ configured plans (1–24) | 200 subscription checkout | 400 `invalid_plan` | 20/min | **Razorpay** subscription |
| POST | `/api/membership` `activate_paid` | U | subscription or order payment IDs + signature | 200 view | 400 `invalid_payment_signature`, `amount_mismatch`; 404; 409; 503 `payment_confirmation_pending` | 20/min | Razorpay |
| POST | `/api/membership` `recover` / `pause` / `resume` / `cancel` | U | `reason ≤300` for cancel | 200 view | 400 / 409 state errors | 20/min | Razorpay |
| GET | `/api/referrals?code=` | - | code | 200 `{ valid, reason, offer }` | 429 (60/h per IP) | — | — |
| GET | `/api/referrals` | U | — | 200 `{ code, link, offer, summary, history, rewards, referred_by }` | 401 | 30/h | — |
| POST | `/api/referrals` `attribute` | U | `code` | 201 / 200 `{ ok, status }` | 400 own or invalid code, `unsupported_action` | 30/h | — |
| GET | `/api/gifting` | U | — | 200 `{ enquiries[] }` (own only) | 401 | — | — |
| POST | `/api/gifting` (enquiry) | - | `request_type, sender_name*, sender_email*, sender_phone*, company_name (corporate), recipient_*, membership_months, quantity 1–100 (corporate), message ≤1000, submission_key` | 201 `{ enquiry }`; duplicate → 200 `{ duplicate: true }` | 400; 429 (6/h per user or IP) | 20/h | — |
| POST | `/api/gifting` `purchase` / `confirm_payment` | U | gift purchase / payment proof | 200 | 401, 400, 503 | 20/h | **Razorpay** |
| POST | `/api/gifting` `redeem` | U | `token` | 200 `{ membership }` | 400 / 404 / 409; 429 (10/h per user) | 20/h | — |
| GET / POST / DELETE | `/api/wardrobe` (`save`, `add_to_bag`, `ship_bag`, `confirm_bag_payment`) | U | `product_id` / `variant_id`, `use ∈ {none, credit, reward}`, bag shipping | 200 `{ items, rewards, membership, bag }` | 400 / 404 / 503 | 60/min | **Razorpay** (bag shipping fee) |

### Orders, exchanges and colour analysis

| Method | Path | Auth | Input | Success | Errors | Notes |
|---|---|---|---|---|---|---|
| GET | `/api/orders` | U | `page, limit ≤50` | 200 `{ orders[], total, page, limit }` | 401 | own orders only |
| GET | `/api/orders?id=` | U | UUID | 200 `{ order{ items, exchanges }, invoice, policy }` | 400, 404 (owner-scoped) | — |
| GET | `/api/exchange` | U | — | 200 `{ exchanges[] }` | 401 | own only |
| POST | `/api/exchange` | U | `order_id, reason* ≤500, claim_type ∈ {exchange, damage}, evidence_urls[≤5]` (own private evidence refs only) | 201 `{ exchange, exchanges }` | 400 `order_not_paid` / `order_not_delivered` / window closed / `damage_photos_required`; 404; 409 `exchange_already_open` | 20 per hour |
| GET | `/api/colour-review` | U | — | 200 `{ review \| null }` | 401 | — |
| POST | `/api/colour-review` | U | `undertone* ≤40, palette[≥3 hex], season ∈ 8 seasons, confidence 0–1, quality_score 0–100, lighting, source, model_version`; image-like fields rejected | 201 `{ review }` | 400 `raw_image_not_accepted`, `invalid_colour_review`, `invalid_season` | 30 per hour |

### Media

| Method | Path | Auth | Input | Success | Errors | Notes |
|---|---|---|---|---|---|---|
| POST | `/api/upload` | U (customer: `evidence` only), A (`product`, `banner`, `instagram`, `video`) | `{ image \| video \| file: data URL/base64, purpose }` | 201 `{ ok, ref, url, purpose, kind, mime, bytes, width, height, duration_seconds, deduplicated }`; duplicate → 200 | 401, 403 `upload_forbidden`, 400 `invalid_purpose` / `file_required`, 413, 415 (type from bytes), 422 (unreadable or oversized dimensions, video too long), 503 `storage_unavailable` | 20 per hour per user; **Supabase Storage** when `STORAGE_DRIVER=supabase` |
| GET | `/api/media/signed?ref&exp&sig` | signature | HMAC link (local driver) | 200 file (`private, no-store`, sandbox CSP) | 404 | Supabase serves its own signed URLs |
| GET/HEAD | `/uploads/<name>` | - | flat name | 200 only if referenced or registered | 404 | Remediation phase 1 |

### Admin

| Method | Path | Auth | Input | Notes |
|---|---|---|---|---|
| GET | `/api/admin/ops?section=` | A | sections: `dashboard, settings, products, product, categories, orders, customers, customer, memberships, credits, exchanges, loyalty, drops, sourcing, content, audit, admins, couriers, order_shipments, gift_enquiries, gift_enquiry, referrals, rewards, invoices, store, export, listing`; `page`, `limit ≤500`, filters | 400 `unknown_section` |
| POST / PUT | `/api/admin/ops?section=` | A | `settings, category, product, product_status, order, membership, credit, exchange, gift_enquiry, gift_token, gift_token_revoke, reward, loyalty, drop, source, content, courier, courier_status, store_sale, admin` | 240 writes/min; every successful write clears the public cache; audited |
| DELETE | `/api/admin/ops?section=` | A | `product, category, courier, admin, loyalty, content (type=instagram\|video)` | media released after commit |
| GET / POST / DELETE | `/api/admin/homepage-carousel` | A | actions `create, update, publish, unpublish, activate, duplicate, reorder, settings`; DELETE `?id&confirm` | 120 writes/min |
| POST | `/api/admin/listing-studio` | A | `category*, occasion, colour, fabric, cost_price_inr, supplier, notes` | **OpenAI**; 502 `listing_ai_unavailable` when unavailable; 60 per hour |

### Operations and pages

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | - | 200/503 `{ ok, db }`; pool and process stats outside production, or for admins |
| GET | `/robots.txt`, `/sitemap.xml` | - | robots disallows everything outside production |
| GET | `/*` (SPA) | - | server-rendered `<head>` metadata per route; 404 / 301 handled |
| any | `/api/<unknown>` | - | 404 `not_found` JSON |

## External services by route

| Service | Routes |
|---|---|
| Razorpay | checkout (create order), payment-verify (fetch/capture/refund), membership (subscriptions), gifting purchase, wardrobe ship-bag, account delete (cancel subscription), admin refunds, background reconciliation |
| Resend | start-login (OTP), order and exchange notifications (`lib/notify.js`) |
| Supabase Storage | upload, admin content and carousel media, exchange evidence signed URLs, `/api/media/signed` (local driver only) |
| OpenAI | admin listing studio |

In the QA stack all four are stand-ins or disabled (`tests/qa/qa-env.mjs`).
