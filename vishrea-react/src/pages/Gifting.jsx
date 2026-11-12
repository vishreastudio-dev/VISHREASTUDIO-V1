import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { InlineMessage } from '../components/Status';
import { usePageSeo } from '../lib/usePageSeo';
import { useStore } from '../context/StoreContext';
import { api, formatINR } from '../lib/api';
import { useApi } from '../lib/useApi';
import { clearFieldErrors, clearOnInput, markFieldError } from '../lib/fieldErrors';
import { openRazorpay } from '../lib/payments';
import { afterGiftPaid, blankGiftPurchase } from '../lib/giftPurchase';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const PHONE_RE = /^[+\d\s()-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Buy a pre-booked gift membership online (MEM-12..14): paid once, never on autopay. */
function GiftPurchase({ user, giftOptions }) {
  const account = useApi('/api/account', { enabled: Boolean(user) }).data;
  const wearers = account?.wearers || [];
  const submissionKey = useRef(newKey());
  const inFlight = useRef(false);
  const [f, setF] = useState(() => blankGiftPurchase(giftOptions[0]?.months || 2));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const set = (k) => (e) => {
    submissionKey.current = newKey();
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  const option = giftOptions.find((o) => o.months === Number(f.membership_months));
  const forHer = f.gift_mode === 'gift_to_her';

  const buy = async (e) => {
    e.preventDefault();
    // The ref blocks a second submit before React has re-rendered the disabled button.
    if (busy || done || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMsg({ tone: 'info', text: '' });
    try {
      const start = await api('/api/gifting', {
        method: 'POST',
        body: {
          action: 'purchase', gift_mode: f.gift_mode, membership_months: Number(f.membership_months), sender_phone: f.sender_phone, message: f.message, submission_key: submissionKey.current,
          ...(forHer ? { recipient_name: f.recipient_name, recipient_email: f.recipient_email, recipient_phone: f.recipient_phone || undefined, start_date: f.start_date || undefined } : { wearer_id: f.wearer_id }),
        },
      });
      let resp;
      try {
        resp = await openRazorpay(start.razorpay, { description: start.razorpay.description });
      } catch (err) {
        if (err.dismissed) throw new Error('Payment not completed. Nothing was charged.');
        throw err;
      }
      await api('/api/gifting', { method: 'POST', body: { action: 'confirm_payment', ...resp }, timeoutMs: 30000 });
      setDone(forHer ? `${f.recipient_name} will receive an email with her activation link.` : 'The membership is active on your account. Shop for her with her wearer profile.');
      setF(afterGiftPaid(f));
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const startAnother = () => {
    submissionKey.current = newKey();
    setMsg({ tone: 'info', text: '' });
    setDone('');
  };

  if (!user) return <p className="fine"><Link to="/login?next=/gifting">Sign in</Link> to buy a gift membership online.</p>;
  if (done) {
    return (
      <div className="gift-done" role="status">
        <h2>Gift paid — thank you.</h2>
        <p>{done}</p>
        <button type="button" className="button button-dark full" onClick={startAnother}>Buy another gift</button>
      </div>
    );
  }
  return (
    <form className="checkout-form" onSubmit={buy}>
      <fieldset className="gift-type" disabled={busy}>
        <legend>How should the gift work?</legend>
        <label><input type="radio" name="gift_mode" value="gift_to_her" checked={forHer} onChange={set('gift_mode')} /> Gift to her — she gets an activation link and picks herself</label>
        <label><input type="radio" name="gift_mode" value="pick_for_her" checked={!forHer} onChange={set('gift_mode')} /> I’ll pick for her — I keep the membership and shop with her wearer profile</label>
      </fieldset>
      <div className="form-row">
        <label>
          Months (prepaid, no autopay)
          <select value={f.membership_months} onChange={set('membership_months')}>
            {giftOptions.map((o) => <option key={o.months} value={o.months}>{o.months} months · {formatINR(o.total)}</option>)}
          </select>
        </label>
        <label>Your phone<input type="tel" required maxLength={20} value={f.sender_phone} onChange={set('sender_phone')} /></label>
      </div>
      {forHer ? (
        <>
          <div className="form-row">
            <label>Her name<input required maxLength={120} value={f.recipient_name} onChange={set('recipient_name')} /></label>
            <label>Her email (for the link)<input type="email" required maxLength={254} value={f.recipient_email} onChange={set('recipient_email')} /></label>
          </div>
          <div className="form-row">
            <label>Her WhatsApp number (optional)<input type="tel" maxLength={20} value={f.recipient_phone} onChange={set('recipient_phone')} /></label>
            <label>Starts on (optional)<input type="date" value={f.start_date} onChange={set('start_date')} /></label>
          </div>
        </>
      ) : (
        <label>
          Who is it for?
          <select required value={f.wearer_id} onChange={set('wearer_id')}>
            <option value="">Choose a wearer profile</option>
            {wearers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {!wearers.length && <span className="fine"> Add her wearer profile in <Link to="/account">your account</Link> first.</span>}
        </label>
      )}
      <label>Gift message (shown to the studio for her card)<textarea rows={2} maxLength={1000} value={f.message} onChange={set('message')} /></label>
      <p className="fine">Gift boxes are packed with a handwritten card and no prices on the slip for ₹50 each — choose “This is a gift” at checkout.</p>
      <button className="button button-dark full" disabled={busy}>{busy ? 'Working…' : `Pay ${option ? formatINR(option.total) : ''} and send the gift`}</button>
      <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
    </form>
  );
}

export const Gifting = () => {
  usePageSeo({ breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Gifting', url: '/gifting' }] });
  const { user } = useStore();
  const submissionKey = useRef(newKey());
  const [form, setForm] = useState({
    request_type: 'individual',
    sender_name: user?.name || '',
    sender_email: user?.email || '',
    sender_phone: '',
    company_name: '',
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    membership_months: 2,
    quantity: 1,
    message: '',
  });
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => {
    submissionKey.current = newKey();
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const corporate = form.request_type === 'corporate';
  const content = useApi('/api/content', { maxAge: 60_000 }).data;
  const giftOptions = content?.gift_options || [];
  const giftTypes = content?.gift_enquiry_types || ['individual', 'corporate'];
  useEffect(() => {
    if (!content) return;
    setForm((f) => ({
      ...f,
      membership_months: giftOptions.some((o) => o.months === Number(f.membership_months)) ? f.membership_months : giftOptions[0]?.months ?? f.membership_months,
      request_type: giftTypes.includes(f.request_type) ? f.request_type : giftTypes[0],
    }));
    // Re-align the form only when the configured options arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const validate = () => {
    if (!form.sender_name.trim()) return ['sender_name', 'Please add your name.'];
    if (!EMAIL_RE.test(form.sender_email.trim())) return ['sender_email', 'Please add a valid email address.'];
    if (!PHONE_RE.test(form.sender_phone.trim()) || form.sender_phone.replace(/\D/g, '').length < 7) return ['sender_phone', 'Please add a valid phone number.'];
    if (corporate && !form.company_name.trim()) return ['company_name', 'Please add the company name.'];
    if (!corporate && !form.recipient_name.trim()) return ['recipient_name', 'Please add the recipient’s name.'];
    if (form.recipient_email && !EMAIL_RE.test(form.recipient_email.trim())) return ['recipient_email', 'The recipient email does not look right.'];
    if (corporate && !(Number(form.quantity) >= 1 && Number(form.quantity) <= 100)) return ['quantity', 'Choose between 1 and 100 memberships.'];
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const formEl = e.currentTarget;
    const problem = validate();
    if (problem) {
      setMsg({ tone: 'error', text: problem[1] });
      markFieldError(formEl, problem[0], 'gift-msg');
      return;
    }
    clearFieldErrors(formEl);
    setLoading(true);
    setMsg({ tone: 'info', text: '' });
    try {
      const d = await api('/api/gifting', {
        method: 'POST',
        body: {
          ...form,
          membership_months: Number(form.membership_months),
          quantity: corporate ? Number(form.quantity) : 1,
          company_name: corporate ? form.company_name : undefined,
          recipient_email: form.recipient_email || undefined,
          recipient_phone: form.recipient_phone || undefined,
          submission_key: submissionKey.current,
        },
      });
      setDone(d.enquiry);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
      markFieldError(formEl, err, 'gift-msg');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Header />
      <main id="main-content" className="gift-page">
        <nav aria-label="Breadcrumb" className="breadcrumb-nav">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Gifting</span>
        </nav>
        <p className="eyebrow">Gifting</p>
        <h1 className="gift-title">Give someone the Walkin Wardrobe.</h1>
        <p className="gift-lead">
          Tell us who the gift is for. The studio confirms the details with you, sends an invoice
          {giftOptions.length ? ` (${giftOptions.map((o) => `${formatINR(o.total)} for ${o.months} month${o.months === 1 ? '' : 's'}`).join(' or ')} per membership)` : ''}, and then shares a private link the recipient uses to activate their membership.
        </p>

        <section className="membership-grid gift-grid">
          <article className="membership-plan">
            <span className="plan-label">BUY A GIFT NOW</span>
            <GiftPurchase user={user} giftOptions={giftOptions.length ? giftOptions : [{ months: 2, total: 3598 }]} />
          </article>
          <article className="membership-side">
            <h2>Two ways to gift.</h2>
            <div><b>01</b><span>Gift to her: she receives a private link by email, sets up her own profile and colour analysis, and picks herself.</span></div>
            <div><b>02</b><span>I’ll pick for her: you keep the membership and shop with her wearer profile; boxes ship to her address.</span></div>
            <div><b>03</b><span>Pre-booked months are paid once, with no autopay. When they end, she is invited to continue on her own.</span></div>
          </article>
        </section>

        <section className="membership-grid gift-grid">
          <article className="membership-plan">
            <span className="plan-label">COMPANY OR BULK GIFTS — ENQUIRY</span>
            {done ? (
              <div className="gift-done" role="status">
                <h2>Thank you — enquiry {done.enquiry_number} received.</h2>
                <p>We will contact you shortly to confirm the details and invoice. Nothing has been charged.</p>
                {user ? <Link className="text-link" to="/account">See your enquiries in your account →</Link> : null}
              </div>
            ) : (
              <form className="checkout-form" onSubmit={handleSubmit} onInput={clearOnInput} noValidate>
                {giftTypes.length > 1 && (
                  <fieldset className="gift-type" disabled={loading}>
                    <legend>This gift is from</legend>
                    <label><input type="radio" name="request_type" value="individual" checked={!corporate} onChange={set('request_type')} /> Me (individual)</label>
                    <label><input type="radio" name="request_type" value="corporate" checked={corporate} onChange={set('request_type')} /> A company / team</label>
                  </fieldset>
                )}
                <div className="form-row">
                  <label>Your name<input name="sender_name" required autoComplete="name" maxLength={120} value={form.sender_name} onChange={set('sender_name')} /></label>
                  <label>Your phone<input name="sender_phone" type="tel" required autoComplete="tel" maxLength={20} value={form.sender_phone} onChange={set('sender_phone')} /></label>
                </div>
                <label>Your email<input name="sender_email" type="email" required autoComplete="email" maxLength={254} value={form.sender_email} onChange={set('sender_email')} /></label>
                {corporate && <label>Company name<input name="company_name" required maxLength={160} value={form.company_name} onChange={set('company_name')} /></label>}
                <div className="form-row">
                  <label>{corporate ? 'Recipient name (optional)' : 'Recipient name'}<input name="recipient_name" required={!corporate} maxLength={120} value={form.recipient_name} onChange={set('recipient_name')} /></label>
                  <label>Recipient email (optional)<input name="recipient_email" type="email" maxLength={254} value={form.recipient_email} onChange={set('recipient_email')} /></label>
                </div>
                <div className="form-row">
                  <label>
                    Membership length
                    <select name="membership_months" value={form.membership_months} onChange={set('membership_months')}>
                      {(giftOptions.length ? giftOptions : [{ months: 2 }]).map((o) => <option key={o.months} value={o.months}>{o.months} month{o.months === 1 ? '' : 's'}</option>)}
                    </select>
                  </label>
                  {corporate && <label>Number of memberships<input name="quantity" type="number" min={1} max={100} value={form.quantity} onChange={set('quantity')} /></label>}
                </div>
                <label>Message or requirements<textarea name="message" rows={3} maxLength={1000} value={form.message} onChange={set('message')} placeholder="A note for her, a date, or anything we should know" /></label>
                <button className="button button-dark full" disabled={loading}>{loading ? 'Sending…' : 'Send gift enquiry'}</button>
                <InlineMessage id="gift-msg" tone={msg.tone}>{msg.text}</InlineMessage>
              </form>
            )}
          </article>

          <article className="membership-side">
            <h2>How it works.</h2>
            <div><b>01</b><span>Send this enquiry — no payment is taken online.</span></div>
            <div><b>02</b><span>The studio confirms the details and invoices you.</span></div>
            <div><b>03</b><span>The recipient receives a private one-time link to activate the membership, with 4 credits for each month.</span></div>
            <p className="fine">Already have a gift link? <Link to="/gift/redeem">Redeem your gift</Link>.</p>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
};
