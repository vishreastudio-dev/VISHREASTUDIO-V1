# Load Test Report

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Tool | `scripts/load-test.js` (Node `fetch`, no third-party load tool) — `npm run loadtest -- --vus=100,500,1000 --duration=30 --checkout-vus=50,100 --race=500` |
| Machine | One laptop: Intel i5-1235U (12 logical CPUs, 2 performance + 8 efficiency cores), 20 GB RAM, Windows, Node 24.18. **Load generator, app and PostgreSQL all ran on this machine** |
| App | One `server.js` process, `NODE_ENV=development`, `DB_POOL_MAX=10` (default), background jobs on |
| Database | Local PostgreSQL 18, database `vishrea_load` (the script refuses any non-local database): 411 products, 950 variants (137 sold out), 1,000 customers |
| Payments | Local Razorpay stand-in (orders only). **No real gateway calls, no payments** |
| Rate limiting | Disabled on the test server — all virtual users share one IP, so the per-IP limits would only measure the limiter |
| Raw results | `scratch/loadtest-results-before-cache.json`, `scratch/loadtest-results-after.json`, `scratch/ab-off.json`, `scratch/ab-on.json` (git-ignored) |

## 1. Scenarios

| Scenario | Mix per virtual user iteration (think time 250–750 ms, 3 s ramp-up) |
|---|---|
| Browse | 30 % homepage (session + featured + content in parallel), 25 % catalogue page (random category/sort/page 1–3, 30 % in-stock filter), 20 % product page, 10 % search, 10 % signed-in account (account + orders), 5 % bag |
| Checkout | signed-in user: clear bag → add 1 piece → `POST /api/checkout` (stock taken, hold created, gateway order) → cancel (stock released); repeat |
| Last-unit race | N customers each have the same one-of-one in their bag; all send `POST /api/checkout` at once |

## 2. Results — before and after

"Before" is the code before the public response cache (all other changes in place); "after" is the final code. Same machine, dataset and script.

### 2.1 Browse

| Virtual users | | Req/s | Avg | p50 | p95 | p99 | Errors | Pool used / max | Max waiting for a connection | Server CPU (% of 1 core) | Server RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | before | 304 | 14 ms | 11 ms | 30 ms | 44 ms | 0 % | 10/10 | 12 | 44 % | 103 MB |
| 100 | after | 308 | 9 ms | 6 ms | 23 ms | 35 ms | 0 % | 10/10 | 1 | 30 % | 125 MB |
| 500 | before | 640 | 572 ms | 490 ms | 1,456 ms | 1,766 ms | 0 % | 10/10 | 973 | 93 % | 212 MB |
| 500 | after | **1,497** | 27 ms | **10 ms** | **132 ms** | 243 ms | 0 % | 10/10 | 167 | 92 % | 206 MB |
| 1,000 | before | 670 | 1,416 ms | 1,175 ms | 3,544 ms | 4,441 ms | 0 % | 10/10 | 2,375 | 90 % | 298 MB |
| 1,000 | after | **1,517** | 402 ms | **16 ms** | **1,794 ms** | 2,331 ms | 0 % | 10/10 | 1,273 | 95 % | 295 MB |

100 virtual users with 0.25–0.75 s think time offer ≈ 300 req/s, which both versions serve with headroom, so throughput is equal there and only latency improves.

Slowest endpoints after, at 1,000 VUs (p95): product page 2.40 s, bag 1.86 s, account 1.85 s, orders 1.79 s — the signed-in endpoints each need a session lookup plus their own queries and wait for one of the 10 connections; cached public endpoints (featured 0.60 s, content 0.59 s, catalogue 0.82 s) are limited by the single process's CPU.

### 2.2 Controlled A/B at 500 VUs (20 s, back-to-back, cache toggled with `PUBLIC_CACHE=off`)

| Public cache | Req/s | p50 | p95 | p99 | Max waiting |
|---|---|---|---|---|---|
| off | 620 | 472 ms | 1,370 ms | 1,821 ms | 859 |
| on | 1,393 | 11 ms | 275 ms | 410 ms | 272 |

One intermediate full run (cache on) was markedly slower than both, including on `/api/auth/session` which does not touch the database for guests — i.e. the whole machine was slower (laptop core scheduling/thermal state). It was discarded in favour of the back-to-back A/B above and the repeated final run; the raw file is kept.

### 2.3 Checkout (stock hold + release under concurrency)

| Concurrent buyers | | Checkouts in 30 s | Failed | Checkout p50 | p95 | p99 | Stock after (expected 100,000) |
|---|---|---|---|---|---|---|---|
| 50 | before | 1,578 | 0 | 145 ms | 241 ms | 318 ms | 100,000 — consistent |
| 50 | after | 1,650 | 0 | 130 ms | 233 ms | 320 ms | 100,000 — consistent |
| 100 | before | 1,626 | 0 | 411 ms | 545 ms | 620 ms | 100,000 — consistent |
| 100 | after | 1,788 | 0 | 355 ms | 441 ms | 500 ms | 100,000 — consistent |

Every hold taken was released by cancellation: 0 reservations left `held`, stock back to its starting value.

### 2.4 Last-unit race (500 simultaneous checkouts for one unit)

| Run | Successful checkouts | Refused (409 out of stock) | Other | Stock after | Holds | Wall time | p95 |
|---|---|---|---|---|---|---|---|
| before | 1 | 499 | 0 | 0 | 1 | 1.39 s | 1.32 s |
| after | 1 | 499 | 0 | 0 | 1 | 1.28 s | 1.20 s |

## 3. What this does and does not show

- **Shown:** on this hardware one process serves ≈ 1,500 req/s of the browse mix with no errors and no unbounded database connections; at 500 users p95 is 132 ms; at 1,000 users requests queue (p95 1.8 s) but nothing fails or crashes. Overselling did not occur under 500 concurrent buyers, and stock stayed consistent through thousands of hold/release cycles.
- **Not shown:** production capacity. The test ran on a laptop that also ran the load generator and the database, against a local database (no network latency; the staging database adds ≈ 60–150 ms per round-trip), with rate limiting off, without TLS, and with a small catalogue. Real Razorpay, Resend and webhooks were not exercised. **Do not quote these numbers as production capacity**; repeat the same script against a staging environment sized like production.
- **Where the limit is now:** a single Node process's CPU (≈ 95 % of one core at 1,000 VUs) and the 10-connection pool for signed-in requests. Both scale by running more processes behind a load balancer — see [SCALABILITY_ASSESSMENT](SCALABILITY_ASSESSMENT.md).

## 4. Reproducing

```bash
# local throwaway PostgreSQL on 127.0.0.1:55432 (see package.json test:docker, or any local server)
npm run loadtest -- --vus=100,500,1000 --duration=30 --checkout-vus=50,100 --race=500
# A/B without the public cache
PUBLIC_CACHE=off npm run loadtest -- --vus=500 --duration=20 --race=0 --out=ab-off.json
```
