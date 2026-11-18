# VISHREA STUDIO — Customer Profile & Form Field Validation Matrix

**Date:** November 18, 2026  
**Status:** Approved & Enforced  
**Scope:** Customer Registration, First-Time Onboarding, Account Profile, Size Personalization, Address Book, Checkout, Membership, Gifting, Admin Customer CRM  

---

## 1. Overview & Validation Architecture

To eliminate discrepancies between customer-facing UI forms and backend database constraints, this matrix defines every data field across Vishrea Studio. 

### Core Validation Rules
1. **Explicit Mandatory Indicators:** Every required field in the UI features an asterisk (`*`) styled in brand wine (`#752238`).
2. **Never Block Optional Fields:** Optional measurements, notes, and alternate wearers can be omitted without form submission failure.
3. **Strict Mobile Number Validation:** Indian mobile numbers require exactly 10 digits starting with digits `6`, `7`, `8`, or `9`. Leading `+91`, `91`, or `0` prefixes and whitespace/hyphens are automatically stripped and normalized. International formats conforming to E.164 (`+` with 7–15 digits) are accepted.
4. **Safe Name Handling:** Names allow letters, spaces, hyphens, apostrophes, and Unicode regional characters (`\p{L}`). Numbers, control characters (`\u0000`), HTML tags, and malicious payloads are rejected.
5. **Configurable Dropdowns:** Select dropdowns validate strictly against active values provided by the backend API.

---

## 2. Complete Field Validation Matrix

| Context / Form | Field Name | Required? | Data Type | Format / Allowed Values | Min / Max Length | Error Message | Backend Validation |
|---|---|---|---|---|---|---|---|
| **Auth / Login** | `email` | **Yes \*** | String | Valid RFC 5322 email regex (`isEmail`) | 3 – 254 chars | "Please enter a valid email address." | `validEmail(b.email)` (`400 invalid_email`) |
| **Auth / OTP** | `code` | **Yes \*** | String | 6 numeric digits | Exactly 6 chars | "Enter the 6-digit verification code sent to your email." | `text(b.code, { max: 6, required: true })` (`400 invalid_code`) |
| **Profile Onboarding** | `full_name` | **Yes \*** | String | Unicode letters (`\p{L}`), spaces, hyphens, apostrophes | 2 – 100 chars | "Please enter your full name (at least 2 letters)." | `personName(b.full_name, { required: true })` (`400 full_name_required`) |
| **Profile Onboarding** | `phone` | **Yes \*** | String | 10 Indian digits (`^[6-9]\d{9}$`) or international E.164 | Exactly 10 digits (India) / 7-15 digits (Intl) | "Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9." | `indianMobile(b.phone, { required: true })` (`400 invalid_phone`) |
| **Profile Onboarding** | `age_confirmed` | **Yes \*** | Boolean | Must be `true` | Boolean | "You must confirm that you are at least 18 years of age." | `bool(b.age_confirmed)` (`400 age_confirmation_required`) |
| **Profile Onboarding** | `preferred_silhouette` | Optional | String | Predefined or custom silhouette string | 0 – 80 chars | — | `text(b.preferred_silhouette, { max: 80 })` |
| **Profile Onboarding** | `whatsapp_opt_in` | Optional | Boolean | `true` or `false` | Boolean | — | `bool(b.whatsapp_opt_in)` |
| **Size Profile** | `name` | **Yes \*** | String | Alphanumeric label (e.g. "My Wardrobe", "Sister") | 1 – 80 chars | "Please enter a profile name." | `text(b.name, { max: 80, required: true })` (`400 name_required`) |
| **Size Profile** | `relationship` | Optional | String | One of: `self`, `friend`, `sister`, `mother`, `partner`, `family`, `other` | Enum | "Select a valid relationship." | `RELATIONSHIPS.includes(v)` fallback `'friend'` |
| **Size Profile** | `size_standard` | Optional | String | One of: `India`, `UK`, `US`, `EU` | Enum | — | `SIZE_STANDARDS.includes(v)` fallback `'India'` |
| **Size Profile** | `clothing_size` | Optional | String | One of: `XS`, `S`, `M`, `L`, `XL`, `XXL`, `Custom` | Enum | — | `CLOTHING_SIZES.includes(v)` fallback `'M'` |
| **Size Profile** | `custom_size` | Optional (Req if size is Custom) | String | Freeform text description | 0 – 40 chars | "Please describe your custom size." | `text(b.custom_size, { max: 40 })` |
| **Size Profile** | `fit_preference` | Optional | String | Active option ID configured by Admin in `app_settings` | Enum | — | Verified against `fit_preference_options` in DB, fallback `'regular'` |
| **Size Profile** | `bust` | Optional | Decimal | Numeric measurement in cm (50–160) or inches (20–65) | Float | "Enter a realistic bust measurement." | `sanitizeMeasure(v, min, max)` |
| **Size Profile** | `waist` | Optional | Decimal | Numeric measurement in cm (40–150) or inches (16–60) | Float | "Enter a realistic waist measurement." | `sanitizeMeasure(v, min, max)` |
| **Size Profile** | `hips` | Optional | Decimal | Numeric measurement in cm (50–180) or inches (20–70) | Float | "Enter a realistic hip measurement." | `sanitizeMeasure(v, min, max)` |
| **Size Profile** | `shoulder` | Optional | Decimal | Numeric measurement in cm (30–60) or inches (12–24) | Float | "Enter a realistic shoulder measurement." | `sanitizeMeasure(v, min, max)` |
| **Size Profile** | `height` | Optional | Decimal | Numeric measurement in cm (120–220) or inches (48–86) | Float | "Enter a realistic height." | `sanitizeMeasure(v, min, max)` |
| **Address** | `recipient_name` | **Yes \*** | String | Letters, spaces, hyphens, apostrophes | 2 – 100 chars | "Please enter the recipient's name." | `personName(b.recipient_name, { required: true })` |
| **Address** | `phone` | **Yes \*** | String | 10 Indian digits (`^[6-9]\d{9}$`) | Exactly 10 digits | "Enter a valid 10-digit mobile number for courier delivery." | `indianMobile(b.phone, { required: true })` |
| **Address** | `address_line1` | **Yes \*** | String | Street address, flat/building number | 5 – 200 chars | "Please enter your street address." | `text(b.address_line1, { max: 200, required: true })` |
| **Address** | `address_line2` | Optional | String | Apartment, suite, landmark | 0 – 200 chars | — | `text(b.address_line2, { max: 200 })` |
| **Address** | `city` | **Yes \*** | String | City or town name | 2 – 60 chars | "Please enter your city." | `text(b.city, { max: 60, required: true })` |
| **Address** | `state` | **Yes \*** | String | Valid Indian State / Union Territory | Enum (36 states/UTs) | "Select a valid state or union territory." | `indianState(b.state, { required: true })` |
| **Address** | `pincode` | **Yes \*** | String | 6 numeric digits (`^\d{6}$`) | Exactly 6 digits | "Enter a valid 6-digit postal PIN code." | `text(b.pincode)` with `/^\d{6}$/` |
| **Checkout GST** | `gst_number` | Optional | String | 15 alphanumeric Indian GSTIN regex | Exactly 15 chars | "Enter a valid 15-character GSTIN number." | `gstin(b.gst_number)` |
| **Gifting** | `sender_name` | **Yes \*** | String | Letters, spaces, hyphens | 2 – 100 chars | "Please enter your name." | `personName(b.sender_name, { required: true })` |
| **Gifting** | `recipient_email` | **Yes \*** | String | RFC 5322 email | 3 – 254 chars | "Please enter a valid recipient email." | `validEmail(b.recipient_email)` |
| **Admin Customer** | `customer_code` | Auto-Generated | String | Standard human-readable ID (`CUST-YYYY-NNN`) | 13 chars | Read-only in Admin forms | `nextHumanId(c, ID_PREFIXES.CUSTOMER)` |

---

## 3. Verification & Compliance
- Backend validation in `lib/validate.js` strictly aligns with client input patterns.
- No optional fields cause HTTP 400 rejection when empty.
- Mobile numbers containing spaces, hyphens, `+91`, or leading `0` are sanitized automatically without showing false rejection warnings to customers.
