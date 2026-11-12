# Media storage architecture

Vishrea Studio stores uploaded media (product photos, homepage banners, Instagram media, customer
feedback videos, exchange evidence) in **Supabase Storage**. PostgreSQL stores only references and
metadata. All storage access goes through one server-side module, `lib/storage.js`.

## Principles

- **Backend only.** `@supabase/supabase-js` runs on the Node server with the service-role key. The
  React app never talks to Supabase, holds no Supabase key and has no `VITE_SUPABASE_*` variable.
  The production build is scanned for the key (see `STORAGE_SECURITY_TESTS.md`).
- **The database holds references, not files.** Every stored file has a `media_objects` row
  (migration 023) with its bucket, path, visibility, purpose, type, size, pixel size, video length,
  SHA-256, owner and uploader.
- **Public versus private is decided by purpose, never by the client.**
- **No dependency on the server disk in production.** `STORAGE_DRIVER=supabase` is enforced when
  `NODE_ENV=production`; the server refuses to start otherwise.

## Drivers

| Driver | When | Where files go |
|---|---|---|
| `supabase` | Required in production; optional in development (use a staging project) | Supabase Storage buckets |
| `local` | Default in development and tests | `UPLOADS_DIR` (default `public/uploads`); private files in `UPLOADS_DIR/.private/<bucket>/`, which is never served statically (`dotfiles: deny`) |

Both drivers share the same validation, metadata, de-duplication and reference rules, so tests on
the local driver exercise the same code paths. The test suite also runs the real Supabase SDK
against an HTTP stand-in for Supabase Storage.

## Buckets

| Purpose | Default bucket | Visibility | Accepted | Max size | Object path |
|---|---|---|---|---|---|
| `product` | `product-images` | public | JPG, PNG, WEBP | 10 MB | `products/<random>.<ext>` |
| `banner` | `homepage-banners` | public | JPG, PNG, WEBP | 10 MB | `banners/<random>.<ext>` |
| `instagram` | `instagram-media` | public | images and MP4/MOV | 40 MB | `instagram/<random>.<ext>` |
| `video` | `customer-feedback` | public | MP4/MOV | 40 MB | `videos/<random>.<ext>` |
| `evidence` | `exchange-evidence` | **private** | JPG, PNG, WEBP | 5 MB | `evidence/<customer id>/<random>.<ext>` |
| `archive` | `media-archive` | **private** | images and video | 40 MB | `legacy/<original name>` (migration only) |

Bucket names can be overridden with `STORAGE_BUCKET_PRODUCTS`, `_BANNERS`, `_INSTAGRAM`, `_VIDEOS`,
`_EVIDENCE` and `_ARCHIVE`. Customer feedback videos are public because they are published on the
homepage after admin review; they are uploaded only by admins.

Cache: public objects are uploaded with `Cache-Control: max-age=31536000` (their names are random
and never reused). Private objects use `max-age=0`, so a browser or CDN never keeps customer
evidence beyond its signed link.

Storage policies: no Storage RLS policy is granted to `anon` or `authenticated`. Only the backend
(service role) reads, writes, signs or deletes.

`npm run storage:setup` reports whether each bucket exists with the right visibility, size limit
and MIME allow-list; `npm run storage:setup -- --fix` creates or corrects them. Bucket-level
limits are a second line of defence behind the server's own checks.

## References stored in the database

| Visibility | Stored value | How it is displayed |
|---|---|---|
| public (Supabase) | `https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>` | used directly; CDN-cacheable |
| public (local) | `/uploads/<kind>_<timestamp>_<random>.<ext>` | served by Express with a sandboxing CSP and `nosniff` |
| private | `storage://<bucket>/<path>` | resolved per request to a signed URL that expires (`STORAGE_SIGNED_URL_SECONDS`, default 300 s) |

Existing `/uploads/...` references keep working under both drivers. `mediaInfo()` falls back to
measuring a legacy local file when no metadata row exists, so carousel slides, videos and product
images already saved continue to validate and display until they are migrated.

## Upload flow (`POST /api/upload`)

1. Authentication is required. **Customers** may upload only `evidence` (anything else returns 403).
   **Admins** may upload `product`, `banner`, `instagram` or `video`.
2. The file type is detected from the bytes (`sniff`), never from the file name or the
   `Content-Type` header. SVG, HTML, scripts and unknown types are refused.
3. Images must decode to readable dimensions (at most 10,000 px per side); MP4/MOV must parse and
   respect the video length cap.
4. The purpose's size limit applies (413 when exceeded).
5. The server chooses the object name (16 random bytes); client file names are never used.
6. A file identical to one already stored for the same purpose and owner (SHA-256) is not stored
   again; the existing reference is returned (`200`, `deduplicated: true`), otherwise `201`.
7. The object is written, then the metadata row. If the row cannot be written, the object is
   deleted again (compensation), so a failure leaves nothing behind.
8. The response contains the reference to save (`ref`), a display URL and the measured facts.

## Private media

- Exchange evidence lives in the private `exchange-evidence` bucket under the customer's own folder.
- An exchange request accepts only evidence references whose `media_objects` row has purpose
  `evidence` and `owner_id` equal to the signed-in customer; anything else is dropped.
- Staff see evidence in Admin → Exchanges through short-lived signed URLs, generated per request.
- With the local driver, signed links are HMAC-signed `/api/media/signed?ref&exp&sig` URLs served
  with `Cache-Control: private, no-store`, a sandbox CSP and `Cross-Origin-Resource-Policy: same-origin`.

## Failure handling

- Every storage call has a timeout (`STORAGE_TIMEOUT_MS`, default 20 s).
- Transient failures (timeouts, 5xx, network errors) are retried at most twice; permanent errors
  (permission, not found, rejected) are not retried.
- Errors reach clients as a generic `503 storage_unavailable` (or `413` for oversize). Bucket
  names, keys, paths and provider messages are never returned. The server keeps running.
- Logs record bucket, purpose, size and actor only, never keys or signed URLs.

## Lifecycle and deletion

- `lib/media-references.js` lists every column that can hold a media reference (`MEDIA_COLUMNS`).
- `safeDelete(ref)` counts references across those columns and deletes the object only when
  nothing uses it; the metadata row is marked `deleted_at` rather than removed.
- Admin edits that replace or remove media (videos, Instagram items, carousel images) release the
  old file only **after the database transaction commits**.
- `npm run media:orphans` is a **dry run** that lists stored objects no record uses (older than
  24 h by default). Deletion requires `--delete --confirm=<count>` and owner approval. Automatic
  orphan cleanup is not enabled for Supabase; `UPLOAD_ORPHAN_CLEANUP_DAYS` applies to the local
  driver only.

## Browser security policy

When the Supabase driver is active, the Supabase project origin is added to the CSP `img-src` and
`media-src` directives only. No `connect-src` entry is needed because the browser never calls the
Supabase API.

## Configuration

See `.env.example` and `.env.production.example`: `STORAGE_DRIVER`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (server-side only), `STORAGE_SIGNED_URL_SECONDS` (30–3600),
`STORAGE_TIMEOUT_MS` (2000–120000), `STORAGE_BUCKET_*`. Admin → Settings → "Hosting & uploads"
shows the active provider, buckets, limits and private-link lifetime (never the key).
