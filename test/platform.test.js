import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, authoriseSubscription, ctx, dbSkipReason, DELIVERY, fakeMp4, fakePng, gateway, login, pay, recurringPayment, setup, teardown, uniqueEmail, variantOf, webhookBody, webhookSignature, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();

/** Join with the upfront months and a UPI Autopay mandate; returns the subscription id. */
async function joinMembership(cookie) {
  const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const a = await api('POST', '/api/membership', { action: 'activate_paid', ...authoriseSubscription(start.data.razorpay.subscription_id) }, { cookie });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return start.data.razorpay.subscription_id;
}

async function cartWith(cookie, variantId, quantity = 1) {
  await api('DELETE', '/api/cart', { all: true }, { cookie });
  const r = await api('POST', '/api/cart', { variant_id: variantId, quantity }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

async function freshOneOfOne(adminCookie, name, price = 2000) {
  const r = await api('POST', '/api/admin/ops?section=product', { name, price_inr: price, category: 'Tops', is_one_of_one: true }, { cookie: adminCookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.product;
}

let admin;

describe('Vishrea Studio platform', { skip, timeout: 600_000 }, () => {
before(async () => {
  await setup();
  admin = await login(ADMIN_EMAIL);
}, { timeout: 120_000 });
after(teardown);

describe('authentication', () => {
  test('OTP is single-use, attempt-limited and never grants admin by email pattern', async () => {
    const email = uniqueEmail('admin.lookalike');
    const s = await api('POST', '/api/auth/start-login', { email });
    assert.equal(s.status, 200);
    assert.match(s.data.debug_code, /^\d{6}$/);

    const wrong = s.data.debug_code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) assert.equal((await api('POST', '/api/auth/verify-code', { email, code: wrong })).status, 400);
    assert.equal((await api('POST', '/api/auth/verify-code', { email, code: s.data.debug_code })).status, 400, 'locked after 5 attempts');

    const fresh = uniqueEmail('admin');
    const { cookie, user } = await login(fresh);
    assert.equal(user.is_admin, false, 'an email containing "admin" must not become admin');
    assert.equal((await api('GET', '/api/admin/ops?section=dashboard', undefined, { cookie })).status, 403);
  });

  test('a used code cannot be replayed', async () => {
    const email = uniqueEmail();
    const s = await api('POST', '/api/auth/start-login', { email });
    assert.equal((await api('POST', '/api/auth/verify-code', { email, code: s.data.debug_code })).status, 200);
    assert.equal((await api('POST', '/api/auth/verify-code', { email, code: s.data.debug_code })).status, 400);
  });

  test('resend is throttled', async () => {
    const email = uniqueEmail();
    assert.equal((await api('POST', '/api/auth/start-login', { email })).status, 200);
    assert.equal((await api('POST', '/api/auth/start-login', { email })).status, 429);
  });

  test('sign-out revokes the session server-side', async () => {
    const { cookie } = await login(uniqueEmail());
    assert.notEqual((await api('GET', '/api/auth/session', undefined, { cookie })).data.user, null);
    await new Promise((r) => setTimeout(r, 1100));
    await api('POST', '/api/auth/signout', {}, { cookie });
    assert.equal((await api('GET', '/api/auth/session', undefined, { cookie })).data.user, null);
    assert.equal((await api('GET', '/api/orders', undefined, { cookie })).status, 401);
  });

  test('signing out in the same second as signing in still revokes the session', async () => {
    const { cookie } = await login(uniqueEmail());
    await api('POST', '/api/auth/signout', {}, { cookie });
    assert.equal((await api('GET', '/api/auth/session', undefined, { cookie })).data.user, null);
    assert.equal((await api('GET', '/api/account', undefined, { cookie })).status, 401);
  });

  test('login response does not expose the session token to JavaScript', async () => {
    const email = uniqueEmail();
    const s = await api('POST', '/api/auth/start-login', { email });
    const v = await api('POST', '/api/auth/verify-code', { email, code: s.data.debug_code });
    assert.equal(v.data.token, undefined);
    assert.match(v.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(v.headers.get('set-cookie'), /SameSite=Lax/i);
  });
});

describe('access control', () => {
  test('anonymous and customer callers are rejected from protected APIs', async () => {
    assert.equal((await api('GET', '/api/orders')).status, 401);
    assert.equal((await api('GET', '/api/admin/ops?section=orders')).status, 401);
    const { cookie } = await login(uniqueEmail());
    assert.equal((await api('POST', '/api/admin/ops?section=product', { name: 'x', price_inr: 1 }, { cookie })).status, 403);
  });

  test('customers cannot read each other\'s orders', async () => {
    const a = await login(uniqueEmail('a'));
    const b = await login(uniqueEmail('b'));
    const product = await freshOneOfOne(admin.cookie, `IDOR Piece ${Date.now()}`);
    await cartWith(a.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: a.cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    assert.equal((await api('GET', `/api/orders?id=${co.data.order_id}`, undefined, { cookie: b.cookie })).status, 404);
    assert.equal((await api('POST', '/api/checkout', { action: 'cancel', order_id: co.data.order_id }, { cookie: b.cookie })).status, 404);
  });

  test('the retired Request a Piece API is gone', async () => {
    assert.equal((await api('POST', '/api/piece-requests', { name: 'X', email: 'x@example.test', phone: '+91 9876543210', description: 'd' })).status, 404);
    assert.equal((await api('GET', '/api/admin/ops?section=piece_requests', undefined, { cookie: admin.cookie })).status, 400);
    const dash = await api('GET', '/api/admin/ops?section=dashboard', undefined, { cookie: admin.cookie });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.new_piece_requests, undefined);
  });
});

describe('pricing and checkout', () => {
  test('server ignores client prices and computes GST-inclusive totals', async () => {
    const { cookie } = await login(uniqueEmail());
    const v = await variantOf('premium-silk-column-dress', 'Large');
    const add = await api('POST', '/api/cart', { variant_id: v.id, quantity: 1, price_inr: 1, unit_price: 1 }, { cookie });
    assert.equal(add.data.items[0].unit_price, 5200, 'sale price from the database');
    const co = await api('POST', '/api/checkout', { ...DELIVERY, total: 10, subtotal: 10 }, { cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    assert.equal(co.data.totals.total, 5299);
    assert.equal(co.data.razorpay.amount, 529900);
    assert.equal(gateway.orders.get(co.data.razorpay.order_id).amount, 529900);
    // 5200 > 2500 threshold → 18%; Karnataka → CGST + SGST
    assert.ok(co.data.totals.cgst > 0 && co.data.totals.sgst > 0 && Number(co.data.totals.igst) === 0);
    await api('POST', '/api/checkout', { action: 'cancel', order_id: co.data.order_id }, { cookie });
  });

  test('inter-state delivery uses IGST; pickup is free and intra-state', async () => {
    const { cookie } = await login(uniqueEmail());
    const v = await variantOf('premium-silk-column-dress', 'Medium');
    await cartWith(cookie, v.id);
    const co = await api('POST', '/api/checkout', { ...DELIVERY, shipping_address: { ...DELIVERY.shipping_address, state: 'Maharashtra' } }, { cookie });
    assert.equal(co.status, 201);
    assert.ok(Number(co.data.totals.igst) > 0 && Number(co.data.totals.cgst) === 0);
    await api('POST', '/api/checkout', { action: 'cancel', order_id: co.data.order_id }, { cookie });
    const pickup = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'Asha', phone: '+91 98450 00000' } }, { cookie });
    assert.equal(Number(pickup.data.totals.shipping), 0);
    assert.equal(Number(pickup.data.totals.total), 5400);
    await api('POST', '/api/checkout', { action: 'cancel', order_id: pickup.data.order_id }, { cookie });
  });

  test('two customers racing for the same one-of-one: exactly one wins', async () => {
    const product = await freshOneOfOne(admin.cookie, `Race Piece ${Date.now()}`);
    const buyers = await Promise.all([login(uniqueEmail('r1')), login(uniqueEmail('r2'))]);
    for (const b of buyers) await cartWith(b.cookie, product.variants[0].id);
    const results = await Promise.all(buyers.map((b) => api('POST', '/api/checkout', DELIVERY, { cookie: b.cookie })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify(results.map((r) => r.data)));
    assert.equal(results.find((r) => r.status === 409).data.error, 'out_of_stock');
    const stock = (await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0].stock_quantity;
    assert.equal(stock, 0);
  });

  test('twenty buyers for three units: three succeed, stock never negative', async () => {
    const r = await api('POST', '/api/admin/ops?section=product', { name: `Limited ${Date.now()}`, is_one_of_one: false, category: 'Dresses', variants: [{ size_label: 'M', price_inr: 3000, stock_quantity: 3 }] }, { cookie: admin.cookie });
    const variantId = r.data.product.variants[0].id;
    const buyers = await Promise.all(Array.from({ length: 20 }, () => login(uniqueEmail('crowd'))));
    for (const b of buyers) await cartWith(b.cookie, variantId);
    const results = await Promise.all(buyers.map((b) => api('POST', '/api/checkout', DELIVERY, { cookie: b.cookie })));
    assert.equal(results.filter((x) => x.status === 201).length, 3);
    assert.equal(results.filter((x) => x.status === 409).length, 17);
    const v = (await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).rows[0];
    assert.equal(v.stock_quantity, 0);
  });

  test('double-submitted checkout reuses one order and one stock hold', async () => {
    const { cookie } = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Double Click ${Date.now()}`);
    await cartWith(cookie, product.variants[0].id);
    const [a, b] = await Promise.all([
      api('POST', '/api/checkout', { ...DELIVERY, idempotency_key: 'k1' }, { cookie }),
      api('POST', '/api/checkout', { ...DELIVERY, idempotency_key: 'k1' }, { cookie }),
    ]);
    assert.ok([a.status, b.status].every((s) => s === 200 || s === 201), JSON.stringify([a.data, b.data]));
    assert.equal(a.data.order_id, b.data.order_id);
    const held = await ctx.db.query("SELECT count(*)::int AS n FROM inventory_reservations WHERE variant_id = $1 AND status = 'held'", [product.variants[0].id]);
    assert.equal(held.rows[0].n, 1);
  });

  test('gateway failure releases the stock hold', async () => {
    const { cookie } = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Gateway Down ${Date.now()}`);
    await cartWith(cookie, product.variants[0].id);
    gateway.failNextOrder = true;
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie });
    assert.equal(co.status, 502);
    const v = (await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0];
    assert.equal(v.stock_quantity, 1);
  });
});

describe('payment verification', () => {
  async function pendingOrder(name) {
    const buyer = await login(uniqueEmail('pay'));
    const product = await freshOneOfOne(admin.cookie, name);
    await cartWith(buyer.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    return { buyer, product, co: co.data };
  }

  test('invalid signature, foreign order and wrong order id are rejected', async () => {
    const { buyer, co } = await pendingOrder(`Sig ${Date.now()}`);
    const p = pay(co.razorpay.order_id);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...p, razorpay_signature: 'ab'.repeat(32) }, { cookie: buyer.cookie })).status, 400);

    const other = await pendingOrder(`Sig Other ${Date.now()}`);
    const p2 = pay(other.co.razorpay.order_id);
    // Signature is valid for the other order, not this one.
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, razorpay_payment_id: p2.razorpay_payment_id, razorpay_signature: p2.razorpay_signature }, { cookie: buyer.cookie })).status, 400);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...p, razorpay_order_id: other.co.razorpay.order_id }, { cookie: buyer.cookie })).status, 400);
    const o = (await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'pending');
  });

  test('valid payment is applied once; duplicate verification is idempotent', async () => {
    const { buyer, co } = await pendingOrder(`Pay Once ${Date.now()}`);
    const p = pay(co.razorpay.order_id);
    const [r1, r2] = await Promise.all([
      api('POST', '/api/payment-verify', { order_id: co.order_id, ...p }, { cookie: buyer.cookie }),
      api('POST', '/api/payment-verify', { order_id: co.order_id, ...p }, { cookie: buyer.cookie }),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const inv = await ctx.db.query('SELECT count(*)::int AS n FROM invoice_records WHERE order_id = $1', [co.order_id]);
    assert.equal(inv.rows[0].n, 1);
    const res = await ctx.db.query("SELECT status FROM inventory_reservations WHERE order_id = $1", [co.order_id]);
    assert.deepEqual(res.rows.map((x) => x.status), ['committed']);
    const detail = await api('GET', `/api/orders?id=${co.order_id}`, undefined, { cookie: buyer.cookie });
    assert.equal(detail.data.order.payment_status, 'paid');
    assert.match(detail.data.invoice.invoice_number, /^VS\/\d{4}-\d{2}\/\d{6}$/);
    const cart = await api('GET', '/api/cart', undefined, { cookie: buyer.cookie });
    assert.equal(cart.data.items.length, 0, 'purchased items leave the bag');
  });

  test('amount mismatch reported by the gateway does not mark the order paid', async () => {
    const { buyer, co } = await pendingOrder(`Tamper ${Date.now()}`);
    const p = pay(co.razorpay.order_id, { amount: 100 });
    const r = await api('POST', '/api/payment-verify', { order_id: co.order_id, ...p }, { cookie: buyer.cookie });
    assert.equal(r.status, 409);
    const o = (await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.notEqual(o.payment_status, 'paid');
  });

  test('webhook: bad signature rejected; repeated delivery yields one state change', async () => {
    const { co } = await pendingOrder(`Webhook ${Date.now()}`);
    const p = pay(co.razorpay.order_id);
    const payment = { id: p.razorpay_payment_id, order_id: co.razorpay.order_id, amount: co.razorpay.amount, currency: 'INR', status: 'captured', email: 'secret-buyer@example.test', contact: '9999999999' };
    const raw = webhookBody('payment.captured', payment);
    const bad = await api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'deadbeef', 'X-Razorpay-Event-Id': 'evt_bad' } });
    assert.equal(bad.status, 400);

    const send = (eventId) => api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': eventId } });
    const burst = await Promise.all(Array.from({ length: 5 }, () => send('evt_same')));
    assert.ok(burst.every((r) => r.status === 200), JSON.stringify(burst.map((r) => r.data)));
    for (let i = 0; i < 5; i += 1) assert.equal((await send(`evt_retry_${i}`)).status, 200);

    const o = (await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'paid');
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM invoice_records WHERE order_id = $1', [co.order_id])).rows[0].n, 1);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'order_paid' AND entity_id = $1", [co.order_id])).rows[0].n, 1);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM payment_events WHERE event_id = 'evt_same'")).rows[0].n, 1);
    const stored = (await ctx.db.query("SELECT payload FROM payment_events WHERE event_id = 'evt_same'")).rows[0].payload;
    assert.equal(stored.payment_id, p.razorpay_payment_id);
    assert.equal(stored.email, undefined);
    assert.equal(JSON.stringify(stored).includes('secret-buyer'), false);
  });

  test('failed payment keeps the hold for retry; cancel releases it; unknown order is 404', async () => {
    const { buyer, co, product } = await pendingOrder(`Fail Then Cancel ${Date.now()}`);
    const raw = webhookBody('payment.failed', { id: 'pay_failed_1', order_id: co.razorpay.order_id, amount: co.razorpay.amount, error_description: 'Card declined' });
    const r = await api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_fail_${Date.now()}` } });
    assert.equal(r.status, 200);
    const o = (await ctx.db.query('SELECT payment_status, payment_failure_reason FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'pending');
    assert.equal(o.payment_failure_reason, 'Card declined');
    assert.equal((await api('POST', '/api/checkout', { action: 'resume', order_id: co.order_id }, { cookie: buyer.cookie })).status, 200);

    assert.equal((await api('POST', '/api/checkout', { action: 'cancel', order_id: co.order_id }, { cookie: buyer.cookie })).status, 200);
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0].stock_quantity, 1);
    assert.equal((await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0].payment_status, 'cancelled');
    assert.equal((await api('POST', '/api/payment-verify', { order_id: '00000000-0000-4000-8000-000000000000', ...pay(co.razorpay.order_id) }, { cookie: buyer.cookie })).status, 404);
  });

  test('stale bag price: checkout charges the current database price', async () => {
    const buyer = await login(uniqueEmail('stale'));
    const product = await freshOneOfOne(admin.cookie, `Price Change ${Date.now()}`, 2000);
    await cartWith(buyer.cookie, product.variants[0].id);
    await ctx.db.query('UPDATE product_variants SET price_inr = 2600 WHERE id = $1', [product.variants[0].id]);
    const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'S', phone: '+91 9000000002' } }, { cookie: buyer.cookie });
    assert.equal(co.status, 201);
    assert.equal(Number(co.data.totals.total), 2600);
    assert.equal(co.data.razorpay.amount, 260000);
  });

  test('expired hold + late webhook: re-acquires stock when still available', async () => {
    const { co, product } = await pendingOrder(`Late OK ${Date.now()}`);
    await ctx.db.query("UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1", [co.order_id]);
    const { sweepExpiredOrders } = await import('../lib/inventory.js');
    await sweepExpiredOrders();
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0].stock_quantity, 1);
    const p = pay(co.razorpay.order_id);
    const raw = webhookBody('payment.captured', { id: p.razorpay_payment_id, order_id: co.razorpay.order_id, amount: co.razorpay.amount, currency: 'INR' });
    const r = await api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_late_${Date.now()}` } });
    assert.equal(r.status, 200);
    assert.equal((await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0].payment_status, 'paid');
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0].stock_quantity, 0);
  });

  test('expired hold + late payment after someone else bought it: refund, no oversell', async () => {
    const first = await pendingOrder(`Late Lost ${Date.now()}`);
    await ctx.db.query("UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1", [first.co.order_id]);
    const { sweepExpiredOrders } = await import('../lib/inventory.js');
    await sweepExpiredOrders();
    const second = await login(uniqueEmail('winner'));
    await cartWith(second.cookie, first.product.variants[0].id);
    const co2 = await api('POST', '/api/checkout', DELIVERY, { cookie: second.cookie });
    assert.equal(co2.status, 201);

    const refundsBefore = gateway.refunds.length;
    const p = pay(first.co.razorpay.order_id);
    const r = await api('POST', '/api/payment-verify', { order_id: first.co.order_id, ...p }, { cookie: first.buyer.cookie });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'order_unfulfillable');
    assert.equal(gateway.refunds.length, refundsBefore + 1, 'automatic refund requested');
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [first.product.variants[0].id])).rows[0].stock_quantity, 0);
    const refunded = (await ctx.db.query('SELECT payment_status, razorpay_refund_id, refunded_at FROM orders WHERE id = $1', [first.co.order_id])).rows[0];
    assert.equal(refunded.payment_status, 'refunded');
    assert.equal(refunded.razorpay_refund_id, gateway.refunds.at(-1).id, 'Razorpay refund reference stored for the customer');
    assert.ok(refunded.refunded_at);
    const view = await api('GET', `/api/orders?id=${first.co.order_id}`, undefined, { cookie: first.buyer.cookie });
    assert.equal(view.data.order.razorpay_refund_id, refunded.razorpay_refund_id);
  });

  test('a second capture on an already paid order is refunded once', async () => {
    const { buyer, co } = await pendingOrder(`Double Capture ${Date.now()}`);
    const first = pay(co.razorpay.order_id);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...first }, { cookie: buyer.cookie })).status, 200);
    const second = pay(co.razorpay.order_id);
    const before = gateway.refunds.length;
    const extra = await api('POST', '/api/payment-verify', { order_id: co.order_id, ...second }, { cookie: buyer.cookie });
    assert.equal(extra.status, 409);
    assert.equal(extra.data.error, 'duplicate_payment');
    assert.equal(gateway.refunds.length, before + 1);
    assert.equal(gateway.refunds.at(-1).payment_id, second.razorpay_payment_id);
    await api('POST', '/api/payment-verify', { order_id: co.order_id, ...second }, { cookie: buyer.cookie });
    assert.equal(gateway.refunds.length, before + 1);
    assert.equal((await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.order_id])).rows[0].payment_status, 'paid');
  });

  test('simultaneous refunds of one unfulfillable payment are issued once', async () => {
    const first = await pendingOrder(`Race Refund ${Date.now()}`);
    await ctx.db.query("UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1", [first.co.order_id]);
    const { sweepExpiredOrders } = await import('../lib/inventory.js');
    await sweepExpiredOrders();
    const winner = await login(uniqueEmail('racewin'));
    await cartWith(winner.cookie, first.product.variants[0].id);
    assert.equal((await api('POST', '/api/checkout', DELIVERY, { cookie: winner.cookie })).status, 201);
    const p = pay(first.co.razorpay.order_id);
    const before = gateway.refunds.length;
    const [a, b] = await Promise.all([
      api('POST', '/api/payment-verify', { order_id: first.co.order_id, ...p }, { cookie: first.buyer.cookie }),
      api('POST', '/api/payment-verify', { order_id: first.co.order_id, ...p }, { cookie: first.buyer.cookie }),
    ]);
    assert.ok([a.status, b.status].every((s) => s === 409));
    assert.equal(gateway.refunds.filter((r) => r.payment_id === p.razorpay_payment_id).length, 1);
    assert.equal(gateway.refunds.length, before + 1);
  });

  test('gateway unreachable at verify: paid on signature, then confirmed by reconciliation', async () => {
    const { reconcilePayments } = await import('../lib/payments.js');
    const { buyer, co } = await pendingOrder(`Recheck OK ${Date.now()}`);
    const p = pay(co.razorpay.order_id);
    gateway.failNextPaymentFetch = true;
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...p }, { cookie: buyer.cookie })).status, 200);
    let o = (await ctx.db.query('SELECT payment_status, gateway_checked_at FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'paid');
    assert.equal(o.gateway_checked_at, null, 'not yet confirmed with Razorpay');
    const out = await reconcilePayments();
    assert.ok(out.rechecked >= 1);
    o = (await ctx.db.query('SELECT payment_status, gateway_checked_at FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'paid');
    assert.ok(o.gateway_checked_at);
  });

  test('gateway unreachable at verify with a tampered amount: reconciliation refunds and restocks', async () => {
    const { reconcilePayments } = await import('../lib/payments.js');
    const { buyer, co, product } = await pendingOrder(`Recheck Tamper ${Date.now()}`);
    const p = pay(co.razorpay.order_id, { amount: 100 });
    gateway.failNextPaymentFetch = true;
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...p }, { cookie: buyer.cookie })).status, 200);
    const before = gateway.refunds.length;
    await reconcilePayments();
    const o = (await ctx.db.query('SELECT status, payment_status, payment_failure_reason, razorpay_refund_id FROM orders WHERE id = $1', [co.order_id])).rows[0];
    assert.equal(o.payment_status, 'refunded');
    assert.equal(o.status, 'refunded');
    assert.equal(o.payment_failure_reason, 'amount_mismatch');
    assert.ok(o.razorpay_refund_id);
    assert.equal(gateway.refunds.length, before + 1);
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [product.variants[0].id])).rows[0].stock_quantity, 1, 'unit returned to stock');
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'payment_gateway_mismatch' AND entity_id = $1", [co.order_id])).rows[0].n, 1);
  });

  test('a refund that fails at the gateway is retried by reconciliation, not left for a person', async () => {
    const { reconcilePayments } = await import('../lib/payments.js');
    const first = await pendingOrder(`Refund Retry ${Date.now()}`);
    await ctx.db.query("UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1", [first.co.order_id]);
    const { sweepExpiredOrders } = await import('../lib/inventory.js');
    await sweepExpiredOrders();
    const winner = await login(uniqueEmail('retrywin'));
    await cartWith(winner.cookie, first.product.variants[0].id);
    assert.equal((await api('POST', '/api/checkout', DELIVERY, { cookie: winner.cookie })).status, 201);

    gateway.failNextRefund = true;
    const p = pay(first.co.razorpay.order_id);
    const r = await api('POST', '/api/payment-verify', { order_id: first.co.order_id, ...p }, { cookie: first.buyer.cookie });
    assert.equal(r.status, 409);
    let o = (await ctx.db.query('SELECT payment_status, refund_attempts, razorpay_refund_id FROM orders WHERE id = $1', [first.co.order_id])).rows[0];
    assert.equal(o.payment_status, 'refund_required');
    assert.equal(o.refund_attempts, 1);
    assert.equal(o.razorpay_refund_id, null);

    assert.equal((await reconcilePayments()).refunds, 0, 'backoff: no immediate retry');
    await ctx.db.query("UPDATE orders SET refund_attempted_at = now() - interval '3 minutes' WHERE id = $1", [first.co.order_id]);
    const before = gateway.refunds.length;
    assert.equal((await reconcilePayments()).refunds, 1);
    o = (await ctx.db.query('SELECT payment_status, refund_attempts, razorpay_refund_id FROM orders WHERE id = $1', [first.co.order_id])).rows[0];
    assert.equal(o.payment_status, 'refunded');
    assert.equal(o.refund_attempts, 2);
    assert.equal(o.razorpay_refund_id, gateway.refunds.at(-1).id);
    assert.equal(gateway.refunds.length, before + 1);
  });

  test('a failed duplicate-capture refund is retried once by reconciliation', async () => {
    const { reconcilePayments } = await import('../lib/payments.js');
    const { buyer, co } = await pendingOrder(`Dup Retry ${Date.now()}`);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...pay(co.razorpay.order_id) }, { cookie: buyer.cookie })).status, 200);
    const second = pay(co.razorpay.order_id);
    gateway.failNextRefund = true;
    assert.equal((await api('POST', '/api/payment-verify', { order_id: co.order_id, ...second }, { cookie: buyer.cookie })).status, 409);
    const ev = () => ctx.db.query("SELECT status FROM payment_events WHERE event_id = $1", [`refund:${second.razorpay_payment_id}`]).then((r) => r.rows[0]);
    assert.equal((await ev()).status, 'failed');
    const before = gateway.refunds.length;
    assert.equal((await reconcilePayments()).duplicate_refunds, 1);
    assert.equal((await ev()).status, 'processed');
    assert.equal(gateway.refunds.length, before + 1);
    assert.equal(gateway.refunds.at(-1).payment_id, second.razorpay_payment_id);
    await reconcilePayments();
    assert.equal(gateway.refunds.length, before + 1, 'processed claims are not refunded again');
  });

  test('a full refund of an unshipped order returns stock; a partial refund and a delivered refund do not', async () => {
    const sendRefund = async (paymentId, amount, tag) => {
      const raw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: `rfnd_${tag}`, payment_id: paymentId, amount, currency: 'INR', status: 'processed' } } } });
      return api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_rf_${tag}` } });
    };

    const partial = await pendingOrder(`Partial Refund ${Date.now()}`);
    const partialPay = pay(partial.co.razorpay.order_id);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: partial.co.order_id, ...partialPay }, { cookie: partial.buyer.cookie })).status, 200);
    assert.equal((await sendRefund(partialPay.razorpay_payment_id, 100, `part_${Date.now()}`)).status, 200);
    assert.equal((await ctx.db.query('SELECT status, payment_status FROM orders WHERE id = $1', [partial.co.order_id])).rows[0].payment_status, 'paid');
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [partial.product.variants[0].id])).rows[0].stock_quantity, 0);

    const full = await pendingOrder(`Full Refund ${Date.now()}`);
    const fullPay = pay(full.co.razorpay.order_id);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: full.co.order_id, ...fullPay }, { cookie: full.buyer.cookie })).status, 200);
    assert.equal((await sendRefund(fullPay.razorpay_payment_id, full.co.razorpay.amount, `full_${Date.now()}`)).status, 200);
    const fullOrder = (await ctx.db.query('SELECT status, payment_status FROM orders WHERE id = $1', [full.co.order_id])).rows[0];
    assert.equal(fullOrder.payment_status, 'refunded');
    assert.equal(fullOrder.status, 'refunded');
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [full.product.variants[0].id])).rows[0].stock_quantity, 1);

    const shipped = await pendingOrder(`Shipped Refund ${Date.now()}`);
    const shippedPay = pay(shipped.co.razorpay.order_id);
    assert.equal((await api('POST', '/api/payment-verify', { order_id: shipped.co.order_id, ...shippedPay }, { cookie: shipped.buyer.cookie })).status, 200);
    assert.equal((await api('POST', '/api/admin/ops?section=order', { id: shipped.co.order_id, status: 'dispatched', courier_partner: 'Delhivery', tracking_number: 'VS-RF-1' }, { cookie: admin.cookie })).status, 200);
    assert.equal((await api('POST', '/api/admin/ops?section=order', { id: shipped.co.order_id, status: 'delivered' }, { cookie: admin.cookie })).status, 200);
    assert.equal((await sendRefund(shippedPay.razorpay_payment_id, shipped.co.razorpay.amount, `ship_${Date.now()}`)).status, 200);
    const shippedOrder = (await ctx.db.query('SELECT status, payment_status FROM orders WHERE id = $1', [shipped.co.order_id])).rows[0];
    assert.equal(shippedOrder.status, 'delivered');
    assert.equal(shippedOrder.payment_status, 'refunded');
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [shipped.product.variants[0].id])).rows[0].stock_quantity, 0);
  });
});

describe('membership and credits', () => {
  test('activation is bound to its own payment and credits are allocated once', async () => {
    const m = await login(uniqueEmail('member'));
    const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    assert.equal(start.data.amount, 3598);
    assert.equal(gateway.subscriptions.get(start.data.razorpay.subscription_id).addons[0].item.amount, 359800);

    // A signature for an unrelated (cheap) order must not activate the membership.
    const other = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Cheap ${Date.now()}`, 100);
    await cartWith(other.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'O', phone: '+91 9000000000' } }, { cookie: other.cookie });
    const cheap = pay(co.data.razorpay.order_id);
    assert.equal((await api('POST', '/api/membership', { action: 'activate_paid', ...cheap }, { cookie: m.cookie })).status, 404);
    // Another customer's mandate cannot activate this membership either.
    const stranger = await login(uniqueEmail());
    const theirs = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: stranger.cookie });
    assert.equal((await api('POST', '/api/membership', { action: 'activate_paid', ...authoriseSubscription(theirs.data.razorpay.subscription_id) }, { cookie: m.cookie })).status, 404);

    const p = authoriseSubscription(start.data.razorpay.subscription_id);
    const [a, b] = await Promise.all([
      api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie: m.cookie }),
      api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie: m.cookie }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const again = await api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie: m.cookie });
    assert.equal(again.data.membership.credits_balance, 4);
    const ledger = await ctx.db.query("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'membership_payment'", [m.user.id]);
    assert.equal(ledger.rows[0].n, 1);
  });

  test('credit redemption is atomic and premium pieces are excluded', async () => {
    const m = await login(uniqueEmail('redeem'));
    await joinMembership(m.cookie);

    const premium = await variantOf('premium-silk-column-dress', 'Small');
    const cart = await cartWith(m.cookie, premium.id);
    assert.equal((await api('PATCH', '/api/cart', { item_id: cart.items[0].id, use_credit: true }, { cookie: m.cookie })).status, 400);

    const piece = await freshOneOfOne(admin.cookie, `Credit Piece ${Date.now()}`, 1500);
    const c2 = await cartWith(m.cookie, piece.variants[0].id);
    await api('PATCH', '/api/cart', { item_id: c2.items[0].id, use_credit: true }, { cookie: m.cookie });
    const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'M', phone: '+91 9000000001' } }, { cookie: m.cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    assert.equal(co.data.payment_provider, 'credit');
    assert.equal(Number(co.data.totals.total), 0);
    const mem = (await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0];
    assert.equal(mem.credits_balance, 3);
  });

  test('admin credit adjustments cannot drive a balance negative', async () => {
    const m = await login(uniqueEmail('adj'));
    await joinMembership(m.cookie);
    const mid = (await ctx.db.query('SELECT id FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].id;
    assert.equal((await api('POST', '/api/admin/ops?section=credit', { membership_id: mid, delta: -10 }, { cookie: admin.cookie })).status, 409);
    assert.equal((await api('POST', '/api/admin/ops?section=credit', { membership_id: mid, delta: -1, reason: 'test' }, { cookie: admin.cookie })).status, 200);
    assert.equal((await api('POST', '/api/admin/ops?section=credit', { membership_id: mid, delta: 2, reason: 'goodwill' }, { cookie: admin.cookie })).status, 200);
    const grant = (await ctx.db.query("SELECT expires_at FROM credit_ledger WHERE membership_id = $1 AND reason = 'admin: goodwill'", [mid])).rows[0];
    assert.ok(grant.expires_at, 'admin grants expire like membership grants');
    assert.ok(new Date(grant.expires_at) > new Date(Date.now() + 59 * 86_400_000));
  });

  test('expired credits cannot be redeemed and are written off once', async () => {
    const m = await login(uniqueEmail('expire'));
    await joinMembership(m.cookie);
    await ctx.db.query("UPDATE credit_ledger SET expires_at = now() - interval '1 day' WHERE auth_user_id = $1 AND reason = 'membership_payment'", [m.user.id]);
    const piece = await freshOneOfOne(admin.cookie, `Expired Credit ${Date.now()}`, 1500);
    const cart = await cartWith(m.cookie, piece.variants[0].id);
    await api('PATCH', '/api/cart', { item_id: cart.items[0].id, use_credit: true }, { cookie: m.cookie });
    const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'M', phone: '+91 9000000001' } }, { cookie: m.cookie });
    assert.equal(co.status, 400);
    assert.equal(co.data.error, 'insufficient_credits');
    assert.equal((await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].credits_balance, 0);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'expiry'", [m.user.id])).rows[0].n, 1);
    assert.equal((await api('GET', '/api/membership', undefined, { cookie: m.cookie })).data.membership.credits_balance, 0);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'expiry'", [m.user.id])).rows[0].n, 1);
  });

  test('cancelling an unshipped credit order restores the credit once', async () => {
    const m = await login(uniqueEmail('restore'));
    await joinMembership(m.cookie);
    const piece = await freshOneOfOne(admin.cookie, `Restore Credit ${Date.now()}`, 1500);
    const cart = await cartWith(m.cookie, piece.variants[0].id);
    await api('PATCH', '/api/cart', { item_id: cart.items[0].id, use_credit: true }, { cookie: m.cookie });
    const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'M', phone: '+91 9000000003' } }, { cookie: m.cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    assert.equal((await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'cancelled' }, { cookie: admin.cookie })).status, 200);
    assert.equal((await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].credits_balance, 4);
    assert.equal((await ctx.db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [piece.variants[0].id])).rows[0].stock_quantity, 1);
    await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'cancelled' }, { cookie: admin.cookie });
    assert.equal((await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].credits_balance, 4);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM credit_ledger WHERE order_id = $1 AND reason = 'redemption_reversal'", [co.data.order_id])).rows[0].n, 1);
  });

  test('a repeated subscription charge allocates credits once', async () => {
    const m = await login(uniqueEmail('autopay'));
    const subId = await joinMembership(m.cookie);
    const payment = recurringPayment(subId);
    const raw = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: subId, status: 'active' } }, payment: { entity: payment } } });
    const headers = (id) => ({ 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': id });
    const [a, b] = await Promise.all([
      api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: headers(`evt_sub_a_${payment.id}`) }),
      api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: headers(`evt_sub_b_${payment.id}`) }),
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(b.status, 200, JSON.stringify(b.data));
    // The monthly debit pays for the month after the current paid period: appended once,
    // credited only when that month starts.
    assert.equal((await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].credits_balance, 4);
    const periods = (await ctx.db.query('SELECT count(*)::int AS n FROM membership_periods p JOIN memberships m ON m.id = p.membership_id WHERE m.auth_user_id = $1', [m.user.id])).rows[0].n;
    assert.equal(periods, 3);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM membership_payments WHERE auth_user_id = $1 AND status = 'paid'", [m.user.id])).rows[0].n, 2);
    await ctx.db.query(
      `UPDATE membership_periods p SET starts_at = p.starts_at - interval '4 months', ends_at = p.ends_at - interval '4 months'
         FROM memberships m WHERE m.id = p.membership_id AND m.auth_user_id = $1 AND p.month_index = 1 AND p.credits_granted_at IS NULL`,
      [m.user.id]
    );
    await api('GET', '/api/membership', undefined, { cookie: m.cookie });
    assert.equal((await ctx.db.query('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).rows[0].credits_balance, 8);
  });
});

describe('admin catalogue', () => {
  test('size-specific pricing, duplicate sizes rejected, stale stock edits conflict', async () => {
    const dup = await api('POST', '/api/admin/ops?section=product', { name: 'Dup', variants: [{ size_label: 'M', price_inr: 10 }, { size_label: 'm', price_inr: 20 }] }, { cookie: admin.cookie });
    assert.equal(dup.status, 422);

    const r = await api('POST', '/api/admin/ops?section=product', {
      name: `Silk Saree ${Date.now()}`, category: 'Dresses', is_one_of_one: false,
      variants: [
        { size_label: 'Small', sku: `SS-S-${Date.now()}`, price_inr: 4000, stock_quantity: 1 },
        { size_label: 'Medium', price_inr: 4200, stock_quantity: 3 },
        { size_label: 'Large', price_inr: 4500, sale_price_inr: 4300, stock_quantity: 2 },
        { size_label: 'Double XL', price_inr: 5000, stock_quantity: 1 },
      ],
    }, { cookie: admin.cookie });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const pdp = await api('GET', `/api/product?slug=${r.data.product.slug}`);
    assert.deepEqual(pdp.data.product.variants.map((v) => v.effective_price), [4000, 4200, 4300, 5000]);

    const medium = r.data.product.variants.find((v) => v.size_label === 'Medium');
    // Simulate a checkout holding 3 units while the admin form still shows 3.
    await ctx.db.query('UPDATE product_variants SET stock_quantity = 0 WHERE id = $1', [medium.id]);
    const stale = await api('POST', '/api/admin/ops?section=product', { ...r.data.product, variants: [{ ...medium, stock_quantity: 0, stock_base: 3 }] }, { cookie: admin.cookie });
    assert.equal(stale.status, 409);
  });

  test('deleting a sold product archives it and keeps order history', async () => {
    const buyer = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Archive Me ${Date.now()}`);
    await cartWith(buyer.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
    await api('POST', '/api/payment-verify', { order_id: co.data.order_id, ...pay(co.data.razorpay.order_id) }, { cookie: buyer.cookie });
    const del = await api('DELETE', `/api/admin/ops?section=product&id=${product.id}`, undefined, { cookie: admin.cookie });
    assert.equal(del.data.result, 'archived');
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1', [co.data.order_id])).rows[0].n, 1);
    assert.equal((await api('GET', `/api/product?slug=${product.slug}`)).status, 404);
  });

  test('unpaid orders cannot be dispatched', async () => {
    const buyer = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Unpaid ${Date.now()}`);
    await cartWith(buyer.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
    const r = await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'dispatched' }, { cookie: admin.cookie });
    assert.equal(r.status, 409);
    assert.equal((await ctx.db.query('SELECT payment_status FROM orders WHERE id = $1', [co.data.order_id])).rows[0].payment_status, 'pending');
  });

  test('CSV export neutralises spreadsheet formulas', async () => {
    const buyer = await login(uniqueEmail());
    await api('PUT', '/api/account', { full_name: '=HYPERLINK("http://evil")' }, { cookie: buyer.cookie });
    const r = await api('GET', '/api/admin/ops?section=export&type=customers', undefined, { cookie: admin.cookie });
    assert.ok(!/(^|,)"=HYPERLINK/m.test(r.data));
    assert.ok(r.data.includes(`"'=HYPERLINK`));
  });
});

describe('uploads and customer content', () => {
  const b64 = (buf) => `data:application/octet-stream;base64,${buf.toString('base64')}`;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

  test('type comes from bytes; scripts, SVG, guest uploads and customer video are refused', async () => {
    assert.equal((await api('POST', '/api/upload', { image: b64(png), name: 'guest.png' })).status, 401);
    const { cookie } = await login(uniqueEmail('uploader'));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await api('POST', '/api/upload', { image: b64(svg), name: 'x.png' }, { cookie })).status, 415);
    assert.equal((await api('POST', '/api/upload', { file: b64(Buffer.from('<html><script>alert(1)</script></html>')), name: 'a.html' }, { cookie })).status, 415);
    assert.equal((await api('POST', '/api/upload', { video: b64(fakeMp4(5)), name: 'v.mp4' }, { cookie })).status, 403);
    assert.equal((await api('POST', '/api/upload', { image: b64(png), name: 'broken.png' }, { cookie })).status, 422, 'an image whose size cannot be read is refused');
    const ok = await api('POST', '/api/upload', { image: b64(fakePng(640, 480)), name: '../../etc/passwd.png' }, { cookie });
    assert.equal(ok.status, 201);
    // Customer uploads are exchange/damage evidence: private, owned by the customer, server-named.
    assert.match(ok.data.ref, /^storage:\/\/exchange-evidence\/evidence\/usr_[a-f0-9]+\/[0-9a-f]{32}\.png$/);
    assert.equal((await fetch(`${ctx.base}/uploads/${ok.data.ref.split('/').pop()}`)).status, 404, 'never reachable as a public file');
    assert.equal((await fetch(`${ctx.base}/uploads/.private/exchange-evidence/${ok.data.ref.split('exchange-evidence/')[1]}`)).status, 404, 'the private folder is not served');
    const served = await fetch(ctx.base + ok.data.url);
    assert.equal(served.status, 200, 'the signed link works');
    assert.match(served.headers.get('content-security-policy'), /sandbox/);
    assert.equal((await fetch(ctx.base + ok.data.url.replace(/sig=[^&]+/, 'sig=forged'))).status, 404, 'a forged signature is refused');
  });

  test('videos over 10 seconds are rejected server-side and only 3 may be live', async () => {
    await ctx.db.query("INSERT INTO app_settings (key, value) VALUES ('max_video_seconds', '30') ON CONFLICT (key) DO UPDATE SET value = '30'::jsonb");
    const { invalidateSettings } = await import('../lib/settings.js');
    invalidateSettings();
    const long = await api('POST', '/api/upload', { video: b64(fakeMp4(11)) }, { cookie: admin.cookie });
    assert.equal(long.status, 422);
    assert.equal(long.data.error, 'video_too_long');
    assert.equal((await api('POST', '/api/admin/ops?section=settings', { settings: { max_video_seconds: 30 } }, { cookie: admin.cookie })).status, 400);
    const sneak = await ctx.db.query("INSERT INTO feedback_videos (title, video_url, duration_seconds, active) VALUES ('Sneak', '/uploads/nope.mp4', 11, false) RETURNING id");
    assert.equal((await api('POST', '/api/admin/ops?section=content', { type: 'video_status', id: sneak.rows[0].id, active: true }, { cookie: admin.cookie })).status, 422);

    await ctx.db.query('UPDATE feedback_videos SET active = false');
    for (let i = 0; i < 3; i += 1) {
      const up = await api('POST', '/api/upload', { video: b64(fakeMp4(10)) }, { cookie: admin.cookie });
      const r = await api('POST', '/api/admin/ops?section=content', { type: 'video', title: `Look ${i}`, customer_name: 'Ananya', video_url: up.data.url }, { cookie: admin.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    const up = await api('POST', '/api/upload', { video: b64(fakeMp4(10)) }, { cookie: admin.cookie });
    assert.equal((await api('POST', '/api/admin/ops?section=content', { type: 'video', title: 'Fourth', video_url: up.data.url }, { cookie: admin.cookie })).status, 409);
    const home = await api('GET', '/api/content');
    assert.equal(home.data.feedback_videos.length, 3);
    const hidden = (await ctx.db.query('SELECT id FROM feedback_videos WHERE active LIMIT 1')).rows[0].id;
    await api('POST', '/api/admin/ops?section=content', { type: 'video_status', id: hidden, active: false }, { cookie: admin.cookie });
    assert.equal((await api('GET', '/api/content')).data.feedback_videos.length, 2);
  });

  test('colour profile accepts derived attributes only', async () => {
    const { cookie } = await login(uniqueEmail());
    const bad = await api('POST', '/api/colour-review', { undertone: 'Warm', palette: ['#B85C43', '#68734A', '#B58A5A'], image: 'data:image/jpeg;base64,AAAA' }, { cookie });
    assert.equal(bad.status, 400);
    const ok = await api('POST', '/api/colour-review', { undertone: 'Warm', palette: ['#B85C43', '#68734A', '#B58A5A'], confidence: 0.8 }, { cookie });
    assert.equal(ok.status, 201);
  });
});

describe('exchanges', () => {
  test('requires a delivered paid order, inside the window, one open request at a time', async () => {
    const buyer = await login(uniqueEmail());
    const product = await freshOneOfOne(admin.cookie, `Exchange ${Date.now()}`);
    await cartWith(buyer.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
    await api('POST', '/api/payment-verify', { order_id: co.data.order_id, ...pay(co.data.razorpay.order_id) }, { cookie: buyer.cookie });
    assert.equal((await api('POST', '/api/exchange', { order_id: co.data.order_id, reason: 'Size exchange needed' }, { cookie: buyer.cookie })).status, 400);
    await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'dispatched', tracking_number: 'TRK1' }, { cookie: admin.cookie });
    await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'delivered' }, { cookie: admin.cookie });
    assert.equal((await api('POST', '/api/exchange', { order_id: co.data.order_id, reason: 'Size exchange needed' }, { cookie: buyer.cookie })).status, 201);
    assert.equal((await api('POST', '/api/exchange', { order_id: co.data.order_id, reason: 'Again' }, { cookie: buyer.cookie })).status, 409);
  });
});

describe('customer journey and live tracking', () => {
  test('catalogue → bag → pay → tracked dispatch → delivered → exchange', async () => {
    const buyer = await login(uniqueEmail('journey'));
    const product = await freshOneOfOne(admin.cookie, `Journey ${Date.now()}`);
    const listing = await api('GET', '/api/catalogue');
    assert.equal(listing.status, 200);
    await cartWith(buyer.cookie, product.variants[0].id);

    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
    assert.equal(co.status, 201, JSON.stringify(co.data));
    const orderId = co.data.order_id;
    const verify = await api('POST', '/api/payment-verify', { order_id: orderId, ...pay(co.data.razorpay.order_id) }, { cookie: buyer.cookie });
    assert.equal(verify.status, 200, JSON.stringify(verify.data));
    assert.equal((await ctx.db.query("SELECT status FROM inventory_reservations WHERE order_id = $1", [orderId])).rows[0].status, 'committed');

    const view = async () => (await api('GET', `/api/orders?id=${orderId}`, undefined, { cookie: buyer.cookie })).data;
    let d = await view();
    assert.equal(d.order.status, 'processing', 'tracker starts at Order confirmed → Being prepared');
    assert.ok(d.order.paid_at);
    assert.match(d.invoice.invoice_number, /^VS\//);
    assert.equal(d.policy.exchange_days, 7);

    const order = (body) => api('POST', '/api/admin/ops?section=order', { id: orderId, ...body }, { cookie: admin.cookie });
    assert.equal((await order({ status: 'packed' })).status, 200);
    d = await view();
    assert.equal(d.order.status, 'packed');
    assert.ok(d.order.packed_at);

    assert.equal((await order({ status: 'dispatched', courier_partner: 'FedEx', tracking_number: 'X1' })).status, 400, 'unknown courier refused');
    assert.equal((await order({ status: 'dispatched', courier_partner: 'Delhivery' })).status, 422, 'tracked courier needs a tracking number');
    assert.equal((await view()).order.status, 'packed', 'refused dispatch leaves the order untouched');

    const stampBefore = d.order.updated_at;
    assert.equal((await order({ status: 'dispatched', courier_partner: 'Delhivery', tracking_number: 'VS-DEL-98210' })).status, 200);
    d = await view();
    assert.equal(d.order.status, 'dispatched');
    assert.equal(d.order.courier_partner, 'Delhivery');
    assert.equal(d.order.tracking_number, 'VS-DEL-98210');
    assert.ok(d.order.dispatch_at);
    assert.notEqual(d.order.updated_at, stampBefore, 'poller sees a new version');
    const notified = (await ctx.db.query('SELECT dispatch_notified_at FROM orders WHERE id = $1', [orderId])).rows[0];
    assert.equal(notified.dispatch_notified_at, null, 'no email provider in tests: the customer was not notified, so the order must not say so');
    assert.equal((await api('POST', '/api/exchange', { order_id: orderId, reason: 'Size exchange needed' }, { cookie: buyer.cookie })).status, 400, 'no exchange before delivery');

    assert.equal((await order({ status: 'delivered' })).status, 200);
    d = await view();
    assert.equal(d.order.status, 'delivered');
    assert.ok(d.order.delivered_at);

    assert.equal((await api('POST', '/api/exchange', { order_id: orderId, reason: 'Size exchange needed' }, { cookie: buyer.cookie })).status, 201);
    d = await view();
    assert.equal(d.order.exchanges[0].status, 'requested');
  });

  test('another customer cannot poll someone else\'s order', async () => {
    const owner = await login(uniqueEmail('owner'));
    const product = await freshOneOfOne(admin.cookie, `Private ${Date.now()}`);
    await cartWith(owner.cookie, product.variants[0].id);
    const co = await api('POST', '/api/checkout', DELIVERY, { cookie: owner.cookie });
    const stranger = await login(uniqueEmail('stranger'));
    const r = await api('GET', `/api/orders?id=${co.data.order_id}`, undefined, { cookie: stranger.cookie });
    assert.equal(r.status, 404);
  });
});

describe('transport security', () => {
  test('security headers are set and cross-origin mutations are refused', async () => {
    const r = await api('GET', '/api/catalogue');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-powered-by'), null);
    const evil = await api('POST', '/api/auth/start-login', { email: 'x@example.test' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const form = await api('POST', '/api/auth/start-login', undefined, { raw: 'email=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    // A cookie-authenticated mutation with neither Origin nor Referer is not a browser on this site.
    const member = await login(uniqueEmail('noorigin'));
    const blind = await api('PUT', '/api/account', { full_name: 'Blind' }, { cookie: member.cookie, headers: { Origin: null } });
    assert.equal(blind.status, 403);
    assert.equal(blind.data.error, 'origin_required');
    const viaReferer = await api('PUT', '/api/account', { full_name: 'Referer' }, { cookie: member.cookie, headers: { Origin: null, Referer: `${ctx.base}/account` } });
    assert.equal(viaReferer.status, 200);
    assert.equal((await api('PUT', '/api/account', { full_name: 'Browser' }, { cookie: member.cookie })).status, 200);
    assert.equal((await api('POST', '/api/auth/start-login', { email: uniqueEmail('anon') }, { headers: { Origin: null } })).status, 200, 'no cookie: Origin not required');
    const cors = await fetch(ctx.base + '/api/catalogue', { headers: { Origin: 'https://evil.example' } });
    assert.equal(cors.headers.get('access-control-allow-origin'), null);
  });

  test('rate limiting returns 429', async () => {
    process.env.RATE_LIMIT_DISABLED = 'false';
    try {
      const email = uniqueEmail('rl');
      const statuses = [];
      for (let i = 0; i < 8; i += 1) statuses.push((await api('POST', '/api/auth/verify-code', { email, code: '123456' })).status);
      for (let i = 0; i < 30; i += 1) statuses.push((await api('POST', '/api/auth/verify-code', { email, code: '123456' })).status);
      assert.ok(statuses.includes(429));
    } finally {
      process.env.RATE_LIMIT_DISABLED = 'true';
    }
  });

  test('malformed product data does not break the catalogue', async () => {
    await ctx.db.query(`INSERT INTO products (name, slug, price_inr, is_active, images, attributes) VALUES ('Odd Piece', $1, 10, true, '["", null, 5]'::jsonb, '{}')`, [`odd-${Date.now()}`]);
    const id = (await ctx.db.query("SELECT id FROM products WHERE name = 'Odd Piece' ORDER BY created_at DESC LIMIT 1")).rows[0].id;
    await ctx.db.query("INSERT INTO product_variants (product_id, sku, price_inr, stock_quantity) VALUES ($1, $2, 10, 1)", [id, `ODD-${Date.now()}`]);
    const r = await api('GET', '/api/catalogue?limit=100');
    assert.equal(r.status, 200);
    const odd = r.data.products.find((p) => p.id === id);
    assert.deepEqual(odd.images, []);
    assert.equal((await api('GET', '/api/product?slug=does-not-exist')).status, 404);
    assert.equal((await api('GET', '/api/catalogue?limit=abc&page=-4&sort=;drop')).status, 200);
  });
});
});
