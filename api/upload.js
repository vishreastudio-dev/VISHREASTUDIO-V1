import express from 'express';
import { AppError, h } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { decodeDataPayload, sniff } from '../lib/uploads.js';
import { CUSTOMER_VIDEO_CAP } from '../lib/settings.js';
import { PURPOSES, inspect, putObject } from '../lib/storage.js';

const router = express.Router();

const ADMIN_PURPOSES = ['product', 'banner', 'instagram', 'video'];
const MAX_REQUEST_BYTES = Math.ceil(PURPOSES.video.maxBytes * 1.4) + 4096; // base64 overhead

/**
 * Upload one file. Signed-in customers may only upload exchange/damage evidence, which is stored
 * privately and owned by them; staff choose a purpose (product, banner, instagram, video). The file
 * type comes from the bytes, never from the filename or MIME header, and the stored name is random.
 * Returns `ref` (the value to save) and `url` (a URL that can be displayed now).
 */
router.post(
  '/',
  (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'unauthorized', 'Please sign in to upload files'));
    const max = req.user.is_admin ? MAX_REQUEST_BYTES : Math.ceil(PURPOSES.evidence.maxBytes * 1.4) + 4096;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > max) return next(new AppError(413, 'file_too_large', 'File is too large'));
    next();
  },
  rateLimit({ name: 'upload', windowMs: 60 * 60_000, max: 20, key: (req) => `${req.user.is_admin ? 'admin' : 'user'}:${req.user.id}` }),
  express.json({ limit: MAX_REQUEST_BYTES }),
  h(async (req, res) => {
    const { image, video, file, purpose: asked } = req.body || {};
    const buf = decodeDataPayload(video || image || file);
    if (!buf || !buf.length) throw new AppError(400, 'file_required', 'No file data provided');

    const isAdmin = Boolean(req.user.is_admin);
    let purpose;
    if (!isAdmin) {
      if (asked !== undefined && asked !== 'evidence') throw new AppError(403, 'upload_forbidden', 'You can only upload photos for an exchange or damage report');
      purpose = 'evidence';
    } else if (asked !== undefined) {
      if (!ADMIN_PURPOSES.includes(asked)) throw new AppError(400, 'invalid_purpose', `Upload purpose must be one of: ${ADMIN_PURPOSES.join(', ')}`);
      purpose = asked;
    } else {
      // Older admin screens send no purpose: video is a customer video, an image a product photo.
      purpose = sniff(buf)?.kind === 'video' ? 'video' : 'product';
    }

    const facts = inspect(buf, purpose);
    if (facts.kind === 'video' && facts.duration > CUSTOMER_VIDEO_CAP.max_video_seconds + 0.05) {
      throw new AppError(422, 'video_too_long', `Customer videos must be ${CUSTOMER_VIDEO_CAP.max_video_seconds} seconds or shorter (this one is ${facts.duration}s)`);
    }

    const stored = await putObject({ purpose, buffer: buf, inspected: facts, ownerId: purpose === 'evidence' ? req.user.id : null, uploadedBy: req.user.id });
    res.status(stored.deduplicated ? 200 : 201).json({ ok: true, ...stored });
  })
);

export default router;
