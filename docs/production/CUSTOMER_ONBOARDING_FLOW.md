# Customer sign-in, profile and onboarding flow

Date: 2026-11-11. Verified against the isolated QA stack (`127.0.0.1:3100`, `vishrea_qa`). No real email was sent.

## 1. How sign-in works (as implemented)

There is no separate registration form. The same email-code flow both creates new accounts and signs in existing ones.

1. `POST /api/auth/start-login { email }`. Stores a peppered hash of a 6-digit code that is valid for 10 minutes, then emails it through Resend. Resends are throttled to one per 30 s, 5 per 15 minutes per email, and 20 per 15 minutes per IP.
2. `POST /api/auth/verify-code { email, code }`. The attempt is counted before the compare, up to the attempt limit. The code is single use (the row is deleted).
   - The account is looked up by `lower(email)`. If none exists, `profiles` and `customer_profiles` rows are created in one transaction. A unique index on `lower(email)` (migration 013) prevents duplicates.
   - An HttpOnly, `SameSite=Lax` cookie (`Secure` in production) carries an HS256 token. Role, active state and revocation are read from the database on every request.
3. The guest bag, kept in the browser, is merged into the account once after sign-in (`POST /api/cart {action:'merge'}`). Refetches wait for the merge, so it cannot be applied twice.
4. `POST /api/auth/signout` revokes every session of the account (`sessions_valid_after`) and clears the cookie.
5. `/checkout`, `/orders`, `/account`, `/wardrobe` and `/admin` are wrapped in `RequireAuth`. Admin additionally requires an admin role and the allow-list.

## 2. Journey test (`tests/qa/auth-journey.mjs`), 14/14 after the fix

| Step | Result |
|---|---|
| Guest session is `null`; `/api/account` → 401 | pass |
| New email → account + session cookie; exactly one `profiles` and one `customer_profiles` row | pass |
| Re-using a consumed code → 400 `invalid_code` | pass |
| Guest bag merges into the account | pass |
| Profile edit (name, phone) saved | pass |
| Sign-out clears the cookie | pass |
| **Old session rejected after sign-out** | **failed before the fix**, pass after |
| Same email in different case → same account, no duplicate | pass |
| Profile and bag restored on next sign-in | pass |
| Wrong code → clear message | pass |

**Defect fixed (high).** Revocation compared whole seconds. A cookie used to sign out in the same second it was issued stayed valid until it expired. Sign-out now revokes past the second that the session's token was issued in. Admin removal and admin disable now revoke with the same one-second margin that account deletion already used. A regression test was added (`test/platform.test.js`). Full suite: 202/202.

The automated suite (`test/platform.test.js`, `remediation.test.js`) and Newman folder 01 also cover expired codes, attempt limits, the resend throttle, disabled accounts, expired, forged and `alg=none` tokens, and CSRF on cookie writes.

## 3. Style questionnaire: status and launch decision

**It does not exist today.** The `wearer_profiles` table has `style_preferences` and `occasion_preferences` (jsonb, migration 010) per wearer. The API accepts them, but no screen collects them, and there is no customer-level questionnaire.

**Decision: do not build it before launch.** It needs a schema change to production at launch time. It is optional, and the brief says it must not delay launch. Sign-in and profile persistence, the launch-critical parts, are verified above.

### Recommended post-launch design (minimal, reuses the architecture)

- **Storage:** one additive migration, `customer_profiles.style_preferences jsonb DEFAULT '{}'` plus `style_preferences_completed_at timestamptz`. Writes go through the existing `PUT /api/account`, validated as a closed set of values.
- **Questions** (each skippable, multi-select where natural):
  1. style: Minimal, Contemporary, Classic, Bold, Ethnic, Experimental;
  2. occasions: Everyday, Workwear, Casual, Festive, Occasion;
  3. fit: Relaxed, Regular, Tailored, Depends on outfit;
  4. colours: Neutrals, Warm, Cool, Pastels, Bold;
  5. budget: bands derived from live catalogue price quartiles at build time, not fixed numbers.
- **Experience:** an optional card on `/account` after the first sign-in ("Tell us your style · 1 minute · Skip"). It never blocks browsing, the bag or checkout. Answers are editable from Account, and a "Completed" or "Not yet" status shows there.
- **Recommendations:** qualitative only ("Because you like Classic, Workwear"). Products carry `colour`, `colour_season` and category, but not style, fit or occasion attributes. A **match percentage would therefore be invented**, and must not be shown until those product attributes exist and a documented formula is agreed. That formula would need its inputs, weights, missing-data handling and limitations written down.
- **Privacy:** colour analysis stays separate and on-device. No selfie is uploaded or stored, and only the derived palette is saved with consent. The questionnaire stores no images.
