import { db } from '../lib/db.js';
import { AppError, badRequest, conflict, notFound } from '../lib/http.js';
import { getSettings, membershipPlans } from '../lib/settings.js';
import { calculateMembershipPrice } from '../lib/pricing.js';
import { finalizeMembershipPayment } from '../lib/payments.js';
import { reconcileExpiredCredits } from '../lib/credits.js';
import { creditSummary, isWithinRenewalGrace, milestoneProgress, planOffer, refreshMembership } from '../lib/membership.js';
import { billingView, completeLocalCheckout, requestCancel, requestPause, requestResume, startRecovery, startSignup, verifyCheckout } from '../lib/billing.js';
import { referralDiscountFor } from '../lib/referrals.js';
import { razorpay, verifyPaymentSignature } from '../lib/razorpay.js';
import { audit } from '../lib/audit.js';
import { log } from '../lib/log.js';
import { int, text } from '../lib/validate.js';

export const access = 'user';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60_000, max: 20 };

const RUNNING = ['active', 'paused'];

/** Whether the customer can start a membership now (sign-up), or must first recover a failed payment. */
function renewalState(m, settings) {
  if (m?.billing_status === 'halted' && m.status !== 'cancelled') return { can_purchase: false, reason: 'payment_recovery' };
  const running = m && RUNNING.includes(m.status) && (['active', 'retrying'].includes(m.billing_status) || (m.paid_through && new Date(m.paid_through) > new Date()));
  if (running) return { can_purchase: false, reason: 'active' };
  const graceDays = Math.max(0, Number(settings.renewal_grace_days) || 0);
  const keepsCount = Boolean(m) && Number(m.consecutive_paid_months) > 0 && isWithinRenewalGrace(m, new Date(), settings);
  return {
    can_purchase: true,
    reason: m?.status === 'expired' ? 'expired' : m?.status === 'cancelled' ? 'cancelled' : 'new',
    keeps_consecutive_until: keepsCount ? new Date(new Date(m.paid_through).getTime() + graceDays * 86_400_000).toISOString() : null,
  };
}

async function plansFor(c, uid, settings) {
  const plans = [];
  for (const months of membershipPlans(settings)) {
    const ref = uid ? await referralDiscountFor(c, uid, months, settings) : { amount: 0 };
    const price = calculateMembershipPrice(settings, { months, discount: ref.amount });
    plans.push({
      months,
      monthly_price: settings.membership_price,
      list_total: price.list_total,
      discount: price.discount,
      discount_reason: price.discount ? 'referral' : null,
      total: price.total,
      credits_total: months * settings.credits_per_month,
      autopay_after: true,
      offer: planOffer(months, settings),
    });
  }
  return plans;
}

async function view(uid) {
  const settings = await getSettings();
  await db.tx(async (c) => {
    await refreshMembership(c, uid, settings);
    await reconcileExpiredCredits(c, uid);
  });
  const m = (await db.query('SELECT * FROM memberships WHERE auth_user_id = $1', [uid])).rows[0];
  const [ledger, periods, payments, rewards, summary, plans, events, attempts] = await Promise.all([
    db.query('SELECT delta, reason, expires_at, order_id, created_at FROM credit_ledger WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 30', [uid]),
    m ? db.query('SELECT month_index, streak_month, source, starts_at, ends_at, credits, credits_granted_at, voided_at FROM membership_periods WHERE membership_id = $1 ORDER BY starts_at DESC LIMIT 36', [m.id]) : { rows: [] },
    db.query(
      `SELECT mp.id, mp.amount, mp.list_amount, mp.discount_amount, mp.months, mp.kind, mp.charge_kind, mp.status, mp.paid_at, mp.attempted_at, mp.refunded_at, ir.invoice_number
         FROM membership_payments mp LEFT JOIN invoice_records ir ON ir.membership_payment_id = mp.id
        WHERE mp.auth_user_id = $1 AND mp.status <> 'pending' ORDER BY mp.attempted_at DESC LIMIT 24`,
      [uid]
    ),
    db.query("SELECT id, kind, status, milestone_number, order_id, created_at, redeemed_at, flag_reason FROM reward_entitlements WHERE auth_user_id = $1 AND status <> 'void' ORDER BY created_at DESC", [uid]),
    creditSummary(db, uid),
    db.tx((c) => plansFor(c, uid, settings)),
    m ? db.query('SELECT event, actor, reason, details, created_at FROM membership_events WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 30', [m.id]) : { rows: [] },
    m ? db.query('SELECT outcome, amount, attempt_no, failure_reason, created_at FROM membership_payment_attempts WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 20', [m.id]) : { rows: [] },
  ]);
  const membership = m
    ? {
        id: m.id, status: m.status, monthly_price: m.monthly_price, credits_per_month: m.credits_per_month, credits_balance: m.credits_balance,
        renewal_at: m.renewal_at, paid_through: m.paid_through, started_at: m.started_at, expired_at: m.expired_at, cancelled_at: m.cancelled_at,
        consecutive_paid_months: m.consecutive_paid_months, pause_used_at: m.pause_used_at, autopay_subscription_id: m.autopay_subscription_id,
        pause_reason: m.pause_reason, cancel_reason: m.cancel_reason,
      }
    : { status: 'inactive', monthly_price: settings.membership_price, credits_per_month: settings.credits_per_month, credits_balance: 0, consecutive_paid_months: 0 };
  return {
    membership,
    billing: billingView(m, settings),
    renewal: renewalState(m, settings),
    pricing: {
      monthly_price: settings.membership_price,
      upfront_months: settings.membership_upfront_months,
      lock_in_months: settings.membership_lock_in_months,
      checkout_total: plans.find((p) => p.months === Number(settings.membership_upfront_months))?.total,
      credits_per_month: settings.credits_per_month,
      credit_holding_limit: settings.credit_holding_limit,
      plans,
    },
    credits: { available: m?.credits_balance || 0, ...summary, expiry_days: settings.credit_expiry_days, holding_limit: settings.credit_holding_limit },
    milestone: await milestoneProgress(db, m, settings),
    rewards: rewards.rows,
    periods: periods.rows,
    payments: payments.rows,
    attempts: attempts.rows,
    history: events.rows,
    ledger: ledger.rows,
  };
}

async function startCheckout(user, b) {
  const settings = await getSettings();
  const months = b.months === undefined ? Number(settings.membership_upfront_months) || 2 : int(b.months, { min: 1, max: 24, field: 'months' });
  const plans = membershipPlans(settings);
  if (!plans.includes(months)) throw badRequest('invalid_plan', `Membership starts with ${plans.join(' or ')} months paid upfront`);
  return startSignup(user, { months });
}

/** Legacy one-off membership orders (before autopay). Activated only after the gateway confirms the payment. */
async function activateOrderPayment(user, b) {
  const rzpOrderId = text(b.razorpay_order_id, { max: 64, field: 'razorpay_order_id', required: true });
  const paymentId = text(b.razorpay_payment_id, { max: 64, field: 'razorpay_payment_id', required: true });
  const signature = text(b.razorpay_signature, { max: 128, field: 'razorpay_signature', required: true });
  const mp = (await db.query('SELECT * FROM membership_payments WHERE razorpay_order_id = $1 AND auth_user_id = $2', [rzpOrderId, user.id])).rows[0];
  if (!mp) throw notFound('membership_payment_not_found', 'No membership payment found for this order');
  if (!verifyPaymentSignature({ razorpayOrderId: mp.razorpay_order_id, razorpayPaymentId: paymentId, signature })) {
    await audit(db, { actor: user.id, action: 'membership_signature_invalid', entityType: 'membership', entityId: mp.membership_id });
    throw badRequest('invalid_payment_signature', 'Payment could not be verified');
  }
  if (mp.status === 'paid') {
    if (mp.provider_payment_id === paymentId) return { status: 'active', duplicate: true };
    throw conflict('membership_payment_already_applied', 'This membership payment was already applied');
  }
  const expectedPaise = Math.round(Number(mp.amount) * 100);
  let p;
  try {
    p = await razorpay.fetchPayment(paymentId);
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus >= 400 && err.upstreamStatus < 500) {
      throw badRequest('payment_not_verified', 'Payment could not be confirmed with the gateway. If money was deducted it will be refunded.');
    }
    log.warn('membership.gateway_crosscheck_unavailable', { message: err.message });
    return { status: 'pending_confirmation' };
  }
  if (p.order_id !== rzpOrderId) throw badRequest('payment_order_mismatch', 'This payment does not belong to this order');
  if ((p.currency && p.currency !== 'INR') || Number(p.amount) !== expectedPaise) throw badRequest('amount_mismatch', 'Payment amount does not match the membership price');
  if (p.status === 'authorized') await razorpay.capturePayment(paymentId, expectedPaise);
  else if (p.status !== 'captured') throw badRequest('payment_not_captured', `Payment status is ${p.status}`);
  const r = await finalizeMembershipPayment({ membershipPaymentId: mp.id, paymentId, amountPaise: expectedPaise, source: 'verify' });
  if (r.status === 'amount_mismatch') throw badRequest('amount_mismatch', 'Payment amount does not match the membership price');
  return { status: 'active' };
}

export default async function membership(req, res) {
  const user = req.user;
  if (req.method === 'GET') return res.json(await view(user.id));

  const b = req.body || {};
  if (b.action === 'start_checkout') return res.json(await startCheckout(user, b));
  if (b.action === 'recover') return res.json(await startRecovery(user));
  if (b.action === 'complete_local_checkout') {
    const r = await completeLocalCheckout(user, b);
    const status = r.status === 'pending_confirmation' ? 'pending_confirmation' : 'active';
    if (status === 'pending_confirmation') throw new AppError(503, 'payment_confirmation_pending', 'Your payment is being confirmed. Refresh in a moment — you will not be charged twice.');
    return res.json({ ok: true, status, ...(await view(user.id)) });
  }
  if (b.action === 'activate_paid') {
    const r = b.razorpay_subscription_id ? await verifyCheckout(user, b) : await activateOrderPayment(user, b);
    const status = r.status === 'pending_confirmation' ? 'pending_confirmation' : 'active';
    if (status === 'pending_confirmation') throw new AppError(503, 'payment_confirmation_pending', 'Your payment is being confirmed. Refresh in a moment — you will not be charged twice.');
    return res.json({ ok: true, status, ...(await view(user.id)) });
  }
  if (b.action === 'pause') await requestPause(user);
  else if (b.action === 'resume') await requestResume(user);
  else if (b.action === 'cancel') await requestCancel(user, { reason: b.reason ? text(b.reason, { max: 300, field: 'reason' }) : null });
  else throw badRequest('unsupported_action', 'Unsupported membership action');
  res.json(await view(user.id));
}
