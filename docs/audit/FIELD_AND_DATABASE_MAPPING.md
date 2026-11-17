# Field and Database Mapping Specification
**System:** Vishrea Studio Business Management System  
**Date:** 17 November 2026  
**Document Version:** 1.0  

---

## 1. Dashboard Module

The Dashboard aggregates metrics across database tables. Below is the mapping of aggregated metrics to source tables and query definitions.

| Metric | API Property | Source Table & Column(s) | Computation Logic |
|---|---|---|---|
| All-time Revenue | `all_time_revenue` | `orders.total` | `SUM(total) WHERE payment_status = 'paid'` |
| All-time Orders | `all_time_orders` | `orders.id` | `COUNT(*) WHERE payment_status = 'paid'` |
| Current Month Revenue | `monthly_revenue` | `orders.total`, `orders.paid_at` | `SUM(total) WHERE payment_status = 'paid' AND paid_at >= date_trunc('month', now())` |
| Current Month Orders | `monthly_orders` | `orders.id`, `orders.paid_at` | `COUNT(*) WHERE payment_status = 'paid' AND paid_at >= date_trunc('month', now())` |
| Today's Revenue | `today_revenue` | `orders.total`, `orders.paid_at` | `SUM(total) WHERE payment_status = 'paid' AND paid_at >= current_date` |
| Today's Orders | `today_orders` | `orders.id`, `orders.paid_at` | `COUNT(*) WHERE payment_status = 'paid' AND paid_at >= current_date` |
| Average Order Value | `aov` | Derived | `monthly_revenue / NULLIF(monthly_orders, 0)` |
| Total Estimated Profit | `total_profit` | `orders.total`, `orders.estimated_cost` | `SUM(total - COALESCE(estimated_cost, 0)) WHERE payment_status = 'paid'` |
| 6-Month Revenue History | `revenue_history` | `orders.paid_at`, `orders.total` | `GROUP BY date_trunc('month', paid_at) ORDER BY month DESC LIMIT 6` |
| Best-Selling Categories | `best_categories` | `order_items`, `products`, `categories` | `JOIN ON category_id GROUP BY category_name ORDER BY total_units DESC LIMIT 5` |
| Total Customers | `customers` | `customer_profiles.id` | `COUNT(*)` |
| New Customers This Month | `new_customers_month` | `customer_profiles.created_at` | `COUNT(*) WHERE created_at >= date_trunc('month', now())` |
| Repeat Customers | `repeat_customers` | `orders.auth_user_id` | `COUNT(*) FROM (SELECT auth_user_id FROM orders WHERE payment_status='paid' GROUP BY auth_user_id HAVING COUNT(*) >= 2)` |
| Loyalty Active Members | `loyalty_members` | `memberships`, `orders` | `COUNT(DISTINCT auth_user_id) with active membership or active stamp cycle` |
| Retention Percentage | `retention_rate` | Derived | `(repeat_customers / NULLIF(total_purchasing_customers, 0)) * 100` |
| Total Products | `products` | `products.id` | `COUNT(*) WHERE is_active = true AND archived_at IS NULL` |
| Stock Value | `stock_value` | `product_variants.stock_quantity`, `products.cost_price_inr` | `SUM(v.stock_quantity * COALESCE(p.cost_price_inr, 0))` |
| Low-Stock Count | `low_stock_count` | `products`, `product_variants` | `COUNT(*) WHERE total_stock <= COALESCE(p.low_stock_threshold, 2)` |
| Fast-Moving Count | `fast_moving_count` | `products`, `order_items` | `COUNT(*) WHERE units_sold > (purchase_quantity * 0.5)` |
| Dead-Stock Count | `dead_stock_count` | `products`, `order_items` | `COUNT(*) WHERE purchase_quantity > 0 AND units_sold = 0` |
| Total Purchase Orders | `total_pos` | `purchase_orders.id` | `COUNT(*)` |
| Pending Fulfilment POs | `pending_pos` | `purchase_orders.status` | `COUNT(*) WHERE status = 'unfulfilled'` |
| Fulfilled POs | `fulfilled_pos` | `purchase_orders.status` | `COUNT(*) WHERE status = 'fulfilled'` |
| Total PO Value | `total_po_value` | `purchase_orders.grand_total` | `SUM(grand_total)` |
| Total Vendors | `total_vendors` | `vendors.id` | `COUNT(*)` |
| Active Vendors | `active_vendors` | `vendors.is_active` | `COUNT(*) WHERE is_active = true` |
| Vendor Purchase Value | `vendor_purchase_value` | `purchase_orders.grand_total` | `SUM(grand_total)` across all purchase orders |
| Best-Selling Product | `top_product` | `order_items.product_name` | Top product by units sold from paid orders |

---

## 2. Customers and Loyalty Module

### Table: `customer_profiles` & `profiles`
Primary Key: `id` (UUID), Foreign Key: `auth_user_id` (TEXT UNIQUE)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Full Name | `full_name` | `customer_profiles.full_name` | `TEXT` | Required, Max 120 chars |
| Phone Number | `phone` | `customer_profiles.phone` | `TEXT` | Optional, digits & spaces/dashes permitted |
| Email Address | `email` | `profiles.email` / `customer_profiles.email` | `TEXT` | Required if new user, valid email format |
| GST Number | `gst_number` | `customer_profiles.gst_number` | `TEXT` | Optional, uppercase 15 chars |
| Notes | `notes` | `customer_profiles.notes` | `TEXT` | Optional, max 2000 chars |
| Tags | `tags` | `customer_profiles.tags` | `JSONB` | Array of text tags, system/internal |
| Marketing Opt-in | `marketing_opt_in` | `customer_profiles.marketing_opt_in` | `BOOLEAN` | Default `false` |
| WhatsApp Opt-in | `whatsapp_opt_in` | `customer_profiles.whatsapp_opt_in` | `BOOLEAN` | Default `false` |

### Loyalty State Mapping (Computed dynamically from `orders`)
| Display Attribute | Calculation / Source | Data Type | Notes |
|---|---|---|---|
| Lifetime Orders | `COUNT(orders.id)` | `INTEGER` | Filter: `payment_status = 'paid'` |
| Lifetime Spend | `SUM(orders.total)` | `NUMERIC(12,2)` | Filter: `payment_status = 'paid'` |
| Current Stamp Count | `Lifetime Orders % 6` | `INTEGER` (0–5) | Number of filled stamps in current cycle |
| Completed Cycles | `FLOOR(Lifetime Orders / 6)` | `INTEGER` | Completed 6-order discount cycles |
| 50% Reward Eligible | `(Lifetime Orders % 6) === 5` | `BOOLEAN` | Eligible for 50% off next purchase |
| Last Purchase Date | `MAX(orders.paid_at)` | `TIMESTAMPTZ` | Display formatted date |

---

## 3. Inventory Module

### Table: `products`
Primary Key: `id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Product ID | `id` | `products.id` | `UUID` | Auto-generated on insert |
| Name / Description | `name` | `products.name` | `TEXT` | Required, max 160 chars |
| Description Details | `description` | `products.description` | `TEXT` | Optional, max 5000 chars |
| Category | `category_id` | `products.category_id` | `UUID` | Foreign key to `categories.id` |
| Vendor | `vendor_id` / `supplier_name` | `products.vendor_id`, `products.supplier_name` | `UUID`, `TEXT` | Associated vendor reference |
| Batch ID | `batch_id` | `products.batch_id` | `TEXT` | Generated via `suggestBatchId()`, editable |
| Purchase Date | `purchase_date` | `products.purchase_date` | `DATE` | Valid ISO date `YYYY-MM-DD` |
| Purchase Price Per Piece | `purchase_price_per_piece` | `products.purchase_price_per_piece` | `NUMERIC(12,2)` | Numeric >= 0 |
| Purchase Quantity | `purchase_quantity` | `products.purchase_quantity` | `INTEGER` | Integer >= 0 |
| Total Courier Charge | `courier_charge` | `products.courier_charge` | `NUMERIC(12,2)` | Numeric >= 0 |
| Cost Price Per Unit (INR) | `cost_price_inr` | `products.cost_price_inr` | `NUMERIC(12,2)` | Computed: `purchase_price + (courier / qty)` |
| Low-Stock Threshold | `low_stock_threshold` | `products.low_stock_threshold` | `INTEGER` | Integer >= 0, default 2 |
| Selling Price | `price_inr` | `products.price_inr` | `NUMERIC(12,2)` | Base price across active variants |
| Inventory Type | `is_one_of_one` | `products.is_one_of_one` | `BOOLEAN` | `true` = 1 piece max, `false` = multi-stock |
| Active Status | `is_active` | `products.is_active` | `BOOLEAN` | `true` = visible in store |

### Table: `product_variants`
Primary Key: `id` (UUID), Foreign Key: `product_id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Variant ID | `id` | `product_variants.id` | `UUID` | Auto-generated on insert |
| Size Label | `size_label` | `product_variants.size_label` | `TEXT` | Required (e.g. 'Free Size', 'M', 'L') |
| SKU | `sku` | `product_variants.sku` | `TEXT` | Unique alphanumeric string, auto if blank |
| Price (INR) | `price_inr` | `product_variants.price_inr` | `NUMERIC(12,2)` | Numeric > 0 |
| Sale Price (INR) | `sale_price_inr` | `product_variants.sale_price_inr` | `NUMERIC(12,2)` | Optional, must be < price_inr |
| Stock Quantity | `stock_quantity` | `product_variants.stock_quantity` | `INTEGER` | Integer >= 0 |
| Active Variant | `is_active` | `product_variants.is_active` | `BOOLEAN` | Default `true` |

---

## 4. Sales Module

### Table: `orders`
Primary Key: `id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Order ID / Sale ID | `id` | `orders.id` | `UUID` | Auto-generated |
| Customer Reference | `customer_id` / `auth_user_id` | `orders.auth_user_id`, `orders.customer_id` | `TEXT` | Required customer identity |
| Customer Name | `customer_name` | `orders.customer_name` | `TEXT` | Customer full name |
| Customer Phone | `customer_phone` | `orders.customer_phone` | `TEXT` | Customer contact number |
| Sale Date | `sale_date` | `orders.sale_date` | `DATE` | Default `CURRENT_DATE` |
| Subtotal | `subtotal` | `orders.subtotal` | `NUMERIC(12,2)` | Sum of line totals |
| Discount Amount | `discount` / `discount_amount` | `orders.discount_amount` | `NUMERIC(12,2)` | Numeric >= 0, <= subtotal |
| Final Amount | `total` | `orders.total` | `NUMERIC(12,2)` | `MAX(0, subtotal - discount)` |
| Amount Paid | `amount_paid` | `orders.amount_paid` | `NUMERIC(12,2)` | Numeric >= 0, <= total |
| Amount Due | `amount_due` | `orders.amount_due` | `NUMERIC(12,2)` | `MAX(0, total - amount_paid)` |
| Payment Status | `payment_status` | `orders.payment_status` | `TEXT` | `'paid'`, `'partially_paid'`, `'pending'` |
| Fulfilment Status | `status` | `orders.status` | `TEXT` | `'delivered'`, `'dispatched'`, `'processing'` |
| Channel | `channel` | `orders.channel` | `TEXT` | `'studio'` for counter sales, `'web'` for online |
| Estimated Cost | `estimated_cost` | `orders.estimated_cost` | `NUMERIC(12,2)` | Sum of item cost prices |
| Estimated Profit | `estimated_profit` | `orders.estimated_profit` | `NUMERIC(12,2)` | `total - estimated_cost` |

### Table: `order_items`
Primary Key: `id` (UUID), Foreign Key: `order_id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Product ID | `product_id` | `order_items.product_id` | `UUID` | Foreign key to `products.id` |
| Variant ID | `variant_id` | `order_items.variant_id` | `UUID` | Foreign key to `product_variants.id` |
| Product Name | `product_name` | `order_items.product_name` | `TEXT` | Name of piece sold |
| Size / Label | `variant_label` | `order_items.variant_label` | `TEXT` | Size designation |
| Quantity | `quantity` | `order_items.quantity` | `INTEGER` | Positive integer >= 1 |
| Unit Price / Rate | `unit_price` | `order_items.unit_price` | `NUMERIC(12,2)` | Selling rate per unit |

---

## 5. Vendors Module

### Table: `vendors`
Primary Key: `id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Vendor ID | `vendor_code` | `vendors.vendor_code` | `TEXT UNIQUE` | Auto-generated e.g. `VEND-001` |
| Vendor Name | `name` | `vendors.name` | `TEXT` | Required, unique case-insensitive |
| Contact Name | `contact_name` | `vendors.contact_name` | `TEXT` | Primary representative |
| Contact Number | `contact_phone` | `vendors.contact_phone` | `TEXT` | Phone number for orders |
| Categories | `categories` | `vendors.categories` | `JSONB` | Array of text categories supplied |
| Notes | `notes` | `vendors.notes` | `TEXT` | Optional supplier background notes |
| Is Active | `is_active` | `vendors.is_active` | `BOOLEAN` | Default `true` |

---

## 6. Procurement Module

### Table: `purchase_orders`
Primary Key: `id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| PO Number | `po_number` | `purchase_orders.po_number` | `TEXT UNIQUE` | Auto-generated e.g. `PO-202611-001` |
| Vendor | `vendor_id` | `purchase_orders.vendor_id` | `UUID` | Foreign key to `vendors.id` |
| Vendor Name | `vendor_name` | `purchase_orders.vendor_name` | `TEXT` | Snapshot of vendor name |
| Order Date | `order_date` | `purchase_orders.order_date` | `DATE` | Valid ISO date `YYYY-MM-DD` |
| Batch ID | `batch_id` | `purchase_orders.batch_id` | `TEXT` | Generated from vendor + date, editable |
| Courier Charges | `courier_charges` | `purchase_orders.courier_charges` | `NUMERIC(12,2)` | Numeric >= 0, default 0 |
| Subtotal | `subtotal` | `purchase_orders.subtotal` | `NUMERIC(12,2)` | Sum of line totals |
| Grand Total | `grand_total` | `purchase_orders.grand_total` | `NUMERIC(12,2)` | `subtotal + courier_charges` |
| Fulfilment Status | `status` | `purchase_orders.status` | `TEXT` | `'unfulfilled'`, `'fulfilled'`, `'cancelled'` |
| Fulfilment Date | `fulfilled_at` | `purchase_orders.fulfilled_at` | `TIMESTAMPTZ` | Timestamp when marked fulfilled |
| Notes | `notes` | `purchase_orders.notes` | `TEXT` | Order specifications / shipment instructions |

### Table: `purchase_order_items`
Primary Key: `id` (UUID), Foreign Key: `purchase_order_id` (UUID)

| Frontend Form Field | API Payload Key | Database Column | Data Type | Validation Rules / Notes |
|---|---|---|---|---|
| Item Name / Type | `item_name` | `purchase_order_items.item_name` | `TEXT` | Required |
| Category | `category` | `purchase_order_items.category` | `TEXT` | Category name |
| Category ID | `category_id` | `purchase_order_items.category_id` | `UUID` | Optional FK to `categories.id` |
| Quantity | `quantity` | `purchase_order_items.quantity` | `INTEGER` | Positive integer >= 1 |
| Unit Cost | `unit_cost` | `purchase_order_items.unit_cost` | `NUMERIC(12,2)` | Numeric >= 0 |
| Line Total | `line_total` | `purchase_order_items.line_total` | `NUMERIC(12,2)` | Computed: `quantity * unit_cost` |
