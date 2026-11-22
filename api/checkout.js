import crypto from 'crypto';
import { db } from '../lib/db.js';
import { AppError, badRequest, conflict, notFound } from '../lib/http.js';
import { loadCartLines } from '../lib/cart.js';
import { calculateCartPrice, isCreditEligible } from '../lib/pricing.js';
import { getSettings } from '../lib/settings.js';
import { expireOrder, reserve, reserveRewards } from '../lib/inventory.js';
import { reconcileExpiredCredits } from '../lib/credits.js';
import { refreshMembership } from '../lib/membership.js';
import { creditsBlockedMessage, creditsUsable } from '../lib/billing.js';
import { isRewardEligible } from '../lib/rewards.js';
import { finalizeOrderPayment } from '../lib/payments.js';
import { razorpay } from '../lib/razorpay.js';
import { checkoutFields, issueLocalOrderPayment } from '../lib/local-pay.js';
import { audit } from '../lib/audit.js';
import { log } from '../lib/log.js';
import { bool, gstin, indianState, oneOf, phone, text, uuid } from '../lib/validate.js';
import { nextHumanId, ID_PREFIXES } from '../lib/id-generator.js';

export const access = 'user';
export const methods = ['POST'];
export const rateLimitPerUser = { windowMs: 60_000, max: 12 };

function parseAddress(raw, method) {
  if (method === 'bag') return { held_in: 'wardrobe_bag' };
  const a = raw && typeof raw === 'object' ? raw : {};
  const name = text(a.name, { max: 120, field: 'name', required: true });
  // Couriers and the studio both need a contact number.
  const contact = phone(a.phone, { required: true });
  if (method === 'pickup') return { name, phone: contact };
  const pincode = text(a.pincode ?? a.pin, { max: 6, field: 'pincode', required: true });
  if (!/^[1-9]\d{5}$/.test(pincode)) throw badRequest('invalid_pincode', 'Enter a valid 6-digit PIN code');
  return {
    name,
    phone: contact,
    line1: text(a.line1 ?? a.address, { max: 200, field: 'address', required: true }),
    line2: text(a.line2, { max: 200, field: 'address_line2' }),
    city: text(a.city, { max: 80, field: 'city', required: true }),
    state: indianState(a.state, { required: true }),
    pincode,
  };
}

function paymentPayload(order, user) {
  return {
    order_id: order.id,
    status: order.status,
    payment_status: order.payment_status,
    expires_at: order.payment_expires_at,
    totals: {
      subtotal: order.subtotal,
      credit_discount: Math.max(0, Math.round((Number(order.subtotal) + Number(order.shipping_fee) + Number(order.gift_packing_fee || 0) - Number(order.total) - Number(order.discount_amount || 0)) * 100) / 100),
      discount_amount: order.discount_amount || 0,
      shipping: order.shipping_fee,
      gift_fee: order.gift_packing_fee,
      taxable_amount: order.taxable_amount,
      tax_amount: order.tax_amount,
      cgst: order.cgst_amount,
      sgst: order.sgst_amount,
      igst: order.igst_amount,
      total: order.total,
    },
    razorpay: order.razorpay_order_id
      ? checkoutFields({
          key_id: razorpay.keyId,
          order_id: order.razorpay_order_id,
          amount: order.amount_paise,
          currency: 'INR',
          name: 'Vishrea Studio',
          prefill: { name: order.shipping_address?.name || user.name || '', email: user.email || '', contact: order.shipping_address?.phone || '' },
          local_confirm: { path: '/api/checkout', body: { action: 'complete_local', order_id: order.id } },
        })
      : null,
  };
}

async function attachGatewayOrder(order, user) {
  try {
    const rp = await razorpay.createOrder({ amountPaise: order.amount_paise, receipt: order.id, notes: { order_id: order.id, customer: user.id } });
    if (Number(rp.amount) !== Number(order.amount_paise) || rp.currency !== 'INR') throw new AppError(502, 'payment_gateway_error', 'Gateway amount mismatch');
    const r = await db.query(
      'UPDATE orders SET razorpay_order_id = $2, updated_at = now() WHERE id = $1 AND razorpay_order_id IS NULL RETURNING *',
      [order.id, rp.id]
    );
    return r.rows[0] || (await db.query('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
  } catch (err) {
    // Never leave stock held for an order that cannot be paid.
    await db.tx((c) => expireOrder(c, order.id, err.code || 'gateway_order_failed'));
    throw err;
  }
}

async function startCheckout(req, res) {
  const user = req.user;
  const b = req.body || {};
  const method = b.shipping_method ? oneOf(b.shipping_method, ['delivery', 'pickup', 'bag'], { field: 'shipping_method' }) : bool(b.studio_pickup) ? 'pickup' : 'delivery';
  const address = parseAddress(b.shipping_address, method);
  const gift = method !== 'bag' && bool(b.gift);
  const giftMessage = gift ? text(b.gift_message, { max: 300, field: 'gift_message' }) : null;
  const buyerGstin = bool(b.gst_invoice_requested) ? gstin(b.buyer_gstin) : null;
  const promoCode = text(b.promo_code || b.offer_code, { max: 40, field: 'promo_code' });
  const idemKey = text(b.idempotency_key || req.headers['idempotency-key'], { max: 80, field: 'idempotency_key' });

  if (idemKey) {
    const prior = (await db.query('SELECT * FROM orders WHERE auth_user_id = $1 AND idempotency_key = $2', [user.id, idemKey])).rows[0];
    if (prior) {
      if (prior.payment_status === 'pending' && !prior.razorpay_order_id && Number(prior.total) > 0) {
        return res.json(paymentPayload(await attachGatewayOrder(prior, user), user));
      }
      return res.json(paymentPayload(prior, user));
    }
  }

  const settings = await getSettings();
  const placeOfSupply = method === 'pickup' ? settings.seller_state : address.state;

  // Commit expiry before checkout. A later rejection (empty bag, out of stock) must not roll the write-off back.
  await db.tx(async (c) => {
    await refreshMembership(c, user.id, settings);
    await reconcileExpiredCredits(c, user.id);
  });

  const outcome = await db.tx(async (c) => {
    // Serialise concurrent checkouts for the same customer (multiple tabs, double clicks).
    await c.query("SELECT pg_advisory_xact_lock(hashtext('checkout:' || $1))", [user.id]);

    // Re-check under the lock: a concurrent duplicate may have just created the order.
    if (idemKey) {
      const prior = (await c.query('SELECT * FROM orders WHERE auth_user_id = $1 AND idempotency_key = $2', [user.id, idemKey])).rows[0];
      if (prior) return { reuse: prior };
    }

    let lines = await loadCartLines(c, user.id);
    if (!lines.length) throw badRequest('cart_empty', 'Your bag is empty');

    let offer = null;
    let codeToUse = promoCode;
    if (!codeToUse) {
      const cartRow = (await c.query('SELECT applied_promo_code FROM carts WHERE auth_user_id = $1', [user.id])).rows[0];
      if (cartRow?.applied_promo_code) codeToUse = cartRow.applied_promo_code;
    }

    if (codeToUse) {
      const cleanCode = codeToUse.trim().toUpperCase();
      const offRes = await c.query(
        `SELECT * FROM offers
         WHERE upper(code) = $1 AND active = true
           AND (ends_at IS NULL OR ends_at > now())
           AND (starts_at IS NULL OR starts_at <= now())`,
        [cleanCode]
      );
      offer = offRes.rows[0] || null;
      if (!offer) {
        throw badRequest('invalid_offer_code', 'The promo code entered is invalid or has expired');
      }

      // Check if targeted to specific customers
      const targeted = await c.query(
        `SELECT auth_user_id FROM loyalty_events
         WHERE event_type = 'special_offer_distributed' AND upper(details->>'code') = $1
         LIMIT 20`,
        [cleanCode]
      );
      if (targeted.rows.length > 0 && !targeted.rows.some((r) => r.auth_user_id === user.id)) {
        throw badRequest('exclusive_offer', 'This exclusive studio privilege is reserved for another client account');
      }

      // Check if already redeemed on a completed order
      const redeemed = await c.query(
        `SELECT le.id FROM loyalty_events le
         LEFT JOIN orders o ON o.id::text = (le.details->>'order_id')
         WHERE le.auth_user_id = $1
           AND le.event_type = 'special_offer_redeemed'
           AND upper(le.details->>'code') = $2
           AND (o.id IS NULL OR o.payment_status = 'paid')
         LIMIT 1`,
        [user.id, cleanCode]
      );
      if (redeemed.rows.length > 0) {
        throw badRequest('offer_already_redeemed', 'You have already redeemed this studio privilege on a previous order');
      }
    }

    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ l: lines.map((l) => [l.variant_id, l.quantity, l.use_credit, l.reward_entitlement_id || null]).sort(), method, placeOfSupply, gift, promo: offer?.code || null }))
      .digest('hex');

    // Refresh / retry of the same bag: hand back the open payment instead of holding stock twice.
    // A different bag supersedes the customer's earlier unpaid order and releases its hold first.
    const open = await c.query(
      `SELECT * FROM orders WHERE auth_user_id = $1 AND payment_status = 'pending' AND payment_expires_at > now() ORDER BY created_at DESC`,
      [user.id]
    );
    let released = false;
    for (const o of open.rows) {
      if (o.checkout_fingerprint === fingerprint && !released) return { reuse: o };
      released = (await expireOrder(c, o.id, 'superseded_by_new_checkout')) || released;
    }
    if (released) lines = await loadCartLines(c, user.id);

    const blocked = lines.find((l) => l.issue);
    if (blocked?.issue === 'early_access') {
      throw conflict('members_early_access', `${blocked.name} is in members' early access. It opens to everyone when the drop goes public.`, { item_id: blocked.id, issue: blocked.issue });
    }
    if (blocked?.issue === 'reward_unavailable') {
      throw conflict('reward_unavailable', `The free-piece reward on ${blocked.name} is no longer available. Please update your bag.`, { item_id: blocked.id, issue: blocked.issue });
    }
    if (blocked) {
      throw conflict(blocked.issue === 'unavailable' ? 'product_unavailable' : 'out_of_stock', `${blocked.name} (${blocked.size_label}) is no longer available in that quantity. Please update your bag.`, {
        item_id: blocked.id,
        issue: blocked.issue,
      });
    }

    const membership = (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [user.id])).rows[0] || null;
    if (membership) {
      const reconciled = await reconcileExpiredCredits(c, user.id);
      if (reconciled) membership.credits_balance = reconciled.balance;
    }
    for (const l of lines) {
      if (l.use_credit && !isCreditEligible(l)) throw badRequest('premium_cannot_use_credit', `${l.name} is not eligible for wardrobe credits`);
      if (l.reward_entitlement_id && (!isRewardEligible(l, settings) || Number(l.quantity) !== 1)) {
        throw badRequest('reward_not_eligible', `${l.name} is not eligible for a free-piece reward`);
      }
    }

    // The Wardrobe Bag holds credit and free-piece picks only (MEM-06); paid pieces check out normally.
    if (method === 'bag' && lines.some((l) => !l.use_credit && !l.reward_entitlement_id)) {
      throw badRequest('bag_credit_picks_only', 'Only pieces picked with a credit or a free-piece reward can wait in your Wardrobe Bag. Check out paid pieces separately.');
    }
    const orderCount = Number(
      (await c.query("SELECT count(*)::int AS count FROM orders WHERE auth_user_id = $1 AND payment_status = 'paid'", [user.id])).rows[0]?.count || 0
    );
    // Server prices only. Client total, amount, and unit-price fields are ignored.
    const price = calculateCartPrice({ lines, method, gift, placeOfSupply, membership, settings, orderCount, offer });
    if (price.credits_used && !creditsUsable(membership)) {
      throw badRequest('membership_not_active', creditsBlockedMessage(membership));
    }
    if (price.credits_used && Number(membership.credits_balance) < price.credits_used) {
      throw badRequest('insufficient_credits', 'You do not have enough wardrobe credits for this bag');
    }
    // A bag that needs online payment is refused before any order, stock hold or credit debit is written.
    if (Number(price.total) > 0 && !razorpay.configured) {
      throw new AppError(503, 'payments_unavailable', 'Online payment is not available right now. Your bag has been kept.');
    }

    const reservationMinutes = Math.min(60, Math.max(5, Number(settings.reservation_minutes) || 15));
    const discountAmount = Math.round(((price.reward_discount || 0) + (price.loyalty_discount || 0) + (price.offer_discount || 0)) * 100) / 100;
    const orderNumber = await nextHumanId(c, ID_PREFIXES.ORDER);
    const ins = await c.query(
      `INSERT INTO orders (auth_user_id, status, payment_status, subtotal, shipping_fee, total, shipping_address, gst_invoice_requested,
                           gift, gift_message, gift_packing_fee, channel, shipping_method, idempotency_key, checkout_fingerprint, amount_paise,
                           payment_expires_at, taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount, place_of_supply, credits_used, buyer_gstin,
                           rewards_used, discount_amount, order_number)
       VALUES ($1,'pending_payment','pending',$2,$3,$4,$5,$6,$7,$8,$9,'web',$10,$11,$12,$13, now() + make_interval(mins => $14),$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [user.id, price.subtotal, price.shipping, price.total, JSON.stringify(address), Boolean(buyerGstin), gift, giftMessage, price.gift_fee, method,
       idemKey, fingerprint, price.amount_paise, reservationMinutes, price.taxable_amount, price.cgst, price.sgst, price.igst, price.tax_amount,
       price.place_of_supply, price.credits_used, buyerGstin, price.rewards_used, discountAmount, orderNumber]
    );
    const order = ins.rows[0];

    for (const l of price.lines) {
      await c.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, sku, variant_label, product_name, unit_price, quantity, line_total,
                                  selected_size, use_credit, gst_rate, taxable_value, gst_amount, hsn_code, reward_entitlement_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$13,$14,$15)`,
        [order.id, l.product_id, l.variant_id, l.sku, l.size_label, l.name, l.unit_price, l.quantity, l.line_total, l.use_credit, l.gst_rate,
         l.taxable_value, l.gst_amount, l.hsn_code || '6204', l.reward_entitlement_id || null]
      );
    }

    await reserve(c, order.id, price.lines, reservationMinutes);
    await reserveRewards(c, order.id, user.id, price.lines.filter((l) => l.reward_entitlement_id).map((l) => l.reward_entitlement_id));

    if (price.credits_used) {
      const debit = await c.query(
        `UPDATE memberships SET credits_balance = credits_balance - $2, updated_at = now()
          WHERE id = $1 AND status = 'active' AND billing_status NOT IN ('retrying', 'halted') AND credits_balance >= $2 RETURNING id`,
        [membership.id, price.credits_used]
      );
      if (!debit.rows[0]) throw badRequest('insufficient_credits', 'You do not have enough wardrobe credits for this bag');
      await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, order_id) VALUES ($1,$2,$3,'redemption',$4)", [
        user.id, membership.id, -price.credits_used, order.id,
      ]);
    }

    if (offer && price.offer_discount > 0) {
      await c.query(
        `INSERT INTO loyalty_events (auth_user_id, event_type, reward_value, details)
         VALUES ($1, 'special_offer_redeemed', $2, $3)`,
        [user.id, price.offer_discount, JSON.stringify({ code: offer.code, order_id: order.id, discount_amount: price.offer_discount })]
      );
    }
    await c.query('UPDATE carts SET applied_promo_code = NULL WHERE auth_user_id = $1', [user.id]);

    await audit(c, { actor: user.id, action: 'checkout_started', entityType: 'order', entityId: order.id, details: { total: price.total, credits_used: price.credits_used, offer_code: offer?.code || null, offer_discount: price.offer_discount || 0, lines: price.lines.length } });
    return { order };
  });

  if (outcome.reuse) {
    const o = outcome.reuse;
    const ready = o.payment_status === 'pending' && !o.razorpay_order_id && Number(o.total) > 0 ? await attachGatewayOrder(o, user) : o;
    return res.json(paymentPayload(ready, user));
  }

  const order = outcome.order;
  if (Number(order.total) === 0) {
    const r = await finalizeOrderPayment({ orderId: order.id, paymentId: null, source: 'credits', gatewayChecked: true });
    if (method === 'bag' && r.status === 'paid') {
      // Sold now (MEM-05); it waits in the Wardrobe Bag until the member ships the bag.
      const held = await db.query("UPDATE orders SET status = 'in_bag', updated_at = now() WHERE id = $1 AND status = 'processing' RETURNING *", [order.id]);
      return res.status(201).json({ ...paymentPayload(held.rows[0] || r.order, user), payment_provider: 'credit', in_bag: true, message: 'Added to your Wardrobe Bag. These pieces are yours — ship the bag whenever you are ready.' });
    }
    const message = Number(order.rewards_used) > 0 && !Number(order.credits_used) ? 'Your free-piece reward covers this order.' : 'Your credits secured these pieces.';
    return res.status(201).json({ ...paymentPayload(r.order, user), payment_provider: 'credit', message });
  }

  const withGateway = await attachGatewayOrder(order, user);
  log.info('checkout.created', { order_id: order.id, amount_paise: order.amount_paise });
  res.status(201).json({ ...paymentPayload(withGateway, user), payment_provider: 'razorpay' });
}

export default async function checkout(req, res) {
  const action = req.body?.action;
  if (!action || action === 'start') return startCheckout(req, res);

  const orderId = uuid(req.body?.order_id, 'order_id');
  const order = (await db.query('SELECT * FROM orders WHERE id = $1 AND auth_user_id = $2', [orderId, req.user.id])).rows[0];
  if (!order) throw notFound('order_not_found', 'Order not found');

  if (action === 'complete_local') {
    return res.json(await issueLocalOrderPayment({ gatewayOrderId: order.razorpay_order_id, amountPaise: order.amount_paise, outcome: req.body?.outcome }));
  }

  if (action === 'resume') {
    if (order.payment_status !== 'pending' || new Date(order.payment_expires_at) <= new Date()) {
      throw conflict('payment_window_closed', 'This payment window has closed. Please check out again.');
    }
    const o = order.razorpay_order_id ? order : await attachGatewayOrder(order, req.user);
    return res.json(paymentPayload(o, req.user));
  }

  if (action === 'cancel') {
    const changed = await db.tx((c) => expireOrder(c, order.id, 'cancelled_by_customer'));
    if (changed) await db.query("UPDATE orders SET status = 'cancelled', payment_status = 'cancelled' WHERE id = $1 AND payment_status = 'expired'", [order.id]);
    return res.json({ ok: true, order_id: order.id, released: changed });
  }

  throw badRequest('unsupported_action', 'Unsupported checkout action');
}
