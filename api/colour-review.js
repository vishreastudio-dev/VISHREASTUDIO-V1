import { db } from '../lib/db.js';
import { badRequest } from '../lib/http.js';
import { text } from '../lib/validate.js';

export const access = 'user';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 30 };

const cleanHex = (value) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : null);

/** The eight seasons the on-device engine can return (vishrea-react/src/lib/colourEngine.js). */
export const COLOUR_SEASONS = ['Light Spring', 'True Autumn', 'Soft Autumn', 'Deep Autumn', 'Light Summer', 'Soft Summer', 'True Winter', 'Deep Winter'];
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

// Only derived colour attributes are accepted. Any image-like field is rejected outright so a
// client bug can never persist a photograph.
const FORBIDDEN_FIELDS = ['image', 'photo', 'selfie', 'frame', 'data_url', 'raw_image', 'raw_image_key'];

export default async function colourReview(req, res) {
  const uid = req.user.id;
  if (req.method === 'POST') {
    const b = req.body || {};
    if (FORBIDDEN_FIELDS.some((f) => b[f] !== undefined)) throw badRequest('raw_image_not_accepted', 'Only derived colour attributes may be saved');
    const palette = Array.isArray(b.palette) ? b.palette.map(cleanHex).filter(Boolean).slice(0, 8) : [];
    const undertone = text(b.undertone, { max: 40, field: 'undertone', required: true });
    if (palette.length < 3) throw badRequest('invalid_colour_review', 'A palette of at least three colours is required');
    const season = b.season === undefined || b.season === null || b.season === '' ? null : COLOUR_SEASONS.find((s) => s.toLowerCase() === String(b.season).toLowerCase());
    if (season === undefined) throw badRequest('invalid_season', 'Unknown colour season');
    const r = await db.query(
      `INSERT INTO colour_reviews (auth_user_id, undertone, palette, source, model_version, confidence, quality_score, lighting, raw_image_key, season)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)
       RETURNING id, undertone, season, palette, source, model_version, confidence, quality_score, lighting, created_at`,
      [uid, undertone, JSON.stringify(palette), text(b.source, { max: 40, field: 'source' }) || 'on_device',
       text(b.model_version, { max: 80, field: 'model_version' }) || 'vishrea-colour-engine', clamp(b.confidence, 0, 1), clamp(b.quality_score, 0, 100),
       text(b.lighting, { max: 40, field: 'lighting' }) || 'balanced', season]
    );
    return res.status(201).json({ review: r.rows[0] });
  }
  const r = await db.query(
    'SELECT id, undertone, season, palette, source, model_version, confidence, quality_score, lighting, created_at FROM colour_reviews WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [uid]
  );
  res.json({ review: r.rows[0] || null });
}
