import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { AccountNav, STATUS_LABEL, statusTone } from '../components/AccountNav';
import { ErrorState, InlineMessage, LoadingState } from '../components/Status';
import { OrderTracker, isActiveOrder } from '../components/OrderTracker';
import { api, formatINR, uploadFile } from '../lib/api';
import { openRazorpay, waitForPaid } from '../lib/payments';
import { useApi, useMutation } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { NotFound } from './NotFound';

const POLL_MS = 15_000;

const statusText = (o) => (o.payment_status === 'paid' ? STATUS_LABEL[o.status] || o.status : STATUS_LABEL[o.payment_status] || o.payment_status);

/**
 * Refresh an active order every POLL_MS while the tab is visible, and immediately when the
 * customer returns to the tab. Calls onUpdate only when the server copy actually changed.
 */
function useLiveOrder(path, order, onUpdate) {
  const active = isActiveOrder(order);
  const stamp = order ? `${order.status}|${order.payment_status}|${order.updated_at}|${(order.exchanges || []).map((x) => `${x.id}:${x.status}`).join(',')}` : '';
  const stampRef = useRef(stamp);
  stampRef.current = stamp;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!active) return undefined;
    let timer = null;
    let ctrl = null;

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const next = await api(path, { signal: ctrl.signal, timeoutMs: 10_000 });
        const o = next?.order;
        if (!o) return;
        const nextStamp = `${o.status}|${o.payment_status}|${o.updated_at}|${(o.exchanges || []).map((x) => `${x.id}:${x.status}`).join(',')}`;
        if (nextStamp !== stampRef.current) onUpdateRef.current(next);
      } catch {
        /* keep the last good copy; the next tick retries */
      }
    };
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(refresh, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        schedule();
      } else {
        clearInterval(timer);
      }
    };

    if (document.visibilityState === 'visible') schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, path]);

  return active;
}

export const OrderDetail = () => {
  usePageSeo({ noIndex: true });
  const { id } = useParams();
  const [params] = useSearchParams();
  const path = `/api/orders?id=${encodeURIComponent(id)}`;
  const { data, error, loading, reload, setData } = useApi(path);
  const [reason, setReason] = useState('Size exchange needed');
  const [msg, setMsg] = useState({ tone: 'info', text: params.get('placed') ? 'Thank you — your order is confirmed.' : '' });
  const [toast, setToast] = useState('');
  const [pulseKey, setPulseKey] = useState(0);

  const live = useLiveOrder(path, data?.order, (next) => {
    const before = data?.order;
    setData(next);
    if (!before) return;
    const was = statusText(before);
    const now = statusText(next.order);
    const exchangeBefore = before.exchanges?.[0]?.status;
    const exchangeNow = next.order.exchanges?.[0]?.status;
    if (was !== now) {
      setToast(`Order status updated: ${now}`);
      setPulseKey((k) => k + 1);
    } else if (exchangeBefore !== exchangeNow && exchangeNow) {
      setToast(`Exchange update: ${exchangeNow}`);
    } else if (!before.tracking_number && next.order.tracking_number) {
      setToast('Tracking details added');
    }
  });

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!pulseKey) return undefined;
    const t = setTimeout(() => setPulseKey(0), 2400);
    return () => clearTimeout(t);
  }, [pulseKey]);

  const [photos, setPhotos] = useState([]);
  const isDamage = /damage/i.test(reason);
  const exchange = useMutation(async () => {
    const evidence = [];
    // Evidence is stored privately; the private reference (not a public URL) is what the request keeps.
    for (const file of photos.slice(0, 5)) evidence.push((await uploadFile(file, 'image', 'evidence')).ref);
    await api('/api/exchange', { method: 'POST', body: { order_id: id, reason, claim_type: isDamage ? 'damage' : 'exchange', evidence_urls: evidence } });
    setPhotos([]);
    setMsg({ tone: 'success', text: 'Request received. Our studio team will contact you shortly.' });
    reload();
  });

  const resume = useMutation(async () => {
    const co = await api('/api/checkout', { method: 'POST', body: { action: 'resume', order_id: id } });
    const resp = await openRazorpay(co.razorpay).catch((err) => {
      if (err.dismissed) return null;
      throw err;
    });
    if (!resp) return;
    try {
      await api('/api/payment-verify', { method: 'POST', body: { order_id: id, ...resp }, timeoutMs: 30000 });
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 408) throw err;
      await waitForPaid(id);
    }
    reload();
  });

  if (loading && !data) return (<div><Header /><LoadingState label="Loading order…" minHeight="60vh" /><Footer /></div>);
  if (error?.status === 404 || error?.status === 400) return <NotFound />;
  if (error) return (<div><Header /><ErrorState error={error} onRetry={reload} /><Footer /></div>);

  const o = data.order;
  const inv = data.invoice;
  const openExchange = (o.exchanges || []).find((x) => ['requested', 'review'].includes(x.status));
  const canPay = o.payment_status === 'pending' && new Date(o.payment_expires_at) > new Date();

  return (
    <div>
      <Header />
      <main id="main-content" className="account-page account-layout">
        <AccountNav />
        <section className="account-content" style={{ display: 'grid', gap: 24 }}>
          <div className="no-print">
            <Link to="/orders" className="text-link" style={{ fontSize: 11 }}>← All orders</Link>
            <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, margin: '8px 0 6px', fontSize: 40 }}>Order #{o.id.slice(0, 8).toUpperCase()}</h1>
            <span className={`status ${statusTone(o.payment_status === 'paid' ? o.status : o.payment_status)}`}>{statusText(o)}</span>
            <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
            {canPay && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="button button-dark" disabled={resume.pending} onClick={() => resume.run().catch((err) => setMsg({ tone: 'error', text: err.message }))}>
                  {resume.pending ? 'Opening payment…' : `Complete payment · ${formatINR(o.total)}`}
                </button>
              </div>
            )}
          </div>

          <OrderTracker order={o} policy={data.policy} pulseKey={pulseKey} live={live} />

          <div className="invoice-sheet">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontFamily: 'Georgia, serif', letterSpacing: '.14em' }}>{inv?.seller_legal_name || 'VISHREA STUDIO'}</strong>
                {inv?.seller_address && <p style={{ fontSize: 12, margin: '4px 0 0', whiteSpace: 'pre-line' }}>{inv.seller_address}</p>}
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>{inv ? `Tax invoice ${inv.invoice_number}` : 'Order summary'}</p>
                {inv?.seller_gstin && <p style={{ fontSize: 12, margin: 0 }}>GSTIN {inv.seller_gstin}</p>}
              </div>
              <div style={{ fontSize: 12, textAlign: 'right' }}>
                <div>{new Date(inv?.issued_at || o.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' })}</div>
                <div>Place of supply: {o.place_of_supply || '—'}</div>
                {o.buyer_gstin && <div>Buyer GSTIN: {o.buyer_gstin}</div>}
              </div>
            </div>
            {o.shipping_address && (
              <p style={{ fontSize: 12, marginTop: 14 }}>
                <strong>{o.shipping_address.name}</strong>
                {o.shipping_method === 'pickup' ? ' · Studio pickup' : ` · ${[o.shipping_address.line1, o.shipping_address.line2, o.shipping_address.city, o.shipping_address.state, o.shipping_address.pincode].filter(Boolean).join(', ')}`}
              </p>
            )}
            <table>
              <thead>
                <tr><th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {o.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}{it.variant_label ? ` · ${it.variant_label}` : ''}{it.sku ? <small style={{ display: 'block', color: 'var(--muted)' }}>{it.sku}</small> : null}</td>
                    <td>{it.hsn_code || '6204'}</td>
                    <td className="num">{it.quantity}</td>
                    <td className="num">{formatINR(it.unit_price)}</td>
                    <td className="num">{it.gst_rate !== null && it.gst_rate !== undefined ? `${Number(it.gst_rate)}%` : '—'}</td>
                    <td className="num">{it.reward_entitlement_id ? 'Free piece' : it.use_credit ? 'Credit' : formatINR(it.line_total ?? it.unit_price * it.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'grid', gap: 4, justifyContent: 'end', fontSize: 13, textAlign: 'right' }}>
              <div>Subtotal: {formatINR(o.subtotal)}</div>
              {o.credits_used > 0 && <div>Wardrobe credits used: {o.credits_used}</div>}
              <div>Shipping: {formatINR(o.shipping_fee)}</div>
              {Number(o.gift_packing_fee) > 0 && <div>Gift packing: {formatINR(o.gift_packing_fee)}</div>}
              <div>Taxable value: {formatINR(o.taxable_amount)}</div>
              {Number(o.igst_amount) > 0 ? <div>IGST: {formatINR(o.igst_amount)}</div> : <div>CGST: {formatINR(o.cgst_amount)} · SGST: {formatINR(o.sgst_amount)}</div>}
              <strong style={{ fontSize: 18, marginTop: 6 }}>Total (incl. GST): {formatINR(o.total)}</strong>
            </div>
          </div>
          {inv && <button type="button" className="button button-outline no-print" onClick={() => window.print()} style={{ justifySelf: 'start' }}>Print / save invoice</button>}

          {o.status === 'delivered' && (
            <section className="no-print" style={{ border: '1px solid var(--line)', padding: 20 }}>
              <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, margin: '0 0 10px' }}>Exchange or report damage</h2>
              {openExchange ? (
                <p style={{ fontSize: 13 }}>Your request is <strong>{openExchange.status}</strong>. We will be in touch.</p>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); exchange.run().catch((err) => setMsg({ tone: 'error', text: err.message })); }} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: 6, fontSize: 11 }}>
                    Reason
                    <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: 10, border: '1px solid var(--line)' }}>
                      <option>Size exchange needed</option>
                      <option>Fit or styling consultation</option>
                      <option>Transit damage (report within 24h)</option>
                      <option>Different colour preference</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 11 }}>
                    {isDamage ? 'Photos of the damage (up to 5)' : 'Photos (optional, up to 5)'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setPhotos([...e.target.files].slice(0, 5))} />
                  </label>
                  <button className="button button-dark" disabled={exchange.pending}>{exchange.pending ? 'Submitting…' : 'Submit request'}</button>
                </form>
              )}
            </section>
          )}
        </section>
      </main>
      <div className={`vs-toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
      <Footer />
    </div>
  );
};
