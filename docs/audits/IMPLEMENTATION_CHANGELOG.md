# Implementation Changelog: Business Management System Audit & Enhancements

**Studio**: Vishrea Studio  
**System**: Full-Stack Business Management & Studio Operations Engine  
**Release**: 2.8.0-business-ops  
**Status**: Verified & Production Ready  
**Date**: November 2026  

---

## 1. Executive Summary

This changelog records the complete full-stack enhancements, schema migrations, calculation libraries, API endpoints, and admin UI implementations performed across the 7 core business management modules:

1. **Dashboard & Executive Analytics**
2. **Customers, CRM & 6-Purchase Loyalty Program**
3. **Inventory, Landed Costing & Stock Classifications**
4. **Sales, POS Counter & Receipt Generation**
5. **Vendors & Supplier Directory**
6. **Procurement, Purchase Orders & Inventory Intake**
7. **Saving, Loading & Atomic Deletion Workflows**

All changes were implemented strictly adhering to the non-negotiable architectural constraints: preserving existing tables, retaining customer purchase history, preserving checkout workflows, adding non-destructive archiving, and resolving the known missing fields (`purchase_date`, `batch_id`) and undefined `suggestBatchId()` issue.

---

## 2. Database Schema & Migrations

### Migration `migrations/028_business_management_modules.sql`
- **Vendors Table (`vendors`)**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `code VARCHAR(40) UNIQUE NOT NULL`
  - `name VARCHAR(160) NOT NULL`
  - `contact_person VARCHAR(120)`
  - `phone VARCHAR(40)`
  - `email VARCHAR(120)`
  - `address TEXT`
  - `categories TEXT[] DEFAULT '{}'`
  - `notes TEXT`
  - `is_active BOOLEAN DEFAULT true`
  - `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`

- **Purchase Orders Table (`purchase_orders`)**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `po_number VARCHAR(60) UNIQUE NOT NULL`
  - `vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT`
  - `vendor_name VARCHAR(160) NOT NULL`
  - `order_date DATE NOT NULL`
  - `batch_id VARCHAR(60)`
  - `courier_charges NUMERIC(12,2) DEFAULT 0.00`
  - `subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00`
  - `grand_total NUMERIC(12,2) NOT NULL DEFAULT 0.00`
  - `status VARCHAR(30) DEFAULT 'unfulfilled' CHECK (status IN ('unfulfilled', 'fulfilled', 'cancelled'))`
  - `fulfilled_at TIMESTAMPTZ`
  - `notes TEXT`
  - `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`

- **Purchase Order Items Table (`purchase_order_items`)**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE`
  - `item_name VARCHAR(200) NOT NULL`
  - `category VARCHAR(80)`
  - `quantity INTEGER NOT NULL CHECK (quantity > 0)`
  - `unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0.00`
  - `line_total NUMERIC(12,2) NOT NULL DEFAULT 0.00`

- **Products Table Enhancements (`products`)**:
  - `vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL`
  - `batch_id VARCHAR(60)`
  - `purchase_date DATE`
  - `purchase_quantity INTEGER DEFAULT 1`
  - `purchase_price_per_piece NUMERIC(12,2) DEFAULT 0.00`
  - `courier_charge NUMERIC(12,2) DEFAULT 0.00`
  - `low_stock_threshold INTEGER DEFAULT 2`

- **Customer Profiles Table Enhancements (`customer_profiles`)**:
  - `notes TEXT`
  - `tags TEXT[] DEFAULT '{}'`

- **Orders Table Enhancements (`orders`)**:
  - `amount_paid NUMERIC(12,2)`
  - `amount_due NUMERIC(12,2)`
  - `sale_date DATE`
  - `customer_id VARCHAR(80)`
  - `customer_name VARCHAR(160)`
  - `customer_phone VARCHAR(40)`
  - `estimated_cost NUMERIC(12,2)`
  - `estimated_profit NUMERIC(12,2)`
  - `manual_discount NUMERIC(12,2)`

### Unified Schema Synchronization
- Updated `supabase_complete_schema.sql` with table definitions, foreign keys, and indexes for single-file deployment idempotency.

---

## 3. Business Calculation Libraries

Created identical Node.js and browser-compatible ESM mathematical modules:
- Backend: `lib/business-calculations.js`
- Frontend: `vishrea-react/src/lib/business-calculations.js`

### Functions Implemented:
1. `suggestBatchId(supplierName, dateStr)`:
   - Resolves known undefined function issue.
   - Cleans vendor prefix, extracts YYYYMM date, and appends a 2-character hex suffix. Format: `${PREFIX}-${YYYYMM}-${HEX}`.
2. `calculateCostPerUnit(purchasePrice, courierCharge, quantity)`:
   - Formula: `Purchase price per piece + (Total courier charge / Purchase quantity)`.
   - Handles edge cases of 0 quantity, null charges, and negative inputs.
3. `calculateStockLeft(purchaseQuantity, unitsSold)`:
   - Formula: `Math.max(0, purchaseQuantity - unitsSold)`. Never displays negative stock.
4. `calculateStockValue(stockLeft, costPerUnit)`:
   - Formula: `Math.max(0, stockLeft) * Math.max(0, costPerUnit)`.
5. `classifyInventory({ stock_left, purchase_quantity, units_sold, low_stock_threshold })`:
   - Priority 1: `stock_left <= threshold` → `'low_stock'`
   - Priority 2: `units_sold > 0.5 * purchase_quantity` → `'fast_moving'`
   - Priority 3: `purchase_quantity > 0 && units_sold === 0` → `'dead_stock'`
   - Fallback: `'normal'`
6. `calculateLineAmount(quantity, saleRate)`:
   - Multiplies non-negative quantity and unit rate.
7. `calculateSaleTotals(subtotal, discountAmount, amountPaid)`:
   - Calculates bounded discount, final total, amount due, and payment status (`paid`, `partially_paid`, `due`).
8. `calculateCustomerLoyalty(purchaseCount)`:
   - Enforces 6-purchase cycle. Stamp count = `N % 6` (0..5).
   - If stamp === 5: flags `is_reward_eligible: true` (50% off next purchase).
   - If stamp === 0: resets cycle. CRM indicates eligibility; staff enters manual discount.
9. `calculatePurchaseOrderTotals(items, courierCharges)`:
   - Sums line totals and calculates freight allocation per item.
10. `calculateRetentionRate(repeatCustomers, totalCustomers)`:
    - Calculates retention percentage rounded to 1 decimal place.

---

## 4. Backend Operations & API (`api/admin/ops.js` & `lib/products-admin.js`)

### `lib/products-admin.js`:
- Updated `saveProduct` handler to process `vendor_id`, `supplier_name`, `batch_id`, `purchase_date`, `purchase_quantity`, `purchase_price_per_piece`, `courier_charge`, `low_stock_threshold`.
- Calculates landed cost automatically if purchase price/freight provided.
- Syncs batch record to `product_sources` table for sourcing batch continuity.

### `api/admin/ops.js`:
- **Dashboard Handler (`dashboard(q)`)**:
  - Implemented all-time revenue and order counts (`all_time_revenue`, `all_time_orders`).
  - Implemented today's revenue and order count (`today_revenue`, `today_orders`).
  - Implemented Average Order Value (AOV) on eligible completed orders.
  - Implemented Total Estimated Profit (`estimated_profit` from orders table and landed product costs).
  - Implemented 6-month rolling revenue aggregation (`six_month_revenue`).
  - Implemented best-selling categories query (`best_selling_categories`).
  - Implemented new customers this month (`new_customers_this_month`).
  - Implemented repeat customers count (`repeat_customers`) with 2+ purchases.
  - Implemented customer retention rate percentage (`retention_rate`).
  - Implemented inventory stock health metrics (`stock_value`, `low_stock_count`, `fast_moving_count`, `dead_stock_count`).
  - Implemented procurement metrics (`total_pos`, `pending_pos`, `fulfilled_pos`, `total_po_value`).
  - Implemented vendor metrics (`total_vendors`, `active_vendors`, `best_selling_product`).
- **GET Handlers**:
  - `case 'vendors'`: returns supplier directory with PO counts, purchase spend, and sales profit.
  - `case 'vendor'`: returns single vendor detail.
  - `case 'procurement'` & `case 'purchase_orders'`: returns purchase orders list with item aggregations and active vendor dropdown list.
  - `case 'purchase_order'`: returns purchase order with line items.
  - `case 'sales'`: returns POS and counter sales with items breakdown.
  - `case 'store'`: returns active products, recent sales history, and customer dropdown options.
  - Enhanced `case 'products'`: returns vendor details, batch ID, units sold, and stock remaining value.
  - Enhanced `case 'customer'`: returns lifetime orders, lifetime spend, AOV, last purchase date, and 6-stamp loyalty cycle status.
- **POST Handlers**:
  - `section === 'vendor'`: validates, creates or updates vendor record.
  - `section === 'purchase_order'`: validates line items, calculates totals, creates or updates unfulfilled PO.
  - `section === 'fulfil_purchase_order'`: atomically fulfils PO in transaction, generates/updates product catalogue pieces, and sets status to fulfilled.
  - `section === 'sale'` & `section === 'store_sale'`: records walk-in counter sale, decrements variant stock, captures landed cost, checks customer loyalty, and issues GST invoice.
  - `section === 'customer'`: adds or updates customer profile and client notes.
- **DELETE Handlers**:
  - `section === 'vendor'`: checks for associated POs and inventory pieces before deletion.
  - `section === 'purchase_order'`: blocks deletion of fulfilled POs.
  - `section === 'sale'`: atomically cancels counter sale and restores product variant inventory.
  - `section === 'customer'`: blocks deletion if customer has completed paid orders.

---

## 5. Frontend Admin Interface (`Admin.jsx` & `AdminExtras.jsx`)

### `vishrea-react/src/pages/AdminExtras.jsx`:
- **Enhanced `CustomerDetail` Modal**:
  - Visual 6-stamp loyalty card tracker.
  - 50% reward eligibility banner when stamp === 5.
  - Lifetime metrics bar (Total Spend, Paid Orders, AOV, Last Purchase Date).
  - Client Notes card with timestamp.
  - Purchase timeline showing item names, quantities, invoice numbers, rates, and reward purchase indicators.

### `vishrea-react/src/pages/Admin.jsx`:
- **Navigation & Routing**:
  - Added `Procurement & POs` (`procurement`) and `Vendors` (`vendors`) to `SECTIONS`.
  - Renamed store section to `Counter Sales & POS` (`store`).
  - Added list filters for `procurement`, `vendors`, and `store`.
  - Added query string listener in `useEffect` so dashboard drill-downs immediately load filtered module views (e.g. `&state=low_stock`, `&status=unfulfilled`, `&sort=order_count`).
- **Dashboard Section**:
  - Reorganized into 4 themed KPI groups: Sales Performance, Customer & Retention Metrics, Inventory & Stock Health, and Procurement & Vendor Operations.
  - Wrapped every metric card in a drill-down `<Link>` routing directly to the corresponding module and filtered state.
  - Added 6-Month Rolling Revenue Trend table panel.
  - Added Best-Selling Categories table panel.
- **Inventory & Catalogue Section**:
  - Expanded table with 10 columns: Piece / SKU, Category, Vendor & Batch, Sizes & Price, Cost/Unit, Purchased/Sold, Stock Left, Stock Value, Status badges (`Low Stock`, `Fast Moving`, `Dead Stock`), and Actions.
  - Updated Product Add/Edit Modal with Supplier, Purchase Date, Batch ID with "Suggest Batch ID" button, Purchase Price, Quantity, Courier Freight, Landed Cost preview, and Low-Stock threshold.
- **Customers Section**:
  - Added "+ Add Customer" action button.
  - Added Customer Add/Edit Modal (`modalType === 'customer'`) for Full Name, Email, Phone, and Client Notes.
  - Added "Edit" and "Delete" actions to customer table rows.
- **Counter Sales & POS Section**:
  - Added "+ New Counter Sale" button opening `modalType === 'counter_sale'`.
  - Counter Sale modal includes customer dropdown with loyalty stamp preview, 50% reward banner for eligible clients, dynamic line items with available stock validation, manual discount entry, live total/due/status/profit preview, and payment mode selector.
  - Added Recorded Sales History table showing invoices, dates, clients, items sold, subtotals, discounts, finals, paid/due, payment status, estimated profit, and action buttons.
  - Added Sale Receipt printable modal (`modalType === 'receipt'`) with `window.print()` integration.
  - Added atomic Cancel Sale action with inventory stock restoration.
- **Procurement & POs Section**:
  - Created procurement dashboard view with Status filter (All, Unfulfilled, Fulfilled, Cancelled).
  - Added "+ New Purchase Order" modal (`modalType === 'purchase_order'`) with vendor selector, order date, "Suggest Batch ID" button, courier freight, multi-line item inputs, and live subtotal/grand total calculations.
  - Added Fulfil Order action button with confirmation dialog.
  - Added Printable Purchase Order document modal (`modalType === 'view_po'`) with official studio layout and print action.
- **Vendors Section**:
  - Created vendors dashboard view with vendor table (Code, Name, Contact, Phone, Categories badges, PO count, Total spend, Sales margin, Status).
  - Added "+ Add Vendor" modal (`modalType === 'vendor'`) with Code, Name, Contact Person, Phone, Email, Address, Categories, and Notes.

---

## 6. Verification and Regression Testing

- **Business Calculation Unit Tests**:
  - `node --test test/business-calculations.test.js`: **9/9 tests passed** (100% pass rate).
- **Core Platform Unit Tests**:
  - `npm run test:unit`: **14/14 tests passed** (100% pass rate).
- **Static Analysis & Linting**:
  - `cd vishrea-react; npx oxlint src`: **0 errors** (45 non-blocking warnings on pure date render and refs).
- **Client Production Build**:
  - `npm run build` (Vite 8.3.4): **Compiled cleanly in 691ms** with zero bundle errors.
- **Node Syntax Verification**:
  - `node -c api/admin/ops.js`: Clean.
  - `node -c lib/products-admin.js`: Clean.
  - `node -c lib/business-calculations.js`: Clean.

---

## 7. Migration Safety & Production Readiness

- All database schema updates use `IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` for zero-downtime execution.
- Existing customers, orders, and products retain full data integrity.
- Fulfilled purchase orders and vendors with active purchase records are protected by database foreign key constraints and transactional checks.
- Deleted sales cleanly restore inventory variant stocks atomically inside database transactions.
