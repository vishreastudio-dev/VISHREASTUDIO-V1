import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { EmptyState, InlineMessage } from '../components/Status';
import { imageFor } from '../lib/imageFor';
import { formatINR } from '../lib/api';
import { usePageSeo } from '../lib/usePageSeo';

const ISSUE_COPY = {
  sold_out: 'Sold out — remove to continue',
  unavailable: 'No longer available — remove to continue',
  insufficient_stock: 'Only fewer units left — reduce quantity',
  one_of_one_quantity: 'One-of-one: quantity must be 1',
  reward_unavailable: 'This reward is no longer available — untick it to continue',
};

export const Cart = () => {
  usePageSeo({ noIndex: true });
  const { user, cart, cartEstimate, cartMembership, cartRewards, cartBusy, removeFromCart, updateCartItem, refreshCart } = useStore();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (user) refreshCart().catch(() => {});
  }, [user, refreshCart]);

  const run = async (fn) => {
    setMsg('');
    try {
      await fn();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const hasIssues = cart.some((i) => i.issue);
  const estimatedSubtotal = cart.reduce((s, i) => s + Number(i.unit_price || 0) * Number(i.quantity || 1), 0);
  const credits = cartMembership?.status === 'active' ? cartMembership.credits_balance : 0;
  const creditsInUse = cart.filter((i) => i.use_credit).reduce((s, i) => s + i.quantity, 0);

  return (
    <div>
      <Header />
      <main id="main-content" className="checkout-page two-col">
        <div>
          <p className="eyebrow">YOUR BAG</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, margin: '8px 0 24px' }}>Pieces you've chosen.</h1>

          {!cart.length ? (
            <EmptyState title="Your bag is waiting." action={<Link className="button button-dark" to="/catalogue">Shop the edit</Link>}>
              Explore the latest Vishrea edit and save a one-of-one piece.
            </EmptyState>
          ) : (
            <div className="cart-items">
              {cart.map((item) => (
                <article key={item.id} className="cart-row" style={{ display: 'flex', gap: '20px', padding: '18px 0', borderBottom: '1px solid var(--line)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <img src={imageFor(item)} alt="" width="80" height="100" style={{ width: 80, height: 100, objectFit: 'cover', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <small style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase' }}>{item.size_label || 'Free Size'}{item.sku ? ` · ${item.sku}` : ''}</small>
                    <h3 style={{ margin: '4px 0', fontSize: '16px' }}>
                      <Link to={`/product/${encodeURIComponent(item.slug || item.product_id)}`}>{item.name}</Link>
                    </h3>
                    <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
                      {formatINR(item.unit_price)}
                      {item.compare_at_price ? <span className="price-compare">{formatINR(item.compare_at_price)}</span> : null}
                      {item.is_one_of_one ? ' · 1 of 1' : ` · Qty ${item.quantity}`}
                    </p>
                    {item.issue && <p className="inline-message error" style={{ marginTop: 6 }}>{ISSUE_COPY[item.issue]}</p>}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      {!item.is_one_of_one && !item.guest && (
                        <div className="qty-stepper" role="group" aria-label={`Quantity for ${item.name}`}>
                          <button type="button" disabled={cartBusy || item.quantity <= 1} onClick={() => run(() => updateCartItem(item, { quantity: item.quantity - 1 }))} aria-label="Decrease quantity">−</button>
                          <span>{item.quantity}</span>
                          <button type="button" disabled={cartBusy || item.quantity >= Math.max(1, item.available_quantity || 1)} onClick={() => run(() => updateCartItem(item, { quantity: item.quantity + 1 }))} aria-label="Increase quantity">+</button>
                        </div>
                      )}
                      {!item.guest && !item.reward_entitlement_id && credits + (item.use_credit ? item.quantity : 0) - creditsInUse > 0 && item.credit_eligible && (
                        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" checked={item.use_credit} disabled={cartBusy} onChange={(e) => run(() => updateCartItem(item, { use_credit: e.target.checked }))} />
                          Use wardrobe credit
                        </label>
                      )}
                      {!item.guest && !item.use_credit && (item.reward_entitlement_id || (item.reward_eligible && cartRewards.length > 0)) && (
                        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(item.reward_entitlement_id)}
                            disabled={cartBusy}
                            onChange={(e) => run(() => updateCartItem(item, { reward_entitlement_id: e.target.checked ? cartRewards[0]?.id : null }))}
                          />
                          Use free-piece reward
                        </label>
                      )}
                      <button type="button" disabled={cartBusy} onClick={() => run(() => removeFromCart(item))} style={{ color: '#9a2d2d', fontSize: '12px', padding: 0 }}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <strong style={{ fontSize: '16px' }}>{item.reward_entitlement_id ? 'Free piece' : item.use_credit ? 'Credit' : formatINR(Number(item.unit_price) * Number(item.quantity))}</strong>
                </article>
              ))}
              <InlineMessage tone="error">{msg}</InlineMessage>
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <aside className="summary-card" style={{ background: '#fff', border: '1px solid var(--line)', padding: '28px', height: 'fit-content' }}>
            <p className="eyebrow">ORDER SUMMARY</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', margin: '16px 0 8px', fontSize: '14px' }}>
              <span>Subtotal</span>
              <strong>{formatINR(cartEstimate?.subtotal ?? estimatedSubtotal)}</strong>
            </div>
            {cartEstimate?.reward_discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0', fontSize: '14px' }}>
                <span>Free-piece reward</span>
                <strong>−{formatINR(cartEstimate.reward_discount)}</strong>
              </div>
            )}
            {cartEstimate?.credit_discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0', fontSize: '14px' }}>
                <span>Wardrobe credits</span>
                <strong>−{formatINR(cartEstimate.credit_discount)}</strong>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0 16px', fontSize: '14px' }}>
              <span>Shipping (estimate)</span>
              <strong>{formatINR(cartEstimate?.shipping ?? 99)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', fontSize: '18px', marginBottom: '8px' }}>
              <span>Estimated total</span>
              <strong>{formatINR(cartEstimate?.total ?? estimatedSubtotal + 99)}</strong>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 18px' }}>Prices include GST. The final amount is confirmed on the next step.</p>
            <button
              type="button"
              onClick={() => navigate(user ? '/checkout' : '/login?next=/checkout')}
              disabled={hasIssues || cartBusy}
              className="button button-dark"
              style={{ width: '100%', padding: '16px', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '11px' }}
            >
              {user ? 'Continue to checkout' : 'Sign in to check out'}
            </button>
            {hasIssues && <InlineMessage tone="error">Update the highlighted pieces to continue.</InlineMessage>}
            <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '14px', textAlign: 'center', lineHeight: '1.6' }}>Studio pickup is complimentary. Standard courier dispatch throughout India.</p>
          </aside>
        )}
      </main>
      <Footer />
    </div>
  );
};
