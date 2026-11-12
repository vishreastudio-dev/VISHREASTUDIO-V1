import React from 'react';
import { Link } from 'react-router-dom';
import { Header, Footer } from '../components/Layout';
import { AccountNav, STATUS_LABEL, statusTone } from '../components/AccountNav';
import { EmptyState, ErrorState, LoadingState } from '../components/Status';
import { formatINR } from '../lib/api';
import { useApi } from '../lib/useApi';
import { usePageSeo } from '../lib/usePageSeo';

export const Orders = () => {
  usePageSeo({ noIndex: true });
  const { data, error, loading, reload } = useApi('/api/orders?limit=50');
  const orders = data?.orders || [];

  return (
    <div>
      <Header />
      <main id="main-content" className="account-page account-layout">
        <AccountNav />
        <section className="account-content">
          <p className="eyebrow">ORDER HISTORY</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, margin: '8px 0 24px' }}>Your orders.</h1>
          {loading ? (
            <LoadingState label="Loading your orders…" />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !orders.length ? (
            <EmptyState title="No orders yet." action={<Link className="button button-dark" to="/catalogue">Explore the catalogue →</Link>} />
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {orders.map((o) => {
                const items = o.items || [];
                const cover = items.find((i) => i.image_url);
                const more = items.length - 1;
                return (
                <article key={o.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <Link to={`/orders/${o.id}`} className="order-thumb" aria-label={`View order #${o.id.slice(0, 8).toUpperCase()}`}>
                    {cover ? <img src={cover.image_url} alt="" loading="lazy" width="72" height="90" /> : <span aria-hidden="true">V</span>}
                    {more > 0 && <small>+{more}</small>}
                  </Link>
                  <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                    <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                      {new Date(o.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                      {o.invoice_number ? ` · Invoice ${o.invoice_number}` : ''}
                    </small>
                    <h2 style={{ margin: '6px 0 4px', fontSize: '17px' }}>Order #{o.id.slice(0, 8).toUpperCase()}</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>{(o.items || []).map((i) => `${i.name}${i.size ? ` (${i.size})` : ''}`).join(', ') || 'Vishrea Studio pieces'}</p>
                  </div>
                  <div style={{ textAlign: 'right', display: 'grid', gap: 6, justifyItems: 'end' }}>
                    <strong style={{ fontSize: '18px' }}>{formatINR(o.total)}</strong>
                    <span className={`status ${statusTone(o.payment_status === 'paid' ? o.status : o.payment_status)}`}>
                      {o.payment_status === 'paid' ? STATUS_LABEL[o.status] || o.status : STATUS_LABEL[o.payment_status] || o.payment_status}
                    </span>
                    <Link className="text-link" to={`/orders/${o.id}`} style={{ fontSize: 11 }}>View details →</Link>
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
