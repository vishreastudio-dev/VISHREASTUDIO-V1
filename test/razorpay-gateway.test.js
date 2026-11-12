// Gateway client against a local Razorpay API stand-in. No database required.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';

const SECRET = 'gateway-test-secret';
const calls = [];
const orders = new Map();
const payments = new Map();

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = body ? JSON.parse(body) : {};
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: json });
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'POST' && req.url === '/orders') {
      if (!Number.isInteger(json.amount)) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'amount must be integer paise' } });
      const o = { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: json.amount, currency: json.currency, receipt: json.receipt, status: 'created' };
      orders.set(o.id, o);
      return send(200, o);
    }
    const m = req.url.match(/^\/payments\/([^/]+)(\/(capture|refund))?$/);
    if (m) {
      const p = payments.get(decodeURIComponent(m[1]));
      if (!p) return send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
      if (m[3] === 'capture') {
        if (json.amount !== p.amount) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'capture amount mismatch' } });
        p.status = 'captured';
      }
      if (m[3] === 'refund') return send(200, { id: 'rfnd_1', payment_id: p.id, amount: json.amount, status: 'processed' });
      return send(200, p);
    }
    send(404, {});
  });
});

let razorpay;
let verifyPaymentSignature;
let toPaise;

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_SILENT: 'true',
    JWT_SECRET: 'gateway-test-jwt-secret-0123456789abcdef',
    RAZORPAY_KEY_ID: 'rzp_test_gateway',
    RAZORPAY_KEY_SECRET: SECRET,
    RAZORPAY_WEBHOOK_SECRET: 'gateway-webhook-secret',
    RAZORPAY_API_BASE: `http://127.0.0.1:${server.address().port}`,
  });
  ({ razorpay, verifyPaymentSignature } = await import('../lib/razorpay.js'));
  ({ toPaise } = await import('../lib/pricing.js'));
});

after(() => new Promise((r) => server.close(r)));

test('order → authorize → verify signature → capture → refund', async () => {
  const amountPaise = toPaise(2039.1);
  assert.equal(amountPaise, 203910);

  const order = await razorpay.createOrder({ amountPaise, receipt: 'ord-123', notes: { order_id: 'ord-123' } });
  assert.equal(order.amount, 203910);
  assert.equal(order.currency, 'INR');
  const expectedAuth = `Basic ${Buffer.from(`rzp_test_gateway:${SECRET}`).toString('base64')}`;
  assert.equal(calls.at(-1).auth, expectedAuth);

  const paymentId = 'pay_gateway_1';
  payments.set(paymentId, { id: paymentId, order_id: order.id, amount: order.amount, currency: 'INR', status: 'authorized' });
  const signature = crypto.createHmac('sha256', SECRET).update(`${order.id}|${paymentId}`).digest('hex');
  assert.equal(verifyPaymentSignature({ razorpayOrderId: order.id, razorpayPaymentId: paymentId, signature }), true);
  assert.equal(verifyPaymentSignature({ razorpayOrderId: 'order_forged', razorpayPaymentId: paymentId, signature }), false);

  const fetched = await razorpay.fetchPayment(paymentId);
  assert.equal(fetched.status, 'authorized');
  const captured = await razorpay.capturePayment(paymentId, amountPaise);
  assert.equal(captured.status, 'captured');

  const refund = await razorpay.refundPayment(paymentId, amountPaise, { reason: 'test' });
  assert.equal(refund.amount, amountPaise);
});

test('gateway errors surface as safe 502 errors without leaking details', async () => {
  await assert.rejects(razorpay.fetchPayment('pay_missing'), (err) => err.status === 502 && err.code === 'payment_gateway_error');
});
