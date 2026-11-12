import crypto from 'crypto';
import { config } from './config.js';
import { AppError } from './http.js';
import { log } from './log.js';

function safeEqualHex(expectedHex, givenHex) {
  if (typeof givenHex !== 'string' || !/^[0-9a-f]+$/i.test(givenHex)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(givenHex.toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/** Checkout handler signature: HMAC_SHA256(key_secret, `${order_id}|${payment_id}`). */
export function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!config.razorpay.keySecret) throw new AppError(503, 'razorpay_not_configured', 'Payments are not configured');
  if (!razorpayOrderId || !razorpayPaymentId) return false;
  return safeEqualHex(hmacHex(config.razorpay.keySecret, `${razorpayOrderId}|${razorpayPaymentId}`), signature);
}

/** Subscription checkout signature: HMAC_SHA256(key_secret, `${payment_id}|${subscription_id}`). */
export function verifySubscriptionSignature({ razorpaySubscriptionId, razorpayPaymentId, signature }) {
  if (!config.razorpay.keySecret) throw new AppError(503, 'razorpay_not_configured', 'Payments are not configured');
  if (!razorpaySubscriptionId || !razorpayPaymentId) return false;
  return safeEqualHex(hmacHex(config.razorpay.keySecret, `${razorpayPaymentId}|${razorpaySubscriptionId}`), signature);
}

/** Webhook signature: HMAC_SHA256(webhook_secret, raw request body). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) return false;
  return safeEqualHex(hmacHex(config.razorpay.webhookSecret, rawBody), signature);
}

async function call(path, { method = 'GET', body, timeoutMs = 15_000 } = {}) {
  if (!config.razorpay.configured) throw new AppError(503, 'razorpay_not_configured', 'Payments are not configured yet');
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${config.razorpay.apiBase}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      log.warn('razorpay.api_error', { path, status: r.status, code: data?.error?.code, description: data?.error?.description });
      const e = new AppError(502, 'payment_gateway_error', 'The payment gateway rejected the request. Please try again.');
      e.upstreamStatus = r.status;
      throw e;
    }
    return data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.warn('razorpay.network_error', { path, message: err.name === 'AbortError' ? 'timeout' : err.message });
    throw new AppError(502, 'payment_gateway_unreachable', 'Could not reach the payment gateway. Please try again.');
  } finally {
    clearTimeout(timer);
  }
}

export const razorpay = {
  get configured() {
    return config.razorpay.configured;
  },
  get keyId() {
    return config.razorpay.keyId;
  },
  createOrder({ amountPaise, receipt, notes }) {
    return call('/orders', { method: 'POST', body: { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes } });
  },
  fetchPayment(paymentId) {
    return call(`/payments/${encodeURIComponent(paymentId)}`);
  },
  capturePayment(paymentId, amountPaise) {
    return call(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: 'POST', body: { amount: amountPaise, currency: 'INR' } });
  },
  refundPayment(paymentId, amountPaise, notes, { timeoutMs = 4_000, receipt } = {}) {
    const body = { amount: amountPaise, notes };
    if (receipt) body.receipt = String(receipt).slice(0, 40);
    return call(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body, timeoutMs });
  },
  cancelSubscription(subscriptionId) {
    return call(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: 'POST', body: { cancel_at_cycle_end: 0 } });
  },
  fetchPlan(planId) {
    return call(`/plans/${encodeURIComponent(planId)}`);
  },
  createPlan({ amountPaise, name, description }) {
    return call('/plans', { method: 'POST', body: { period: 'monthly', interval: 1, item: { name, amount: amountPaise, currency: 'INR', description } } });
  },
  /**
   * A monthly subscription. With `startAt` in the future the first monthly debit happens then, and the
   * `upfrontPaise` add-on is charged with the authorisation transaction at checkout.
   */
  createSubscription({ planId, totalCount, startAt = null, upfrontPaise = 0, upfrontLabel, notes, notifyCustomer = false }) {
    const body = { plan_id: planId, total_count: totalCount, quantity: 1, customer_notify: notifyCustomer ? 1 : 0, notes };
    if (startAt) body.start_at = Math.floor(new Date(startAt).getTime() / 1000);
    if (upfrontPaise > 0) body.addons = [{ item: { name: String(upfrontLabel || 'Upfront').slice(0, 80), amount: upfrontPaise, currency: 'INR' } }];
    return call('/subscriptions', { method: 'POST', body });
  },
  fetchSubscription(subscriptionId) {
    return call(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  },
  /**
   * Register a captured payment on the local stand-in only. Production never calls this: the
   * hosted checkout creates the payment, and `localCheckout` is false for api.razorpay.com.
   */
  simulateLocalOrder({ orderId, amountPaise, status = 'captured' }) {
    if (!config.razorpay.localCheckout) throw new AppError(404, 'not_found', 'Not found');
    return call('/__pay', { method: 'POST', body: { order_id: orderId, amount: amountPaise, status } });
  },
  simulateLocalCheckout({ subscriptionId, amountPaise, status = 'captured' }) {
    if (!config.razorpay.localCheckout) throw new AppError(404, 'not_found', 'Not found');
    return call('/__checkout', { method: 'POST', body: { subscription_id: subscriptionId, amount: amountPaise, status } });
  },
  pauseSubscription(subscriptionId) {
    return call(`/subscriptions/${encodeURIComponent(subscriptionId)}/pause`, { method: 'POST', body: { pause_at: 'now' } });
  },
  resumeSubscription(subscriptionId) {
    return call(`/subscriptions/${encodeURIComponent(subscriptionId)}/resume`, { method: 'POST', body: { resume_at: 'now' } });
  },
  fetchInvoice(invoiceId) {
    return call(`/invoices/${encodeURIComponent(invoiceId)}`);
  },
};
