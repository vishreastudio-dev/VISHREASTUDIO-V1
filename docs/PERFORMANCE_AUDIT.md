# Performance Audit

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Environments measured | (a) Vite dev server `localhost:5173` → API `localhost:3000` (staging database, Supabase); (b) production build served by Express on `localhost:3000`; (c) load test on a local PostgreSQL ([LOAD_TEST_REPORT](LOAD_TEST_REPORT.md)) |
| Tools | Cursor browser + Chrome DevTools Protocol (`performance.getEntriesByType`), `Invoke-WebRequest`, Node `http` byte counts |

## 1. What the reported numbers were

The observation "≈65 requests, 977 KB transferred, 7.9 MB resources, `catalogue`/`content` cancelled" came from the **Vite dev server**. In development Vite serves every source module separately and React in development mode; that alone accounts for most requests and megabytes. The production build is a different picture (§3). The cancelled and failed requests were real and had two separate causes (§2).

## 2. Root causes of the homepage failures

| Symptom | Root cause | Evidence | Fix |
|---|---|---|---|
| `catalogue?featured=true…` and `content` **cancelled** | React 19 StrictMode (dev only) mounts each component twice; `useApi` aborted its request on unmount, so the first copy was cancelled and a second copy sent | Resource timing: each of the two URLs appears twice, the first with status 0 after 13 ms | `useApi` now uses a shared GET layer: one in-flight request per URL; unmounting ignores the result instead of aborting it. StrictMode left on |
| `catalogue` / `content` **failed** (`ECONNREFUSED` in Vite) | `nodemon` watched the whole repository, so any edit to the frontend, tests or `scratch/` restarted the API; requests made during the restart failed | Vite log: repeated `http proxy error: /api/content … ECONNREFUSED`; nodemon log: dozens of "restarting due to changes" | `nodemon.json` watches only server code (and the shared SEO modules the server imports). GETs retry twice (400 ms, 1.2 s) on network/proxy failure only — never on application errors or mutations |
| `/api/auth/session` and `/api/cart` sent twice | Session lookup also ran twice under StrictMode; two session responses produced two different `user` objects, re-running the bag effect | Resource timing | Session and bag GETs go through the shared layer; the bag effect depends on the user id |
| Failed featured products shown as "New pieces are being photographed" | Error state rendered as an empty catalogue | `Home.jsx` | A real error with **Try again** |

`/api/auth/session` itself was healthy (200 in 22–100 ms, no database query for guests).

## 3. Measurements

### 3.1 Homepage, dev server (same browser, cache disabled)

| Metric | Before | After |
|---|---|---|
| Backend API requests | **8** (4 distinct) | **4** |
| Duplicate API requests | 4 (catalogue, content, session, cart) | 0 |
| Cancelled requests | 2 | 0 |
| Failed requests | intermittent (`ECONNREFUSED` while nodemon restarted) | 0 in verification runs |
| Product cards rendered | 4 | 4 |
| JS modules (dev only) | 38 | 37 (Request a Piece modal removed) |

### 3.2 Homepage, production build (`npm run build`, Express)

| Category | Requests | Notes |
|---|---|---|
| Document | 1 | 5.9 KB, `no-cache`, SEO metadata server-rendered |
| JavaScript | 2 | `index-*.js` 274 KB, `usePageSeo-*.js` 70 KB (other pages are lazy chunks) |
| CSS | 1 | 80 KB |
| Images (same origin) | 2 | hero 116 KB (preloaded, `fetchpriority=high`), one category fallback |
| Images (third party, Unsplash) | 4 | `auto=format` (WebP/AVIF negotiated) |
| Backend API | 4 | `session`, `catalogue?featured=true&limit=4`, `content`, `cart` |
| **Total** | **14** | |

### 3.3 Bytes on the wire for JS/CSS (production)

| File | Uncompressed (before) | Brotli (after) |
|---|---|---|
| `index-*.js` | 274,044 B | 72,586 B |
| `usePageSeo-*.js` | 69,897 B | 22,312 B |
| `index-*.css` | 80,159 B | 13,978 B |
| **Total** | **424,100 B** | **108,876 B (−74 %)** |

The server had no compression and no proxy in front of it. `scripts/precompress.js` (run by `npm run build`) writes `.br`/`.gz` next to each fingerprinted asset with Node's built-in `zlib`; `server.js` serves them by `Accept-Encoding` with `Vary` and one-year `immutable` caching. No dependency was added.

### 3.4 API latency against the staging database (single requests, warm)

| Endpoint | Before | After | Note |
|---|---|---|---|
| `GET /api/auth/session` (guest) | 22 ms | 22 ms | no DB query for guests |
| `GET /api/catalogue?featured=true&limit=4` | 134–264 ms | ~150 ms first, then served from the public cache | 2 sequential round-trips became parallel; remote DB RTT dominates |
| `GET /api/content` | 67–81 ms | cache hit afterwards | |

Capacity under concurrency is in [LOAD_TEST_REPORT](LOAD_TEST_REPORT.md): 500 virtual users went from **640 req/s, p95 1.46 s** to **1,497 req/s, p95 132 ms**.

## 4. Caching now in place

| Layer | What | Policy |
|---|---|---|
| Browser (HTTP) | `/assets/*` (hashed) | `public, max-age=31536000, immutable` |
| Browser (HTTP) | `public/` editorial images, icons | `max-age=1d` + ETag (names are not hashed) |
| Browser (HTTP) | uploads (random names) | `max-age=30d, immutable` |
| Browser (HTTP) | public catalogue / content / product | unchanged: `public, max-age=30/60/15`; members `private` |
| Browser (JS) | shared GET layer | in-flight de-duplication for every GET; reuse for public data only (catalogue 30 s, content 60 s, product 15 s, matching the HTTP policy); cleared when the signed-in user changes |
| Server | public response cache (`lib/public-cache.js`) | guests/non-members only; 10 s (catalogue, product) / 30 s (content); cleared after committed stock changes and admin writes; `PUBLIC_CACHE=off` disables it |
| Never cached | session, account, orders, bag, checkout, payments, admin | `Cache-Control: no-store` (all `/api/*` default) |

## 5. Images

| Item | Before | After |
|---|---|---|
| Browser tab icon | `favicon.png` 1024×1024, **864 KB** (production copy) | `favicon-48.png` 3.2 KB; `apple-touch-icon.png` 180×180, 33.8 KB |
| Organization logo in structured data | `/favicon.svg` — Vite's default logo, not the brand | `/apple-touch-icon.png` (brand mark) |
| Product cards (Unsplash) | one fixed size | `srcset` 320–960 w with `sizes`; host negotiates WebP/AVIF |
| Hero | preloaded, `fetchpriority=high`, explicit size | unchanged |
| Below-the-fold images | `loading=lazy`, `decoding=async`, explicit sizes | unchanged |
| Uploaded product photos (`/uploads`) | served as uploaded (e.g. 1086 px JPEG) | **unchanged — needs an image pipeline** (see §6) |

## 6. Not done (needs a decision or infrastructure)

1. Resize/convert uploaded product images to WebP/AVIF at fixed widths at upload time (e.g. `sharp`, a native dependency) or via an image CDN.
2. Put a CDN/reverse proxy in front for HTTP/2, edge caching of `/assets/*` and images, and compression of JSON responses.
3. `public/assets/knit.jpg` (388 KB) and other editorial JPEGs could be recompressed with an image tool; none is installed on this machine.
