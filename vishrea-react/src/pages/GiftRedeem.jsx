import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { InlineMessage } from '../components/Status';
import { useStore } from '../context/StoreContext';
import { api } from '../lib/api';
import { usePageSeo } from '../lib/usePageSeo';

const TOKEN_KEY = 'vishrea_gift_token';

// The code arrives in the URL fragment (never sent to servers or logs) and is kept in this tab
// only until it is redeemed.
export const GiftRedeem = () => {
  usePageSeo({ noIndex: true });
  const { user, authReady } = useStore();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '').trim();
    if (fromHash) {
      sessionStorage.setItem(TOKEN_KEY, fromHash);
      window.history.replaceState(null, '', window.location.pathname);
    }
    setToken(fromHash || sessionStorage.getItem(TOKEN_KEY) || '');
  }, []);

  const redeem = async (e) => {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setMsg({ tone: 'info', text: '' });
    try {
      const d = await api('/api/gifting', { method: 'POST', body: { action: 'redeem', token: token.trim() } });
      sessionStorage.removeItem(TOKEN_KEY);
      setDone(d.membership);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Header />
      <main id="main-content" className="prose-page">
        <h1>Redeem your gift</h1>
        {done ? (
          <div role="status">
            <p className="lead">Your Walkin Wardrobe membership is active until {new Date(done.paid_through).toLocaleDateString('en-IN', { dateStyle: 'long' })}.</p>
            <p>{done.credits_balance} credits are ready to use.</p>
            <Link className="button button-dark" to="/membership">See your membership</Link>
          </div>
        ) : !authReady ? null : !user ? (
          <div>
            <p className="lead">Sign in or create your account to activate the gift. Your gift link is kept in this browser tab.</p>
            <Link className="button button-dark" to="/login?next=/gift/redeem">Sign in to redeem</Link>
          </div>
        ) : (
          <form onSubmit={redeem} className="checkout-form">
            <label>
              Gift code
              <input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} maxLength={64} required />
            </label>
            <button className="button button-dark" disabled={busy || !token.trim()}>{busy ? 'Activating…' : 'Activate membership'}</button>
            <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
          </form>
        )}
      </main>
      <Footer />
    </div>
  );
};
