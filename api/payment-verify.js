import { db } from '../lib/db.js';
import { AppError, badRequest, notFound } from '../lib/http.js';
import { finalizeOrderPayment } from '../lib/payments.js';
import { razorpay, verifyPaymentSignature } from '../lib/razorpay.js';
import { audit } from '../lib/audit.js';
import { log } from '../lib/log.js';
import { text, uuid } from '../lib/validate.js';

export const access = 'user';
export const methods = ['POST'];
export const rateLimitPerUser = { windowMs: 60_000, max: 20 };

export default async function paymentVerify(req, res) {
  const b = req.body || {};
  const orderId = uuid(b.order_id, 'order_id');
  const paymentId = text(b.razorpay_payment_id, { max: 64, field: 'razorpay_payment_id', required: true });
  const signature = text(b.razorpay_signature, { max: 128, field: 'razorpay_signature', required: true });

  const order = (await db.query('SELECT * FROM orders WHERE id = $1 AND auth_user_id = $2', [orderId, req.user.id])).rows[0];
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (!order.razorpay_order_id) throw badRequest('no_gateway_order', 'This order has no payment in progress');
  if (b.razorpay_order_id && b.razorpay_order_id !== order.razorpay_order_id) {
    log.warn('payment.order_mismatch', { order_id: orderId, given: b.razorpay_order_id });
    throw badRequest('payment_order_mismatch', 'This payment does not belong to this order');
  }

  // Signature is computed over the gateway order id stored server-side, never the client's copy.
  if (!verifyPaymentSignature({ razorpayOrderId: order.razorpay_order_id, razorpayPaymentId: paymentId, signature })) {
    await audit(db, { actor: req.user.id, action: 'payment_signature_invalid', entityType: 'order', entityId: orderId, details: { payment_id: paymentId } });
    log.warn('payment.invalid_signature', { order_id: orderId });
    throw badRequest('invalid_payment_signature', 'Payment could not be verified');
  }

  if (order.payment_status === 'paid' && order.razorpay_payment_id === paymentId) {
    return res.json({ ok: true, order_id: order.id, status: 'paid', duplicate: true });
  }

  // Cross-check with the gateway when reachable. The signature already proves authenticity;
  // this additionally confirms amount/currency and captures authorized-only payments.
  let amountPaise = null;
  let gatewayChecked = false;
  try {
    const p = await razorpay.fetchPayment(paymentId);
    gatewayChecked = true;
    if (p.order_id !== order.razorpay_order_id) throw badRequest('payment_order_mismatch', 'This payment does not belong to this order');
    const matches = p.currency === 'INR' && Number(p.amount) === Number(order.amount_paise);
    if (!matches) {
      log.warn('payment.amount_mismatch', { order_id: orderId, amount: p.amount, currency: p.currency, expected: order.amount_paise });
      // An authorization for the wrong amount or currency is not captured.
      if (p.status === 'authorized') throw badRequest('amount_mismatch', 'Payment amount does not match this order');
      if (p.status !== 'captured') throw badRequest('payment_not_captured', `Payment status is ${p.status}`);
      // Already captured: do not fulfil. A value that cannot match the order forces the refund path.
      amountPaise = Number(p.amount) === Number(order.amount_paise) ? -1 : Number(p.amount);
    } else if (p.status === 'authorized') {
      await razorpay.capturePayment(paymentId, order.amount_paise);
    } else if (p.status !== 'captured') {
      throw badRequest('payment_not_captured', `Payment status is ${p.status}`);
    }
  } catch (err) {
    if (err instanceof AppError && err.status < 500) throw err;
    // The gateway answered and refused the lookup (unknown payment, bad request): not an outage.
    if (err instanceof AppError && err.upstreamStatus >= 400 && err.upstreamStatus < 500) {
      log.warn('payment.gateway_rejected_lookup', { order_id: orderId, status: err.upstreamStatus });
      throw badRequest('payment_not_verified', 'Payment could not be confirmed with the gateway. If money was deducted it will be refunded.');
    }
    // The signature already proves this payment belongs to the server-created order with its fixed
    // amount. The background re-check confirms capture and amount with Razorpay once it is reachable.
    gatewayChecked = false;
    log.warn('payment.gateway_crosscheck_unavailable', { order_id: orderId, message: err.message });
  }

  const result = await finalizeOrderPayment({ orderId: order.id, paymentId, signature, amountPaise, source: 'verify', gatewayChecked });
  if (result.status === 'duplicate_payment') {
    return res.status(409).json({
      error: 'duplicate_payment',
      status: 'paid',
      order_id: order.id,
      message: 'This order is already paid. The additional payment is being refunded.',
      request_id: req.id,
    });
  }
  if (result.status === 'paid' || result.status === 'already_paid') {
    return res.json({ ok: true, order_id: order.id, status: 'paid', invoice_number: result.order?.invoice_number || null });
  }
  if (result.status === 'refund_required' || result.status === 'refunded') {
    return res.status(409).json({
      error: 'order_unfulfillable',
      status: result.status,
      order_id: order.id,
      message: 'Your payment was received, but a piece sold out before it completed. A full refund has been initiated.',
      request_id: req.id,
    });
  }
  throw new AppError(409, 'payment_not_applied', 'Payment could not be applied to this order');
}
