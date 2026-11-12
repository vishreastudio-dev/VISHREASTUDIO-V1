import { db } from '../lib/db.js';
import { cachedPublicCarousel } from '../lib/carousel.js';

export const access = 'public';
export const methods = ['GET'];

/** Published hero slides and carousel settings in one response. Drafts are never included. */
export default async function homepageCarousel(req, res) {
  const r = await cachedPublicCarousel(db);
  res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
  // Shorter than other public content so a publish reaches visitors quickly.
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json(r.value);
}
