# VISHREA STUDIO — API Functional Test Report

**Auditor:** Senior Backend QA & API Security Engineer  
**Date:** November 22, 2026  
**Scope:** Exhaustive Endpoint Inspection across Public, Protected Customer, and Restricted Admin APIs.

---

## 1. API Verification Matrix

The complete catalog of 29 endpoints was tested for HTTP method conformance, input validation, authentication enforcement, rate limiting, and database state transitions.

| Endpoint | Method | Access Level | Status Code | Rate Limit | Test Scenarios Verified | Verdict |
|---|:---:|:---:|:---:|:---:|---|:---:|
| `/api/health` | GET | Public | 200 | N/A | Verifies PostgreSQL pool connectivity (`SELECT 1`). | **PASS** |
| `/api/auth/config` | GET | Public | 200 | N/A | Returns public Supabase URL & anon key; never exposes secrets. | **PASS** |
| `/api/auth/start-login` | POST | Public | 200 / 429 | 20/15m (prod) | Triggers Email OTP. Rejects invalid email. Rate limits excess requests. | **PASS** |
| `/api/auth/verify-code` | POST | Public | 200 / 400 | 30/15m | Validates 6-to-8 digit OTP. Rejects malformed and expired codes. Single use. | **PASS** |
| `/api/auth/session-exchange` | POST | Public | 200 / 401 | 60/15m | Exchanges Supabase access token for `vishrea_auth` cookie. Verifies issuer/aud. | **PASS** |
| `/api/auth/session` | GET | Public | 200 | N/A | Returns `{ user: null }` for guests, user object for authenticated callers. | **PASS** |
| `/api/auth/signout` | POST | User | 200 | N/A | Updates `sessions_valid_after` in DB, clears cookie, logs audit. | **PASS** |
| `/api/catalogue` | GET | Public | 200 | Cached | Lists active products, extracts sale prices, handles early access filters. | **PASS** |
| `/api/product` | GET | Public | 200 / 404 | Cached | Fetches product by slug. Returns variants, size guide, and stock. | **PASS** |
| `/api/search` | GET | Public | 200 / 429 | 60/min | Typo-tolerant catalog search. Rejects null bytes. Caps at 80 chars. | **PASS** |
| `/api/homepage-carousel` | GET | Public | 200 | Cached | Returns active published slides in sort order. Bounded aspect ratios. | **PASS** |
| `/api/legal` | GET | Public | 200 | Cached | Returns legal page titles and bodies (`returns`, `shipping`, `privacy`). | **PASS** |
| `/api/payment-config` | GET | Public | 200 | N/A | Returns Razorpay key ID and configuration status. Safe 200 response. | **PASS** |
| `/api/offers/validate` | POST | Public | 200 / 400 | N/A | Validates promo code. Rejects blank code with 400. Computes dynamic discount. | **PASS** |
| `/api/offers/my-offers` | GET | User | 200 / 401 | N/A | Returns claimed distributed studio VIP offers for authenticated customer. | **PASS** |
| `/api/account` | GET | User | 200 / 401 | N/A | Returns customer profile, addresses, preferences. Rejects unauthenticated (401). | **PASS** |
| `/api/account` | PUT | User | 200 / 401 | N/A | Updates profile name, phone, preferences. Sets `profile_completed = true`. | **PASS** |
| `/api/cart` | GET | User | 200 / 401 | 120/min | Retrieves active server cart lines, estimates, shipping fees, tax splits. | **PASS** |
| `/api/cart` | POST | User | 200 / 401 | 120/min | Adds variant to cart. Checks stock availability; prevents overselling. | **PASS** |
| `/api/cart` | DELETE | User | 200 / 401 | 120/min | Removes line item from cart or clears entire bag. | **PASS** |
| `/api/checkout` | POST | User | 201 / 400 | N/A | Reserves stock, calculates intra/interstate GST, creates Razorpay order. | **PASS** |
| `/api/payment-verify` | POST | User | 200 / 400 | N/A | Verifies HMAC-SHA256 Razorpay signature. Transitions order to `paid`. | **PASS** |
| `/api/orders` | GET | User | 200 / 401 | N/A | Fetches customer's past orders. Scoped strictly to `auth_user_id`. | **PASS** |
| `/api/size-profiles` | GET | User | 200 / 401 | N/A | Returns personalized size profiles for user and family members. | **PASS** |
| `/api/size-profiles` | POST | User | 201 / 400 | N/A | Inserts or updates customer size profile with bust, waist, hips, preferences. | **PASS** |
| `/api/wardrobe` | GET | User | 200 / 401 | N/A | Returns active membership wardrobe bag items and credit status. | **PASS** |
| `/api/admin/ops` | GET/POST | Admin | 200 / 403 | N/A | Main operations router. Rejects regular customer with 403 Forbidden. | **PASS** |
| `/api/admin/homepage-carousel`| GET/POST | Admin | 200 / 403 | N/A | Admin slide editor. Rejects non-admin with 403 Forbidden. | **PASS** |
| `/api/admin/ai-studio` | POST | Admin | 200 / 403 | N/A | AI content generation endpoint. Protected strictly for administrators. | **PASS** |

---

## 2. API Security & Robustness Assertions

1. **Origin Guard & CSRF**:
   - Strict origin validation against `config.allowedOrigins`. Requests from unlisted foreign origins receive 403 Forbidden.
2. **Input Sanitization**:
   - RFC email normalization strips whitespace and converts to lowercase.
   - Poison null bytes (`\u0000`) are rejected in validator layers before queries reach PostgreSQL.
3. **HTTP Status Code Conformity**:
   - Success: `200 OK` for reads and updates, `201 Created` for insertions.
   - Client Errors: `400 Bad Request` for invalid inputs, `401 Unauthorized` for missing sessions, `403 Forbidden` for privilege mismatch, `404 Not Found` for nonexistent resources, `429 Too Many Requests` for throttles.
   - Upstream Error Masking: Upstream payment errors return `502 Bad Gateway` without exposing stack traces or API keys.
4. **Idempotency & Concurrent Requests**:
   - Orders require unique `idempotency_key` preventing duplicate payment order generation.
   - Sourcing batch and PO code generation utilizes transactional advisory locks preventing sequence collisions.

---

## 3. Summary Verdict

All 29 REST endpoints operate with correct status codes, robust input sanitization, strict role-based access control, and atomic database state transitions. **Status: 100% PASS**.
