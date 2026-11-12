import { db } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { getOrCreateCartId, isDropLocked, loadCartLines } from '../lib/cart.js';
import { calculateCartPrice, calculateProductPrice, isCreditEligible } from '../lib/pricing.js';
import { isRewardEligible, rewardIneligibleMessage } from '../lib/rewards.js';
import { getSettings } from '../lib/settings.js';
import { bool, int, isUuid, uuid } from '../lib/validate.js';
import { creditsBlockedMessage, creditsUsable } from '../lib/billing.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'PATCH', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 120 };

const MAX_LINES = 30;

async function resolveVariant(client, { variant_id, product_id }) {
  if (variant_id) {
    const r = await client.query(
      `SELECT v.*, p.is_one_of_one, p.is_active AS product_active, p.name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
      [uuid(variant_id, 'variant_id')]
    );
    return r.rows[0] || null;
  }
  if (product_id && isUuid(product_id)) {
    // Legacy clients: only unambiguous when the product has exactly one active variant.
    const r = await client.query(
      `SELECT v.*, p.is_one_of_one, p.is_active AS product_active, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.product_id = $1 AND v.is_active ORDER BY v.sort_order, v.created_at`,
      [product_id]
    );
    if (r.rows.length > 1) throw badRequest('variant_required', 'Please choose a size');
    return r.rows[0] || null;
  }
  throw badRequest('variant_required', 'Please choose a size');
}

export async function addLine(client, cartId, input) {
  const v = await resolveVariant(client, input);
  if (!v || !v.is_active || !v.product_active) throw notFound('product_unavailable', 'This piece is no longer available');
  const owner = (await client.query('SELECT auth_user_id FROM carts WHERE id = $1', [cartId])).rows[0]?.auth_user_id;
  if (await isDropLocked(client, owner, v.product_id)) {
    throw conflict('members_early_access', `${v.name} is in members' early access. It opens to everyone when the drop goes public.`);
  }
  const maxQty = v.is_one_of_one ? 1 : 10;
  const qty = int(input.quantity ?? 1, { min: 1, max: maxQty, field: 'quantity' });
  if (v.stock_quantity < 1) throw conflict('out_of_stock', `${v.name} (${v.size_label}) is sold out`);

  const count = (await client.query('SELECT count(*)::int AS n FROM cart_items WHERE cart_id = $1', [cartId])).rows[0].n;
  if (count >= MAX_LINES) throw badRequest('cart_full', 'Your bag is full');

  await client.query(
    `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity) VALUES ($1, $2, $3, LEAST($4::int, $5::int))
     ON CONFLICT (cart_id, variant_id) DO UPDATE
       SET quantity = LEAST(cart_items.quantity + excluded.quantity, $5::int, GREATEST($6::int, 1)), updated_at = now()`,
    [cartId, v.product_id, v.id, qty, maxQty, v.stock_quantity]
  );
}

export async function cartView(uid) {
  const [lines, settings, membership, rewards] = await Promise.all([
    loadCartLines(db, uid),
    getSettings(),
    db.query('SELECT status, credits_balance FROM memberships WHERE auth_user_id = $1', [uid]).then((r) => r.rows[0] || null),
    db.query("SELECT id, kind FROM reward_entitlements WHERE auth_user_id = $1 AND status = 'available' ORDER BY created_at", [uid]).then((r) => r.rows),
  ]);
  const priceable = lines.filter((l) => !l.issue);
  const estimate = calculateCartPrice({ lines: priceable, method: 'delivery', membership, settings });
  return {
    items: lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      variant_id: l.variant_id,
      name: l.name,
      slug: l.slug,
      image_url: l.image_url || (Array.isArray(l.images) ? l.images[0] : null) || null,
      badge: l.badge,
      sku: l.sku,
      size_label: l.size_label,
      quantity: l.quantity,
      is_one_of_one: l.is_one_of_one,
      use_credit: l.use_credit,
      reward_entitlement_id: l.reward_entitlement_id || null,
      credit_eligible: isCreditEligible(l),
      reward_eligible: isRewardEligible(l, settings),
      unit_price: calculateProductPrice(l),
      compare_at_price: l.sale_price_inr !== null && Number(l.sale_price_inr) < Number(l.price_inr) ? Number(l.price_inr) : null,
      line_total: calculateProductPrice(l) === null ? null : Math.round(calculateProductPrice(l) * l.quantity * 100) / 100,
      available_quantity: Math.min(10, Math.max(0, l.stock_quantity)),
      issue: l.issue,
    })),
    estimate: {
      subtotal: estimate.subtotal,
      credit_discount: estimate.credit_discount,
      reward_discount: estimate.reward_discount,
      shipping: estimate.shipping,
      tax_included: estimate.tax_amount,
      total: estimate.total,
      note: 'Final amount is confirmed at checkout. Studio pickup is free.',
    },
    membership: membership ? { status: membership.status, credits_balance: membership.credits_balance } : null,
    rewards_available: rewards.filter((r) => !lines.some((l) => l.reward_entitlement_id === r.id)),
  };
}

/** Attach (or detach with null) one of the customer's available free-piece rewards to a cart line. */
export async function setLineReward(client, uid, line, rewardId) {
  if (!rewardId) {
    await client.query('UPDATE cart_items SET reward_entitlement_id = NULL, updated_at = now() WHERE id = $1', [line.id]);
    return;
  }
  if (!isRewardEligible(line, await getSettings(client))) throw badRequest('reward_not_eligible', rewardIneligibleMessage);
  const reward = (await client.query("SELECT id FROM reward_entitlements WHERE id = $1 AND auth_user_id = $2 AND status = 'available'", [uuid(rewardId, 'reward_entitlement_id'), uid])).rows[0];
  if (!reward) throw notFound('reward_not_found', 'This reward is not available');
  const taken = (await client.query('SELECT 1 FROM cart_items WHERE reward_entitlement_id = $1 AND id <> $2', [reward.id, line.id])).rows[0];
  if (taken) throw conflict('reward_in_use', 'This reward is already applied to another piece in your bag');
  await client.query('UPDATE cart_items SET reward_entitlement_id = $2, use_credit = false, quantity = 1, updated_at = now() WHERE id = $1', [line.id, reward.id]);
}

export default async function cart(req, res) {
  const uid = req.user.id;
  const b = req.body || {};

  if (req.method === 'POST') {
    await db.tx(async (c) => {
      const cartId = await getOrCreateCartId(c, uid);
      if (b.action === 'merge') {
        const items = Array.isArray(b.items) ? b.items.slice(0, MAX_LINES) : [];
        for (const it of items) {
          try {
            await c.query('SAVEPOINT merge_line');
            await addLine(c, cartId, it);
            await c.query('RELEASE SAVEPOINT merge_line');
          } catch {
            await c.query('ROLLBACK TO SAVEPOINT merge_line');
          }
        }
      } else {
        await addLine(c, cartId, b);
      }
    });
  } else if (req.method === 'PATCH') {
    const itemId = uuid(b.item_id, 'item_id');
    const line = (await db.query(
      `SELECT ci.id, ci.reward_entitlement_id, ci.product_id, v.stock_quantity, v.price_inr, v.sale_price_inr, p.is_one_of_one, p.badge, p.credit_eligible, p.category_id FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
         JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = ci.product_id WHERE ci.id = $1 AND c.auth_user_id = $2`,
      [itemId, uid]
    )).rows[0];
    if (!line) throw notFound('cart_item_not_found', 'Item not found in your bag');
    if (b.quantity !== undefined) {
      const qty = int(b.quantity, { min: 1, max: line.is_one_of_one || line.reward_entitlement_id ? 1 : Math.max(1, Math.min(10, line.stock_quantity)), field: 'quantity' });
      await db.query('UPDATE cart_items SET quantity = $2, updated_at = now() WHERE id = $1', [itemId, qty]);
    }
    if (b.use_credit !== undefined) {
      const useCredit = bool(b.use_credit);
      if (useCredit && !isCreditEligible(line)) throw badRequest('premium_cannot_use_credit', 'This piece is not eligible for wardrobe credits');
      if (useCredit) {
        const m = (await db.query('SELECT status, billing_status FROM memberships WHERE auth_user_id = $1', [uid])).rows[0];
        if (!creditsUsable(m)) throw badRequest('membership_not_active', creditsBlockedMessage(m));
      }
      await db.query('UPDATE cart_items SET use_credit = $2, reward_entitlement_id = CASE WHEN $2 THEN NULL ELSE reward_entitlement_id END, updated_at = now() WHERE id = $1', [itemId, useCredit]);
    }
    if (b.reward_entitlement_id !== undefined) {
      await db.tx((c) => setLineReward(c, uid, line, b.reward_entitlement_id || null));
    }
  } else if (req.method === 'DELETE') {
    const where = b.item_id ? ['ci.id = $2', uuid(b.item_id, 'item_id')] : b.variant_id ? ['ci.variant_id = $2', uuid(b.variant_id, 'variant_id')] : b.product_id ? ['ci.product_id = $2', uuid(b.product_id, 'product_id')] : null;
    if (where) {
      await db.query(`DELETE FROM cart_items ci USING carts c WHERE c.id = ci.cart_id AND c.auth_user_id = $1 AND ${where[0]}`, [uid, where[1]]);
    } else if (b.all === true) {
      await db.query('DELETE FROM cart_items ci USING carts c WHERE c.id = ci.cart_id AND c.auth_user_id = $1', [uid]);
    } else {
      throw badRequest('item_required', 'Specify the item to remove');
    }
  }

  res.json(await cartView(uid));
}
