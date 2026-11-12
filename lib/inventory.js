import { db } from './db.js';
import { conflict } from './http.js';
import { log } from './log.js';
import { invalidatePublicCache } from './public-cache.js';
import { getSettings } from './settings.js';

/**
 * Atomically take `quantity` units of each variant. Rows are touched in a stable order so
 * concurrent checkouts of overlapping carts cannot deadlock. Exactly one buyer wins the last
 * unit: the conditional UPDATE re-checks stock after any competing transaction commits.
 */
export async function takeStock(client, lines) {
  const sorted = [...lines].sort((a, b) => String(a.variant_id).localeCompare(String(b.variant_id)));
  const taken = [];
  for (const l of sorted) {
    const r = await client.query(
      `UPDATE product_variants v
          SET stock_quantity = v.stock_quantity - $2, updated_at = now()
         FROM products p
        WHERE v.id = $1 AND p.id = v.product_id
          AND v.is_active AND p.is_active
          AND v.stock_quantity >= $2
        RETURNING v.id, v.product_id, v.stock_quantity`,
      [l.variant_id, l.quantity]
    );
    if (!r.rows[0]) {
      throw conflict('out_of_stock', `${l.name || 'A piece in your bag'}${l.size_label ? ` (${l.size_label})` : ''} is no longer available.`, {
        variant_id: l.variant_id,
        product_id: l.product_id,
      });
    }
    taken.push(r.rows[0]);
  }
  if (taken.length) db.onCommit(client, invalidatePublicCache);
  return taken;
}

export async function reserve(client, orderId, lines, minutes) {
  await takeStock(client, lines);
  for (const l of lines) {
    await client.query(
      `INSERT INTO inventory_reservations (order_id, variant_id, quantity, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [orderId, l.variant_id, l.quantity, minutes]
    );
  }
  await syncProductInventory(client, lines.map((l) => l.product_id));
}

/** Held → committed. Returns the number of reservations committed. */
export async function commitReservations(client, orderId) {
  const r = await client.query(
    `UPDATE inventory_reservations SET status = 'committed', updated_at = now()
      WHERE order_id = $1 AND status = 'held' RETURNING variant_id`,
    [orderId]
  );
  return r.rowCount;
}

/** Held → released, returning stock. Safe to call repeatedly. */
export async function releaseReservations(client, orderId) {
  const r = await client.query(
    `UPDATE inventory_reservations SET status = 'released', updated_at = now()
      WHERE order_id = $1 AND status = 'held' RETURNING variant_id, quantity`,
    [orderId]
  );
  const productIds = [];
  for (const row of r.rows) {
    const u = await client.query(
      'UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1 RETURNING product_id',
      [row.variant_id, row.quantity]
    );
    if (u.rows[0]) productIds.push(u.rows[0].product_id);
  }
  if (productIds.length) {
    await syncProductInventory(client, productIds);
    db.onCommit(client, invalidatePublicCache);
  }
  return r.rowCount;
}

/**
 * A payment arrived for an order whose hold had already been released (late webhook,
 * delayed UPI). Try to take the stock again; throws `out_of_stock` if someone else bought it.
 */
export async function reacquireReservations(client, orderId) {
  const r = await client.query(
    `SELECT ir.variant_id, ir.quantity, v.product_id, oi.product_name AS name, oi.variant_label AS size_label
       FROM inventory_reservations ir
       JOIN product_variants v ON v.id = ir.variant_id
       LEFT JOIN order_items oi ON oi.order_id = ir.order_id AND oi.variant_id = ir.variant_id
      WHERE ir.order_id = $1 AND ir.status = 'released'`,
    [orderId]
  );
  if (!r.rows.length) return 0;
  await takeStock(client, r.rows);
  await client.query(
    `UPDATE inventory_reservations SET status = 'committed', updated_at = now() WHERE order_id = $1 AND status = 'released'`,
    [orderId]
  );
  await syncProductInventory(client, r.rows.map((x) => x.product_id));
  return r.rowCount;
}

/** Keep the legacy per-product `inventory` row consistent with variant stock (used by dashboards). */
export async function syncProductInventory(client, productIds) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length) return;
  await client.query(
    `INSERT INTO inventory (product_id, status)
     SELECT p.id, 'available' FROM products p
      WHERE p.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id)`,
    [ids]
  );
  await client.query(
    `UPDATE inventory i
        SET status = CASE WHEN EXISTS (
              SELECT 1 FROM product_variants v WHERE v.product_id = i.product_id AND v.is_active AND v.stock_quantity > 0
            ) THEN 'available' ELSE 'sold' END,
            sold_at = CASE WHEN EXISTS (
              SELECT 1 FROM product_variants v WHERE v.product_id = i.product_id AND v.is_active AND v.stock_quantity > 0
            ) THEN NULL ELSE COALESCE(i.sold_at, now()) END,
            updated_at = now()
      WHERE i.product_id = ANY($1::uuid[])`,
    [ids]
  );
}

/**
 * Give back credits debited for an order that will not be fulfilled.
 * Idempotent via the ledger's (order_id, reason) uniqueness.
 * Restored credits keep a real expiry so a reversal cannot mint permanent credits.
 */
export async function reverseCredits(client, order) {
  if (!order.credits_used) return;
  const settings = await getSettings(client);
  const exp = await client.query(
    `SELECT min(expires_at) AS exp FROM credit_ledger
      WHERE auth_user_id = $1 AND delta > 0 AND expires_at > now()`,
    [order.auth_user_id]
  );
  const ins = await client.query(
    `INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, order_id, expires_at)
     SELECT $1, m.id, $2, 'redemption_reversal', $3, COALESCE($4::timestamptz, now() + make_interval(days => $5))
       FROM memberships m WHERE m.auth_user_id = $1
     ON CONFLICT (order_id, reason) WHERE order_id IS NOT NULL DO NOTHING RETURNING membership_id`,
    [order.auth_user_id, order.credits_used, order.id, exp.rows[0]?.exp || null, Number(settings.credit_expiry_days) || 60]
  );
  if (ins.rows[0]) {
    await client.query('UPDATE memberships SET credits_balance = credits_balance + $2, updated_at = now() WHERE id = $1', [
      ins.rows[0].membership_id,
      order.credits_used,
    ]);
  }
}

/**
 * Free-piece rewards attached to an order that will not be fulfilled become available again.
 * Idempotent; a reward redeemed on a different order is untouched.
 */
export async function releaseRewards(client, orderId) {
  const r = await client.query(
    `UPDATE reward_entitlements SET status = 'available', order_id = NULL, reserved_at = NULL, redeemed_at = NULL, updated_at = now()
      WHERE order_id = $1 AND status IN ('reserved', 'redeemed') RETURNING id`,
    [orderId]
  );
  return r.rowCount;
}

/** Reserve the customer's free-piece rewards for an order. Throws 409 if any is no longer available. */
export async function reserveRewards(client, orderId, authUserId, rewardIds) {
  if (!rewardIds.length) return 0;
  const r = await client.query(
    `UPDATE reward_entitlements SET status = 'reserved', order_id = $1, reserved_at = now(), updated_at = now()
      WHERE id = ANY($2::uuid[]) AND auth_user_id = $3 AND status = 'available' RETURNING id`,
    [orderId, rewardIds, authUserId]
  );
  if (r.rowCount !== rewardIds.length) throw conflict('reward_unavailable', 'A free-piece reward in your bag is no longer available. Please update your bag.');
  return r.rowCount;
}

/** Expire one unpaid order: release stock, credits and rewards. Returns true if it changed state. */
export async function expireOrder(client, orderId, reason = 'payment_window_expired') {
  const o = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
  if (!o || o.payment_status !== 'pending') return false;
  await releaseReservations(client, o.id);
  await reverseCredits(client, o);
  await releaseRewards(client, o.id);
  await client.query(
    `UPDATE orders SET status = 'expired', payment_status = 'expired', payment_failure_reason = COALESCE(payment_failure_reason, $2), updated_at = now() WHERE id = $1`,
    [o.id, reason]
  );
  return true;
}

/** Background sweep: release holds for orders whose payment window has passed. */
export async function sweepExpiredOrders(limit = 50) {
  const due = await db.query(
    `SELECT id FROM orders WHERE payment_status = 'pending' AND payment_expires_at < now() ORDER BY payment_expires_at LIMIT $1`,
    [limit]
  );
  let expired = 0;
  for (const row of due.rows) {
    try {
      const changed = await db.tx((c) => expireOrder(c, row.id));
      if (changed) expired += 1;
    } catch (err) {
      log.error('inventory.expire_failed', { order_id: row.id, message: err.message });
    }
  }
  if (expired) log.info('inventory.orders_expired', { count: expired });
  return expired;
}
