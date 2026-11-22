# API Optimization

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Related | [PERFORMANCE_AUDIT](PERFORMANCE_AUDIT.md) · [technical/API_DOCUMENTATION](technical/API_DOCUMENTATION.md) |

## 1. Request audit (backend calls per page, production build, guest unless stated)

| Page | Before | After | Calls after |
|---|---|---|---|
| Home | 4 (8 in dev) | 4 | session, catalogue featured, content, cart* |
| Catalogue | 3 (4–6 in dev) | 3 | catalogue page, session, cart* |
| Product | 3 | 3 (0 network on back-navigation within 15 s) | product, session, cart* |
| Account (signed in) | 5 + session + cart | 4 + session + cart | account, orders, gifting, referrals — the piece-requests call was removed |
| Contact / Gifting / Membership | content fetched again on each page | reused for 60 s | |

\* `cart` only when signed in.

## 2. What changed

| Change | Where | Effect |
|---|---|---|
| Shared GET layer: one in-flight request per URL, optional reuse window for public data, bounded retry on network/proxy errors | `vishrea-react/src/lib/api.js` (`cachedGet`, `peekCached`, `invalidateCached`) | No duplicates or cancellations; returning to a page within the window costs no request |
| `useApi` no longer aborts on unmount; only the newest load may update state | `vishrea-react/src/lib/useApi.js` | StrictMode-safe without disabling StrictMode |
| Session and bag through the shared layer; bag effect keyed on user id; cache cleared when the user changes | `vishrea-react/src/context/StoreContext.jsx` | One session and one bag request per visit; member responses never shown to a guest |
| Catalogue uses the shared layer instead of abort-per-effect | `vishrea-react/src/pages/Catalogue.jsx` | Same results, no cancelled requests |
| Catalogue and product handlers run independent queries in parallel | `api/catalogue.js`, `api/product.js` | One round-trip saved per request (significant on a remote DB) |
| Public response cache (guests/non-members) | `lib/public-cache.js`, `api/catalogue.js`, `api/product.js`, `api/content.js` | See load report; `X-Cache: hit/miss` header for verification |
| Removed `/api/piece-requests` | `api/piece-requests.js` deleted | Fewer endpoints and one fewer account request |

## 3. Aggregation — evaluated, not added

The homepage needs four independent calls: session (per user, never cached), bag (per user), featured products (public, cacheable) and content (public, cacheable). An aggregate `/api/homepage` would mix cacheable public data with private per-user data, forcing the whole response to be private and uncacheable — worse than today, where the two public calls are served from browser and server caches and run in parallel. The account page's calls are each owned by a different module (account, orders, gifting, referrals); merging them would couple those modules for a saving of one round-trip on a low-traffic page. No aggregate endpoint was added.

## 4. Backend filtering (already server-side, verified)

All catalogue filtering, sorting and pagination run in SQL (`api/catalogue.js`): text search (`q`, escaped `LIKE`), category, colour season, featured, in-stock, sort (`featured`, `newest`, `price_asc`, `price_desc`, `name`), `limit`/`page` (max 100), drop/early-access visibility derived from the server-side membership check. The React app never downloads the whole catalogue (the colour tool asks for 48 in-stock pieces). Price-range filtering is not exposed in the UI and was not added.

## 5. Response formats

Unchanged and uniform: success JSON; errors `{ error, message, request_id, details? }`; 401/403/404/409/422/429 as before. New: `X-Cache` on cached public responses; admin courier sections (see [COURIER_MANAGEMENT](COURIER_MANAGEMENT.md)).
