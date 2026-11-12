# Storage security tests

Results below come from actual runs on 2026-11-09, against a local throwaway PostgreSQL (port 55432)
and an in-process HTTP stand-in for the Supabase Storage API (`startStorageMock()` in
`test/helpers.js`). The real `@supabase/supabase-js` 2.119.0 client runs against the stand-in. No
test touches the live Supabase project: the suites override `SUPABASE_URL` and the key.

## Results

| Run | Result |
|---|---|
| Full suite `npm test` (all `test/*.test.js`) | **190 tests, 190 passed, 0 failed, 0 skipped** |
| Re-run after the docs/env changes: `storage`, `platform`, `production` suites | **68 passed, 0 failed** |
| Post-migration audit, after the private cache fix and the new traversal test | **191/191 passed**, 0 failed, 0 skipped; `storage.test.js` 13/13 |
| `vite build` (vishrea-react) | succeeds |
| ESLint | no errors; warnings only, of the kind already present before this work |
| Scan of `vishrea-react/dist` for the service-role key | key not present |
| `npm audit --omit=dev` | 0 vulnerabilities (2 moderate findings are dev-only tooling) |

## Live checks against the real Supabase project (after the migration, read-only)

From `FINAL_STORAGE_PRODUCTION_READINESS.md` §4. All passed:
- public objects return 200 anonymously, byte-identical;
- the `anon` key can list 0 buckets and 0 objects, including buckets that hold files;
- the `anon` key cannot sign or download;
- the public route on a private bucket returns 400;
- a real signed URL returns 200 fresh, and 400 when tampered, reused for another path, or expired;
- storage RLS is enabled with no policies;
- no service-role marker, JWT or Supabase client is in the fresh build or in the scripts the browser loads.

Full suite re-run after the migration: **191/191 passed**.

## What `test/storage.test.js` covers (13 tests)

| Test | Checks |
|---|---|
| Bucket setup | creates 4 public and 2 private buckets with size limits and MIME lists; corrects a bucket with the wrong visibility |
| Product photos | public bucket, server-chosen random names, metadata row (type, size, pixels, SHA-256), usable on a product |
| De-duplication | an identical upload is stored once and the same reference is returned |
| Banners | banner bucket; carousel slide sizes come from metadata; slide can be published |
| Customer videos | public bucket; when a video is replaced, the old file is deleted only if nothing else uses it |
| Exchange evidence | private bucket under the owner's folder; no public URL works; signed links work and expire; another customer's reference and foreign URLs are dropped; customers cannot use the staff view; staff get fresh signed links with `Cache-Control: no-store` |
| Upload security | type from bytes: SVG with script, HTML and executables refused (415); purpose rules: customers only `evidence`, no customer video, a video is not a product photo (403); customer images over 5 MB (413); unreadable or 20000-px images (422); guests refused (401); nothing refused reaches storage |
| Traversal and forged access | `..` and `%2F..` references rejected by `parseRef`/`displayUrl`; client `filename`/`name` fields ignored (random server name); forged signed link for a traversal ref returns 404; customers cannot use the archive (403), and admins cannot pick it (400); customers cannot delete media records (403) |
| Cache headers | public objects `max-age=31536000`; private evidence `max-age=0` |
| Storage failures | bounded retry on transient errors; outage and permission errors give a generic 503 with no bucket, path or key in the body; server stays up; no orphan objects left |
| Compensation | if the metadata insert fails, the uploaded object is removed again |
| Safe deletion | a referenced file is never deleted; an unreferenced one is |
| Orphan scanner | reports unused registered objects and unregistered objects; a used file is never an orphan; dry run deletes nothing; uploads younger than 24 h are not reported |
| Migration | inventory → apply with checksum → product, carousel (JSON) and private evidence references rewritten → local files untouched → idempotent re-run → verify → rollback restores the original values |

## Related assertions in other suites

- `test/platform.test.js`: a customer upload returns a private `storage://` reference; the file is
  not reachable via `/uploads/` or the `.private` path; a valid signed link works; a forged signature
  returns 404; a corrupt PNG returns 422.
- `test/production.test.js`: production startup is refused with `STORAGE_DRIVER=local`, without
  `SUPABASE_SERVICE_ROLE_KEY`, or with a non-https `SUPABASE_URL`.
- `test/homepage-carousel.test.js`: banner uploads use the `banner` purpose and the returned `ref`.
- `test/remediation.test.js`: Admin → Settings reports the storage driver and local writability.

## Not tested here (needs the real project, after approval)

- Creating buckets in the live Supabase project (`npm run storage:setup -- --fix`).
- The real migration of the 19 files (`npm run media:migrate -- --confirm=<checksum>`).
- Supabase-specific behaviour the stand-in does not model: CDN caching of public objects, and
  bucket-level enforcement of the size and MIME limits by Supabase itself. The server enforces both
  independently.

## How to re-run

```powershell
# throwaway PostgreSQL on port 55432 (Docker), or any local cluster on that port
npm run test:docker
npm test
npm run test:docker:stop
```
