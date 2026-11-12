import { db } from './db.js';
import { audit } from './audit.js';
import { log } from './log.js';
import { getSettings } from './settings.js';
import { calculateMembershipPrice, extractTax, round2 } from './pricing.js';
import { commitReservations, reacquireReservations, releaseReservations, releaseRewards, reverseCredits, syncProductInventory } from './inventory.js';
import { appendMembershipMonths, grantDuePeriods } from './membership.js';
import { qualifyReferral, referralForFirstPayment } from './referrals.js';
import { razorpay } from './razorpay.js';
import { config } from './config.js';
import { notify } from './notify.js';
import crypto from 'crypto';

function financialYear(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

async function nextInvoiceNumber(client) {
  const r = await client.query("SELECT nextval('invoice_number_seq') AS n");
  return `VS/${financialYear()}/${String(r.rows[0].n).padStart(6, '0')}`;
}

/** One invoice per paid order (unique index on order_id makes this idempotent). */
export async function createOrderInvoice(client, order) {
  const existing = await client.query('SELECT * FROM invoice_records WHERE order_id = $1', [order.id]);
  if (existing.rows[0]) return existing.rows[0];
  const settings = await getSettings(client);
  const items = await client.query(
    'SELECT product_name, sku, variant_label, hsn_code, quantity, unit_price, line_total, gst_rate, taxable_value, gst_amount, use_credit FROM order_items WHERE order_id = $1',
    [order.id]
  );
  const hsn = new Map();
  for (const it of items.rows) {
    const key = `${it.hsn_code || '6204'}|${it.gst_rate}`;
    const cur = hsn.get(key) || { hsn_code: it.hsn_code || '6204', gst_rate: Number(it.gst_rate), taxable_value: 0, gst_amount: 0 };
    cur.taxable_value = round2(cur.taxable_value + Number(it.taxable_value || 0));
    cur.gst_amount = round2(cur.gst_amount + Number(it.gst_amount || 0));
    hsn.set(key, cur);
  }
  const number = await nextInvoiceNumber(client);
  const buyer = order.shipping_address?.name || null;
  const r = await client.query(
    `INSERT INTO invoice_records (order_id, invoice_number, gst_rate, taxable_value, gst_amount, cgst_amount, sgst_amount, igst_amount,
                                  total_amount, hsn_summary, place_of_supply, buyer_name, buyer_gstin, seller_gstin)
     VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING RETURNING *`,
    [order.id, number, order.taxable_amount, order.tax_amount, order.cgst_amount, order.sgst_amount, order.igst_amount, order.total,
     JSON.stringify([...hsn.values()]), order.place_of_supply, buyer, order.buyer_gstin, settings.seller_gstin || null]
  );
  const inv = r.rows[0] || (await client.query('SELECT * FROM invoice_records WHERE order_id = $1', [order.id])).rows[0];
  await client.query('UPDATE orders SET invoice_number = $2 WHERE id = $1 AND invoice_number IS NULL', [order.id, inv.invoice_number]);
  return inv;
}

/** Remove purchased variants from the buyer's bag. */
async function clearPurchasedFromCart(client, order) {
  await client.query(
    `DELETE FROM cart_items WHERE cart_id = (SELECT id FROM carts WHERE auth_user_id = $1)
       AND variant_id IN (SELECT variant_id FROM order_items WHERE order_id = $2 AND variant_id IS NOT NULL)`,
    [order.auth_user_id, order.id]
  );
}

/**
 * Mark an order paid exactly once. Called by the browser verification endpoint and by the
 * webhook; whichever arrives first performs the transition, later calls are no-ops.
 * Returns { status: 'paid' | 'already_paid' | 'refund_required', order }.
 */
export async function finalizeOrderPayment({ orderId, paymentId, signature = null, amountPaise = null, source, gatewayChecked = false }) {
  try {
    const result = await db.tx(async (c) => {
      const o = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
      if (!o) throw Object.assign(new Error('order_not_found'), { code: 'order_not_found' });
      if (o.payment_status === 'paid') {
        if (o.razorpay_payment_id && paymentId && o.razorpay_payment_id !== paymentId) {
          log.warn('payment.duplicate_payment_for_paid_order', { order_id: o.id, payment_id: paymentId });
          return { status: 'duplicate_payment', order: o, refundPaymentId: paymentId, amountPaise: amountPaise > 0 ? Number(amountPaise) : Number(o.amount_paise) };
        }
        return { status: 'already_paid', order: o };
      }
      if (['refund_required', 'refunded'].includes(o.payment_status)) return { status: o.payment_status, order: o };
      if (amountPaise !== null && Number(amountPaise) !== Number(o.amount_paise)) {
        throw Object.assign(new Error('amount_mismatch'), { code: 'amount_mismatch' });
      }

      if (o.payment_status === 'pending') {
        await commitReservations(c, o.id);
        // A reward revoked while this checkout held it (its source payment was refunded) cannot be honoured.
        const wanted = Number((await c.query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND reward_entitlement_id IS NOT NULL', [o.id])).rows[0].n);
        const redeemed = await c.query("UPDATE reward_entitlements SET status = 'redeemed', redeemed_at = now(), updated_at = now() WHERE order_id = $1 AND status = 'reserved'", [o.id]);
        if (redeemed.rowCount !== wanted) throw Object.assign(new Error('reward_unavailable'), { code: 'out_of_stock' });
      } else {
        // Free-piece rewards released when the hold expired must still be unused to honour this payment.
        const wanted = (await c.query('SELECT reward_entitlement_id FROM order_items WHERE order_id = $1 AND reward_entitlement_id IS NOT NULL', [o.id])).rows.map((r) => r.reward_entitlement_id);
        if (wanted.length) {
          const claimed = await c.query(
            `UPDATE reward_entitlements SET status = 'redeemed', order_id = $1, reserved_at = COALESCE(reserved_at, now()), redeemed_at = now(), updated_at = now()
              WHERE id = ANY($2::uuid[]) AND auth_user_id = $3 AND (status = 'available' OR (status = 'reserved' AND order_id = $1)) RETURNING id`,
            [o.id, wanted, o.auth_user_id]
          );
          if (claimed.rowCount !== wanted.length) throw Object.assign(new Error('reward_unavailable'), { code: 'out_of_stock' });
        }
        // Expired / cancelled before the payment landed: stock (and credits) must be taken again.
        await reacquireReservations(c, o.id);
        if (o.credits_used) {
          const m = await c.query(
            `UPDATE memberships SET credits_balance = credits_balance - $2, updated_at = now()
              WHERE auth_user_id = $1 AND status = 'active' AND billing_status NOT IN ('retrying', 'halted') AND credits_balance >= $2 RETURNING id`,
            [o.auth_user_id, o.credits_used]
          );
          if (!m.rows[0]) throw Object.assign(new Error('insufficient_credits'), { code: 'out_of_stock' });
          await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, order_id) VALUES ($1,$2,$3,'redemption_late_payment',$4) ON CONFLICT DO NOTHING", [
            o.auth_user_id, m.rows[0].id, -o.credits_used, o.id,
          ]);
        }
      }

      const upd = await c.query(
        `UPDATE orders SET payment_status = 'paid', status = 'processing', razorpay_payment_id = COALESCE($2, razorpay_payment_id),
                razorpay_signature = COALESCE($3, razorpay_signature), paid_at = now(), payment_failure_reason = NULL,
                gateway_checked_at = CASE WHEN $4::boolean THEN now() ELSE gateway_checked_at END, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [o.id, paymentId, signature, Boolean(gatewayChecked)]
      );
      let paid = upd.rows[0];
      const items = await c.query('SELECT DISTINCT product_id FROM order_items WHERE order_id = $1', [o.id]);
      await syncProductInventory(c, items.rows.map((r) => r.product_id));
      await createOrderInvoice(c, paid);
      // Re-fetch so the returned order row includes the invoice_number written by createOrderInvoice.
      paid = (await c.query('SELECT * FROM orders WHERE id = $1', [o.id])).rows[0];
      await clearPurchasedFromCart(c, paid);
      await audit(c, { actor: source === 'webhook' ? 'razorpay_webhook' : o.auth_user_id, action: 'order_paid', entityType: 'order', entityId: o.id, details: { source, payment_id: paymentId, amount_paise: o.amount_paise } });
      log.info('payment.order_paid', { order_id: o.id, source, payment_id: paymentId });
      return { status: 'paid', order: paid };
    });
    if (result.status === 'duplicate_payment' && result.refundPaymentId) {
      await refundDuplicatePayment({ orderId, paymentId: result.refundPaymentId, amountPaise: result.amountPaise, source });
    }
    if (result.status === 'paid') {
      const o = result.order;
      await notify(db, { authUserId: o.auth_user_id, event: 'order_confirmed', data: { ref: String(o.id).slice(0, 8).toUpperCase(), total: Number(o.total), link: `${config.publicSiteUrl}/orders/${o.id}` }, dedupeKey: `order_paid:${o.id}` });
    }
    return result;
  } catch (err) {
    if (err.code === 'out_of_stock' || err.code === 'amount_mismatch') {
      return markRefundRequired({ orderId, paymentId, reason: err.code, source });
    }
    throw err;
  }
}

/**
 * Refund a second capture against an order that is already paid, or a capture on a record that can
 * no longer be fulfilled (`entityType` 'bag_shipment').
 * The claim row makes concurrent webhooks and browser retries issue one Razorpay refund.
 */
export async function refundDuplicatePayment({ orderId, paymentId, amountPaise, source = 'system', entityType = 'order' }) {
  if (!paymentId || !amountPaise) return false;
  const eventId = `refund:${paymentId}`;
  const existing = (await db.query("SELECT status FROM payment_events WHERE provider = 'razorpay' AND event_id = $1", [eventId])).rows[0];
  if (existing && existing.status !== 'failed') return false;
  if (!existing) {
    const claimed = await db.query(
      `INSERT INTO payment_events (provider, event_id, event_type, entity_id, payload, status)
       VALUES ('razorpay', $1, 'duplicate_refund', $2, $3, 'received')
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [eventId, paymentId, JSON.stringify({ order_id: orderId, amount_paise: amountPaise, entity_type: entityType })]
    );
    if (!claimed.rows[0]) return false;
  } else {
    const claimed = await db.query(
      "UPDATE payment_events SET status = 'received', error = NULL WHERE provider = 'razorpay' AND event_id = $1 AND status = 'failed' RETURNING id",
      [eventId]
    );
    if (!claimed.rows[0]) return false;
  }
  if (!razorpay.configured || process.env.RAZORPAY_AUTO_REFUND === 'false') return false;
  try {
    const receipt = `dup${crypto.createHash('sha256').update(String(paymentId)).digest('hex')}`.slice(0, 40);
    await razorpay.refundPayment(paymentId, amountPaise, { [`${entityType}_id`]: orderId, reason: 'duplicate_payment' }, { timeoutMs: 4_000, receipt });
    await db.query("UPDATE payment_events SET status = 'processed', processed_at = now(), error = NULL WHERE provider = 'razorpay' AND event_id = $1", [eventId]);
    await audit(db, { actor: source === 'webhook' ? 'razorpay_webhook' : 'system', action: 'duplicate_payment_refunded', entityType, entityId: orderId, details: { payment_id: paymentId, amount_paise: amountPaise } });
    log.warn('payment.duplicate_refunded', { order_id: orderId, payment_id: paymentId });
    return true;
  } catch (err) {
    await db.query("UPDATE payment_events SET status = 'failed', error = $2 WHERE provider = 'razorpay' AND event_id = $1", [eventId, String(err.message).slice(0, 500)]);
    log.error('payment.duplicate_refund_failed', { order_id: orderId, payment_id: paymentId, message: err.message });
    return false;
  }
}

/**
 * Apply one Razorpay refund (refund.processed) to a gift purchase or Wardrobe Bag shipping fee.
 * Each refund id counts once, so redelivered events and repeated refunds never add up twice.
 * `row` must be locked by the caller. Returns null when this refund was already recorded.
 */
const REFUNDABLE_TABLES = { gift_enquiry: 'admin_gift_enquiries', bag_shipment: 'bag_shipments' };

export async function applyEntityRefund(c, { table, entityType, row, refund, paidPaise }) {
  if (REFUNDABLE_TABLES[entityType] !== table) throw new Error(`applyEntityRefund: unsupported ${entityType}/${table}`);
  const amount = Number(refund?.amount);
  const refundPaise = Number.isFinite(amount) && amount > 0 ? amount : paidPaise;
  const refundId = String(refund?.id || `${refund?.payment_id}:${refundPaise}`);
  const claimed = await c.query(
    `INSERT INTO payment_refunds (razorpay_refund_id, provider_payment_id, entity_type, entity_id, amount_paise)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (razorpay_refund_id) DO NOTHING RETURNING razorpay_refund_id`,
    [refundId, refund.payment_id, entityType, row.id, refundPaise]
  );
  if (!claimed.rows[0]) return null;
  const total = Math.min(paidPaise, Number(row.refunded_amount_paise || 0) + refundPaise);
  const full = total >= paidPaise;
  await c.query(
    `UPDATE ${table} SET refunded_amount_paise = $2, refund_status = $3,
            refunded_at = CASE WHEN $3 = 'refunded' THEN COALESCE(refunded_at, now()) ELSE refunded_at END, updated_at = now()
      WHERE id = $1`,
    [row.id, total, full ? 'refunded' : 'partial']
  );
  return { full, refundId, refundPaise, totalPaise: total };
}

/** Money was captured but the order cannot be fulfilled: one caller records it and requests the refund. */
async function markRefundRequired({ orderId, paymentId, reason, source }) {
  const o = await db.tx(async (c) => {
    const r = await c.query(
      `UPDATE orders SET payment_status = 'refund_required', status = 'refund_required', razorpay_payment_id = COALESCE($2, razorpay_payment_id),
              payment_failure_reason = $3, updated_at = now()
        WHERE id = $1 AND payment_status IN ('pending', 'expired', 'cancelled', 'failed') RETURNING *`,
      [orderId, paymentId, reason]
    );
    if (r.rows[0]) await audit(c, { actor: 'system', action: 'order_refund_required', entityType: 'order', entityId: orderId, details: { reason, source, payment_id: paymentId } });
    return r.rows[0];
  });
  if (!o) {
    const cur = (await db.query('SELECT payment_status, razorpay_payment_id, amount_paise FROM orders WHERE id = $1', [orderId])).rows[0];
    if (cur && paymentId && cur.razorpay_payment_id && cur.razorpay_payment_id !== paymentId && ['refund_required', 'refunded', 'paid'].includes(cur.payment_status)) {
      await refundDuplicatePayment({ orderId, paymentId, amountPaise: Number(cur.amount_paise), source });
    }
    return { status: cur?.payment_status === 'paid' ? 'already_paid' : cur?.payment_status || 'refund_required' };
  }
  log.warn('payment.refund_required', { order_id: orderId, reason, payment_id: paymentId });
  if (paymentId && razorpay.configured && process.env.RAZORPAY_AUTO_REFUND !== 'false') {
    const refunded = await issueOrderRefund({ id: orderId, razorpay_payment_id: paymentId, amount_paise: o.amount_paise }, reason);
    if (refunded) return { status: 'refunded', order: o };
  }
  return { status: 'refund_required', order: o };
}

const orderRefundReceipt = (orderId, paymentId) => `ord${crypto.createHash('sha256').update(`${orderId}:${paymentId}`).digest('hex')}`.slice(0, 40);

/**
 * Call Razorpay once for an order in `refund_required`. The deterministic receipt makes a retry of
 * the same refund idempotent on the gateway side. Returns true when the order is now `refunded`.
 */
async function issueOrderRefund(order, reason) {
  const claim = await db.query(
    `UPDATE orders SET refund_attempts = refund_attempts + 1, refund_attempted_at = now(), updated_at = now()
      WHERE id = $1 AND payment_status = 'refund_required' AND razorpay_refund_id IS NULL RETURNING refund_attempts`,
    [order.id]
  );
  if (!claim.rows[0]) return false;
  try {
    const refund = await razorpay.refundPayment(order.razorpay_payment_id, order.amount_paise, { order_id: order.id, reason }, {
      timeoutMs: 4_000,
      receipt: orderRefundReceipt(order.id, order.razorpay_payment_id),
    });
    await db.query(
      `UPDATE orders SET payment_status = 'refunded', status = CASE WHEN status IN ('refund_required','processing','packed','pending_payment','expired') THEN 'refunded' ELSE status END,
              razorpay_refund_id = COALESCE($2, razorpay_refund_id), refunded_at = COALESCE(refunded_at, now()), updated_at = now()
        WHERE id = $1 AND payment_status = 'refund_required'`,
      [order.id, refund?.id || null]
    );
    await audit(db, { actor: 'system', action: 'order_auto_refunded', entityType: 'order', entityId: order.id, details: { payment_id: order.razorpay_payment_id, attempt: claim.rows[0].refund_attempts } });
    return true;
  } catch (err) {
    log.error('payment.auto_refund_failed', { order_id: order.id, attempt: claim.rows[0].refund_attempts, message: err.message });
    return false;
  }
}

export const REFUND_MAX_ATTEMPTS = 8;

/** Retry refunds of duplicate captures whose first Razorpay call failed. */
export async function retryFailedDuplicateRefunds(limit = 20) {
  const rows = await db.query(
    `SELECT entity_id, payload FROM payment_events
      WHERE provider = 'razorpay' AND event_type = 'duplicate_refund' AND status = 'failed'
        AND received_at > now() - interval '7 days' ORDER BY received_at LIMIT $1`,
    [limit]
  );
  let done = 0;
  for (const r of rows.rows) {
    const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload || {};
    if (await refundDuplicatePayment({ orderId: payload.order_id, paymentId: r.entity_id, amountPaise: Number(payload.amount_paise), source: 'reconcile', entityType: payload.entity_type || 'order' })) done += 1;
  }
  return done;
}

/** One pass of payment reconciliation. Safe to run every minute alongside the stock sweeper. */
export async function reconcilePayments() {
  const out = { rechecked: 0, refunds: 0, duplicate_refunds: 0 };
  out.rechecked = await recheckUnconfirmedPayments();
  out.refunds = await retryPendingRefunds();
  out.duplicate_refunds = await retryFailedDuplicateRefunds();
  if (out.rechecked || out.refunds || out.duplicate_refunds) log.info('payment.reconciled', out);
  return out;
}

/** Retry refunds that failed earlier (gateway down, timeout). Backs off two minutes between attempts. */
export async function retryPendingRefunds(limit = 20) {
  if (!razorpay.configured || process.env.RAZORPAY_AUTO_REFUND === 'false') return 0;
  const due = await db.query(
    `SELECT id, razorpay_payment_id, amount_paise, payment_failure_reason FROM orders
      WHERE payment_status = 'refund_required' AND razorpay_refund_id IS NULL AND razorpay_payment_id IS NOT NULL
        AND refund_attempts < $2 AND (refund_attempted_at IS NULL OR refund_attempted_at < now() - interval '2 minutes')
      ORDER BY refund_attempted_at NULLS FIRST LIMIT $1`,
    [limit, REFUND_MAX_ATTEMPTS]
  );
  let done = 0;
  for (const o of due.rows) {
    if (await issueOrderRefund(o, o.payment_failure_reason || 'refund_retry')) done += 1;
  }
  const exhausted = await db.query(
    `SELECT id FROM orders WHERE payment_status = 'refund_required' AND razorpay_refund_id IS NULL AND refund_attempts >= $1`,
    [REFUND_MAX_ATTEMPTS]
  );
  for (const row of exhausted.rows) log.error('payment.refund_needs_operator', { order_id: row.id });
  return done;
}

const UNSHIPPED_STATUSES = ['processing', 'packed', 'pending_payment'];

/**
 * A paid order turned out not to be backed by a captured payment of the right amount.
 * Unshipped: return stock and credits and queue a refund. Shipped: record it for an operator;
 * stock is not changed.
 */
export async function flagPaidOrderMismatch({ orderId, reason }) {
  return db.tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!o || o.payment_status !== 'paid') return false;
    if (UNSHIPPED_STATUSES.includes(o.status)) {
      const held = await c.query("UPDATE inventory_reservations SET status = 'held' WHERE order_id = $1 AND status = 'committed' RETURNING 1", [o.id]);
      if (held.rowCount) await releaseReservations(c, o.id);
      await reverseCredits(c, o);
      await releaseRewards(c, o.id);
      await c.query(
        `UPDATE orders SET payment_status = 'refund_required', status = 'refund_required', payment_failure_reason = $2, gateway_checked_at = now(), updated_at = now() WHERE id = $1`,
        [o.id, reason]
      );
    } else {
      await c.query('UPDATE orders SET payment_failure_reason = $2, gateway_checked_at = now(), updated_at = now() WHERE id = $1', [o.id, reason]);
    }
    await audit(c, { actor: 'system', action: 'payment_gateway_mismatch', entityType: 'order', entityId: o.id, details: { reason, status: o.status, payment_id: o.razorpay_payment_id } });
    log.error('payment.gateway_mismatch', { order_id: o.id, reason, status: o.status });
    return true;
  });
}

/**
 * Orders marked paid on signature alone (gateway unreachable at verify time) are confirmed against
 * Razorpay afterwards. Authorized-only payments are captured; anything else is flagged.
 */
export async function recheckUnconfirmedPayments(limit = 20) {
  if (!razorpay.configured) return 0;
  const rows = await db.query(
    `SELECT id, razorpay_order_id, razorpay_payment_id, amount_paise FROM orders
      WHERE payment_status = 'paid' AND gateway_checked_at IS NULL AND razorpay_payment_id IS NOT NULL
        AND paid_at > now() - interval '7 days' ORDER BY paid_at LIMIT $1`,
    [limit]
  );
  let checked = 0;
  for (const o of rows.rows) {
    let p;
    try {
      p = await razorpay.fetchPayment(o.razorpay_payment_id);
    } catch (err) {
      log.warn('payment.recheck_unavailable', { order_id: o.id, message: err.message });
      continue;
    }
    let reason = null;
    if (p.order_id !== o.razorpay_order_id) reason = 'gateway_order_mismatch';
    else if (p.currency !== 'INR' || Number(p.amount) !== Number(o.amount_paise)) reason = 'amount_mismatch';
    else if (p.status === 'authorized') {
      try {
        await razorpay.capturePayment(o.razorpay_payment_id, o.amount_paise);
      } catch (err) {
        log.warn('payment.recheck_capture_failed', { order_id: o.id, message: err.message });
        continue;
      }
    } else if (p.status !== 'captured') reason = `payment_${p.status}`;

    if (reason) {
      await flagPaidOrderMismatch({ orderId: o.id, reason });
    } else {
      await db.query('UPDATE orders SET gateway_checked_at = now() WHERE id = $1 AND gateway_checked_at IS NULL', [o.id]);
    }
    checked += 1;
  }
  return checked;
}

/** Activate membership / allocate credits exactly once per membership payment. */
export async function finalizeMembershipPayment({ membershipPaymentId, paymentId, amountPaise = null, source }) {
  return db.tx(async (c) => {
    const mp = (await c.query('SELECT * FROM membership_payments WHERE id = $1 FOR UPDATE', [membershipPaymentId])).rows[0];
    if (!mp) throw Object.assign(new Error('membership_payment_not_found'), { code: 'not_found' });
    if (mp.status === 'paid') return { status: 'already_paid' };
    const settings = await getSettings(c);
    const price = calculateMembershipPrice(settings, { months: mp.months || undefined });
    const expectedPaise = Math.round(Number(mp.amount) * 100);
    if (amountPaise !== null && Number(amountPaise) !== expectedPaise) {
      await c.query("UPDATE membership_payments SET status='failed', failure_reason='amount_mismatch' WHERE id=$1", [mp.id]);
      log.warn('payment.membership_amount_mismatch', { membership_payment_id: mp.id, amount_paise: amountPaise, expected: expectedPaise });
      return { status: 'amount_mismatch' };
    }

    await c.query("UPDATE membership_payments SET status = 'paid', provider_payment_id = $2, paid_at = now() WHERE id = $1", [mp.id, paymentId]);
    // Every paid month is a period row; credits for a month are granted when it starts.
    const months = Number(mp.months) || price.months;
    const credits = Number(settings.credits_per_month) || 4;
    await appendMembershipMonths(c, { membershipId: mp.membership_id, months, source: 'payment', membershipPaymentId: mp.id, creditsPerMonth: credits, settings, alignToPaidThrough: mp.charge_kind === 'recurring' });
    await grantDuePeriods(c, mp.membership_id, settings);
    const m = await c.query('SELECT * FROM memberships WHERE id = $1', [mp.membership_id]);
    const referralId = await referralForFirstPayment(c, mp);
    if (referralId) await qualifyReferral(c, { referralId, membershipPaymentId: mp.id, discount: mp.discount_amount, quantity: settings.referrer_reward_quantity });
    const { taxable, tax } = extractTax(Number(mp.amount), price.gst_rate);
    const intra = true; // services billed from the studio's state
    const number = await nextInvoiceNumber(c);
    await c.query(
      `INSERT INTO invoice_records (membership_payment_id, invoice_number, gst_rate, taxable_value, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount, place_of_supply, seller_gstin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10) ON CONFLICT (membership_payment_id) WHERE membership_payment_id IS NOT NULL DO NOTHING`,
      [mp.id, number, price.gst_rate, taxable, tax, intra ? round2(tax / 2) : 0, intra ? round2(tax - round2(tax / 2)) : 0, Number(mp.amount), settings.seller_state, settings.seller_gstin || null]
    );
    await audit(c, { actor: source === 'webhook' ? 'razorpay_webhook' : mp.auth_user_id, action: 'membership_paid', entityType: 'membership', entityId: mp.membership_id, details: { source, payment_id: paymentId, months, credits_per_month: credits, discount: Number(mp.discount_amount) || 0 } });
    log.info('payment.membership_paid', { membership_id: mp.membership_id, source });
    return { status: 'paid', membership: m.rows[0] };
  });
}
