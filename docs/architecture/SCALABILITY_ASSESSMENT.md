# Scalability Assessment

| Field | Value |
|---|---|
| Date | 7 November 2026 |
| Basis | Code review + [LOAD_TEST_REPORT](LOAD_TEST_REPORT.md) (single laptop, local database) |

## 1. Summary

The modular monolith is retained. One process, measured locally, served ≈ 1,500 req/s of a realistic browse mix and 500 simultaneous last-unit checkouts without errors, overselling or connection exhaustion. Beyond that a single process is CPU-bound. The application can now run as several identical instances with the caveats in §3; capacity for 100 / 500 / 1,000 concurrent users **in production has not been measured** and must be confirmed on staging infrastructure.

## 2. Traffic levels (measured locally — not production claims)

| Concurrent users | Local result (after) | Assessment |
|---|---|---|
| 100 | p95 23 ms, 0 errors, at most 1 request waiting for a DB connection at any sample | Comfortable on one instance |
| 500 | 1,497 req/s, p95 132 ms, 0 errors | One instance close to its CPU limit; two instances recommended for headroom |
| 1,000 | 1,517 req/s (saturated), p95 1.8 s, 0 errors | Needs ≥ 2–3 instances (and a database sized for `instances × DB_POOL_MAX` connections) |

## 3. Horizontal scaling readiness

| Concern | State | Needed before running more than one instance |
|---|---|---|
| Sessions | Stateless JWT cookie, user re-read from DB per request | Nothing — works across instances |
| Background jobs (expiry sweep, reconciliation, billing, bag expiry, upload cleanup) | **New:** guarded by a PostgreSQL advisory lock — only one instance runs a pass; `RUN_BACKGROUND_JOBS=false` opts an instance out | Use a session-mode connection (direct or Supavisor session pooler), not transaction pooling |
| Stock, payments, webhooks | Database-level atomicity and unique constraints | Nothing — correct across instances |
| Rate limiting | In-memory per process | Shared store (Redis or Postgres) or limiting at the load balancer/CDN, otherwise limits multiply by the instance count |
| Public response cache | In-memory per process; cleared on local writes, other instances converge within 10–30 s (shorter than browsers' own `max-age` of 30–60 s) | Acceptable as is; `PUBLIC_CACHE=off` if exact cross-instance freshness is required |
| Uploads | Local directory (`UPLOADS_DIR`) | Shared volume or object storage |
| Database connections | `DB_POOL_MAX` per instance (default 10) | `instances × DB_POOL_MAX` + migrations/admin headroom ≤ database limit |
| Health checks | `/api/health` (DB check; pool/process stats for admins or non-production) | Point the load balancer at it |
| Logs | Structured JSON to stdout | Ship to a central log store |

**Redis:** not introduced. With one instance there is nothing for it to share; with several, its only job would be rate limiting, which a CDN/WAF or a small Postgres table can also do. Revisit when more than one instance is deployed.

## 4. Spike behaviour

| Event | Behaviour (from code and the load test) |
|---|---|
| Collection launch (many guests browsing) | Public catalogue/product/content responses shared from the in-process cache and the browser cache; DB load grows with distinct pages, not visitors |
| Many checkouts at once | Each takes stock with one conditional update in a transaction; pool queues requests rather than opening connections; p95 0.44 s at 100 concurrent buyers locally |
| Several customers buying the last unit | Exactly one succeeds, the rest get "no longer available" (409); stock never negative (500-buyer test) |
| Webhook spike | Idempotent by `(provider, event_id)`; signature checked before any work; per-route rate limit |
| Database slow or down | Statement timeout 15 s, connect timeout 10 s, pool cap; health returns 503; frontend shows an error with retry |

Queries never fail open: under overload requests wait in the pool queue up to the timeouts instead of exhausting database connections. A per-request deadline or load shedding (fast 503 when the queue is long) is a possible further step if p99 latency under spikes matters more than completing every request.

## 5. Recommendations (in order)

1. Run the load script against a staging stack shaped like production (same instance size, remote database, TLS, CDN) before any capacity statement.
2. Add a CDN/reverse proxy (static assets, images, compression, edge rate limiting).
3. Run 2 instances behind a load balancer once traffic approaches the single-instance figures; move uploads to object storage first.
4. Size `DB_POOL_MAX` from the Supabase plan's connection limit; prefer the session-mode pooler.
5. If the catalogue grows to thousands of live pieces, precompute `min_price`/`in_stock` per product (see [DATABASE_OPTIMIZATION](DATABASE_OPTIMIZATION.md)).
