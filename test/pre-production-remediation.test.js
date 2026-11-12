// Pre-production remediation (docs/testing/RAZORPAY_SANDBOX_REHEARSAL.md §15): gift double purchase,
// gift and Wardrobe Bag refunds, membership payment ↔ subscription binding, cancellation paid-through,
// mandate resume, invalid-signature audit, and customer copy.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { api, authoriseSubscription, ctx, dbSkipReason, gateway, login, pay, setup, subscriptionEvent, teardown, uniqueEmail, webhookSignature, ADMIN_EMAIL, RZP_SECRET } from './helpers.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { MANDATE_COPY, bagPackedMessage } = await import('../vishrea-react/src/lib/customerCopy.js');
const { afterGiftPaid, blankGiftPurchase } = await import('../vishrea-react/src/lib/giftPurchase.js');

const skip = await dbSkipReason();
let admin;
const q1 = async (sql, params = []) => (await ctx.db.query(sql, params)).rows[0];
const count = async (sql, params = []) => (await q1(sql, params)).n;
const sendWebhook = ({ raw, headers }) => api('POST', '/api/webhooks/razorpay', undefined, { raw, headers });

function refundEvent(paymentId, amountPaise, refundId = `rfnd_${crypto.randomBytes(6).toString('hex')}`) {
  const raw = JSON.stringify({ entity: 'event', event: 'refund.processed', contains: ['refund'], payload: { refund: { entity: { id: refundId, entity: 'refund', payment_id: paymentId, amount: amountPaise, currency: 'INR', status: 'processed' } } }, created_at: Math.floor(Date.now() / 1000) });
  return { refundId, raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_${crypto.randomBytes(8).toString('hex')}` } };
}

async function join(cookie) {
  const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const subscriptionId = start.data.razorpay.subscription_id;
  const a = await api('POST', '/api/membership', { action: 'activate_paid', ...authoriseSubscription(subscriptionId) }, { cookie });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return subscriptionId;
}

async function buyGift(cookie, extra = {}) {
  const start = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 2, sender_phone: '+91 98450 10101', recipient_name: 'Asha', recipient_email: uniqueEmail('rcpt'), submission_key: `k-${crypto.randomUUID()}`, ...extra }, { cookie });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const p = pay(start.data.razorpay.order_id);
  const r = await api('POST', '/api/gifting', { action: 'confirm_payment', ...p }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { start: start.data, paymentId: p.razorpay_payment_id };
}

async function paidBagShipment(m) {
  const product = (await api('POST', '/api/admin/ops?section=product', { name: `Refund piece ${Date.now()}${Math.random().toString(36).slice(2, 6)}`, price_inr: 1200, category: 'Tops', is_one_of_one: true }, { cookie: admin.cookie })).data.product;
  await api('POST', '/api/cart', { variant_id: product.variants[0].id }, { cookie: m.cookie });
  const line = (await api('GET', '/api/cart', undefined, { cookie: m.cookie })).data.items.find((i) => i.variant_id === product.variants[0].id);
  await api('PATCH', '/api/cart', { item_id: line.id, use_credit: true }, { cookie: m.cookie });
  assert.equal((await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie })).status, 201);
  const ship = await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'delivery', shipping_address: { name: 'Asha Rao', phone: '+91 98450 00000', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } }, { cookie: m.cookie });
  assert.equal(ship.data.status, 'pending_payment', JSON.stringify(ship.data));
  const p = pay(ship.data.razorpay.order_id);
  assert.equal((await api('POST', '/api/wardrobe', { action: 'confirm_bag_payment', ...p }, { cookie: m.cookie })).status, 200);
  return { shipmentId: ship.data.shipment_id, paymentId: p.razorpay_payment_id, variantId: product.variants[0].id };
}

describe('customer copy and gift form state (unit)', () => {
  test('mandate status never claims UPI, because a mandate can be authorised with a card', () => {
    for (const label of Object.values(MANDATE_COPY)) assert.doesNotMatch(label, /UPI/);
    assert.equal(MANDATE_COPY.authenticated, 'Autopay set up');
  });

  test('the Wardrobe Bag message is singular for one piece and plural otherwise', () => {
    assert.equal(bagPackedMessage(1), 'Your 1 piece is being packed. We dispatch within 48 hours.');
    assert.equal(bagPackedMessage(3), 'Your 3 pieces are being packed. We dispatch within 48 hours.');
  });

  test('after a paid gift the form is emptied, keeping only the buyer’s own choices', () => {
    const filled = { ...blankGiftPurchase(2), membership_months: 3, sender_phone: '9845000001', recipient_name: 'Asha', recipient_email: 'a@example.test', recipient_phone: '9000000000', start_date: '2026-12-01', message: 'Hi', wearer_id: 'w' };
    const next = afterGiftPaid(filled);
    assert.deepEqual(next, { ...blankGiftPurchase(3), sender_phone: '9845000001' });
  });
});

describe('pre-production remediation', { skip, timeout: 600_000 }, () => {
  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
  }, { timeout: 120_000 });
  after(teardown);

  describe('gift double purchase', () => {
    test('the submission key of a paid gift cannot open a second checkout', async () => {
      const buyer = await login(uniqueEmail('gdbl'));
      const key = `k-${crypto.randomUUID()}`;
      const { start } = await buyGift(buyer.cookie, { submission_key: key });
      const again = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 2, sender_phone: '+91 98450 10101', recipient_name: 'Asha', recipient_email: uniqueEmail('rcpt'), submission_key: key }, { cookie: buyer.cookie });
      assert.equal(again.status, 409);
      assert.equal(again.data.error, 'gift_already_paid');
      assert.equal(await count('SELECT count(*)::int AS n FROM admin_gift_enquiries WHERE submitted_by = $1', [buyer.user.id]), 1);
      assert.equal(await count('SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1', [start.enquiry_id]), 1);
    });

    test('concurrent submits with one key create one gift and one gateway order', async () => {
      const buyer = await login(uniqueEmail('gconc'));
      const body = { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 2, sender_phone: '+91 98450 10102', recipient_name: 'Asha', recipient_email: uniqueEmail('rcpt'), submission_key: `k-${crypto.randomUUID()}` };
      const rs = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/api/gifting', body, { cookie: buyer.cookie })));
      for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(new Set(rs.map((r) => r.data.enquiry_id)).size, 1);
      assert.equal(new Set(rs.map((r) => r.data.razorpay.order_id)).size, 1);
      assert.equal(await count('SELECT count(*)::int AS n FROM admin_gift_enquiries WHERE submitted_by = $1', [buyer.user.id]), 1);
    });

    test('another customer cannot reuse someone else’s submission key', async () => {
      const a = await login(uniqueEmail('gka'));
      const b = await login(uniqueEmail('gkb'));
      const key = `k-${crypto.randomUUID()}`;
      const body = { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 2, sender_phone: '+91 98450 10103', recipient_name: 'Asha', recipient_email: uniqueEmail('rcpt'), submission_key: key };
      assert.equal((await api('POST', '/api/gifting', body, { cookie: a.cookie })).status, 200);
      const r = await api('POST', '/api/gifting', body, { cookie: b.cookie });
      assert.equal(r.status, 409);
      assert.equal(r.data.error, 'submission_key_in_use');
    });
  });

  describe('gift refunds (refund.processed)', () => {
    test('a full refund revokes the unredeemed code, counts once, notifies the buyer and blocks reissue', async () => {
      const buyer = await login(uniqueEmail('grf'));
      const { start, paymentId } = await buyGift(buyer.cookie);
      const ev = refundEvent(paymentId, 359800);
      const r = await sendWebhook(ev);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.outcome, 'processed');
      const e = await q1('SELECT status, refund_status, refunded_amount_paise, refunded_at FROM admin_gift_enquiries WHERE id = $1', [start.enquiry_id]);
      assert.deepEqual([e.status, e.refund_status, e.refunded_amount_paise, Boolean(e.refunded_at)], ['invoiced', 'refunded', 359800, true]);
      assert.equal((await q1('SELECT status FROM gift_memberships WHERE enquiry_id = $1', [start.enquiry_id])).status, 'revoked');

      // The same refund delivered again under a new event id changes nothing.
      const again = await sendWebhook(refundEvent(paymentId, 359800, ev.refundId));
      assert.equal(again.data.outcome, 'already_refunded');
      assert.equal((await q1('SELECT refunded_amount_paise FROM admin_gift_enquiries WHERE id = $1', [start.enquiry_id])).refunded_amount_paise, 359800);
      assert.equal(await count('SELECT count(*)::int AS n FROM payment_refunds WHERE entity_id = $1', [start.enquiry_id]), 1);
      assert.equal(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'gift_refunded' AND entity_id = $1", [start.enquiry_id]), 1);
      assert.ok(await q1("SELECT 1 AS ok FROM notifications WHERE event = 'refund_processed' AND dedupe_key = $1", [`refund:${ev.refundId}`]), 'buyer told about the refund');

      const reissue = await api('POST', '/api/admin/ops?section=gift_token', { enquiry_id: start.enquiry_id }, { cookie: admin.cookie });
      assert.equal(reissue.status, 409, 'no new code for a refunded gift');
      assert.equal(reissue.data.error, 'gift_refunded');

      const mine = (await api('GET', '/api/gifting', undefined, { cookie: buyer.cookie })).data.enquiries.find((g) => g.id === start.enquiry_id);
      assert.equal(mine.refund_status, 'refunded', 'the buyer sees the refund, not just "invoiced"');
      const { enquiry_number: number } = await q1('SELECT enquiry_number FROM admin_gift_enquiries WHERE id = $1', [start.enquiry_id]);
      const listed = (await api('GET', `/api/admin/ops?section=gift_enquiries&q=${number}`, undefined, { cookie: admin.cookie })).data.enquiries.find((g) => g.id === start.enquiry_id);
      assert.equal(listed.refund_status, 'refunded');
    });

    test('a partial refund is recorded without revoking; a second partial completing the amount marks it refunded', async () => {
      const buyer = await login(uniqueEmail('gpart'));
      const { start, paymentId } = await buyGift(buyer.cookie);
      assert.equal((await sendWebhook(refundEvent(paymentId, 100000))).data.outcome, 'partial');
      let e = await q1('SELECT refund_status, refunded_amount_paise FROM admin_gift_enquiries WHERE id = $1', [start.enquiry_id]);
      assert.deepEqual([e.refund_status, e.refunded_amount_paise], ['partial', 100000]);
      assert.equal((await q1('SELECT status FROM gift_memberships WHERE enquiry_id = $1', [start.enquiry_id])).status, 'issued');
      assert.equal((await sendWebhook(refundEvent(paymentId, 259800))).data.outcome, 'processed');
      e = await q1('SELECT refund_status, refunded_amount_paise FROM admin_gift_enquiries WHERE id = $1', [start.enquiry_id]);
      assert.deepEqual([e.refund_status, e.refunded_amount_paise], ['refunded', 359800]);
      assert.equal((await q1('SELECT status FROM gift_memberships WHERE enquiry_id = $1', [start.enquiry_id])).status, 'revoked');
    });

    test('a refund after the gift was redeemed keeps the membership and flags it for the studio', async () => {
      const buyer = await login(uniqueEmail('gred'));
      const w = await api('POST', '/api/account', { action: 'wearer', name: 'Mom' }, { cookie: buyer.cookie });
      const start = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'pick_for_her', membership_months: 2, sender_phone: '+91 98450 10104', wearer_id: w.data.wearer.id }, { cookie: buyer.cookie });
      const p = pay(start.data.razorpay.order_id);
      assert.equal((await api('POST', '/api/gifting', { action: 'confirm_payment', ...p }, { cookie: buyer.cookie })).status, 200);
      const before = await q1('SELECT status, credits_balance, paid_through FROM memberships WHERE auth_user_id = $1', [buyer.user.id]);
      assert.equal((await sendWebhook(refundEvent(p.razorpay_payment_id, 359800))).data.outcome, 'processed');
      const afterRefund = await q1('SELECT status, credits_balance, paid_through FROM memberships WHERE auth_user_id = $1', [buyer.user.id]);
      assert.deepEqual(afterRefund, before, 'the activated membership is not taken away automatically');
      assert.equal((await q1('SELECT status FROM gift_memberships WHERE enquiry_id = $1', [start.data.enquiry_id])).status, 'redeemed');
      assert.equal(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'gift_refund_after_redemption' AND entity_id = $1", [start.data.enquiry_id]), 1);
    });

    test('a revoked code cannot be redeemed', async () => {
      const buyer = await login(uniqueEmail('grev'));
      const { start, paymentId } = await buyGift(buyer.cookie);
      // A second code issued by the admin is the only way a test sees a plaintext token.
      await ctx.db.query('UPDATE admin_gift_enquiries SET quantity = 2 WHERE id = $1', [start.enquiry_id]);
      const issued = await api('POST', '/api/admin/ops?section=gift_token', { enquiry_id: start.enquiry_id }, { cookie: admin.cookie });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      const token = issued.data.token;
      await sendWebhook(refundEvent(paymentId, 359800));
      assert.equal(await count("SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1 AND status = 'revoked'", [start.enquiry_id]), 2);
      const recipient = await login(uniqueEmail('rcv'));
      const r = await api('POST', '/api/gifting', { action: 'redeem', token }, { cookie: recipient.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'invalid_gift_code');
    });
  });

  describe('Wardrobe Bag shipping refunds (refund.processed)', () => {
    test('a full fee refund is recorded once; stock, credits and fulfilment are unchanged', async () => {
      const m = await login(uniqueEmail('bagrf'));
      await join(m.cookie);
      const { shipmentId, paymentId, variantId } = await paidBagShipment(m);
      const before = {
        credits: (await q1('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).credits_balance,
        stock: (await q1('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).stock_quantity,
        orders: (await ctx.db.query('SELECT id, status FROM orders WHERE bag_shipment_id = $1 ORDER BY id', [shipmentId])).rows,
      };
      const ev = refundEvent(paymentId, 9900);
      const r = await sendWebhook(ev);
      assert.equal(r.data.outcome, 'processed', JSON.stringify(r.data));
      const s = await q1('SELECT status, refund_status, refunded_amount_paise, refunded_at FROM bag_shipments WHERE id = $1', [shipmentId]);
      assert.deepEqual([s.status, s.refund_status, s.refunded_amount_paise, Boolean(s.refunded_at)], ['paid', 'refunded', 9900, true]);
      assert.equal((await sendWebhook(refundEvent(paymentId, 9900, ev.refundId))).data.outcome, 'already_refunded');
      assert.equal((await q1('SELECT refunded_amount_paise FROM bag_shipments WHERE id = $1', [shipmentId])).refunded_amount_paise, 9900);
      assert.deepEqual({
        credits: (await q1('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).credits_balance,
        stock: (await q1('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).stock_quantity,
        orders: (await ctx.db.query('SELECT id, status FROM orders WHERE bag_shipment_id = $1 ORDER BY id', [shipmentId])).rows,
      }, before);
      assert.equal(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'bag_shipping_refunded' AND entity_id = $1", [shipmentId]), 1);
      assert.ok(await q1("SELECT 1 AS ok FROM notifications WHERE event = 'refund_processed' AND dedupe_key = $1", [`refund:${ev.refundId}`]));

      const csv = (await api('GET', '/api/admin/ops?section=export&type=bag_shipments', undefined, { cookie: admin.cookie })).data;
      const [header, ...lines] = String(csv).split('\n');
      const cols = header.split(',');
      assert.ok(cols.includes('refund_status') && cols.includes('refunded_amount_paise'), header);
      const row = lines.find((l) => l.startsWith(`"${shipmentId}"`)).split(',').map((c) => c.replace(/^"|"$/g, ''));
      assert.equal(row[cols.indexOf('refund_status')], 'refunded');
      assert.equal(row[cols.indexOf('refunded_amount_paise')], '9900');
      assert.match(row[cols.indexOf('refunded_at')], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'timestamps are plain ISO values, not JSON-quoted strings');
    });

    test('a partial fee refund is marked partial', async () => {
      const m = await login(uniqueEmail('bagpt'));
      await join(m.cookie);
      const { shipmentId, paymentId } = await paidBagShipment(m);
      assert.equal((await sendWebhook(refundEvent(paymentId, 4900))).data.outcome, 'partial');
      const s = await q1('SELECT refund_status, refunded_amount_paise FROM bag_shipments WHERE id = $1', [shipmentId]);
      assert.deepEqual([s.refund_status, s.refunded_amount_paise], ['partial', 4900]);
    });
  });

  describe('invalid payment signatures are audited', () => {
    test('gift and Wardrobe Bag confirmations with a forged signature are refused and audited', async () => {
      const buyer = await login(uniqueEmail('gsig'));
      const start = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 2, sender_phone: '+91 98450 10105', recipient_name: 'Asha', recipient_email: uniqueEmail('rcpt') }, { cookie: buyer.cookie });
      const forged = { ...pay(start.data.razorpay.order_id), razorpay_signature: 'f'.repeat(64) };
      const g = await api('POST', '/api/gifting', { action: 'confirm_payment', ...forged }, { cookie: buyer.cookie });
      assert.equal(g.status, 400);
      assert.equal(g.data.error, 'invalid_payment_signature');
      const ga = await q1("SELECT auth_user_id AS actor, details FROM audit_logs WHERE action = 'gift_payment_signature_invalid' AND entity_id = $1", [start.data.enquiry_id]);
      assert.equal(ga.actor, buyer.user.id);
      assert.equal((typeof ga.details === 'string' ? JSON.parse(ga.details) : ga.details).payment_id, forged.razorpay_payment_id);
      assert.equal((await q1('SELECT status FROM admin_gift_enquiries WHERE id = $1', [start.data.enquiry_id])).status, 'pending');

      const m = await login(uniqueEmail('bsig'));
      await join(m.cookie);
      const product = (await api('POST', '/api/admin/ops?section=product', { name: `Sig piece ${Date.now()}`, price_inr: 1200, category: 'Tops', is_one_of_one: true }, { cookie: admin.cookie })).data.product;
      await api('POST', '/api/cart', { variant_id: product.variants[0].id }, { cookie: m.cookie });
      const line = (await api('GET', '/api/cart', undefined, { cookie: m.cookie })).data.items[0];
      await api('PATCH', '/api/cart', { item_id: line.id, use_credit: true }, { cookie: m.cookie });
      await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie });
      const ship = await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'delivery', shipping_address: { name: 'Asha Rao', phone: '+91 98450 00000', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } }, { cookie: m.cookie });
      const b = await api('POST', '/api/wardrobe', { action: 'confirm_bag_payment', ...pay(ship.data.razorpay.order_id), razorpay_signature: 'e'.repeat(64) }, { cookie: m.cookie });
      assert.equal(b.status, 400);
      assert.equal(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'bag_payment_signature_invalid' AND entity_id = $1 AND auth_user_id = $2", [ship.data.shipment_id, m.user.id]), 1);
      assert.equal((await q1('SELECT status FROM bag_shipments WHERE id = $1', [ship.data.shipment_id])).status, 'pending_payment');
    });
  });

  describe('membership payment must belong to the subscription', () => {
    test('a payment whose invoice names another subscription is refused, even with a valid signature', async () => {
      const a = await login(uniqueEmail('msa'));
      const b = await login(uniqueEmail('msb'));
      const subA = (await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: a.cookie })).data.razorpay.subscription_id;
      const subB = (await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: b.cookie })).data.razorpay.subscription_id;
      const paidForB = authoriseSubscription(subB);
      gateway.subscriptions.get(subA).status = 'authenticated';
      const signature = crypto.createHmac('sha256', RZP_SECRET).update(`${paidForB.razorpay_payment_id}|${subA}`).digest('hex');
      const r = await api('POST', '/api/membership', { action: 'activate_paid', razorpay_subscription_id: subA, razorpay_payment_id: paidForB.razorpay_payment_id, razorpay_signature: signature }, { cookie: a.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'payment_subscription_mismatch');
      assert.equal((await q1('SELECT status, credits_balance FROM memberships WHERE auth_user_id = $1', [a.user.id])).status, 'pending_payment');
      assert.equal(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'membership_payment_mismatch' AND auth_user_id = $1", [a.user.id]), 1);
    });

    test('a payment with no subscription invoice is refused', async () => {
      const m = await login(uniqueEmail('msn'));
      const sub = (await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie })).data.razorpay.subscription_id;
      const s = gateway.subscriptions.get(sub);
      s.status = 'authenticated';
      const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
      gateway.payments.set(id, { id, amount: s.addons.reduce((n, x) => n + Number(x.item.amount), 0), currency: 'INR', status: 'captured' });
      const signature = crypto.createHmac('sha256', RZP_SECRET).update(`${id}|${sub}`).digest('hex');
      const r = await api('POST', '/api/membership', { action: 'activate_paid', razorpay_subscription_id: sub, razorpay_payment_id: id, razorpay_signature: signature }, { cookie: m.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'payment_subscription_mismatch');
    });

    test('the genuine mandate payment activates and its invoice id is stored', async () => {
      const m = await login(uniqueEmail('msok'));
      const sub = await join(m.cookie);
      const mp = await q1("SELECT status, razorpay_invoice_id FROM membership_payments WHERE provider_subscription_id = $1 AND charge_kind = 'upfront'", [sub]);
      assert.equal(mp.status, 'paid');
      assert.match(mp.razorpay_invoice_id, /^inv_/);
    });
  });

  describe('membership lifecycle', () => {
    test('cancellation moves paid-through to the end of the month in progress; that month is kept', async () => {
      const m = await login(uniqueEmail('cxpt'));
      await join(m.cookie);
      const before = await q1('SELECT paid_through FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      const current = await q1('SELECT max(ends_at) AS ends FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 AND p.credits_granted_at IS NOT NULL', [m.user.id]);
      await ctx.db.query("UPDATE memberships SET lock_in_until = now() - interval '1 minute' WHERE auth_user_id = $1", [m.user.id]);
      assert.equal((await api('POST', '/api/membership', { action: 'cancel' }, { cookie: m.cookie })).status, 200);
      const row = await q1('SELECT status, paid_through FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.equal(row.status, 'cancelled');
      assert.equal(new Date(row.paid_through).getTime(), new Date(current.ends).getTime(), 'paid-through = end of the started month');
      assert.ok(new Date(row.paid_through) < new Date(before.paid_through), 'voided months no longer count');
      assert.equal(await count('SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 AND p.voided_at IS NULL AND p.credits_granted_at IS NOT NULL', [m.user.id]), 1, 'the started month is not voided');
    });

    test('a mandate cancelled from the UPI app also recalculates paid-through', async () => {
      const m = await login(uniqueEmail('upipt'));
      const sub = await join(m.cookie);
      const current = await q1('SELECT max(ends_at) AS ends FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 AND p.credits_granted_at IS NOT NULL', [m.user.id]);
      assert.equal((await sendWebhook(subscriptionEvent('subscription.cancelled', sub, { status: 'cancelled' }))).status, 200);
      assert.equal(new Date((await q1('SELECT paid_through FROM memberships WHERE auth_user_id = $1', [m.user.id])).paid_through).getTime(), new Date(current.ends).getTime());
    });

    test('subscription.resumed after a halt resumes the mandate only; the membership waits for a successful debit', async () => {
      const m = await login(uniqueEmail('resume'));
      const sub = await join(m.cookie);
      await sendWebhook(subscriptionEvent('subscription.halted', sub, { status: 'halted' }));
      const halted = await q1('SELECT status, billing_status, credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.deepEqual([halted.status, halted.billing_status], ['paused', 'halted']);
      assert.equal((await sendWebhook(subscriptionEvent('subscription.resumed', sub, { status: 'active' }))).status, 200);
      const row = await q1('SELECT status, billing_status, mandate_status, credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.deepEqual([row.status, row.billing_status, row.mandate_status, row.credits_balance], ['paused', 'halted', 'active', halted.credits_balance]);
      const view = (await api('GET', '/api/membership', undefined, { cookie: m.cookie })).data;
      assert.equal(view.billing.credits_frozen, true, 'credits stay frozen until money is received');
    });
  });
});
