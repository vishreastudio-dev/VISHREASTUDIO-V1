import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Header, Footer } from '../components/Layout';
import { AccountNav } from '../components/AccountNav';
import { ErrorState, InlineMessage, LoadingState } from '../components/Status';
import { api } from '../lib/api';
import { useApi, useMutation } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';
import { clearOnInput, markFieldError } from '../lib/fieldErrors';
import { SizeProfilesSection } from '../components/SizeProfilesSection';

const Card = ({ label, value, children }) => (
  <article className="account-card">
    <small>{label}</small>
    <strong>{value}</strong>
    {children}
  </article>
);

const EMPTY_WEARER = { name: '', relationship: '', size_label: '', bust_cm: '', waist_cm: '', hip_cm: '', length_cm: '' };
const REF_STATUS = { attributed: 'Joined — awaiting first membership', qualified: 'Membership paid — reward earned', refunded: 'Payment refunded', void: 'Void' };

function ProfileForm({ profile, user, notifications, onSaved }) {
  const [form, setForm] = useState({ full_name: '', phone: '', gst_number: '', marketing_opt_in: false, n_whatsapp: true, n_email: true });
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  useEffect(() => {
    setForm({
      full_name: profile?.full_name || user?.name || '', phone: profile?.phone || '', gst_number: profile?.gst_number || '', marketing_opt_in: Boolean(notifications?.marketing ?? profile?.marketing_opt_in),
      n_whatsapp: notifications?.whatsapp !== false, n_email: notifications?.email !== false,
    });
  }, [profile, user, notifications]);
  const save = useMutation(async () => {
    const { n_whatsapp, n_email, ...details } = form;
    await api('/api/account', {
      method: 'PUT',
      body: { ...details, age_confirmed: profile?.age_confirmed, whatsapp_opt_in: n_whatsapp, notifications: { whatsapp: n_whatsapp, email: n_email, sms: notifications?.sms !== false, marketing: form.marketing_opt_in } },
    });
    setMsg({ tone: 'success', text: 'Profile saved.' });
    onSaved();
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    save.run().catch((err) => {
      setMsg({ tone: 'error', text: err.message });
      markFieldError(formEl, err, 'profile-msg');
    });
  };
  return (
    <form className="checkout-form account-panel" onSubmit={submit} onInput={clearOnInput} noValidate>
      <h2>Your details</h2>
      <div className="form-row">
        <label>Full name<input name="full_name" autoComplete="name" maxLength={120} value={form.full_name} onChange={set('full_name')} /></label>
        <label>Mobile number<input name="phone" type="tel" autoComplete="tel" maxLength={20} value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" /></label>
      </div>
      <div className="form-row">
        <label>Email<input type="email" value={user?.email || ''} disabled /></label>
        <label>GSTIN (optional)<input name="gst_number" maxLength={15} autoCapitalize="characters" value={form.gst_number} onChange={set('gst_number')} placeholder="15 characters, e.g. 29ABCDE1234F1Z5" /></label>
      </div>
      <fieldset className="check-group">
        <legend>Messages from Vishrea</legend>
        <label className="check-row"><input type="checkbox" checked={form.n_whatsapp} onChange={set('n_whatsapp')} /> Order, membership and payment updates on WhatsApp</label>
        <label className="check-row"><input type="checkbox" checked={form.n_email} onChange={set('n_email')} /> Order, membership and payment updates by email (invoices are always emailed)</label>
        <label className="check-row"><input name="marketing_opt_in" type="checkbox" checked={form.marketing_opt_in} onChange={set('marketing_opt_in')} /> Drops, offers and new arrivals (marketing — optional)</label>
      </fieldset>
      <button className="button button-dark" disabled={save.pending}>{save.pending ? 'Saving…' : 'Save details'}</button>
      <InlineMessage id="profile-msg" tone={msg.tone}>{msg.text}</InlineMessage>
    </form>
  );
}

function Wearers({ wearers, max, onChange }) {
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const save = useMutation(async () => {
    const body = { action: 'wearer', ...editing };
    for (const k of ['bust_cm', 'waist_cm', 'hip_cm', 'length_cm']) if (body[k] === '') delete body[k];
    await api('/api/account', { method: editing.id ? 'PUT' : 'POST', body });
    setEditing(null);
    setMsg({ tone: 'success', text: 'Wearer profile saved.' });
    onChange();
  });
  const remove = useMutation(async (w) => {
    if (!window.confirm(`Delete the profile for ${w.name}?`)) return;
    await api('/api/account', { method: 'DELETE', body: { action: 'wearer', id: w.id } });
    onChange();
  });
  const set = (k) => (e) => setEditing((w) => ({ ...w, [k]: e.target.value }));
  return (
    <div className="account-panel" id="wearers">
      <div className="panel-row">
        <h2>Wearer profiles</h2>
        {!editing && wearers.length < max && <button type="button" className="button button-outline" onClick={() => setEditing({ ...EMPTY_WEARER })}>Add wearer</button>}
      </div>
      <p className="fine">Save sizes and measurements for yourself or the people you shop for (up to {max}).</p>
      {wearers.length > 0 && (
        <ul className="wearer-list">
          {wearers.map((w) => (
            <li key={w.id}>
              <strong>{w.name}</strong>
              <span>{[w.relationship, w.size_label && `Size ${w.size_label}`, ['bust_cm', 'waist_cm', 'hip_cm', 'length_cm'].filter((k) => w[k]).map((k) => `${k.replace('_cm', '')} ${Number(w[k])} cm`).join(' · ')].filter(Boolean).join(' · ')}</span>
              <span className="row-actions">
                <button type="button" className="text-link" onClick={() => setEditing({ ...EMPTY_WEARER, ...w, bust_cm: w.bust_cm ?? '', waist_cm: w.waist_cm ?? '', hip_cm: w.hip_cm ?? '', length_cm: w.length_cm ?? '' })}>Edit</button>
                <button type="button" className="text-link danger" disabled={remove.pending} onClick={() => remove.run(w).catch((err) => setMsg({ tone: 'error', text: err.message }))}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <form
          className="checkout-form"
          noValidate
          onInput={clearOnInput}
          onSubmit={(e) => {
            e.preventDefault();
            const formEl = e.currentTarget;
            if (!editing.name.trim()) {
              setMsg({ tone: 'error', text: 'Please add a name for this wearer.' });
              markFieldError(formEl, 'name', 'wearer-msg');
              return;
            }
            const badMeasure = ['bust_cm', 'waist_cm', 'hip_cm', 'length_cm'].find((k) => editing[k] !== '' && editing[k] !== null && !(Number(editing[k]) > 0 && Number(editing[k]) <= 400));
            if (badMeasure) {
              setMsg({ tone: 'error', text: 'Measurements must be numbers in centimetres (1–400).' });
              markFieldError(formEl, badMeasure, 'wearer-msg');
              return;
            }
            save.run().catch((err) => {
              setMsg({ tone: 'error', text: err.message });
              markFieldError(formEl, err, 'wearer-msg');
            });
          }}
        >
          <div className="form-row">
            <label>Name<input name="name" required maxLength={80} value={editing.name} onChange={set('name')} /></label>
            <label>Relationship<input name="relationship" maxLength={40} value={editing.relationship || ''} onChange={set('relationship')} placeholder="Me, sister, mother…" /></label>
          </div>
          <div className="form-row">
            <label>Usual size<input name="size_label" maxLength={20} value={editing.size_label || ''} onChange={set('size_label')} /></label>
            <label>Bust (cm)<input name="bust_cm" inputMode="decimal" value={editing.bust_cm} onChange={set('bust_cm')} /></label>
          </div>
          <div className="form-row">
            <label>Waist (cm)<input name="waist_cm" inputMode="decimal" value={editing.waist_cm} onChange={set('waist_cm')} /></label>
            <label>Hip (cm)<input name="hip_cm" inputMode="decimal" value={editing.hip_cm} onChange={set('hip_cm')} /></label>
          </div>
          <label>Length (cm)<input name="length_cm" inputMode="decimal" value={editing.length_cm} onChange={set('length_cm')} /></label>
          <div className="row-actions">
            <button className="button button-dark" disabled={save.pending}>{save.pending ? 'Saving…' : 'Save wearer'}</button>
            <button type="button" className="button button-outline" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <InlineMessage id="wearer-msg" tone={msg.tone}>{msg.text}</InlineMessage>
    </div>
  );
}

function Referrals() {
  const { data, error, loading } = useApi('/api/referrals');
  const [copied, setCopied] = useState('');
  if (loading && !data) return <LoadingState minHeight={120} />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied('Link copied.');
    } catch {
      setCopied('Copy the link above.');
    }
  };
  return (
    <div className="account-panel" id="referrals">
      <h2>Refer a friend</h2>
      <p className="fine">Friends who join through your link get ₹{data.offer.discount_inr} off a first {data.offer.plan_months}-month membership. When their first membership payment is confirmed, you receive one free piece.</p>
      <div className="referral-code">
        <span>Your code <strong>{data.code}</strong></span>
        <input readOnly value={data.link} aria-label="Your referral link" onFocus={(e) => e.target.select()} />
        <button type="button" className="button button-outline" onClick={copy}>Copy link</button>
      </div>
      <p className="fine" role="status" aria-live="polite">{copied}</p>
      <div className="account-cards compact">
        <Card label="Successful referrals" value={data.summary.successful} />
        <Card label="Pending" value={data.summary.pending} />
        <Card label="Free pieces earned" value={data.summary.rewards_available + data.summary.rewards_redeemed}>
          <span className="fine">{data.summary.rewards_available} ready · {data.summary.rewards_redeemed} redeemed</span>
          {data.summary.rewards_available > 0 && <Link className="text-link" to="/wardrobe">Choose a piece →</Link>}
        </Card>
      </div>
      {data.history.length > 0 && (
        <table className="account-table">
          <thead><tr><th>Friend</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.id}><td>{h.friend}</td><td>{REF_STATUS[h.status] || h.status}</td><td>{new Date(h.joined_at).toLocaleDateString('en-IN')}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {data.referred_by?.discount_pending && <p className="fine">You joined with code {data.referred_by.code} — your ₹{data.offer.discount_inr} discount is applied when you choose the {data.offer.plan_months}-month membership as your first.</p>}
    </div>
  );
}

/** NFR-04 / ACC-05: self-service erasure. Billing stops first; orders and invoices are kept by law. */
function DeleteAccount({ onDeleted }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState({ tone: 'info', text: '' });
  const del = useMutation(async () => {
    const r = await api('/api/account', { method: 'POST', body: { action: 'delete_data', confirm: typed } });
    setMsg({ tone: 'success', text: r.message });
    setTimeout(onDeleted, 2500);
  });
  return (
    <div className="account-panel" id="delete-account">
      <h2>Delete my account and data</h2>
      {!open ? (
        <button type="button" className="text-link" onClick={() => setOpen(true)}>Delete my account and data…</button>
      ) : (
        <>
          <p className="fine">This cancels your membership and UPI Autopay immediately (unused credits lapse), erases your profile, wearers, addresses, colour profile, saved looks and bag, and signs you out on every device. Orders and GST invoices are kept as the law requires.</p>
          <label>Type DELETE to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="button button-outline" disabled={typed !== 'DELETE' || del.pending} onClick={() => del.run().catch((err) => setMsg({ tone: 'error', text: err.message }))}>Delete everything</button>
            <button type="button" className="text-link" onClick={() => { setOpen(false); setTyped(''); }}>Keep my account</button>
          </div>
        </>
      )}
      <InlineMessage tone={msg.tone}>{msg.text}</InlineMessage>
    </div>
  );
}

export const Account = () => {
  usePageSeo({ noIndex: true });
  const { user, signOut } = useStore();
  const navigate = useNavigate();
  const account = useApi('/api/account');
  const orders = useApi('/api/orders?limit=1');
  const gifts = useApi('/api/gifting');
  const membership = account.data?.membership || { status: 'inactive', credits_balance: 0 };
  const colour = account.data?.colour_profile;
  const rewards = account.data?.rewards || { available: 0, redeemed: 0 };

  return (
    <div>
      <Header />
      <main id="main-content" className="account-page account-layout">
        <AccountNav />
        <section className="account-content">
          <p className="eyebrow">YOUR WARDROBE</p>
          <h1 className="account-h1">Welcome, {account.data?.profile?.full_name || user?.name || 'there'}.</h1>
          <p className="account-lead">{user?.email} · Manage your details, wardrobe, orders and colour profile.</p>

          {account.loading && !account.data ? (
            <LoadingState />
          ) : account.error ? (
            <ErrorState error={account.error} onRetry={account.reload} />
          ) : (
            <>
              <div className="account-cards">
                <Card label="Membership" value={String(membership.status || 'inactive').replace('_', ' ')}>
                  {membership.paid_through && ['active', 'paused'].includes(membership.status) && <span className="fine">Paid until {new Date(membership.paid_through).toLocaleDateString('en-IN')}</span>}
                  <Link to="/membership" className="text-link">Manage membership →</Link>
                </Card>
                <Card label="Credits" value={membership.credits_balance ?? 0}><span className="fine">Available wardrobe credits</span></Card>
                <Card label="Free-piece rewards" value={rewards.available}><Link to="/wardrobe" className="text-link">Wardrobe Bag →</Link></Card>
                <Card label="Orders" value={orders.data?.total ?? '—'}><Link to="/orders" className="text-link">View order history →</Link></Card>
              </div>
              <ProfileForm profile={account.data?.profile} user={user} notifications={account.data?.notifications} onSaved={account.reload} />
              <SizeProfilesSection />
              <Wearers wearers={account.data?.wearers || []} max={account.data?.max_wearers || 5} onChange={account.reload} />
              <div className="account-panel" id="colour">
                <h2>Colour profile</h2>
                {colour ? (
                  <>
                    <p><strong>{colour.season || colour.undertone}</strong>{colour.season ? ` · ${colour.undertone} undertone` : ''} · saved {new Date(colour.created_at).toLocaleDateString('en-IN')}</p>
                    <div className="swatch-row">{(colour.palette || []).map((hex) => <i key={hex} style={{ background: hex }} title={hex} />)}</div>
                    {colour.season && <Link className="text-link" to={`/catalogue?colour_season=${encodeURIComponent(colour.season)}`}>Shop pieces in {colour.season} →</Link>}
                  </>
                ) : (
                  <p className="fine">No saved colour profile yet. <Link to="/skin-tone">Find your colours</Link> — your photo never leaves your device.</p>
                )}
              </div>
            </>
          )}

          <Referrals />

          {gifts.data?.enquiries?.length > 0 && (
            <div className="account-panel">
              <h2>Gift enquiries</h2>
              <table className="account-table">
                <thead><tr><th>Enquiry</th><th>For</th><th>Plan</th><th>Status</th></tr></thead>
                <tbody>
                  {gifts.data.enquiries.map((g) => (
                    <tr key={g.id}><td>{g.enquiry_number}</td><td>{g.recipient_name || (g.request_type === 'corporate' ? `${g.quantity} memberships` : '—')}</td><td>{g.membership_months} months</td><td>{g.refund_status === 'refunded' ? 'refunded' : g.refund_status === 'partial' ? `${g.status} · partly refunded` : g.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {user?.is_admin && (
            <div className="account-admin">
              <div>
                <h3>Administrator access</h3>
                <p>Operations, catalogue and inventory controls.</p>
              </div>
              <Link to="/admin" className="button button-light">Open admin studio →</Link>
            </div>
          )}

          <button type="button" onClick={async () => { await signOut(); navigate('/'); }} className="button button-outline">Sign out</button>

          <DeleteAccount onDeleted={async () => { await signOut().catch(() => {}); navigate('/'); }} />
        </section>
      </main>
      <Footer />
    </div>
  );
};
