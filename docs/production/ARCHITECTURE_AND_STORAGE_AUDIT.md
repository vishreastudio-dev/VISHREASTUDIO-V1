# Architecture and storage audit

Date: 2026-11-11. Source review and isolated QA. The production database and storage were not queried
today; storage facts below come from the verified 2026-11-09 audit (cited).

## Architecture (unchanged; no refactor recommended)

| Area | Finding |
|---|---|
| Frontend | React 19 + Vite + React Router. Routes in `vishrea-react/src/App.jsx`: 20 routes, with `/checkout`, `/orders`, `/account`, `/wardrobe` and `/admin` behind `RequireAuth`. Production build passes (main bundle 101 KB gzip). Pages are code-split, and assets are precompressed with brotli. |
| Backend | Express modular monolith. `server.js` mounts `api/*` modules through `mountModule` (access level, allowed methods, write limits). Auth and webhooks are separate routers. |
| API contract | Consistent error envelope `{error, message, details?, request_id}`. `Cache-Control` is `no-store`, except the documented public catalogue, product, content, carousel and legal reads. |
| Database | Native `pg` pool: max 10 (`DB_POOL_MAX`), idle 30 s, connect timeout 10 s, statement timeout 15 s. Transactions go through `db.tx`, with advisory locks for checkout, membership, wearers and admin bootstrap. |
| Migrations | 20 files (`001`–`023`; `003`, `006` and `008` were removed in the first commit and have never existed in git). They are applied in filename order and recorded in `_schema_migrations`. Every migration is additive. `023_media_objects` is the latest; it was applied to the live database by the owner on 2026-11-09. |
| Background jobs | One 60 s loop per process behind `pg_try_advisory_lock`, so only one instance runs jobs. It handles order expiry, payment reconciliation, membership lifecycle, billing, bag shipment expiry and orphan-upload cleanup (local driver only). |
| Shutdown | SIGTERM and SIGINT are handled; unhandled rejections are logged. |
| Config validation | Production refuses: a weak JWT secret or OTP pepper; non-https `APP_ORIGIN`; missing `DATABASE_URL` or Razorpay secrets; OTP echo; a non-Supabase storage driver; a project-ref mismatch. Development refuses a remote database unless explicitly opted in, and refuses the production project once the guard is armed. |
| Dependencies | 0 production vulnerabilities (`npm audit`) in the backend and the frontend. Newman and k6 live in git-ignored `scratch/tools`, not in `package.json`. |
| Dead code | `api/piece-requests.js` and `RequestPieceModal.jsx` are deleted in the working tree (feature retired). A test asserts the route now returns 404, and nothing imports either file. |
| Performance | k6 with think time, 100 users: 51 requests/s, p95 31 ms, 0 errors, pool 10 with 0 waiting (`FINAL_GO_LIVE_CHECKLIST.md`). That is one laptop, not a capacity figure. |

## Storage (Supabase), verified 2026-11-09

Source: `docs/security/POST_MIGRATION_VERIFICATION.md`, `FINAL_STORAGE_PRODUCTION_READINESS.md`.

| Check | Result |
|---|---|
| Buckets | Public: `product-images`, `homepage-banners`, `instagram-media`, `customer-feedback`. Private: `exchange-evidence`, `media-archive`. MIME and size limits set per bucket |
| Policies | Storage row-level security on with zero policies, so only the service role can write, list or sign. Anonymous users cannot list buckets or read private objects |
| Key handling | The service-role key exists only on the backend: 0 occurrences in the build, and no `VITE_*` variable is read for it |
| Registration | Every upload is recorded in `media_objects` (SHA-256, MIME, dimensions, owner, visibility), and deduplicated per purpose and owner |
| Migration | 6 files and 9 references moved and byte-identical (SHA-256). 0 `/uploads` references remain in media columns. The 6 local originals are kept for rollback |
| Private access | Signed URLs valid for 300 s. Tampered, reused or expired links → 400 |
| Caching | Public objects `max-age=31536000`; private `max-age=0` |
| Orphans | Unreferenced files under `/uploads` return 404 (verified on all 19 legacy files) |
| Deletion | `safeDelete` counts references across the media columns and runs only after commit; audit logs are never rewritten |
| Failures | Two retries on transient errors, then a generic 503 `storage_unavailable`. If saving the metadata fails, the uploaded object is deleted again |
| Fallback | A missing product image falls back to `/assets/editorial.jpg` |

Open storage items (owner decisions, none blocking):
- the 7 backed-up orphan files (checksum `08aa9a957df8`);
- the 6 REVIEW media files (5 portraits, 1 video);
- WebP re-exports of the 2 large banner PNGs (2.2 MB and 1.9 MB; about 130 KB and 85 KB as WebP);
- re-activating the 2 homepage slides.

## Database backup and recovery

- **Backup:** the Supabase plan's daily or point-in-time backups must be confirmed by the owner (not verifiable here). Before deploy, take a manual dump: `pg_dump --format=custom --no-owner "$DATABASE_URL" -f vishrea-pre-release.dump`, run from a trusted machine, and keep it out of git.
- **Restore:** `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" vishrea-pre-release.dump`, into a new or empty database first, then switch `DATABASE_URL`.
- **Application rollback:** redeploy the previous build. Because every migration is additive, older code keeps working.
- **Storage rollback:** `npm run media:rollback -- --results=scratch/media-migration/results-2026-11-09T07-56-47-574Z.json --production`.

## Local development isolation (still open)

`node scripts/check-environment.js` on 2026-11-11 reports:
- the development `.env` points at the **live** database and storage;
- it sends real email through Resend;
- the production guard is **not armed**.

QA never loads it, because `tests/qa/qa-env.mjs` builds its environment from scratch. The owner should follow `docs/setup/DEVELOPMENT_SUPABASE_SETUP.md`, then set `PRODUCTION_SUPABASE_PROJECT_REF`. The guard's refusal is already proven by `node tests/qa/stack.mjs verify` and `test/production.test.js`.
