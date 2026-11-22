# VISHREA STUDIO — Automatic Human-Readable ID System Report

**Date:** November 18, 2026  
**Status:** Implemented, Backfilled & Production-Ready  
**Standard Format:** `PREFIX-YYYY-NNN` (e.g. `VEN-2026-001`, `CUST-2026-001`, `PROD-2026-001`)  

---

## 1. Architecture & Design Principles

To eliminate reliance on sliced raw UUIDs (e.g., `#6FA3B1C2`) in day-to-day studio retail operations, phone orders, courier logistics, and client invoices, an automatic, sequential, human-readable ID generator has been deployed across both online and in-store modules.

### Key Architectural Tenets
1. **Preservation of UUID PKs & FKs:** All existing PostgreSQL primary keys (`id uuid DEFAULT gen_random_uuid()`) and foreign key relationships remain untouched. Human-readable IDs operate as unique alternate keys (`UNIQUE NOT NULL`).
2. **Concurrency-Safe Atomic Sequences:** Generation uses an atomic sequence tracker table (`id_sequences`) with PostgreSQL `ON CONFLICT DO UPDATE ... RETURNING current_val`. Multiple parallel checkouts, POS counter sales, or batch inventory inwardings will never produce duplicates or deadlock.
3. **Year Rollover Safety:** Sequences track `(prefix, year)` as a composite primary key. On January 1st, sequence counters naturally restart at `001` for the new year while preserving historic uniqueness.
4. **Universal Surface Area:** Human-readable IDs appear in Admin UI tables, search inputs, detail sheets, customer account records, and CSV exports.

---

## 2. Prefix Registry & Database Schema Mapping

| Module / Entity | Standard Prefix | Format Example | Database Table | Column Name | Index & Constraints |
|---|---|---|---|---|---|
| **Vendors** | `VEN` | `VEN-2026-001` | `vendors` | `vendor_code` | `UNIQUE` constraint |
| **Customers** | `CUST` | `CUST-2026-001` | `customer_profiles` | `customer_code` | Unique index `idx_customer_profiles_customer_code` |
| **Categories** | `CAT` | `CAT-2026-001` | `categories` | `category_code` | Unique index `idx_categories_category_code` |
| **Products** | `PROD` | `PROD-2026-001` | `products` | `product_code` | Unique index `idx_products_product_code` |
| **Inventory Items** | `INV` | `INV-2026-001` | `inventory` | `inventory_code` | Unique index `idx_inventory_inventory_code` |
| **Counter Sales (POS)** | `SALE` | `SALE-2026-001` | `orders` (`channel='studio'`) | `order_number` | Unique index `idx_orders_order_number` |
| **Web Orders** | `ORD` | `ORD-2026-001` | `orders` (`channel='web'`) | `order_number` | Unique index `idx_orders_order_number` |
| **Purchase Orders (PO)** | `PO` | `PO-2026-001` | `purchase_orders` | `po_number` | `UNIQUE` constraint |
| **Memberships** | `MEM` | `MEM-2026-001` | `memberships` | `membership_code` | Unique index `idx_memberships_membership_code` |
| **Gifts & Enquiries** | `GIFT` | `GIFT-2026-001` | `gifts` / `admin_gift_enquiries` | `gift_code` | Unique index `idx_gifts_gift_code` |
| **Exchange Requests** | `EXC` | `EXC-2026-001` | `exchanges` | `exchange_code` | Unique index `idx_exchanges_exchange_code` |

---

## 3. Database Migration 029 Execution & Historical Backfill

Migration `migrations/029_human_readable_ids.sql` was successfully applied to PostgreSQL. All historical records were backfilled chronologically:

| Entity Table | Records Backfilled | ID Range Assigned | Current Sequence Counter |
|---|---|---|---|
| `customer_profiles` | 8 customers | `CUST-2026-001` – `CUST-2026-008` | 8 |
| `categories` | 11 categories | `CAT-2026-001` – `CAT-2026-011` | 11 |
| `products` | 10 products | `PROD-2026-001` – `PROD-2026-010` | 10 |
| `inventory` | 10 inventory items | `INV-2026-001` – `INV-2026-010` | 10 |
| `orders` | 8 orders | `ORD-2026-001` – `ORD-2026-008` | 8 |
| `vendors` | 2 vendors | `VEN-2026-001` – `VEN-2026-002` | 2 |
| `purchase_orders` | Initialized | Starting at `PO-2026-001` | 0 |
| `memberships` | 3 memberships | `MEM-2026-001` – `MEM-2026-003` | 3 |
| `exchanges` | 1 exchange | `EXC-2026-001` | 1 |

---

## 4. Backend Service Integration Details

### `lib/id-generator.js`
Exports:
- `nextHumanId(client, prefix, year)`: PostgreSQL atomic upsert on `id_sequences`.
- `isValidHumanId(id, expectedPrefix)`: Format regex verification helper.
- `ID_PREFIXES`: Standard prefix constants.

### Integrated Endpoints & Services
1. `api/checkout.js`: Generates `ORD-YYYY-NNN` for e-commerce checkout.
2. `api/admin/ops.js`:
   - Store Counter Sales: Generates `SALE-YYYY-NNN`.
   - Vendors: Generates `VEN-YYYY-NNN`.
   - Purchase Orders: Generates `PO-YYYY-NNN`.
   - Admin Customers: Generates `CUST-YYYY-NNN`.
   - Categories: Generates `CAT-YYYY-NNN`.
3. `lib/products-admin.js`: Generates `PROD-YYYY-NNN` on product catalog creation.
4. `lib/inventory.js`: Generates `INV-YYYY-NNN` during inventory synchronization.
5. `lib/billing.js` & `lib/gifts.js`: Generates `MEM-YYYY-NNN` on membership signup / gift activation.
6. `api/exchange.js`: Generates `EXC-YYYY-NNN` on exchange request submission.
7. `api/auth.js`: Generates `CUST-YYYY-NNN` on customer account registration.

---

## 5. Admin UI Integration
- **Orders Table:** Displays `ORD-2026-00X` instead of truncated UUIDs.
- **Sales Table:** Displays `SALE-2026-00X` and cancel confirmation dialogs reference the sale number.
- **Customers CRM:** Displays `CUST-2026-00X` prominently in wine font.
- **Products Catalog:** Displays `PROD-2026-00X` alongside title and SKU.
- **Exchanges View:** Displays `EXC-2026-00X` and associated order ID.
- **CSV Exports:** Customer, Product, and Order CSV exports include `customer_code`, `product_code`, and `order_number` columns as the first column.
