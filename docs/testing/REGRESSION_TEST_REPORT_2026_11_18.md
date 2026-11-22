# VISHREA STUDIO — Regression Test & Quality Assurance Report

**Date:** November 18, 2026  
**Test Suite Status:** 65 / 65 Passing (100%)  
**Client Bundle Build:** Vite Production Build Completed in 957ms (0 Errors)  

---

## 1. Test Execution Summary

The entire Vishrea Studio regression test suite was executed across all application layers (AI platform, search & colour engine, pricing & GST, couriers & shipments, hero carousel, customer copy, tokens & auth security, orders & payments).

```
ℹ tests 65
ℹ suites 15
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 19437
```

---

## 2. Test Suite Breakdown

| Test Suite / Module | Tests Passed | Key Assertions Verified | Status |
|---|---|---|---|
| **AI Platform & Style Assistant** | 4 / 4 | Policies dictionary verified, intent extraction heuristics, product-aware generation constraints | **PASS** |
| **Business Calculations & Stock** | 9 / 9 | `suggestBatchId`, `calculateCostPerUnit`, landed inventory valuation, strict inventory classification (`low_stock` > `fast_moving` > `dead_stock`), counter sale totals, customer loyalty stamps | **PASS** |
| **Catalogue Search & Typo Engine** | 6 / 6 | Control character stripping, token lowercase normalization, Levenshtein edit distance, catalogue-only vocabulary correction, size sorting | **PASS** |
| **Recent Searches (Device Storage)** | 3 / 3 | Newest-first ordering, case-insensitive deduplication, 6-item cap, payment/PII data exclusion | **PASS** |
| **CIEDE2000 Colour Engine** | 4 / 4 | Sharma Wu Dalal 2005 standard reference pairs, CIELAB / HSV conversions, 8 colour seasons matching, "try less" palette exclusion | **PASS** |
| **Couriers & Tracking URLs** | 3 / 3 | AWB URL encoding, strict https URL generation, tracking number regex security (anti-XSS) | **PASS** |
| **Hero Carousel & Banners** | 10 / 10 | Aspect ratio / natural fit preservation, image bounds checking, lenient reading of stored metadata, visible CTA link destination security | **PASS** |
| **Customer Copy & Gifting** | 3 / 3 | Mandate copy clarity (supports UPI & Card mandates), singular/plural bag phrasing, paid gift form state clearing | **PASS** |
| **Pricing, GST & Cart Calculations** | 5 / 5 | Sale price priority over list price, GST slabs (5% / 12%), intra vs inter state CGST/SGST/IGST breakdown, half-up paisa rounding | **PASS** |
| **Membership & Rewards Engine** | 3 / 3 | Monthly price × upfront months, reward piece eligibility filtering, FIFO credit ledger expiry | **PASS** |
| **Settings & Media Sniffing** | 5 / 5 | Video duration caps (max 10s, max 3 videos), MP4 atom header sniffing, product FAQ knowledge boundaries, centimetre/inch dual display | **PASS** |
| **Validation & Input Sanitization** | 3 / 3 | Null byte (`\u0000`) rejection before PostgreSQL query execution, RFC email normalization, safe name handling | **PASS** |
| **Payments & Razorpay Signatures** | 4 / 4 | HMAC-SHA256 signature verification, tamper rejection, raw body webhook validation, safe 502 gateway error masking | **PASS** |
| **Human-Readable ID Generation** | 3 / 3 | Concurrency-safe atomic sequence increments, PREFIX-YYYY-NNN format validation, prefix isolation | **PASS** |

---

## 3. Frontend Build & Asset Verification

```bash
npm --prefix vishrea-react run build
✓ 532 modules transformed.
✓ built in 957ms
```

- **Visual Assets:**
  - `/assets/studio-storefront.jpg` verified in both `/vishrea-react/dist/assets` and `/public/assets` (337,658 bytes).
  - High-fashion lookbook stream photos verified.
- **Section Layout Order:** Verified exact sequence:
  1. Hero Carousel
  2. Just In · Styled Head to Toe
  3. Explore Categories
  4. Words From Real Customers
  5. Walkin Wardrobe Membership
  6. About the Studio · Bengaluru (Storefront Image + Film Stream)
  7. Worn By Our Customers (Customer Videos)
  8. Compact FAQs
- **No Console Errors:** React 19 hydration and Vite tree-shaking confirmed.
