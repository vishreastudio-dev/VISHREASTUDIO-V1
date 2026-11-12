import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { isLocalUpload } from './validate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const UPLOAD_DIR = config.uploadsDir ? path.resolve(config.uploadsDir) : path.join(root, 'public', 'uploads');

export const LIMITS = {
  publicImageBytes: 5 * 1024 * 1024,
  adminImageBytes: 10 * 1024 * 1024,
  adminVideoBytes: 40 * 1024 * 1024,
};

/** Detect the real file type from its leading bytes. SVG/HTML/scripts are never accepted. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (/^(heic|heix|mif1|msf1|avif)/.test(brand)) return null;
    return brand === 'qt  ' ? { kind: 'video', ext: 'mov', mime: 'video/quicktime' } : { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  return null;
}

/** Read the movie duration (seconds) from an ISO-BMFF (MP4/MOV) `moov/mvhd` box. */
export function mp4DurationSeconds(buf) {
  function boxes(start, end) {
    const out = [];
    let off = start;
    while (off + 8 <= end) {
      let size = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      let header = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = Number(buf.readBigUInt64BE(off + 8));
        header = 16;
      } else if (size === 0) {
        size = end - off;
      }
      if (size < header || off + size > end) break;
      out.push({ type, start: off + header, end: off + size });
      off += size;
    }
    return out;
  }
  const moov = boxes(0, buf.length).find((b) => b.type === 'moov');
  if (!moov) return null;
  const mvhd = boxes(moov.start, moov.end).find((b) => b.type === 'mvhd');
  if (!mvhd) return null;
  const version = buf[mvhd.start];
  let timescale;
  let duration;
  if (version === 1) {
    timescale = buf.readUInt32BE(mvhd.start + 20);
    duration = Number(buf.readBigUInt64BE(mvhd.start + 24));
  } else {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    duration = buf.readUInt32BE(mvhd.start + 16);
  }
  if (!timescale) return null;
  return Math.round((duration / timescale) * 100) / 100;
}

/** Pixel size of a JPEG, PNG or WEBP from its headers, or null when it cannot be read. */
export function imageDimensions(buf) {
  const type = sniff(buf);
  if (!type || type.kind !== 'image') return null;
  if (type.ext === 'png') return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
  if (type.ext === 'webp') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0-SOF15, except DHT/JPG/DAC).
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
    }
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

/** Dimensions of a stored `/uploads/...` image, or null if it is missing or not an image. */
export function imageDimensionsForUrl(url) {
  const p = localUploadPath(url);
  if (!p) return null;
  const fd = fs.openSync(p, 'r');
  try {
    // Headers sit near the start; large EXIF blocks can push a JPEG frame header past 64 KB.
    const size = Math.min(fs.fstatSync(fd).size, 1024 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return imageDimensions(buf);
  } finally {
    fs.closeSync(fd);
  }
}

export function decodeDataPayload(payload) {
  if (typeof payload !== 'string' || !payload) return null;
  const m = payload.match(/^data:[a-z0-9.+/-]+;base64,(.+)$/i);
  const b64 = m ? m[1] : payload;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) return null;
  return Buffer.from(b64, 'base64');
}

export const ACCEPTED_UPLOAD_TYPES = { image: ['jpg', 'png', 'webp'], video: ['mp4', 'mov'] };

/**
 * Upload storage health for the admin Settings screen (BD-7). Reports whether a dedicated
 * UPLOADS_DIR is configured and usable; never the server's absolute path.
 */
export function storageStatus() {
  const configured = Boolean(config.uploadsDir);
  const out = {
    location: configured ? 'UPLOADS_DIR (dedicated directory)' : 'public/uploads inside the app folder',
    dedicated_directory: configured,
    exists: false,
    writable: false,
    file_count: 0,
    total_bytes: 0,
    orphan_cleanup_days: Number(process.env.UPLOAD_ORPHAN_CLEANUP_DAYS || 0) || null,
    limits: { public_image_mb: LIMITS.publicImageBytes / 1048576, admin_image_mb: LIMITS.adminImageBytes / 1048576, admin_video_mb: LIMITS.adminVideoBytes / 1048576 },
    accepted_types: ACCEPTED_UPLOAD_TYPES,
  };
  try {
    out.exists = fs.statSync(UPLOAD_DIR).isDirectory();
  } catch {
    return { ...out, warning: 'The upload directory does not exist yet; it is created on the first upload.' };
  }
  try {
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
    out.writable = true;
  } catch {
    out.warning = 'The upload directory is not writable; uploads will fail.';
  }
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    try {
      const st = fs.statSync(path.join(UPLOAD_DIR, name));
      if (st.isFile()) {
        out.file_count += 1;
        out.total_bytes += st.size;
      }
    } catch {
      /* removed while counting */
    }
  }
  if (!configured && !out.warning) out.warning = 'Uploads are stored inside the app folder. Set UPLOADS_DIR to a persistent disk so files survive redeploys.';
  return out;
}

/** Resolve a `/uploads/...` URL to a file path inside UPLOAD_DIR, or null. */
export function localUploadPath(url) {
  if (!isLocalUpload(url)) return null;
  const p = path.join(UPLOAD_DIR, path.basename(url));
  return p.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(p) ? p : null;
}

let lastCleanup = 0;

/**
 * Local development store only: remove `/uploads/...` files that no record references once they are
 * older than UPLOAD_ORPHAN_CLEANUP_DAYS. Disabled unless that variable is set; runs at most every
 * 6 hours. Supabase Storage is never cleaned automatically; use `npm run media:orphans` (dry run).
 */
export async function cleanOrphanUploads({ force = false } = {}) {
  if (config.storage.driver !== 'local') return 0;
  const days = Number(process.env.UPLOAD_ORPHAN_CLEANUP_DAYS || 0);
  if (!days || days < 1) return 0;
  if (!force && Date.now() - lastCleanup < 6 * 3_600_000) return 0;
  lastCleanup = Date.now();
  if (!fs.existsSync(UPLOAD_DIR)) return 0;
  const { db } = await import('./db.js');
  const { allReferencedValues } = await import('./media-references.js');
  const referenced = new Set([...(await allReferencedValues(db))].filter(isLocalUpload).map((u) => path.basename(u)));
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (!/^(image|video)_\d+_[a-f0-9]{16}\.[a-z0-9]+$/.test(name) || referenced.has(name)) continue;
    const p = path.join(UPLOAD_DIR, name);
    const st = fs.statSync(p);
    if (st.isFile() && st.mtimeMs < cutoff) {
      fs.rmSync(p, { force: true });
      removed += 1;
    }
  }
  return removed;
}
