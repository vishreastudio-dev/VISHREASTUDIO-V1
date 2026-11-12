# Final storage production readiness

Audit date: 2026-11-09, 13:30–14:15 IST. Production-preparation update (§8–§15): 14:15–14:40 IST.

Method: independent read-only checks against the database in `.env`, the Supabase project at
`SUPABASE_URL`, and the running app on `localhost:3000` (production build, `STORAGE_DRIVER=supabase`).
No uploads, edits, deletions, schema changes, deployments or pushes were made. No key, token or signed
URL was printed.

Scripts used (git-ignored): `scratch/readiness-audit.mjs`, `scratch/slides-state.mjs`,
`scratch/storage-policies.mjs`.

## 1. Migration summary

| Item | Result |
|---|---|
| Migration 023 (`media_objects`) | applied by the owner (`npm run migrate`) |
| Buckets | 6 created by `storage:setup --fix` (4 public, 2 private) |
| Migration run | `media:migrate --confirm=ad17cd84ac0e --skip-orphans`, 2026-11-09 07:56 UTC, by the owner |
| Files migrated | **6**: 4 product photos and 2 homepage banners |
| References rewritten | **9** |
| Orphans | **12 skipped**, plus 1 invalid file skipped; all still in `public/uploads` |
| Owner's `media:verify` | 6 of 6 `references_in_place: true`, `retrievable: true` |
| Results file | `scratch/media-migration/results-2026-11-09T07-56-47-574Z.json` |
| Local originals | all 6 still present and unchanged |

## 2. Database verification (independent)

| Check | Result |
|---|---|
| Media columns scanned | 13 (`lib/media-references.js`) plus a schema-wide text/JSON scan |
| References to Supabase found for the migrated files | **9 of 9** expected |
| `products` 41a051f9 `image_url` + `images[0..3]` | 5 references, all `…/public/product-images/products/41a051f9-…/<original name>` |
| `homepage_carousel_slides` 72009b7e and aaf724d0, `desktop_image_url` + `published_content` | 4 references, all `…/public/homepage-banners/banners/legacy/<original name>` |
| Remaining `/uploads/` references in any media column | **0** (rows with `/uploads/`: products 0, carousel slides 0) |
| Other columns mentioning uploads | `audit_logs.details` only: history, never rewritten |
| `media_objects` rows | 6; all `driver=supabase`, `visibility=public`, `legacy_url` set, none deleted |
| Duplicates | none: 6 rows, 6 objects, 6 distinct paths |
| External images still in use | images.unsplash.com (8 demo products), instagram.com (1 post link) |

## 3. Storage object verification (independent)

Each object was downloaded with the service role and fetched anonymously by its public URL.

| Object | Bucket | Bytes (local = stored = metadata) | SHA-256 local = stored = results = metadata | Anonymous GET | Cache-Control |
|---|---|---|---|---|---|
| `products/41a051f9…/image_1793716245931_….jpg` | product-images | 169,880 | match | 200 `image/jpeg`, hash match | `max-age=31536000` |
| `products/41a051f9…/image_1793716249372_….jpg` | product-images | 140,359 | match | 200, hash match | same |
| `products/41a051f9…/image_1793716252556_….jpg` | product-images | 119,718 | match | 200, hash match | same |
| `products/41a051f9…/image_1793716277022_….jpg` | product-images | 128,024 | match | 200, hash match | same |
| `banners/legacy/image_1794070261889_….png` | homepage-banners | 2,287,786 | match | 200 `image/png`, hash match | same |
| `banners/legacy/image_1794070399598_….png` | homepage-banners | 1,964,839 | match | 200, hash match | same |

The other buckets (`instagram-media`, `customer-feedback`, `exchange-evidence`, `media-archive`) are
empty.

## 4. Public / private access results

The `anon` key is the key any browser could hold.

| Test | Result |
|---|---|
| Anonymous GET of public product images and banners | **200**, byte-identical |
| `anon` list buckets | 0 visible |
| `anon` list `exchange-evidence`, `media-archive` | 0 items, so listing is blocked |
| `anon` list `product-images`, `homepage-banners` (which hold files) | **0 items**: public files cannot be enumerated either |
| `anon` create signed URL (private path, and a real public object) | refused |
| `anon` download from `exchange-evidence` | refused |
| Public-URL route on the private bucket | 400 |
| Authenticated-object route without a token | 400 |
| Signed URL (service role, 3 s) fetched immediately | **200**, hash match |
| Same signed URL with a tampered token | **400** |
| Token reused for a different object path | **400** |
| Same signed URL after expiry | **400** |
| Storage RLS (`storage.objects`, `storage.buckets`) | enabled, **no policies**, so only the service role has access |
| Private evidence caching | private uploads use `max-age=0`. No live evidence exists to probe, so this is verified by an automated test |
| Service-role key in frontend | **absent** from all of `vishrea-react/dist` (no `service_role` marker, no JWT, no `supabase.co`, no `@supabase`) after a fresh build; **absent** from the 3 scripts and HTML the browser loaded; the browser made **0** calls to Supabase API, sign or bucket routes |

## 5. Frontend integration (real browser, read-only page views)

Tested in Cursor's built-in browser against `http://localhost:3000`, signed out:

| Check | Desktop (1024 px) | Mobile (390×844, 2×) |
|---|---|---|
| Product detail main image (Supabase) | loaded 1086×1448 | loaded, rendered 287×359 |
| Product gallery thumbnails (4, Supabase) | 4/4 | 4/4 |
| Catalogue card (Sweaters) | — | loaded from Supabase, 165 px wide |
| Requests to `/uploads/` | 0 | 0 |
| Image fallback (main image pointed at a missing Supabase object, in the browser only) | fell back to `/assets/editorial.jpg` | — |
| Reload after a new production build (`index-rjKJQs7F.js`) | 5/5 images from Supabase | — |
| Homepage | 7/7 images loaded; static fallback hero shown | same |

Not verified in the browser:
- **Homepage banners in the live carousel.** Both banner slides are **inactive** (`is_active = false`,
  set in admin on 2026-11-08, before the migration), so `/api/homepage-carousel` returns no slides and
  the homepage shows its fallback hero. The migrated banner URLs pass the carousel's validation, load
  anonymously (200, byte-identical), and are allowed by the security policy (`img-src` includes the
  Supabase origin). Re-activating a slide would show them; that is an owner decision.
- **New uploads and private evidence flows.** No live uploads were allowed. These are covered by the
  automated suite: `storage.test.js` runs real `@supabase/supabase-js` against a Storage stand-in, and
  covers Supabase-driver uploads, evidence ownership, signed links and expiry.

## 6. Test results (this session)

| Run | Result |
|---|---|
| Full suite `npm test` | **191/191 passed**, 0 failed, 0 skipped |
| Full suite after the isolation guard (14:26 IST, +1 test) | **192/192 passed**, 0 failed, 0 skipped. The frontend is unchanged since the lint and build above |
| Includes: storage (13), upload/platform, production config, auth/authorisation, migration rehearsal, carousel | all passed |
| Lint (`vishrea-react`) | exit 0, 0 errors (warnings only) |
| Production build | succeeded |
| Browser checks | section 5 |

## 7. Performance

| Asset | Measured | Note |
|---|---|---|
| Product photos | 117–166 KB JPEG, 1086×1448 | a 165 px phone card downloads the full image (no `srcset` for uploads) |
| Homepage banners | 2.29 MB and 1.96 MB **PNG**, 1774×887 | used on phones too (no mobile image set) |
| Public object caching | `public, max-age=31536000`, CORS `*` | good; names never change |
| Supabase fetch time (browser, uncached) | about 430–515 ms per product image | from `localhost`; production latency depends on the region |

Recommendations, without overwriting originals or adding dependencies:
1. **Banners first.** Re-export both as WebP (or JPEG) at about 1800 px wide, and add a separate mobile
   image of about 900 px in Admin → Homepage. The carousel already supports a mobile `<source>`. Upload
   them as new files; the originals stay in Storage.
2. **Product cards.** If Supabase image transformations are available on your plan, add a `srcset` for
   Supabase URLs in `srcSetFor()` (`/render/image/public/…?width=`), the same way it is already done
   for Unsplash. Otherwise, export product photos at about 1000 px wide before upload. Benefit: several
   times fewer bytes per card on phones (an estimate: a 330-device-pixel card versus a 1086 px source).
3. AVIF is optional; WebP gives most of the saving and is supported everywhere relevant.

## 8. Development / production isolation

### Current state (inspected 2026-11-09 14:15 IST; names only, no values printed)

| Setting in the developer `.env` | Value / finding |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` | remote Supabase database, **same project** as `SUPABASE_URL` |
| `ALLOW_REMOTE_DATABASE` | `true`, which disables the old remote-database guard |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | set; this is the project that serves the live product images |
| `PRODUCTION_SUPABASE_PROJECT_REF` | **not set** (new; see below) |

So today, local development reads and writes the live database and the live buckets.

### Guard added in this change (code + tests)

- **`PRODUCTION_SUPABASE_PROJECT_REF`** (in `lib/config.js`) names the live project: the `<ref>` in
  `https://<ref>.supabase.co`. It is not a secret; it is already in every public image URL.
- **Development or test, web server.** `node server.js` / `npm run dev` **refuses to start** if
  `SUPABASE_URL` or `DATABASE_URL` points at that project. There is no override, and
  `ALLOW_REMOTE_DATABASE` doesn't bypass it.
- **Development or test, maintenance scripts.** These refuse to write to that project unless
  `--production` is passed for that one run, and they then print a `[production]` warning:
  - `migrate.js`;
  - `storage-setup --fix`;
  - `media:migrate apply` and `media:rollback`;
  - `media:orphans --delete`.
  Read-only commands (`media:inventory`, `media:verify`, `media:orphans` dry run, and
  `storage:setup` without `--fix`) are unaffected.
- **Production.** Startup fails if `SUPABASE_URL` belongs to a different project than the one named.
- **Tests.** `test/production.test.js` covers storage and database detection (direct and pooler URL
  forms), the absence of a server override, the script override, real `server.js` and `migrate.js`
  refusals, an invalid ref, a production mismatch, and that no credentials appear in messages.
- **Activation is an owner action.** The guard does nothing until the ref is set. Setting it in the
  current `.env` would immediately stop the local server, which is intended, so switch `.env` to a
  development project first.

### Creating the development Supabase project

1. In the Supabase dashboard, create a new project in the same organisation, for example
   `vishrea-dev`, in the same region. Choose a new database password; never reuse production's.
2. Project Settings → API: copy the dev **Project URL** and dev **service_role** key into your local
   `.env` only (see `.env.development.example`, option B).
3. Project Settings → Database → Connection string (URI): use it as `DATABASE_URL`, with
   `DATABASE_SSL=true` and `ALLOW_REMOTE_DATABASE=true`. Alternatively use a local PostgreSQL
   (option A, simplest).
4. Add `PRODUCTION_SUPABASE_PROJECT_REF=<live ref>` to the local `.env`. From then on, the local
   server cannot start against the live project.
5. `npm run migrate`, which builds the schema in the dev database. Optionally add `--seed-demo` for the
   demo catalogue.
6. `npm run storage:setup -- --fix`, which creates the six buckets in the dev project.
7. Use a different `JWT_SECRET`, Razorpay **test** keys and `RESEND_API_KEY` as needed. Remove
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `vishrea-react/.env`, because the frontend never
   uses them.
8. To act on production deliberately from this machine, use the scripts with `--production`, after
   approval. Never use the web server for this.

Templates:
- `.env.development.example`: dev project or local, with the guard ref.
- `.env.production.example`: host secret store, with the matching ref.
- `.env.example`: annotated reference.

Production credentials and admin accounts were not touched.

## 9. Orphan privacy

### The five portrait photos and the unused video

| File | What | Bytes | SHA-256 | In git (pushed to private `origin/main`) |
|---|---|---|---|---|
| `media_1792312105531_tdrehz.jpg` | portrait photo | 67,721 | `734c65d5…0da812e28` | **yes** |
| `piece_1792249928453_r9j0zn.jpg` | portrait photo (same bytes as tdrehz); retired Request-a-Piece attachment | 67,721 | `734c65d5…0da812e28` | **yes** |
| `media_1792312114912_ub7w2l.jpg` | portrait photo | 105,295 | `9b136685…14ce5d05` | **yes** |
| `media_1792313822184_h4peow.jpg` | portrait photo (same bytes as ub7w2l); deleted product "Gurthi" | 105,295 | `9b136685…14ce5d05` | no |
| `media_1792313810181_lon7he.jpg` | portrait photo; deleted product "Gurthi" | 86,360 | `b63d42c5…71b14cf2f` | no |
| `media_1792289934071_o2hemi.mp4` | 29.9 s video, unused (`feedback_videos` is empty) | 9,297,331 | `591d57ab…a37c6049cb9563cde8ab49c3` | **yes** |

### Where these files can be reached today

1. **`/uploads/<name>` on any running instance.** That includes this machine's dev server, and any
   tunnel to it: `CORS_ORIGINS` lists a `trycloudflare.com` tunnel. Express serves the whole
   `public/uploads` folder.
2. **Any host deployed from git** gets the 7 tracked files, so they would be served at `/uploads/` in
   production.
3. **The GitHub repository** (`vishreastudio-dev/VISHREA-STUDIO`). It is private (anonymous API returns
   404), so it's visible to collaborators only, but the files are in history permanently until it is
   rewritten.

### Blocking the public URLs safely (no file moved or deleted)

Recommended order; each step needs approval:

| Step | Change | Effect | Reversible |
|---|---|---|---|
| 1 | **Serve only still-needed legacy files.** A small code change in the `/uploads` static route allows a file only if a DB media column references it, or it is a migrated file's `legacy_url` (kept for rollback). Everything else returns 404 | blocks all 13 orphan/invalid URLs at once on every instance, including after a git deploy. Rollback still works, because rolled-back references become live again | yes (code) |
| 2 | **Stop tracking the 7 files.** `git rm --cached` those 7 paths, plus a commit | future clones and deploys no longer contain them. History still does | yes |
| 3 | **Private backup, then owner-approved deletion.** Copy the 6 REVIEW files to an owner-held private location outside the web root, or to the private `media-archive` bucket, which needs `--production`. Verify SHA-256, then delete the local copies | removes the exposure on this machine | backup only |
| 4 | **Optional history purge.** Remove the 7 paths from git history (`git filter-repo`) and force-push. All collaborators must re-clone | removes them from GitHub | no (coordinate first) |

Recommendation: do step 1 now. Do steps 2 and 3 after you decide on each REVIEW file. Do step 4 only
if the people pictured haven't consented to the photos being kept.

## 10. Cleanup manifest (prepared, not executed)

Every file below was re-checked against **all 334 text/JSON columns in all tables**, and against the
application code (`server.js`, `api/`, `lib/`, `scripts/`, `vishrea-react/src`, `dist`). Status
`unreferenced` means no match anywhere except the audit-log history noted.

### DELETE CANDIDATES (6 + invalid)

| # | Path | Bytes | SHA-256 | Reason | DB / code references |
|---|---|---|---|---|---|
| 1 | `public/uploads/image_1793898865551_062c616140ae9dc0.png` | 70 | `c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77` | 1×1 test pixel | none |
| 2 | `public/uploads/piece_1792249885074_k7kln9.png` | 70 | `c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77` | 1×1 test pixel (git-tracked) | none |
| 3 | `public/uploads/image_1794062915012_22669ee748f08093.png` | 2,287,786 | `a47a4f07421a92465964586359b85c2809dea0de5936f12c8e89d2df1421a7ef` | duplicate of the migrated banner | none |
| 4 | `public/uploads/image_1794063883098_af4dbb272afa8d4f.png` | 2,287,786 | `a47a4f07421a92465964586359b85c2809dea0de5936f12c8e89d2df1421a7ef` | duplicate of the migrated banner | none |
| 5 | `public/uploads/image_1794064503994_6d7856eccbef0c94.png` | 2,287,786 | `a47a4f07421a92465964586359b85c2809dea0de5936f12c8e89d2df1421a7ef` | duplicate of the migrated banner | none |
| 6 | `public/uploads/media_1792307826666_bgirs4.mp4` | 9,297,331 | `591d57ab7b87bcde943ac357568b2524ef76cc58a37c6049cb9563cde8ab49c3` | byte-identical duplicate of `o2hemi.mp4` (git-tracked) | none |
| 7 | `public/uploads/media_1792308304330_9us5q7.mp4` | 10 | `176e1354b962e3dca88a26511815e722db9abae6276ee41bf9c6dca429bf63c9` | invalid, not a video (git-tracked) | none |

Total: 16,160,839 bytes (about 15.4 MB).

Not in this manifest:
- the 6 REVIEW files (§9), which need your decision;
- the 6 migrated originals, which are kept as the rollback source until sign-off.

Proposed execution, after separate approval:
1. Re-hash each file and refuse any whose SHA-256 differs from this table.
2. Re-run the reference check.
3. Delete exactly these 7 paths.
4. `git rm --cached` the 3 tracked ones, as part of the commit you approve.
5. Re-run `media:inventory` and confirm 0 broken references.

## 11. Homepage banner optimisation

### Inspection

| Banner | Slide | Status | Size | Format | Transparency | Content |
|---|---|---|---|---|---|---|
| `image_1794070261889_….png` | 72009b7e | **inactive** | 1774×887 (2:1), 2,234 KB | PNG | none | green patchwork sweater on a hanger (right), vase and table (left) |
| `image_1794070399598_….png` | aaf724d0 | **inactive** | 1774×887 (2:1), 1,919 KB | PNG | none | yellow bunny sweater on a rail (right), vase and table (left) |

### Measured re-encodes

Measured by re-encoding the live public files in the browser's memory only, with Chrome's encoder.
Nothing was saved or uploaded.

| Version | Banner 1 | Banner 2 | vs. original |
|---|---|---|---|
| Original PNG 1774 px | 2,234 KB | 1,919 KB | — |
| JPEG 1774 px, q 0.82 | 187 KB | 130 KB | −92 to −93% |
| **WebP 1774 px, q 0.82** | **130 KB** | **83 KB** | **−94 to −96%** |
| WebP 1440 px, q 0.80 | 75 KB | 50 KB | −97% |
| **WebP 900 px, q 0.78 (phones)** | **36 KB** | **24 KB** | **−98 to −99%** |

AVIF cannot be encoded by the browser here. It would save a little more, but WebP already removes
about 95%.

### Recommendations (no change made)

1. Export **WebP 1774×887 at quality ~80** for the desktop image of each slide. That is about 0.2 MB
   for both instead of 4.2 MB.
2. Export a **mobile image** for each slide. Both photos put the garment on the right half, so a
   portrait crop of about **900×1125 (4:5)**, centred on the sweater, suits phones far better than
   shrinking the 2:1 frame. A 2:1 version at 900 px is about 24–36 KB if you prefer the same framing.
   The carousel already serves `mobile_image` through `<picture><source media="(max-width: 640px)">`.
3. Upload them as **new** files through Admin → Homepage (purpose `banner`). The original PNGs stay in
   `homepage-banners` and `public/uploads`. Edit the slides as **drafts**; whether to publish or
   re-activate is your decision. Both slides stay inactive.
4. Product photos: export at about 1000 px wide before upload. For Supabase URLs, add `srcset` only if
   image transformations are enabled on your plan. No new dependency is needed for either.

## 12. Remaining risks

| # | Risk | Severity | Action |
|---|---|---|---|
| 1 | **Development uses production** (§8): the guard is in place but inactive until the ref is set and `.env` points at a dev project | High | owner: create the dev project, then set `PRODUCTION_SUPABASE_PROJECT_REF` |
| 2 | Production host environment not verified (no hosting access) | **BLOCKED** | §13 checklist |
| 3 | Portrait photos reachable at `/uploads/`, 3 of them also in git history (§9) | High (privacy) | approve §9 step 1 |
| 4 | Heavy banners (§11) | Medium | owner exports WebP and mobile versions |
| 5 | The rollback results file exists only on this machine | Low | back it up; the mapping is also in `media_objects.legacy_url` |
| 6 | Unused `VITE_SUPABASE_*` in `vishrea-react/.env` | Low | remove |
| 7 | Both banner slides inactive | Info | intentional per the owner; not changed |

## 13. Production environment checklist

Set in the host's secret store. These are backend only; never in git, never `VITE_*`:

| Variable | Required | Value | Enforced at startup |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | — |
| `STORAGE_DRIVER` | yes (set it explicitly) | `supabase` | defaults to `supabase` in production; `local` is refused |
| `SUPABASE_URL` | yes | `https://<live-ref>.supabase.co` | must be https |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | live service-role key | must be set (length check); never printed |
| `PRODUCTION_SUPABASE_PROJECT_REF` | recommended | `<live-ref>` | must match `SUPABASE_URL` |
| `STORAGE_SIGNED_URL_SECONDS` | optional | `300` (30–3600) | range-checked |
| `STORAGE_TIMEOUT_MS` | optional | `20000` (2000–120000) | range-checked |
| `STORAGE_BUCKET_*` | optional | defaults are fine | name format checked |
| `ALLOW_REMOTE_DATABASE` | **must be unset** | — | development-only flag |
| `UPLOAD_ORPHAN_CLEANUP_DAYS` | **leave unset** | — | local driver only |
| `VITE_SUPABASE_*` | **must not exist** | — | the frontend needs no Supabase key |

Verification after setting them, from the host shell (read-only): `npm run storage:setup`, which
should report all six buckets as `ok`. The hosting provider was not accessed in this audit.

## 14. Rollback

```powershell
# Put the 9 original /uploads/... references back (local originals are intact).
# --production is required once PRODUCTION_SUPABASE_PROJECT_REF is set on this machine.
npm run media:rollback -- --results=scratch/media-migration/results-2026-11-09T07-56-47-574Z.json --production
npm run media:inventory      # the 6 files show "ready" again
```

- Rollback keeps the Supabase objects and `media_objects` rows, so a later re-apply re-uses them.
- After a rollback, the server must still serve `public/uploads` (it does, under both drivers).
- New uploads keep going to Supabase while `STORAGE_DRIVER=supabase`.
- Full plan: `STORAGE_ROLLBACK_PLAN.md`.

## 15. Approved remediation, phase 1 (2026-11-09, 14:31–14:45 IST)

Approved: block orphan URLs, stop git tracking, prepare the seven-file cleanup. Nothing was deleted,
committed, pushed or deployed. No production data was changed.

### 15.1 Files no longer publicly accessible

- `/uploads/<name>` now serves a file only if it is a registered local public upload (`media_objects`,
  `driver=local`), or a record in a media column references it (`isServableUpload` in
  `lib/storage.js`, applied in `server.js`).
- Everything else returns `404 not_found`, with no file bytes. That includes encoded names, sub-folders,
  `..`, hidden folders and non-GET/HEAD methods.
- Answers are cached for 60 s (allowed) or 5 s (refused). Any store or delete clears the cache, so a
  fresh admin upload previews immediately.
- Supabase delivery is untouched, because public Supabase URLs never pass through `/uploads`.

Verified against the running dev server (HEAD requests): **all 19 files in `public/uploads` now return
404**. That covers:
- the 5 portrait photos;
- the unused video;
- the 7 delete candidates;
- the 6 migrated originals, which now load from Supabase and remain on disk as the rollback source.

After a rollback, the restored references make those originals public again automatically.

### 15.2 Git tracking changes (staged, not committed)

The files were tracked because they were committed before `public/uploads/` was ignored. Exactly 7 files
were tracked: **3 delete candidates and 4 REVIEW files**. The other 4 delete candidates were never
committed.

| Path | Class | Added in commit | Present on |
|---|---|---|---|
| `public/uploads/piece_1792249885074_k7kln9.png` | delete candidate | `b106e8e` (2026-10-18) | `main`, `origin/main` |
| `public/uploads/piece_1792249928453_r9j0zn.jpg` | REVIEW (portrait) | `b106e8e` | `main`, `origin/main` |
| `public/uploads/media_1792289934071_o2hemi.mp4` | REVIEW (video) | `b106e8e` | `main`, `origin/main` |
| `public/uploads/media_1792307826666_bgirs4.mp4` | delete candidate | `a8e9da5` (2026-10-18) | `main`, `origin/main` |
| `public/uploads/media_1792308304330_9us5q7.mp4` | delete candidate (invalid) | `a8e9da5` | `main`, `origin/main` |
| `public/uploads/media_1792312105531_tdrehz.jpg` | REVIEW (portrait) | `a8e9da5` | `main`, `origin/main` |
| `public/uploads/media_1792312114912_ub7w2l.jpg` | REVIEW (portrait) | `a8e9da5` | `main`, `origin/main` |

- `git rm --cached` was run on all 7. The index now tracks 0 files under `public/uploads`, and all 19
  files are still on disk.
- `.gitignore` now groups the media rules: `public/uploads/`, `uploads/`, `media-backup/`, `*.private/`.
  No tracked file matches them.
- To undo before committing: `git restore --staged public/uploads`.

### 15.3 Remaining git history exposure

- Commits `b106e8e` and `a8e9da5` on `origin/main` (`vishreastudio-dev/VISHREA-STUDIO`, private) still
  contain the 7 files, including 3 portrait photos and the video.
- Anyone with repository access, any existing clone, and any deploy built from an older commit still
  has them.
- Removing them requires a history rewrite (`git filter-repo --path … --invert-paths`), a force-push,
  and every collaborator re-cloning. **Not approved, not done.**

### 15.4 Seven-file cleanup: prepared, not executed

- Approved list (names and full SHA-256): `docs/security/cleanup-2026-11-09-delete-candidates.json`.
- New tool: `scripts/media-local-cleanup.js` (`prepare`, `check`, `delete`):
  - names must be plain files directly in the upload folder;
  - every original must match its approved SHA-256;
  - the backup is copied and re-hashed;
  - `check` re-verifies originals and backups and requires 0 references in media columns and 0
    `media_objects` rows (by `ref` or `legacy_url`);
  - `delete` needs the manifest checksum and refuses if any check fails;
  - backups are never removed.
- **Backup location:** `media-backup/2026-11-09-delete-candidates/`, git-ignored and outside `public/`,
  so it is never served. It holds the 7 files (16,160,839 bytes) and `manifest.json`.
- **Check result (dry run, 14:40):**
  - all 7 present;
  - originals match the approved hashes;
  - backups match;
  - 0 references;
  - 0 registered rows;
  - `ok: true`;
  - checksum **`08aa9a957df8`**.
- Earlier full scan (14:25): 0 matches in all 334 text/JSON columns and in the application code.
- **To execute after your final confirmation:**
  `node scripts/media-local-cleanup.js delete --manifest=media-backup/2026-11-09-delete-candidates/manifest.json --confirm=08aa9a957df8`

### 15.5 Tests (this phase)

| Run | Result |
|---|---|
| Full suite `npm test` | **199/199 passed**, 0 failed, 0 skipped (192 earlier + 7 new) |
| New `test/uploads-access.test.js` (7) | covers: registered upload served right after upload and after saving; orphan 404 until referenced; rollback originals 404; deleted upload 404; traversal, encoded, hidden-folder, sub-folder and null-byte paths refused; private evidence unreachable; PUT/POST/DELETE refused; HEAD allowed; cleanup tool refuses hash mismatch, unsafe names, a missing checksum and referenced files, and keeps backups |
| Storage security suite (`storage.test.js`, 13) | passed (in the full run) |
| Lint | 0 errors (30 warnings, of the kind already present) |
| Production build | succeeded |
| Valid images, real browser on the dev server | product page 5/5 from Supabase; all catalogue images load (4 Supabase, 8 Unsplash, 0 failed). Banner slides are still inactive and their Supabase URLs don't use `/uploads` |

### 15.6 Remaining owner decisions

1. Final confirmation to run the seven-file deletion (checksum `08aa9a957df8`).
2. The 6 REVIEW files (5 portraits, 1 video): keep privately (and where) or delete.
3. Commit the staged untracking. The commit is yours to make; nothing was pushed.
4. Git history rewrite and force-push, or accept the private-repo exposure.
5. Create the development Supabase project and set `PRODUCTION_SUPABASE_PROJECT_REF` locally (§8).

## 16. GO / NO-GO

**Storage layer: GO.** The migration is complete and byte-verified. Database references are
consistent, with no `/uploads/` dependency for active media. Public media loads anonymously and in the
browser. Private buckets cannot be listed, signed or read anonymously. The service-role key is not in
the frontend, and all automated tests pass.

**Production cut-over: CONDITIONAL.** Proceed once:
1. the production host has the §13 variables (BLOCKED for this audit: no hosting access);
2. development uses its own project and `PRODUCTION_SUPABASE_PROJECT_REF` is set locally (§8);
3. ~~the orphan URLs are blocked~~: **done** (§15.1). Git untracking is staged (§15.2); commit it
   before the next deploy so new builds no longer contain the files.

**Cleanup: NO-GO without approval.** Nothing has been deleted, moved, uploaded or published. The
seven-file deletion is prepared and backed up (§15.4). Each of these awaits your approval:
- the §10 manifest (7 files);
- the 6 REVIEW decisions;
- the §9 steps;
- banner replacements (§11).

**Isolated QA, phases 1–4 (2026-11-11): ready for the load-testing phase, not a production GO.**
Functional Newman 1,873/1,873 and security Newman 437/437 passed against `127.0.0.1:3100` only.
Failure and recovery was 18/18 on the throwaway cluster. Automated regression was 201/201.
Details are in `docs/testing/QA_PHASE_1_4_EXECUTIVE_SUMMARY.md`. No k6 run has been started.
Production cut-over stays CONDITIONAL on the three items above.
