# Database Optimization

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Database measured | Local PostgreSQL 18 (`vishrea_load`: 411 products, 950 variants, 14,241 orders/reservations after load tests, 1,000 customers) |
| Tool | `EXPLAIN (ANALYZE, BUFFERS)` via `scripts/explain-queries.js` |
| Related | [technical/DATABASE_SCHEMA](technical/DATABASE_SCHEMA.md) · [LOAD_TEST_REPORT](LOAD_TEST_REPORT.md) |

## 1. Query plans for the hot paths

| Query | Execution | Access path |
|---|---|---|
| Homepage featured (4) | 0.94 ms | seq scan `products` (filtered), variant summary via `uq_product_variants_definition` |
| Catalogue, all, featured sort (24 of 411) | 7.72 ms | seq scan `products`; variant summary computed for every live product before sort/limit |
| Catalogue by category | 1.28 ms | as above, category filter first |
| Catalogue price ascending + in stock | 6.41 ms | as above |
| Catalogue search `wine` | 2.06 ms | seq scan with `LIKE` |
| Product by slug | 0.20 ms | `idx_products_slug` |
| Reservations by order | 0.02–0.04 ms | partial `idx_inventory_reservations_expiry` (held) or unique `(order_id, variant_id)` |
| Customer order list | 0.28 ms | `idx_orders_user_created` |
| Session lookup | 0.14 ms | index-only `profiles_auth_user_id_key` |
| Expiry sweep | 0.02 ms | `idx_orders_pending_expiry` |

**Reading.** Every lookup by key is indexed. The only work that grows with the catalogue is the listing query: its variant summary (`LATERAL` aggregate per product) runs for all live products so that the price sort and the "has a buyable variant" filter are correct. At 411 products it costs ≈ 7 ms; at 5,000 it would cost roughly ten times that. That cost is now paid once per 10 s per distinct listing (public cache) instead of once per request. If the catalogue grows past a few thousand live pieces, store `min_price`/`in_stock` on `products` (maintained in `syncProductInventory`) and index them.

## 2. Indexes

No index was added. A draft index on `inventory_reservations (order_id, status)` was **withdrawn** after `EXPLAIN` showed the existing unique `(order_id, variant_id)` index already serves those lookups in 0.02–0.04 ms. Existing indexes (migrations 004–019) already cover: product slug and category, live products by `featured, created_at`, variants by product, carts/cart items, orders by user/status/expiry/gateway ids, reservations by expiry, credit ledger, membership periods, payments, notifications.

## 3. Migration added

`migrations/021_courier_management.sql` (additive; see [COURIER_MANAGEMENT](COURIER_MANAGEMENT.md)):

- `couriers` + `uq_couriers_name (lower(btrim(name)))`, `idx_couriers_active`
- `orders.courier_id` (FK, `ON DELETE RESTRICT`) + `idx_orders_courier`, `orders.tracking_url`
- `order_shipment_events` + `idx_order_shipment_events_order (order_id, created_at)`, `idx_order_shipment_events_courier`
- backfill of `courier_id`/`tracking_url` for already-dispatched orders
- drops `orders_courier_partner_valid` (the fixed seven-name check, which would block new couriers)

Rehearsed on a production-shaped legacy schema (`test/migration-rehearsal.test.js`): applies cleanly, links existing shipments, re-run is a no-op. **Not applied to staging or production** (approval required).

## 4. Connection pooling and timeouts (reviewed, unchanged)

| Setting | Value | Source |
|---|---|---|
| Pool size | `DB_POOL_MAX`, default 10 | `lib/db.js` |
| Idle timeout | 30 s | `lib/db.js` |
| Connect timeout | `DB_CONNECT_TIMEOUT_MS`, default 10 s | `lib/db.js` |
| Statement timeout | `DB_STATEMENT_TIMEOUT_MS`, default 15 s | `lib/db.js` |
| Background-job lock | one extra connection per minute while jobs run | `server.js` |

The pool caps concurrent connections per process: under 1,000 virtual users the pool stayed at 10/10 with up to 1,273 requests queued and **no connection errors**. The default was not raised: the right value is `database max_connections ÷ instances` minus headroom, which depends on the Supabase plan (direct connections are limited; if more are needed use the Supavisor pooler in **session** mode — transaction mode would break the background-job advisory lock, which needs a stable session). New: `/api/health` reports `pool {max,total,idle,waiting}` (development, or admins in production).

## 5. Transactions and constraints (verified, unchanged)

- Stock: conditional `UPDATE … WHERE stock_quantity >= qty` in a stable row order inside the checkout transaction (`lib/inventory.js takeStock`) — race-tested with 500 simultaneous buyers (exactly one winner, stock 0, one hold).
- Idempotency: unique indexes on order idempotency key, Razorpay order/payment ids, webhook `(provider, event_id)`, credit ledger `(order_id, reason)`.
- New in `db.tx`: `db.onCommit(client, fn)` runs `fn` only after `COMMIT` (used to clear the public cache after stock changes, so a concurrent read cannot re-cache uncommitted state).

## 6. Database functions / stored procedures

None added. The invariants that matter (single-winner stock take, single-use OTP, idempotent payments) are already atomic single statements or constraint-backed; moving business logic into PL/pgSQL would not make them more correct.
