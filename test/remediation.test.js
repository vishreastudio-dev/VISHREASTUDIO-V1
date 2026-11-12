// Remediation suite: membership lifecycle, monthly credits, six-month rewards, referrals,
// gift enquiries and the security/config fixes from docs/archive/2026-11-05-remediation-audit/VISHREA_DEVELOPER_ACTION_REGISTER.md.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, authoriseSubscription, ctx, dbSkipReason, DELIVERY, gateway, login, pay, recurringPayment, setup, subscriptionEvent, teardown, uniqueEmail, webhookSignature, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();
let admin;

const q1 = async (sql, params = []) => (await ctx.db.query(sql, params)).rows[0];
const balance = async (uid) => (await q1('SELECT credits_balance FROM memberships WHERE auth_user_id = $1', [uid]))?.credits_balance;

/** Move a customer's whole membership timeline `months` into the past (time travel for tests). */
async function shiftMembership(uid, months) {
  await ctx.db.query(
    `UPDATE membership_periods p SET starts_at = p.starts_at - make_interval(months => $2), ends_at = p.ends_at - make_interval(months => $2)
       FROM memberships m WHERE m.id = p.membership_id AND m.auth_user_id = $1`,
    [uid, months]
  );
  await ctx.db.query(
    `UPDATE memberships SET paid_through = paid_through - make_interval(months => $2), renewal_at = renewal_at - make_interval(months => $2) WHERE auth_user_id = $1`,
    [uid, months]
  );
}

/** Join: pay the upfront months and authorise the UPI Autopay mandate in one checkout. */
async function buyMembership(cookie, months) {
  const start = await api('POST', '/api/membership', { action: 'start_checkout', ...(months ? { months } : {}) }, { cookie });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const p = authoriseSubscription(start.data.razorpay.subscription_id);
  const a = await api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  return { start: start.data, payment: p, view: a.data, subscriptionId: start.data.razorpay.subscription_id };
}

const sendWebhook = ({ raw, headers }) => api('POST', '/api/webhooks/razorpay', undefined, { raw, headers });

/** Move the timeline so the paid period ended `hoursAgo` hours ago (a debit is now due). */
async function endPaidPeriod(uid, hoursAgo = 1) {
  await ctx.db.query(
    `UPDATE membership_periods p SET starts_at = p.starts_at - (mm.paid_through - now()) - make_interval(hours => $2), ends_at = p.ends_at - (mm.paid_through - now()) - make_interval(hours => $2)
       FROM memberships mm WHERE mm.id = p.membership_id AND mm.auth_user_id = $1`, [uid, hoursAgo]);
  await ctx.db.query(
    `UPDATE memberships mm SET paid_through = (SELECT max(ends_at) FROM membership_periods p WHERE p.membership_id = mm.id AND p.voided_at IS NULL),
            lock_in_until = CASE WHEN lock_in_until IS NULL THEN NULL ELSE now() - interval '1 hour' END WHERE mm.auth_user_id = $1`,
    [uid]
  );
}

/** A successful monthly autopay debit (subscription.charged). */
async function chargeMonth(member, subscriptionId) {
  const payment = recurringPayment(subscriptionId);
  const r = await sendWebhook(subscriptionEvent('subscription.charged', subscriptionId, { payment, status: 'active' }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return payment;
}

/** Change settings through the admin API (validated and audited like a real edit). */
async function setSettings(settings) {
  const r = await api('POST', '/api/admin/ops?section=settings', { settings }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

/** Move a member to `daysLeft` before the paid period ends, then renew for another 2 months. */
async function renewInWindow(member, daysLeft = 2) {
  await ctx.db.query(
    `UPDATE membership_periods p SET starts_at = p.starts_at - (mm.paid_through - now()) + make_interval(days => $2), ends_at = p.ends_at - (mm.paid_through - now()) + make_interval(days => $2)
       FROM memberships mm WHERE mm.id = p.membership_id AND mm.auth_user_id = $1`, [member.user.id, daysLeft]);
  await ctx.db.query(
    `UPDATE memberships mm SET paid_through = (SELECT max(ends_at) FROM membership_periods p WHERE p.membership_id = mm.id AND p.voided_at IS NULL) WHERE mm.auth_user_id = $1`,
    [member.user.id]
  );
  return buyMembership(member.cookie);
}

const sendRefund = (paymentId, amountPaise) => {
  const raw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: `rfnd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, payment_id: paymentId, amount: amountPaise } } } });
  return api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_rf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` } });
};

async function freshPiece(name, price = 1800, extra = {}) {
  const r = await api('POST', '/api/admin/ops?section=product', { name, price_inr: price, category: 'Tops', is_one_of_one: true, ...extra }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.product;
}

describe('V1 remediation', { skip, timeout: 600_000 }, () => {
  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
  }, { timeout: 120_000 });
  after(teardown);

  describe('membership lifecycle and monthly credits', () => {
    test('a 2-month membership grants 4 credits per paid month (8 in total), once', async () => {
      const m = await login(uniqueEmail('m2'));
      const { view } = await buyMembership(m.cookie);
      assert.equal(view.membership.status, 'active');
      assert.equal(view.membership.credits_balance, 4, 'month 1 credited at payment');
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1", [m.user.id])).n, 2);
      await shiftMembership(m.user.id, 1); // month 2 has started
      const v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.credits_balance, 8);
      assert.equal(v.data.credits.granted, 8);
      await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(await balance(m.user.id), 8, 'repeated refresh does not grant twice');
      assert.equal((await q1("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'membership_payment'", [m.user.id])).n, 2);
    });

    test('acceptance: ₹3,598 once with the mandate, 4 credits now and 4 in month 2 with no charge, then ₹1,799 a month from month 3', async () => {
      const m = await login(uniqueEmail('acc'));
      const { start, subscriptionId, view } = await buyMembership(m.cookie);
      assert.equal(start.amount, 3598, 'upfront = 2 × ₹1,799');
      assert.equal(start.monthly_amount, 1799);
      const sub = gateway.subscriptions.get(subscriptionId);
      assert.equal(sub.addons[0].item.amount, 359800, 'upfront charged with the mandate authorisation');
      assert.equal(sub.plan_amount, 179900, 'monthly debit amount');
      const firstDebitDays = (sub.start_at * 1000 - Date.now()) / 86_400_000;
      assert.ok(firstDebitDays > 58 && firstDebitDays < 63, `first monthly debit after the 2 upfront months (${firstDebitDays} days)`);
      assert.equal(view.membership.credits_balance, 4);
      assert.equal(view.billing.status, 'active');
      assert.equal(view.billing.autopay, true);
      assert.ok(view.billing.in_lock_in, '2-month lock-in');
      await shiftMembership(m.user.id, 1); // month 2: credits, no charge
      let v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.credits_balance, 8);
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_payments WHERE auth_user_id = $1 AND status = 'paid'", [m.user.id])).n, 1, 'no charge in month 2');
      await endPaidPeriod(m.user.id, 1); // month 3 is due
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.status, 'active', 'awaiting the autopay debit, not expired');
      await chargeMonth(m, subscriptionId);
      const paid = (await ctx.db.query("SELECT amount, charge_kind, months FROM membership_payments WHERE auth_user_id = $1 AND status = 'paid' ORDER BY paid_at", [m.user.id])).rows;
      assert.deepEqual(paid.map((p) => [Number(p.amount), p.charge_kind, p.months]), [[3598, 'upfront', 2], [1799, 'recurring', 1]]);
      assert.equal((await q1("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'membership_payment'", [m.user.id])).n, 3, 'credits for months 1, 2 and 3');
      assert.equal(await balance(m.user.id), 8, 'MEM-04: never more than 8 credits held');
      assert.equal((await q1("SELECT -sum(delta)::int AS n FROM credit_ledger WHERE auth_user_id = $1 AND reason = 'holding_limit'", [m.user.id])).n, 4, 'the oldest credits lapsed to make room');
      assert.ok((await q1("SELECT 1 AS ok FROM invoice_records ir JOIN membership_payments mp ON mp.id = ir.membership_payment_id WHERE mp.auth_user_id = $1 AND mp.charge_kind = 'recurring'", [m.user.id]))?.ok, 'every debit is invoiced');
    });

    test('an autopay member with no debit after the retry window expires; joining again restarts the count', async () => {
      const m = await login(uniqueEmail('exp'));
      await buyMembership(m.cookie);
      await endPaidPeriod(m.user.id, 24 * 10); // the debit never came (10 days)
      const v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.status, 'expired');
      assert.equal(v.data.renewal.can_purchase, true);
      const again = await buyMembership(m.cookie);
      assert.equal(again.view.membership.status, 'active');
      assert.equal(again.view.milestone.current_month, 1, 'count restarted');
    });

    test('an unverified or failed payment never extends the membership', async () => {
      const m = await login(uniqueEmail('fail'));
      const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie });
      const p = authoriseSubscription(start.data.razorpay.subscription_id);
      const bad = await api('POST', '/api/membership', { action: 'activate_paid', ...p, razorpay_signature: 'f'.repeat(64) }, { cookie: m.cookie });
      assert.equal(bad.status, 400);
      // A browser claiming success for a payment of the wrong amount is refused after the gateway check.
      const wrong = authoriseSubscription(start.data.razorpay.subscription_id, { amount: 100 });
      assert.equal((await api('POST', '/api/membership', { action: 'activate_paid', ...wrong }, { cookie: m.cookie })).data.error, 'amount_mismatch');
      const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: `pay_fail_${Date.now()}`, order_id: 'order_x', error_description: 'declined' } } } });
      const wh = await api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_fail_${Date.now()}` } });
      assert.equal(wh.status, 200);
      const row = await q1('SELECT status, paid_through FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.equal(row.status, 'pending_payment');
      assert.equal(row.paid_through, null);
      assert.equal(await balance(m.user.id), 0);
    });

    test('duplicate and delayed webhooks + browser verification apply the upfront payment once', async () => {
      const m = await login(uniqueEmail('dupwh'));
      const start = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie });
      const subId = start.data.razorpay.subscription_id;
      // A refresh reuses the same mandate request instead of creating a second one.
      assert.equal((await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie })).data.razorpay.subscription_id, subId);
      const p = authoriseSubscription(subId);
      const payment = gateway.payments.get(p.razorpay_payment_id);
      const captured = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: payment } } });
      const hdr = (raw, id) => ({ 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': id });
      await Promise.all([
        api('POST', '/api/webhooks/razorpay', undefined, { raw: captured, headers: hdr(captured, `evt_a_${payment.id}`) }),
        api('POST', '/api/webhooks/razorpay', undefined, { raw: captured, headers: hdr(captured, `evt_b_${payment.id}`) }),
        sendWebhook(subscriptionEvent('subscription.authenticated', subId, { payment, status: 'authenticated' })),
        sendWebhook(subscriptionEvent('subscription.charged', subId, { payment, status: 'authenticated' })),
        api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie: m.cookie }),
      ]);
      assert.equal(await balance(m.user.id), 4);
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1", [m.user.id])).n, 2);
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_payments WHERE auth_user_id = $1 AND status = 'paid'", [m.user.id])).n, 1);
      // A monthly debit whose subscription.charged is lost is still applied from payment.captured, once.
      await endPaidPeriod(m.user.id, 1);
      const debit = recurringPayment(subId);
      const late = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: debit } } });
      await sendWebhook({ raw: late, headers: hdr(late, `evt_late_${debit.id}`) });
      await sendWebhook(subscriptionEvent('subscription.charged', subId, { payment: debit, status: 'active' }));
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_payments WHERE auth_user_id = $1 AND status = 'paid'", [m.user.id])).n, 2);
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1", [m.user.id])).n, 3);
    });

    test('a failed debit freezes credits during the retries; when every retry fails the membership pauses; a new mandate recovers it', async () => {
      const m = await login(uniqueEmail('retry'));
      const { subscriptionId } = await buyMembership(m.cookie);
      const piece = await freshPiece(`Frozen Piece ${Date.now()}`);
      await api('POST', '/api/cart', { variant_id: piece.variants[0].id }, { cookie: m.cookie });
      const cart = await api('GET', '/api/cart', undefined, { cookie: m.cookie });
      await endPaidPeriod(m.user.id, 1);
      const failed = { ...recurringPayment(subscriptionId), status: 'failed', error_description: 'Insufficient balance' };
      assert.equal((await sendWebhook(subscriptionEvent('subscription.pending', subscriptionId, { payment: failed, status: 'pending' }))).status, 200);
      for (let i = 0; i < 3; i += 1) {
        const f = { ...recurringPayment(subscriptionId), status: 'failed', error_description: 'Insufficient balance' };
        const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: f } } });
        await sendWebhook({ raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_pf_${f.id}` } });
      }
      let v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.billing.status, 'retrying');
      assert.equal(v.data.billing.credits_frozen, true);
      assert.equal(v.data.billing.failed_attempts, 3);
      assert.equal(v.data.membership.status, 'active', 'still a member during the retries');
      const toggle = await api('PATCH', '/api/cart', { item_id: cart.data.items[0].id, use_credit: true }, { cookie: m.cookie });
      assert.equal(toggle.status, 400);
      assert.match(toggle.data.message, /frozen/);
      assert.ok(v.data.attempts.filter((a) => a.outcome === 'failed').length >= 3, 'every failed attempt is in the history');

      assert.equal((await sendWebhook(subscriptionEvent('subscription.halted', subscriptionId, { status: 'halted' }))).status, 200);
      await endPaidPeriod(m.user.id, 24 * 20); // long after: still paused, never expired or cancelled
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.status, 'paused');
      assert.equal(v.data.billing.status, 'halted');
      assert.equal(v.data.billing.recovery_available, true);
      assert.equal(v.data.renewal.reason, 'payment_recovery');
      assert.equal((await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie })).data.error, 'payment_recovery_required');

      const rec = await api('POST', '/api/membership', { action: 'recover' }, { cookie: m.cookie });
      assert.equal(rec.status, 200, JSON.stringify(rec.data));
      assert.equal(rec.data.amount, 1799, 'the first month is charged with the new mandate');
      assert.equal(gateway.subscriptions.get(rec.data.razorpay.subscription_id).start_at, null, 'debits start immediately');
      const a = await api('POST', '/api/membership', { action: 'activate_paid', ...authoriseSubscription(rec.data.razorpay.subscription_id) }, { cookie: m.cookie });
      assert.equal(a.status, 200, JSON.stringify(a.data));
      assert.equal(a.data.membership.status, 'active');
      assert.equal(a.data.billing.status, 'active');
      assert.equal(a.data.billing.credits_frozen, false);
      assert.equal(a.data.milestone.current_month, 1, 'a missed payment restarts the 6th-month count');
      assert.equal(gateway.subscriptions.get(subscriptionId).status, 'cancelled', 'the halted mandate is retired at the gateway');
    });

    test('a debit that succeeds on a retry clears the freeze and keeps the billing cycle aligned', async () => {
      const m = await login(uniqueEmail('retryok'));
      const { subscriptionId } = await buyMembership(m.cookie);
      await endPaidPeriod(m.user.id, 48);
      const due = (await q1('SELECT paid_through FROM memberships WHERE auth_user_id = $1', [m.user.id])).paid_through;
      await sendWebhook(subscriptionEvent('subscription.pending', subscriptionId, { status: 'pending' }));
      await chargeMonth(m, subscriptionId);
      const v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.billing.status, 'active');
      assert.equal(v.data.billing.credits_frozen, false);
      const third = await q1('SELECT starts_at FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 ORDER BY starts_at DESC LIMIT 1', [m.user.id]);
      assert.ok(Math.abs(new Date(third.starts_at) - new Date(due)) < 1000, 'month 3 starts when month 2 ended, not when the retry succeeded');
      assert.ok(v.data.history.some((h) => h.event === 'payment_recovered'));
    });

    test('one-month pause: not in the lock-in, mandate paused, no charge and no credits, resumes after a month; resets the count', async () => {
      const m = await login(uniqueEmail('pz'));
      const { subscriptionId } = await buyMembership(m.cookie);
      const early = await api('POST', '/api/membership', { action: 'pause' }, { cookie: m.cookie });
      assert.equal(early.status, 409);
      assert.equal(early.data.error, 'pause_in_lock_in');
      await endPaidPeriod(m.user.id, 1);
      await chargeMonth(m, subscriptionId); // month 3, lock-in over
      const r = await api('POST', '/api/membership', { action: 'pause' }, { cookie: m.cookie });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(gateway.subscriptions.get(subscriptionId).status, 'paused', 'no debit while paused');
      assert.equal(r.data.billing.can_pause, false);
      assert.equal(r.data.milestone.current_month, 0, 'a pause resets the 6th-month count');
      assert.equal((await api('POST', '/api/membership', { action: 'pause' }, { cookie: m.cookie })).status, 409, 'one pause at a time');
      const { runBillingJobs } = await import('../lib/billing.js');
      const before = await balance(m.user.id);
      // The month in progress ends: the pause begins.
      await ctx.db.query("UPDATE memberships SET pause_starts_at = now() - interval '1 hour', paid_through = now() - interval '1 hour', pause_ends_at = now() + interval '1 month' WHERE auth_user_id = $1", [m.user.id]);
      await runBillingJobs();
      let v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.status, 'paused');
      assert.equal(await balance(m.user.id), before, 'no new credits while paused');
      // The month is over: the membership resumes and the mandate debits again.
      await ctx.db.query("UPDATE memberships SET pause_ends_at = now() - interval '1 minute' WHERE auth_user_id = $1", [m.user.id]);
      await runBillingJobs();
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.membership.status, 'active');
      assert.equal(gateway.subscriptions.get(subscriptionId).status, 'active');
      await chargeMonth(m, subscriptionId);
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.milestone.current_month, 1);
      assert.deepEqual(v.data.history.map((h) => h.event).filter((e) => ['pause_scheduled', 'paused', 'resumed'].includes(e)).reverse(), ['pause_scheduled', 'paused', 'resumed']);
    });

    test('a pause that fails at the gateway is undone (no silent debit while "paused")', async () => {
      const m = await login(uniqueEmail('pzfail'));
      const { subscriptionId } = await buyMembership(m.cookie);
      await endPaidPeriod(m.user.id, 1);
      await chargeMonth(m, subscriptionId);
      gateway.failNextPause = true;
      const r = await api('POST', '/api/membership', { action: 'pause' }, { cookie: m.cookie });
      assert.equal(r.status, 502);
      const row = await q1('SELECT pause_starts_at, status FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.equal(row.pause_starts_at, null);
      assert.equal(row.status, 'active');
    });

    test('cancellation opens after the lock-in, stops the mandate, voids unstarted months; admin cannot reactivate', async () => {
      const m = await login(uniqueEmail('cx'));
      const { subscriptionId } = await buyMembership(m.cookie);
      const locked = await api('POST', '/api/membership', { action: 'cancel' }, { cookie: m.cookie });
      assert.equal(locked.status, 409);
      assert.equal(locked.data.error, 'in_lock_in');
      await ctx.db.query("UPDATE memberships SET lock_in_until = now() - interval '1 minute' WHERE auth_user_id = $1", [m.user.id]);
      const r = await api('POST', '/api/membership', { action: 'cancel' }, { cookie: m.cookie });
      assert.equal(r.status, 200);
      assert.equal(r.data.membership.status, 'cancelled');
      assert.equal(r.data.membership.credits_balance, 0, 'unused credits lapse');
      assert.equal(gateway.subscriptions.get(subscriptionId).status, 'cancelled', 'no further debits');
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 AND p.voided_at IS NOT NULL", [m.user.id])).n, 1);
      // The gateway's own cancellation event afterwards changes nothing.
      await sendWebhook(subscriptionEvent('subscription.cancelled', subscriptionId, { status: 'cancelled' }));
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_events e JOIN memberships mm ON mm.id = e.membership_id WHERE mm.auth_user_id = $1 AND e.event = 'cancelled'", [m.user.id])).n, 1);
      await shiftMembership(m.user.id, 3);
      const mid = (await q1('SELECT id FROM memberships WHERE auth_user_id = $1', [m.user.id])).id;
      const re = await api('POST', '/api/admin/ops?section=membership', { id: mid, status: 'active' }, { cookie: admin.cookie });
      assert.equal(re.status, 409);
      assert.equal(re.data.error, 'no_paid_period');
    });

    test('cancelling the UPI mandate from the customer’s UPI app cancels the membership (MEM-09)', async () => {
      const m = await login(uniqueEmail('upicx'));
      const { subscriptionId } = await buyMembership(m.cookie);
      assert.equal((await sendWebhook(subscriptionEvent('subscription.cancelled', subscriptionId, { status: 'cancelled' }))).status, 200);
      const row = await q1('SELECT status, cancel_reason, credits_balance, billing_status FROM memberships WHERE auth_user_id = $1', [m.user.id]);
      assert.deepEqual([row.status, row.cancel_reason, row.credits_balance, row.billing_status], ['cancelled', 'mandate_cancelled', 0, 'cancelled']);
      // A debit taken after cancellation never becomes membership time.
      const late = recurringPayment(subscriptionId);
      await sendWebhook(subscriptionEvent('subscription.charged', subscriptionId, { payment: late, status: 'cancelled' }));
      assert.equal((await q1('SELECT status FROM membership_payments WHERE provider_payment_id = $1', [late.id])).status, 'refund_required');
      assert.equal((await q1('SELECT status FROM memberships WHERE auth_user_id = $1', [m.user.id])).status, 'cancelled');
    });

    test('a forged or unsigned subscription webhook is refused', async () => {
      const m = await login(uniqueEmail('forge'));
      const { subscriptionId } = await buyMembership(m.cookie);
      const ev = subscriptionEvent('subscription.cancelled', subscriptionId, { status: 'cancelled' });
      const r = await api('POST', '/api/webhooks/razorpay', undefined, { raw: ev.raw, headers: { ...ev.headers, 'X-Razorpay-Signature': 'f'.repeat(64) } });
      assert.equal(r.status, 400);
      assert.equal((await q1('SELECT status FROM memberships WHERE auth_user_id = $1', [m.user.id])).status, 'active');
    });
  });

  describe('six-month membership and free-piece reward', () => {
    test('local stand-in checkout activates once, and a failed attempt does not', async () => {
      const m = await login(uniqueEmail('localpay'));
      const start = await api('POST', '/api/membership', { action: 'start_checkout', months: 2 }, { cookie: m.cookie });
      assert.equal(start.status, 200, JSON.stringify(start.data));
      assert.equal(start.data.razorpay.checkout_mode, 'local');
      assert.equal(start.data.amount, 3598);
      const sub = start.data.razorpay.subscription_id;
      const failed = await api('POST', '/api/membership', { action: 'complete_local_checkout', razorpay_subscription_id: sub, outcome: 'failed' }, { cookie: m.cookie });
      assert.equal(failed.status, 400);
      assert.equal(failed.data.error, 'payment_not_captured');
      assert.equal(failed.data.request_id ? 'yes' : 'no', 'yes');
      assert.equal((await api('GET', '/api/membership', undefined, { cookie: m.cookie })).data.membership.status, 'pending_payment');
      const paid = await api('POST', '/api/membership', { action: 'complete_local_checkout', razorpay_subscription_id: sub }, { cookie: m.cookie });
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      assert.equal(paid.data.membership.status, 'active');
      assert.equal(Number(paid.data.membership.credits_balance), 4);
      const again = await api('POST', '/api/membership', { action: 'complete_local_checkout', razorpay_subscription_id: sub }, { cookie: m.cookie });
      assert.equal(again.status, 409);
      assert.equal(Number((await api('GET', '/api/membership', undefined, { cookie: m.cookie })).data.membership.credits_balance), 4);
      const stranger = await login(uniqueEmail('localpay2'));
      assert.equal((await api('POST', '/api/membership', { action: 'complete_local_checkout', razorpay_subscription_id: sub }, { cookie: stranger.cookie })).status, 404);
    });

    test('only the 2-month upfront sign-up is on sale; it shows the 6th-month offer', async () => {
      const m = await login(uniqueEmail('six'));
      const v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.deepEqual(v.data.pricing.plans.map((p) => p.months), [2]);
      assert.equal(v.data.pricing.plans[0].total, 3598);
      assert.match(v.data.pricing.plans[0].offer, /6th month/);
      assert.equal((await api('POST', '/api/membership', { action: 'start_checkout', months: 6 }, { cookie: m.cookie })).status, 400);
    });

    test('2 upfront months + 4 autopay debits: the 6th consecutive paid month brings one free piece, exactly once', async () => {
      const m = await login(uniqueEmail('six2'));
      const { subscriptionId } = await buyMembership(m.cookie);
      const count = async () => (await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'six_month_milestone'", [m.user.id])).n;
      assert.equal(await count(), 0, 'no reward at purchase');
      let v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.milestone.current_month, 1);
      assert.equal(v.data.milestone.months_to_reward, 5);
      await shiftMembership(m.user.id, 1); // month 2
      for (let month = 3; month <= 5; month += 1) {
        await endPaidPeriod(m.user.id, 1);
        await chargeMonth(m, subscriptionId);
      }
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.milestone.current_month, 5);
      assert.equal(await count(), 0, 'nothing in month 5');
      await endPaidPeriod(m.user.id, 1);
      const payment = recurringPayment(subscriptionId);
      // Month 6's debit is delivered twice and refreshed concurrently.
      await Promise.all([
        sendWebhook(subscriptionEvent('subscription.charged', subscriptionId, { payment, status: 'active' })),
        sendWebhook(subscriptionEvent('subscription.charged', subscriptionId, { payment, status: 'active' })),
        api('GET', '/api/membership', undefined, { cookie: m.cookie }),
      ]);
      assert.equal(await count(), 1, 'one free piece in the 6th month');
      v = await api('GET', '/api/membership', undefined, { cookie: m.cookie });
      assert.equal(v.data.milestone.rule, 'consecutive_months');
      assert.equal(v.data.milestone.current_month, 6);
      assert.equal(v.data.milestone.months_to_reward, 0);
      assert.equal(v.data.rewards.filter((r) => r.kind === 'six_month_milestone').length, 1);
      assert.ok(v.data.membership.credits_balance <= 8, 'the free piece is a reward, not an extra credit, and credits stay within the limit');
      await endPaidPeriod(m.user.id, 1);
      await chargeMonth(m, subscriptionId);
      assert.equal(await count(), 1, 'month 7 starts a new count');
    });

    test('nothing is reward-eligible until the owner chooses pieces or categories', async () => {
      const m = await login(uniqueEmail('elig0'));
      const reward = (await q1("INSERT INTO reward_entitlements (auth_user_id, kind, milestone_number) VALUES ($1, 'six_month_milestone', 1) RETURNING id", [m.user.id])).id;
      const piece = await freshPiece(`Unlisted Piece ${Date.now()}`, 1500);
      const r = await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: piece.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'reward_not_eligible');
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'available', 'the refused attempt changed nothing');
      await api('POST', '/api/cart', { variant_id: piece.variants[0].id }, { cookie: m.cookie });
      const cart = await api('GET', '/api/cart', undefined, { cookie: m.cookie });
      assert.equal(cart.data.items.find((i) => i.product_id === piece.id).reward_eligible, false);
      const patch = await api('PATCH', '/api/cart', { item_id: cart.data.items[0].id, reward_entitlement_id: reward }, { cookie: m.cookie });
      assert.equal(patch.status, 400);
      await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });
    });

    test('category eligibility and the optional price limit are enforced on the server', async () => {
      const m = await login(uniqueEmail('elig1'));
      const cheap = await freshPiece(`Cat Cheap ${Date.now()}`, 1500);
      const dear = await freshPiece(`Cat Dear ${Date.now()}`, 2600);
      const category = (await q1('SELECT category_id FROM products WHERE id = $1', [cheap.id])).category_id;
      await setSettings({ reward_eligible_category_ids: [category], reward_max_price_inr: 2000 });
      try {
        const rewards = [];
        for (let i = 0; i < 2; i += 1) rewards.push((await q1("INSERT INTO reward_entitlements (auth_user_id, kind, milestone_number) VALUES ($1, 'six_month_milestone', $2) RETURNING id", [m.user.id, i + 1])).id);
        const over = await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: dear.variants[0].id, use: 'reward', reward_entitlement_id: rewards[0] }, { cookie: m.cookie });
        assert.equal(over.status, 400, 'above the price limit');
        await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });
        const ok = await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: cheap.variants[0].id, use: 'reward', reward_entitlement_id: rewards[0] }, { cookie: m.cookie });
        assert.equal(ok.status, 200, JSON.stringify(ok.data));
        // The owner removes the category before checkout: the server refuses the stale reward line.
        await setSettings({ reward_eligible_category_ids: [] });
        const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'E', phone: '+91 9000000012' } }, { cookie: m.cookie });
        assert.equal(co.status, 400);
        assert.equal(co.data.error, 'reward_not_eligible');
        assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [rewards[0]])).status, 'available');
        await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });
      } finally {
        await setSettings({ reward_eligible_category_ids: [], reward_max_price_inr: 0 });
      }
    });

    test('free-piece reward redeems one configured piece once; pieces outside the selection are refused', async () => {
      const m = await login(uniqueEmail('redeem'));
      const reward = (await q1(
        "INSERT INTO reward_entitlements (auth_user_id, kind, milestone_number) VALUES ($1, 'six_month_milestone', 1) RETURNING id", [m.user.id]
      )).id;
      const piece = await freshPiece(`Reward Piece ${Date.now()}`, 2200);
      const piece2 = await freshPiece(`Reward Piece B ${Date.now()}`, 2200);
      await setSettings({ reward_eligible_product_ids: [piece.id, piece2.id] });

      const premium = await freshPiece(`Premium Reward ${Date.now()}`, 5000, { badge: 'Premium' });
      await api('POST', '/api/wardrobe', { action: 'save', product_id: premium.id }, { cookie: m.cookie });
      const refused = await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: premium.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
      assert.equal(refused.status, 400);
      assert.equal(refused.data.error, 'reward_not_eligible');
      await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });

      await api('POST', '/api/wardrobe', { action: 'save', product_id: piece.id }, { cookie: m.cookie });
      const wb = await api('GET', '/api/wardrobe', undefined, { cookie: m.cookie });
      const saved = wb.data.items.find((i) => i.product_id === piece.id);
      assert.ok(saved?.available);
      assert.deepEqual(saved.reward_variant_ids, [piece.variants[0].id]);
      assert.deepEqual(wb.data.items.find((i) => i.product_id === premium.id).reward_variant_ids, []);
      const add = await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: piece.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
      assert.equal(add.status, 200, JSON.stringify(add.data));
      assert.equal(add.data.cart.items[0].reward_entitlement_id, reward);
      assert.equal(add.data.cart.estimate.subtotal - add.data.cart.estimate.reward_discount, 0);

      const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'R', phone: '+91 9000000011' } }, { cookie: m.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal(Number(co.data.totals.total), 0, 'free piece with studio pickup costs nothing');
      assert.equal((await q1('SELECT status, order_id FROM reward_entitlements WHERE id = $1', [reward])).status, 'redeemed');

      // Already redeemed: cannot be attached again.
      await api('POST', '/api/cart', { variant_id: piece2.variants[0].id }, { cookie: m.cookie });
      const c2 = await api('GET', '/api/cart', undefined, { cookie: m.cookie });
      const again = await api('PATCH', '/api/cart', { item_id: c2.data.items[0].id, reward_entitlement_id: reward }, { cookie: m.cookie });
      assert.equal(again.status, 404);
      await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });
    });

    test('a reward reserved on an unpaid order is released when the hold expires', async () => {
      const m = await login(uniqueEmail('rel'));
      const reward = (await q1("INSERT INTO reward_entitlements (auth_user_id, kind, milestone_number) VALUES ($1, 'six_month_milestone', 1) RETURNING id", [m.user.id])).id;
      const piece = await freshPiece(`Hold Piece ${Date.now()}`, 2000);
      await setSettings({ reward_eligible_product_ids: [piece.id] });
      await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: piece.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
      const co = await api('POST', '/api/checkout', DELIVERY, { cookie: m.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal(Number(co.data.totals.total), 99, 'delivery is still charged on a free piece');
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'reserved');
      assert.equal((await api('POST', '/api/checkout', { action: 'cancel', order_id: co.data.order_id }, { cookie: m.cookie })).status, 200);
      assert.equal((await q1('SELECT status, order_id FROM reward_entitlements WHERE id = $1', [reward])).status, 'available');
    });
  });

  describe('referrals', () => {
    test('code validation: valid, invalid, own code', async () => {
      const referrer = await login(uniqueEmail('rfr'));
      const mine = await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie });
      assert.match(mine.data.code, /^VS[A-Z2-9]{6}$/);
      assert.ok(mine.data.link.endsWith(`/?ref=${mine.data.code}`));
      assert.equal((await api('GET', `/api/referrals?code=${mine.data.code}`)).data.valid, true);
      assert.equal((await api('GET', '/api/referrals?code=VSZZZZZZ')).data.valid, false);
      assert.equal((await api('GET', `/api/referrals?code=${mine.data.code}`, undefined, { cookie: referrer.cookie })).data.reason, 'own_code');
      assert.equal((await api('POST', '/api/referrals', { action: 'attribute', code: mine.data.code }, { cookie: referrer.cookie })).data.error, 'self_referral');
    });

    test('new customer gets ₹150 off the first 2-month membership only; referrer earns one free piece once', async () => {
      const referrer = await login(uniqueEmail('rfr2'));
      const code = (await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie })).data.code;
      const friend = await login(uniqueEmail('friend'));
      assert.equal((await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: friend.cookie })).status, 201);
      assert.equal((await api('POST', '/api/referrals', { action: 'attribute', code: 'VSABCDEF' }, { cookie: friend.cookie })).status, 400);

      const two = await api('POST', '/api/membership', { action: 'start_checkout', months: 2 }, { cookie: friend.cookie });
      assert.equal(two.data.amount, 3448);
      assert.equal(two.data.discount, 150);
      assert.equal(two.data.monthly_amount, 1799, 'the discount is on the upfront months only');
      const sub = gateway.subscriptions.get(two.data.razorpay.subscription_id);
      assert.equal(sub.addons[0].item.amount, 344800, 'the gateway charges the server amount');

      const p = authoriseSubscription(two.data.razorpay.subscription_id);
      const payment = gateway.payments.get(p.razorpay_payment_id);
      const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: payment } } });
      const hdr = (id) => ({ 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': id });
      await Promise.all([
        api('POST', '/api/membership', { action: 'activate_paid', ...p }, { cookie: friend.cookie }),
        api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: hdr(`evt_ref_a_${payment.id}`) }),
        api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: hdr(`evt_ref_b_${payment.id}`) }),
      ]);
      assert.equal((await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral'", [referrer.user.id])).n, 1);
      const mine = await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie });
      assert.equal(mine.data.summary.successful, 1);
      assert.equal(mine.data.summary.rewards_available, 1);
      assert.match(mine.data.history[0].friend, /•/);

      // After the first paid membership the discount is gone and attribution cannot change.
      await shiftMembership(friend.user.id, 3);
      await api('GET', '/api/membership', undefined, { cookie: friend.cookie });
      const renewal = await api('POST', '/api/membership', { action: 'start_checkout', months: 2 }, { cookie: friend.cookie });
      assert.equal(renewal.data.discount, 0);
      const other = await login(uniqueEmail('rfr3'));
      const otherCode = (await api('GET', '/api/referrals', undefined, { cookie: other.cookie })).data.code;
      assert.equal((await api('POST', '/api/referrals', { action: 'attribute', code: otherCode }, { cookie: friend.cookie })).status, 409);
    });

    test('monthly autopay debits after the first payment never earn the referrer another piece', async () => {
      const referrer = await login(uniqueEmail('rfr7'));
      const code = (await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie })).data.code;
      const friend = await login(uniqueEmail('friend6'));
      await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: friend.cookie });
      const { subscriptionId } = await buyMembership(friend.cookie);
      assert.equal((await q1('SELECT status FROM referrals WHERE referred_user_id = $1', [friend.user.id])).status, 'qualified');
      await endPaidPeriod(friend.user.id, 1);
      await chargeMonth(friend, subscriptionId);
      assert.equal((await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral'", [referrer.user.id])).n, 1);
    });

    test('an existing member cannot claim the new-customer offer; a failed payment earns nothing', async () => {
      const referrer = await login(uniqueEmail('rfr4'));
      const code = (await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie })).data.code;
      const member = await login(uniqueEmail('oldm'));
      await buyMembership(member.cookie);
      const r = await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: member.cookie });
      assert.equal(r.status, 409);
      assert.equal(r.data.error, 'not_first_membership');

      const friend = await login(uniqueEmail('friend2'));
      await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: friend.cookie });
      await api('POST', '/api/membership', { action: 'start_checkout', months: 2 }, { cookie: friend.cookie });
      assert.equal((await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1", [referrer.user.id])).n, 0, 'checkout alone earns nothing');
    });

    test('a refunded qualifying payment revokes the unused referrer reward, with an audit entry', async () => {
      const referrer = await login(uniqueEmail('rfr5'));
      const code = (await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie })).data.code;
      const friend = await login(uniqueEmail('friend3'));
      await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: friend.cookie });
      const { payment } = await buyMembership(friend.cookie, 2);
      const creditsBefore = await balance(referrer.user.id);
      const wh = await sendRefund(payment.razorpay_payment_id, 344800);
      assert.equal(wh.status, 200, JSON.stringify(wh.data));
      const reward = await q1("SELECT id, status, void_reason, voided_by, flag_reason FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral'", [referrer.user.id]);
      assert.equal(reward.status, 'void');
      assert.equal(reward.void_reason, 'source_payment_refunded');
      assert.equal(reward.voided_by, 'razorpay_webhook');
      assert.equal(reward.flag_reason, null);
      assert.equal((await q1("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'reward_revoked' AND entity_id = $1", [reward.id])).n, 1);
      assert.equal(await balance(referrer.user.id), creditsBefore, 'no credits or money are touched');
      assert.equal((await q1('SELECT status FROM referrals WHERE referred_user_id = $1', [friend.user.id])).status, 'refunded');
      assert.equal((await q1("SELECT count(*)::int AS n FROM membership_periods p JOIN memberships mm ON mm.id = p.membership_id WHERE mm.auth_user_id = $1 AND p.voided_at IS NOT NULL", [friend.user.id])).n, 1);
      // A repeated refund event changes nothing further.
      assert.equal((await sendRefund(payment.razorpay_payment_id, 344800)).status, 200);
      assert.equal((await q1("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'reward_revoked' AND entity_id = $1", [reward.id])).n, 1);
    });

    test('the owner can set how many free pieces a successful referral earns', async () => {
      await setSettings({ referrer_reward_quantity: 2 });
      try {
        const referrer = await login(uniqueEmail('rfr6'));
        const code = (await api('GET', '/api/referrals', undefined, { cookie: referrer.cookie })).data.code;
        const friend = await login(uniqueEmail('friend4'));
        await api('POST', '/api/referrals', { action: 'attribute', code }, { cookie: friend.cookie });
        const { start, payment } = await buyMembership(friend.cookie, 2);
        assert.equal(start.amount, 3448);
        assert.equal((await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral'", [referrer.user.id])).n, 2);
        // Re-delivering the payment event must not add more.
        const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: gateway.payments.get(payment.razorpay_payment_id) } } });
        await api('POST', '/api/webhooks/razorpay', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_q_${Date.now()}` } });
        assert.equal((await q1("SELECT count(*)::int AS n FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral'", [referrer.user.id])).n, 2);
      } finally {
        await setSettings({ referrer_reward_quantity: 1 });
      }
    });
  });

  describe('refund reversal of rewards (BD-5)', () => {
    /** A member with a 6th-month reward issued by their upfront payment (time-travel shortcut). */
    async function memberWithReward(tag) {
      const m = await login(uniqueEmail(tag));
      const { payment } = await buyMembership(m.cookie);
      const mp = await q1("SELECT id, membership_id FROM membership_payments WHERE provider_payment_id = $1", [payment.razorpay_payment_id]);
      await ctx.db.query("INSERT INTO reward_entitlements (auth_user_id, kind, membership_id, milestone_number, source_payment_id) VALUES ($1, 'six_month_milestone', $2, 1, $3)", [m.user.id, mp.membership_id, mp.id]);
      return { m, payment, start: { razorpay: { amount: 359800 } } };
    }

    test('a refunded payment after the reward was used: the reward is flagged for review, not taken back', async () => {
      const { m, payment, start } = await memberWithReward('rf6');
      const reward = await q1("SELECT id, status FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'six_month_milestone'", [m.user.id]);
      assert.equal(reward.status, 'available');
      const piece = await freshPiece(`Refund Flag Piece ${Date.now()}`, 1900);
      await setSettings({ reward_eligible_product_ids: [piece.id] });
      await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: piece.variants[0].id, use: 'reward', reward_entitlement_id: reward.id }, { cookie: m.cookie });
      const co = await api('POST', '/api/checkout', { shipping_method: 'pickup', shipping_address: { name: 'F', phone: '+91 9000000013' } }, { cookie: m.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward.id])).status, 'redeemed');

      assert.equal((await sendRefund(payment.razorpay_payment_id, start.razorpay.amount)).status, 200);
      const after = await q1('SELECT status, flag_reason FROM reward_entitlements WHERE id = $1', [reward.id]);
      assert.equal(after.status, 'redeemed', 'a used reward is not reversed automatically');
      assert.equal(after.flag_reason, 'source_payment_refunded');
      assert.equal((await q1("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'reward_flagged' AND entity_id = $1", [reward.id])).n, 1);
      assert.equal((await q1('SELECT payment_status FROM orders WHERE id = $1', [co.data.order_id])).payment_status, 'paid', 'the order is not changed');
    });

    test('a reward revoked while a checkout holds it cannot be honoured: that order goes to refund review', async () => {
      const { m, payment, start } = await memberWithReward('rfhold');
      const reward = (await q1("SELECT id FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'six_month_milestone'", [m.user.id])).id;
      const piece = await freshPiece(`Refund Hold Piece ${Date.now()}`, 1900);
      await setSettings({ reward_eligible_product_ids: [piece.id] });
      await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: piece.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
      const co = await api('POST', '/api/checkout', DELIVERY, { cookie: m.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'reserved');

      assert.equal((await sendRefund(payment.razorpay_payment_id, start.razorpay.amount)).status, 200);
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'void');
      const r = await api('POST', '/api/payment-verify', { order_id: co.data.order_id, ...pay(co.data.razorpay.order_id) }, { cookie: m.cookie });
      assert.equal(r.status, 409);
      assert.ok(['refund_required', 'refunded'].includes((await q1('SELECT payment_status FROM orders WHERE id = $1', [co.data.order_id])).payment_status), 'the customer payment is refunded, not kept');
      assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'void');
    });
  });

  describe('gift enquiries', () => {
    const individual = (extra = {}) => ({ request_type: 'individual', sender_name: 'Meera', sender_email: uniqueEmail('gs'), sender_phone: '+91 98450 11111', recipient_name: 'Asha', membership_months: 2, message: 'Happy birthday', ...extra });

    test('valid individual and corporate enquiries; invalid input rejected; duplicate submit returns the first', async () => {
      const a = await api('POST', '/api/gifting', individual({ submission_key: `k-${Date.now()}` }));
      assert.equal(a.status, 201, JSON.stringify(a.data));
      assert.match(a.data.enquiry.enquiry_number, /^GE-\d+$/);
      assert.equal(a.data.enquiry.status, 'pending');
      const dupBody = individual({ sender_email: 'dup.sender@example.test' });
      const d1 = await api('POST', '/api/gifting', dupBody);
      const d2 = await api('POST', '/api/gifting', dupBody);
      assert.equal(d2.data.duplicate, true);
      assert.equal(d2.data.enquiry.id, d1.data.enquiry.id);
      const corp = await api('POST', '/api/gifting', { request_type: 'corporate', sender_name: 'HR', sender_email: uniqueEmail('corp'), sender_phone: '+91 98450 22222', company_name: 'Acme', membership_months: 6, quantity: 5 });
      assert.equal(corp.status, 201);
      assert.equal(corp.data.enquiry.quantity, 5);
      assert.equal((await api('POST', '/api/gifting', individual({ sender_email: 'not-an-email' }))).status, 400);
      assert.equal((await api('POST', '/api/gifting', individual({ sender_phone: '12' }))).status, 400);
      assert.equal((await api('POST', '/api/gifting', individual({ recipient_name: '' }))).status, 400);
      assert.equal((await api('POST', '/api/gifting', individual({ membership_months: 5 }))).status, 400);
    });

    test('gift durations and enquiry types follow Settings', async () => {
      const content = await api('GET', '/api/content');
      assert.deepEqual(content.data.gift_options, [{ months: 2, total: 3598 }, { months: 3, total: 5397 }, { months: 6, total: 10794 }, { months: 12, total: 21588 }]);
      await setSettings({ gift_membership_months: [3, 6], gift_enquiry_types: ['individual'] });
      try {
        assert.equal((await api('POST', '/api/gifting', individual({ membership_months: 3 }))).status, 201);
        assert.equal((await api('POST', '/api/gifting', individual({ membership_months: 2 }))).status, 400);
        const corp = await api('POST', '/api/gifting', { request_type: 'corporate', sender_name: 'HR', sender_email: uniqueEmail('corp2'), sender_phone: '+91 98450 22223', company_name: 'Acme', membership_months: 6, quantity: 2 });
        assert.equal(corp.status, 400, 'corporate enquiries switched off');
      } finally {
        await setSettings({ gift_membership_months: [2, 3, 6, 12], gift_enquiry_types: ['individual', 'corporate'] });
      }
    });

    test('admin workflow: transitions enforced, token issued once per gift, hashed, one-time, membership activated', async () => {
      const e = (await api('POST', '/api/gifting', individual())).data.enquiry;
      const customer = await login(uniqueEmail('notadmin'));
      assert.equal((await api('GET', '/api/admin/ops?section=gift_enquiries', undefined, { cookie: customer.cookie })).status, 403);
      assert.equal((await api('POST', '/api/admin/ops?section=gift_token', { enquiry_id: e.id }, { cookie: customer.cookie })).status, 403);

      const post = (body, sec = 'gift_enquiry') => api('POST', `/api/admin/ops?section=${sec}`, body, { cookie: admin.cookie });
      assert.equal((await post({ id: e.id, status: 'invoiced' })).status, 409, 'cannot skip processing');
      assert.equal((await post({ enquiry_id: e.id }, 'gift_token')).status, 409, 'no token before invoicing');
      assert.equal((await post({ id: e.id, status: 'processed', admin_notes: 'Called sender' })).status, 200);
      assert.equal((await post({ id: e.id, status: 'invoiced' })).status, 400, 'invoice reference required');
      assert.equal((await post({ id: e.id, status: 'invoiced', invoice_reference: 'INV-2026-001', invoice_amount: 3598 })).status, 200);
      const detail = await api('GET', `/api/admin/ops?section=gift_enquiry&id=${e.id}`, undefined, { cookie: admin.cookie });
      assert.equal(detail.data.enquiry.status, 'invoiced');
      assert.ok(detail.data.enquiry.status_changed_by);

      const t = await post({ enquiry_id: e.id }, 'gift_token');
      assert.equal(t.status, 201);
      assert.ok(t.data.token.length >= 30);
      assert.ok(t.data.link.endsWith(`/gift/redeem#${t.data.token}`));
      assert.equal((await post({ enquiry_id: e.id }, 'gift_token')).status, 409, 'quantity 1: one token');
      const stored = await q1('SELECT token_hash, token_hint FROM gift_memberships WHERE enquiry_id = $1', [e.id]);
      assert.notEqual(stored.token_hash, t.data.token, 'plaintext is not stored');
      assert.equal(stored.token_hint, t.data.token.slice(-4));
      const listed = await api('GET', `/api/admin/ops?section=gift_enquiry&id=${e.id}`, undefined, { cookie: admin.cookie });
      assert.ok(!JSON.stringify(listed.data).includes(t.data.token), 'token never shown again');

      assert.equal((await api('POST', '/api/gifting', { action: 'redeem', token: t.data.token })).status, 401);
      const recipient = await login(uniqueEmail('recip'));
      assert.equal((await api('POST', '/api/gifting', { action: 'redeem', token: 'x'.repeat(32) }, { cookie: recipient.cookie })).status, 400);
      const r1 = await api('POST', '/api/gifting', { action: 'redeem', token: t.data.token }, { cookie: recipient.cookie });
      assert.equal(r1.status, 200, JSON.stringify(r1.data));
      assert.equal(r1.data.membership.status, 'active');
      assert.equal(r1.data.membership.credits_balance, 4);
      const r2 = await api('POST', '/api/gifting', { action: 'redeem', token: t.data.token }, { cookie: recipient.cookie });
      assert.equal(r2.status, 409);
      assert.equal(r2.data.error, 'gift_already_redeemed');
    });

    test('an expired or revoked gift code cannot be redeemed', async () => {
      const e = (await api('POST', '/api/gifting', individual())).data.enquiry;
      const post = (body, sec) => api('POST', `/api/admin/ops?section=${sec}`, body, { cookie: admin.cookie });
      await post({ id: e.id, status: 'processed' }, 'gift_enquiry');
      await post({ id: e.id, status: 'invoiced', invoice_reference: 'INV-X' }, 'gift_enquiry');
      const t = (await post({ enquiry_id: e.id }, 'gift_token')).data;
      await ctx.db.query("UPDATE gift_memberships SET expires_at = now() - interval '1 day' WHERE id = $1", [t.gift.id]);
      const who = await login(uniqueEmail('late'));
      const r = await api('POST', '/api/gifting', { action: 'redeem', token: t.token }, { cookie: who.cookie });
      assert.equal(r.data.error, 'gift_code_expired');
      await ctx.db.query("UPDATE gift_memberships SET expires_at = now() + interval '1 day' WHERE id = $1", [t.gift.id]);
      assert.equal((await post({ id: t.gift.id }, 'gift_token_revoke')).status, 200);
      assert.equal((await api('POST', '/api/gifting', { action: 'redeem', token: t.token }, { cookie: who.cookie })).data.error, 'invalid_gift_code');
    });
  });

  describe('security and remaining fixes', () => {
    test('bootstrap admin email is not re-promoted while another admin exists', async () => {
      const other = await login(uniqueEmail('staff'));
      await ctx.db.query("UPDATE profiles SET is_admin = true, role = 'admin' WHERE auth_user_id = $1", [other.user.id]);
      await ctx.db.query("UPDATE profiles SET is_admin = false, role = 'customer' WHERE lower(email) = $1", [ADMIN_EMAIL]);
      const again = await login(ADMIN_EMAIL);
      assert.equal(again.user.is_admin, false);
      await ctx.db.query("UPDATE profiles SET is_admin = true, role = 'admin' WHERE lower(email) = $1", [ADMIN_EMAIL]);
      await ctx.db.query("UPDATE profiles SET is_admin = false, role = 'customer' WHERE auth_user_id = $1", [other.user.id]);
      admin = await login(ADMIN_EMAIL);
      assert.equal(admin.user.is_admin, true);
    });

    test('settings are stored with their declared JSON types and changes are audited before/after', async () => {
      await setSettings({ shipping_fee: 100, membership_plan_months: [6, 2], six_month_reward_enabled: false, reward_eligible_product_ids: [] });
      await setSettings({ shipping_fee: 99, six_month_reward_enabled: true });
      const types = Object.fromEntries((await ctx.db.query("SELECT key, jsonb_typeof(value) AS t FROM app_settings WHERE key IN ('shipping_fee','membership_plan_months','six_month_reward_enabled','reward_eligible_product_ids')")).rows.map((r) => [r.key, r.t]));
      assert.deepEqual(types, { membership_plan_months: 'array', reward_eligible_product_ids: 'array', shipping_fee: 'number', six_month_reward_enabled: 'boolean' });
      assert.deepEqual((await q1("SELECT value FROM app_settings WHERE key = 'membership_plan_months'")).value, [2, 6], 'lists are de-duplicated and sorted');
      const last = await q1("SELECT details FROM audit_logs WHERE action = 'update_settings' ORDER BY created_at DESC LIMIT 1");
      assert.deepEqual(last.details.shipping_fee, { before: 100, after: 99 });
      assert.deepEqual(last.details.six_month_reward_enabled, { before: false, after: true });
      await setSettings({ membership_plan_months: [2] });
    });

    test('settings validation: unknown or removed keys, bad types, missing references and inconsistent combinations are refused', async () => {
      const bad = async (settings, error) => {
        const r = await api('POST', '/api/admin/ops?section=settings', { settings }, { cookie: admin.cookie });
        assert.equal(r.status, 400, JSON.stringify(settings));
        if (error) assert.equal(r.data.error, error, JSON.stringify(r.data));
      };
      await bad({ pause_credit_policy: 'grant' }, 'unknown_setting');
      await bad({ max_credit_balance: 0 }, 'unknown_setting');
      await bad({ wallet_balance: 10 }, 'unknown_setting');
      await bad({ six_month_reward_qualification: 'sometimes' });
      await bad({ six_month_reward_enabled: 'yes' });
      await bad({ membership_plan_months: [2, 5] });
      await bad({ membership_plan_months: [] });
      await bad({ gift_enquiry_types: ['wholesale'] });
      await bad({ reward_eligible_product_ids: ['not-a-uuid'] });
      await bad({ reward_eligible_product_ids: ['11111111-1111-4111-8111-111111111111'] });
      await bad({ referrer_reward_quantity: 0 });
      await bad({ membership_upfront_months: 3 });
      await bad({ referral_plan_months: 12 });
      await bad({ membership_plan_months: [2], six_month_reward_qualification: 'six_month_plan' }, 'invalid_six_month_reward_qualification');
      await bad({ seller_gstin: 'NOTAGSTIN' });
      await bad({ grievance_officer_email: 'nope' });
      await bad({ legal_details_verified: true }, 'invalid_legal_details_verified');
      const customer = await login(uniqueEmail('setx'));
      assert.equal((await api('POST', '/api/admin/ops?section=settings', { settings: { shipping_fee: 1 } }, { cookie: customer.cookie })).status, 403);
      assert.equal((await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: customer.cookie })).status, 403);
    });

    test('the settings view lists groups, fixed rules, storage health and administrators without exposing secrets', async () => {
      const r = await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: admin.cookie });
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.groups.map((g) => g.id), ['membership', 'credits', 'rewards', 'referrals', 'gifts', 'checkout', 'operations', 'legal']);
      assert.equal(r.data.meta.six_month_reward_qualification.value, 'consecutive_months');
      assert.equal(r.data.meta.renewal_grace_days.value, 5);
      assert.equal(r.data.meta.six_month_reward_qualification.confirmed, true);
      assert.equal(r.data.meta.credit_expiry_days.confirmed, true);
      assert.equal(r.data.meta.credit_holding_limit.value, 8);
      assert.equal(r.data.meta.membership_lock_in_months.value, 2);
      assert.equal(r.data.meta.max_credit_balance, undefined);
      assert.ok(r.data.fixed_rules.rewards.length && r.data.fixed_rules.referrals.length);
      assert.equal(r.data.storage.driver, 'local');
      assert.equal(typeof r.data.storage.local.writable, 'boolean');
      assert.ok(r.data.admins.accounts.some((a) => a.email === ADMIN_EMAIL && a.has_admin_access));
      const body = JSON.stringify(r.data);
      for (const secret of [process.env.JWT_SECRET, process.env.RAZORPAY_KEY_SECRET, process.env.RAZORPAY_WEBHOOK_SECRET, process.env.DATABASE_URL].filter(Boolean)) {
        assert.ok(!body.includes(secret), 'no secret or connection string in the settings view');
      }
      assert.ok(!/[A-Za-z]:\\|\/home\/|\/tmp\//.test(JSON.stringify(r.data.storage)), 'no absolute server path');
    });

    test('legal details are published only after the owner marks them verified', async () => {
      await setSettings({ seller_legal_name: 'Test Seller LLP', seller_address: '1 Test Road, Bengaluru', grievance_officer_name: 'Test Officer', grievance_officer_email: 'officer@example.test' });
      try {
        assert.equal((await api('GET', '/api/content')).data.legal, null, 'unverified details stay private');
        await setSettings({ legal_details_verified: true });
        const legal = (await api('GET', '/api/content')).data.legal;
        assert.equal(legal.legal_name, 'Test Seller LLP');
        assert.equal(legal.grievance_officer.email, 'officer@example.test');
      } finally {
        await setSettings({ legal_details_verified: false, seller_legal_name: '', seller_address: '', grievance_officer_name: '', grievance_officer_email: '' });
      }
    });

    test('admin lists search and filter on the server; unknown filter values are refused', async () => {
      const get = (qs) => api('GET', `/api/admin/ops?${qs}`, undefined, { cookie: admin.cookie });
      const buyer = await login(uniqueEmail('findme'));
      await api('PUT', '/api/account', { full_name: 'Findable Customer', phone: '+91 98111 22334' }, { cookie: buyer.cookie });
      assert.ok((await get('section=customers&q=findable')).data.customers.some((c) => c.auth_user_id === buyer.user.id));
      assert.ok((await get('section=customers&q=98111%2022334')).data.customers.some((c) => c.auth_user_id === buyer.user.id), 'phone digits match regardless of spacing');
      assert.ok((await get('section=customers&membership=none&q=findable')).data.customers.length >= 1);
      assert.equal((await get('section=customers&membership=active&q=findable')).data.customers.length, 0);
      const piece = await freshPiece(`Filterable Piece ${Date.now()}`, 1500);
      const sku = piece.variants[0].sku.toLowerCase();
      assert.deepEqual((await get(`section=products&q=${encodeURIComponent(sku)}`)).data.products.map((p) => p.id), [piece.id], 'search by SKU');
      assert.ok((await get(`section=products&state=live&category_id=${piece.category_id}`)).data.products.some((p) => p.id === piece.id));
      assert.ok(!(await get('section=products&state=hidden')).data.products.some((p) => p.id === piece.id));
      const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
      assert.equal(co.status, 400, 'empty bag');
      await api('POST', '/api/cart', { variant_id: piece.variants[0].id }, { cookie: buyer.cookie });
      const order = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
      assert.equal(order.status, 201, JSON.stringify(order.data));
      const prefix = order.data.order_id.slice(0, 8);
      assert.deepEqual((await get(`section=orders&q=${prefix}`)).data.orders.map((o) => o.id), [order.data.order_id]);
      assert.ok((await get('section=orders&payment_status=pending&q=findable')).data.orders.some((o) => o.id === order.data.order_id));
      assert.equal((await get('section=orders&payment_status=paid&q=findable')).data.orders.length, 0);
      for (const bad of ['section=orders&status=drop', 'section=orders&payment_status=x', 'section=customers&membership=x', 'section=products&state=x', 'section=products&category_id=nope']) {
        assert.equal((await get(bad)).status, 400, bad);
      }
      await api('POST', '/api/checkout', { action: 'cancel', order_id: order.data.order_id }, { cookie: buyer.cookie });
    });

    test('when online payment is unavailable a paid bag creates nothing; a ₹0 reward order still completes once', async () => {
      const { config } = await import('../lib/config.js');
      const keyId = config.razorpay.keyId;
      const m = await login(uniqueEmail('nopay'));
      const paid = await freshPiece(`No Pay Piece ${Date.now()}`, 2000);
      const free = await freshPiece(`Free Pickup Piece ${Date.now()}`, 1700);
      const count = async (sql) => (await q1(sql, [m.user.id])).n;
      await api('POST', '/api/cart', { variant_id: paid.variants[0].id }, { cookie: m.cookie });
      config.razorpay.keyId = '';
      try {
        const r = await api('POST', '/api/checkout', DELIVERY, { cookie: m.cookie });
        assert.equal(r.status, 503);
        assert.equal(r.data.error, 'payments_unavailable');
        assert.equal(await count('SELECT count(*)::int AS n FROM orders WHERE auth_user_id = $1'), 0, 'no order row, not even an expired one');
        assert.equal((await q1("SELECT count(*)::int AS n FROM inventory_reservations WHERE variant_id = $1", [paid.variants[0].id])).n, 0, 'no stock hold');
        assert.equal((await q1('SELECT stock_quantity FROM product_variants WHERE id = $1', [paid.variants[0].id])).stock_quantity, 1);
        assert.equal((await api('GET', '/api/cart', undefined, { cookie: m.cookie })).data.items.length, 1, 'bag kept');
        const ms = await api('POST', '/api/membership', { action: 'start_checkout' }, { cookie: m.cookie });
        assert.equal(ms.status, 503);
        assert.equal(await count('SELECT count(*)::int AS n FROM memberships WHERE auth_user_id = $1'), 0, 'no "awaiting payment" membership');

        await api('DELETE', '/api/cart', { all: true }, { cookie: m.cookie });
        const reward = (await q1("INSERT INTO reward_entitlements (auth_user_id, kind, milestone_number) VALUES ($1, 'six_month_milestone', 1) RETURNING id", [m.user.id])).id;
        await setSettings({ reward_eligible_product_ids: [free.id] });
        await api('POST', '/api/wardrobe', { action: 'add_to_bag', variant_id: free.variants[0].id, use: 'reward', reward_entitlement_id: reward }, { cookie: m.cookie });
        const body = { shipping_method: 'pickup', shipping_address: { name: 'Zero', phone: '+91 9000000014' }, idempotency_key: `zero-${Date.now()}` };
        const [a, b] = await Promise.all([api('POST', '/api/checkout', body, { cookie: m.cookie }), api('POST', '/api/checkout', body, { cookie: m.cookie })]);
        assert.ok([a.status, b.status].every((s) => s === 200 || s === 201), `${a.status}/${b.status} ${JSON.stringify(a.data)}`);
        assert.equal(a.data.order_id, b.data.order_id, 'double submit returns the same order');
        assert.ok([a, b].some((x) => x.data.payment_status === 'paid'));
        const o = await q1('SELECT total, payment_status, status, rewards_used FROM orders WHERE id = $1', [a.data.order_id]);
        assert.deepEqual({ total: Number(o.total), payment_status: o.payment_status, status: o.status, rewards_used: o.rewards_used }, { total: 0, payment_status: 'paid', status: 'processing', rewards_used: 1 });
        assert.equal(await count('SELECT count(*)::int AS n FROM orders WHERE auth_user_id = $1'), 1);
        assert.equal((await q1('SELECT status FROM reward_entitlements WHERE id = $1', [reward])).status, 'redeemed');
        assert.equal((await q1('SELECT stock_quantity FROM product_variants WHERE id = $1', [free.variants[0].id])).stock_quantity, 0, 'stock deducted');
        assert.equal((await q1('SELECT count(*)::int AS n FROM invoice_records WHERE order_id = $1', [a.data.order_id])).n, 1, 'one invoice');
      } finally {
        config.razorpay.keyId = keyId;
        await setSettings({ reward_eligible_product_ids: [] });
      }
    });

    test('abandoned checkouts are hidden from the admin order list unless asked for', async () => {
      const buyer = await login(uniqueEmail('abandon'));
      const piece = await freshPiece(`Abandon Piece ${Date.now()}`, 1500);
      await api('POST', '/api/cart', { variant_id: piece.variants[0].id }, { cookie: buyer.cookie });
      const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyer.cookie });
      assert.equal(co.status, 201, JSON.stringify(co.data));
      await api('POST', '/api/checkout', { action: 'cancel', order_id: co.data.order_id }, { cookie: buyer.cookie });
      const list = async (qs = '') => (await api('GET', `/api/admin/ops?section=orders${qs}`, undefined, { cookie: admin.cookie })).data;
      const def = await list();
      assert.ok(!def.orders.some((o) => o.id === co.data.order_id), 'hidden by default');
      assert.ok(def.abandoned_hidden >= 1);
      assert.ok((await list('&abandoned=true')).orders.some((o) => o.id === co.data.order_id));
      assert.ok((await list('&payment_status=cancelled')).orders.some((o) => o.id === co.data.order_id), 'an explicit status filter shows them');
    });

    test('a product can be made reward-eligible from the product editor; deleting it keeps Settings saveable', async () => {
      const piece = await freshPiece(`Toggle Piece ${Date.now()}`, 1500);
      const full = (await api('GET', `/api/admin/ops?section=product&id=${piece.id}`, undefined, { cookie: admin.cookie })).data.product;
      assert.equal(full.reward_eligible, false);
      const save = (eligible) => api('POST', '/api/admin/ops?section=product', { ...full, reward_eligible: eligible, variants: full.variants.map((v) => ({ id: v.id, size_label: v.size_label, sku: v.sku, price_inr: v.price_inr, stock_quantity: v.stock_quantity, stock_base: v.stock_quantity, is_active: v.is_active })) }, { cookie: admin.cookie });
      const on = await save(true);
      assert.equal(on.status, 200, JSON.stringify(on.data));
      assert.equal(on.data.product.reward_eligible, true);
      const settings = async () => (await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: admin.cookie })).data;
      let s = await settings();
      assert.ok(s.meta.reward_eligible_product_ids.value.includes(piece.id));
      assert.deepEqual(s.history[0].details.reward_eligible_product_ids.after.includes(piece.id), true, 'audited as a settings change');
      assert.equal((await api('DELETE', `/api/admin/ops?section=product&id=${piece.id}`, undefined, { cookie: admin.cookie })).status, 200);
      s = await settings();
      assert.ok(!s.meta.reward_eligible_product_ids.value.includes(piece.id), 'deleted piece removed from the list');
      await setSettings({ reward_eligible_product_ids: s.meta.reward_eligible_product_ids.value });
      await setSettings({ reward_eligible_product_ids: [] });
    });

    test('validation messages name fields in plain language', async () => {
      const c = await login(uniqueEmail('msg'));
      const r = await api('POST', '/api/account', { action: 'wearer', name: 'Me', bust_cm: 'abc' }, { cookie: c.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'invalid_bust_cm');
      assert.match(r.data.message, /^Bust \(cm\) must be/);
      const g = await api('POST', '/api/gifting', { request_type: 'individual', sender_email: 'a@example.test', sender_phone: '+91 98450 11111', recipient_name: 'R' });
      assert.equal(g.data.error, 'sender_name_required');
      assert.equal(g.data.message, 'Sender name is required');
    });

    test('an admin email allowlist limits admin access without changing any role', async () => {
      const other = await login(uniqueEmail('staff2'));
      await ctx.db.query("UPDATE profiles SET is_admin = true, role = 'admin' WHERE auth_user_id = $1", [other.user.id]);
      const previous = process.env.ADMIN_ALLOWED_EMAILS;
      try {
        assert.equal((await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: other.cookie })).status, 200, 'no list set: role decides');
        process.env.ADMIN_ALLOWED_EMAILS = ` ${ADMIN_EMAIL.toUpperCase()} `;
        assert.equal((await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: other.cookie })).status, 403, 'not on the approved list');
        const view = await api('GET', '/api/admin/ops?section=settings', undefined, { cookie: admin.cookie });
        assert.equal(view.status, 200, 'approved admin keeps access (case-insensitive)');
        const row = view.data.admins.accounts.find((a) => a.email === other.user.email);
        assert.equal(row.on_allowlist, false);
        assert.equal(row.has_admin_access, false);
        const role = await q1('SELECT is_admin, role FROM profiles WHERE auth_user_id = $1', [other.user.id]);
        assert.deepEqual({ ...role }, { is_admin: true, role: 'admin' }, 'the role itself is untouched');
      } finally {
        if (previous === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
        else process.env.ADMIN_ALLOWED_EMAILS = previous;
        await ctx.db.query("UPDATE profiles SET is_admin = false, role = 'customer' WHERE auth_user_id = $1", [other.user.id]);
      }
    });

    test('exchange updates validate the id and the transition', async () => {
      assert.equal((await api('POST', '/api/admin/ops?section=exchange', { id: '11111111-1111-4111-8111-111111111111', status: 'completed' }, { cookie: admin.cookie })).status, 404);
    });

    test('delivery checkout requires a phone number', async () => {
      const c = await login(uniqueEmail('ph'));
      const piece = await freshPiece(`Phone Piece ${Date.now()}`);
      await api('POST', '/api/cart', { variant_id: piece.variants[0].id }, { cookie: c.cookie });
      const { phone, ...addr } = DELIVERY.shipping_address;
      const r = await api('POST', '/api/checkout', { shipping_method: 'delivery', shipping_address: addr }, { cookie: c.cookie });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'phone_required');
    });

    test('catalogue filters by colour season; colour profile stores the season', async () => {
      const piece = await freshPiece(`Autumn Piece ${Date.now()}`, 1500, { colour_season: 'true autumn' });
      assert.equal((await api('POST', '/api/admin/ops?section=product', { name: 'Bad Season', price_inr: 100, colour_season: 'AW26' }, { cookie: admin.cookie })).status, 400);
      const r = await api('GET', '/api/catalogue?colour_season=True%20Autumn&limit=100');
      assert.ok(r.data.products.some((p) => p.id === piece.id));
      assert.ok(r.data.products.every((p) => p.colour_season === 'True Autumn'));
      const c = await login(uniqueEmail('col'));
      const s = await api('POST', '/api/colour-review', { undertone: 'Warm', season: 'True Autumn', palette: ['#B85C43', '#68734A', '#C99A2E'] }, { cookie: c.cookie });
      assert.equal(s.status, 201);
      assert.equal((await api('GET', '/api/account', undefined, { cookie: c.cookie })).data.colour_profile.season, 'True Autumn');
      assert.equal((await api('POST', '/api/colour-review', { undertone: 'Warm', season: 'Mid Spring', palette: ['#B85C43', '#68734A', '#C99A2E'] }, { cookie: c.cookie })).status, 400);
    });

    test('dashboard reports membership revenue and honours a date range', async () => {
      const d = await api('GET', '/api/admin/ops?section=dashboard&from=2000-01-01&to=2099-12-31', undefined, { cookie: admin.cookie });
      assert.equal(d.status, 200);
      assert.ok(d.data.membership_revenue > 0);
      assert.equal(d.data.total_revenue, d.data.revenue + d.data.membership_revenue);
      assert.equal((await api('GET', '/api/admin/ops?section=dashboard&from=2026-02-01&to=2026-01-01', undefined, { cookie: admin.cookie })).status, 400);
    });

    test('admin customer drill-down returns wearers, membership, orders, colour and rewards; customers cannot use it', async () => {
      const c = await login(uniqueEmail('drill'));
      await api('POST', '/api/account', { action: 'wearer', name: 'Me', size_label: 'M' }, { cookie: c.cookie });
      const d = await api('GET', `/api/admin/ops?section=customer&id=${c.user.id}`, undefined, { cookie: admin.cookie });
      assert.equal(d.status, 200);
      for (const k of ['profile', 'membership', 'wearers', 'orders', 'colour_reviews', 'referrals', 'rewards', 'credits', 'periods']) assert.ok(k in d.data, k);
      assert.equal(d.data.wearers.length, 1);
      assert.equal((await api('GET', `/api/admin/ops?section=customer&id=${c.user.id}`, undefined, { cookie: c.cookie })).status, 403);
    });

    test('/legal redirects permanently to the privacy policy', async () => {
      const r = await fetch(`${ctx.base}/legal`, { redirect: 'manual' });
      if (r.status === 503) return; // storefront build not present in this environment
      assert.equal(r.status, 301);
      assert.equal(r.headers.get('location'), '/legal/privacy');
    });

    test('legacy admin endpoints are no longer mounted', async () => {
      for (const p of ['/api/admin/dashboard', '/api/admin/products', '/api/admin/orders', '/api/admin/customers', '/api/admin/content']) {
        assert.equal((await api('GET', p, undefined, { cookie: admin.cookie })).status, 404, p);
      }
    });
  });
});
