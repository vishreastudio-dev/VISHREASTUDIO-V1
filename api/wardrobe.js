import { db } from '../lib/db.js';
import { AppError, badRequest, notFound } from '../lib/http.js';
import { bagView, confirmBagPayment, shipBag } from '../lib/bag.js';
import { getOrCreateCartId } from '../lib/cart.js';
import { isCreditEligible } from '../lib/pricing.js';
import { addLine, cartView, setLineReward } from './cart.js';
import { isRewardEligible } from '../lib/rewards.js';
import { getSettings } from '../lib/settings.js';
import { oneOf, uuid } from '../lib/validate.js';
import { creditsBlockedMessage, creditsUsable } from '../lib/billing.js';
import { issueLocalOrderPayment } from '../lib/local-pay.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 60 };

async function view(uid) {
  const [items, rewards, membership, settings] = await Promise.all([
    db.query(
      `SELECT w.product_id, w.saved_at, p.name, p.slug, p.image_url, p.images, p.badge, p.is_one_of_one, p.credit_eligible, p.category_id, p.is_active,
              COALESCE((SELECT json_agg(json_build_object('id', v.id, 'size_label', v.size_label, 'price_inr', v.price_inr, 'sale_price_inr', v.sale_price_inr,
                                                          'in_stock', v.stock_quantity > 0) ORDER BY v.sort_order, v.created_at)
                          FROM product_variants v WHERE v.product_id = p.id AND v.is_active), '[]') AS variants
         FROM wardrobe_items w JOIN products p ON p.id = w.product_id
        WHERE w.auth_user_id = $1 ORDER BY w.saved_at DESC LIMIT 100`,
      [uid]
    ),
    db.query("SELECT id, kind, status, milestone_number, order_id, created_at, redeemed_at FROM reward_entitlements WHERE auth_user_id = $1 AND status <> 'void' ORDER BY created_at DESC", [uid]),
    db.query('SELECT status, credits_balance FROM memberships WHERE auth_user_id = $1', [uid]),
    getSettings(),
  ]);
  return {
    items: items.rows.map((r) => ({
      product_id: r.product_id,
      saved_at: r.saved_at,
      name: r.name,
      slug: r.slug,
      image_url: r.image_url || (Array.isArray(r.images) ? r.images[0] : null) || null,
      badge: r.badge,
      is_one_of_one: r.is_one_of_one,
      available: r.is_active && r.variants.some((v) => v.in_stock),
      credit_eligible: isCreditEligible(r),
      // Per size, because an optional price limit can make one size eligible and another not.
      reward_variant_ids: r.variants.filter((v) => isRewardEligible({ ...v, product_id: r.product_id, category_id: r.category_id }, settings)).map((v) => v.id),
      variants: r.variants,
    })),
    rewards: rewards.rows,
    membership: membership.rows[0] || { status: 'inactive', credits_balance: 0 },
    bag: await bagView(db, uid),
  };
}

export default async function wardrobe(req, res) {
  const uid = req.user.id;
  const b = req.body || {};

  if (req.method === 'POST' && b.action === 'save') {
    const productId = uuid(b.product_id, 'product_id');
    const r = await db.query(
      'INSERT INTO wardrobe_items (auth_user_id, product_id) SELECT $1, id FROM products WHERE id = $2 AND is_active AND archived_at IS NULL ON CONFLICT (auth_user_id, product_id) DO NOTHING RETURNING id',
      [uid, productId]
    );
    if (!r.rows[0] && !(await db.query('SELECT 1 FROM wardrobe_items WHERE auth_user_id = $1 AND product_id = $2', [uid, productId])).rows[0]) {
      throw notFound('product_unavailable', 'This piece is no longer available');
    }
  } else if (req.method === 'POST' && b.action === 'add_to_bag') {
    // Move a saved piece into the bag, optionally paying with a credit or a free-piece reward.
    const variantId = uuid(b.variant_id, 'variant_id');
    const use = oneOf(b.use, ['none', 'credit', 'reward'], { field: 'use', fallback: 'none' });
    await db.tx(async (c) => {
      const cartId = await getOrCreateCartId(c, uid);
      await addLine(c, cartId, { variant_id: variantId, quantity: 1 });
      const line = (await c.query(
        `SELECT ci.id, ci.reward_entitlement_id, ci.product_id, p.badge, p.credit_eligible, p.category_id, v.price_inr, v.sale_price_inr
           FROM cart_items ci JOIN products p ON p.id = ci.product_id JOIN product_variants v ON v.id = ci.variant_id
          WHERE ci.cart_id = $1 AND ci.variant_id = $2`,
        [cartId, variantId]
      )).rows[0];
      if (use === 'credit') {
        if (!isCreditEligible(line)) throw badRequest('premium_cannot_use_credit', 'This piece is not eligible for wardrobe credits');
        const m = (await c.query('SELECT status, billing_status FROM memberships WHERE auth_user_id = $1', [uid])).rows[0];
        if (!creditsUsable(m)) throw badRequest('membership_not_active', creditsBlockedMessage(m));
        await c.query('UPDATE cart_items SET use_credit = true, reward_entitlement_id = NULL, quantity = 1 WHERE id = $1', [line.id]);
      } else if (use === 'reward') {
        await setLineReward(c, uid, line, uuid(b.reward_entitlement_id, 'reward_entitlement_id'));
      }
    });
    return res.json({ ...(await view(uid)), cart: await cartView(uid) });
  } else if (req.method === 'POST' && b.action === 'ship_bag') {
    const r = await shipBag(req.user, b);
    return res.json({ ...r, ...(await view(uid)) });
  } else if (req.method === 'POST' && b.action === 'complete_local') {
    const s = (await db.query('SELECT * FROM bag_shipments WHERE id = $1 AND auth_user_id = $2', [uuid(b.shipment_id, 'shipment_id'), uid])).rows[0];
    if (!s) throw notFound('bag_shipment_not_found', 'No Wardrobe Bag shipment found for this payment');
    return res.json(await issueLocalOrderPayment({ gatewayOrderId: s.razorpay_order_id, amountPaise: s.amount_paise, outcome: b.outcome }));
  } else if (req.method === 'POST' && b.action === 'confirm_bag_payment') {
    const r = await confirmBagPayment(req.user, b);
    if (r.status === 'pending_confirmation') throw new AppError(503, 'payment_confirmation_pending', 'Your payment is being confirmed. Refresh in a moment — you will not be charged twice.');
    return res.json({ ok: true, ...(await view(uid)) });
  } else if (req.method === 'POST') {
    throw badRequest('unsupported_action', 'Unsupported wardrobe action');
  }

  if (req.method === 'DELETE') {
    await db.query('DELETE FROM wardrobe_items WHERE auth_user_id = $1 AND product_id = $2', [uid, uuid(b.product_id, 'product_id')]);
  }
  res.json(await view(uid));
}
