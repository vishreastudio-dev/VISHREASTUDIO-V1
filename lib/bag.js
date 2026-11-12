/**
 * Wardrobe Bag (MEM-05, MEM-06). A credit (or free-piece) pick is sold the moment it is redeemed and
 * waits as an order in status `in_bag`. "Ship my bag" moves every waiting pick into one shipment:
 * free for `free_member_credits_to_ship` (4) or more pieces or studio pickup, otherwise the flat
 * shipping fee, paid online and confirmed on the server before anything moves to fulfilment.
 */
import { db } from './db.js';
import { audit } from './audit.js';
import { log } from './log.js';
import { AppError, badRequest, conflict, notFound } from './http.js';
import { bagShipmentFee } from './pricing.js';
import { getSettings } from './settings.js';
import { razorpay, verifyPaymentSignature } from './razorpay.js';
import { checkoutFields, issueLocalOrderPayment } from './local-pay.js';
import { notify } from './notify.js';
import { applyEntityRefund, refundDuplicatePayment } from './payments.js';
import { indianState, oneOf, phone, text } from './validate.js';

function parseBagAddress(raw, method) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const name = text(a.name, { max: 120, field: 'name', required: true });
  const contact = phone(a.phone, { required: true });
  if (method === 'pickup') return { name, phone: contact };
  const pincode = text(a.pincode ?? a.pin, { max: 6, field: 'pincode', required: true });
  if (!/^[1-9]\d{5}$/.test(pincode)) throw badRequest('invalid_pincode', 'Enter a valid 6-digit PIN code');
  return {
    name,
    phone: contact,
    line1: text(a.line1 ?? a.address, { max: 200, field: 'address', required: true }),
    line2: text(a.line2, { max: 200, field: 'address_line2' }),
    city: text(a.city, { max: 80, field: 'city', required: true }),
    state: indianState(a.state, { required: true }),
    pincode,
  };
}

export async function bagView(client, uid) {
  const settings = await getSettings();
  const items = await client.query(
    `SELECT o.id AS order_id, o.created_at, oi.product_name, oi.variant_label, oi.quantity, oi.use_credit, oi.reward_entitlement_id, p.slug, p.image_url
       FROM orders o JOIN order_items oi ON oi.order_id = o.id LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.auth_user_id = $1 AND o.status = 'in_bag' ORDER BY o.created_at`,
    [uid]
  );
  const pieces = items.rows.reduce((n, r) => n + Number(r.quantity), 0);
  const open = (await client.query("SELECT id, pieces, shipping_fee, razorpay_order_id, payment_expires_at FROM bag_shipments WHERE auth_user_id = $1 AND status = 'pending_payment'", [uid])).rows[0] || null;
  return {
    pieces,
    items: items.rows,
    free_from: Number(settings.free_member_credits_to_ship),
    fee: { delivery: bagShipmentFee({ pieces, method: 'delivery', settings }).fee, pickup: 0 },
    open_shipment: open,
  };
}

/** Move the waiting orders into fulfilment as one shipment. Runs inside the caller's transaction. */
async function releaseToFulfilment(c, shipment) {
  const moved = await c.query(
    `UPDATE orders SET status = 'processing', shipping_method = $2, shipping_address = $3, bag_shipment_id = $4, updated_at = now()
      WHERE id = ANY($5::uuid[]) AND auth_user_id = $1 AND status = 'in_bag' RETURNING id`,
    [shipment.auth_user_id, shipment.shipping_method, JSON.stringify(shipment.shipping_address), shipment.id, shipment.order_ids]
  );
  return moved.rowCount;
}

export async function shipBag(user, b) {
  const settings = await getSettings();
  const method = oneOf(b.shipping_method, ['delivery', 'pickup'], { field: 'shipping_method', fallback: 'delivery' });
  const address = parseBagAddress(b.shipping_address, method);
  const idemKey = b.idempotency_key ? text(b.idempotency_key, { max: 80, field: 'idempotency_key' }) : null;

  const out = await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('bag:' || $1))", [user.id]);
    if (idemKey) {
      const prior = (await c.query('SELECT * FROM bag_shipments WHERE auth_user_id = $1 AND idempotency_key = $2', [user.id, idemKey])).rows[0];
      if (prior) return { shipment: prior, reused: true };
    }
    const orders = (await c.query("SELECT id FROM orders WHERE auth_user_id = $1 AND status = 'in_bag' FOR UPDATE", [user.id])).rows.map((r) => r.id);
    if (!orders.length) throw badRequest('bag_empty', 'Your Wardrobe Bag is empty');
    const pieces = Number((await c.query('SELECT COALESCE(sum(quantity), 0)::int AS n FROM order_items WHERE order_id = ANY($1::uuid[])', [orders])).rows[0].n);
    const fee = bagShipmentFee({ pieces, method, settings });
    if (fee.fee > 0 && !razorpay.configured) throw new AppError(503, 'payments_unavailable', 'Online payment is not available right now. Your bag has been kept.');
    // A newer request replaces an unpaid one (e.g. more picks were added since).
    await c.query("UPDATE bag_shipments SET status = 'cancelled', updated_at = now() WHERE auth_user_id = $1 AND status = 'pending_payment'", [user.id]);
    const minutes = Math.min(60, Math.max(5, Number(settings.reservation_minutes) || 15));
    const shipment = (await c.query(
      `INSERT INTO bag_shipments (auth_user_id, status, shipping_method, shipping_address, order_ids, pieces, shipping_fee, amount_paise, payment_expires_at, paid_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 > 0 THEN now() + make_interval(mins => $9) END, CASE WHEN $8 = 0 THEN now() END, $10) RETURNING *`,
      [user.id, fee.fee > 0 ? 'pending_payment' : 'paid', method, JSON.stringify(address), orders, pieces, fee.fee, fee.amount_paise, minutes, idemKey]
    )).rows[0];
    if (fee.fee === 0) await releaseToFulfilment(c, shipment);
    await audit(c, { actor: user.id, action: 'bag_ship_requested', entityType: 'bag_shipment', entityId: shipment.id, details: { pieces, fee: fee.fee, method } });
    return { shipment };
  });

  let shipment = out.shipment;
  if (shipment.status === 'pending_payment' && !shipment.razorpay_order_id) {
    const rp = await razorpay.createOrder({ amountPaise: shipment.amount_paise, receipt: `bag-${shipment.id}`, notes: { bag_shipment_id: shipment.id, customer: user.id } });
    if (Number(rp.amount) !== Number(shipment.amount_paise) || rp.currency !== 'INR') throw new AppError(502, 'payment_gateway_error', 'Gateway amount mismatch');
    shipment = (await db.query('UPDATE bag_shipments SET razorpay_order_id = $2, updated_at = now() WHERE id = $1 AND razorpay_order_id IS NULL RETURNING *', [shipment.id, rp.id])).rows[0]
      || (await db.query('SELECT * FROM bag_shipments WHERE id = $1', [shipment.id])).rows[0];
  }
  if (shipment.status === 'paid' && !out.reused) {
    await notify(db, { authUserId: user.id, event: 'bag_shipped', data: { pieces: shipment.pieces }, dedupeKey: `bag:${shipment.id}` });
  }
  return {
    shipment_id: shipment.id,
    status: shipment.status,
    pieces: shipment.pieces,
    shipping_fee: Number(shipment.shipping_fee),
    razorpay: shipment.status === 'pending_payment'
      ? checkoutFields({ key_id: razorpay.keyId, order_id: shipment.razorpay_order_id, amount: shipment.amount_paise, currency: 'INR', name: 'Vishrea Studio', description: `Wardrobe Bag shipping · ${shipment.pieces} pieces`, local_confirm: { path: '/api/wardrobe', body: { action: 'complete_local', shipment_id: shipment.id } } })
      : null,
  };
}

/** Mark the shipping payment paid exactly once (browser verification or webhook) and release the bag. */
export async function finalizeBagShipment({ shipmentId, paymentId, amountPaise, source }) {
  const r = await db.tx(async (c) => {
    const s = (await c.query('SELECT * FROM bag_shipments WHERE id = $1 FOR UPDATE', [shipmentId])).rows[0];
    if (!s) return { status: 'ignored' };
    if (s.status === 'paid') {
      if (s.provider_payment_id === paymentId) return { status: 'already_paid', shipment: s };
      return { status: 'duplicate_payment', shipment: s, refund: true };
    }
    if (Number(amountPaise) !== Number(s.amount_paise)) {
      log.warn('bag.amount_mismatch', { shipment_id: s.id, amount_paise: amountPaise, expected: s.amount_paise });
      return { status: 'amount_mismatch', shipment: s };
    }
    // Paid after the window closed or after a newer request: still honoured if the picks are waiting.
    const moved = await releaseToFulfilment(c, s);
    if (!moved) {
      // A newer request already sent these picks for shipping, so this fee buys nothing.
      await audit(c, { actor: source === 'webhook' ? 'razorpay_webhook' : s.auth_user_id, action: 'bag_shipping_refund_required', entityType: 'bag_shipment', entityId: s.id, details: { payment_id: paymentId, status: s.status } });
      log.warn('bag.paid_without_waiting_orders', { shipment_id: s.id, status: s.status });
      return { status: 'refund_required', shipment: s, refund: true };
    }
    const upd = (await c.query(
      "UPDATE bag_shipments SET status = 'paid', provider_payment_id = $2, paid_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
      [s.id, paymentId]
    )).rows[0];
    await audit(c, { actor: source === 'webhook' ? 'razorpay_webhook' : s.auth_user_id, action: 'bag_shipping_paid', entityType: 'bag_shipment', entityId: s.id, details: { payment_id: paymentId, orders_moved: moved } });
    return { status: 'paid', shipment: upd, moved };
  });
  if (r.refund) {
    await refundDuplicatePayment({ orderId: r.shipment.id, paymentId, amountPaise: Number(r.shipment.amount_paise), source, entityType: 'bag_shipment' });
  }
  if (r.status === 'paid') await notify(db, { authUserId: r.shipment.auth_user_id, event: 'bag_shipped', data: { pieces: r.shipment.pieces }, dedupeKey: `bag:${r.shipment.id}` });
  return r;
}

export async function confirmBagPayment(user, b) {
  const rzpOrderId = text(b.razorpay_order_id, { max: 64, field: 'razorpay_order_id', required: true });
  const paymentId = text(b.razorpay_payment_id, { max: 64, field: 'razorpay_payment_id', required: true });
  const signature = text(b.razorpay_signature, { max: 128, field: 'razorpay_signature', required: true });
  const s = (await db.query('SELECT * FROM bag_shipments WHERE razorpay_order_id = $1 AND auth_user_id = $2', [rzpOrderId, user.id])).rows[0];
  if (!s) throw notFound('bag_shipment_not_found', 'No Wardrobe Bag shipment found for this payment');
  if (!verifyPaymentSignature({ razorpayOrderId: rzpOrderId, razorpayPaymentId: paymentId, signature })) {
    await audit(db, { actor: user.id, action: 'bag_payment_signature_invalid', entityType: 'bag_shipment', entityId: s.id, details: { payment_id: paymentId } });
    log.warn('bag.invalid_signature', { shipment_id: s.id });
    throw badRequest('invalid_payment_signature', 'Payment could not be verified');
  }
  let p;
  try {
    p = await razorpay.fetchPayment(paymentId);
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus >= 400 && err.upstreamStatus < 500) throw badRequest('payment_not_verified', 'Payment could not be confirmed with the gateway.');
    return { status: 'pending_confirmation' };
  }
  if (p.order_id !== rzpOrderId || (p.currency && p.currency !== 'INR') || Number(p.amount) !== Number(s.amount_paise)) throw badRequest('amount_mismatch', 'Payment does not match this shipment');
  if (p.status === 'authorized') await razorpay.capturePayment(paymentId, Number(s.amount_paise));
  else if (p.status !== 'captured') throw badRequest('payment_not_captured', `Payment status is ${p.status}`);
  const r = await finalizeBagShipment({ shipmentId: s.id, paymentId, amountPaise: Number(p.amount), source: 'verify' });
  if (r.status === 'amount_mismatch') throw conflict('amount_mismatch', 'Payment does not match this shipment');
  if (r.status === 'refund_required') throw conflict('bag_already_shipped', 'These pieces were already sent for shipping, so this payment will be refunded automatically.');
  return { status: 'paid' };
}

/**
 * refund.processed for a shipping fee. Only the fee is refunded: the pieces were paid with credits
 * and stay with their orders, so stock, credits and fulfilment are unchanged. Returns null if the
 * payment is not a bag shipping payment.
 */
export async function recordBagRefund(c, refund) {
  const s = (await c.query('SELECT * FROM bag_shipments WHERE provider_payment_id = $1 FOR UPDATE', [refund?.payment_id])).rows[0];
  if (!s) return null;
  const applied = await applyEntityRefund(c, { table: 'bag_shipments', entityType: 'bag_shipment', row: s, refund, paidPaise: Number(s.amount_paise) });
  if (!applied) return { status: 'already_refunded' };
  await audit(c, {
    actor: 'razorpay_webhook',
    action: applied.full ? 'bag_shipping_refunded' : 'bag_shipping_partial_refund',
    entityType: 'bag_shipment',
    entityId: s.id,
    details: { refund_id: applied.refundId, payment_id: refund.payment_id, amount_paise: applied.refundPaise, refunded_total_paise: applied.totalPaise },
  });
  return {
    status: applied.full ? 'processed' : 'partial',
    notice: { authUserId: s.auth_user_id, amount: applied.refundPaise / 100, what: 'your Wardrobe Bag shipping fee', refundId: applied.refundId },
  };
}

/** Unpaid shipment requests past their window are closed; the picks stay in the bag. */
export async function expireBagShipments() {
  await db.query("UPDATE bag_shipments SET status = 'expired', updated_at = now() WHERE status = 'pending_payment' AND payment_expires_at < now() - interval '1 hour'");
}
