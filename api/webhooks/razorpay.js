import crypto from 'crypto';
import express from 'express';
import { db } from '../../lib/db.js';
import { h, sendError } from '../../lib/http.js';
import { log } from '../../lib/log.js';
import { razorpay, verifyWebhookSignature } from '../../lib/razorpay.js';
import { finalizeBagShipment, recordBagRefund } from '../../lib/bag.js';
import { notify } from '../../lib/notify.js';
import { finalizeGiftPurchase, recordGiftRefund } from '../../lib/gifts.js';
import { applyFirstPayment, applyRecurringCharge, markHalted, markMandateCancelled, markRetrying, recordFailedAttempt, syncMandateStatus } from '../../lib/billing.js';
import { finalizeMembershipPayment, finalizeOrderPayment } from '../../lib/payments.js';
import { releaseReservations, releaseRewards, reverseCredits } from '../../lib/inventory.js';
import { syncPaidThrough, voidFuturePeriods } from '../../lib/membership.js';
import { audit } from '../../lib/audit.js';
import { rateLimit } from '../../lib/rate-limit.js';

const router = express.Router();

async function handlePaymentSuccess(payment, source, type = 'payment.captured') {
  const rzpOrderId = payment?.order_id;
  if (!rzpOrderId) return 'ignored';
  const order = (await db.query('SELECT id FROM orders WHERE razorpay_order_id = $1', [rzpOrderId])).rows[0];
  if (order) {
    const amountPaise = payment.currency && payment.currency !== 'INR' ? -1 : payment.amount;
    // A signed webhook body is Razorpay's own statement of amount, currency and capture.
    const r = await finalizeOrderPayment({ orderId: order.id, paymentId: payment.id, amountPaise, source, gatewayChecked: payment.status === 'captured' || type === 'order.paid' });
    return r.status;
  }
  const mp = (await db.query('SELECT id FROM membership_payments WHERE razorpay_order_id = $1', [rzpOrderId])).rows[0];
  if (mp) {
    const amountPaise = payment.currency && payment.currency !== 'INR' ? -1 : payment.amount;
    const r = await finalizeMembershipPayment({ membershipPaymentId: mp.id, paymentId: payment.id, amountPaise, source });
    return r.status;
  }
  const bag = (await db.query('SELECT id FROM bag_shipments WHERE razorpay_order_id = $1', [rzpOrderId])).rows[0];
  if (bag) {
    const amountPaise = payment.currency && payment.currency !== 'INR' ? -1 : Number(payment.amount);
    return (await finalizeBagShipment({ shipmentId: bag.id, paymentId: payment.id, amountPaise, source })).status;
  }
  const gift = (await db.query('SELECT id FROM admin_gift_enquiries WHERE razorpay_order_id = $1', [rzpOrderId])).rows[0];
  if (gift) {
    const amountPaise = payment.currency && payment.currency !== 'INR' ? -1 : Number(payment.amount);
    return (await finalizeGiftPurchase({ enquiryId: gift.id, paymentId: payment.id, amountPaise, source })).status;
  }
  return 'ignored';
}

async function handlePaymentFailed(payment) {
  const reason = String(payment?.error_description || payment?.error_code || 'payment_failed').slice(0, 300);
  // The order stays pending so the customer can retry within the hold window.
  await db.query("UPDATE orders SET payment_failure_reason = $2, updated_at = now() WHERE razorpay_order_id = $1 AND payment_status = 'pending'", [payment?.order_id, reason]);
  await db.query("UPDATE membership_payments SET failure_reason = $2 WHERE razorpay_order_id = $1 AND status = 'pending'", [payment?.order_id, reason]);
  return 'processed';
}

async function handleSubscriptionCharged(subscription, payment) {
  if (!subscription?.id || !payment?.id) return 'ignored';
  const m = (await db.query('SELECT * FROM memberships WHERE autopay_subscription_id = $1', [subscription.id])).rows[0];
  if (!m) return 'ignored';
  const amount = Number(payment.amount) / 100;
  const monthly = Number(m.monthly_price) || 1799;
  const months = Number.isFinite(amount) && amount > 0 ? Math.max(1, Math.round(amount / monthly)) : 1;
  const ins = await db.query(
    `INSERT INTO membership_payments (membership_id, auth_user_id, amount, status, provider_payment_id, provider_subscription_id, months, list_amount, kind)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $3, 'renewal')
     ON CONFLICT (provider_payment_id) WHERE provider_payment_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [m.id, m.auth_user_id, Number.isFinite(amount) ? amount : 0, payment.id, subscription.id, months]
  );
  const id = ins.rows[0]?.id
    || (await db.query("SELECT id FROM membership_payments WHERE provider_payment_id = $1 AND status <> 'paid'", [payment.id])).rows[0]?.id;
  if (!id) return 'already_paid';
  const amountPaise = payment.currency && payment.currency !== 'INR' ? -1 : Number(payment.amount);
  const r = await finalizeMembershipPayment({ membershipPaymentId: id, paymentId: payment.id, amountPaise, source: 'webhook' });
  return r.status;
}

/** Subscription payments carry an invoice, not one of our orders; the invoice names the subscription. */
async function subscriptionIdForPayment(payment) {
  if (!payment?.invoice_id) return null;
  const known = (await db.query('SELECT provider_subscription_id FROM membership_payments WHERE razorpay_invoice_id = $1 OR provider_payment_id = $2 LIMIT 1', [payment.invoice_id, payment.id])).rows[0];
  if (known?.provider_subscription_id) return known.provider_subscription_id;
  try {
    return (await razorpay.fetchInvoice(payment.invoice_id))?.subscription_id || null;
  } catch (err) {
    log.warn('webhook.invoice_lookup_failed', { invoice_id: payment.invoice_id, message: err.message });
    return null;
  }
}

/**
 * A captured payment for a mandate. Applies the authorisation (upfront) payment if the browser never
 * confirmed it, or a monthly debit whose `subscription.charged` event is late; both are idempotent.
 */
async function handleSubscriptionPayment(payment, eventId) {
  const subscriptionId = await subscriptionIdForPayment(payment);
  if (!subscriptionId) return 'ignored';
  return applyRecurringCharge({ subscription: { id: subscriptionId, status: 'authenticated' }, payment, eventId });
}

const UNSHIPPED = new Set(['pending_payment', 'processing', 'packed', 'refund_required', 'cancelled', 'expired']);

/** Full refunds of unshipped orders return stock and credits. Shipped orders keep their fulfilment status. Partial refunds are recorded, not applied as a full reversal. */
async function handleRefundProcessed(refund) {
  const paymentId = refund?.payment_id;
  if (!paymentId) return 'ignored';
  return db.tx(async (c) => {
    const o = (await c.query('SELECT * FROM orders WHERE razorpay_payment_id = $1 FOR UPDATE', [paymentId])).rows[0];
    if (!o) return (await recordBagRefund(c, refund)) || (await recordGiftRefund(c, refund)) || handleMembershipRefund(c, paymentId, refund);
    if (o.payment_status === 'refunded') return 'already_paid';
    const amount = Number(refund.amount);
    const full = !Number.isFinite(amount) || amount >= Number(o.amount_paise);
    if (!full) {
      await c.query(
        'UPDATE orders SET razorpay_refund_id = COALESCE(razorpay_refund_id, $2), updated_at = now() WHERE id = $1',
        [o.id, refund.id || null]
      );
      log.warn('payment.partial_refund_recorded', { order_id: o.id, amount_paise: amount, expected: o.amount_paise });
      return 'partial';
    }
    if (UNSHIPPED.has(o.status)) {
      const held = await c.query("UPDATE inventory_reservations SET status = 'held' WHERE order_id = $1 AND status = 'committed' RETURNING 1", [o.id]);
      if (held.rowCount) await releaseReservations(c, o.id);
      await reverseCredits(c, o);
      await releaseRewards(c, o.id);
    }
    await c.query(
      `UPDATE orders SET payment_status = 'refunded',
              status = CASE WHEN status IN ('pending_payment','processing','packed','refund_required','expired') THEN 'refunded' ELSE status END,
              razorpay_refund_id = COALESCE(razorpay_refund_id, $2),
              refunded_at = COALESCE(refunded_at, now()), updated_at = now()
        WHERE id = $1`,
      [o.id, refund.id || null]
    );
    return { status: 'processed', order: o, amount: amount / 100 };
  }).then(async (r) => {
    if (r?.notice) {
      const n = r.notice;
      await notify(db, { authUserId: n.authUserId, event: 'refund_processed', data: { amount: n.amount, what: n.what }, dedupeKey: `refund:${n.refundId}` });
      return r.status;
    }
    if (r?.status !== 'processed' || !r.order) return typeof r === 'string' ? r : r?.status || 'processed';
    await notify(db, { authUserId: r.order.auth_user_id, event: 'refund_processed', data: { amount: Number.isFinite(r.amount) ? r.amount : Number(r.order.total), ref: String(r.order.id).slice(0, 8).toUpperCase() }, dedupeKey: `refund:${r.order.id}` });
    return 'processed';
  });
}

/**
 * A refunded membership payment no longer pays for its months that have not started: those are
 * voided and paid-through is recalculated. Rewards that came from it are flagged for the owner,
 * not revoked — the reversal policy is an owner decision.
 */
async function handleMembershipRefund(c, paymentId, refund) {
  const mp = (await c.query("SELECT * FROM membership_payments WHERE provider_payment_id = $1 AND status = 'paid' FOR UPDATE", [paymentId])).rows[0];
  if (!mp) return 'ignored';
  const amount = Number(refund?.amount);
  const full = !Number.isFinite(amount) || amount >= Math.round(Number(mp.amount) * 100);
  if (!full) {
    await audit(c, { actor: 'razorpay_webhook', action: 'membership_partial_refund', entityType: 'membership_payment', entityId: mp.id, details: { amount_paise: amount } });
    return 'partial';
  }
  await c.query("UPDATE membership_payments SET status = 'refunded', refunded_at = now() WHERE id = $1", [mp.id]);
  const voided = await voidFuturePeriods(c, { membershipId: mp.membership_id, membershipPaymentId: mp.id, reason: 'payment_refunded' });
  await syncPaidThrough(c, mp.membership_id);
  const rewards = await reverseRewardsForRefund(c, mp.id);
  await c.query("UPDATE referrals SET status = 'refunded', updated_at = now() WHERE qualifying_payment_id = $1 AND status = 'qualified'", [mp.id]);
  await audit(c, { actor: 'razorpay_webhook', action: 'membership_refunded', entityType: 'membership_payment', entityId: mp.id, details: { months_voided: voided, ...rewards } });
  return 'processed';
}

/**
 * BD-5: rewards earned by a refunded membership payment (its six-month reward, or the referrer's
 * reward for a referred payment). Unused rewards — available, or held by an unpaid checkout — are
 * revoked; rewards already used on a paid order are flagged for admin review. Nothing else changes:
 * no money is deducted and no balance goes negative.
 */
async function reverseRewardsForRefund(c, membershipPaymentId) {
  const linked = `(source_payment_id = $1 OR referral_id IN (SELECT id FROM referrals WHERE qualifying_payment_id = $1))`;
  const revoked = (await c.query(
    `UPDATE reward_entitlements SET status = 'void', void_reason = 'source_payment_refunded', voided_at = now(), voided_by = 'razorpay_webhook', updated_at = now()
      WHERE ${linked} AND status IN ('available', 'reserved') RETURNING id, auth_user_id, kind, order_id`,
    [membershipPaymentId]
  )).rows;
  if (revoked.length) await c.query('UPDATE cart_items SET reward_entitlement_id = NULL, updated_at = now() WHERE reward_entitlement_id = ANY($1::uuid[])', [revoked.map((r) => r.id)]);
  const flagged = (await c.query(
    `UPDATE reward_entitlements SET flag_reason = 'source_payment_refunded', flagged_at = now(), updated_at = now()
      WHERE ${linked} AND status = 'redeemed' AND flagged_at IS NULL RETURNING id, auth_user_id, kind, order_id`,
    [membershipPaymentId]
  )).rows;
  for (const r of revoked) {
    await audit(c, { actor: 'razorpay_webhook', action: 'reward_revoked', entityType: 'reward_entitlement', entityId: r.id, details: { reason: 'source_payment_refunded', kind: r.kind, membership_payment_id: membershipPaymentId, held_by_order: r.order_id } });
  }
  for (const r of flagged) {
    await audit(c, { actor: 'razorpay_webhook', action: 'reward_flagged', entityType: 'reward_entitlement', entityId: r.id, details: { reason: 'source_payment_refunded', kind: r.kind, membership_payment_id: membershipPaymentId, order_id: r.order_id } });
  }
  return { rewards_revoked: revoked.length, rewards_flagged: flagged.length };
}

function eventSummary(event, type) {
  const payment = event?.payload?.payment?.entity;
  const order = event?.payload?.order?.entity;
  const refund = event?.payload?.refund?.entity;
  const sub = event?.payload?.subscription?.entity;
  return {
    event: type,
    payment_id: payment?.id || refund?.payment_id || null,
    order_id: payment?.order_id || order?.id || null,
    amount: payment?.amount ?? refund?.amount ?? order?.amount ?? null,
    currency: payment?.currency || refund?.currency || order?.currency || null,
    status: payment?.status || refund?.status || sub?.status || null,
    refund_id: refund?.id || null,
    subscription_id: sub?.id || null,
  };
}

router.post(
  '/razorpay',
  rateLimit({ name: 'webhook', windowMs: 60_000, max: 600 }),
  express.raw({ type: '*/*', limit: '1mb' }),
  h(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(raw, signature)) {
      log.warn('webhook.invalid_signature', { ip: req.ip });
      return sendError(res, 400, 'invalid_signature', 'Webhook signature verification failed');
    }

    let event;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendError(res, 400, 'invalid_json', 'Malformed webhook body');
    }
    const eventId = String(req.headers['x-razorpay-event-id'] || crypto.createHash('sha256').update(raw).digest('hex'));
    const type = String(event.event || 'unknown');
    const payment = event.payload?.payment?.entity;
    const entityId = payment?.id || event.payload?.subscription?.entity?.id || event.payload?.refund?.entity?.id || null;

    const ins = await db.query(
      `INSERT INTO payment_events (provider, event_id, event_type, entity_id, payload) VALUES ('razorpay', $1, $2, $3, $4)
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [eventId, type, entityId, JSON.stringify(eventSummary(event, type))]
    );
    if (!ins.rows[0]) {
      const prev = (await db.query("SELECT status FROM payment_events WHERE provider = 'razorpay' AND event_id = $1", [eventId])).rows[0];
      if (prev && ['processed', 'ignored'].includes(prev.status)) {
        return res.json({ ok: true, duplicate: true });
      }
      // A previous delivery failed mid-way; handlers are idempotent, so process again.
    }

    try {
      let outcome = 'ignored';
      const sub = event.payload?.subscription?.entity;
      if (type === 'payment.captured' || type === 'order.paid') {
        outcome = await handlePaymentSuccess(payment, 'webhook', type);
        if (outcome === 'ignored' && type === 'payment.captured') outcome = await handleSubscriptionPayment(payment, eventId);
      } else if (type === 'payment.authorized') outcome = 'ignored';
      else if (type === 'payment.failed') {
        outcome = await handlePaymentFailed(payment);
        const subscriptionId = await subscriptionIdForPayment(payment);
        if (subscriptionId) outcome = await recordFailedAttempt({ subscriptionId, payment, eventId });
      } else if (type === 'subscription.charged') {
        outcome = await applyRecurringCharge({ subscription: sub, payment, eventId });
        if (outcome === 'ignored') outcome = await handleSubscriptionCharged(sub, payment);
      } else if (type === 'subscription.authenticated') {
        outcome = await syncMandateStatus({ subscription: sub, event: type });
        if (payment?.id) outcome = (await applyFirstPayment({ subscriptionId: sub?.id, paymentId: payment.id, amountPaise: Number(payment.amount), source: 'webhook', mandateStatus: 'authenticated', invoiceId: payment.invoice_id || null, chargeAt: sub?.charge_at })).status;
      } else if (['subscription.activated', 'subscription.paused', 'subscription.resumed', 'subscription.completed'].includes(type)) {
        outcome = await syncMandateStatus({ subscription: sub, event: type });
      } else if (type === 'subscription.pending') outcome = await markRetrying({ subscription: sub, payment, eventId });
      else if (type === 'subscription.halted') outcome = await markHalted({ subscription: sub, eventId });
      else if (type === 'subscription.cancelled') outcome = await markMandateCancelled({ subscription: sub });
      else if (type === 'refund.processed') outcome = await handleRefundProcessed(event.payload?.refund?.entity);
      const finalStatus = outcome === 'ignored' ? 'ignored' : 'processed';
      await db.query("UPDATE payment_events SET status = $3, processed_at = now(), error = NULL WHERE provider = 'razorpay' AND event_id = $1 AND event_type = $2", [eventId, type, finalStatus]);
      await audit(db, { actor: 'razorpay_webhook', action: `webhook_${type}`, entityType: 'payment_event', entityId: eventId, details: { outcome } });
      res.json({ ok: true, outcome });
    } catch (err) {
      await db.query("UPDATE payment_events SET status = 'failed', error = $2 WHERE provider = 'razorpay' AND event_id = $1", [eventId, String(err.message).slice(0, 500)]);
      log.error('webhook.processing_failed', { event_id: eventId, type, message: err.message });
      // Non-2xx makes Razorpay retry; processing is idempotent.
      sendError(res, 500, 'webhook_processing_failed', 'Webhook processing failed');
    }
  })
);

export default router;
