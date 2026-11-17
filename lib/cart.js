/** Cart helpers shared by the cart and checkout modules. */
import { getSettings } from './settings.js';

/** SQL (with $1 = customer id, $2 = early-access hours): the piece is in a drop not yet open to this customer. */
const DROP_LOCKED_SQL = `EXISTS (SELECT 1 FROM drop_settings d WHERE d.id = p.drop_id AND d.active AND (
     now() < d.starts_at OR (now() < COALESCE(d.public_at, d.starts_at + make_interval(hours => $2::int))
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.auth_user_id = $1 AND m.status = 'active'))))`;

/** Whether a product is in a drop this customer cannot buy yet (members' early access, MEM-02). */
export async function isDropLocked(client, uid, productId) {
  const hours = Math.max(0, Number((await getSettings(client)).early_access_hours) || 0);
  const r = await client.query(`SELECT ${DROP_LOCKED_SQL} AS locked FROM products p WHERE p.id = $3`, [uid || '', hours, productId]);
  return Boolean(r.rows[0]?.locked);
}

export async function getOrCreateCartId(client, uid) {
  const r = await client.query(
    `INSERT INTO carts (auth_user_id) VALUES ($1)
     ON CONFLICT (auth_user_id) DO UPDATE SET updated_at = carts.updated_at RETURNING id`,
    [uid]
  );
  return r.rows[0].id;
}

/**
 * Cart lines with authoritative product/variant data. Never trusts any client-side price.
 * `issue` is set when a line can no longer be purchased as-is.
 */
export async function loadCartLines(client, uid) {
  const hours = Math.max(0, Number((await getSettings(client)).early_access_hours) || 0);
  const r = await client.query(
    `SELECT ci.id, ci.product_id, ci.variant_id, ci.quantity, COALESCE(ci.use_credit, false) AS use_credit, ci.reward_entitlement_id,
            re.status AS reward_status, re.auth_user_id AS reward_owner, ${DROP_LOCKED_SQL} AS drop_locked,
            p.name, p.slug, p.image_url, p.images, p.badge, p.is_one_of_one, p.is_active AS product_active, p.hsn_code, p.credit_eligible, p.category_id,
            v.sku, v.size_label, v.attributes, v.price_inr, v.sale_price_inr, v.stock_quantity, v.is_active AS variant_active,
            EXISTS (
              SELECT 1 FROM inventory_reservations ir
              JOIN orders o ON o.id = ir.order_id
              WHERE ir.variant_id = v.id AND ir.status = 'held' AND ir.expires_at > now()
                AND o.auth_user_id <> $1
            ) AS checking_out_by_other
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
       JOIN products p ON p.id = ci.product_id
       JOIN product_variants v ON v.id = ci.variant_id
       LEFT JOIN reward_entitlements re ON re.id = ci.reward_entitlement_id
      WHERE c.auth_user_id = $1
      ORDER BY ci.created_at DESC`,
    [uid, hours]
  );
  return r.rows.map((l) => {
    let issue = null;
    if (!l.product_active || !l.variant_active) issue = 'unavailable';
    else if (l.drop_locked) issue = 'early_access';
    else if (l.stock_quantity < l.quantity) issue = l.stock_quantity > 0 ? 'insufficient_stock' : 'sold_out';
    else if (l.checking_out_by_other) issue = 'checking_out';
    else if (l.is_one_of_one && l.quantity > 1) issue = 'one_of_one_quantity';
    else if (l.reward_entitlement_id && (l.reward_status !== 'available' || l.reward_owner !== uid)) issue = 'reward_unavailable';
    return { ...l, issue };
  });
}
