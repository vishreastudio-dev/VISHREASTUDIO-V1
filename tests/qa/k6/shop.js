// k6 scenario for the isolated QA stack only (http://127.0.0.1:3100, stand-in :3190).
// Run through tests/qa/run-k6.mjs, which prepares scratch/qa/k6-data.json (QA-only tokens).
//   VUS=10 DURATION=2m k6 run tests/qa/k6/shop.js
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const data = JSON.parse(open('../../../scratch/qa/k6-data.json'));
const BASE = data.base;
const GATEWAY = data.gateway;
if (!/^http:\/\/127\.0\.0\.1:3100$/.test(BASE)) throw new Error('k6 target must be the isolated QA stack');

const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '2m';

export const options = {
  scenarios: {
    shop: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:browse}': ['p(95)<500'],
    'http_req_duration{kind:account}': ['p(95)<800'],
    'http_req_duration{kind:checkout}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const paidOrders = new Counter('paid_orders');
const duplicateVerifies = new Counter('duplicate_verify_ok');
const checkoutFlow = new Trend('checkout_flow_ms', true);

function headers(vu, token) {
  // Load profile: TRUST_PROXY=1, so each VU is its own client IP (production sits behind one proxy).
  const h = { 'Content-Type': 'application/json', Origin: BASE, 'X-Forwarded-For': `10.77.${Math.floor(vu / 250)}.${vu % 250 + 1}` };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const get = (url, vu, token, kind) => http.get(`${BASE}${url}`, { headers: headers(vu, token), tags: { kind, name: url.split('?')[0] } });
const post = (url, body, vu, token, kind, method = 'POST') =>
  http.request(method, `${BASE}${url}`, JSON.stringify(body), { headers: headers(vu, token), tags: { kind, name: url } });

export default function () {
  const vu = __VU;
  const token = data.tokens[(vu - 1) % data.tokens.length];

  // Browse: catalogue page, filtered catalogue, product details.
  const page = 1 + Math.floor(Math.random() * 10);
  const cat = get(`/api/catalogue?page=${page}&limit=24`, vu, null, 'browse');
  check(cat, { 'catalogue 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
  const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];
  const prod = get(`/api/product?slug=${slug}`, vu, null, 'browse');
  check(prod, { 'product 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
  if (Math.random() < 0.3) {
    check(get('/api/catalogue?q=qa&sort=newest', vu, null, 'browse'), { 'search 200': (r) => r.status === 200 });
    sleep(1);
  }

  // Signed-in: account and bag (about half of iterations).
  if (Math.random() < 0.5) {
    check(get('/api/account', vu, token, 'account'), { 'account 200': (r) => r.status === 200 });
    const add = post('/api/cart', { variant_id: data.variant, quantity: 1 }, vu, token, 'account');
    check(add, { 'bag add 200': (r) => r.status === 200 });
    sleep(1 + Math.random());
    check(post('/api/cart', { variant_id: data.variant }, vu, token, 'account', 'DELETE'), { 'bag remove 200': (r) => r.status === 200 });
    sleep(1);
  }

  // Checkout + simulated payment (about 1 in 8 iterations).
  if (Math.random() < 0.125) {
    const started = Date.now();
    post('/api/cart', { all: true }, vu, token, 'checkout', 'DELETE');
    post('/api/cart', { variant_id: data.variant, quantity: 1 }, vu, token, 'checkout');
    const co = post('/api/checkout', { shipping_method: 'delivery', shipping_address: data.address, idempotency_key: `k6-${vu}-${__ITER}-${Date.now()}` }, vu, token, 'checkout');
    const ok = check(co, { 'checkout 201/200': (r) => r.status === 201 || r.status === 200 });
    if (ok) {
      const body = co.json();
      const pay = http.post(`${GATEWAY}/__pay`, JSON.stringify({ order_id: body.razorpay.order_id }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'gateway', name: '/__pay' } });
      const paymentId = pay.json('id');
      const signature = crypto.hmac('sha256', data.razorpaySecret, `${body.razorpay.order_id}|${paymentId}`, 'hex');
      const payload = { order_id: body.order_id, razorpay_payment_id: paymentId, razorpay_signature: signature };
      const verify = post('/api/payment-verify', payload, vu, token, 'checkout');
      if (check(verify, { 'verify paid': (r) => r.status === 200 && r.json('status') === 'paid' })) paidOrders.add(1);
      const again = post('/api/payment-verify', payload, vu, token, 'checkout');
      if (check(again, { 'repeat verify is idempotent': (r) => r.status === 200 })) duplicateVerifies.add(1);
    }
    checkoutFlow.add(Date.now() - started);
    sleep(2);
  }
  sleep(1 + Math.random() * 2);
}
