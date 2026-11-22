import { db } from '../lib/db.js';
import { text } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/http.js';

export const access = 'public';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60_000, max: 60 };

/**
 * Handles:
 * - GET /api/offers/my-offers: lists assigned VIP offers for the logged in user
 * - POST /api/offers/validate: validates any promo/offer code
 */
export default async function offers(req, res) {
  const user = req.user || null;
  const isValidate = req.path.endsWith('/validate') || req.method === 'POST';

  if (isValidate) {
    const rawCode = req.body?.code || req.query?.code;
    const cleanCode = text(rawCode, { max: 40, field: 'code', required: true }).trim().toUpperCase();

    const result = await db.query(
      `SELECT id, code, title, description, discount_type, discount_value, active, starts_at, ends_at
       FROM offers
       WHERE upper(code) = $1
         AND active = true
         AND (ends_at IS NULL OR ends_at > now())
         AND (starts_at IS NULL OR starts_at <= now())
       LIMIT 1`,
      [cleanCode]
    );

    const offer = result.rows[0];
    if (!offer) {
      return res.status(404).json({
        valid: false,
        error: 'invalid_offer_code',
        message: 'The promo code entered is invalid or has expired.',
      });
    }

    return res.json({
      valid: true,
      offer: {
        id: offer.id,
        code: offer.code,
        title: offer.title,
        description: offer.description,
        discount_type: offer.discount_type,
        discount_value: Number(offer.discount_value),
        ends_at: offer.ends_at,
      },
    });
  }

  // GET /api/offers/my-offers (or GET /api/offers)
  if (!user) {
    return res.json({ offers: [] });
  }

  const result = await db.query(
    `SELECT DISTINCT ON (o.code)
       o.id,
       o.code,
       o.title,
       o.description,
       o.discount_type,
       o.discount_value,
       o.starts_at,
       o.ends_at,
       o.created_at
     FROM offers o
     LEFT JOIN loyalty_events le ON (le.details->>'code') = o.code AND le.auth_user_id = $1
     WHERE o.active = true
       AND (o.ends_at IS NULL OR o.ends_at > now())
       AND (o.starts_at IS NULL OR o.starts_at <= now())
       AND (le.auth_user_id IS NOT NULL OR le.id IS NOT NULL)
     ORDER BY o.code, o.created_at DESC`,
    [user.id]
  );

  return res.json({ offers: result.rows || [] });
}
