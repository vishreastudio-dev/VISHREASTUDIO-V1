# Supabase Storage migration runbook

Moves the files in `public/uploads` (or `UPLOADS_DIR`) into Supabase Storage and re-points the
database references. **Nothing in this runbook has been run against the live project.** It needs
owner approval at the steps marked **APPROVAL**.

**Status update, 2026-11-09 13:26 IST: migration COMPLETE.**
- The owner ran `media:migrate --confirm=ad17cd84ac0e --skip-orphans`.
- 6 files were migrated and 9 references rewritten; 12 orphans and 1 invalid file were skipped.
- The results file is `scratch/media-migration/results-2026-11-09T07-56-47-574Z.json`.
- An independent byte-level verification and access test passed; see `FINAL_STORAGE_PRODUCTION_READINESS.md`.
- `STORAGE_DRIVER=supabase` is now set in the development `.env`.

Since 14:20 IST, the write commands in this runbook need `--production` whenever the machine names
the live project in `PRODUCTION_SUPABASE_PROJECT_REF`: `migrate`, `storage:setup --fix`,
`media:migrate`, `media:rollback` and `media:orphans --delete`. See
`FINAL_STORAGE_PRODUCTION_READINESS.md` §8.

Earlier status (before the run), kept for the record:
- Migration 023 is applied; the owner ran `npm run migrate`.
- Buckets: all 6 were **created and verified** (13:20); storage RLS is on and no policies exist.
- The file migration has **not** run:
  - `media_objects` is empty;
  - all 9 references still point to `/uploads/...`;
  - `STORAGE_DRIVER` is unset.
- The inventory checksum is unchanged (`ad17cd84ac0e`).

**Recommended:** add `--skip-orphans`. Five of the orphans are portrait photos of people and should
not be copied into Supabase (see the orphan table in `POST_MIGRATION_VERIFICATION.md`).

## What the inventory found

| | Count |
|---|---|
| Files in `public/uploads` | 19 (29.28 MB) |
| In use, ready to migrate | 6: 4 product photos for one product, 2 homepage banners |
| Database references to rewrite | 9 (`products.image_url`, `products.images`, `homepage_carousel_slides.desktop_image_url`, `homepage_carousel_slides.published_content`) |
| Orphans: no row uses them | 12, copied to the private `media-archive` bucket, never published |
| Invalid: not a real media file | 1 (`media_1792308304330_9us5q7.mp4`, a few bytes), left in place |
| Conflicts | 0 |
| References to files missing on disk | 0 |

Notes for review:
- Three orphan banners are byte-identical to the banner in use (`a47a4f07…`), and two orphan
  videos are identical to each other. They look like repeated uploads from testing.
- Two orphans (`media_1792313810181_lon7he.jpg`, `media_1792313822184_h4peow.jpg`) appear only in the
  audit log. The audit log is history and is never rewritten.
- Pass `--skip-orphans` to `apply` to migrate only the 6 files in use and leave the orphans local.

## Prerequisites

1. A database backup, or a Supabase point-in-time recovery window, covering the migration time.
2. Migration 023 (`media_objects`) applied to the target database. **Done** on the database in
   `.env`. It is additive only: one new table, indexes and row-level-security lockdown.
3. The server environment, set in the host's secret store, not in git:
   `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. The buckets exist with correct settings:
   - `npm run storage:setup` reports and changes nothing;
   - `npm run storage:setup -- --fix` creates or corrects buckets (**APPROVAL**).

## Steps

```powershell
# 1. Re-take the inventory (read-only). The checksum changes if any file or reference changed.
npm run media:inventory -- --write-doc

# 2. Review docs/security/MEDIA_MIGRATION_MANIFEST.md, then apply with that exact checksum (APPROVAL).
npm run media:migrate -- --confirm=<checksum>
#    optional: --skip-orphans

# 3. Re-check every migrated file and reference.
npm run media:verify -- --results=scratch/media-migration/results-<timestamp>.json
```

What `apply` does for each file:
1. It refuses to run unless the driver is `supabase` and the checksum matches a fresh inventory, so
   it only ever runs against the inventory that was reviewed.
2. It re-hashes the local file; if the file changed, it skips the file and reports it.
3. It uploads the file to its target bucket and path and records a `media_objects` row with
   `legacy_url`.
4. It downloads the stored copy and compares its SHA-256 and size. On any mismatch it stops for
   that file, and no reference changes.
5. It rewrites all of the file's references in **one transaction**, re-reads them to confirm, and
   rolls back if any did not change. JSON values are matched as whole quoted strings, so a longer
   URL can never be partly replaced.
6. It fetches the new display URL and checks the hash again. The file is recorded as `migrated`,
   `migrated_unverified` or `failed`.

Re-running `apply` is safe. Files already migrated are recognised by `legacy_url` and are not
uploaded again, and rows already rewritten are left alone.

## After the migration

- Spot-check the storefront: the homepage carousel, the product page and product cards. Also check
  Admin → Products, Homepage and Settings → "Hosting & uploads".
- Keep `public/uploads` **unchanged**. Deleting it is a separate decision for the owner, taken only
  after verification and a settling period (`STORAGE_ROLLBACK_PLAN.md`).
- Orphan objects stay private in `media-archive`. Review them with `npm run media:orphans` (a dry
  run). Delete them only with owner approval.

## What this migration never does

- It does not delete or modify local files.
- It does not rewrite `audit_logs`.
- It does not change customer-facing business rules.
- It does not print or log the service-role key or signed URLs.
- It does not deploy or push to git.
