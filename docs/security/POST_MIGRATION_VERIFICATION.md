# Post-migration verification

Audit date: 2026-11-09. Method: read-only checks against the database configured in `.env` and the
Supabase project at `SUPABASE_URL`. The checks were SELECT queries, bucket and object listing, and
HEAD/GET requests; scripts are in `scratch/`, which is git-ignored. No data, buckets, files,
references or secrets were changed. No key or signed URL was printed.

> **Superseded for sections 1–3.** The owner ran the migration at 13:26 IST the same day. The
> verified post-migration state is in `FINAL_STORAGE_PRODUCTION_READINESS.md`. The orphan inventory
> (§4), resilience results (§6) and cleanup plan (§9) below remain current.

## 1. Migration completion: NOT COMPLETED (as of the morning audit)

The file migration has **not** been run. Evidence:

| Check | Expected after migration | Actual |
|---|---|---|
| Migration 023 (`media_objects`) | applied | **applied** (by the owner; `npm run migrate` output) |
| `media_objects` rows | 6 (with `--skip-orphans`) or 18 | **0** |
| Buckets in the Supabase project | 6 | **0** (`listBuckets` returned an empty list) |
| References to `/uploads/...` in media columns | 0 | **9** (all 6 in-use files) |
| References to Supabase Storage | 9 | **0** |
| `STORAGE_DRIVER` in `.env` | `supabase` | **unset**, so the local driver is active |
| `scratch/media-migration/results-*.json` (written by every `apply`) | present | **absent** |
| Inventory checksum | — | `ad17cd84ac0e`, **unchanged** since the manifest |

Because nothing has been migrated, these items are **BLOCKED**:
- verifying migrated objects in Supabase;
- bucket policies;
- public and signed URLs for real objects;
- browser loading of migrated media.

Unblocking them requires the approved steps in `SUPABASE_STORAGE_MIGRATION.md`. They were not run,
per the instruction not to modify production data.

## 2. Buckets and policy configuration

**Update 2026-11-09 13:20:** the owner ran the bucket setup. It ran with `STORAGE_DRIVER=supabase` for
that one command only; `.env` was not changed. All six buckets were created, and their settings were
read back from Supabase:

| Bucket | Access | Size limit | Allowed types | Objects |
|---|---|---|---|---|
| `product-images` | public | 10 MB | JPEG, PNG, WEBP | 0 |
| `homepage-banners` | public | 10 MB | JPEG, PNG, WEBP | 0 |
| `instagram-media` | public | 40 MB | JPEG, PNG, WEBP, MP4, MOV | 0 |
| `customer-feedback` | public | 40 MB | MP4, MOV | 0 |
| `exchange-evidence` | **private** | 5 MB | JPEG, PNG, WEBP | 0 |
| `media-archive` | **private** | 40 MB | JPEG, PNG, WEBP, MP4, MOV | 0 |

Storage policies, read from `pg_policies`: RLS is **enabled** on `storage.objects` and
`storage.buckets`, and **no policies exist**. Anonymous and signed-in users therefore cannot list,
upload, update or delete through the Supabase API; only the service role can. Public buckets
serve files by URL only.

- Policy design: only the backend, using the service-role key, writes, lists, signs or deletes. No
  Storage RLS policies are granted to `anon` or `authenticated`, so the browser cannot write to any
  bucket, and private buckets are reachable only through signed URLs.
- `media_objects` has RLS enabled with `anon` and `authenticated` revoked (verified: `relrowsecurity = true`).
- `npm run storage:setup` reports the plan, and `-- --fix` creates the buckets. Bucket creation is
  a production change and was **not run**.

## 3. File integrity and database references

All media columns were scanned (`lib/media-references.js`). A schema-wide scan also checked every
other text/JSON column; the only other match was `audit_logs.details`, which is history and
intentionally never rewritten.

| Reference | Rows | Points to | Object exists | Retrievable | Status |
|---|---|---|---|---|---|
| `products.image_url` | 8 products | images.unsplash.com (demo) | external | HTTP 200, cached 1 year | OK (external, not part of the migration) |
| `products.image_url` + `products.images[0]` | product 41a051f9 "Fluffy Bunny Appliqué Knit" | `/uploads/image_1793716245931_….jpg` | on disk, 169,880 B | served by Express | **legacy local** |
| `products.images[1..3]` | same product | `/uploads/image_17937162{49372,52556,77022}_….jpg` | on disk | served by Express | **legacy local** |
| `homepage_carousel_slides.desktop_image_url` + `published_content` | slide 72009b7e | `/uploads/image_1794070261889_….png` | on disk, 2,287,786 B | served by Express | **legacy local** |
| `homepage_carousel_slides.desktop_image_url` + `published_content` | slide aaf724d0 | `/uploads/image_1794070399598_….png` | on disk, 1,964,839 B | served by Express | **legacy local** |
| `instagram_content.post_url` | 1 | instagram.com reel | external | HTTP 200 | OK |
| `feedback_videos.video_url` | 0 rows | — | — | — | — |
| `exchanges.evidence_urls` | 1 exchange, no evidence | — | — | — | — |
| `piece_requests.attachment_url` | 0 rows | — | — | — | — |
| `product_photos`, `catalogue_image_url`, `mobile_image_url`, `story_consents` | none set | — | — | — | — |

Results:
- **0 broken references.**
- **0 stale Supabase references.**
- **9 references still depend on `public/uploads`** (6 files). This is the main production blocker:
  on a host with ephemeral disk, these images disappear on redeploy.

## 4. The 12 orphan files

No media column references any of these. Nothing in the application code loads them by name. All
are served today at `/uploads/<name>` by any running instance, because public static serving covers
the whole directory.

| # | File | Size | MIME | SHA-256 (16) | What it is | DB reference | Needed by app | Class | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `image_1793898865551_062c616140ae9dc0.png` | 70 B | image/png | `c414cd0e204de974` | 1×1 test pixel (same bytes as #11) | none | no | DELETE CANDIDATE | delete after approval |
| 2 | `image_1794062915012_22669ee748f08093.png` | 2,287,786 B | image/png | `a47a4f07421a9246` | green sweater banner; byte-identical copy of the in-use banner `image_1794070261889_…` | none | no (the in-use copy is migrated separately) | DELETE CANDIDATE | delete after approval |
| 3 | `image_1794063883098_af4dbb272afa8d4f.png` | 2,287,786 B | image/png | `a47a4f07421a9246` | same banner, repeat upload | none | no | DELETE CANDIDATE | delete after approval |
| 4 | `image_1794064503994_6d7856eccbef0c94.png` | 2,287,786 B | image/png | `a47a4f07421a9246` | same banner, repeat upload | none | no | DELETE CANDIDATE | delete after approval |
| 5 | `media_1792289934071_o2hemi.mp4` | 9,297,331 B | video/mp4 | `591d57ab7b87bcde` | 29.9 s customer/feedback video; `feedback_videos` is empty | none | no | REVIEW | owner decides if it should be re-published (needs the customer's consent) or deleted |
| 6 | `media_1792307826666_bgirs4.mp4` | 9,297,331 B | video/mp4 | `591d57ab7b87bcde` | byte-identical copy of #5 | none | no | DELETE CANDIDATE | delete after approval, whatever is decided for #5 |
| 7 | `media_1792312105531_tdrehz.jpg` | 67,721 B | image/jpeg | `734c65d54d318fad` | **portrait photo of a person** (same bytes as #12) | none | no | REVIEW | personal data; owner decides, deletion recommended |
| 8 | `media_1792312114912_ub7w2l.jpg` | 105,295 B | image/jpeg | `9b136685d3c28434` | **portrait photo of a person** (same bytes as #10) | none | no | REVIEW | personal data; owner decides, deletion recommended |
| 9 | `media_1792313810181_lon7he.jpg` | 86,360 B | image/jpeg | `b63d42c5db8e495d` | **portrait photo**; first image of product "Gurthi" (audit log, 18 Oct), which has since been deleted | audit log only | no | REVIEW | personal data; owner decides, deletion recommended |
| 10 | `media_1792313822184_h4peow.jpg` | 105,295 B | image/jpeg | `9b136685d3c28434` | second image of the deleted "Gurthi" product; same bytes as #8 | audit log only | no | REVIEW | personal data; owner decides, deletion recommended |
| 11 | `piece_1792249885074_k7kln9.png` | 70 B | image/png | `c414cd0e204de974` | 1×1 test pixel from the retired Request-a-Piece feature (`piece_requests` is empty) | none | no | DELETE CANDIDATE | delete after approval |
| 12 | `piece_1792249928453_r9j0zn.jpg` | 67,721 B | image/jpeg | `734c65d54d318fad` | **portrait photo** attached to a retired Request-a-Piece request; no row remains | none | no | REVIEW | personal data; owner decides, deletion recommended |

Also not migratable: `media_1792308304330_9us5q7.mp4` (10 bytes, not a media file), a DELETE CANDIDATE.

Summary:
- KEEP: 0.
- REVIEW: 6 files (5 portrait photos of people and 1 video).
- DELETE CANDIDATE: 6 files, plus the invalid file.

**Privacy note.** Files 7–10 and 12 are photographs of identifiable people, publicly reachable at
`/uploads/<name>`. Their names contain a millisecond timestamp and only 6 random characters, so they
are guessable with effort. Recommendation:
- run the migration with `--skip-orphans`, so these are **not** copied into Supabase;
- then decide on deleting them locally.

Nothing was deleted, moved or copied.

## 5. Private media and storage security

Verified by automated tests against the real Supabase SDK and a Storage stand-in. See
`STORAGE_SECURITY_TESTS.md` for the full list.

| Threat | Result |
|---|---|
| Unauthorized upload (guest) | 401 |
| Customer uploading to a staff or archive bucket | 403 |
| Invalid file signature, MIME spoofing (SVG/HTML/EXE with an image name or type) | 415; the type comes from the bytes only |
| Oversized upload | 413, rejected before the body is read when `Content-Length` is too large |
| Path traversal in references (`..`, `%2F..`) | rejected by `parseRef` / `isLocalUpload`; `displayUrl` returns null |
| Malicious client file name | ignored; the stored name is always 16 random bytes |
| Public URL for private evidence | refused (no public route for private buckets; stand-in returns 400) |
| Signed URL forged or for a traversal path | 404 |
| Expired signed URL | refused |
| Cross-customer evidence | another customer's reference is silently dropped from an exchange |
| Unauthorized deletion | customers get 403 on admin deletes; no customer delete route exists |
| Bucket permission escalation | buckets are created or changed only by the `storage:setup` CLI; no HTTP route |
| Service-role key in the frontend | absent: no `service_role` marker, no JWT, no `supabase-js` in `vishrea-react/dist`; the frontend source never imports Supabase |
| Secrets in logs | logs record bucket, purpose, size, error class and path only (never query strings, keys or signed URLs) |

**Fixed in this audit:** uploads set a one-year `Cache-Control` on every object, including private
evidence. A staff browser could therefore keep a customer's damage photo cached long after its
5-minute link expired. Private objects now upload with `max-age=0`. Public objects keep one year,
which is safe because their names are random and never reused. A test asserts both.

**Owner action (not a defect):** `vishrea-react/.env` (git-ignored) defines `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY`.
- The key's role claim is `anon`, not service-role.
- No code reads either variable, so neither is in the build.
- Recommend removing both, so a future `import.meta.env` reference cannot ship them by accident.

## 6. Backend resilience

| Failure | Behaviour (tested) |
|---|---|
| Supabase unavailable / repeated 5xx | 2 bounded retries with backoff, then 503 `storage_unavailable`; server keeps serving |
| Network timeout | every call is limited by `STORAGE_TIMEOUT_MS`, then the same 503 |
| Upload interruption | the body is fully buffered before storage is touched; an aborted request writes nothing; no temporary files are used |
| DB insert fails after upload | the object is deleted again (compensation test) |
| Duplicate upload | same file, purpose and owner returns the existing reference (200) |
| Retry after a lost response | a duplicate of our own object of the same size is accepted, not double-stored |
| Permission denied / missing bucket | not retried; 503; no metadata row |
| Invalid object path | rejected before any storage call |
| Failed deletion | logged (`storage.release_failed`, no details), and the file stays for the orphan scanner. Deletion runs after commit, so the DB never points at a deleted file |

Design note: replacing or deleting a product image or carousel banner does not delete the old file
automatically, because order history reads images through the product. Unused files are found by
`npm run media:orphans` (a dry run) and removed only with owner approval.

## 7. Frontend and admin

- Browser journeys were **not run** in this audit. The only configured database is the remote
  Supabase one, and admin uploads or edits there would modify live data.
- Instead, the same flows are covered end to end at the API level by the automated suites:
  product upload with multiple images, banner upload and publish, video upload and replace, Instagram
  items, evidence upload and staff view.
- A browser pass against an isolated database is possible on request.
- The frontend uploads only to `POST /api/upload` with the session cookie and never talks to
  Supabase.

## 8. Performance

Measured sizes:

| Asset | Size | Delivery |
|---|---|---|
| Homepage banners (2, PNG 1774×887) | 2.29 MB and 1.96 MB | eager `fetchpriority=high` for slide 1; same file on mobile (no mobile image set) |
| Uploaded product photos (JPEG 1086×1448) | 117–166 KB | lazy; no responsive variants |
| Unsplash demo products | 79–268 KB at w=1000 | `srcset` 320–960 w with automatic WebP/AVIF |

Recommendations, in order of measurable benefit:
1. **Banners:** re-export as JPEG/WebP and add a mobile image in Admin → Homepage. Photographic PNGs of
   this size usually shrink by well over 80% as JPEG/WebP (an estimate, not measured here). This is
   the largest saving on the first page view.
2. **Cache:** public objects are uploaded with a one-year cache, which suits CDN delivery; private
   objects use `max-age=0`.
3. Supabase on-the-fly image transformations depend on the plan. Add them only if the bandwidth
   reports show product images dominate egress. No new services are needed now.

## 9. Legacy storage (`public/uploads`)

| Group | Files | Bytes |
|---|---|---|
| Referenced by the DB, to migrate | 6 | 4,810,606 |
| Already migrated | 0 | — |
| Orphans (section 4) | 12 | 25,890,552 |
| Invalid | 1 | 10 |
| **Total** | **19** | **30,701,168** |

Cleanup plan; every step needs approval:
1. migrate the 6 in-use files;
2. verify;
3. settle for at least 7 days;
4. delete the orphans you approve;
5. archive and then remove `public/uploads`.

Until step 1 is done, production depends on the server disk.

## 10. Regression results (this audit)

| Run | Result |
|---|---|
| Full suite before changes | 190/190 passed, 0 skipped |
| `test/storage.test.js` after changes (1 new test) | 13/13 passed |
| Full suite after changes | **191/191 passed**, 0 failed, 0 skipped |
| Lint | exit 0, warnings only (no errors) |
| Production build | succeeded |
| Browser journeys | not run (see section 7) |

## 11. Production blockers

1. **Migration not run.** The 6 in-use files (product 41a051f9 and both homepage banners) live only in
   `public/uploads`.
2. ~~Buckets don't exist~~: **resolved**. All 6 were created and verified on 2026-11-09.
3. **`STORAGE_DRIVER=supabase`** must be set in the production secret store. Production refuses to
   start without it, by design.
4. **Owner decision** on the 6 REVIEW files, especially the portrait photos.
5. Recommended: the development `.env` points at the remote database with `ALLOW_REMOTE_DATABASE=true`.
   If that is the production database, use a separate development or staging database before further
   testing.
