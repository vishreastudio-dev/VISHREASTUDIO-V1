import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { EmptyState, InlineMessage } from '../components/Status';
import { api, formatINR } from '../lib/api';
import { openRazorpay, waitForPaid } from '../lib/payments';
import { INDIAN_STATES } from '../lib/states';
import { usePageSeo } from '../lib/usePageSeo';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const Checkout = () => {
  usePageSeo({ noIndex: true });
  const { cart, cartEstimate, user, refreshCart, myOffers = [], appliedOffer, applyOffer, removeOffer } = useStore();
  const navigate = useNavigate();
  const idemKey = useRef(newKey());

  const [promoInput, setPromoInput] = useState('');
  const [offerMsg, setOfferMsg] = useState({ tone: 'info', text: '' });
  const [applyingOffer, setApplyingOffer] = useState(false);

  const [form, setForm] = useState({
    name: user?.name || '',
    phone: '',
    line1: '',
    line2: '',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '',
    method: 'delivery',
    gst: false,
    gstin: '',
    gift: false,
    gift_message: '',
  });
  const [phase, setPhase] = useState('form'); // form | creating | paying | verifying | dismissed
  const [pending, setPending] = useState(null); // server checkout response
  const [msg, setMsg] = useState({ tone: 'info', text: '' });

  useEffect(() => {
    refreshCart().catch(() => {});
  }, [refreshCart]);

  // A changed bag or address is a new checkout attempt.
  useEffect(() => {
    if (phase === 'form') idemKey.current = newKey();
  }, [form, cart.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const issues = cart.some((i) => i.issue);
  const busy = ['creating', 'paying', 'verifying'].includes(phase);
  // Label only: the server prices the order. Credits/rewards covering every piece, plus pickup
  // (or free delivery) and no gift packing, means nothing is charged.
  const handleApplyPromo = async (codeToApply) => {
    const code = (codeToApply || promoInput).trim();
    if (!code) return;
    setApplyingOffer(true);
    setOfferMsg({ tone: 'info', text: '' });
    try {
      const off = await applyOffer(code);
      setPromoInput('');
      setOfferMsg({ tone: 'success', text: `Offer "${off.code}" applied!` });
    } catch (err) {
      setOfferMsg({ tone: 'error', text: err.message || 'Invalid promo code' });
    } finally {
      setApplyingOffer(false);
    }
  };

  const goodsDue = cartEstimate
    ? Number(cartEstimate.subtotal) -
      Number(cartEstimate.credit_discount || 0) -
      Number(cartEstimate.reward_discount || 0) -
      Number(cartEstimate.loyalty_discount || 0) -
      Number(cartEstimate.offer_discount || 0)
    : null;
  // Credit and free-piece picks can wait in the Wardrobe Bag and ship later together (MEM-06).
  const allPicks = cart.length > 0 && cart.every((c) => c.use_credit || c.reward_entitlement_id);
  // The bag option disappears when the cart stops being all picks; delivery then applies.
  const method = form.method === 'bag' && !allPicks ? 'delivery' : form.method;
  const toBag = method === 'bag';
  const nothingToPay = toBag || (goodsDue !== null && cart.length > 0 && goodsDue <= 0 && !form.gift && (method === 'pickup' || Number(cartEstimate.shipping) === 0));

  const finishPaid = async (orderId) => {
    await refreshCart().catch(() => {});
    navigate(`/orders/${orderId}?placed=1`, { replace: true });
  };

  const pay = async (checkout) => {
    if (!checkout.razorpay) {
      setPhase('form');
      setMsg({ tone: 'error', text: 'Payment could not be started. Please try again.' });
      return;
    }
    setPhase('paying');
    let resp;
    try {
      resp = await openRazorpay(checkout.razorpay);
    } catch (err) {
      const until = checkout.expires_at ? new Date(checkout.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'shortly';
      setPhase('dismissed');
      if (err.failed) {
        setMsg({ tone: 'error', text: `${err.message} Your order stays pending, so you can try again without losing your bag. Your pieces are held until ${until}.` });
      } else if (err.dismissed) {
        setMsg({ tone: 'info', text: `Payment not completed. Your pieces are held until ${until}. Your bag is unchanged.` });
      } else {
        setMsg({ tone: 'error', text: err.message || 'Payment could not be completed.' });
      }
      return;
    }
    setPhase('verifying');
    try {
      await api('/api/payment-verify', { method: 'POST', body: { order_id: checkout.order_id, ...resp }, timeoutMs: 30000 });
      return finishPaid(checkout.order_id);
    } catch (err) {
      // The order was already paid by an earlier attempt; the extra payment is refunded by the server.
      if (err.code === 'duplicate_payment' || err.code === 'order_already_paid') return finishPaid(checkout.order_id);
      if (err.code === 'order_unfulfillable') {
        setPhase('form');
        setMsg({ tone: 'error', text: err.message });
        return;
      }
      if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        setPhase('dismissed');
        setMsg({ tone: 'error', text: `${err.message} If money was deducted, it will be refunded automatically.` });
        return;
      }
      // Network/server trouble: the webhook confirms payment independently. Poll, never re-charge.
      setMsg({ tone: 'info', text: 'Confirming your payment… please keep this page open.' });
      const status = await waitForPaid(checkout.order_id);
      if (status === 'paid') return finishPaid(checkout.order_id);
      setPhase('dismissed');
      setMsg({ tone: 'info', text: 'We are still confirming your payment with the bank. Check My Orders in a few minutes — you will not be charged twice.' });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || issues || !cart.length) return;
    setMsg({ tone: 'info', text: '' });
    setPhase('creating');
    try {
      const body = {
        idempotency_key: idemKey.current,
        shipping_method: method,
        shipping_address:
          toBag
            ? {}
            : method === 'pickup'
              ? { name: form.name, phone: form.phone }
              : { name: form.name, phone: form.phone, line1: form.line1, line2: form.line2, city: form.city, state: form.state, pincode: form.pincode },
        gift: toBag ? false : form.gift,
        gift_message: form.gift ? form.gift_message : undefined,
        gst_invoice_requested: form.gst,
        buyer_gstin: form.gst ? form.gstin : undefined,
        promo_code: appliedOffer?.code || undefined,
      };
      const checkout = await api('/api/checkout', { method: 'POST', body, timeoutMs: 30000 });
      setPending(checkout);
      if (checkout.in_bag) {
        await refreshCart().catch(() => {});
        navigate('/wardrobe', { replace: true });
        return;
      }
      if (checkout.payment_status === 'paid') return finishPaid(checkout.order_id);
      await pay(checkout);
    } catch (err) {
      setPhase('form');
      setMsg({ tone: 'error', text: err.message });
      if (err.code === 'out_of_stock' || err.code === 'product_unavailable') refreshCart().catch(() => {});
    }
  };

  const resume = async () => {
    if (busy || !pending) return;
    setPhase('creating');
    setMsg({ tone: 'info', text: '' });
    try {
      const checkout = await api('/api/checkout', { method: 'POST', body: { action: 'resume', order_id: pending.order_id } });
      setPending(checkout);
      await pay(checkout);
    } catch (err) {
      setPhase('form');
      setPending(null);
      idemKey.current = newKey();
      setMsg({ tone: 'error', text: err.message });
    }
  };

  const cancel = async () => {
    if (busy || !pending) return;
    setPhase('creating');
    try {
      await api('/api/checkout', { method: 'POST', body: { action: 'cancel', order_id: pending.order_id } });
    } catch {
      /* the hold also expires on its own */
    }
    setPending(null);
    idemKey.current = newKey();
    setPhase('form');
    setMsg({ tone: 'info', text: 'Checkout cancelled. Your pieces are back in the bag.' });
  };

  if (!cart.length && phase === 'form') {
    return (
      <div>
        <Header />
        <main id="main-content" className="two-col">
          <EmptyState title="Your bag is empty." action={<Link className="button button-dark" to="/catalogue">Shop the edit</Link>} />
        </main>
        <Footer />
      </div>
    );
  }

  const totals = pending?.totals;
  return (
    <div>
      <Header />
      <main id="main-content" className="checkout-page two-col">
        <section>
          <p className="eyebrow">CHECKOUT</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, margin: '8px 0 24px' }}>Make it yours.</h1>

          {phase === 'dismissed' ? (
            <div style={{ border: '1px solid var(--line)', padding: 24, display: 'grid', gap: 12 }}>
              <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" className="button button-dark" onClick={resume}>Complete payment</button>
                <button type="button" className="button button-outline" onClick={cancel}>Cancel and release pieces</button>
                <Link className="text-link" to="/orders">View my orders</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="checkout-form" style={{ display: 'grid', gap: '16px' }}>
              <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 16 }}>
                <legend className="visually-hidden">Delivery details</legend>
                <div role="radiogroup" aria-label="Delivery method" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name="method" value="delivery" checked={method === 'delivery'} onChange={set('method')} /> Home delivery (₹99)
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name="method" value="pickup" checked={form.method === 'pickup'} onChange={set('method')} /> Studio pickup (free)
                  </label>
                  {allPicks && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="radio" name="method" value="bag" checked={form.method === 'bag'} onChange={set('method')} /> Keep in my Wardrobe Bag — ship later (4+ pieces ship free)
                    </label>
                  )}
                </div>
                {!toBag && <div className="form-row">
                  <label>Full name<input required autoComplete="name" maxLength={120} value={form.name} onChange={set('name')} /></label>
                  <label>Mobile number<input required type="tel" autoComplete="tel" maxLength={20} value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" /></label>
                </div>}
                {method === 'delivery' && (
                  <>
                    <label>Address<input required autoComplete="address-line1" maxLength={200} value={form.line1} onChange={set('line1')} placeholder="House / apartment, street" /></label>
                    <label>Area / landmark (optional)<input autoComplete="address-line2" maxLength={200} value={form.line2} onChange={set('line2')} /></label>
                    <div className="form-row">
                      <label>City<input required autoComplete="address-level2" maxLength={80} value={form.city} onChange={set('city')} /></label>
                      <label>PIN code<input required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} autoComplete="postal-code" value={form.pincode} onChange={set('pincode')} /></label>
                    </div>
                    <label>
                      State
                      <select required value={form.state} onChange={set('state')} autoComplete="address-level1">
                        {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                  </>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={form.gst} onChange={set('gst')} /> I need a GST invoice for my business
                </label>
                {form.gst && <label>GSTIN<input required maxLength={15} pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]" value={form.gstin} onChange={set('gstin')} /></label>}
                {!toBag && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={form.gift} onChange={set('gift')} /> This is a gift — gift packing, prices hidden on the slip, note for the studio (₹50)
                </label>}
                {form.gift && !toBag && <label>Gift message<textarea rows="2" maxLength={300} value={form.gift_message} onChange={set('gift_message')} /></label>}
              </fieldset>
              <button type="submit" disabled={busy || issues} className="button button-dark" style={{ padding: '16px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: '14px' }}>
                {phase === 'creating'
                  ? nothingToPay ? 'Placing your order…' : 'Securing your pieces…'
                  : phase === 'paying' ? 'Waiting for payment…' : phase === 'verifying' ? 'Confirming payment…' : nothingToPay ? 'Place order · nothing to pay' : 'Continue to payment'}
              </button>
              {nothingToPay && phase === 'form' && <p className="fine">Your credits or free-piece reward cover this order, so no payment is needed.</p>}
              {issues && <InlineMessage tone="error">Some pieces in your bag are no longer available. <Link to="/cart">Update your bag</Link>.</InlineMessage>}
              <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
            </form>
          )}
        </section>

        <aside className="summary-card" style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', height: 'fit-content' }}>
          <p className="eyebrow">ORDER SUMMARY</p>
          <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
            {cart.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '13px', margin: '6px 0' }}>
                <span>{c.name} · {c.size_label} × {c.quantity}</span>
                <span>{c.reward_entitlement_id ? 'Free piece' : c.use_credit ? 'Credit' : formatINR(Number(c.unit_price) * Number(c.quantity))}</span>
              </div>
            ))}
          </div>

          {/* Studio Privilege / Promo Code Section */}
          <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '16px' }}>
            <small style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 600 }}>
              Studio Privilege / Offer Code
            </small>

            {appliedOffer ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f8f5', border: '1px solid #c3e6cb', padding: '8px 12px', borderRadius: 4, marginTop: 8 }}>
                <div>
                  <strong style={{ color: '#155724', fontSize: 13, fontFamily: 'monospace' }}>✓ {appliedOffer.code}</strong>
                  <span style={{ fontSize: 11, color: '#155724', marginLeft: 6 }}>
                    ({appliedOffer.discount_type === 'percentage' ? `${appliedOffer.discount_value}% OFF` : `₹${appliedOffer.discount_value} OFF`})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={removeOffer}
                  style={{ background: 'none', border: 'none', color: '#721c24', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Enter VIP / Promo code"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    style={{ flex: 1, padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', textTransform: 'uppercase', border: '1px solid var(--line)' }}
                  />
                  <button
                    type="button"
                    disabled={applyingOffer || !promoInput.trim()}
                    onClick={() => handleApplyPromo()}
                    className="button button-dark"
                    style={{ padding: '8px 14px', fontSize: 11, textTransform: 'uppercase' }}
                  >
                    {applyingOffer ? '…' : 'Apply'}
                  </button>
                </div>

                {offerMsg.text && (
                  <p style={{ fontSize: 11, color: offerMsg.tone === 'error' ? '#9a2d2d' : '#28a745', margin: '6px 0 0' }}>
                    {offerMsg.text}
                  </p>
                )}

                {myOffers.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 10, color: '#b38b2d', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                      ✦ Privileges granted to you:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {myOffers.map((off) => (
                        <button
                          key={off.code}
                          type="button"
                          onClick={() => handleApplyPromo(off.code)}
                          style={{
                            background: '#faf8f5',
                            border: '1px dashed #d4af37',
                            padding: '4px 8px',
                            borderRadius: 3,
                            fontSize: 11,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <strong style={{ fontFamily: 'monospace' }}>{off.code}</strong> · {off.discount_type === 'percentage' ? `${off.discount_value}% OFF` : `₹${off.discount_value}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {totals ? (
            <>
              <Row label="Subtotal" value={formatINR(totals.subtotal)} />
              {Number(totals.credit_discount) > 0 && <Row label="Credits & rewards" value={`−${formatINR(totals.credit_discount)}`} />}
              {Number(totals.loyalty_discount) > 0 && <Row label="6th Order Reward (50% off)" value={`−${formatINR(totals.loyalty_discount)}`} />}
              {Number(totals.discount_amount) > 0 && (
                <Row label={`Special Offer (${appliedOffer?.code || 'VIP'})`} value={`−${formatINR(totals.discount_amount)}`} />
              )}
              <Row label="Shipping" value={formatINR(totals.shipping)} />
              {Number(totals.gift_fee) > 0 && <Row label="Gift packing" value={formatINR(totals.gift_fee)} />}
              <Row label={Number(totals.igst) > 0 ? 'Includes IGST' : 'Includes CGST + SGST'} value={formatINR(totals.tax_amount)} muted />
              <Row label="Total" value={formatINR(totals.total)} strong />
            </>
          ) : (
            <>
              <Row label="Subtotal" value={formatINR(cartEstimate?.subtotal)} />
              {Number(cartEstimate?.credit_discount) > 0 && <Row label="Wardrobe credits" value={`−${formatINR(cartEstimate.credit_discount)}`} />}
              {Number(cartEstimate?.reward_discount) > 0 && <Row label="Free-piece reward" value={`−${formatINR(cartEstimate.reward_discount)}`} />}
              {Number(cartEstimate?.loyalty_discount) > 0 && <Row label="6th Order Reward (50% off)" value={`−${formatINR(cartEstimate.loyalty_discount)}`} />}
              {Number(cartEstimate?.offer_discount) > 0 && (
                <Row label={`Special Offer (${appliedOffer?.code || cartEstimate.offer_code})`} value={`−${formatINR(cartEstimate.offer_discount)}`} />
              )}
              <Row label="Shipping" value={formatINR(method === 'pickup' ? 0 : cartEstimate?.shipping ?? 99)} />
              <Row label="Estimated total" value={formatINR((cartEstimate?.total ?? 0) - (method === 'pickup' ? cartEstimate?.shipping ?? 0 : 0))} strong />
              <p style={{ fontSize: 11, color: 'var(--muted)' }}>Prices include GST. The exact amount is calculated securely before payment.</p>
            </>
          )}
          <p className="checkout-note">Payment is handled by Razorpay — UPI, cards or netbanking. Your GST invoice is available on the order page in your account.</p>
        </aside>
      </main>
      <Footer />
    </div>
  );
};

const Row = ({ label, value, strong, muted }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: strong ? 18 : 13, fontWeight: strong ? 600 : 400, color: muted ? 'var(--muted)' : 'inherit', margin: '6px 0', ...(strong ? { borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 12 } : {}) }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
