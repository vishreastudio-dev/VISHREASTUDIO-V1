// Walkin Wardrobe features from the requirements (MEM-02, MEM-05/06, MEM-12..15) and the
// notification log: Wardrobe Bag shipping, members' early access, online gift memberships.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, authoriseSubscription, ctx, dbSkipReason, login, pay, setup, teardown, uniqueEmail, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();
let admin;
const q1 = async (sql, params = []) => (await ctx.db.query(sql, params)).rows[0];

async function join(cookie) {
  const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const a = await api('POST', '/api/membership', { action: 'activate_paid', ...authoriseSubscription(start.data.razorpay.subscription_id) }, { cookie });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return a.data;
}

async function piece(name, extra = {}) {
  const r = await api('POST', '/api/admin/ops?section=product', { name: `${name} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`, price_inr: 1200, category: 'Tops', is_one_of_one: true, ...extra }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.product;
}

async function pickWithCredit(cookie, p) {
  const add = await api('POST', '/api/cart', { variant_id: p.variants[0].id }, { cookie });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const cart = await api('GET', '/api/cart', undefined, { cookie });
  const line = cart.data.items.find((i) => i.variant_id === p.variants[0].id);
  const t = await api('PATCH', '/api/cart', { item_id: line.id, use_credit: true }, { cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

const ADDRESS = { name: 'Asha Rao', phone: '+91 98450 00000', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };

describe('Walkin Wardrobe', { skip, timeout: 600_000 }, () => {
  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
  }, { timeout: 120_000 });
  after(teardown);

  describe('Wardrobe Bag (MEM-05, MEM-06)', () => {
    test('credit picks are sold at once and wait in the bag; fewer than 4 ship for ₹99 after a verified payment', async () => {
      const m = await login(uniqueEmail('bag'));
      await join(m.cookie);
      const a = await piece('Bag A');
      const b = await piece('Bag B');
      await pickWithCredit(m.cookie, a);
      await pickWithCredit(m.cookie, b);
      const co = await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal(co.data.in_bag, true);
      assert.equal(Number(co.data.totals.total), 0);
      assert.equal((await q1('SELECT status FROM orders WHERE id = $1', [co.data.order_id])).status, 'in_bag');
      assert.equal((await q1('SELECT stock_quantity FROM product_variants WHERE id = $1', [a.variants[0].id])).stock_quantity, 0, 'sold: nobody else can buy it (MEM-05)');
      assert.equal((await q1('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id])).credits_balance, 2);

      let w = await api('GET', '/api/wardrobe', undefined, { cookie: m.cookie });
      assert.equal(w.data.bag.pieces, 2);
      assert.equal(w.data.bag.fee.delivery, 99);
      const ship = await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'delivery', shipping_address: ADDRESS }, { cookie: m.cookie });
      assert.equal(ship.status, 200, JSON.stringify(ship.data));
      assert.equal(ship.data.status, 'pending_payment');
      assert.equal(ship.data.razorpay.amount, 9900);
      assert.equal((await q1('SELECT status FROM orders WHERE id = $1', [co.data.order_id])).status, 'in_bag', 'nothing ships before the fee is paid');
      // A browser success with a forged signature changes nothing.
      const p = pay(ship.data.razorpay.order_id);
      assert.equal((await api('POST', '/api/wardrobe', { action: 'confirm_bag_payment', ...p, razorpay_signature: 'f'.repeat(64) }, { cookie: m.cookie })).status, 400);
      const ok = await api('POST', '/api/wardrobe', { action: 'confirm_bag_payment', ...p }, { cookie: m.cookie });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      const o = await q1('SELECT status, bag_shipment_id, shipping_method FROM orders WHERE id = $1', [co.data.order_id]);
      assert.equal(o.status, 'processing');
      assert.ok(o.bag_shipment_id);
      w = await api('GET', '/api/wardrobe', undefined, { cookie: m.cookie });
      assert.equal(w.data.bag.pieces, 0);
    });

    test('4 or more credit picks ship free; studio pickup is free; paid pieces and an empty bag are refused', async () => {
      const m = await login(uniqueEmail('bag4'));
      await join(m.cookie);
      await ctx.db.query("UPDATE membership_periods p SET starts_at = p.starts_at - interval '1 month', ends_at = p.ends_at - interval '1 month' FROM memberships mm WHERE mm.id = p.membership_id AND mm.auth_user_id = $1", [m.user.id]);
      await ctx.db.query("UPDATE memberships SET paid_through = paid_through - interval '1 month' WHERE auth_user_id = $1", [m.user.id]);
      assert.equal((await api('GET', '/api/membership', undefined, { cookie: m.cookie })).data.membership.credits_balance, 8);
      for (let i = 0; i < 4; i += 1) await pickWithCredit(m.cookie, await piece(`Four ${i}`));
      assert.equal((await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie })).status, 201);
      const ship = await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'delivery', shipping_address: ADDRESS }, { cookie: m.cookie });
      assert.equal(ship.data.status, 'paid');
      assert.equal(ship.data.shipping_fee, 0);
      assert.equal((await q1("SELECT count(*)::int AS n FROM orders WHERE auth_user_id = $1 AND status = 'processing' AND bag_shipment_id IS NOT NULL", [m.user.id])).n, 1);

      await pickWithCredit(m.cookie, await piece('Pickup one'));
      await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie });
      const pickup = await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'pickup', shipping_address: { name: 'Asha', phone: '+91 98450 00000' } }, { cookie: m.cookie });
      assert.equal(pickup.data.shipping_fee, 0, 'studio pickup is free');

      const paidPiece = await piece('Paid piece');
      await api('POST', '/api/cart', { variant_id: paidPiece.variants[0].id }, { cookie: m.cookie });
      const refused = await api('POST', '/api/checkout', { shipping_method: 'bag' }, { cookie: m.cookie });
      assert.equal(refused.status, 400);
      assert.equal(refused.data.error, 'bag_credit_picks_only');
      assert.equal((await api('POST', '/api/wardrobe', { action: 'ship_bag', shipping_method: 'delivery', shipping_address: ADDRESS }, { cookie: m.cookie })).data.error, 'bag_empty');
    });
  });

  describe('members’ 48-hour early access (MEM-02, CAT-09)', () => {
    test('a piece in a drop is members-only until the drop goes public, in the catalogue, product page, bag and checkout', async () => {
      const name = `Early Drop ${Date.now()}`;
      const startsAt = new Date(Date.now() - 3600_000).toISOString();
      const publicAt = new Date(Date.now() + 47 * 3600_000).toISOString();
      assert.equal((await api('POST', '/api/admin/ops?section=drop', { name, starts_at: startsAt, public_at: publicAt }, { cookie: admin.cookie })).status, 200);
      const drop = await q1('SELECT id FROM drop_settings WHERE name = $1', [name]);
      const p = await piece('Early piece', { drop_id: drop.id });

      const shopper = await login(uniqueEmail('pub'));
      const member = await login(uniqueEmail('mem'));
      await join(member.cookie);
      const inCatalogue = async (cookie) => (await api('GET', `/api/catalogue?q=${encodeURIComponent('Early piece')}`, undefined, { cookie })).data.products.some((x) => x.id === p.id);
      assert.equal(await inCatalogue(undefined), false, 'hidden from the public');
      assert.equal(await inCatalogue(shopper.cookie), false, 'hidden from signed-in non-members');
      assert.equal(await inCatalogue(member.cookie), true, 'members see it');
      assert.equal((await api('GET', `/api/product?slug=${p.slug}`)).status, 404);
      const pm = await api('GET', `/api/product?slug=${p.slug}`, undefined, { cookie: member.cookie });
      assert.equal(pm.status, 200);
      assert.equal(pm.data.product.members_early_access, true);
      assert.match(pm.headers.get('cache-control'), /private/, 'member responses are never shared-cached');
      const blocked = await api('POST', '/api/cart', { variant_id: p.variants[0].id }, { cookie: shopper.cookie });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.data.error, 'members_early_access');
      assert.equal((await api('POST', '/api/cart', { variant_id: p.variants[0].id }, { cookie: member.cookie })).status, 200);

      // A non-member who added it earlier (before it was scheduled) still cannot check out.
      const other = await piece('Early piece two');
      await api('POST', '/api/cart', { variant_id: other.variants[0].id }, { cookie: shopper.cookie });
      await ctx.db.query('UPDATE products SET drop_id = $2 WHERE id = $1', [other.id, drop.id]);
      const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'P', phone: '+91 9000000001' } }, { cookie: shopper.cookie });
      assert.equal(co.status, 409);
      assert.equal(co.data.error, 'members_early_access');

      await ctx.db.query("UPDATE drop_settings SET public_at = now() - interval '1 minute' WHERE id = $1", [drop.id]);
      assert.equal(await inCatalogue(shopper.cookie), true, 'public after 48 hours');
    });

    test('a drop that has not started is hidden from everyone, members included', async () => {
      const name = `Future Drop ${Date.now()}`;
      await api('POST', '/api/admin/ops?section=drop', { name, starts_at: new Date(Date.now() + 86_400_000).toISOString(), public_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }, { cookie: admin.cookie });
      const drop = await q1('SELECT id FROM drop_settings WHERE name = $1', [name]);
      const p = await piece('Future piece', { drop_id: drop.id });
      const member = await login(uniqueEmail('mem2'));
      await join(member.cookie);
      assert.equal((await api('GET', `/api/product?slug=${p.slug}`, undefined, { cookie: member.cookie })).status, 404);
      assert.ok(!(await api('GET', '/sitemap.xml')).data.includes(p.slug), 'not in the sitemap');
    });
  });

  describe('online gift memberships (MEM-12..15)', () => {
    test('“Gift to her”: pre-booked months paid once, code issued only after a verified payment, recipient notified', async () => {
      const buyer = await login(uniqueEmail('gifter'));
      const start = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 3, sender_phone: '+91 98450 33333', recipient_name: 'Asha', recipient_email: uniqueEmail('asha'), message: 'Happy birthday' }, { cookie: buyer.cookie });
      assert.equal(start.status, 200, JSON.stringify(start.data));
      assert.equal(start.data.amount, 5397, '3 × ₹1,799, no autopay');
      assert.equal(start.data.razorpay.amount, 539700);
      const e = await q1('SELECT * FROM admin_gift_enquiries WHERE id = $1', [start.data.enquiry_id]);
      assert.equal(e.status, 'pending');
      // Unpaid: the admin cannot invoice it or issue a code.
      assert.equal((await api('POST', '/api/admin/ops?section=gift_enquiry', { id: e.id, status: 'processed' }, { cookie: admin.cookie })).data.error, 'online_gift_payment_driven');
      const r = await api('POST', '/api/gifting', { action: 'confirm_payment', ...pay(start.data.razorpay.order_id) }, { cookie: buyer.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const paid = await q1('SELECT status, paid_at FROM admin_gift_enquiries WHERE id = $1', [e.id]);
      assert.equal(paid.status, 'invoiced');
      assert.ok(paid.paid_at);
      assert.equal((await q1("SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1 AND status = 'issued'", [e.id])).n, 1);
      assert.ok((await q1("SELECT 1 AS ok FROM notifications WHERE event = 'gift_received' AND dedupe_key = $1", [`gift:${e.id}`]))?.ok, 'the activation link was sent (logged)');
      // Repeated confirmation does not issue a second code.
      await api('POST', '/api/gifting', { action: 'confirm_payment', ...pay(start.data.razorpay.order_id) }, { cookie: buyer.cookie });
      assert.equal((await q1('SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1', [e.id])).n, 1);
    });

    test('“I’ll pick for her”: the gifter holds a prepaid membership for her wearer profile; not on top of autopay', async () => {
      const buyer = await login(uniqueEmail('picker'));
      const w = await api('POST', '/api/account', { action: 'wearer', name: 'Mom', relationship: 'Mother' }, { cookie: buyer.cookie });
      assert.equal(w.status, 201, JSON.stringify(w.data));
      const start = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'pick_for_her', membership_months: 2, sender_phone: '+91 98450 44444', wearer_id: w.data.wearer.id }, { cookie: buyer.cookie });
      assert.equal(start.status, 200, JSON.stringify(start.data));
      const r = await api('POST', '/api/gifting', { action: 'confirm_payment', ...pay(start.data.razorpay.order_id) }, { cookie: buyer.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const m = await q1('SELECT status, billing_status, gift, gift_mode, gift_wearer_id, credits_balance, autopay_subscription_id FROM memberships WHERE auth_user_id = $1', [buyer.user.id]);
      assert.deepEqual([m.status, m.billing_status, m.gift, m.gift_mode, m.gift_wearer_id, m.credits_balance, m.autopay_subscription_id], ['active', 'prepaid', true, 'pick_for_her', w.data.wearer.id, 4, null]);

      const autopay = await login(uniqueEmail('autopaygift'));
      await join(autopay.cookie);
      const w2 = await api('POST', '/api/account', { action: 'wearer', name: 'Wife' }, { cookie: autopay.cookie });
      const refused = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'pick_for_her', membership_months: 2, sender_phone: '+91 98450 55555', wearer_id: w2.data.wearer.id }, { cookie: autopay.cookie });
      assert.equal(refused.status, 409);
      assert.equal(refused.data.error, 'autopay_membership_active');
      const other = await login(uniqueEmail('stranger'));
      const notMine = await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'pick_for_her', membership_months: 2, sender_phone: '+91 98450 66666', wearer_id: w.data.wearer.id }, { cookie: other.cookie });
      assert.equal(notMine.data.error, 'wearer_not_found', 'another customer’s wearer profile cannot be used');
    });

    test('gift durations are pre-booked months of at least 2; a gift box adds ₹50 packing at checkout', async () => {
      const buyer = await login(uniqueEmail('gift1'));
      assert.equal((await api('POST', '/api/gifting', { action: 'purchase', gift_mode: 'gift_to_her', membership_months: 1, sender_phone: '+91 98450 77777', recipient_name: 'A', recipient_email: uniqueEmail('a') }, { cookie: buyer.cookie })).status, 400);
      const p = await piece('Gift box');
      await api('POST', '/api/cart', { variant_id: p.variants[0].id }, { cookie: buyer.cookie });
      const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'B', phone: '+91 9000000002' }, gift: true, gift_message: 'For you' }, { cookie: buyer.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal(Number(co.data.totals.gift_fee), 50);
    });
  });

  describe('account deletion and admin permissions', () => {
    test('“Delete my account and data” needs a typed confirmation, stops billing first, erases data and ends every session', async () => {
      const m = await login(uniqueEmail('erase'));
      const view = await join(m.cookie);
      const subId = (await q1('SELECT autopay_subscription_id FROM memberships WHERE auth_user_id = $1', [m.user.id])).autopay_subscription_id;
      await api('POST', '/api/account', { action: 'wearer', name: 'Me' }, { cookie: m.cookie });
      assert.equal((await api('POST', '/api/account', { action: 'delete_data' }, { cookie: m.cookie })).data.error, 'confirmation_required');
      const r = await api('POST', '/api/account', { action: 'delete_data', confirm: 'DELETE' }, { cookie: m.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const row = await q1('SELECT status, cancel_reason, credits_balance FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.deepEqual([row.status, row.cancel_reason, row.credits_balance], ['cancelled', 'account_deleted', 0]);
      const { gateway } = await import('./helpers.js');
      assert.equal(gateway.subscriptions.get(subId).status, 'cancelled', 'no further autopay debits');
      assert.equal((await q1('SELECT count(*)::int AS n FROM wearer_profiles WHERE auth_user_id = $1', [m.user.id])).n, 0);
      assert.equal((await api('GET', '/api/account', undefined, { cookie: m.cookie })).status, 401, 'the session was revoked');
      assert.ok(view.membership.credits_balance > 0);
    });

    test('customers cannot use admin billing data or exports', async () => {
      const c = await login(uniqueEmail('nosy'));
      for (const path of ['/api/admin/ops?section=export&type=membership_payments', '/api/admin/ops?section=export&type=payment_attempts', '/api/admin/ops?section=customers']) {
        assert.equal((await api('GET', path, undefined, { cookie: c.cookie })).status, 403, path);
      }
      const csv = await api('GET', '/api/admin/ops?section=export&type=membership_payments', undefined, { cookie: admin.cookie });
      assert.equal(csv.status, 200);
      assert.match(String(csv.data), /charge_kind/);
    });
  });

  describe('notifications', () => {
    test('membership events are logged per channel; WhatsApp is recorded as not configured, never silently dropped', async () => {
      const m = await login(uniqueEmail('notif'));
      await join(m.cookie);
      const rows = (await ctx.db.query("SELECT channel, status, reason FROM notifications WHERE auth_user_id = $1 AND event = 'membership_activated'", [m.user.id])).rows;
      assert.ok(rows.some((r) => r.channel === 'whatsapp' && r.status === 'skipped' && r.reason === 'provider_not_configured'));
      assert.ok(rows.some((r) => r.channel === 'email'));
      const { notify } = await import('../lib/notify.js');
      const again = await notify(ctx.db, { authUserId: m.user.id, event: 'membership_activated', data: {}, dedupeKey: (await q1("SELECT dedupe_key FROM notifications WHERE auth_user_id = $1 AND event = 'membership_activated' LIMIT 1", [m.user.id])).dedupe_key });
      assert.equal(again.reason, 'duplicate', 'a repeated event is not sent twice');
      const marketing = await notify(ctx.db, { authUserId: m.user.id, event: 'credits_expiring', data: { credits: 1, date: 'x', link: 'y' }, category: 'marketing' });
      assert.equal(marketing.reason, 'no_marketing_consent');
    });
  });
});
