# VISHREA STUDIO — SECURITY, PRIVACY & HARDENING READINESS REPORT

**Date:** 2026-11-17  
**Scope:** Authentication Security, Secret Management, Rate Limiting, Input Sanitization, Customer Privacy.

---

## 1. Security Controls Verification

| Security Control | Implementation Mechanism | Status | Notes |
|---|---|---|---|
| **Session Cookies** | `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/'` | PASS | Session tokens are inaccessible to JavaScript, mitigating XSS session hijacking. |
| **Cross-Site Request Forgery** | Double-submit CSRF token validation on all mutating API methods | PASS | Enforced on `POST`, `PUT`, `DELETE`. |
| **SQL Injection Defense** | Parameterized queries via `pg` (`$1, $2, ...`) across all database queries | PASS | Verified across all controllers; zero string interpolation in SQL. |
| **Rate Limiting** | Sliding window rate limiter per IP / User (`express-rate-limit`) | PASS | Standard API: 240 req/min; OTP endpoints: 5 attempts / 15 mins. |
| **Payment Signature Verification** | HMAC-SHA256 signature verification over raw body bytes | PASS | Prevents payment tampering or fraudulent confirmation callbacks. |
| **Webhook Idempotency** | Event deduplication table tracks processed Razorpay event IDs | PASS | Duplicate webhooks return HTTP 200 without double-crediting accounts. |
| **File Upload Validation** | Magic number MIME sniffing, strict size limits (5 MB images, 50 MB videos) | PASS | Executable file types and malicious scripts rejected. |
| **Role-Based Access Control** | Explicit `access: 'admin'` gateway check verified server-side on all `/api/admin/*` routes | PASS | Unauthorized users receive HTTP 403 Forbidden. |

---

## 2. Customer Privacy & Compliance (DPDP Act & GDPR Alignment)

1. **On-Device Colour Analysis Guarantee:**
   - The private colour analysis tool operates 100% on-device using client-side MediaPipe WebAssembly.
   - Customer facial photographs are strictly processed in local browser memory and are **never transmitted, stored, or logged** on any server or third-party cloud.
2. **Customer Data Erasure:**
   - Account deletion request triggers cascading anonymization of customer profile while preserving statutory financial records required by Indian tax law.
3. **Marketing Consent:**
   - Opt-in consent checkboxes for promotional WhatsApp/Email communications are recorded with timestamps.
