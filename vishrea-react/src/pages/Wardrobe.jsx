import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { AccountNav } from '../components/AccountNav';
import { EmptyState, ErrorState, InlineMessage, LoadingState } from '../components/Status';
import { useStore } from '../context/StoreContext';
import { api, formatINR } from '../lib/api';
import { imageFor } from '../lib/imageFor';
import { useApi } from '../lib/useApi';
import { openRazorpay } from '../lib/payments';
import { usePageSeo } from '../lib/usePageSeo';
import { bagPackedMessage } from '../lib/customerCopy';
import { useLikes, toggleLike } from '../lib/likes';

const REWARD_LABEL = { referral: 'Referral reward', six_month_milestone: '6th-month reward' };
const REWARD_STATUS = { available: 'Ready to use', reserved: 'In checkout', redeemed: 'Redeemed' };

export const Wardrobe = () => {
  usePageSeo({ noIndex: true });
  const navigate = useNavigate();
  const { user, refreshCart, addToCart } = useStore();
  const { items: localLikedItems } = useLikes();
  const { data, error, loading, reload, setData } = useApi('/api/wardrobe');
  const [sizes, setSizes] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });

  // Merge server wardrobe items with localStorage liked pieces
  const serverItems = Array.isArray(data?.items) ? data.items : [];
  const serverProductIds = new Set(serverItems.map((i) => String(i.product_id || i.slug).toLowerCase()));

  const mergedLocalItems = localLikedItems
    .filter((l) => !serverProductIds.has(String(l.product_id || l.id || l.slug).toLowerCase()))
    .map((l) => ({
      product_id: l.product_id || l.id,
      saved_at: l.liked_at || new Date().toISOString(),
      name: l.name,
      slug: l.slug || '',
      image_url: l.image_url,
      badge: null,
      is_one_of_one: false,
      available: true,
      price_inr: l.price_inr,
      variants: l.price_inr
        ? [{ id: `var-${l.id}`, size_label: 'Curated Size', price_inr: l.price_inr, in_stock: true }]
        : [],
      is_local_like: true,
    }));

  const items = [...serverItems, ...mergedLocalItems];
  const rewards = data?.rewards || [];
  const available = rewards.filter((r) => r.status === 'available');
  const isMember = data?.membership?.status === 'active';

  const sizeFor = (item) => sizes[item.product_id] || item.variants.find((v) => v.in_stock)?.id || '';

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setMsg({ tone: 'info', text: '' });
    try {
      await fn();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const addToBag = (item, use) =>
    run(`${item.product_id}:${use}`, async () => {
      if (item.is_local_like && item.slug) {
        navigate(item.slug.startsWith('/') ? item.slug : `/product/${encodeURIComponent(item.slug)}`);
        return;
      }
      const variantId = sizeFor(item);
      if (!variantId) {
        if (item.slug) {
          navigate(item.slug.startsWith('/') ? item.slug : `/product/${encodeURIComponent(item.slug)}`);
          return;
        }
        throw new Error('This piece is sold out.');
      }
      const d = await api('/api/wardrobe', {
        method: 'POST',
        body: {
          action: 'add_to_bag',
          variant_id: variantId,
          use,
          reward_entitlement_id: use === 'reward' ? available[0]?.id : undefined,
        },
      });
      setData(d);
      await refreshCart().catch(() => {});
      navigate('/cart');
    });

  const remove = (item) =>
    run(`${item.product_id}:remove`, async () => {
      await toggleLike(item, user);
      if (user && item.product_id && /^[0-9a-f-]{36}$/i.test(String(item.product_id))) {
        try {
          setData(await api('/api/wardrobe', { method: 'DELETE', body: { product_id: item.product_id } }));
        } catch {}
      }
      setMsg({ tone: 'info', text: `Removed "${item.name}" from your saved pieces.` });
    });

  const bag = data?.bag;
  const [ship, setShip] = useState({ method: 'delivery', name: '', phone: '', line1: '', city: '', state: '', pincode: '' });
  const shipFee = ship.method === 'pickup' ? 0 : bag?.fee?.delivery ?? 0;
  const shipBag = () =>
    run('ship', async () => {
      const r = await api('/api/wardrobe', {
        method: 'POST',
        body: { action: 'ship_bag', shipping_method: ship.method, idempotency_key: `bag-${bag.pieces}-${Date.now()}`, shipping_address: { name: ship.name, phone: ship.phone, line1: ship.line1, city: ship.city, state: ship.state, pincode: ship.pincode } },
      });
      if (r.razorpay) {
        let resp;
        try {
          resp = await openRazorpay(r.razorpay, { description: r.razorpay.description });
        } catch (err) {
          if (err.dismissed) throw new Error('Shipping was not paid. Your pieces are still waiting in your bag.');
          throw err;
        }
        setData(await api('/api/wardrobe', { method: 'POST', body: { action: 'confirm_bag_payment', ...resp }, timeoutMs: 30000 }));
      } else {
        setData(r);
      }
      setMsg({ tone: 'success', text: bagPackedMessage(r.pieces) });
    });

  return (
    <div>
      <Header />
      <main id="main-content" className="account-page account-layout">
        <AccountNav />
        <section className="account-content">
          <p className="eyebrow">WARDROBE BAG</p>
          <h1 className="account-h1">Pieces you’re saving.</h1>
          <p className="account-lead">Save pieces here, then move them to your bag to buy, use a wardrobe credit (members, eligible pieces) or claim a free-piece reward.</p>

          {rewards.length > 0 && (
            <div className="account-panel">
              <h2>Free-piece rewards</h2>
              <ul className="reward-list">
                {rewards.map((r) => (
                  <li key={r.id}>
                    <strong>{REWARD_LABEL[r.kind] || 'Reward'}</strong>
                    <span className={`status ${r.status === 'available' ? 'good' : 'warn'}`}>{REWARD_STATUS[r.status] || r.status}</span>
                    {r.redeemed_at && <small>Redeemed {new Date(r.redeemed_at).toLocaleDateString('en-IN')}{r.order_id ? <> · <Link to={`/orders/${r.order_id}`}>order</Link></> : null}</small>}
                  </li>
                ))}
              </ul>
              <p className="fine">A reward covers one eligible (non-Premium) piece. Standard delivery or free studio pickup applies.</p>
            </div>
          )}

          {bag?.pieces > 0 && (
            <div className="bag-panel" aria-labelledby="bag-title">
              <h2 id="bag-title">Redeemed — waiting to ship ({bag.pieces})</h2>
              <ul>
                {bag.items.map((i) => <li key={`${i.order_id}-${i.product_name}`}>{i.product_name}{i.variant_label ? ` · ${i.variant_label}` : ''} · {i.reward_entitlement_id ? 'free piece' : 'credit'}</li>)}
              </ul>
              <p className="fine">These pieces are yours. Ship {bag.free_from} or more together for free; fewer cost {formatINR(bag.fee.delivery || 99)}. Studio pickup is free.</p>
              <div className="bag-form checkout-form">
                <label>Delivery
                  <select value={ship.method} onChange={(e) => setShip({ ...ship, method: e.target.value })}>
                    <option value="delivery">Ship to my address</option>
                    <option value="pickup">Pick up at the studio</option>
                  </select>
                </label>
                <label>Name<input value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} autoComplete="name" /></label>
                <label>Phone<input value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} autoComplete="tel" inputMode="tel" /></label>
                {ship.method === 'delivery' && (
                  <>
                    <label>Address<input value={ship.line1} onChange={(e) => setShip({ ...ship, line1: e.target.value })} autoComplete="address-line1" /></label>
                    <label>City<input value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} autoComplete="address-level2" /></label>
                    <label>State<input value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} autoComplete="address-level1" /></label>
                    <label>PIN code<input value={ship.pincode} onChange={(e) => setShip({ ...ship, pincode: e.target.value })} autoComplete="postal-code" inputMode="numeric" /></label>
                  </>
                )}
              </div>
              <button type="button" className="button button-dark" disabled={Boolean(busy)} onClick={shipBag}>
                {busy === 'ship' ? 'Working…' : `Ship my bag · ${shipFee ? formatINR(shipFee) : 'free'}`}
              </button>
            </div>
          )}

          <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
          {!user && (
            <div style={{ background: '#faf6f3', border: '1px solid #e8dfd8', borderRadius: 8, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: '#685f63' }}>
              <span>You’re viewing pieces saved on this device. <Link to="/login?next=/wardrobe" style={{ color: '#7B1426', fontWeight: 600 }}>Sign in</Link> to sync your wardrobe across devices and use membership credits.</span>
            </div>
          )}
          {loading && !data && !items.length ? (
            <LoadingState />
          ) : error && error.status !== 401 && !items.length ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !items.length ? (
            <EmptyState title={bag?.pieces > 0 ? 'No saved pieces yet.' : 'Your Wardrobe Bag is empty.'} action={<Link className="button button-dark" to="/catalogue">Find pieces to save</Link>}>
              Use “Save to Wardrobe Bag” or the heart icon on any piece.
            </EmptyState>
          ) : (
            <div className="wardrobe-grid">
              {items.map((item) => {
                const inStock = item.variants.filter((v) => v.in_stock);
                const effectivePrice = inStock[0]?.sale_price_inr && inStock[0].sale_price_inr < inStock[0].price_inr
                  ? inStock[0].sale_price_inr
                  : inStock[0]?.price_inr;

                return (
                  <article key={item.product_id} className="wardrobe-card">
                    <Link to={`/product/${encodeURIComponent(item.slug)}`} className="wardrobe-card-thumb">
                      <img src={imageFor(item)} alt={item.name} width="160" height="200" />
                    </Link>
                    <div className="wardrobe-card-body">
                      <h3>
                        <Link to={`/product/${encodeURIComponent(item.slug)}`}>{item.name}</Link>
                      </h3>
                      {!item.available ? (
                        <p className="inline-message error">Sold out</p>
                      ) : (
                        <>
                          {inStock.length > 1 ? (
                            <label className="wardrobe-size">
                              Size
                              <select value={sizeFor(item)} onChange={(e) => setSizes((s) => ({ ...s, [item.product_id]: e.target.value }))}>
                                {inStock.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.size_label} · {formatINR(v.sale_price_inr && v.sale_price_inr < v.price_inr ? v.sale_price_inr : v.price_inr)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <div className="wardrobe-price-tag">
                              <span className="wardrobe-size-label">{inStock[0]?.size_label || 'Free Size'}</span>
                              <span className="wardrobe-price-val">{formatINR(effectivePrice)}</span>
                            </div>
                          )}
                          <div className="wardrobe-actions">
                            <button
                              type="button"
                              className="button button-dark"
                              disabled={Boolean(busy)}
                              onClick={() => addToBag(item, 'none')}
                            >
                              Add to bag
                            </button>
                            {isMember && item.credit_eligible && (
                              <button
                                type="button"
                                className="button button-outline"
                                disabled={Boolean(busy)}
                                onClick={() => addToBag(item, 'credit')}
                              >
                                Add with 1 credit
                              </button>
                            )}
                            {available.length > 0 && (item.reward_variant_ids || []).includes(sizeFor(item)) && (
                              <button
                                type="button"
                                className="button button-outline"
                                disabled={Boolean(busy)}
                                onClick={() => addToBag(item, 'reward')}
                              >
                                Claim free piece
                              </button>
                            )}
                            <button
                              type="button"
                              className="wardrobe-remove-btn"
                              disabled={Boolean(busy)}
                              onClick={() => remove(item)}
                            >
                              Remove
                            </button>
                          </div>
                          {!item.credit_eligible && <p className="wardrobe-note">Premium piece — not eligible for credits.</p>}
                          {available.length > 0 && !(item.reward_variant_ids || []).includes(sizeFor(item)) && (
                            <p className="wardrobe-note">This piece is not part of the free-piece selection.</p>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
};
