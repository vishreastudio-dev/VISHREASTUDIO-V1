// Send signed Razorpay-style webhooks to a running server (directly or through a tunnel)
// and check the signature handling. Usage: node scripts/webhook-selftest.js https://<host>
// Events reference made-up order ids, so they are recorded as "ignored" and change no order.
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
if (!secret) {
  console.error('RAZORPAY_WEBHOOK_SECRET is not set in .env');
  process.exit(1);
}

const url = `${base}/api/webhooks/razorpay`;
const run = Date.now();
const sign = (raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

function body(event, n) {
  const payment = {
    id: `pay_tunnel_selftest_${run}_${n}`,
    entity: 'payment',
    order_id: `order_tunnel_selftest_${run}_${n}`,
    amount: 189000,
    currency: 'INR',
    status: event === 'payment.failed' ? 'failed' : 'captured',
    ...(event === 'payment.failed' ? { error_code: 'BAD_REQUEST_ERROR', error_description: 'Self-test decline' } : {}),
  };
  return JSON.stringify({ entity: 'event', event, contains: ['payment'], payload: { payment: { entity: payment } }, created_at: Math.floor(run / 1000) });
}

async function send(name, raw, signature, eventId, expectStatus) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId },
    body: raw,
  });
  const text = await r.text();
  const ok = r.status === expectStatus;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${r.status} ${text}`);
  return ok;
}

const results = [];
const captured = body('payment.captured', 1);
results.push(await send('bad signature rejected', captured, 'deadbeef', `evt_selftest_${run}_bad`, 400));
const reformatted = JSON.stringify(JSON.parse(captured), null, 2);
results.push(await send('re-serialized body rejected (raw bytes are signed)', reformatted, sign(captured), `evt_selftest_${run}_reformat`, 400));
results.push(await send('payment.captured accepted', captured, sign(captured), `evt_selftest_${run}_captured`, 200));
results.push(await send('duplicate delivery acknowledged', captured, sign(captured), `evt_selftest_${run}_captured`, 200));
const paid = body('order.paid', 2);
results.push(await send('order.paid accepted', paid, sign(paid), `evt_selftest_${run}_paid`, 200));
const failed = body('payment.failed', 3);
results.push(await send('payment.failed accepted', failed, sign(failed), `evt_selftest_${run}_failed`, 200));

const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} checks passed against ${url}`);
process.exit(passed === results.length ? 0 : 1);
