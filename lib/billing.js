/**
 * Walkin Wardrobe billing engine (MEM-01, MEM-07, MEM-08, MEM-09).
 *
 * Sign-up is one Razorpay checkout that authorises a UPI Autopay mandate (a Subscription on the
 * monthly plan, first debit `membership_upfront_months` from now) and charges the upfront months as
 * an add-on with the authorisation. Each later debit (`subscription.charged`) buys one month.
 *
 * Three states are kept apart on `memberships`:
 * - `status`          membership: pending_payment · active · paused · expired · cancelled
 * - `billing_status`  mandate/billing: pending_authorisation · active · retrying · halted · cancelled · completed · prepaid
 * - credits           frozen while billing is `retrying` or `halted` (see `creditsUsable`)
 *
 * Credits are only ever issued by `finalizeMembershipPayment` after the server has confirmed the
 * payment with the gateway (verify endpoint) or received a signed webhook. Every gateway attempt and
 * lifecycle change is recorded in `membership_payment_attempts` / `membership_events`.
 */
import { db } from './db.js';
import { audit } from './audit.js';
import { config } from './config.js';
import { log } from './log.js';
import { AppError, badRequest, conflict, notFound } from './http.js';
import { hmacHex, razorpay, verifySubscriptionSignature } from './razorpay.js';
import { getSettings } from './settings.js';
import { calculateMembershipPrice } from './pricing.js';
import { referralDiscountFor } from './referrals.js';
import { finalizeMembershipPayment } from './payments.js';
import { refreshMembership, resetConsecutiveMonths, syncPaidThrough, voidFuturePeriods } from './membership.js';
import { notify } from './notify.js';
import { text } from './validate.js';

const RUNNING = ['active', 'paused'];
const LIVE_SUBSCRIPTION = ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'];
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const membershipLink = () => `${config.publicSiteUrl}/membership`;

/** Whether wardrobe credits may be spent now (MEM-04/07: frozen during a payment retry). */
export function creditsUsable(m) {
  return Boolean(m) && m.status === 'active' && !['retrying', 'halted'].includes(m.billing_status);
}

export function creditsBlockedMessage(m) {
  if (m && ['retrying', 'halted'].includes(m.billing_status)) {
    return 'Your credits are frozen while your membership payment is being retried. They unlock as soon as the payment succeeds.';
  }
  return 'Wardrobe credits can be used while your membership is active. Resume or renew your membership, or remove the credit.';
}

export async function recordMembershipEvent(c, m, event, { actor, reason = null, details = {} } = {}) {
  await c.query(
    'INSERT INTO membership_events (membership_id, auth_user_id, event, actor, reason, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [m.id, m.auth_user_id, event, actor, reason, JSON.stringify(details)]
  );
}

async function recordAttempt(c, m, { subscriptionId, paymentId = null, invoiceId = null, amount = null, outcome, attemptNo = null, reason = null, eventId = null }) {
  await c.query(
    `INSERT INTO membership_payment_attempts (membership_id, auth_user_id, razorpay_subscription_id, provider_payment_id, razorpay_invoice_id, amount, outcome, attempt_no, failure_reason, event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`,
    [m.id, m.auth_user_id, subscriptionId, paymentId, invoiceId, amount, outcome, attemptNo, reason ? String(reason).slice(0, 300) : null, eventId]
  );
}

/** The gateway plan for a monthly amount: the configured one if its amount matches, else created once. */
export async function ensurePlan(amountPaise) {
  const found = (await db.query('SELECT razorpay_plan_id FROM billing_plans WHERE amount_paise = $1', [amountPaise])).rows[0];
  if (found) return found.razorpay_plan_id;
  let planId = null;
  if (config.razorpay.membershipPlanId) {
    const p = await razorpay.fetchPlan(config.razorpay.membershipPlanId).catch(() => null);
    if (p && Number(p.item?.amount) === amountPaise && p.period === 'monthly' && Number(p.interval) === 1) planId = p.id;
    else log.warn('billing.configured_plan_mismatch', { plan_id: config.razorpay.membershipPlanId, expected_paise: amountPaise });
  }
  if (!planId) {
    const p = await razorpay.createPlan({ amountPaise, name: 'Walkin Wardrobe membership', description: `Walkin Wardrobe · ₹${amountPaise / 100} a month` });
    if (Number(p?.item?.amount) !== amountPaise) throw new AppError(502, 'payment_gateway_error', 'Gateway plan amount mismatch');
    planId = p.id;
  }
  await db.query('INSERT INTO billing_plans (amount_paise, razorpay_plan_id) VALUES ($1, $2) ON CONFLICT (amount_paise) DO NOTHING', [amountPaise, planId]);
  return (await db.query('SELECT razorpay_plan_id FROM billing_plans WHERE amount_paise = $1', [amountPaise])).rows[0].razorpay_plan_id;
}

function checkoutPayload(row, user, { months, listTotal, discount }) {
  return {
    membership_id: row.membership_id,
    purpose: row.purpose,
    months,
    amount: Number(row.upfront_amount),
    list_total: listTotal,
    discount,
    discount_reason: discount ? 'referral' : null,
    monthly_amount: Number(row.monthly_amount),
    first_debit_at: row.start_at,
    razorpay: {
      key_id: razorpay.keyId,
      subscription_id: row.razorpay_subscription_id,
      ...(config.razorpay.localCheckout ? { checkout_mode: 'local' } : {}),
      recurring: true,
      name: 'Vishrea Studio',
      description: row.purpose === 'recovery' ? 'Walkin Wardrobe · restart autopay' : `Walkin Wardrobe · first ${months} months, then ₹${Number(row.monthly_amount)}/month`,
      prefill: { email: user.email, name: user.name },
    },
  };
}

/**
 * Create (or reuse) a mandate request. `purpose` = 'signup' charges `months` upfront and starts the
 * monthly debits after them; 'recovery' (after every retry failed) starts debiting immediately.
 */
async function createMandate(user, { purpose, months, settings }) {
  if (!razorpay.configured) throw new AppError(503, 'payments_unavailable', 'Online payment is not available right now. Please try again later.');
  const monthlyPaise = Math.round(Number(settings.membership_price) * 100);

  const prep = await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('membership:' || $1))", [user.id]);
    await refreshMembership(c, user.id, settings);
    let m = (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [user.id])).rows[0];
    const running = m && RUNNING.includes(m.status) && m.paid_through && new Date(m.paid_through) > new Date();
    if (purpose === 'signup') {
      if (m && m.billing_status === 'halted') throw conflict('payment_recovery_required', 'Your membership is paused after a failed payment. Restart it with a new autopay mandate.');
      if (m && ['active', 'retrying'].includes(m.billing_status) && RUNNING.includes(m.status)) throw conflict('membership_already_active', 'Your membership is already active with UPI Autopay.');
      if (running) throw conflict('membership_already_active', `Your membership is active until ${fmt(m.paid_through)}. You can set up autopay once it ends.`);
    } else if (!m || m.billing_status !== 'halted' || m.status === 'cancelled') {
      throw conflict('recovery_not_needed', 'There is no paused membership payment to recover.');
    }

    const ref = purpose === 'signup' ? await referralDiscountFor(c, user.id, months, settings) : { amount: 0, referralId: null };
    const price = purpose === 'signup' ? calculateMembershipPrice(settings, { months, discount: ref.amount }) : calculateMembershipPrice(settings, { months: 1 });
    if (!m) {
      m = (await c.query(
        "INSERT INTO memberships (auth_user_id, status, billing_status, monthly_price, credits_per_month, credits_balance, upfront_months) VALUES ($1,'pending_payment','pending_authorisation',$2,$3,0,$4) RETURNING *",
        [user.id, settings.membership_price, settings.credits_per_month, months]
      )).rows[0];
    } else if (purpose === 'signup') {
      await c.query("UPDATE memberships SET status = 'pending_payment', billing_status = 'pending_authorisation', monthly_price = $2, updated_at = now() WHERE id = $1", [m.id, settings.membership_price]);
    }
    // Refresh / double click: reuse the unauthorised request for the same amounts.
    const prior = (await c.query(
      `SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND status = 'created' AND purpose = $2
         AND upfront_amount = $3 AND monthly_amount = $4 AND created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1`,
      [m.id, purpose, price.total, settings.membership_price]
    )).rows[0];
    if (!prior) {
      // An abandoned request for other amounts is retired so only one mandate request is ever live.
      await c.query("UPDATE membership_subscriptions SET status = 'expired', ended_at = now(), updated_at = now() WHERE membership_id = $1 AND status = 'created'", [m.id]);
    }
    const paidBefore = (await c.query("SELECT 1 FROM membership_payments WHERE membership_id = $1 AND status IN ('paid','refunded') LIMIT 1", [m.id])).rows[0];
    const startAt = purpose === 'signup' ? (await c.query('SELECT now() + make_interval(months => $1) AS t', [months])).rows[0].t : null;
    return { m, ref, price, prior, startAt, kind: paidBefore ? 'renewal' : 'purchase' };
  });

  const { m, ref, price, startAt } = prep;
  const shape = { months: purpose === 'signup' ? months : 1, listTotal: price.list_total, discount: price.discount };
  if (prep.prior) return checkoutPayload(prep.prior, user, shape);

  const planId = await ensurePlan(monthlyPaise);
  const sub = await razorpay.createSubscription({
    planId,
    totalCount: Number(settings.subscription_total_count) || 120,
    startAt,
    upfrontPaise: purpose === 'signup' ? price.amount_paise : 0,
    upfrontLabel: `Walkin Wardrobe · first ${months} months`,
    notes: { membership_id: m.id, customer: user.id, purpose },
  });
  if (!sub?.id || !['created', 'authenticated'].includes(sub.status)) throw new AppError(502, 'payment_gateway_error', 'The payment gateway could not set up autopay. Please try again.');

  const row = await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('membership:' || $1))", [user.id]);
    const raced = (await c.query("SELECT * FROM membership_subscriptions WHERE membership_id = $1 AND status = 'created' AND purpose = $2", [m.id, purpose])).rows[0];
    if (raced) return { raced };
    const r = (await c.query(
      `INSERT INTO membership_subscriptions (membership_id, auth_user_id, purpose, razorpay_subscription_id, razorpay_plan_id, monthly_amount, upfront_amount, upfront_months,
                                             list_amount, discount_amount, referral_id, start_at, short_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [m.id, user.id, purpose, sub.id, planId, settings.membership_price, price.total, shape.months, price.list_total, price.discount, ref.referralId, startAt, sub.short_url || null]
    )).rows[0];
    await c.query(
      `INSERT INTO membership_payments (membership_id, auth_user_id, amount, status, provider_subscription_id, subscription_ref, attempt_no, months, list_amount, discount_amount, referral_id, kind, charge_kind)
       VALUES ($1,$2,$3,'pending',$4,$5,1,$6,$7,$8,$9,$10,'upfront')`,
      [m.id, user.id, price.total, sub.id, r.id, shape.months, price.list_total, price.discount, ref.referralId, purpose === 'recovery' ? 'renewal' : prep.kind]
    );
    await recordMembershipEvent(c, m, purpose === 'signup' ? 'mandate_requested' : 'recovery_requested', { actor: user.id, details: { subscription_id: sub.id, upfront: price.total } });
    await audit(c, { actor: user.id, action: 'membership_checkout_started', entityType: 'membership', entityId: m.id, details: { purpose, amount: price.total, months: shape.months, discount: price.discount, subscription_id: sub.id } });
    return { row: r };
  });
  if (row.raced) {
    razorpay.cancelSubscription(sub.id).catch((err) => log.warn('billing.raced_subscription_cancel_failed', { message: err.message }));
    return checkoutPayload(row.raced, user, shape);
  }
  return checkoutPayload(row.row, user, shape);
}

export async function startSignup(user, { months }) {
  const settings = await getSettings();
  return createMandate(user, { purpose: 'signup', months, settings });
}

export async function startRecovery(user) {
  const settings = await getSettings();
  return createMandate(user, { purpose: 'recovery', months: 1, settings });
}

/**
 * Finish a checkout that was created on the local stand-in. The hosted Razorpay widget cannot
 * pay those subscription ids. Refuses to run when the API base is the real Razorpay host.
 * A non-captured status is recorded as a failure and does not activate the membership.
 */
export async function completeLocalCheckout(user, b) {
  if (!config.razorpay.localCheckout) throw notFound('not_found', 'Not found');
  const subscriptionId = text(b.razorpay_subscription_id, { max: 64, field: 'razorpay_subscription_id', required: true });
  const outcome = b.outcome === 'failed' ? 'failed' : 'captured';
  const row = (await db.query('SELECT * FROM membership_subscriptions WHERE razorpay_subscription_id = $1 AND auth_user_id = $2', [subscriptionId, user.id])).rows[0];
  if (!row) throw notFound('membership_payment_not_found', 'No membership payment found for this checkout');
  if (row.status !== 'created') throw conflict('checkout_not_open', 'This checkout is no longer waiting for payment. Start again if you still want to join.');
  const amountPaise = Math.round(Number(row.upfront_amount) * 100);
  const payment = await razorpay.simulateLocalCheckout({ subscriptionId, amountPaise, status: outcome });
  if (outcome !== 'captured') {
    throw badRequest('payment_not_captured', 'The payment did not complete. Nothing was activated. You can try again.');
  }
  const signature = hmacHex(config.razorpay.keySecret, `${payment.id}|${subscriptionId}`);
  return verifyCheckout(user, { razorpay_subscription_id: subscriptionId, razorpay_payment_id: payment.id, razorpay_signature: signature });
}

/**
 * Checkout handler result. The signature proves the response came from Razorpay; the payment and
 * mandate are then confirmed with the gateway before anything is issued. If the gateway cannot be
 * reached the membership stays pending and the signed webhook completes it.
 */
export async function verifyCheckout(user, b) {
  const subscriptionId = text(b.razorpay_subscription_id, { max: 64, field: 'razorpay_subscription_id', required: true });
  const paymentId = text(b.razorpay_payment_id, { max: 64, field: 'razorpay_payment_id', required: true });
  const signature = text(b.razorpay_signature, { max: 128, field: 'razorpay_signature', required: true });
  const row = (await db.query('SELECT * FROM membership_subscriptions WHERE razorpay_subscription_id = $1 AND auth_user_id = $2', [subscriptionId, user.id])).rows[0];
  if (!row) throw notFound('membership_payment_not_found', 'No membership payment found for this checkout');
  if (!verifySubscriptionSignature({ razorpaySubscriptionId: subscriptionId, razorpayPaymentId: paymentId, signature })) {
    await audit(db, { actor: user.id, action: 'membership_signature_invalid', entityType: 'membership', entityId: row.membership_id });
    throw badRequest('invalid_payment_signature', 'Payment could not be verified');
  }
  const expected = Math.round(Number(row.upfront_amount) * 100);
  let payment;
  let sub;
  let invoice;
  try {
    [payment, sub] = await Promise.all([razorpay.fetchPayment(paymentId), razorpay.fetchSubscription(subscriptionId)]);
    // Razorpay links a mandate payment to its subscription through the payment's invoice.
    invoice = payment?.invoice_id ? await razorpay.fetchInvoice(payment.invoice_id) : null;
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus >= 400 && err.upstreamStatus < 500) {
      throw badRequest('payment_not_verified', 'Payment could not be confirmed with the gateway. If money was deducted it will be refunded.');
    }
    log.warn('billing.verify_gateway_unavailable', { subscription_id: subscriptionId, message: err.message });
    return { status: 'pending_confirmation' };
  }
  if (!invoice || invoice.subscription_id !== subscriptionId || (invoice.payment_id && invoice.payment_id !== paymentId)) {
    await audit(db, { actor: user.id, action: 'membership_payment_mismatch', entityType: 'membership', entityId: row.membership_id, details: { payment_id: paymentId, invoice_id: payment?.invoice_id || null } });
    log.warn('billing.payment_subscription_mismatch', { subscription_id: subscriptionId, payment_id: paymentId });
    throw badRequest('payment_subscription_mismatch', 'This payment does not belong to this membership checkout.');
  }
  if ((payment.currency && payment.currency !== 'INR') || Number(payment.amount) !== expected) throw badRequest('amount_mismatch', 'Payment amount does not match the membership price');
  if (payment.status === 'authorized') await razorpay.capturePayment(paymentId, expected);
  else if (payment.status !== 'captured') throw badRequest('payment_not_captured', `Payment status is ${payment.status}`);
  if (!['authenticated', 'active'].includes(sub?.status)) throw badRequest('mandate_not_authorised', 'The UPI Autopay mandate was not authorised. Please try again.');
  return applyFirstPayment({ subscriptionId, paymentId, amountPaise: expected, source: 'verify', mandateStatus: sub.status, invoiceId: invoice.id || payment.invoice_id, chargeAt: sub.charge_at });
}

/** Apply the payment taken when a mandate was authorised (upfront months, or the first recovery month). */
export async function applyFirstPayment({ subscriptionId, paymentId, amountPaise, source, mandateStatus = 'authenticated', invoiceId = null, chargeAt = null }) {
  const row = (await db.query('SELECT * FROM membership_subscriptions WHERE razorpay_subscription_id = $1', [subscriptionId])).rows[0];
  if (!row) return { status: 'ignored' };
  const mp = (await db.query("SELECT * FROM membership_payments WHERE subscription_ref = $1 AND charge_kind = 'upfront'", [row.id])).rows[0];
  if (!mp) return { status: 'ignored' };
  if (mp.status === 'paid') return { status: mp.provider_payment_id === paymentId ? 'already_paid' : 'duplicate_payment' };
  if (!mp.provider_payment_id) {
    await db.query('UPDATE membership_payments SET provider_payment_id = $2, razorpay_invoice_id = COALESCE(razorpay_invoice_id, $3) WHERE id = $1 AND provider_payment_id IS NULL', [mp.id, paymentId, invoiceId])
      .catch((err) => { if (err.code !== '23505') throw err; });
  }
  const r = await finalizeMembershipPayment({ membershipPaymentId: mp.id, paymentId, amountPaise, source });
  if (r.status === 'amount_mismatch') return r;

  const settings = await getSettings();
  const superseded = await db.tx(async (c) => {
    const m = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [row.membership_id])).rows[0];
    const old = (await c.query(
      `UPDATE membership_subscriptions SET status = 'superseded', cancel_initiated_by = 'system_superseded', ended_at = now(), updated_at = now()
        WHERE membership_id = $1 AND id <> $2 AND status = ANY($3::text[]) RETURNING razorpay_subscription_id`,
      [row.membership_id, row.id, LIVE_SUBSCRIPTION]
    )).rows.map((x) => x.razorpay_subscription_id).filter(Boolean);
    await c.query(
      `UPDATE membership_subscriptions SET status = CASE WHEN status = 'created' THEN $2 ELSE status END,
              authenticated_at = COALESCE(authenticated_at, now()), updated_at = now() WHERE id = $1`,
      [row.id, mandateStatus === 'active' ? 'active' : 'authenticated']
    );
    const nextCharge = chargeAt ? new Date(Number(chargeAt) * 1000) : row.purpose === 'signup' ? row.start_at : null;
    await c.query(
      `UPDATE memberships SET billing_status = 'active', mandate_status = $2, autopay_subscription_id = $3,
              next_charge_at = COALESCE($4::timestamptz, paid_through), status = 'active',
              lock_in_until = CASE WHEN $5 = 'signup' THEN now() + make_interval(months => $6::int) ELSE lock_in_until END,
              failed_retry_count = 0, retry_started_at = NULL, pause_reason = NULL, pause_starts_at = NULL, pause_ends_at = NULL,
              cancelled_at = NULL, cancel_reason = NULL, updated_at = now()
        WHERE id = $1`,
      [m.id, mandateStatus, subscriptionId, nextCharge, row.purpose, Number(settings.membership_lock_in_months) || 0]
    );
    if (r.status === 'paid') {
      await recordMembershipEvent(c, m, row.purpose === 'signup' ? 'activated' : 'recovered', { actor: source === 'webhook' ? 'razorpay_webhook' : m.auth_user_id, details: { payment_id: paymentId, subscription_id: subscriptionId } });
      await recordAttempt(c, m, { subscriptionId, paymentId, invoiceId, amount: Number(mp.amount), outcome: 'succeeded', attemptNo: 1, eventId: `first:${paymentId}` });
    }
    return old;
  });
  for (const id of superseded) {
    stopSupersededMandate(id).catch((err) => log.warn('billing.superseded_cancel_failed', { subscription_id: id, message: err.message }));
  }
  if (r.status === 'paid') {
    const m = (await db.query('SELECT * FROM memberships WHERE id = $1', [row.membership_id])).rows[0];
    await notify(db, {
      authUserId: m.auth_user_id,
      event: row.purpose === 'signup' ? 'membership_activated' : 'membership_resumed',
      data: { credits: m.credits_balance, monthly: Number(row.monthly_amount), next_charge: fmt(m.next_charge_at) },
      dedupeKey: `first_payment:${paymentId}`,
    });
  }
  return { status: r.status === 'already_paid' ? 'already_paid' : 'paid' };
}

/** Cancel a replaced mandate at the gateway; `cancelled_at` stays empty until it is confirmed stopped, so the job retries it. */
async function stopSupersededMandate(subscriptionId) {
  try {
    await razorpay.cancelSubscription(subscriptionId);
  } catch (err) {
    const sub = await razorpay.fetchSubscription(subscriptionId).catch(() => null);
    if (!['cancelled', 'completed', 'expired'].includes(sub?.status)) throw err;
  }
  await db.query("UPDATE membership_subscriptions SET cancelled_at = COALESCE(cancelled_at, now()), updated_at = now() WHERE razorpay_subscription_id = $1 AND status = 'superseded'", [subscriptionId]);
}

/** `subscription.charged`: a monthly debit succeeded (possibly on a retry). Buys one month. */
export async function applyRecurringCharge({ subscription, payment, eventId }) {
  const subscriptionId = subscription?.id;
  if (!subscriptionId || !payment?.id) return 'ignored';
  const row = (await db.query('SELECT * FROM membership_subscriptions WHERE razorpay_subscription_id = $1', [subscriptionId])).rows[0];
  if (!row) return 'ignored';
  const upfront = (await db.query("SELECT * FROM membership_payments WHERE subscription_ref = $1 AND charge_kind = 'upfront'", [row.id])).rows[0];
  // The authorisation payment of a mandate can also be reported as a charge.
  if (upfront && (upfront.provider_payment_id === payment.id || (upfront.status === 'pending' && Number(payment.amount) === Math.round(Number(upfront.amount) * 100)))) {
    return (await applyFirstPayment({ subscriptionId, paymentId: payment.id, amountPaise: Number(payment.amount), source: 'webhook', mandateStatus: subscription.status || 'active', invoiceId: payment.invoice_id || null, chargeAt: subscription.charge_at })).status;
  }
  const m = (await db.query('SELECT * FROM memberships WHERE id = $1', [row.membership_id])).rows[0];
  const amount = Number(payment.amount) / 100;
  if (payment.currency && payment.currency !== 'INR') {
    await recordAttempt(db, m, { subscriptionId, paymentId: payment.id, amount, outcome: 'failed', reason: 'currency_mismatch', eventId });
    return 'currency_mismatch';
  }
  const ins = await db.query(
    `INSERT INTO membership_payments (membership_id, auth_user_id, amount, status, provider_payment_id, provider_subscription_id, subscription_ref, razorpay_invoice_id, months, list_amount, kind, charge_kind)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,1,$8,'renewal','recurring')
     ON CONFLICT DO NOTHING RETURNING id`,
    [m.id, m.auth_user_id, amount, payment.id, subscriptionId, row.id, payment.invoice_id || null, Number(row.monthly_amount)]
  );
  const mpId = ins.rows[0]?.id || (await db.query("SELECT id FROM membership_payments WHERE provider_payment_id = $1 AND status = 'pending'", [payment.id])).rows[0]?.id;
  if (!mpId) return 'already_paid';
  const staleMandate = m.autopay_subscription_id !== subscriptionId || ['superseded', 'cancelled', 'expired'].includes(row.status);
  if (m.status === 'cancelled' || staleMandate) {
    // Money taken after a cancellation, or on a mandate that was replaced, is never turned into membership time; it needs a refund.
    const reason = m.status === 'cancelled' ? 'charged_after_cancellation' : 'charged_on_replaced_mandate';
    await db.query("UPDATE membership_payments SET status = 'refund_required', failure_reason = $2 WHERE id = $1", [mpId, reason]);
    await audit(db, { actor: 'razorpay_webhook', action: 'membership_charge_after_cancel', entityType: 'membership_payment', entityId: mpId, details: { payment_id: payment.id, amount, reason, subscription_id: subscriptionId } });
    return 'refund_required';
  }
  if (Math.round(amount * 100) !== Math.round(Number(row.monthly_amount) * 100)) log.warn('billing.unexpected_charge_amount', { subscription_id: subscriptionId, amount, expected: row.monthly_amount });
  const r = await finalizeMembershipPayment({ membershipPaymentId: mpId, paymentId: payment.id, amountPaise: Number(payment.amount), source: 'webhook' });
  if (r.status !== 'paid') return r.status;
  const after = await db.tx(async (c) => {
    const cur = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [m.id])).rows[0];
    const recovered = cur.billing_status === 'retrying';
    await c.query(
      `UPDATE memberships SET billing_status = 'active', mandate_status = 'active', failed_retry_count = 0, retry_started_at = NULL,
              next_charge_at = COALESCE($2::timestamptz, paid_through), updated_at = now() WHERE id = $1`,
      [m.id, subscription.charge_at ? new Date(Number(subscription.charge_at) * 1000) : null]
    );
    await c.query("UPDATE membership_subscriptions SET status = 'active', activated_at = COALESCE(activated_at, now()), updated_at = now() WHERE id = $1 AND status IN ('authenticated', 'pending', 'active')", [row.id]);
    await recordAttempt(c, cur, { subscriptionId, paymentId: payment.id, invoiceId: payment.invoice_id || null, amount, outcome: 'succeeded', eventId });
    await recordMembershipEvent(c, cur, recovered ? 'payment_recovered' : 'renewed', { actor: 'razorpay_webhook', details: { payment_id: payment.id, amount } });
    return (await c.query('SELECT * FROM memberships WHERE id = $1', [m.id])).rows[0];
  });
  await notify(db, { authUserId: m.auth_user_id, event: 'membership_renewed', data: { amount, credits: after.credits_balance }, dedupeKey: `renewed:${payment.id}` });
  return 'paid';
}

async function membershipForSubscription(c, subscriptionId) {
  const row = (await c.query('SELECT * FROM membership_subscriptions WHERE razorpay_subscription_id = $1', [subscriptionId])).rows[0];
  const m = row
    ? (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [row.membership_id])).rows[0]
    : (await c.query('SELECT * FROM memberships WHERE autopay_subscription_id = $1 FOR UPDATE', [subscriptionId])).rows[0];
  return { row, m };
}

/** `subscription.pending`: a debit failed and Razorpay is retrying (MEM-07). Credits are frozen. */
export async function markRetrying({ subscription, payment = null, eventId }) {
  const settings = await getSettings();
  const out = await db.tx(async (c) => {
    const { row, m } = await membershipForSubscription(c, subscription?.id);
    if (!m || m.autopay_subscription_id !== subscription.id || m.status === 'cancelled') return null;
    await c.query("UPDATE membership_subscriptions SET status = 'pending', updated_at = now() WHERE id = $1 AND status IN ('authenticated', 'active', 'pending')", [row?.id]);
    await c.query(
      `UPDATE memberships SET billing_status = 'retrying', mandate_status = 'pending', retry_started_at = COALESCE(retry_started_at, now()), updated_at = now() WHERE id = $1`,
      [m.id]
    );
    await recordAttempt(c, m, { subscriptionId: subscription.id, paymentId: payment?.id, amount: payment ? Number(payment.amount) / 100 : Number(row?.monthly_amount) || null, outcome: 'retrying', attemptNo: Number(subscription.auth_attempts) || null, reason: payment?.error_description, eventId });
    if (m.billing_status !== 'retrying') await recordMembershipEvent(c, m, 'payment_retrying', { actor: 'razorpay_webhook' });
    return m;
  });
  if (out) {
    await notify(db, {
      authUserId: out.auth_user_id,
      event: 'payment_failed',
      data: { amount: Number(out.monthly_price) || settings.membership_price, retries: settings.autopay_retry_count, days: settings.autopay_retry_days, link: membershipLink() },
      dedupeKey: `retry:${subscription.id}:${new Date(out.paid_through || Date.now()).toISOString().slice(0, 10)}`,
    });
  }
  return out ? 'processed' : 'ignored';
}

/** A single failed debit attempt (payment.failed for a subscription invoice). */
export async function recordFailedAttempt({ subscriptionId, payment, eventId }) {
  return db.tx(async (c) => {
    const { m } = await membershipForSubscription(c, subscriptionId);
    if (!m) return 'ignored';
    await c.query('UPDATE memberships SET failed_retry_count = COALESCE(failed_retry_count, 0) + 1, updated_at = now() WHERE id = $1', [m.id]);
    await recordAttempt(c, m, { subscriptionId, paymentId: payment?.id, invoiceId: payment?.invoice_id, amount: payment ? Number(payment.amount) / 100 : null, outcome: 'failed', attemptNo: (Number(m.failed_retry_count) || 0) + 1, reason: payment?.error_description || payment?.error_code, eventId });
    return 'processed';
  });
}

/** `subscription.halted`: every retry failed. The membership pauses (MEM-07) and the loyalty count resets (MEM-10). */
export async function markHalted({ subscription, eventId }) {
  const out = await db.tx(async (c) => {
    const { row, m } = await membershipForSubscription(c, subscription?.id);
    if (!m || m.autopay_subscription_id !== subscription.id || m.status === 'cancelled') return null;
    if (row) await c.query("UPDATE membership_subscriptions SET status = 'halted', halted_at = COALESCE(halted_at, now()), updated_at = now() WHERE id = $1", [row.id]);
    if (m.billing_status === 'halted') return null;
    await c.query(
      `UPDATE memberships SET billing_status = 'halted', mandate_status = 'halted', status = 'paused', pause_reason = 'payment_failed',
              pause_starts_at = now(), pause_ends_at = NULL, updated_at = now() WHERE id = $1`,
      [m.id]
    );
    await resetConsecutiveMonths(c, m.id);
    await recordAttempt(c, m, { subscriptionId: subscription.id, outcome: 'halted', reason: 'all_retries_failed', eventId });
    await recordMembershipEvent(c, m, 'paused_payment_failed', { actor: 'razorpay_webhook', reason: 'all_retries_failed' });
    await audit(c, { actor: 'razorpay_webhook', action: 'membership_paused_payment_failed', entityType: 'membership', entityId: m.id });
    return m;
  });
  if (out) await notify(db, { authUserId: out.auth_user_id, event: 'membership_paused_payment', data: { link: membershipLink() }, dedupeKey: `halted:${subscription.id}` });
  return out ? 'processed' : 'ignored';
}

/**
 * End a membership now: unused credits lapse, months not yet started are voided, billing stops.
 * Orders already paid (including credit picks waiting in the Wardrobe Bag) are untouched.
 */
export async function cancelMembershipTx(c, m, { actor, reason }) {
  if (m.credits_balance > 0) {
    await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason) VALUES ($1,$2,$3,'cancellation_forfeit')", [m.auth_user_id, m.id, -m.credits_balance]);
  }
  const voided = await voidFuturePeriods(c, { membershipId: m.id, reason: reason === 'customer' ? 'cancelled_by_customer' : reason });
  // The month in progress stays paid; voided months no longer count towards paid-through.
  await syncPaidThrough(c, m.id);
  await c.query(
    `UPDATE memberships SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, credits_balance = 0,
            billing_status = CASE WHEN billing_status IN ('none', 'prepaid') THEN billing_status ELSE 'cancelled' END,
            mandate_status = CASE WHEN autopay_subscription_id IS NULL THEN mandate_status ELSE 'cancelled' END,
            next_charge_at = NULL, pause_starts_at = NULL, pause_ends_at = NULL, updated_at = now()
      WHERE id = $1`,
    [m.id, reason]
  );
  await recordMembershipEvent(c, m, 'cancelled', { actor, reason, details: { forfeited: m.credits_balance, months_voided: voided } });
  await audit(c, { actor, action: 'membership_cancelled', entityType: 'membership', entityId: m.id, details: { reason, forfeited: m.credits_balance, months_voided: voided } });
  return { forfeited: m.credits_balance, voided };
}

/** `subscription.cancelled`. A mandate cancelled from the customer's UPI app ends the membership (MEM-09). */
export async function markMandateCancelled({ subscription }) {
  const out = await db.tx(async (c) => {
    const { row, m } = await membershipForSubscription(c, subscription?.id);
    const initiatedByUs = row && (row.status === 'superseded' || row.cancel_initiated_by);
    if (row) await c.query("UPDATE membership_subscriptions SET status = CASE WHEN status = 'superseded' THEN status ELSE 'cancelled' END, cancelled_at = COALESCE(cancelled_at, now()), cancel_initiated_by = COALESCE(cancel_initiated_by, 'customer_upi'), updated_at = now() WHERE id = $1", [row.id]);
    if (!m || initiatedByUs || m.autopay_subscription_id !== subscription.id) return null;
    if (!['active', 'paused', 'pending_payment'].includes(m.status)) return null;
    await cancelMembershipTx(c, m, { actor: 'razorpay_webhook', reason: 'mandate_cancelled' });
    return m;
  });
  if (out) await notify(db, { authUserId: out.auth_user_id, event: 'membership_cancelled', data: { reason: 'mandate_cancelled' }, dedupeKey: `mandate_cancelled:${subscription.id}` });
  return out ? 'processed' : 'ignored';
}

/** Mandate state changes that do not move money (authenticated, activated, paused, resumed, completed). */
export async function syncMandateStatus({ subscription, event }) {
  return db.tx(async (c) => {
    const { row, m } = await membershipForSubscription(c, subscription?.id);
    if (!row || !m) return 'ignored';
    const map = { 'subscription.authenticated': 'authenticated', 'subscription.activated': 'active', 'subscription.paused': 'paused', 'subscription.resumed': 'active', 'subscription.completed': 'completed' };
    const status = map[event];
    if (!status) return 'ignored';
    await c.query(
      `UPDATE membership_subscriptions SET status = CASE WHEN status IN ('superseded', 'cancelled') THEN status ELSE $2 END,
              activated_at = CASE WHEN $2 = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
              ended_at = CASE WHEN $2 = 'completed' THEN now() ELSE ended_at END, updated_at = now() WHERE id = $1`,
      [row.id, status]
    );
    if (m.autopay_subscription_id !== subscription.id) return 'processed';
    await c.query(
      `UPDATE memberships SET mandate_status = $2,
              billing_status = CASE WHEN $2 = 'completed' AND billing_status IN ('active', 'retrying') THEN 'completed' ELSE billing_status END,
              next_charge_at = COALESCE($3::timestamptz, next_charge_at), updated_at = now() WHERE id = $1`,
      [m.id, status, subscription.charge_at ? new Date(Number(subscription.charge_at) * 1000) : null]
    );
    if (status === 'completed') await recordMembershipEvent(c, m, 'mandate_completed', { actor: 'razorpay_webhook' });
    return 'processed';
  });
}

/** Months not yet started move back by `months` so a pause never consumes paid time (prepaid/gift months). */
async function shiftUnstartedMonths(c, membershipId, months) {
  await c.query(
    `UPDATE membership_periods SET starts_at = starts_at + make_interval(months => $2), ends_at = ends_at + make_interval(months => $2)
      WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL`,
    [membershipId, months]
  );
  await c.query(
    `UPDATE memberships m SET paid_through = sub.ends, renewal_at = sub.ends, updated_at = now()
       FROM (SELECT max(ends_at) AS ends FROM membership_periods WHERE membership_id = $1 AND voided_at IS NULL) sub
      WHERE m.id = $1 AND sub.ends IS NOT NULL`,
    [membershipId]
  );
}

/**
 * Customer pause (MEM-08): one `pause_length_months` pause once every `pause_frequency_months`.
 * It starts when the current paid month ends; no charge and no new credits while paused; credits
 * already issued keep their expiry; the loyalty count resets (MEM-10).
 */
export async function requestPause(user) {
  const settings = await getSettings();
  const length = Math.max(1, Number(settings.pause_length_months) || 1);
  const out = await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('membership:' || $1))", [user.id]);
    await refreshMembership(c, user.id, settings);
    const m = (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [user.id])).rows[0];
    if (!m || m.status !== 'active' || !m.paid_through || new Date(m.paid_through) <= new Date()) throw conflict('pause_unavailable', 'Only an active membership can be paused');
    if (['retrying', 'halted'].includes(m.billing_status)) throw conflict('pause_unavailable', 'Your membership payment is being retried. Pausing is available once it succeeds.');
    if (m.pause_starts_at) throw conflict('pause_already_scheduled', `A pause is already scheduled from ${fmt(m.pause_starts_at)}`);
    if (m.lock_in_until && new Date(m.lock_in_until) > new Date()) throw conflict('pause_in_lock_in', `You can pause after your first ${settings.membership_lock_in_months} months (from ${fmt(m.lock_in_until)}).`);
    if (m.pause_used_at && new Date(m.pause_used_at).getTime() > Date.now() - Number(settings.pause_frequency_months || 6) * 30.44 * 86_400_000) {
      throw conflict('pause_unavailable', `Membership can be paused once every ${settings.pause_frequency_months} months`);
    }
    // Kept so a failed gateway pause can put every change below back.
    const unstarted = (await c.query(
      'SELECT id, starts_at, ends_at, streak_month FROM membership_periods WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL',
      [m.id]
    )).rows;
    // The pause begins when the month in progress ends.
    const next = (await c.query(
      'SELECT min(starts_at) AS s FROM membership_periods WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL AND starts_at > now()',
      [m.id]
    )).rows[0].s;
    const starts = next || m.paid_through;
    if (next) await shiftUnstartedMonths(c, m.id, length);
    const ends = (await c.query('SELECT $1::timestamptz + make_interval(months => $2) AS t', [starts, length])).rows[0].t;
    await c.query(
      "UPDATE memberships SET pause_starts_at = $2, pause_ends_at = $3, pause_used_at = now(), pause_reason = 'customer', updated_at = now() WHERE id = $1",
      [m.id, starts, ends]
    );
    await resetConsecutiveMonths(c, m.id);
    await recordMembershipEvent(c, m, 'pause_scheduled', { actor: user.id, details: { starts, ends } });
    await audit(c, { actor: user.id, action: 'membership_paused', entityType: 'membership', entityId: m.id, details: { starts, ends, consecutive_months_reset_from: m.consecutive_paid_months } });
    return { m, starts, ends, unstarted };
  });
  if (out.m.autopay_subscription_id && ['active', 'retrying'].includes(out.m.billing_status)) {
    try {
      await razorpay.pauseSubscription(out.m.autopay_subscription_id);
      await db.query("UPDATE memberships SET mandate_status = 'paused', updated_at = now() WHERE id = $1", [out.m.id]);
    } catch (err) {
      // Without a paused mandate the next debit would still happen: undo the pause, the loyalty reset and the month shift.
      await db.tx(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('membership:' || $1))", [user.id]);
        for (const p of out.unstarted) {
          await c.query(
            'UPDATE membership_periods SET starts_at = $2, ends_at = $3, streak_month = $4 WHERE id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL',
            [p.id, p.starts_at, p.ends_at, p.streak_month]
          );
        }
        await c.query(
          `UPDATE memberships SET pause_starts_at = NULL, pause_ends_at = NULL, pause_used_at = $2, pause_reason = NULL,
                  consecutive_paid_months = $3, paid_through = $4, renewal_at = $5, updated_at = now()
            WHERE id = $1`,
          [out.m.id, out.m.pause_used_at, out.m.consecutive_paid_months, out.m.paid_through, out.m.renewal_at]
        );
        await recordMembershipEvent(c, out.m, 'pause_failed', { actor: 'system', reason: 'gateway_pause_failed', details: { message: String(err.message).slice(0, 200) } });
      });
      throw new AppError(502, 'pause_failed', 'We could not pause your autopay right now. Please try again shortly.');
    }
  }
  await notify(db, { authUserId: user.id, event: 'membership_paused', data: { starts: fmt(out.starts), ends: fmt(out.ends) }, dedupeKey: `pause:${out.m.id}:${new Date(out.starts).toISOString()}` });
  return out;
}

/** Customer resume: cancels a scheduled pause, or ends a running one early. */
export async function requestResume(user) {
  const out = await db.tx(async (c) => {
    const m = (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [user.id])).rows[0];
    if (!m || m.pause_reason !== 'customer' || !m.pause_starts_at) throw conflict('not_paused', 'Membership is not paused');
    const started = new Date(m.pause_starts_at) <= new Date();
    if (!started) {
      // Scheduled but not begun: put the paid months back where they were.
      const length = (await c.query("SELECT (date_part('year', age($2::timestamptz, $1::timestamptz)) * 12 + date_part('month', age($2::timestamptz, $1::timestamptz)))::int AS n", [m.pause_starts_at, m.pause_ends_at])).rows[0].n || 1;
      const shifted = (await c.query('SELECT count(*)::int AS n FROM membership_periods WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL AND starts_at >= $2', [m.id, m.pause_ends_at])).rows[0].n;
      if (shifted) await shiftUnstartedMonths(c, m.id, -length);
      await c.query("UPDATE memberships SET pause_starts_at = NULL, pause_ends_at = NULL, pause_reason = NULL, updated_at = now() WHERE id = $1", [m.id]);
    } else {
      // Paused already: months still waiting start from now instead of after the full pause.
      await c.query(
        `UPDATE membership_periods p SET starts_at = p.starts_at - d.gap, ends_at = p.ends_at - d.gap
           FROM (SELECT min(starts_at) - now() AS gap FROM membership_periods
                  WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL AND starts_at > now()) d
          WHERE p.membership_id = $1 AND p.credits_granted_at IS NULL AND p.voided_at IS NULL AND d.gap IS NOT NULL`,
        [m.id]
      );
      await c.query(
        `UPDATE memberships m SET status = 'active', pause_starts_at = NULL, pause_ends_at = NULL, pause_reason = NULL,
                paid_through = GREATEST(COALESCE((SELECT max(ends_at) FROM membership_periods WHERE membership_id = m.id AND voided_at IS NULL), now()), now()),
                updated_at = now()
          WHERE id = $1`,
        [m.id]
      );
    }
    await recordMembershipEvent(c, m, started ? 'resumed' : 'pause_cancelled', { actor: user.id });
    await audit(c, { actor: user.id, action: 'membership_resumed', entityType: 'membership', entityId: m.id, details: { early: started } });
    return m;
  });
  if (out.autopay_subscription_id && out.mandate_status === 'paused') {
    try {
      await razorpay.resumeSubscription(out.autopay_subscription_id);
      await db.query("UPDATE memberships SET mandate_status = 'active', updated_at = now() WHERE id = $1", [out.id]);
    } catch (err) {
      log.warn('billing.resume_failed', { membership_id: out.id, message: err.message });
    }
  }
  await notify(db, { authUserId: user.id, event: 'membership_resumed', dedupeKey: `resume:${out.id}:${new Date().toISOString().slice(0, 13)}` });
  return out;
}

/** Customer cancellation (MEM-09): only after the lock-in. */
export async function requestCancel(user, { reason = null } = {}) {
  const settings = await getSettings();
  const m = await db.tx(async (c) => {
    const row = (await c.query("SELECT * FROM memberships WHERE auth_user_id = $1 AND status IN ('active','paused','payment_failed') FOR UPDATE", [user.id])).rows[0];
    if (!row) throw conflict('not_active', 'No active membership to cancel');
    if (row.lock_in_until && new Date(row.lock_in_until) > new Date()) {
      throw conflict('in_lock_in', `Your ${settings.membership_lock_in_months}-month lock-in ends on ${fmt(row.lock_in_until)}. You can cancel any time after that.`);
    }
    if (row.autopay_subscription_id) {
      await c.query("UPDATE membership_subscriptions SET cancel_initiated_by = 'customer', updated_at = now() WHERE razorpay_subscription_id = $1", [row.autopay_subscription_id]);
    }
    await cancelMembershipTx(c, row, { actor: user.id, reason: 'customer' });
    if (reason) await c.query("UPDATE memberships SET cancel_reason = $2 WHERE id = $1", [row.id, `customer: ${String(reason).slice(0, 300)}`]);
    return row;
  });
  if (m.autopay_subscription_id && razorpay.configured) {
    try {
      await razorpay.cancelSubscription(m.autopay_subscription_id);
    } catch (err) {
      // The membership is cancelled; the job retries stopping the mandate so no further debit happens.
      log.error('billing.mandate_cancel_failed', { membership_id: m.id, message: err.message });
      await db.query("UPDATE memberships SET mandate_status = 'cancel_pending', updated_at = now() WHERE id = $1", [m.id]);
    }
  }
  await notify(db, { authUserId: user.id, event: 'membership_cancelled', data: { reason: 'customer' }, dedupeKey: `cancel:${m.id}:${new Date().toISOString().slice(0, 10)}` });
  return m;
}

/** Billing state for the account pages. */
export function billingView(m, settings) {
  if (!m) return null;
  const now = Date.now();
  const inLockIn = Boolean(m.lock_in_until && new Date(m.lock_in_until).getTime() > now);
  return {
    status: m.billing_status,
    mandate_status: m.mandate_status,
    autopay: Boolean(m.autopay_subscription_id),
    next_charge_at: ['active', 'retrying'].includes(m.billing_status) && !m.pause_starts_at ? m.next_charge_at || m.paid_through : null,
    monthly_amount: Number(m.monthly_price) || Number(settings.membership_price),
    lock_in_until: m.lock_in_until,
    in_lock_in: inLockIn,
    credits_frozen: ['retrying', 'halted'].includes(m.billing_status),
    retrying: m.billing_status === 'retrying',
    retry_started_at: m.retry_started_at,
    failed_attempts: Number(m.failed_retry_count) || 0,
    retry_policy: { retries: settings.autopay_retry_count, days: settings.autopay_retry_days },
    recovery_available: m.billing_status === 'halted' && m.status !== 'cancelled',
    can_cancel: ['active', 'paused', 'payment_failed'].includes(m.status) && !inLockIn,
    can_pause: m.status === 'active' && !m.pause_starts_at && !inLockIn && !['retrying', 'halted'].includes(m.billing_status),
    pause: m.pause_starts_at ? { starts_at: m.pause_starts_at, ends_at: m.pause_ends_at, reason: m.pause_reason } : null,
  };
}

/**
 * Background pass: start and end customer pauses, retry stopping mandates, re-sync overdue mandates
 * when a webhook was missed, and send renewal and credit-expiry reminders.
 */
export async function runBillingJobs() {
  const settings = await getSettings();
  // Pauses whose start has arrived.
  const starting = await db.query(
    "SELECT * FROM memberships WHERE status = 'active' AND pause_reason = 'customer' AND pause_starts_at <= now() AND pause_ends_at > now() LIMIT 100"
  );
  for (const m of starting.rows) {
    await db.tx(async (c) => {
      const r = await c.query("UPDATE memberships SET status = 'paused', updated_at = now() WHERE id = $1 AND status = 'active' RETURNING *", [m.id]);
      if (r.rows[0]) await recordMembershipEvent(c, m, 'paused', { actor: 'system', reason: 'customer' });
    }).catch((err) => log.error('billing.pause_start_failed', { membership_id: m.id, message: err.message }));
  }
  // Pauses that have ended: the membership is active again and the mandate resumes debiting.
  const ending = await db.query("SELECT * FROM memberships WHERE status = 'paused' AND pause_reason = 'customer' AND pause_ends_at <= now() LIMIT 100");
  for (const m of ending.rows) {
    try {
      await db.tx(async (c) => {
        await c.query(
          `UPDATE memberships SET status = 'active', pause_starts_at = NULL, pause_ends_at = NULL, pause_reason = NULL,
                  paid_through = GREATEST(COALESCE(paid_through, now()), now()), updated_at = now() WHERE id = $1 AND status = 'paused'`,
          [m.id]
        );
        await recordMembershipEvent(c, m, 'resumed', { actor: 'system', reason: 'pause_ended' });
      });
      if (m.autopay_subscription_id && m.mandate_status === 'paused') {
        await razorpay.resumeSubscription(m.autopay_subscription_id);
        await db.query("UPDATE memberships SET mandate_status = 'active', updated_at = now() WHERE id = $1", [m.id]);
      }
      await notify(db, { authUserId: m.auth_user_id, event: 'membership_resumed', dedupeKey: `pause_end:${m.id}:${new Date(m.pause_ends_at).toISOString()}` });
    } catch (err) {
      log.error('billing.pause_end_failed', { membership_id: m.id, message: err.message });
    }
  }
  if (razorpay.configured) {
    // A resumed membership whose mandate is still paused at the gateway, or a cancelled one whose mandate could not be stopped.
    const stuck = await db.query(
      `SELECT * FROM memberships WHERE autopay_subscription_id IS NOT NULL AND (
         (status = 'active' AND mandate_status = 'paused' AND pause_starts_at IS NULL) OR mandate_status = 'cancel_pending') LIMIT 50`
    );
    for (const m of stuck.rows) {
      try {
        if (m.mandate_status === 'cancel_pending') await razorpay.cancelSubscription(m.autopay_subscription_id);
        else await razorpay.resumeSubscription(m.autopay_subscription_id);
        await db.query('UPDATE memberships SET mandate_status = $2, updated_at = now() WHERE id = $1', [m.id, m.mandate_status === 'cancel_pending' ? 'cancelled' : 'active']);
      } catch (err) {
        log.warn('billing.mandate_sync_failed', { membership_id: m.id, message: err.message });
      }
    }
    // Replaced mandates whose gateway cancellation has not been confirmed yet.
    const replaced = await db.query(
      `SELECT razorpay_subscription_id FROM membership_subscriptions
        WHERE status = 'superseded' AND cancelled_at IS NULL AND razorpay_subscription_id IS NOT NULL AND ended_at < now() - interval '10 minutes' LIMIT 50`
    );
    for (const r of replaced.rows) {
      await stopSupersededMandate(r.razorpay_subscription_id).catch((err) => log.warn('billing.superseded_cancel_failed', { subscription_id: r.razorpay_subscription_id, message: err.message }));
    }
    // Delayed or missed webhooks: a debit is overdue, so ask the gateway what happened.
    const overdue = await db.query(
      `SELECT * FROM memberships WHERE billing_status IN ('active', 'retrying') AND autopay_subscription_id IS NOT NULL
          AND status IN ('active', 'paused') AND pause_starts_at IS NULL AND paid_through < now() - interval '6 hours' LIMIT 50`
    );
    for (const m of overdue.rows) {
      try {
        const sub = await razorpay.fetchSubscription(m.autopay_subscription_id);
        if (sub.status === 'halted') await markHalted({ subscription: sub, eventId: `sync:halted:${sub.id}` });
        else if (sub.status === 'cancelled') await markMandateCancelled({ subscription: sub });
        else if (sub.status === 'pending') await markRetrying({ subscription: sub, eventId: `sync:pending:${sub.id}:${new Date(m.paid_through).toISOString()}` });
        else if (sub.status === 'completed') await syncMandateStatus({ subscription: sub, event: 'subscription.completed' });
      } catch (err) {
        log.warn('billing.overdue_sync_failed', { membership_id: m.id, message: err.message });
      }
    }
  }
  // MEM-14: when a pre-booked gift is about to end, the wearer is invited to continue on her own.
  const giftsEnding = await db.query(
    `SELECT id, auth_user_id, paid_through FROM memberships
      WHERE gift = true AND billing_status = 'prepaid' AND status = 'active' AND paid_through BETWEEN now() + interval '6 days' AND now() + interval '7 days' LIMIT 200`
  );
  for (const m of giftsEnding.rows) {
    await notify(db, { authUserId: m.auth_user_id, event: 'gift_ending', data: { date: fmt(m.paid_through), link: membershipLink() }, dedupeKey: `gift_ending:${m.id}:${new Date(m.paid_through).toISOString().slice(0, 10)}` });
  }
  // New free-piece rewards (6th month, referral) are announced once.
  const fresh = await db.query("SELECT id, auth_user_id, kind FROM reward_entitlements WHERE status = 'available' AND created_at > now() - interval '2 days' LIMIT 200");
  for (const r of fresh.rows) {
    await notify(db, { authUserId: r.auth_user_id, event: r.kind === 'referral' ? 'referral_success' : 'loyalty_reward', dedupeKey: `reward:${r.id}` });
  }
  // Reminders: the next debit in 3 days, and credits expiring within 10 days.
  const upcoming = await db.query(
    `SELECT id, auth_user_id, next_charge_at, monthly_price FROM memberships
      WHERE status = 'active' AND billing_status = 'active' AND pause_starts_at IS NULL
        AND next_charge_at BETWEEN now() + interval '2 days' AND now() + interval '3 days' LIMIT 200`
  );
  for (const m of upcoming.rows) {
    await notify(db, { authUserId: m.auth_user_id, event: 'renewal_upcoming', data: { amount: Number(m.monthly_price) || settings.membership_price, date: fmt(m.next_charge_at) }, dedupeKey: `upcoming:${m.id}:${new Date(m.next_charge_at).toISOString().slice(0, 10)}` });
  }
  const expiring = await db.query(
    `SELECT l.auth_user_id, min(l.expires_at) AS expires_at, sum(l.delta)::int AS credits
       FROM credit_ledger l JOIN memberships m ON m.id = l.membership_id
      WHERE l.delta > 0 AND l.expires_at BETWEEN now() + interval '9 days' AND now() + interval '10 days' AND m.status = 'active' AND m.credits_balance > 0
      GROUP BY l.auth_user_id LIMIT 200`
  );
  for (const r of expiring.rows) {
    await notify(db, { authUserId: r.auth_user_id, event: 'credits_expiring', data: { credits: r.credits, date: fmt(r.expires_at), link: `${config.publicSiteUrl}/catalogue` }, dedupeKey: `expiring:${r.auth_user_id}:${new Date(r.expires_at).toISOString().slice(0, 10)}` });
  }
}
