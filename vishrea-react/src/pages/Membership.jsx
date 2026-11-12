import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { InlineMessage } from '../components/Status';
import { api, formatINR } from '../lib/api';
import { openRazorpay } from '../lib/payments';
import { useApi, useMutation } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { faqSchema } from '../lib/schema';
import { MANDATE_COPY } from '../lib/customerCopy';
import { absoluteUrl } from '../site.config.js';
import { MEMBERSHIP_FAQS } from '../content/faqs';
import { Faq } from '../components/Faq';

const FALLBACK_PLANS = [
  { months: 2, monthly_price: 1799, list_total: 3598, discount: 0, total: 3598, credits_total: 8, offer: 'Stay 6 months in a row — your 6th month brings 1 free piece' },
];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
const STATUS_COPY = { active: 'Active', paused: 'Paused', expired: 'Ended', cancelled: 'Cancelled', pending_payment: 'Awaiting payment', inactive: 'Not a member yet', payment_failed: 'Payment failed' };
const EVENT_COPY = {
  mandate_requested: 'Autopay set-up started', activated: 'Membership started', renewed: 'Monthly payment received', payment_retrying: 'Payment failed — retrying',
  payment_recovered: 'Payment recovered', paused_payment_failed: 'Paused after failed payments', recovery_requested: 'Autopay restart started', recovered: 'Autopay restarted',
  pause_scheduled: 'Pause scheduled', paused: 'Paused', resumed: 'Resumed', pause_cancelled: 'Pause cancelled', cancelled: 'Cancelled', mandate_completed: 'Autopay mandate ended',
};

const MshipButton = ({ children, ...props }) => (
  <button type="button" className="mship-button" {...props}>
    {children}
  </button>
);

/** Open the gateway, then let the server confirm the payment with Razorpay before anything is issued. */
async function payAndConfirm(start, description) {
  if (start.razorpay?.checkout_mode === 'local') {
    const err = new Error('local');
    err.localCheckout = start;
    throw err;
  }
  const resp = await openRazorpay(start.razorpay, { description }).catch((err) => {
    err.beforePayment = true;
    throw err;
  });
  return api('/api/membership', { method: 'POST', body: { action: 'activate_paid', ...resp }, timeoutMs: 30000 });
}

export const Membership = () => {
  const { user, referral } = useStore();
  const navigate = useNavigate();
  const { data, reload, setData } = useApi('/api/membership', { enabled: Boolean(user) });
  const publicPricing = useApi('/api/content', { enabled: !user, maxAge: 60_000 });
  const membership = data?.membership || { status: 'inactive', credits_balance: 0 };
  const billing = data?.billing || null;
  const plans = data?.pricing?.plans || publicPricing.data?.membership_plans || FALLBACK_PLANS;
  const plan = plans[0];
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [localPay, setLocalPay] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const renewal = data?.renewal || { can_purchase: true, reason: 'new' };
  const milestone = data?.milestone;
  const rewards = (data?.rewards || []).filter((r) => r.status !== 'void');
  const upfrontMonths = plan?.months || 2;
  const monthly = plan?.monthly_price || 1799;

  usePageSeo({ breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Membership', url: '/membership' }], schema: faqSchema(absoluteUrl('/membership'), MEMBERSHIP_FAQS) });

  const action = useMutation(async (name) => {
    setMsg({ tone: 'info', text: '' });
    if (name === 'activate' || name === 'recover') {
      if (!user) {
        navigate('/login?next=/membership');
        return;
      }
      const start = await api('/api/membership', { method: 'POST', body: name === 'recover' ? { action: 'recover' } : { action: 'start_checkout', months: upfrontMonths } });
      let d;
      try {
        d = await payAndConfirm(start, start.razorpay.description);
      } catch (err) {
        if (err.localCheckout) {
          setLocalPay(err.localCheckout);
          setMsg({ tone: 'info', text: 'This checkout uses the local payment stand-in. No bank is charged. Confirm or cancel below.' });
          return;
        }
        if (err.dismissed) {
          setMsg({ tone: err.failed ? 'error' : 'info', text: err.failed ? `${err.message} Nothing was activated. You can try again.` : 'Autopay was not set up. You can start again any time.' });
          return;
        }
        if (!err.beforePayment && (!err.status || err.status >= 500)) {
          setMsg({ tone: 'info', text: 'Your payment is being confirmed with the bank. Refresh this page in a moment — you will not be charged twice.' });
          reload();
          return;
        }
        throw err;
      }
      setData(d);
      setMsg({
        tone: 'success',
        text: name === 'recover'
          ? 'Your membership is active again.'
          : `Welcome to the Walkin Wardrobe. ${d.membership.credits_balance} credits are ready; monthly autopay of ${formatINR(monthly)} starts on ${fmtDate(d.billing?.next_charge_at)}.`,
      });
      return;
    }
    if (name === 'local_pay' || name === 'local_fail') {
      const sub = localPay?.razorpay?.subscription_id;
      setLocalPay(null);
      if (!sub) return;
      const d = await api('/api/membership', { method: 'POST', body: { action: 'complete_local_checkout', razorpay_subscription_id: sub, outcome: name === 'local_fail' ? 'failed' : 'captured' }, timeoutMs: 30000 });
      setData(d);
      setMsg({ tone: 'success', text: `Welcome to the Walkin Wardrobe. ${d.membership.credits_balance} credits are ready.` });
      return;
    }
    if (name === 'local_cancel') {
      setLocalPay(null);
      setMsg({ tone: 'info', text: 'Payment was not completed. Nothing was activated. You can try again.' });
      return;
    }
    const body = { action: name };
    const d = await api('/api/membership', { method: 'POST', body });
    setData(d);
    setConfirmCancel(false);
    setMsg({
      tone: 'success',
      text: name === 'pause'
        ? `Pause scheduled from ${fmtDate(d.billing?.pause?.starts_at)} to ${fmtDate(d.billing?.pause?.ends_at)}. No charge and no new credits while paused.`
        : name === 'resume' ? 'Membership resumed.' : 'Membership cancelled. Pieces in your Wardrobe Bag will still ship.',
    });
  });
  const handleAction = (name) => action.run(name).catch((err) => { setMsg({ tone: 'error', text: err.message }); reload(); });

  const isActive = membership.status === 'active';
  const isPaused = membership.status === 'paused';
  const running = isActive || isPaused;
  const canBuy = !user || renewal.can_purchase;
  const ctaLabel = action.pending
    ? 'Opening payment…'
    : !user
      ? 'Sign in to join'
      : `${membership.status === 'expired' || membership.status === 'cancelled' ? 'Rejoin' : 'Join'} for ${formatINR(plan?.total)}`;
  const credits = data?.credits?.available ?? membership.credits_balance ?? 0;
  const offerText = plan.offer ? plan.offer.replace(/\s+—\s+/g, ': ') : null;
  const included = [
    ['Four credits a month', 'Each credit is good for one piece from the shared rail, whatever its price. New credits arrive at the start of every paid month and last 60 days, so you never hold more than 8. Premium pieces aren’t available on credits.'],
    ['First look at new drops', 'You can shop every new drop, Premium pieces included, 48 hours before anyone else.'],
    ['Your Wardrobe Bag', 'Pieces you pick with credits are yours straight away and wait in your Wardrobe Bag. Ship 4 or more together for free, or fewer for ₹99. Collecting from the studio is always free.'],
    ['A free piece in month six', 'Pay for five months in a row and your sixth month comes with one free piece. It repeats every six months. A pause or a missed payment restarts the count.'],
    ['How billing works', `You pay for the first ${upfrontMonths} months when you join, then ${formatINR(monthly)} a month by UPI Autopay. If a payment fails we try again 3 times over 5 days and hold your credits until it goes through. If every try fails, your membership is paused, not cancelled.`],
    ['Pausing and cancelling', `You can pause for a month once every six months, with no charge and no new credits while you’re away. You can cancel any time after the first ${upfrontMonths} months; unused credits lapse.`],
  ];

  return (
    <div className="mship-page">
      <Header />
      <main id="main-content">
        <section className="mship-section mship-top">
          <div className="mship-hero">
            <div className="mship-intro">
              <p className="mship-kicker">Membership</p>
              <h1 className="mship-title">The Walkin Wardrobe</h1>
              <p className="mship-lead">
                Four credits a month, each one good for a piece from the shared rail, and first look at every new drop.
              </p>
              <p className="mship-body">
                It’s {formatINR(monthly)} a month including GST. You pay for the first {upfrontMonths} months when you join; after that it’s taken monthly by UPI Autopay.
                You can cancel any time after the first {upfrontMonths} months.
              </p>
              <dl className="mship-facts">
                <div><dt>Credits</dt><dd>4 every paid month</dd></div>
                <div><dt>New drops</dt><dd>48 hours early</dd></div>
                <div><dt>Shipping</dt><dd>Free on 4 or more pieces</dd></div>
              </dl>
            </div>

            <aside className="mship-card" aria-labelledby="mship-card-title">
              {running ? (
                <>
                  <h2 className="mship-card-title" id="mship-card-title">Your membership</h2>
                  <dl className="mship-receipt">
                    <div><dt>Status</dt><dd className={isActive ? 'is-good' : ''}>{STATUS_COPY[membership.status] || membership.status}</dd></div>
                    <div><dt>Credits</dt><dd>{credits} available{billing?.credits_frozen ? ' (on hold)' : ''}</dd></div>
                    {billing?.mandate_status && <div><dt>Autopay</dt><dd>{MANDATE_COPY[billing.mandate_status] || billing.mandate_status}</dd></div>}
                    {billing?.next_charge_at && <div><dt>Next payment</dt><dd>{formatINR(billing.monthly_amount)} on {fmtDate(billing.next_charge_at)}</dd></div>}
                  </dl>
                  {!billing?.recovery_available && <Link className="mship-button" to="/wardrobe">Use your credits</Link>}
                </>
              ) : (
                <>
                  <h2 className="mship-card-title" id="mship-card-title">{membership.status === 'expired' || membership.status === 'cancelled' ? 'Rejoin' : 'Join today'}</h2>
                  <dl className="mship-receipt">
                    <div>
                      <dt>First {upfrontMonths} months<small>{plan.credits_total} credits</small></dt>
                      <dd>{plan.discount > 0 && <s>{formatINR(plan.list_total)}</s>} {formatINR(plan.total)}</dd>
                    </div>
                    {plan.discount > 0 && <div className="is-discount"><dt>Referral discount</dt><dd>−{formatINR(plan.discount)}</dd></div>}
                    <div>
                      <dt>Then each month<small>by UPI Autopay from month {upfrontMonths + 1}</small></dt>
                      <dd>{formatINR(monthly)}</dd>
                    </div>
                  </dl>
                  {offerText && <p className="mship-note">{offerText}</p>}
                  {referral && !user && <p className="mship-note">Your referral code {referral.code} takes ₹{referral.offer?.discount_inr} off your first {referral.offer?.plan_months || 2} months once you sign in.</p>}
                  {renewal.keeps_consecutive_until && <p className="mship-note">Rejoin by {fmtDate(renewal.keeps_consecutive_until)} to keep your months counting towards the free sixth-month piece.</p>}
                  {user && membership.status !== 'inactive' && <p className="mship-note">Current status: {STATUS_COPY[membership.status] || membership.status}</p>}
                </>
              )}
              {billing?.retrying && (
                <InlineMessage tone="error">
                  Your last autopay payment didn’t go through. We’ll try again {billing.retry_policy.retries} times over {billing.retry_policy.days} days, and your credits are on hold until it does.
                </InlineMessage>
              )}
              {billing?.recovery_available ? (
                <>
                  <p className="mship-note">Your membership is paused because the autopay payments failed. Set up UPI Autopay again to restart it; the first month ({formatINR(monthly)}) is charged now.</p>
                  <MshipButton disabled={action.pending} onClick={() => handleAction('recover')}>{action.pending ? 'Opening payment…' : `Restart for ${formatINR(monthly)}`}</MshipButton>
                </>
              ) : !running && canBuy ? (
                <>
                  <MshipButton disabled={action.pending || Boolean(localPay)} onClick={() => handleAction('activate').catch(() => {})}>{ctaLabel}</MshipButton>
                  {localPay && (
                    <div className="mship-cancel" role="group" aria-label="Local payment stand-in">
                      <p><strong>Local payment stand-in.</strong> Razorpay’s hosted window is not used here, because this server’s payment ids exist only on the QA gateway. No bank account is charged.</p>
                      <p className="mship-fine">{localPay.razorpay.description} · {formatINR(localPay.amount)}</p>
                      <div className="mship-cta-actions">
                        <MshipButton disabled={action.pending} onClick={() => handleAction('local_pay').catch((err) => setMsg({ tone: 'error', text: err.message || 'Payment could not be completed. Nothing was activated. You can try again.' }))}>Confirm payment</MshipButton>
                        <button type="button" className="button button-outline" disabled={action.pending} onClick={() => handleAction('local_fail').catch((err) => setMsg({ tone: 'error', text: err.message || 'The payment did not complete. Nothing was activated. You can try again.' }))}>Simulate failure</button>
                        <button type="button" className="text-link" disabled={action.pending} onClick={() => handleAction('local_cancel').catch(() => {})}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <p className="mship-fine">{localPay ? 'Confirming activates the membership only after the server verifies the payment.' : 'You’ll set up UPI Autopay for the monthly payment in the same step. Paid securely through Razorpay.'}</p>
                </>
              ) : null}
              <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
            </aside>
          </div>
        </section>

        {user && (
          <section className="mship-section">
            <div className="mship-balance">
              <div>
                <span className="mship-label">Wardrobe balance</span>
                <div className="mship-balance-row">
                  <span className="mship-big">{credits}</span>
                  <span>credit{credits === 1 ? '' : 's'} available{billing?.credits_frozen ? ' (on hold)' : ''}</span>
                </div>
                {data?.credits && (
                  <p className="mship-fine">
                    {data.credits.granted} received, {data.credits.consumed} used, {data.credits.expired} expired{data.credits.forfeited ? `, ${data.credits.forfeited} lost on cancellation` : ''}.
                    Credits last {data.credits.expiry_days} days and you can hold up to {data.credits.holding_limit}.
                  </p>
                )}
              </div>
              <div className="mship-balance-side">
                <span className="mship-label">Paid until</span>
                <strong className="mship-date">{running ? fmtDate(membership.paid_through) || '—' : membership.status === 'expired' ? 'Ended' : 'After your first payment'}</strong>
                <p className="mship-fine">{billing?.in_lock_in ? `Your first months run until ${fmtDate(billing.lock_in_until)}. ` : ''}Each month’s credits arrive when that month starts.</p>
              </div>
            </div>

            {milestone?.enabled && (milestone.on_qualifying_plan || milestone.rule === 'consecutive_months') && (
              <div className="mship-progress" aria-label="Free piece progress">
                <div className="mship-progress-head">
                  <span className="mship-label">Free piece in month six</span>
                  <strong>Month {milestone.current_month} of 6</strong>
                </div>
                <div className="mship-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={6} aria-valuenow={milestone.current_month}>
                  <span style={{ width: `${(milestone.current_month / 6) * 100}%` }} />
                </div>
                <p className="mship-fine">
                  {!running
                    ? 'Keep a membership going into its sixth month and that month comes with one free piece.'
                    : milestone.months_to_reward === 0
                      ? 'Your sixth month has started and your free piece is in your rewards. The count starts again next month.'
                      : `Your free piece arrives when your sixth paid month in a row starts: ${milestone.months_to_reward} month${milestone.months_to_reward === 1 ? '' : 's'} to go.`}
                  {running && ' A pause or a missed payment restarts the count.'}
                </p>
              </div>
            )}

            {rewards.length > 0 && (
              <div className="mship-rewards">
                <span className="mship-label">Free-piece rewards</span>
                <ul>
                  {rewards.map((r) => (
                    <li key={r.id}>
                      <strong>{r.kind === 'referral' ? 'Referral reward' : `Sixth-month reward${r.milestone_number > 1 ? ` #${r.milestone_number}` : ''}`}</strong>
                      <span className={`status ${r.status === 'available' ? 'good' : 'warn'}`}>{r.status}</span>
                      {r.status === 'available' && <Link className="text-link" to="/wardrobe">Choose your piece</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="mship-section" aria-labelledby="mship-included-title">
          <div className="mship-features">
            <h2 className="mship-h2" id="mship-included-title">What’s included</h2>
            <div className="mship-feature-list">
              {included.map(([title, desc]) => (
                <div key={title} className="mship-feature">
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mship-section">
          {running && (
          <div className="mship-cta-strip">
            <div>
              <h2 className="mship-h3">Manage your membership</h2>
              {billing?.pause
                ? <p>{billing.pause.reason === 'payment_failed' ? 'Paused after failed payments.' : `Paused from ${fmtDate(billing.pause.starts_at)} to ${fmtDate(billing.pause.ends_at)}.`}</p>
                : <p>{billing?.in_lock_in ? `You can pause or cancel from ${fmtDate(billing.lock_in_until)}.` : 'Pause for a month, come back early, or cancel.'}</p>}
            </div>
            <div className="mship-cta-actions">
              {billing?.can_pause && <MshipButton disabled={action.pending} onClick={() => handleAction('pause')}>Pause for a month</MshipButton>}
              {billing?.pause?.reason === 'customer' && <MshipButton disabled={action.pending} onClick={() => handleAction('resume')}>Resume now</MshipButton>}
              {billing?.can_cancel && !confirmCancel && <button type="button" className="button button-outline" disabled={action.pending} onClick={() => setConfirmCancel(true)}>Cancel membership</button>}
            </div>
          </div>
          )}
          {confirmCancel && (
            <div className="mship-cancel" role="dialog" aria-label="Cancel membership">
              <p><strong>Before you go:</strong> you could pause for a month instead (no charge, no new credits), or ask the studio on WhatsApp to pick something out for you.</p>
              <p className="mship-fine">If you cancel, UPI Autopay stops now and your {membership.credits_balance} unused credits lapse. Pieces already in your Wardrobe Bag still ship.</p>
              <div className="mship-cta-actions">
                {billing?.can_pause && <MshipButton disabled={action.pending} onClick={() => handleAction('pause')}>Pause instead</MshipButton>}
                <button type="button" className="button button-outline" disabled={action.pending} onClick={() => handleAction('cancel')}>Confirm cancellation</button>
                <button type="button" className="text-link" onClick={() => setConfirmCancel(false)}>Keep my membership</button>
              </div>
            </div>
          )}
          {user && data?.payments?.length > 0 && (
            <details className="mship-history">
              <summary>Payments and invoices</summary>
              <table className="mship-table">
                <thead><tr><th>Date</th><th>Covers</th><th>Type</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.paid_at || p.attempted_at)}</td>
                      <td>{p.months ? `${p.months} month${p.months > 1 ? 's' : ''}` : '—'}</td>
                      <td>{p.charge_kind === 'recurring' ? 'Autopay' : p.charge_kind === 'upfront' ? 'Upfront' : p.kind}</td>
                      <td>{formatINR(p.amount)}{Number(p.discount_amount) > 0 ? ` (−${formatINR(p.discount_amount)})` : ''}</td>
                      <td>{p.status}</td>
                      <td>{p.invoice_number || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {user && data?.attempts?.length > 0 && (
            <details className="mship-history">
              <summary>Autopay attempts</summary>
              <table className="mship-table">
                <thead><tr><th>Date</th><th>Result</th><th>Amount</th><th>Reason</th></tr></thead>
                <tbody>
                  {data.attempts.map((a, i) => (
                    <tr key={`${a.created_at}-${i}`}><td>{fmtDate(a.created_at)}</td><td>{a.outcome}</td><td>{a.amount ? formatINR(a.amount) : '—'}</td><td>{a.failure_reason || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {user && data?.history?.length > 0 && (
            <details className="mship-history">
              <summary>Membership history (pauses, cancellations, restarts)</summary>
              <table className="mship-table">
                <thead><tr><th>Date</th><th>What happened</th></tr></thead>
                <tbody>
                  {data.history.map((h, i) => (
                    <tr key={`${h.created_at}-${i}`}><td>{fmtDate(h.created_at)}</td><td>{EVENT_COPY[h.event] || h.event}{h.reason && h.reason !== 'customer' ? ` (${h.reason.replace(/_/g, ' ')})` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="mship-foot">
            <Link to="/catalogue" className="text-link">Browse what’s on the rail <span aria-hidden="true">→</span></Link>
          </p>
        </section>
        <section className="mship-faq" aria-labelledby="mship-faq-title">
          <h2 id="mship-faq-title">Questions about membership</h2>
          <Faq items={MEMBERSHIP_FAQS} />
        </section>
      </main>
      <Footer />
    </div>
  );
};
