# VISHREA STUDIO — ANALYTICS, MONITORING & OPERATIONS READINESS REPORT

**Date:** 2026-11-17  
**Scope:** GA4 E-commerce Events, Search Console Integration, Background Jobs, Error Logging, and Disaster Recovery.

---

## 1. Google Analytics 4 (GA4) Integration Strategy

When the owner provides the GA4 Measurement ID (`G-XXXXXXXXXX`), the following standard e-commerce event mapping is pre-architected:

| User Action | GA4 Standard Event | Parameters Passed |
|---|---|---|
| View product catalog | `view_item_list` | `item_list_id`, `item_list_name`, `items` array |
| Click product card | `select_item` | `item_id`, `item_name`, `price`, `item_category` |
| Open product detail | `view_item` | `currency: 'INR'`, `value`, `items` (with variant SKU) |
| Add piece to bag | `add_to_cart` | `currency: 'INR'`, `value`, `items`, `quantity: 1` |
| Remove from bag | `remove_from_cart` | `currency: 'INR'`, `value`, `items` |
| Proceed to checkout | `begin_checkout` | `currency: 'INR'`, `value`, `coupon`, `items` |
| Completed order | `purchase` | `transaction_id`, `value`, `tax`, `shipping`, `currency: 'INR'` |
| Member signup | `sign_up` | `method: 'email_otp'` |
| Walkin Wardrobe join | `purchase` | `transaction_id`, `value: 3598`, `item_category: 'membership'` |

*Note:* PII (names, phone numbers, email addresses) is strictly excluded from analytics payloads to preserve privacy compliance.

---

## 2. Background Jobs & Database Maintenance

Background workers run via advisory lock (`JOBS_LOCK_KEY = 704_210_021`) ensuring only a single instance executes jobs concurrently:
1. `sweepExpiredOrders()`: Releases inventory holds on checkout sessions that expired without payment (default 30-minute window).
2. `reconcilePayments()`: Validates pending payment transactions against gateway status.
3. `runMembershipLifecycle()`: Evaluates 60-day credit expiration FIFO schedules and flags 6th-month reward eligibility.

---

## 3. Operational Health & Error Logging

- Structured JSON logging (`lib/log.js`) captures operational events, payment signatures, and job errors.
- HTTP status codes are strictly mapped: 400 for client validation, 401 for unauthenticated, 403 for unauthorized, 404 for missing resource, and 500/502 for upstream gateway issues.
- Admin audit log records every administrative action (piece edit, price change, vendor creation, PO fulfilment) with actor ID and timestamp.
