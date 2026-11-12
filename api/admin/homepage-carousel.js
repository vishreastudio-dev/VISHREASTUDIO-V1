import { db } from '../../lib/db.js';
import { badRequest } from '../../lib/http.js';
import { bool } from '../../lib/validate.js';
import {
  adminCarousel,
  createSlide,
  deleteSlide,
  duplicateSlide,
  publishSlide,
  reorderSlides,
  saveCarouselSettings,
  setSlideActive,
  unpublishSlide,
  updateSlide,
} from '../../lib/carousel.js';

export const access = 'admin';
export const methods = ['GET', 'POST', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 120 };

const ACTIONS = {
  create: (c, uid, b) => createSlide(c, uid, b.slide),
  update: (c, uid, b) => updateSlide(c, uid, b.id, b.slide, { version: b.version, publish: bool(b.publish) }),
  publish: (c, uid, b) => publishSlide(c, uid, b.id, { version: b.version }),
  unpublish: (c, uid, b) => unpublishSlide(c, uid, b.id),
  activate: (c, uid, b) => setSlideActive(c, uid, b.id, b.is_active),
  duplicate: (c, uid, b) => duplicateSlide(c, uid, b.id),
  reorder: (c, uid, b) => reorderSlides(c, uid, b.ids),
  settings: (c, uid, b) => saveCarouselSettings(c, uid, b.settings),
};

// Every write runs in one transaction; a successful response also clears the public cache
// (see the /api/admin middleware in server.js), so a publish is visible on the next homepage load.
export default async function homepageCarouselAdmin(req, res) {
  const uid = req.user.id;
  if (req.method === 'GET') return res.json(await adminCarousel(db));
  if (req.method === 'DELETE') {
    const q = req.query || {};
    return res.json({ ok: true, ...(await db.tx((c) => deleteSlide(c, uid, q.id, { confirmed: bool(q.confirm) }))) });
  }
  const b = req.body || {};
  const run = ACTIONS[b.action];
  if (!run) throw badRequest('unknown_action', 'Unknown carousel action');
  const result = await db.tx((c) => run(c, uid, b));
  res.status(b.action === 'create' || b.action === 'duplicate' ? 201 : 200).json({ ok: true, result });
}
