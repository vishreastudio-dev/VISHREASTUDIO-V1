/**
 * Media storage service. Every upload, download, signed link and deletion goes through here.
 *
 * Drivers
 *  - supabase: files in Supabase Storage buckets (required in production), via @supabase/supabase-js
 *    with the server-side service-role key. The key never leaves the server.
 *  - local:    development and tests; files under UPLOAD_DIR, private ones in a dot-folder that the
 *    static file server refuses to serve.
 *
 * What the database stores (a "ref")
 *  - public files:  their public URL (Supabase) or `/uploads/<file>` (local), usable directly in <img>.
 *  - private files: `storage://<bucket>/<path>`, which is never a working URL on its own. It is turned
 *    into a short-lived signed URL only for someone allowed to see it.
 * Each stored file also has a `media_objects` row (type, size, pixel size, video length, SHA-256,
 * owner), so validation never needs to read a file back.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { db as pool } from './db.js';
import { AppError } from './http.js';
import { log } from './log.js';
import { countReferences } from './media-references.js';
import { UPLOAD_DIR, imageDimensions, localUploadPath, mp4DurationSeconds, sniff } from './uploads.js';
import { isLocalUpload } from './validate.js';

const MB = 1024 * 1024;
const MAX_PIXELS_SIDE = 10000;

/** What each kind of upload may contain, how big it may be, and who may see it. */
export const PURPOSES = {
  product: { visibility: 'public', kinds: ['image'], maxBytes: 10 * MB, folder: 'products' },
  banner: { visibility: 'public', kinds: ['image'], maxBytes: 10 * MB, folder: 'banners' },
  instagram: { visibility: 'public', kinds: ['image', 'video'], maxBytes: 40 * MB, folder: 'instagram' },
  video: { visibility: 'public', kinds: ['video'], maxBytes: 40 * MB, folder: 'videos' },
  evidence: { visibility: 'private', kinds: ['image'], maxBytes: 5 * MB, folder: 'evidence' },
  archive: { visibility: 'private', kinds: ['image', 'video'], maxBytes: 40 * MB, folder: 'legacy' },
};

export const bucketFor = (purpose) => config.storage.buckets[purpose];
const PRIVATE_REF = /^storage:\/\/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/([A-Za-z0-9][A-Za-z0-9/_.-]{0,400})$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,400}$/;
const LOCAL_PRIVATE_DIR = path.join(UPLOAD_DIR, '.private');

const unavailable = () => new AppError(503, 'storage_unavailable', 'File storage is temporarily unavailable. Please try again in a few minutes.');

// ---- Supabase client ---------------------------------------------------------------------

let supabase = null;
function storageApi() {
  if (!supabase) {
    const timeoutMs = config.storage.timeoutMs;
    const timedFetch = (input, init = {}) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    };
    supabase = createClient(config.storage.supabaseUrl, config.storage.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: timedFetch },
    });
  }
  return supabase.storage;
}

/** Classify a storage-js error without leaking its text to visitors. */
function classify(err) {
  const status = Number(err?.status || err?.statusCode) || 0;
  const code = String(err?.code || err?.error || err?.statusCode || '');
  const msg = String(err?.message || '');
  if (/duplicate|already exists/i.test(msg) || code === '409' || status === 409) return 'duplicate';
  if (/NoSuchKey|not found/i.test(code + msg) && !/bucket/i.test(msg)) return 'not_found';
  if (/NoSuchBucket|bucket not found/i.test(code + msg)) return 'bucket_missing';
  if (status === 401 || status === 403 || /InvalidJWT|Unauthorized|permission|row-level security/i.test(code + msg)) return 'permission';
  if (status === 413 || /payload too large|maximum allowed size/i.test(msg)) return 'too_large';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(msg)) return 'timeout';
  if (!status || status >= 500) return 'unavailable';
  return 'rejected';
}

const RETRYABLE = new Set(['unavailable', 'timeout']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a storage call with at most two retries, only for transient failures. */
async function withRetry(op, fn) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await fn();
      if (!error) return data;
      last = error;
    } catch (err) {
      last = err;
    }
    const kind = classify(last);
    if (!RETRYABLE.has(kind) || attempt === 2) break;
    await sleep(250 * 2 ** attempt);
  }
  const kind = classify(last);
  const e = new Error(`storage ${op} failed: ${kind}`);
  e.kind = kind;
  throw e;
}

function toAppError(err, op) {
  const kind = err?.kind || classify(err);
  log.error('storage.failed', { op, kind });
  if (kind === 'too_large') return new AppError(413, 'file_too_large', 'That file is too large.');
  return unavailable();
}

// ---- Driver operations -------------------------------------------------------------------

function localFile(bucket, objectPath, visibility) {
  if (!SAFE_PATH.test(objectPath) || objectPath.includes('..')) throw new Error('unsafe object path');
  const base = visibility === 'private' ? path.join(LOCAL_PRIVATE_DIR, bucket) : UPLOAD_DIR;
  const full = path.resolve(base, objectPath);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error('unsafe object path');
  return full;
}

async function driverUpload(bucket, objectPath, buf, mime, visibility) {
  if (config.storage.driver === 'local') {
    const file = localFile(bucket, objectPath, visibility);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf, { flag: 'wx' });
    return;
  }
  try {
    // Public names are random and never reused, so they cache for a year. Private files must not
    // outlive their short signed link in a browser or CDN cache.
    const cacheControl = visibility === 'private' ? '0' : '31536000';
    await withRetry('upload', () => storageApi().from(bucket).upload(objectPath, buf, { contentType: mime, upsert: false, cacheControl }));
  } catch (err) {
    // A retry after a lost response can find our own object already there: accept it if the size matches.
    if (err.kind === 'duplicate') {
      const info = await driverInfo(bucket, objectPath, visibility).catch(() => null);
      if (info && Number(info.size) === buf.length) return;
    }
    throw err;
  }
}

async function driverInfo(bucket, objectPath, visibility) {
  if (config.storage.driver === 'local') {
    const file = localFile(bucket, objectPath, visibility);
    return fs.existsSync(file) ? { size: fs.statSync(file).size } : null;
  }
  try {
    return await withRetry('info', () => storageApi().from(bucket).info(objectPath));
  } catch (err) {
    if (err.kind === 'not_found') return null;
    throw err;
  }
}

async function driverDownload(bucket, objectPath, visibility) {
  if (config.storage.driver === 'local') return fs.readFileSync(localFile(bucket, objectPath, visibility));
  const blob = await withRetry('download', () => storageApi().from(bucket).download(objectPath));
  return Buffer.from(await blob.arrayBuffer());
}

async function driverRemove(bucket, objectPath, visibility) {
  if (config.storage.driver === 'local') {
    fs.rmSync(localFile(bucket, objectPath, visibility), { force: true });
    return;
  }
  await withRetry('remove', () => storageApi().from(bucket).remove([objectPath]));
}

// ---- References --------------------------------------------------------------------------

const publicBase = () => `${config.storage.supabaseUrl}/storage/v1/object/public/`;

/** The value stored in the database for an object. */
export function refFor(bucket, objectPath, visibility) {
  if (visibility === 'private') return `storage://${bucket}/${objectPath}`;
  if (config.storage.driver === 'local') return `/uploads/${objectPath}`;
  return `${publicBase()}${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Where a stored reference points: { bucket, path, visibility, driver } or null for anything else. */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null;
  const p = ref.match(PRIVATE_REF);
  if (p && !p[2].includes('..')) return { bucket: p[1], path: p[2], visibility: 'private' };
  if (config.storage.supabaseUrl && ref.startsWith(publicBase())) {
    const rest = ref.slice(publicBase().length);
    const slash = rest.indexOf('/');
    if (slash > 0) {
      const objectPath = decodeURIComponent(rest.slice(slash + 1));
      if (SAFE_PATH.test(objectPath) && !objectPath.includes('..')) return { bucket: rest.slice(0, slash), path: objectPath, visibility: 'public', driver: 'supabase' };
    }
    return null;
  }
  if (isLocalUpload(ref)) return { bucket: null, path: ref.slice('/uploads/'.length), visibility: 'public', driver: 'local' };
  return null;
}

/** The media_objects row for a reference (or, for an older `/uploads/...` file, its measured facts). */
export async function mediaInfo(ref, c = pool) {
  if (typeof ref !== 'string' || !ref) return null;
  const row = (await c.query('SELECT * FROM media_objects WHERE ref = $1 AND deleted_at IS NULL', [ref])).rows[0];
  if (row) return { ...row, duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds) };
  // Files uploaded before media_objects existed: measure them from disk (local store only).
  const file = localUploadPath(ref);
  if (!file) return null;
  const buf = fs.readFileSync(file);
  const type = sniff(buf);
  if (!type) return null;
  const dims = type.kind === 'image' ? imageDimensions(buf) : null;
  return {
    ref, legacy: true, visibility: 'public', kind: type.kind, mime: type.mime, bytes: buf.length,
    width: dims?.width || null, height: dims?.height || null, duration_seconds: type.kind === 'video' ? mp4DurationSeconds(buf) : null,
  };
}

/**
 * A URL a browser can load for this reference. Public references are returned unchanged. Private
 * ones become a signed URL valid for `seconds` (Supabase signed URL, or a signed /api/media link
 * for the local store). Callers must already have checked the viewer may see the file.
 */
export async function displayUrl(ref, { seconds = config.storage.signedUrlSeconds, c = pool } = {}) {
  const where = parseRef(ref);
  if (!where) return null;
  if (where.visibility === 'public') return ref;
  const row = (await c.query('SELECT driver FROM media_objects WHERE ref = $1 AND deleted_at IS NULL', [ref])).rows[0];
  if (!row) return null;
  if (row.driver === 'local') return localSignedUrl(ref, seconds);
  try {
    const data = await withRetry('sign', () => storageApi().from(where.bucket).createSignedUrl(where.path, seconds));
    return data.signedUrl;
  } catch (err) {
    log.warn('storage.sign_failed', { kind: err.kind });
    return null;
  }
}

// Local signed links: HMAC over ref + expiry with a key derived from the session secret.
const signingKey = () => crypto.createHash('sha256').update(`media-link:${config.jwtSecret}`).digest();
const linkSig = (ref, exp) => crypto.createHmac('sha256', signingKey()).update(`${ref}\n${exp}`).digest('base64url');

function localSignedUrl(ref, seconds) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `/api/media/signed?ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${linkSig(ref, exp)}`;
}

/** Verify a local signed link; returns { file, mime } or null. */
export async function openLocalSigned({ ref, exp, sig }, c = pool) {
  const e = Number(exp);
  if (!ref || !Number.isInteger(e) || e < Date.now() / 1000 || typeof sig !== 'string') return null;
  const expected = Buffer.from(linkSig(ref, e));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const row = (await c.query("SELECT bucket, object_path, mime FROM media_objects WHERE ref = $1 AND driver = 'local' AND visibility = 'private' AND deleted_at IS NULL", [ref])).rows[0];
  if (!row) return null;
  const file = localFile(row.bucket, row.object_path, 'private');
  return fs.existsSync(file) ? { file, mime: row.mime } : null;
}

// ---- Upload ------------------------------------------------------------------------------

/** Measure and validate a file for a purpose. Throws visitor-facing errors; never trusts names or MIME headers. */
export function inspect(buf, purpose, { enforceSize = true } = {}) {
  const spec = PURPOSES[purpose];
  if (!spec) throw new AppError(400, 'invalid_purpose', 'Unknown upload type');
  const type = sniff(buf);
  if (!type) throw new AppError(415, 'unsupported_file_type', 'Only JPG, PNG or WEBP images (and MP4/MOV video for staff) are accepted');
  if (!spec.kinds.includes(type.kind)) {
    throw new AppError(type.kind === 'video' ? 403 : 415, type.kind === 'video' ? 'video_upload_forbidden' : 'unsupported_file_type', type.kind === 'video' ? 'Video uploads are restricted to studio staff' : 'This upload must be a video');
  }
  // The migration copies files that were accepted under older limits, so it may skip the size cap.
  if (enforceSize && buf.length > spec.maxBytes) throw new AppError(413, 'file_too_large', `File exceeds the ${Math.round(spec.maxBytes / MB)} MB limit`);
  let dims = null;
  let duration = null;
  if (type.kind === 'image') {
    dims = imageDimensions(buf);
    if (!dims || !dims.width || !dims.height || dims.width > MAX_PIXELS_SIDE || dims.height > MAX_PIXELS_SIDE) {
      throw new AppError(422, 'unreadable_image', 'This image could not be read. Export it again as JPG, PNG or WEBP.');
    }
  } else {
    duration = mp4DurationSeconds(buf);
    if (duration === null) throw new AppError(422, 'unreadable_video', 'Could not read the video duration. Export as MP4 (H.264) and try again.');
  }
  return { ...type, width: dims?.width || null, height: dims?.height || null, duration, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/** A fresh, unguessable object path. The client never chooses any part of it. */
function newObjectPath(purpose, facts, ownerId) {
  const spec = PURPOSES[purpose];
  const ext = facts.ext;
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  // Local public files keep the flat `/uploads/<kind>_<time>_<hex>.<ext>` form older code expects.
  if (config.storage.driver === 'local' && spec.visibility === 'public') return `${facts.kind}_${Date.now()}_${name.slice(0, 16)}.${ext}`;
  const d = new Date();
  const month = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (purpose === 'evidence') return `${spec.folder}/${String(ownerId).replace(/[^A-Za-z0-9_-]/g, '')}/${name}`;
  return `${spec.folder}/${month}/${name}`;
}

const viewOf = async (row, c) => ({
  ref: row.ref,
  url: await displayUrl(row.ref, { c }),
  purpose: row.purpose,
  kind: row.kind,
  mime: row.mime,
  bytes: Number(row.bytes),
  width: row.width,
  height: row.height,
  duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
});

/**
 * Validate and store a file. An identical file uploaded again for the same purpose and owner
 * returns the existing object instead of a duplicate. If the metadata row cannot be written, the
 * uploaded object is removed again, so a failure leaves nothing behind.
 */
export async function putObject({ purpose, buffer, ownerId = null, uploadedBy = null, c = pool, inspected = null, objectPath = null, legacyUrl = null }) {
  const spec = PURPOSES[purpose];
  const facts = inspected || inspect(buffer, purpose);
  const driver = config.storage.driver;
  const bucket = bucketFor(purpose);

  const existing = (await c.query(
    'SELECT * FROM media_objects WHERE sha256 = $1 AND purpose = $2 AND owner_id IS NOT DISTINCT FROM $3 AND driver = $4 AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
    [facts.sha256, purpose, ownerId, driver]
  )).rows[0];
  if (existing && !objectPath) return { ...(await viewOf(existing, c)), deduplicated: true };

  const key = objectPath || newObjectPath(purpose, facts, ownerId);
  try {
    await driverUpload(bucket, key, buffer, facts.mime, spec.visibility);
  } catch (err) {
    throw toAppError(err, 'upload');
  }
  const ref = refFor(bucket, key, spec.visibility);
  try {
    const row = (await c.query(
      `INSERT INTO media_objects (driver, bucket, object_path, visibility, purpose, ref, kind, mime, bytes, width, height, duration_seconds, sha256, owner_id, uploaded_by, legacy_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (driver, bucket, object_path) DO UPDATE SET deleted_at = NULL RETURNING *`,
      [driver, bucket, key, spec.visibility, purpose, ref, facts.kind, facts.mime, buffer.length, facts.width, facts.height, facts.duration, facts.sha256, ownerId, uploadedBy, legacyUrl]
    )).rows[0];
    log.info('storage.stored', { driver, bucket, purpose, bytes: buffer.length, by: uploadedBy || 'system' });
    forgetServable();
    return { ...(await viewOf(row, c)), deduplicated: false };
  } catch (err) {
    // Compensation: the file must not outlive a failed metadata write.
    if (!objectPath) await driverRemove(bucket, key, spec.visibility).catch(() => log.error('storage.compensation_failed', { bucket }));
    log.error('storage.metadata_failed', { message: err.message });
    throw unavailable();
  }
}

// ---- Public access to the local store ---------------------------------------------------

// `/uploads/<name>` serves only files the application still uses: registered local public uploads
// and files a record references. Orphans and the originals kept for rollback stay on disk but are
// not public. Answers are cached briefly; a store or delete clears the cache.
const SERVABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const servableCache = new Map();
const SERVABLE_TTL_MS = 60_000;
const UNSERVABLE_TTL_MS = 5_000;
const forgetServable = () => servableCache.clear();

export async function isServableUpload(name, c = pool) {
  if (typeof name !== 'string' || !SERVABLE_NAME.test(name) || name.includes('..')) return false;
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const cached = servableCache.get(name);
  if (cached && cached.until > Date.now()) return cached.ok;
  const ref = `/uploads/${name}`;
  const registered = (await c.query("SELECT 1 FROM media_objects WHERE ref = $1 AND driver = 'local' AND visibility = 'public' AND deleted_at IS NULL", [ref])).rowCount > 0;
  const ok = registered || (await countReferences(c, ref)).total > 0;
  servableCache.set(name, { ok, until: Date.now() + (ok ? SERVABLE_TTL_MS : UNSERVABLE_TTL_MS) });
  return ok;
}

// ---- Existence, download, deletion -------------------------------------------------------

/** Does the object behind a reference exist? Throws (503) when storage cannot be reached. */
export async function objectExists(ref, c = pool) {
  const info = await mediaInfo(ref, c);
  if (!info) return false;
  if (info.legacy) return true;
  try {
    return Boolean(await driverInfo(info.bucket, info.object_path, info.visibility));
  } catch (err) {
    throw toAppError(err, 'info');
  }
}

/** The bytes of a stored object (used by the migration to verify copies). */
export async function readObject(bucket, objectPath, visibility) {
  return driverDownload(bucket, objectPath, visibility);
}

/**
 * Delete the object behind `ref`, but only when no database row still references it. Call this
 * after the transaction that dropped the reference has committed, so a rolled-back change can
 * never leave a row pointing at a deleted file.
 */
export async function safeDelete(ref, { actor = null, c = pool } = {}) {
  const refs = await countReferences(c, ref);
  if (refs.total > 0) {
    log.info('storage.delete_skipped', { reason: 'referenced', where: Object.keys(refs.by) });
    return { deleted: false, reason: 'referenced', references: refs.by };
  }
  const row = (await c.query('SELECT * FROM media_objects WHERE ref = $1 AND deleted_at IS NULL', [ref])).rows[0];
  try {
    if (row) {
      if (row.driver === config.storage.driver) await driverRemove(row.bucket, row.object_path, row.visibility);
      await c.query('UPDATE media_objects SET deleted_at = now() WHERE id = $1', [row.id]);
    } else if (localUploadPath(ref)) {
      fs.rmSync(localUploadPath(ref), { force: true });
    } else {
      return { deleted: false, reason: 'unknown' };
    }
  } catch (err) {
    log.error('storage.delete_failed', { kind: err.kind || classify(err), actor });
    return { deleted: false, reason: 'storage_error' };
  }
  forgetServable();
  log.info('storage.deleted', { bucket: row?.bucket || 'local', purpose: row?.purpose || 'legacy', actor });
  return { deleted: true };
}

/** Every object path in a bucket (walks folders). Used by the orphan scanner. */
export async function listObjects(bucket, visibility) {
  if (config.storage.driver === 'local') {
    const base = visibility === 'private' ? path.join(LOCAL_PRIVATE_DIR, bucket) : UPLOAD_DIR;
    if (!fs.existsSync(base)) return [];
    const out = [];
    const walk = (dir, prefix) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else out.push(`${prefix}${e.name}`);
      }
    };
    walk(base, '');
    return out;
  }
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 1000) {
      const page = await withRetry('list', () => storageApi().from(bucket).list(prefix, { limit: 1000, offset }));
      for (const e of page) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) await walk(full);
        else out.push(full);
      }
      if (page.length < 1000) break;
    }
  };
  await walk('');
  return out;
}

// ---- Buckets and status ------------------------------------------------------------------

const MIME = { image: ['image/jpeg', 'image/png', 'image/webp'], video: ['video/mp4', 'video/quicktime'] };

/** The bucket layout this application expects. */
export function bucketPlan() {
  const byBucket = new Map();
  for (const [purpose, spec] of Object.entries(PURPOSES)) {
    const id = bucketFor(purpose);
    const b = byBucket.get(id) || { id, public: spec.visibility === 'public', fileSizeLimit: 0, allowedMimeTypes: new Set(), purposes: [] };
    b.fileSizeLimit = Math.max(b.fileSizeLimit, spec.maxBytes);
    spec.kinds.forEach((k) => MIME[k].forEach((m) => b.allowedMimeTypes.add(m)));
    b.purposes.push(purpose);
    byBucket.set(id, b);
  }
  return [...byBucket.values()].map((b) => ({ ...b, allowedMimeTypes: [...b.allowedMimeTypes] }));
}

/**
 * Check (and with `fix`, create or correct) the Supabase buckets. Returns one line per bucket.
 * Never deletes a bucket or its contents.
 */
export async function ensureBuckets({ fix = false } = {}) {
  if (config.storage.driver !== 'supabase') return bucketPlan().map((b) => ({ id: b.id, status: 'local store' }));
  const api = storageApi();
  const out = [];
  for (const b of bucketPlan()) {
    const opts = { public: b.public, fileSizeLimit: b.fileSizeLimit, allowedMimeTypes: b.allowedMimeTypes };
    const { data, error } = await api.getBucket(b.id);
    if (error || !data) {
      if (!fix) {
        out.push({ id: b.id, status: 'missing' });
        continue;
      }
      const r = await api.createBucket(b.id, opts);
      out.push({ id: b.id, status: r.error ? `create failed (${classify(r.error)})` : 'created' });
      continue;
    }
    const wrongVisibility = Boolean(data.public) !== b.public;
    if (wrongVisibility && fix) {
      const r = await api.updateBucket(b.id, opts);
      out.push({ id: b.id, status: r.error ? `update failed (${classify(r.error)})` : 'visibility corrected' });
    } else {
      out.push({ id: b.id, status: wrongVisibility ? `WRONG VISIBILITY (is ${data.public ? 'public' : 'private'})` : 'ok' });
    }
  }
  return out;
}

/** Admin Settings summary. Contains no keys or internal paths. */
export function storageSummary() {
  return {
    driver: config.storage.driver,
    provider: config.storage.driver === 'supabase' ? 'Supabase Storage' : 'Local disk (development)',
    buckets: bucketPlan().map((b) => ({ id: b.id, access: b.public ? 'public' : 'private (signed links)', purposes: b.purposes })),
    signed_url_seconds: config.storage.signedUrlSeconds,
    limits: { customer_image_mb: PURPOSES.evidence.maxBytes / MB, admin_image_mb: PURPOSES.product.maxBytes / MB, video_mb: PURPOSES.video.maxBytes / MB },
  };
}
