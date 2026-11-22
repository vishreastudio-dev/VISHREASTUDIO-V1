# Implementation Changelog — 7 November 2026

Uncommitted, unstaged working-tree changes on `main`: 63 paths (38 modified, 23 new, 2 deleted — see `git status`). Nothing was deployed and no migration was applied to staging or production.

## 1. Homepage loading fix

| File | Change |
|---|---|
| `nodemon.json` (new) | Watch only `server.js`, `api/`, `lib/`, `.env` and the shared SEO modules; ignore tests, scratch, docs, public, dist |
| `vishrea-react/src/lib/api.js` | `cachedGet` (one in-flight request per URL, optional reuse for public data, retry ×2 on network/proxy errors for GETs only), `peekCached`, `invalidateCached` |
| `vishrea-react/src/lib/useApi.js` | Uses the shared layer; no abort on unmount; `maxAge` option; stable `reload`/`setData` |
| `vishrea-react/src/context/StoreContext.jsx` | Session and bag via the shared layer; bag effect keyed on user id; cache cleared on user change |
| `vishrea-react/src/pages/Home.jsx` | Public reuse windows; real error state for new arrivals |
| `Catalogue.jsx`, `ProductDetail.jsx`, `Contact.jsx`, `Gifting.jsx`, `Membership.jsx` | Shared layer / reuse windows for public data |

## 2. Request a Piece removed

| File | Change |
|---|---|
| `api/piece-requests.js` | **Deleted** |
| `vishrea-react/src/components/RequestPieceModal.jsx` | **Deleted** |
| `server.js` | Route unmounted |
| `api/admin/ops.js` | Dashboard count, `piece_requests` section, `piece_request` action and import removed |
| `Home.jsx`, `ProductDetail.jsx`, `Contact.jsx`, `Catalogue.jsx`, `Account.jsx`, `Admin.jsx`, `content/faqs.js`, `index.css` | Buttons, banner, modal, account panel, admin section/modal/nav/tile, FAQ entry, copy and styles removed |
| `api/upload.js` | Requires a session (guest uploads existed only for this feature) |
| `lib/uploads.js` | Orphan cleanup keeps protecting retained piece-request attachments while that table exists |
| Database | `piece_requests` table **retained** with its data (dropping it deletes customer data — needs owner approval) |

## 3. Courier management

| File | Change |
|---|---|
| `migrations/021_courier_management.sql` (new) | `couriers` (seeded), `orders.courier_id`, `orders.tracking_url`, `order_shipment_events`, backfill, drop fixed-name check, RLS guard |
| `lib/couriers.js` (new) | Validation, CRUD, activate/deactivate, safe delete, dispatch resolution, `buildTrackingUrl`, AWB validation |
| `api/admin/ops.js` | Sections `couriers`, `order_shipments`, `courier`, `courier_status`, `DELETE courier`; `updateOrder` uses courier rows, snapshots link, writes history; dispatch e-mail uses the stored link |
| `api/orders.js` | Returns `tracking_url`, `courier_is_pickup` |
| `vishrea-react/src/pages/AdminExtras.jsx` | `CouriersSection` + `CourierForm` |
| `vishrea-react/src/pages/Admin.jsx` | Couriers nav entry; dispatch dialog loads active couriers and history, previews the link |
| `vishrea-react/src/lib/couriers.js` | Replaced the hard-coded list with `previewTrackingUrl` |
| `vishrea-react/src/components/OrderTracker.jsx` | Uses the stored `tracking_url`, pickup flag |

## 4. Sold-out badges

| File | Change |
|---|---|
| `components/ProductCard.jsx` | "Sold out" badge (was "Sold"), dark style; `srcset`/`sizes` |
| `pages/ProductDetail.jsx` | Sold-out badge on the product page |
| `index.css` | Sold-out badge styles |

## 5. Performance, scalability, reliability

| File | Change |
|---|---|
| `lib/public-cache.js` (new) | In-process cache for guest/non-member public responses, single-flight, bounded, `PUBLIC_CACHE=off` |
| `api/catalogue.js`, `api/product.js`, `api/content.js` | Parallel queries; cached public path; `X-Cache` header |
| `lib/db.js` | `afterCommit` hooks in `db.tx`, `db.onCommit` |
| `lib/inventory.js` | Clear public cache after committed stock changes |
| `server.js` | Clear public cache after admin writes; background jobs under an advisory lock + `RUN_BACKGROUND_JOBS=false`; precompressed asset serving; `public/` 1-day cache; uploads `immutable`; health reports pool/process stats (non-production or admin) |
| `scripts/precompress.js` (new), `package.json` | Brotli/gzip after `vite build`; `npm run loadtest` |
| `scripts/load-test.js` (new) | Reproducible local load test (browse, checkout, last-unit race) |
| `scripts/explain-queries.js` (new) | EXPLAIN ANALYZE of hot queries |
| `vishrea-react/index.html`, `public/favicon-48.png`, `public/apple-touch-icon.png` (new), `site.config.js`, `lib/imageFor.js` | Right-sized icons; brand logo in structured data; responsive images for resizable hosts |
| `.gitignore` | `scratch/` |

## 6. Tests and docs

Tests: `test/couriers-inventory.test.js`, `test/couriers-unit.test.js` (new); `platform.test.js`, `production.test.js`, `migration-rehearsal.test.js` (updated). Docs: the twelve documents listed in [PROJECT_STATUS](PROJECT_STATUS.md); `technical/API_DOCUMENTATION.md` and `technical/DATABASE_SCHEMA.md` updated.

## 7. API endpoints changed

| Endpoint | Change |
|---|---|
| `GET/POST/PATCH /api/piece-requests` | Removed (404) |
| `POST /api/upload` | Requires sign-in (401 for guests) |
| `GET /api/admin/ops?section=couriers \| order_shipments` | New |
| `POST /api/admin/ops?section=courier \| courier_status`, `DELETE …section=courier` | New |
| `POST /api/admin/ops?section=order` | Accepts `courier_id`; validates AWB format; stores link and history |
| `GET /api/admin/ops?section=dashboard` | `new_piece_requests` removed |
| `GET /api/orders` | Adds `tracking_url`, `courier_is_pickup` |
| `GET /api/catalogue`, `/api/product`, `/api/content` | Same responses; `X-Cache` header |
| `GET /api/health` | Adds `pool`, `process` (non-production or admin) |
