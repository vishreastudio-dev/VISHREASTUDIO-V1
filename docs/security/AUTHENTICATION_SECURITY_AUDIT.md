# VISHREA STUDIO — Authentication Security Audit

## 1. Threat Modeling & Security Posture

This audit analyzes the security controls implemented for the passwordless Supabase Email OTP integration at VISHREA STUDIO.

| Threat / Attack Vector | Risk Rating | Architectural Mitigation | Status |
| :--- | :---: | :--- | :---: |
| **Token Forgery / Signature Tampering** | Critical | Server cryptographically verifies Supabase tokens via `auth.getUser(token)` and application session tokens with `HS256` HMAC secret (at least 32 random characters). Tampered tokens are immediately rejected. | **Mitigated** |
| **Privilege Escalation to Admin** | Critical | Admin authorization is verified exclusively server-side from PostgreSQL records (`profiles.is_admin`, `role`) and filtered through `ADMIN_ALLOWED_EMAILS`. Client-submitted roles, JWT claims, or Supabase user metadata are never trusted. | **Mitigated** |
| **Service Role Credential Leakage** | Critical | `SUPABASE_SERVICE_ROLE_KEY` exists strictly on the server backend (`.env`). It is never referenced in Vite, never exported to client-side bundles, and never returned in API payloads. | **Mitigated** |
| **Replay & Concurrency Attacks** | High | Supabase OTPs are single-use. OTP verification consumes the code upon use. PostgreSQL transaction advisory locks (`admin_bootstrap`) prevent race conditions during account creation or linking. | **Mitigated** |
| **Brute Force OTP Guessing** | High | Multi-layered rate limiting: 5 requests per 15 minutes per email, 20 requests per 15 minutes per IP, max 30 verification attempts per 15 minutes per IP. Supabase enforces its own rate limits and OTP expiration. | **Mitigated** |
| **Cross-Customer Data Tampering** | High | Authenticated API routes resolve customer ID (`auth_user_id`) strictly from `req.user.id` (extracted from the verified HTTP-only session cookie). Queries explicitly bind `WHERE auth_user_id = $1`. | **Mitigated** |
| **Session Hijacking / XSS Theft** | High | Application sessions use `HttpOnly: true` cookies (`vishrea_auth`) inaccessible to JavaScript, configured with `SameSite: 'lax'`, `Path: '/'`, and `Secure: true` in production. | **Mitigated** |
| **Open Redirect Vulnerability** | Medium | Redirect query parameters (`next`) are strictly validated against `safeNext` (`/^\/(?!\/)[\w\-/?=&.%]*$/`). Protocol-relative URLs (e.g. `//evil.com`) and absolute URLs are discarded. | **Mitigated** |
| **Cross-Site Request Forgery (CSRF)** | Medium | `originGuard` middleware verifies that all state-changing requests (`POST`, `PUT`, `DELETE`) with session cookies match `config.allowedOrigins`. Requests lacking or spoofing Origin/Referer are rejected with 403. | **Mitigated** |
| **Email Enumeration / Information Leakage** | Low | `/api/auth/start-login` returns an identical message regardless of whether the email is already registered or new: *"If this email can receive mail, a 6-digit code is on its way."* | **Mitigated** |

---

## 2. Token Verification Deep-Dive

When a customer or administrator presents a Supabase token or session cookie:
1. **Pre-flight Payload Validation**:
   - The token format is validated as a 3-part base64url encoded JWT.
   - The expiration timestamp (`exp`) is checked against server time (`Math.floor(Date.now() / 1000)`). Expired tokens are rejected before external network requests.
   - The issuer (`iss`) is verified against `${SUPABASE_URL}/auth/v1` and the expected project reference (`djledhngxizbrtgfoclud`).
   - The audience (`aud`) is verified to be `'authenticated'`. Tokens with audience `'anon'` or `'service_role'` cannot create user sessions.
2. **Server-Side Identity Verification**:
   - The backend invokes `supabaseAdmin.auth.getUser(token)` to ensure the token has not been revoked in Supabase, the user is active, and the signature is valid.
3. **Database Authorization**:
   - The verified Supabase UID is mapped to `profiles.supabase_user_id` or `profiles.email`.
   - The database status `is_active` is checked. If false, the request is rejected with 403 `account_disabled`.
   - The database field `sessions_valid_after` is checked. If the token was issued before the revocation timestamp, the session is rejected.

---

## 3. Administrator Privilege Protection

The four live administrator accounts in production are:
1. `owner@vishrea.test`
2. `intellibytevaishal@gmail.com`
3. `vishreastudio.admin@gmail.com`
4. `admin@vishrea.com`

### Defensive Invariants:
1. **No Auto-Promotion**: A customer registering via Supabase Auth can never receive an administrator role, regardless of user metadata, email name, or form input.
2. **Double-Gate Authorization (`isAdminRow`)**:
   - Gate 1: Profile row must have `is_admin = true` or `role IN ('admin', 'owner')`.
   - Gate 2: Email must exist on `ADMIN_ALLOWED_EMAILS`.
3. **Owner Separation**: Only an existing `owner` role can grant the `owner` role to another administrator. An admin cannot change their own role or remove themselves.
4. **Last Admin Protection**: The system enforces that at least one active administrator must remain at all times.
