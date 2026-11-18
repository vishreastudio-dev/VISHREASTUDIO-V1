// Admin modules added in the V1 remediation. Every action is authorised on the server
// (/api/admin/ops requires an admin session); the UI only reflects what the API allows.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorState, LoadingState } from '../components/Status';

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const dt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const d = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const post = (section, body, method = 'POST') => api(`/api/admin/ops?section=${encodeURIComponent(section)}`, { method, body });

function useSection(path) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api(path), loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error });
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

const Modal = ({ title, onClose, children }) => (
  <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target.classList.contains('modal') && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
    <div className="modal-card wide">
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {children}
    </div>
  </div>
);

function CopyButton({ text, label, toast }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label.replace(/^Copy /, '').replace(/^./, (c) => c.toUpperCase())} copied`);
    } catch {
      toast('Copy is blocked here — select the text above and copy it manually.');
    }
  };
  return <button type="button" className="btn" onClick={copy}>{label}</button>;
}

/* ---------------------------------------------------------------- Gift enquiries */
const NEXT_LABEL = { processed: 'Mark processed', invoiced: 'Mark invoiced' };
const GiftStatus = ({ e }) => (
  <>
    <span className={`status ${e.status === 'invoiced' ? 'good' : 'warn'}`}>{e.status}</span>
    {e.refund_status && <>{' '}<span className="refund-flag">{e.refund_status === 'refunded' ? 'Refunded' : 'Partly refunded'}</span></>}
  </>
);

function GiftEnquiryDetail({ id, onClose, onChanged, toast }) {
  const { data, loading, error, reload } = useSection(`/api/admin/ops?section=gift_enquiry&id=${encodeURIComponent(id)}`);
  const [form, setForm] = useState(null);
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.enquiry) setForm({ admin_notes: data.enquiry.admin_notes || '', invoice_reference: data.enquiry.invoice_reference || '', invoice_amount: data.enquiry.invoice_amount ?? '' });
  }, [data]);
  const act = async (fn, ok) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok);
      await reload();
      onChanged();
      return r;
    } catch (err) {
      toast(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const e = data?.enquiry;
  return (
    <Modal title={e ? `Gift enquiry ${e.enquiry_number}` : 'Gift enquiry'} onClose={onClose}>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : e && form && (
        <div className="form-grid">
          <div className="field full">
            <p><GiftStatus e={e} /> · {e.request_type} · {e.membership_months} months × {e.quantity} · received {dt(e.created_at)}</p>
            <p><strong>From:</strong> {e.sender_name}{e.company_name ? ` (${e.company_name})` : ''} · <a href={`mailto:${e.sender_email}`}>{e.sender_email}</a> · <a href={`tel:${e.sender_phone}`}>{e.sender_phone}</a></p>
            <p><strong>For:</strong> {e.recipient_name || '—'}{e.recipient_email ? ` · ${e.recipient_email}` : ''}{e.recipient_phone ? ` · ${e.recipient_phone}` : ''}</p>
            {e.message && <p><strong>Message:</strong> {e.message}</p>}
            {e.status_changed_at && <p className="fine">Status changed {dt(e.status_changed_at)} by {e.status_changed_by}</p>}
            {e.refund_status && <p className="fine">Razorpay refunded ₹{(Number(e.refunded_amount_paise) / 100).toLocaleString('en-IN')} on {dt(e.refunded_at)}.</p>}
          </div>
          <div className="field full">
            <label htmlFor="ge-notes">Internal notes</label>
            <textarea id="ge-notes" rows={3} maxLength={4000} value={form.admin_notes} onChange={(ev) => setForm({ ...form, admin_notes: ev.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ge-inv">Invoice reference</label>
            <input id="ge-inv" maxLength={80} value={form.invoice_reference} onChange={(ev) => setForm({ ...form, invoice_reference: ev.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ge-amt">Invoice amount (INR)</label>
            <input id="ge-amt" type="number" min="0" step="0.01" value={form.invoice_amount} onChange={(ev) => setForm({ ...form, invoice_amount: ev.target.value })} />
          </div>
          <div className="field full actions">
            <button className="btn" disabled={busy} onClick={() => act(() => post('gift_enquiry', { id: e.id, ...form }), 'Saved')}>Save notes & invoice</button>
            {data.next_statuses.map((s) => (
              <button key={s} className="btn primary" disabled={busy} onClick={() => act(() => post('gift_enquiry', { id: e.id, status: s, ...form }), `Enquiry ${s}`)}>{NEXT_LABEL[s] || s}</button>
            ))}
          </div>
          <div className="field full">
            <h3>Redemption codes</h3>
            <p className="fine">Codes can be issued once the enquiry is invoiced — one per gifted membership ({e.quantity}). The full code is shown once; only its last four characters are kept for reference.</p>
            {issued && (
              <div className="panel" role="status">
                <strong>New code (copy it now — it will not be shown again):</strong>
                <label className="field">
                  <span>Redemption code</span>
                  <input readOnly value={issued.token} onFocus={(ev) => ev.target.select()} style={{ width: '100%' }} />
                </label>
                <label className="field">
                  <span>Redemption link for the recipient</span>
                  <input readOnly value={issued.link} onFocus={(ev) => ev.target.select()} style={{ width: '100%' }} />
                </label>
                <div className="row-actions">
                  <CopyButton text={issued.link} label="Copy link" toast={toast} />
                  <CopyButton text={issued.token} label="Copy code" toast={toast} />
                </div>
                <small>Expires {d(issued.gift.expires_at)}</small>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Code</th><th>Status</th><th>Issued</th><th>Expires</th><th>Redeemed</th><th></th></tr></thead>
                <tbody>
                  {!data.tokens.length && <tr><td colSpan="6" className="empty">No codes issued.</td></tr>}
                  {data.tokens.map((t) => (
                    <tr key={t.id}>
                      <td>…{t.token_hint}</td>
                      <td>{t.status}</td>
                      <td>{d(t.created_at)}</td>
                      <td>{d(t.expires_at)}</td>
                      <td>{t.redeemed_at ? `${d(t.redeemed_at)} · ${t.redeemed_by_email || ''}` : '—'}</td>
                      <td>{t.status === 'issued' && <button className="btn" disabled={busy} onClick={() => window.confirm('Revoke this code?') && act(() => post('gift_token_revoke', { id: t.id }), 'Code revoked')}>Revoke</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {e.status === 'invoiced' && e.refund_status !== 'refunded' && data.tokens.filter((t) => t.status !== 'revoked').length < e.quantity && (
              <button className="btn primary" disabled={busy} onClick={async () => { const r = await act(() => post('gift_token', { enquiry_id: e.id }), 'Code issued'); if (r) setIssued(r); }}>Generate redemption code</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function GiftEnquiriesSection({ toast }) {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useSection(`/api/admin/ops?section=gift_enquiries&status=${status}&q=${encodeURIComponent(search)}`);
  const rows = data?.enquiries || [];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Gift enquiries</h2>
          <p>Enquiry → processed → invoiced → issue a one-time redemption code. Nothing activates without a code.</p>
        </div>
      </div>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <div className="field">
          <label htmlFor="ge-status">Status</label>
          <select id="ge-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['all', 'pending', 'processed', 'invoiced'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ge-q">Search</label>
          <input id="ge-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enquiry no., name, email, company" />
        </div>
      </form>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Enquiry</th><th>From</th><th>For</th><th>Plan</th><th>Status</th><th>Codes</th><th style={{ minWidth: 100, textAlign: 'right', whiteSpace: 'nowrap' }}>Action</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan="8" className="empty">No gift enquiries.</td></tr>}
              {rows.map((e, idx) => (
                <tr key={e.id}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td><strong>{e.enquiry_number}</strong><br /><small>{d(e.created_at)}</small></td>
                  <td>{e.sender_name}{e.company_name ? <small style={{ display: 'block' }}>{e.company_name}</small> : null}<small style={{ display: 'block' }}>{e.sender_email}</small></td>
                  <td>{e.recipient_name || '—'}</td>
                  <td>{e.membership_months} mo × {e.quantity}</td>
                  <td><GiftStatus e={e} /></td>
                  <td>{e.tokens_redeemed}/{e.tokens_issued} redeemed</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}><div className="table-actions"><button type="button" className="btn-action" onClick={() => setOpen(e.id)}>Open</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <GiftEnquiryDetail id={open} onClose={() => setOpen(null)} onChanged={reload} toast={toast} />}
    </section>
  );
}

/* ---------------------------------------------------------------- Couriers */
const EMPTY_COURIER = { name: '', contact_person: '', contact_phone: '', website: '', tracking_url_template: '', service_description: '', service_areas: '', requires_tracking: true, is_pickup: false, is_active: true, sort_order: 100 };

function CourierForm({ courier, onClose, onSaved, toast }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_COURIER, ...Object.fromEntries(Object.entries(courier || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const keys = Object.keys(EMPTY_COURIER);
      await post('courier', { ...(courier?.id ? { id: courier.id } : {}), ...Object.fromEntries(keys.map((k) => [k, typeof form[k] === 'string' ? form[k].trim() : form[k]])) });
      toast(courier?.id ? 'Courier updated' : 'Courier added');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={courier?.id ? `Edit ${courier.name}` : 'Add courier'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <div className="field">
          <label htmlFor="cr-name">Courier company name</label>
          <input id="cr-name" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="cr-person">Contact person</label>
          <input id="cr-person" maxLength={120} value={form.contact_person} onChange={set('contact_person')} />
        </div>
        <div className="field">
          <label htmlFor="cr-phone">Contact number</label>
          <input id="cr-phone" type="tel" maxLength={20} value={form.contact_phone} onChange={set('contact_phone')} />
        </div>
        <div className="field">
          <label htmlFor="cr-web">Website</label>
          <input id="cr-web" type="url" maxLength={300} placeholder="https://" value={form.website} onChange={set('website')} />
        </div>
        <div className="field full">
          <label htmlFor="cr-tpl">Tracking URL template</label>
          <input id="cr-tpl" maxLength={500} placeholder="https://courier.example/track/{tracking}" value={form.tracking_url_template} onChange={set('tracking_url_template')} />
          <small>Use {'{tracking}'} where the AWB number goes. Leave it out for a courier whose tracking page has no deep link; leave the field empty if there is no tracking page.</small>
        </div>
        <div className="field full">
          <label htmlFor="cr-desc">Service description</label>
          <textarea id="cr-desc" rows={2} maxLength={1000} value={form.service_description} onChange={set('service_description')} />
        </div>
        <div className="field full">
          <label htmlFor="cr-areas">Supported service areas</label>
          <input id="cr-areas" maxLength={500} placeholder="e.g. Pan-India, Karnataka metro" value={form.service_areas} onChange={set('service_areas')} />
        </div>
        <div className="field">
          <label htmlFor="cr-sort">Display order</label>
          <input id="cr-sort" type="number" min="0" max="10000" value={form.sort_order} onChange={set('sort_order')} />
        </div>
        <div className="field">
          <label><input type="checkbox" checked={Boolean(form.requires_tracking)} onChange={set('requires_tracking')} /> AWB required to dispatch</label>
          <label><input type="checkbox" checked={Boolean(form.is_pickup)} onChange={set('is_pickup')} /> Studio pickup (no courier hand-off)</label>
          <label><input type="checkbox" checked={Boolean(form.is_active)} onChange={set('is_active')} /> Active</label>
        </div>
        <div className="field full actions">
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save courier'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function CouriersSection({ toast }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useSection(`/api/admin/ops?section=couriers&q=${encodeURIComponent(search)}`);
  const rows = data?.couriers || [];
  const act = async (fn, ok) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Couriers</h2>
          <p>Courier companies offered at dispatch. Deactivating a courier hides it from dispatch; shipments already sent with it keep their details.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing({})}>Add courier</button>
      </div>
      <form className="admin-filter" role="search" aria-label="Search couriers" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <label className="admin-filter-q">
          <span>Search</span>
          <input type="search" value={q} maxLength={80} placeholder="Name, contact or service area" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn" disabled={loading}>Search</button>
      </form>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Courier</th><th>Contact</th><th>Tracking</th><th>Service areas</th><th>Status</th><th>Shipments</th><th style={{ minWidth: 200, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan="8" className="empty">{search ? 'No couriers match this search.' : 'No couriers yet. Add your first courier.'}</td></tr>}
              {rows.map((c, idx) => (
                <tr key={c.id}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td>
                    <strong>{c.name}</strong>
                    {c.website && <small style={{ display: 'block' }}><a href={c.website} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https:\/\//, '')}</a></small>}
                    <small style={{ display: 'block', color: 'var(--muted)' }}>Updated {d(c.updated_at)}</small>
                  </td>
                  <td>{c.contact_person || '—'}{c.contact_phone && <small style={{ display: 'block' }}>{c.contact_phone}</small>}</td>
                  <td>{c.is_pickup ? 'Studio pickup' : c.tracking_url_template ? (c.tracking_url_template.includes('{tracking}') ? 'Deep link' : 'Tracking page') : 'Number only'}{c.requires_tracking && <small style={{ display: 'block' }}>AWB required</small>}</td>
                  <td>{c.service_areas || '—'}</td>
                  <td><span className={`status ${c.is_active ? 'good' : 'warn'}`}>{c.is_active ? 'active' : 'inactive'}</span></td>
                  <td>{c.shipment_count}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <div className="table-actions">
                      <button type="button" className="btn-action" disabled={busy} onClick={() => setEditing(c)}>Edit</button>
                      <button type="button" className="btn-action" disabled={busy} onClick={() => act(() => post('courier_status', { id: c.id, is_active: !c.is_active }), c.is_active ? `${c.name} deactivated` : `${c.name} activated`)}>
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      {c.shipment_count === 0 && (
                        <button
                          type="button"
                          className="btn-action danger"
                          disabled={busy}
                          onClick={() => window.confirm(`Delete ${c.name}? It has never been used on a shipment.`) && act(() => api(`/api/admin/ops?section=courier&id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }), `${c.name} deleted`)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CourierForm courier={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} toast={toast} />}
    </section>
  );
}

/* ---------------------------------------------------------------- Administrators */
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin' };

function AdminForm({ admin, myRole, isSelf, onClose, onSaved, toast }) {
  const [form, setForm] = useState({ email: admin?.email || '', name: admin?.name || '', role: admin?.role || 'admin', active: admin ? admin.active : true });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await post('admin', admin ? { id: admin.id, name: form.name, role: form.role, active: form.active } : { email: form.email, name: form.name, role: form.role });
      toast(r.warning || (admin ? 'Administrator updated' : r.existing_account ? `${form.email} now has admin access` : `${form.email} added. They sign in with an email code.`));
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={admin ? `Edit ${admin.name || admin.email}` : 'Add administrator'} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field full">
          <label htmlFor="adm-email">Email</label>
          <input id="adm-email" type="email" value={form.email} onChange={set('email')} required maxLength={254} disabled={Boolean(admin)} placeholder="name@example.com" autoFocus={!admin} />
          <small>{admin ? 'The email is the sign-in identity and cannot be changed.' : 'If this email already has a customer account, it is given admin access. Otherwise an account is created. There is no password: they sign in with a one-time email code.'}</small>
        </div>
        <div className="field full">
          <label htmlFor="adm-name">Name</label>
          <input id="adm-name" value={form.name} onChange={set('name')} maxLength={120} placeholder="Shown in the audit log" />
        </div>
        <div className="field full">
          <label htmlFor="adm-role">Role</label>
          <select id="adm-role" value={form.role} onChange={set('role')} disabled={isSelf}>
            <option value="admin">Admin: runs the studio day to day</option>
            <option value="owner" disabled={myRole !== 'owner'}>Owner: also manages other owners{myRole !== 'owner' ? ' (owners only)' : ''}</option>
          </select>
          {isSelf && <small>You cannot change your own role.</small>}
        </div>
        {admin && (
          <div className="field full">
            <label><input type="checkbox" checked={form.active} onChange={set('active')} disabled={isSelf} /> Account enabled</label>
            <small>Untick to block all sign-in, including shopping, and sign them out everywhere. To keep their customer account but take away admin access, use Remove instead.</small>
          </div>
        )}
        <div className="field full actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : admin ? 'Save changes' : 'Add administrator'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AdministratorsSection({ toast }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useSection('/api/admin/ops?section=admins');
  const rows = data?.admins || [];
  const myRole = data?.my_role || 'admin';
  const canManage = (a) => a.role !== 'owner' || myRole === 'owner';
  const remove = async (a) => {
    if (!window.confirm(`Remove admin access for ${a.email}?\n\nTheir account stays as a normal customer account (orders and history are kept) and they are signed out everywhere.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/ops?section=admin&id=${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      toast(`${a.email} is no longer an administrator`);
      await reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const status = (a) => {
    if (!a.active) return ['bad', 'Disabled'];
    if (a.on_allowlist === false) return ['warn', 'Blocked by allow-list'];
    return ['good', 'Active'];
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Administrators</h2>
          <p>People who can open this admin panel. They sign in with a one-time email code. Only an owner can add or change owners. You cannot remove or disable yourself.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing({})}>Add administrator</button>
      </div>
      {data?.allowlist_configured && (
        <p className="settings-note">An email allow-list (<code>ADMIN_ALLOWED_EMAILS</code>) is set on the server. A new administrator also has to be added there before they can sign in to the admin panel.</p>
      )}
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Administrator</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Last activity</th><th>Added</th><th style={{ minWidth: 160, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan="8" className="empty">No administrators found.</td></tr>}
              {rows.map((a, idx) => {
                const self = a.id === data.me;
                const [tone, label] = status(a);
                return (
                  <tr key={a.id}>
                    <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                    <td>
                      <strong>{a.name || a.email.split('@')[0]}</strong>{self && <small style={{ marginLeft: 6, color: 'var(--muted)' }}>(you)</small>}
                      <small style={{ display: 'block', color: 'var(--muted)' }}>{a.email}</small>
                    </td>
                    <td>{ROLE_LABEL[a.role]}</td>
                    <td><span className={`status ${tone}`}>{label}</span></td>
                    <td>{dt(a.last_sign_in)}</td>
                    <td>{dt(a.last_activity)}</td>
                    <td>{d(a.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canManage(a) ? (
                        <div className="table-actions">
                          <button type="button" className="btn-action" disabled={busy} onClick={() => setEditing(a)}>Edit</button>
                          {!self && (
                            <button type="button" className="btn-action danger" disabled={busy} onClick={() => remove(a)}>Remove</button>
                          )}
                        </div>
                      ) : <small style={{ color: 'var(--muted)' }}>Owner only</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AdminForm admin={editing.id ? editing : null} myRole={myRole} isSelf={editing.id === data?.me} onClose={() => setEditing(null)} onSaved={reload} toast={toast} />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Referrals & rewards */
export function ReferralsSection() {
  const { data, loading, error, reload } = useSection('/api/admin/ops?section=referrals');
  const rows = data?.referrals || [];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Referrals</h2>
          <p>New customers get the referral discount when their first membership is the 2-month one; the referrer earns one free piece when the friend’s first membership payment (any duration) is verified.</p>
        </div>
      </div>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Referrer</th><th>Friend</th><th>Code</th><th>Status</th><th>Discount</th><th>Reward</th><th>Joined</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan="8" className="empty">No referrals yet.</td></tr>}
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td>{r.referrer_email}</td>
                  <td>{r.referred_email}</td>
                  <td>{r.referral_code}</td>
                  <td><span className={`status ${r.status === 'qualified' ? 'good' : 'warn'}`}>{r.status}</span></td>
                  <td>{Number(r.discount_amount) ? inr(r.discount_amount) : '—'}</td>
                  <td>{r.reward_status || '—'}{r.flag_reason ? <small style={{ display: 'block', color: '#8a2b3e' }}>Flagged: {r.flag_reason}</small> : null}</td>
                  <td>{d(r.attributed_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RewardsSection({ toast }) {
  const { data, loading, error, reload } = useSection('/api/admin/ops?section=rewards');
  const rows = data?.rewards || [];
  const act = async (r, action) => {
    const reason = window.prompt(action === 'void' ? 'Reason for voiding this reward (kept in the audit log)' : 'Note for clearing the flag');
    if (!reason) return;
    try {
      await post('reward', { id: r.id, action, reason });
      toast(action === 'void' ? 'Reward voided' : 'Flag cleared');
      reload();
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Free-piece rewards</h2>
          <p>Free-piece rewards from the 6th consecutive paid month and from referrals. When the payment behind a reward is refunded, an unused reward is revoked automatically; a reward already used is flagged here for your review. No money is deducted.</p>
        </div>
      </div>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Customer</th><th>Type</th><th>Status</th><th>Issued</th><th>Order</th><th>Flag</th><th></th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan="8" className="empty">No rewards issued yet.</td></tr>}
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td>{r.email}</td>
                  <td>{r.kind === 'referral' ? 'Referral' : `6th month #${r.milestone_number}`}</td>
                  <td><span className={`status ${r.status === 'available' ? 'good' : 'warn'}`}>{r.status}</span></td>
                  <td>{d(r.created_at)}</td>
                  <td>{r.order_id ? r.order_id.slice(0, 8).toUpperCase() : '—'}</td>
                  <td>{r.flag_reason || (r.void_reason ? `Void: ${r.void_reason}` : '—')}</td>
                  <td className="actions">
                    {r.status === 'available' && <button className="btn" onClick={() => act(r, 'void')}>Void</button>}
                    {r.flagged_at && <button className="btn" onClick={() => act(r, 'clear_flag')}>Clear flag</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Settings */
const NUMERIC = ['money', 'int', 'percent'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toggle = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

/** Checklist of categories or pieces, filtered by a search box; stores ids. */
function IdPicker({ id, options, value, onChange }) {
  const [q, setQ] = useState('');
  const selected = new Set(value);
  const needle = q.trim().toLowerCase();
  const shown = options.filter((o) => !needle || o.name.toLowerCase().includes(needle)).slice(0, 200);
  return (
    <div className="settings-picker">
      <input id={id} type="search" placeholder={`Search ${options.length} items`} value={q} onChange={(e) => setQ(e.target.value)} />
      <small>{selected.size ? `${selected.size} selected` : 'None selected'}</small>
      <ul>
        {shown.map((o) => (
          <li key={o.id}>
            <label>
              <input type="checkbox" checked={selected.has(o.id)} onChange={() => onChange(toggle(value, o.id))} />
              {o.name}
              {(o.is_active === false || o.archived) && <em> (hidden)</em>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FitPreferenceSettingsEditor({ value = [], onChange }) {
  const options = Array.isArray(value) ? value : [];

  const handleUpdate = (idx, field, val) => {
    const updated = options.map((opt, i) => (i === idx ? { ...opt, [field]: val } : opt));
    onChange(updated);
  };

  const handleToggle = (idx) => {
    const target = options[idx];
    if (target.active) {
      const activeCount = options.filter((o) => o.active).length;
      if (activeCount <= 1) {
        alert('At least one fit preference option must remain active.');
        return;
      }
    }
    handleUpdate(idx, 'active', !target.active);
  };

  const move = (idx, dir) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= options.length) return;
    const next = [...options];
    const temp = next[idx];
    next[idx] = next[targetIdx];
    next[targetIdx] = temp;
    onChange(next.map((o, i) => ({ ...o, sort_order: i + 1 })));
  };

  const addOption = () => {
    const count = options.length + 1;
    const newId = `custom_fit_${count}`;
    const next = [
      ...options,
      {
        id: newId,
        label: `Custom Fit ${count}`,
        description: 'Custom silhouette preference',
        active: true,
        sort_order: count,
      },
    ];
    onChange(next);
  };

  const removeOption = (idx) => {
    if (options.length <= 1) {
      alert('You must have at least one fit preference option.');
      return;
    }
    const filtered = options.filter((_, i) => i !== idx);
    if (!filtered.some((o) => o.active)) {
      alert('At least one fit preference option must remain active.');
      return;
    }
    onChange(filtered.map((o, i) => ({ ...o, sort_order: i + 1 })));
  };

  return (
    <div style={{ background: '#fdfbf9', border: '1px solid #ebdcd0', borderRadius: 8, padding: 14, marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--soft, #666)' }}>
          Active options are displayed to customers in Profile Completion and Size Personalization.
        </p>
        <button type="button" className="btn small" onClick={addOption} style={{ fontSize: 11, padding: '4px 10px' }}>
          + Add Fit Option
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt, idx) => (
          <div
            key={opt.id || idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              background: opt.active ? '#fff' : '#f5f5f5',
              border: `1px solid ${opt.active ? '#e0d6cf' : '#ddd'}`,
              borderRadius: 6,
              opacity: opt.active ? 1 : 0.75,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                style={{ cursor: idx === 0 ? 'default' : 'pointer', border: 'none', background: 'transparent', padding: 0, fontSize: 10 }}
                title="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={idx === options.length - 1}
                onClick={() => move(idx, 1)}
                style={{ cursor: idx === options.length - 1 ? 'default' : 'pointer', border: 'none', background: 'transparent', padding: 0, fontSize: 10 }}
                title="Move down"
              >
                ▼
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', margin: 0, fontSize: 12, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={opt.active !== false}
                onChange={() => handleToggle(idx)}
              />
              <span style={{ color: opt.active ? 'var(--wine, #752238)' : '#888' }}>
                {opt.active ? 'Active' : 'Inactive'}
              </span>
            </label>

            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '120px 180px 1fr', gap: 8 }}>
              <input
                type="text"
                placeholder="ID (e.g. relaxed)"
                value={opt.id || ''}
                onChange={(e) => handleUpdate(idx, 'id', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                style={{ fontSize: 12, padding: '4px 8px' }}
                title="System identifier"
              />
              <input
                type="text"
                placeholder="Customer Label"
                value={opt.label || ''}
                onChange={(e) => handleUpdate(idx, 'label', e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', fontWeight: 500 }}
                title="Visible title shown to customer"
              />
              <input
                type="text"
                placeholder="Fit description (e.g. drape notes)"
                value={opt.description || ''}
                onChange={(e) => handleUpdate(idx, 'description', e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px' }}
                title="Helpful customer hint"
              />
            </div>

            <button
              type="button"
              onClick={() => removeOption(idx)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#b00',
                cursor: 'pointer',
                fontSize: 14,
                padding: '4px 8px',
              }}
              title="Delete option"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingInput({ name, meta, value, options, onChange }) {
  const id = `set-${name}`;
  if (meta.type === 'json' && name === 'fit_preference_options') {
    return <FitPreferenceSettingsEditor value={value} onChange={onChange} />;
  }
  if (meta.type === 'bool') {
    return (
      <label className="settings-check" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {value ? 'On' : 'Off'}
      </label>
    );
  }
  if (meta.type === 'choice') {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {meta.choices.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
      </select>
    );
  }
  if (meta.type === 'int_list' || meta.type === 'text_list') {
    return (
      <div className="settings-checks" id={id} role="group">
        {meta.choices.map((c) => (
          <label key={c}>
            <input type="checkbox" checked={(value || []).includes(c)} onChange={() => onChange(toggle(value || [], c).sort((a, b) => (meta.type === 'int_list' ? a - b : 0)))} /> {String(c)}
          </label>
        ))}
      </div>
    );
  }
  if (meta.type === 'uuid_list') return <IdPicker id={id} options={options[meta.ref] || []} value={value || []} onChange={onChange} />;
  if (NUMERIC.includes(meta.type)) {
    return (
      <input
        id={id}
        type="number"
        step={meta.type === 'money' ? '0.01' : '1'}
        min={meta.min ?? 0}
        max={meta.max}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  }
  return name === 'seller_address'
    ? <textarea id={id} rows={3} maxLength={meta.max || 400} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    : <input id={id} type={name.endsWith('_email') ? 'email' : name.endsWith('_phone') ? 'tel' : 'text'} maxLength={meta.max || 200} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function SettingsSection({ toast }) {
  const { data, loading, error, reload } = useSection('/api/admin/ops?section=settings');
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (data) setValues(Object.fromEntries(Object.entries(data.meta).map(([k, m]) => [k, m.value])));
  }, [data]);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const meta = data.meta;
  const keysOf = (group) => Object.keys(meta).filter((k) => meta[k].group === group);
  const save = async (group) => {
    if (busy) return;
    const settings = {};
    for (const k of keysOf(group)) if (!same(values[k], meta[k].value)) settings[k] = values[k];
    if (!Object.keys(settings).length) return toast('Nothing to save');
    setBusy(group);
    try {
      await post('settings', { settings });
      toast('Settings saved');
      reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(null);
    }
  };
  const { storage, admins } = data;
  return (
    <div>
      <p className="settings-note">
        Values marked <span className="settings-badge confirmed">Confirmed</span> are agreed business rules. Values marked{' '}
        <span className="settings-badge proposal">Owner to confirm</span> are working defaults awaiting the owner. Every change is recorded in the history below.
      </p>
      {data.groups.map((g) => {
        const keys = keysOf(g.id);
        const dirty = keys.some((k) => !same(values[k], meta[k].value));
        return (
          <section className="panel" key={g.id}>
            <div className="panel-head"><div><h2>{g.label}</h2></div></div>
            {data.fixed_rules[g.id] && (
              <ul className="settings-rules">
                {data.fixed_rules[g.id].map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(g.id); }}>
              {keys.map((k) => (
                <div className={`field${meta[k].type === 'uuid_list' || k === 'seller_address' ? ' full' : ''}`} key={k}>
                  <label htmlFor={`set-${k}`}>
                    {meta[k].label}{' '}
                    <span className={`settings-badge ${meta[k].confirmed ? 'confirmed' : 'proposal'}`}>{meta[k].confirmed ? 'Confirmed' : 'Owner to confirm'}</span>
                  </label>
                  <SettingInput name={k} meta={meta[k]} value={values[k]} options={data.options} onChange={(v) => setValues((s) => ({ ...s, [k]: v }))} />
                  {meta[k].help && <small>{meta[k].help}</small>}
                </div>
              ))}
              <div className="field full"><button className="btn primary" disabled={Boolean(busy) || !dirty}>{busy === g.id ? 'Saving…' : `Save ${g.label.toLowerCase()}`}</button></div>
            </form>
          </section>
        );
      })}

      <section className="panel">
        <div className="panel-head"><div><h2>Hosting & uploads</h2><p className="settings-note">Read-only. Change storage through the hosting configuration, not here.</p></div></div>
        <dl className="settings-status">
          <div><dt>Storage</dt><dd>{storage.provider}</dd></div>
          {(storage.buckets || []).map((b) => (
            <div key={b.id}><dt>{b.id}</dt><dd>{b.access} · {b.purposes.join(', ')}</dd></div>
          ))}
          <div><dt>Private links</dt><dd>Valid for {Math.round((storage.signed_url_seconds || 0) / 60)} minutes</dd></div>
          <div><dt>Size limits</dt><dd>Customer images {storage.limits?.customer_image_mb} MB · admin images {storage.limits?.admin_image_mb} MB · videos {storage.limits?.video_mb} MB</dd></div>
          {storage.local && (
            <>
              <div><dt>Local folder</dt><dd>{storage.local.location}{storage.local.writable ? '' : ' (not writable)'}</dd></div>
              <div><dt>Stored files</dt><dd>{storage.local.file_count} ({mb(storage.local.total_bytes)})</dd></div>
              <div><dt>Unused-file cleanup</dt><dd>{storage.local.orphan_cleanup_days ? `After ${storage.local.orphan_cleanup_days} days` : 'Off'}</dd></div>
            </>
          )}
        </dl>
        {storage.local?.warning && <p className="settings-warning" role="status">{storage.local.warning}</p>}
        {storage.driver === 'local' && <p className="settings-warning" role="status">Uploads are on this server’s disk (development store). Production must use Supabase Storage (STORAGE_DRIVER=supabase).</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Administrators</h2>
            <p className="settings-note">
              Read-only here; add, edit or remove administrators in <Link to="/admin/administrators">Administrators</Link>. {admins.allowlist_configured
                ? 'Only accounts on the approved list (ADMIN_ALLOWED_EMAILS) have admin access.'
                : 'No approved list is set, so every account with an admin role has access. Ask the developer to set ADMIN_ALLOWED_EMAILS to the accounts you approve.'}
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Approved list</th><th>Admin access</th><th>Created</th><th>Last admin action</th></tr></thead>
            <tbody>
              {admins.accounts.map((a) => (
                <tr key={a.email}>
                  <td>{a.email}</td>
                  <td>{a.role}{a.active ? '' : ' (disabled)'}</td>
                  <td>{a.on_allowlist === null ? '—' : a.on_allowlist ? 'Yes' : 'No'}</td>
                  <td>{a.has_admin_access ? 'Yes' : 'No'}</td>
                  <td>{d(a.created_at)}</td>
                  <td>{dt(a.last_admin_action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Change history</h2></div></div>
        {data.history.length ? (
          <ul className="settings-history">
            {data.history.map((h) => (
              <li key={`${h.created_at}-${h.changed_by}`}>
                <strong>{dt(h.created_at)}</strong> · {h.changed_by || 'unknown'}
                <ul>
                  {Object.entries(h.details || {}).map(([k, c]) => (
                    <li key={k}>{meta[k]?.label || k}: {c && typeof c === 'object' && 'after' in c ? `${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}` : JSON.stringify(c)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : <p className="settings-note">No changes recorded yet.</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Legal & store editors */
export function LegalEditor({ pages, store, toast, onSaved }) {
  const [slug, setSlug] = useState('');
  const [page, setPage] = useState(null);
  const [storeForm, setStoreForm] = useState(null);
  useEffect(() => {
    const s = (store || [])[0];
    if (s) setStoreForm({ id: s.id, store_name: s.store_name || '', pickup_enabled: s.pickup_enabled !== false, pickup_note: s.pickup_note || '' });
  }, [store]);
  useEffect(() => {
    if (!slug) return setPage(null);
    api(`/api/legal?slug=${encodeURIComponent(slug)}`).then((r) => setPage({ slug, title: r.page?.title || '', body: r.page?.body || '' })).catch((err) => toast(err.message));
    // Only a new selection reloads the text; re-renders must not discard unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  const saveLegal = async (e) => {
    e.preventDefault();
    try {
      await post('content', { type: 'legal', ...page });
      toast('Policy saved');
      onSaved();
    } catch (err) {
      toast(err.message);
    }
  };
  const saveStore = async (e) => {
    e.preventDefault();
    try {
      await post('content', { type: 'store', ...storeForm });
      toast('Store settings saved');
      onSaved();
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <div className="grid2" style={{ marginTop: 24 }}>
      <section className="panel">
        <div className="panel-head"><div><h2>Edit a policy</h2><p>Changes publish immediately to /legal pages.</p></div></div>
        <div className="field">
          <label htmlFor="legal-slug">Policy</label>
          <select id="legal-slug" value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">Choose…</option>
            {(pages || []).map((p) => <option key={p.slug} value={p.slug}>{p.title || p.slug}</option>)}
          </select>
        </div>
        {page && (
          <form className="form-grid" onSubmit={saveLegal}>
            <div className="field full"><label htmlFor="legal-title">Title</label><input id="legal-title" required maxLength={160} value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })} /></div>
            <div className="field full"><label htmlFor="legal-body">Text</label><textarea id="legal-body" required rows={12} maxLength={50000} value={page.body} onChange={(e) => setPage({ ...page, body: e.target.value })} /></div>
            <div className="field full"><button className="btn primary">Save policy</button> <Link className="btn" to={`/legal/${page.slug}`} target="_blank">View</Link></div>
          </form>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Studio pickup</h2><p>Shown at checkout and on the storefront.</p></div></div>
        {storeForm ? (
          <form className="form-grid" onSubmit={saveStore}>
            <div className="field full"><label htmlFor="store-name">Store name</label><input id="store-name" required maxLength={120} value={storeForm.store_name} onChange={(e) => setStoreForm({ ...storeForm, store_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="store-pickup">Pickup</label>
              <select id="store-pickup" value={String(storeForm.pickup_enabled)} onChange={(e) => setStoreForm({ ...storeForm, pickup_enabled: e.target.value === 'true' })}>
                <option value="true">Enabled</option><option value="false">Disabled</option>
              </select>
            </div>
            <div className="field full"><label htmlFor="store-note">Pickup note</label><input id="store-note" maxLength={300} value={storeForm.pickup_note} onChange={(e) => setStoreForm({ ...storeForm, pickup_note: e.target.value })} /></div>
            <div className="field full"><button className="btn primary">Save pickup settings</button></div>
          </form>
        ) : <p className="empty">No store settings row.</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Customer drill-down */
export function CustomerDetail({ id, onClose }) {
  const { data, loading, error, reload } = useSection(`/api/admin/ops?section=customer&id=${encodeURIComponent(id)}`);
  const p = data?.profile;
  const m = data?.membership;
  const stats = data?.stats;
  const loyalty = stats?.loyalty;

  return (
    <Modal title={p ? p.full_name || p.email : 'Customer'} onClose={onClose}>
      {loading && !data ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : p && (
        <div className="customer-detail">
          <p>{p.email} · {p.phone || 'no phone'} · joined {d(p.created_at)} · role {p.role}{p.is_active === false ? ' · disabled' : ''}{p.referral_code ? ` · referral code ${p.referral_code}` : ''}</p>
          
          {/* Key Purchase & Spend Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, background: '#fbf9f6', padding: 12, borderRadius: 6, margin: '12px 0', border: '1px solid #efe8df' }}>
            <div>
              <small style={{ color: '#777', fontSize: 11, textTransform: 'uppercase' }}>Lifetime Orders</small>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink, #1a1a1a)' }}>{stats?.lifetime_orders ?? 0}</div>
            </div>
            <div>
              <small style={{ color: '#777', fontSize: 11, textTransform: 'uppercase' }}>Lifetime Spend</small>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink, #1a1a1a)' }}>{inr(stats?.lifetime_spend || 0)}</div>
            </div>
            <div>
              <small style={{ color: '#777', fontSize: 11, textTransform: 'uppercase' }}>Average Order</small>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink, #1a1a1a)' }}>{inr(stats?.aov || 0)}</div>
            </div>
            <div>
              <small style={{ color: '#777', fontSize: 11, textTransform: 'uppercase' }}>Last Purchase</small>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink, #1a1a1a)', marginTop: 2 }}>{stats?.last_purchase_date ? d(stats.last_purchase_date) : 'No orders yet'}</div>
            </div>
          </div>

          {/* CRM Notes */}
          {p.notes && (
            <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, padding: '10px 14px', margin: '10px 0', fontSize: 13 }}>
              <strong>Client Notes:</strong> <span style={{ color: '#555' }}>{p.notes}</span>
            </div>
          )}

          {/* 6-Stamp Customer Loyalty Card */}
          <div style={{ background: '#fcfaf7', border: '1px solid #ebd9c0', borderRadius: 8, padding: 16, margin: '14px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h4 style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 12, color: '#543b18' }}>
                  6-Purchase Stamp Card · Cycle {loyalty?.cycleNumber || 1}
                </h4>
                <small style={{ color: '#888', fontSize: 11 }}>Every 6 purchases form 1 cycle. 5 stamps qualify for 50% off next purchase.</small>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: loyalty?.isRewardEligible ? '#b8860b' : '#543b18' }}>
                {loyalty?.currentStamp ?? 0} / 6 Stamps
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, textAlign: 'center', margin: '8px 0' }}>
              {[1, 2, 3, 4, 5, 6].map((stampNum) => {
                const isEarned = (loyalty?.currentStamp || 0) >= stampNum;
                const isRewardStamp = stampNum === 6;
                return (
                  <div key={stampNum} style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        border: isEarned ? '2px solid #543b18' : isRewardStamp ? '2px dashed #b8860b' : '1px dashed #ccc',
                        background: isEarned ? '#543b18' : isRewardStamp ? '#fffdf7' : '#fff',
                        color: isEarned ? '#fff' : isRewardStamp ? '#b8860b' : '#999',
                        borderRadius: '50%',
                        width: 42,
                        height: 42,
                        margin: '0 auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {isEarned ? '✓' : isRewardStamp ? '50%' : stampNum}
                    </div>
                    <small style={{ fontSize: 10, color: isRewardStamp ? '#b8860b' : '#888', marginTop: 4, display: 'block' }}>
                      {isRewardStamp ? '50% off' : `Buy ${stampNum}`}
                    </small>
                  </div>
                );
              })}
            </div>
            {loyalty?.isRewardEligible && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fdf3d8', border: '1px solid #f2cf7e', borderRadius: 4, color: '#7a5200', fontSize: 12, fontWeight: 600 }}>
                REWARD ELIGIBLE: Customer has completed 5 purchases! Staff can manually enter 50% discount on next counter sale. Cycle resets after purchase 6.
              </div>
            )}
          </div>

          <h3>Membership</h3>
          {m ? <p>{m.status} · paid until {d(m.paid_through)} · {m.credits_balance} credits · {m.consecutive_paid_months} consecutive months</p> : <p className="empty">No membership.</p>}
          {data.periods.length > 0 && (
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Month</th><th>Source</th><th>Starts</th><th>Credits</th><th>State</th></tr></thead>
                <tbody>{data.periods.map((x, i) => <tr key={i}><td>{x.streak_month}</td><td>{x.source}</td><td>{d(x.starts_at)}</td><td>{x.credits}</td><td>{x.voided_at ? 'void' : x.credits_granted_at ? 'granted' : 'upcoming'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <h3>Wearer profiles</h3>
          {data.wearers.length ? <ul>{data.wearers.map((w) => <li key={w.id}>{w.name}{w.relationship ? ` (${w.relationship})` : ''}{w.size_label ? ` · size ${w.size_label}` : ''}{['bust_cm', 'waist_cm', 'hip_cm', 'length_cm'].filter((k) => w[k]).map((k) => ` · ${k.replace('_cm', '')} ${Number(w[k])}cm`).join('')}</li>)}</ul> : <p className="empty">None saved.</p>}
          <h3>Colour profile</h3>
          {data.colour_reviews[0] ? (
            <p>{data.colour_reviews[0].season || '—'} · {data.colour_reviews[0].undertone} · {d(data.colour_reviews[0].created_at)} <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>{(data.colour_reviews[0].palette || []).map((h) => <i key={h} style={{ width: 16, height: 16, background: h, display: 'inline-block' }} />)}</span></p>
          ) : <p className="empty">No colour profile saved.</p>}
          
          <h3>Purchase Timeline</h3>
          <div className="table-wrap">
            <table className="table"><thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Date</th><th>Items</th><th>Status</th><th>Total</th><th>Reward</th></tr></thead>
              <tbody>
                {!data.orders.length && <tr><td colSpan="6" className="empty">No orders.</td></tr>}
                {data.orders.map((o, idx) => (
                  <tr key={o.id}>
                    <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                    <td>{d(o.created_at)}</td>
                    <td>{o.items.map((i) => `${i.name} (${i.size}) ×${i.qty}`).join(', ')}</td>
                    <td>{o.payment_status === 'paid' ? o.status : o.payment_status}</td>
                    <td><strong>{inr(o.total)}</strong></td>
                    <td>
                      {Number(o.discount_amount) > 0 || o.rewards_used > 0 ? (
                        <span className="status good" style={{ fontSize: 10, padding: '2px 6px' }}>50% / Reward</span>
                      ) : (
                        <span style={{ color: '#aaa', fontSize: 11 }}>Standard</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Rewards & referrals</h3>
          <p>{data.rewards.length} reward(s): {data.rewards.map((r) => `${r.kind} ${r.status}`).join(', ') || '—'} · {data.referrals.length} referral record(s)</p>
          <h3>Recent credit ledger</h3>
          <div className="table-wrap">
            <table className="table"><thead><tr><th style={{ width: 44, textAlign: 'center' }}>#</th><th>Date</th><th>Change</th><th>Reason</th><th>Expires</th></tr></thead>
              <tbody>{data.credits.slice(0, 15).map((c, i) => <tr key={i}><td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td><td>{d(c.created_at)}</td><td>{c.delta > 0 ? `+${c.delta}` : c.delta}</td><td>{c.reason}</td><td>{d(c.expires_at)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
