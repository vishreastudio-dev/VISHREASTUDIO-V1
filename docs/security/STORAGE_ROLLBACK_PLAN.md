# Storage rollback plan

Current state (2026-11-09 13:26 IST): 6 files were migrated and 9 references rewritten. The rollback
source is `scratch/media-migration/results-2026-11-09T07-56-47-574Z.json`. Back this file up: it is
git-ignored and exists only on this machine. The same mapping is also in `media_objects.legacy_url`.
All 6 local originals are intact in `public/uploads`.

Once `PRODUCTION_SUPABASE_PROJECT_REF` is set on the machine that runs the rollback, add
`--production` to `media:rollback`. Without it, the script refuses to write to the live project.

The migration is designed so that every step can be undone without data loss. Local files are
never deleted or modified, and objects in Supabase Storage are kept during a rollback.

## Rollback levels

### 1. Undo reference changes (the most common case)

```powershell
npm run media:rollback -- --results=scratch/media-migration/results-<timestamp>.json
npm run media:inventory          # files in use show "ready" again (references back to /uploads/...);
                                 # archived orphans show "already_migrated"
```

- This puts back the original `/uploads/...` value in every row the migration changed. Each file
  is restored in its own transaction.
- The objects and `media_objects` rows in Supabase stay, so a later `apply` re-uses them without
  uploading again.
- Requirement: `public/uploads` still holds the original files. It does, because the migration
  never removes them.

### 2. Return the application to the local driver (non-production only)

- Set `STORAGE_DRIVER=local` and restart. Existing `/uploads/...` references are served from disk
  as before.
- In production the server refuses `local`, by design. A production rollback is level 1 plus a
  database restore if needed. Supabase remains the store for new uploads.

### 3. Restore the database

- If references are wrong in a way the results file cannot repair, restore the pre-migration
  backup or use Supabase point-in-time recovery to just before `apply`.
- Storage objects need no restore; unused ones show up in `npm run media:orphans`.

### 4. Remove migration 023 (last resort)

- Migration 023 is additive, so the application does not break while it exists.
- Remove it only if the table must go: `DROP TABLE media_objects;` (**APPROVAL**). After that, any
  `storage://` or Supabase references must already be rolled back (level 1).

## Things to keep until the owner signs off

| Keep | Why |
|---|---|
| `public/uploads/` (all 19 files) | rollback source; deleting it removes level 1 |
| `scratch/media-migration/manifest-*.json` | exact inventory that was approved |
| `scratch/media-migration/results-*.json` | the only map from new references back to old ones |
| database backup / PITR window | level 3 |

Deleting local files or archived objects is a separate owner decision, taken only after:
- `media:verify` reports every reference in place and retrievable;
- the storefront and admin have been checked;
- a settling period has passed.

## Failure during `apply`

- If a file fails to upload, or its stored copy doesn't match the original, its references are
  **not** changed. It stays on `/uploads/...` and keeps working.
- If a reference rewrite fails, that transaction rolls back and the file is reported as `failed`.
- Fix the cause and re-run the same `apply`. If the inventory changed, take a new inventory first.
  Files already migrated are skipped.
