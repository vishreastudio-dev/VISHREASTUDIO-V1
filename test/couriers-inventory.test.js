// Courier management (admin registry, dispatch, customer tracking, history) and sold-out state
// across the public catalogue, product and bag APIs.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ctx, dbSkipReason, DELIVERY, login, pay, setup, teardown, uniqueEmail, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();
let admin;

const ops = (section, body, method = 'POST', cookie = admin.cookie) => api(method, `/api/admin/ops?section=${section}`, body, { cookie });

async function product(name, variants) {
  const r = await ops('product', { name, price_inr: 2000, category: 'Tops', ...(variants ? { variants, is_one_of_one: false } : { is_one_of_one: true }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.product;
}

/** A paid, packed order for a fresh one-of-one piece. */
async function paidOrder() {
  const buyer = await login(uniqueEmail('ship'));
  const p = await product(`Courier Piece ${Date.now()}`);
  await api('POST', '/api/cart', { variant_id: p.variants[0].id }, { cookie: buyer.cookie });
  const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
  assert.equal(co.status, 201, JSON.stringify(co.data));
  assert.equal((await api('POST', '/api/payment-verify', { order_id: co.data.order_id, ...pay(co.data.razorpay.order_id) }, { cookie: buyer.cookie })).status, 200);
  return { buyer, orderId: co.data.order_id };
}

describe('couriers and sold-out state', { skip, timeout: 300_000 }, () => {
  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
  }, { timeout: 120_000 });
  after(teardown);

  test('the seven existing couriers are seeded with their tracking pages', async () => {
    const r = await api('GET', '/api/admin/ops?section=couriers', undefined, { cookie: admin.cookie });
    assert.equal(r.status, 200);
    const names = r.data.couriers.map((c) => c.name);
    for (const n of ['Delhivery', 'BlueDart', 'DTDC', 'Shiprocket', 'India Post', 'Studio Pickup', 'Other']) assert.ok(names.includes(n), n);
    const pickup = r.data.couriers.find((c) => c.name === 'Studio Pickup');
    assert.equal(pickup.is_pickup, true);
    assert.equal(pickup.requires_tracking, false);
  });

  test('only admins can read or change couriers', async () => {
    const customer = await login(uniqueEmail('nocourier'));
    assert.equal((await api('GET', '/api/admin/ops?section=couriers')).status, 401);
    assert.equal((await api('GET', '/api/admin/ops?section=couriers', undefined, { cookie: customer.cookie })).status, 403);
    assert.equal((await ops('courier', { name: 'Sneaky Express' }, 'POST', customer.cookie)).status, 403);
  });

  test('create validates input; names are unique; update and search work', async () => {
    assert.equal((await ops('courier', { name: 'X' })).status, 400, 'name too short');
    assert.equal((await ops('courier', { name: 'Bad Web', website: 'javascript:alert(1)' })).status, 400);
    assert.equal((await ops('courier', { name: 'Bad Tpl', tracking_url_template: 'http://plain.example/{tracking}' })).status, 400, 'template must be https');
    assert.equal((await ops('courier', { name: 'Host Tpl', tracking_url_template: 'https://{tracking}.evil.example/' })).status, 400, 'AWB may not choose the host');
    assert.equal((await ops('courier', { name: 'Bad Phone', contact_phone: 'call me' })).status, 400);

    const created = await ops('courier', {
      name: 'Xpressbees', contact_person: 'Ravi', contact_phone: '+91 98450 11111', website: 'https://www.xpressbees.com',
      tracking_url_template: 'https://www.xpressbees.com/track?awb={tracking}', service_areas: 'Pan-India', service_description: 'Surface and air',
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.courier.is_active, true);
    assert.equal((await ops('courier', { name: ' xpressbees ' })).status, 409, 'duplicate name (case/space-insensitive)');

    const updated = await ops('courier', { id: created.data.courier.id, contact_person: 'Meera' });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.courier.contact_person, 'Meera');
    assert.equal(updated.data.courier.service_areas, 'Pan-India', 'partial update keeps other fields');

    const found = await api('GET', '/api/admin/ops?section=couriers&q=pan-india', undefined, { cookie: admin.cookie });
    assert.deepEqual(found.data.couriers.map((c) => c.name), ['Xpressbees']);
    const audit = (await ctx.db.query("SELECT action FROM audit_logs WHERE entity_type = 'courier' AND entity_id = $1 ORDER BY created_at", [created.data.courier.id])).rows.map((r) => r.action);
    assert.deepEqual(audit, ['create_courier', 'update_courier']);
  });

  test('dispatch with a new courier stores the link, history survives template edits and deactivation', async () => {
    const c = (await ops('courier', { name: `Ekart ${Date.now()}`, tracking_url_template: 'https://ekart.example/track/{tracking}' })).data.courier;
    const { buyer, orderId } = await paidOrder();
    const order = (body) => ops('order', { id: orderId, ...body });

    assert.equal((await order({ status: 'dispatched', courier_id: c.id })).status, 422, 'AWB required for this courier');
    assert.equal((await order({ status: 'dispatched', courier_id: c.id, tracking_number: '<script>' })).status, 400, 'AWB format checked');
    const ok = await order({ status: 'dispatched', courier_id: c.id, tracking_number: 'EK123456' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));

    const view = async () => (await api('GET', `/api/orders?id=${orderId}`, undefined, { cookie: buyer.cookie })).data.order;
    let o = await view();
    assert.equal(o.courier_partner, c.name);
    assert.equal(o.tracking_number, 'EK123456');
    assert.equal(o.tracking_url, 'https://ekart.example/track/EK123456');

    // Editing the courier's template or deactivating it must not rewrite a dispatched order.
    assert.equal((await ops('courier', { id: c.id, tracking_url_template: 'https://new.ekart.example/{tracking}' })).status, 200);
    assert.equal((await ops('courier_status', { id: c.id, is_active: false })).status, 200);
    assert.equal((await order({ status: 'delivered' })).status, 200, 'an order may finish with a courier deactivated after dispatch');
    o = await view();
    assert.equal(o.tracking_url, 'https://ekart.example/track/EK123456');
    assert.equal(o.courier_partner, c.name);

    const history = (await api('GET', `/api/admin/ops?section=order_shipments&id=${orderId}`, undefined, { cookie: admin.cookie })).data.events;
    assert.deepEqual(history.map((e) => e.status).reverse(), ['dispatched', 'delivered']);
    assert.equal(history.at(-1).tracking_url, 'https://ekart.example/track/EK123456');

    // Inactive couriers are not offered, cannot be newly chosen, and cannot be deleted once used.
    const active = (await api('GET', '/api/admin/ops?section=couriers&active=true', undefined, { cookie: admin.cookie })).data.couriers;
    assert.ok(!active.some((x) => x.id === c.id));
    const other = await paidOrder();
    assert.equal((await ops('order', { id: other.orderId, status: 'dispatched', courier_id: c.id, tracking_number: 'EK9' })).status, 422);
    const del = await api('DELETE', `/api/admin/ops?section=courier&id=${c.id}`, undefined, { cookie: admin.cookie });
    assert.equal(del.status, 409);
    assert.equal(del.data.error, 'courier_in_use');
  });

  test('an unused courier can be deleted; a static tracking page works without a deep link', async () => {
    const unused = (await ops('courier', { name: `Temp ${Date.now()}` })).data.courier;
    assert.equal((await api('DELETE', `/api/admin/ops?section=courier&id=${unused.id}`, undefined, { cookie: admin.cookie })).status, 200);
    assert.equal((await ctx.db.query('SELECT 1 FROM couriers WHERE id = $1', [unused.id])).rowCount, 0);

    const { buyer, orderId } = await paidOrder();
    assert.equal((await ops('order', { id: orderId, status: 'dispatched', courier_partner: 'India Post', tracking_number: 'EE123456789IN' })).status, 200, 'older clients may still send the courier name');
    const o = (await api('GET', `/api/orders?id=${orderId}`, undefined, { cookie: buyer.cookie })).data.order;
    assert.match(o.tracking_url, /^https:\/\/www\.indiapost\.gov\.in\//);
  });

  test('studio pickup dispatches without an AWB and is flagged for the tracker', async () => {
    const { buyer, orderId } = await paidOrder();
    const pickup = (await api('GET', '/api/admin/ops?section=couriers&q=studio', undefined, { cookie: admin.cookie })).data.couriers[0];
    assert.equal((await ops('order', { id: orderId, status: 'dispatched', courier_id: pickup.id })).status, 200);
    const o = (await api('GET', `/api/orders?id=${orderId}`, undefined, { cookie: buyer.cookie })).data.order;
    assert.equal(o.courier_is_pickup, true);
    assert.equal(o.tracking_url, null);
  });

  test('sold out, restock and per-size availability come from stock on the server', async () => {
    const one = await product(`Sold Badge ${Date.now()}`);
    const listed = async (id) => (await api('GET', '/api/catalogue?limit=100&sort=newest')).data.products.find((p) => p.id === id);
    const pdp = async () => (await api('GET', `/api/product?slug=${one.slug}`)).data.product;
    assert.equal((await listed(one.id)).available, true);
    assert.equal((await pdp()).available, true);

    // Another customer's checkout takes the last unit: cached listings must change at once.
    const other = await login(uniqueEmail('lastunit'));
    await api('POST', '/api/cart', { variant_id: one.variants[0].id }, { cookie: other.cookie });
    const held = await api('POST', '/api/checkout', DELIVERY, { cookie: other.cookie });
    assert.equal(held.status, 201);
    assert.equal((await listed(one.id)).available, false, 'sold-out pieces stay listed, marked unavailable');
    const p = await pdp();
    assert.equal(p.available, false);
    assert.equal(p.variants[0].stock_state, 'sold_out');
    assert.equal(p.variants[0].available_quantity, 0);
    assert.ok(!(await api('GET', '/api/catalogue?limit=100&in_stock=true')).data.products.some((x) => x.id === one.id), 'in-stock filter runs on the server');

    const buyer = await login(uniqueEmail('soldout'));
    const add = await api('POST', '/api/cart', { variant_id: one.variants[0].id }, { cookie: buyer.cookie });
    assert.equal(add.status, 409);
    assert.equal(add.data.error, 'out_of_stock');

    // The hold is released: the piece is available again everywhere.
    assert.equal((await api('POST', '/api/checkout', { action: 'cancel', order_id: held.data.order_id }, { cookie: other.cookie })).status, 200);
    assert.equal((await listed(one.id)).available, true, 'restock removes the badge');
    assert.equal((await pdp()).available, true);
    assert.equal((await api('POST', '/api/cart', { variant_id: one.variants[0].id }, { cookie: buyer.cookie })).status, 200);

    // Sold out while in the bag: the line is flagged and checkout refuses it.
    await ctx.db.query('UPDATE product_variants SET stock_quantity = 0 WHERE product_id = $1', [one.id]);
    const bag = (await api('GET', '/api/cart', undefined, { cookie: buyer.cookie })).data;
    assert.equal(bag.items.find((i) => i.variant_id === one.variants[0].id).issue, 'sold_out');
    assert.equal((await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie })).status, 409);

    const multi = await product(`Sizes ${Date.now()}`, [
      { size_label: 'S', price_inr: 2000, stock_quantity: 0 },
      { size_label: 'M', price_inr: 2000, stock_quantity: 2 },
    ]);
    const m = await listed(multi.id);
    assert.equal(m.available, true, 'one sold-out size does not mark the piece sold out');
    assert.deepEqual(m.sizes, ['M']);
    const states = Object.fromEntries((await api('GET', `/api/product?slug=${multi.slug}`)).data.product.variants.map((v) => [v.size_label, v.stock_state]));
    assert.equal(states.S, 'sold_out');
    assert.notEqual(states.M, 'sold_out');
  });

  test('public responses are cached for guests, never for members, and cleared by admin writes', async () => {
    const piece = await product(`Cache ${Date.now()}`);
    const url = '/api/catalogue?limit=100&sort=newest';
    await api('GET', url);
    const second = await api('GET', url);
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.ok(second.data.products.some((x) => x.id === piece.id));

    assert.equal((await ops('product_status', { id: piece.id, is_active: false })).status, 200);
    const after = await api('GET', url);
    assert.equal(after.headers.get('x-cache'), 'miss', 'an admin write clears the cache');
    assert.ok(!after.data.products.some((x) => x.id === piece.id), 'a hidden piece disappears at once');

    const content = await api('GET', '/api/content');
    assert.equal(content.status, 200);
    assert.equal((await api('GET', '/api/content')).headers.get('x-cache'), 'hit');

    const member = await login(uniqueEmail('cachemember'));
    await ctx.db.query("INSERT INTO memberships (auth_user_id, status, credits_balance) VALUES ($1, 'active', 0)", [member.user.id]);
    const mine = await api('GET', url, undefined, { cookie: member.cookie });
    assert.equal(mine.headers.get('x-cache'), null, 'member responses bypass the shared cache');
    assert.match(mine.headers.get('cache-control'), /^private/);
  });
});
