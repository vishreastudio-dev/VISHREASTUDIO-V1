# Sold-out and Inventory Logic

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Source of truth | `product_variants.stock_quantity` (per size/variant) |
| Code | `lib/catalogue.js` (`VARIANT_SUMMARY_SQL`, `normalizeProduct`, `normalizeVariant`), `lib/cart.js` (`loadCartLines`), `lib/inventory.js` (`takeStock`, `reserve`, `releaseReservations`, `reacquireReservations`), `api/cart.js`, `api/checkout.js`; UI `components/ProductCard.jsx`, `pages/ProductDetail.jsx`, `pages/Cart.jsx` |

## 1. Rules

| Level | Sold out when | Shown as |
|---|---|---|
| Variant (size) | `stock_quantity = 0` (active variant) | Size button disabled and struck through; "This size is sold out"; `stock_state: 'sold_out'`, `in_stock: false` |
| Product | no active variant has stock (`bool_or(stock > 0)` is false) | **SOLD OUT** badge on every product card and on the product page; Add to bag / Buy now replaced by a disabled "Sold out" button |
| Product with several sizes | at least one size has stock | **not** sold out; only the empty sizes are disabled; `sizes` lists the buyable ones |

Sold-out pieces stay visible (listing, search, category, featured, recommendations, product page) with their details. The "In stock" filter (`in_stock=true`) hides them, in SQL. Nothing about availability is hard-coded in React; every surface reads `available` (product) or `in_stock`/`stock_state` (variant) from the API.

Exact quantities are not exposed: customers see `stock_state` (`in_stock`, `low` ≤ 2, `one_of_one`, `sold_out`) and `available_quantity` capped at 10 (1 for one-of-ones) for the quantity stepper.

## 2. Where the badge appears

| Surface | Component | Data source |
|---|---|---|
| Shop / all categories / search results | `ProductCard` in `Catalogue.jsx` | `GET /api/catalogue` → `available` |
| Homepage "New arrivals" (featured) | `ProductCard` in `Home.jsx` | `GET /api/catalogue?featured=true` |
| Product page | `ProductDetail.jsx` badge, stock line, size buttons, action buttons | `GET /api/product` → `available`, `variants[].in_stock/stock_state` |
| "You may also like" | `ProductCard` | `GET /api/product` → `recommendations[].available` |
| Bag | `Cart.jsx` line message "Sold out — remove to continue"; checkout button disabled | `GET /api/cart` → `items[].issue` |

There are no separate "collection" pages in the storefront; collections are categories and drops, both rendered by the catalogue.

## 3. Enforcement (server)

1. **Add to bag** — refused with 409 `out_of_stock` when the variant has no stock (`api/cart.js addLine`).
2. **Bag view** — each line is re-checked against live stock (`sold_out`, `insufficient_stock`, `unavailable`, `early_access`); the bag cannot proceed while any line has an issue.
3. **Checkout** — inside one transaction, stock is taken with `UPDATE … SET stock = stock - qty WHERE id = $1 AND stock >= qty` in a stable order; if any line fails the whole checkout rolls back with 409. Exactly one buyer wins the last unit (tested with 2, 20 and 500 simultaneous buyers).
4. **Payment window** — the hold is a reservation; unpaid holds are released by the expiry sweep, cancellations and failed payments; a late payment re-acquires stock or is refunded. Stock can never go negative (`>=` guard; additionally checked after load tests).
5. **Paid order cancelled by the studio** — committed reservations are returned to stock (existing rule, unchanged).

## 4. Freshness

Public listings may be served from the server's short cache (10 s) and the browser cache (`max-age` 15–30 s). A change of stock through checkout, cancellation, expiry or any admin edit clears the server cache as soon as it commits, so the next request reflects it; tests prove a sold-out piece is shown as sold out immediately after another customer's checkout, and available again immediately after that hold is released. Whatever a page shows, the bag and checkout re-check live stock, so a stale badge can never lead to an oversell.

## 5. Tests

`test/couriers-inventory.test.js` — "sold out, restock and per-size availability come from stock on the server" (badge data in catalogue and product page, in-stock filter, add-to-bag refusal, restock, bag issue and checkout refusal, multi-size availability); `test/platform.test.js` race tests; load test last-unit race ([LOAD_TEST_REPORT](LOAD_TEST_REPORT.md) §2.4).

## 6. Known gap

A guest's bag lives in the browser and is not re-validated until sign-in; on sign-in the server drops lines that are no longer purchasable, without listing which ones were dropped. Checkout is still protected. Improvement: return the dropped items from the merge and show them.
