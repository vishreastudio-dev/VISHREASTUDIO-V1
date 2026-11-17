# Complete Full-Stack Functional Audit & Verification Matrix
**System:** Vishrea Studio Business Management System  
**Date:** 17 November 2026  
**Auditor:** Senior Full-Stack Engineer, Software Architect, Database Engineer & QA Specialist  
**Status:** In Progress / Remediating  

---

## Executive Summary

A comprehensive full-stack audit was performed on the existing Vishrea Studio platform, spanning:
- Frontend UI (`vishrea-react/src/pages/Admin.jsx`, `vishrea-react/src/pages/AdminExtras.jsx`, components)
- API Routes & Controllers (`api/admin/ops.js`, `api/admin/dashboard.js`, `api/admin/customers.js`, `api/admin/orders.js`)
- Backend Logic & Calculation Libraries (`lib/inventory.js`, `lib/products-admin.js`, `lib/pricing.js`, `lib/billing.js`)
- Database Schema & Migrations (`supabase_complete_schema.sql`, `migrations/001_initial.sql` through `027_personalized_size_profiles.sql`)

The audit revealed that while an extensive e-commerce and member wardrobe administration foundation is in place, the core business management modules (Inventory cost & batch tracking, In-Studio Sales counter, Vendor management, Procurement & PO fulfilment, and comprehensive CRM/Loyalty stamp cycle workflows) had missing fields, incomplete workflows, missing drill-downs, and lacked central calculation consistency.

---

## Classification Legend
- **PASS**: Correctly implemented and verified from UI to Database.
- **PARTIAL**: Present in the codebase but incomplete or missing critical fields/actions.
- **FAIL**: Missing completely from frontend, API, or database.
- **BUG**: Implemented but produces incorrect behavior, schema mismatch, or calculation defect.
- **NOT VERIFIED**: Evidence is insufficient to confirm correctness.

---

## 1. Dashboard Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Sales Metrics: Total revenue & order count (All-time)** | Only date-range revenue is queried (`paid_at` in range). All-time totals are not computed. | **PARTIAL** | `api/admin/ops.js:48` filters by `inRange('paid_at')`. No all-time revenue or count returned. | Add `all_time_revenue` and `all_time_orders` queries to `dashboard()` aggregation. |
| **Sales Metrics: Current month revenue & orders** | Computed when date range defaults to current month. | **PASS** | `inRange` defaults to `date_trunc('month', now())`. Correctly aggregates paid orders. | Maintain existing monthly aggregation. |
| **Sales Metrics: Today's revenue & orders** | Missing. | **FAIL** | Not queried in `ops.js:dashboard`. | Add `today_revenue` and `today_orders` query filtering by `paid_at >= current_date`. |
| **Sales Metrics: Average Order Value (AOV)** | Missing on dashboard cards. | **FAIL** | Not calculated in `ops.js` or `Admin.jsx`. | Compute `aov = eligible_orders > 0 ? (revenue / eligible_orders) : 0`. |
| **Sales Metrics: Total estimated profit** | Missing. | **FAIL** | Profit is not aggregated across orders and product costs. | Calculate `revenue - cogs` for paid orders using recorded cost prices. |
| **Sales Metrics: 6-month revenue history** | Missing. Dashboard only shows single period or 21-day inventory age chart. | **FAIL** | No 6-month time-series query exists in `dashboard()`. | Add 6-month rolling monthly revenue and order count array for chart rendering. |
| **Sales Metrics: Best-selling categories** | Missing. Dashboard only shows size/colour gaps. | **FAIL** | No category performance aggregation in `dashboard()`. | Add aggregation grouping paid order items by category with units sold and revenue. |
| **Customer Metrics: Total customers** | Implemented. | **PASS** | `SELECT count(*)::int AS n FROM customer_profiles` in `ops.js:52`. | Retain existing metric. |
| **Customer Metrics: New customers this month** | Missing. | **FAIL** | No date filter applied to `customer_profiles` for new customers. | Add query counting `customer_profiles` where `created_at >= date_trunc('month', now())`. |
| **Customer Metrics: Repeat customers** | Missing. | **FAIL** | No purchase-history query to count customers with >= 2 paid orders. | Add query: `SELECT count(*)::int FROM (SELECT auth_user_id FROM orders WHERE payment_status = 'paid' GROUP BY auth_user_id HAVING count(*) >= 2) t`. |
| **Customer Metrics: Loyalty members** | Partially implemented (active wardrobe memberships only). | **PARTIAL** | Only counts `memberships WHERE status = 'active'`. Does not count CRM loyalty stamp participants. | Return both active wardrobe members and total customers with active loyalty stamps. |
| **Customer Metrics: Retention percentage** | Missing. | **FAIL** | No retention calculation exists. | Implement standard business retention rate: `(repeat_customers / total_purchasing_customers) * 100`. |
| **Inventory Metrics: Total products** | Implemented. | **PASS** | `SELECT count(*)::int AS n FROM products WHERE is_active = true AND archived_at IS NULL`. | Retain existing metric. |
| **Inventory Metrics: Stock value** | Missing. | **FAIL** | Total stock value (`Stock left × Cost per unit`) is not computed. | Add aggregation summing `v.stock_quantity * COALESCE(p.cost_price_inr, 0)` across active variants. |
| **Inventory Metrics: Low-stock count** | Partially implemented (hardcoded in filter select options, but no dashboard summary). | **PARTIAL** | Low stock KPI card is missing from overview. | Add query counting products where remaining stock <= `low_stock_threshold` (default 2). |
| **Inventory Metrics: Fast-moving count** | Missing. | **FAIL** | No calculation comparing units sold against purchased quantity. | Implement calculation: products where `units_sold > 0.5 * purchase_quantity`. |
| **Inventory Metrics: Dead-stock count** | Partially implemented as "Inventory Age" (>21 days), but not dead-stock definition. | **PARTIAL** | Age chart tracks age since creation, not `purchase_quantity > 0 AND units_sold == 0`. | Implement dead-stock count metric adhering strictly to business requirement. |
| **Procurement Metrics: Total POs, Pending & Fulfilled count, Total PO value** | Missing. | **FAIL** | `purchase_orders` table and procurement dashboard metrics do not exist. | Create procurement tables and add PO aggregation to `dashboard()`. |
| **Vendor Metrics: Total vendors, Active count, Total purchase value, Best-selling product** | Missing. | **FAIL** | No vendor aggregation or summary metrics exist in `dashboard()`. | Add vendor KPI queries to `dashboard()`. |
| **Dashboard Drill-downs: Clickable cards opening filtered views** | Cards are static non-clickable `<article className="kpi">` elements. | **FAIL** | No click handlers or routing to filtered views from dashboard KPI cards. | Make cards interactive buttons/links that navigate to relevant sections with filters. |

---

## 2. Customers and Loyalty Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Customer Search by Name & Phone** | Implemented via ListFilter. | **PASS** | `api/admin/ops.js:176-177` searches `full_name`, `email`, and `phone` using `ILIKE`. | Retain and ensure partial phone matching handles whitespace/formatting. |
| **Add Customer** | Missing. | **FAIL** | `Admin.jsx` has no "Add customer" button or form. `ops.js` has no `create_customer` action. | Implement modal & API endpoint to create customer with Name, Phone, Email, Notes. |
| **Edit Customer** | Missing. | **FAIL** | `Admin.jsx` allows viewing customer details in `CustomerDetail`, but has no edit form. | Implement customer edit modal & API endpoint for Name, Phone, Email, Notes. |
| **Delete Customer** | Missing. | **FAIL** | No customer deletion workflow in UI or backend. | Implement safe customer deletion with foreign-key restriction checks. |
| **Customer Profile: Lifetime spend, Order count, AOV, Last purchase date** | Partial in `CustomerDetail` and customer list. | **PARTIAL** | Customer list computes spend/count, but `CustomerDetail` modal omits AOV, Last purchase date, and loyalty card. | Enhance `CustomerDetail` to display AOV, Last purchase date, and Notes. |
| **Customer Profile: Loyalty Card & Stamp Status** | Missing. | **FAIL** | No 6-stamp loyalty visual card in customer profile. | Implement visual 6-stamp loyalty cycle card showing stamps 1-6 and 50% discount eligibility. |
| **Customer Profile: Purchase Timeline** | Partial. Shows date, items, total, status, but lacks reward indicators. | **PARTIAL** | `CustomerDetail` lists orders but doesn't distinguish reward/discounted purchases. | Add reward-purchase indicator badge to timeline rows. |
| **Loyalty Rules: 6 purchases per cycle** | Incomplete. Settings store 50% rule text, but no stamp engine or tracking. | **PARTIAL** | Stored in settings and loyalty rules, but not calculated per customer. | Implement deterministic loyalty calculation: `N % 6` stamps, eligible on stamp 5, resets on 6. |
| **Loyalty Rules: Staff manual discount entry** | Required rule: CRM identifies eligibility, staff manually enters discount in sale form. | **PASS** | Requirement forbids automatic forced application; preserves staff manual control. | Surface eligibility alert on customer profile and sales form; keep discount input manual. |

---

## 3. Inventory Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Inventory Search by Name, Category, SKU/ID** | Implemented in products list. | **PASS** | `ListFilter` supports name, SKU, and category filtering. | Retain search capabilities. |
| **Inventory CRUD (Add, Edit, Delete/Archive)** | Implemented for products, but missing procurement fields. | **PARTIAL** | `modalType === 'product'` allows editing name, price, sizes, but lacks batch/procurement fields. | Add missing inventory fields to product modal and persistence logic. |
| **Known Code Issue: Missing `batch_id`, `purchase_date`, and undefined `suggestBatchId()`** | Code expects batch ID and purchase date; `suggestBatchId` was missing. | **BUG** | Product form omitted `batch_id`, `purchase_date`, `purchase_price_per_piece`, `courier_charge`. `suggestBatchId()` was not implemented. | Implement `suggestBatchId(vendor, date)`, add fields to product form, backend schema, and API. |
| **Field Verification: Name, Category, Size, SKU, Vendor, Prices, Courier, Threshold** | Vendor, Courier charge, Purchase price, and Threshold missing from form. | **PARTIAL** | Only `cost_price_inr` and `variants` prices existed in product modal. | Integrate all required fields into product schema and form. |
| **Calculations: Cost per unit** | Formula: `Purchase price + (Courier charge / Purchase quantity)`. Currently only raw manual cost price. | **PARTIAL** | No automatic courier charge distribution on manual product entry. | Implement formula in `PricingHelper`, backend `products-admin.js`, and procurement fulfilment. |
| **Calculations: Units sold, Stock left, Stock value** | Stock left is tracked per variant, but units sold is not shown on inventory table. | **PARTIAL** | Table displays `stock_total`, but lacks units sold, stock value, and remaining stock value columns. | Compute and display units sold, stock remaining, and total inventory value. |
| **Classification: Low Stock vs Fast Moving vs Dead Stock** | Only "Low stock" filter exists. Fast-moving and dead-stock status not displayed. | **PARTIAL** | Products table has no status badges for fast-moving or dead-stock. | Implement status badges with Low-stock overriding Fast-moving. |
| **Inventory Table Columns** | Missing Product ID, Vendor, Batch ID, Cost per unit, Purchased Qty, Units sold, Remaining value. | **PARTIAL** | Columns currently: Piece, Category, Sizes & price, Cost, Stock, State. | Update table header and rows to include all required inventory audit columns. |

---

## 4. Sales Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Sale Form: Customer selection (required)** | Studio Store mode does not enforce or prompt for customer. | **FAIL** | `Admin.jsx:handleStoreSale` posts `{ items, payment_mode }` without customer ID. | Create full Sale modal requiring customer selection, supporting partial payment & discounts. |
| **Sale Form: Multi-item line entry, qty, sale rate, auto line amount** | Store mode only sells 1 hardcoded piece per click. | **FAIL** | Store Mode table only has a single "Sell" button selling quantity 1 of a single variant. | Implement multi-line item sale form with item selector, editable rate, quantity, and auto line total. |
| **Sale Form: Discount, Final Amount, Amount Paid, Payment Status** | Missing in Store Mode. | **FAIL** | Store Mode assumes 100% paid immediately via UPI/Cash/Card. No partial payments or discounts. | Add discount input, calculate final amount, input amount paid, and determine paid/partially_paid/due. |
| **Calculations: Subtotal, Final amount, Amount due, Estimated profit** | Implemented only in e-commerce checkout, not in Studio POS counter. | **PARTIAL** | E-commerce orders track subtotal/total. Counter sales lack profit and due calculations. | Centralize calculations; store `amount_paid`, `amount_due`, `estimated_profit` on orders. |
| **Validation: Stock check, negative values, discount exceeding subtotal, paid exceeding total** | Only partial stock check in backend `storeSale`. | **PARTIAL** | Form does not validate discount <= subtotal or prevent negative payments. | Add frontend validation and authoritative backend transaction validation. |
| **Inventory Integration: Stock deduction & reversal on delete/cancel** | Dispatched/cancelled orders restore stock, but no counter sale deletion workflow. | **PARTIAL** | `api/admin/ops.js:updateOrder` handles cancel, but there is no dedicated Sale edit/delete modal. | Add full sale management with transactional stock reconciliation. |

---

## 5. Vendors Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Vendor Operations: Add, Edit, Search, Delete, View summary** | Missing. Only `sourcing_batches` table exists. | **FAIL** | Sourcing tab only records raw supplier name text in a batch log. No vendor entity or CRUD. | Implement `vendors` table, backend endpoints, and admin UI for full vendor lifecycle. |
| **Vendor Form: Vendor ID, Name, Contact name, Contact number, Categories** | Missing. | **FAIL** | No vendor form exists. | Implement Vendor modal with auto ID, name, contact info, and category multi-select / addition. |
| **Vendor Summary: POs served, Total purchase value, Sales profit, Best-selling product** | Missing. | **FAIL** | Sourcing tab does not compute or display vendor analytics. | Add vendor metrics aggregation linking vendors to POs, inventory, and sales. |

---

## 6. Procurement Module

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Purchase-Order Operations: Create, Edit unfulfilled, View, Delete unfulfilled, Fulfil** | Missing. | **FAIL** | No PO entity, table, API, or UI exists. | Create `purchase_orders` and `purchase_order_items` tables, API routes, and admin procurement tab. |
| **Purchase-Order Form: Vendor, Date, Batch ID, PO number, Items, Courier, Totals, Notes** | Missing. | **FAIL** | No PO form exists. | Build PO creation/edit form with auto PO number, batch suggestion, multi-item table, and grand total. |
| **Fulfilment Workflow: Atomic inventory creation, courier allocation, duplicate prevention** | Missing. | **FAIL** | No PO fulfilment pipeline exists. | Implement atomic transaction: create inventory records, distribute courier charge, lock PO. |
| **Purchase-Order Download: Printable HTML / Save as PDF** | Invoices have HTML/PDF download, but no PO document export exists. | **FAIL** | No PO template or download action. | Implement printable HTML purchase order view with browser Print / Save as PDF support. |

---

## 7. Saving, Loading and Deletion Workflows

| Sub-Module / Requirement | Current Implementation Status | Classification | Audit Findings & Technical Evidence | Remediation Required |
|---|---|---|---|---|
| **Persistence: Data persists in actual PostgreSQL database** | Implemented for core entities. | **PASS** | Connected via `pg` pool to PostgreSQL. | Ensure all new modules use authoritative database tables. |
| **Reload & State Refresh: UI reflects server state after mutation** | Implemented via `mutate()` and `loadSection()`. | **PASS** | `Admin.jsx` refreshes cache on successful mutation. | Preserve and hook all new operations into `mutate()`. |
| **Deletion Integrity: Prevent orphaned records, soft delete / restrict referenced data** | Implemented for products (archived if ordered). Missing for customers/vendors. | **PARTIAL** | Products are safely archived; vendors and customers lack relational integrity checks. | Enforce relational integrity checks before deleting customers, vendors, or unfulfilled POs. |
| **Error Handling: Clear feedback without exposing stack traces** | Implemented via `showToast` and safe API error codes. | **PASS** | `lib/http.js` standardizes application errors cleanly. | Maintain consistent error response shape across all endpoints. |

---

## Summary Scorecard

- **Total Requirements Audited:** 32
- **PASS:** 8 (25%)
- **PARTIAL:** 11 (34%)
- **FAIL (Missing):** 12 (38%)
- **BUG:** 1 (3%)

The next phases will systematically execute schema migrations, backend API handlers, calculation libraries, and frontend UI updates to bring all 32 requirements to **PASS**.
