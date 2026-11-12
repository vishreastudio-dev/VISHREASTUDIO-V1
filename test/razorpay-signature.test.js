// Signature checks with a fixed secret. Environment is set before the modules load so
// a developer .env cannot change the vectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unit';
process.env.RAZORPAY_KEY_SECRET = 'unit-test-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-webhook-secret';
process.env.JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef';

const { verifyPaymentSignature, verifyWebhookSignature, hmacHex } = await import('../lib/razorpay.js');

const secret = 'unit-test-secret';
const orderId = 'order_unit_1';
const paymentId = 'pay_unit_1';
const good = hmacHex(secret, `${orderId}|${paymentId}`);

test('payment signature accepts the Razorpay order|payment payload and rejects tampering', () => {
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, signature: good }), true);
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, signature: good.toUpperCase() }), true);
  const flipped = `${good.slice(0, -1)}${good.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, signature: flipped }), false);
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: 'pay_other', signature: good }), false);
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, signature: 'zz' }), false);
  assert.equal(verifyPaymentSignature({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, signature: '' }), false);
});

test('webhook signature is over the raw body bytes', () => {
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId } } } });
  const sig = crypto.createHmac('sha256', 'unit-webhook-secret').update(raw).digest('hex');
  assert.equal(verifyWebhookSignature(raw, sig), true);
  assert.equal(verifyWebhookSignature(Buffer.from(raw), sig), true);
  assert.equal(verifyWebhookSignature(raw + ' ', sig), false);
  assert.equal(verifyWebhookSignature(raw, undefined), false);
});
