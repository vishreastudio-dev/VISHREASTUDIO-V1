import { db } from '../lib/db.js';

export const access = 'public';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60_000, max: 60 };

/**
 * Handles:
 * - GET /api/offers/my-offers: lists assigned VIP offers for the logged in user
 * - POST /api/offers/validate: validates any promo/offer code with customer eligibility & redemption checks
 */
export default async function offers(req, res) {
  const user = req.user || null;
  const isValidate = req.path.endsWith('/validate') || req.method === 'POST';

  if (isValidate) {
    const rawCode = req.body?.code || req.query?.code;
    if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
      return res.status(400).json({
        valid: false,
        error: 'code_required',
        message: 'Please enter a promo or offer code.',
      });
    }

    const cleanCode = rawCode.trim().toUpperCase();

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

    // Edge Case: Check if offer was distributed to specific customers in loyalty_events
    const targeted = await db.query(
      `SELECT auth_user_id FROM loyalty_events
       WHERE event_type = 'special_offer_distributed' AND upper(details->>'code') = $1
       LIMIT 20`,
      [cleanCode]
    );

    if (targeted.rows.length > 0) {
      if (!user) {
        return res.status(401).json({
          valid: false,
          error: 'login_required',
          message: 'This is an exclusive private privilege. Please sign in to your account to redeem it.',
        });
      }

      const isRecipient = targeted.rows.some((r) => r.auth_user_id === user.id);
      if (!isRecipient) {
        return res.status(403).json({
          valid: false,
          error: 'exclusive_offer',
          message: 'This exclusive studio privilege is reserved for another client account.',
        });
      }
    }

    // Edge Case: Check if the customer has already redeemed this offer
    if (user) {
      const redeemed = await db.query(
        `SELECT 1 FROM loyalty_events
         WHERE auth_user_id = $1 AND event_type = 'special_offer_redeemed' AND upper(details->>'code') = $2
         LIMIT 1`,
        [user.id, cleanCode]
      );

      if (redeemed.rows.length > 0) {
        return res.status(400).json({
          valid: false,
          error: 'offer_already_redeemed',
          message: 'You have already redeemed this studio privilege on a previous order.',
        });
      }
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

  // Edge Case: Include redemption status and check case-insensitively
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
       o.created_at,
       CASE WHEN red.id IS NOT NULL THEN true ELSE false END AS is_redeemed
     FROM offers o
     JOIN loyalty_events le ON upper(le.details->>'code') = upper(o.code) AND le.auth_user_id = $1
     LEFT JOIN loyalty_events red ON red.auth_user_id = $1
       AND red.event_type = 'special_offer_redeemed'
       AND upper(red.details->>'code') = upper(o.code)
     WHERE o.active = true
       AND (o.ends_at IS NULL OR o.ends_at > now())
       AND (o.starts_at IS NULL OR o.starts_at <= now())
     ORDER BY o.code, o.created_at DESC`,
    [user.id]
  );

  return res.json({ offers: result.rows || [] });
}
