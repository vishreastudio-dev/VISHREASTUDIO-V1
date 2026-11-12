import { config } from './config.js';
import { AppError, badRequest, notFound } from './http.js';
import { hmacHex, razorpay } from './razorpay.js';

/** Fields the browser needs. `checkout_mode` comes only from the server's Razorpay API base. */
export function checkoutFields(fields) {
  if (!fields) return null;
  const { local_confirm, ...rest } = fields;
  if (!config.razorpay.localCheckout) return rest;
  return { ...rest, checkout_mode: 'local', ...(local_confirm ? { local_confirm } : {}) };
}

/**
 * Create a stand-in payment and the same HMAC the hosted checkout would return.
 * Refuses when the API base is real Razorpay. A failed outcome does not return a signature.
 */
export async function issueLocalOrderPayment({ gatewayOrderId, amountPaise, outcome }) {
  if (!config.razorpay.localCheckout) throw notFound('not_found', 'Not found');
  if (!gatewayOrderId) throw badRequest('no_gateway_order', 'This checkout has no payment in progress');
  if (outcome === 'failed') {
    throw badRequest('payment_not_captured', 'The payment did not complete. Nothing was activated. You can try again.');
  }
  if (outcome && outcome !== 'captured') throw badRequest('invalid_outcome', 'Unsupported payment outcome');
  let payment;
  try {
    payment = await razorpay.simulateLocalOrder({ orderId: gatewayOrderId, amountPaise, status: 'captured' });
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus === 404) throw badRequest('payment_not_verified', 'This payment does not belong to this checkout.');
    throw err;
  }
  if (Number(payment.amount) !== Number(amountPaise)) throw badRequest('amount_mismatch', 'Payment amount does not match this checkout');
  const signature = hmacHex(config.razorpay.keySecret, `${gatewayOrderId}|${payment.id}`);
  return { razorpay_order_id: gatewayOrderId, razorpay_payment_id: payment.id, razorpay_signature: signature };
}
