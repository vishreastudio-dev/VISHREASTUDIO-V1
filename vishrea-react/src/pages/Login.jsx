import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { InlineMessage } from '../components/Status';
import { usePageSeo } from '../lib/usePageSeo';

// Only same-site paths; blocks open redirects such as //evil.com or https://…
const safeNext = (v) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(v) ? v : null);

export const Login = () => {
  usePageSeo({ noIndex: true });
  const { user, startLogin, verifyCode } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (user) navigate(next || (user.is_admin ? '/admin' : '/account'), { replace: true });
  }, [user, next, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async (e) => {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setMsg({ tone: 'error', text: 'Please enter a valid email address, for example name@example.com.' });
      const el = document.getElementById('login-email');
      el?.setAttribute('aria-invalid', 'true');
      el?.focus();
      return;
    }
    document.getElementById('login-email')?.removeAttribute('aria-invalid');
    setBusy(true);
    setMsg({ tone: 'info', text: '' });
    try {
      const d = await startLogin(email.trim());
      setStep('code');
      setCooldown(30);
      setMsg({ tone: 'success', text: d.debug_code ? `Development code: ${d.debug_code}` : 'We have emailed you a 6-digit code. It expires in 10 minutes.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setMsg({ tone: 'info', text: '' });
    try {
      await verifyCode(email.trim(), code);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
      <Header />
      <main id="main-content" style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(440px, 100%)', background: '#fff', padding: 'clamp(24px, 6vw, 40px)', border: '1px solid var(--line)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <p className="eyebrow" style={{ marginTop: '12px', color: 'var(--wine)' }}>Private wardrobe access</p>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '32px', margin: '6px 0', fontWeight: 400 }}>Welcome back.</h1>
            <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Sign in with a one-time code sent to your email. No password needed.</p>
          </div>

          {step === 'email' ? (
            <form onSubmit={requestCode} style={{ display: 'grid', gap: '14px' }} noValidate>
              <label htmlFor="login-email" className="visually-hidden">Email address</label>
              <input
                id="login-email"
                name="email"
                type="email"
                maxLength={254}
                aria-describedby="login-msg"
                autoComplete="email"
                required
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ padding: '14px', border: '1px solid var(--line)', fontSize: '16px' }}
              />
              <button type="submit" disabled={busy || !email.trim()} className="button button-dark" style={{ padding: '14px', fontSize: '11px', textTransform: 'uppercase' }}>
                {busy ? 'Sending code…' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} style={{ display: 'grid', gap: '14px' }}>
              <label htmlFor="login-code" style={{ fontSize: 12, color: 'var(--muted)' }}>
                Code sent to <strong>{email}</strong>
              </label>
              <input
                id="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ padding: '14px', border: '1px solid var(--line)', fontSize: '18px', textAlign: 'center', letterSpacing: '0.3em' }}
              />
              <button type="submit" disabled={busy || code.length !== 6} className="button button-dark" style={{ padding: '14px', fontSize: '11px', textTransform: 'uppercase' }}>
                {busy ? 'Verifying…' : 'Sign in'}
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <button type="button" onClick={() => { setStep('email'); setCode(''); setMsg({ tone: 'info', text: '' }); }} style={{ color: 'var(--muted)' }}>
                  Use another email
                </button>
                <button type="button" onClick={requestCode} disabled={busy || cooldown > 0} style={{ color: 'var(--wine)' }}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}
          <InlineMessage id="login-msg" tone={msg.tone}>{msg.text}</InlineMessage>
        </div>
      </main>
      <Footer />
    </div>
  );
};
