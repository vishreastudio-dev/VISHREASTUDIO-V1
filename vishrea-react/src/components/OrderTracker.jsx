import React from 'react';

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
const addDays = (iso, days) => (iso ? new Date(new Date(iso).getTime() + days * 86_400_000).toISOString() : null);

const STAGE = { processing: 1, packed: 2, dispatched: 3, delivered: 4 };

const EXCHANGE_STEPS = [
  ['requested', 'Request received'],
  ['review', 'Under review'],
  ['approved', 'Approved'],
  ['completed', 'Completed'],
];

export function isTrackable(o) {
  return o.payment_status === 'paid' && STAGE[o.status] !== undefined;
}

/** True while the order can still change state for the customer. */
export function isActiveOrder(o) {
  if (!o) return false;
  const openExchange = (o.exchanges || []).some((x) => ['requested', 'review', 'approved'].includes(x.status));
  if (openExchange) return true;
  if (o.payment_status === 'refund_required') return true;
  return o.payment_status === 'paid' && !['delivered', 'cancelled', 'refunded'].includes(o.status);
}

function CourierLink({ courier, url }) {
  if (!url || !/^https:\/\//.test(url)) return null;
  return (
    <a className="tracker-track-link" href={url} target="_blank" rel="noopener noreferrer">
      Track with {courier || 'the courier'} →
    </a>
  );
}

function Step({ index, label, at, detail, state, pulse, children }) {
  return (
    <li className={`tracker-step is-${state}${pulse ? ' is-updated' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="tracker-dot" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
      <div className="tracker-body">
        <strong>{label}</strong>
        {at && <time dateTime={at}>{fmt(at)}</time>}
        {detail && <p>{detail}</p>}
        {children}
      </div>
    </li>
  );
}

function Timeline({ steps, current, pulseKey }) {
  const progress = steps.length > 1 ? (Math.min(current, steps.length - 1) / (steps.length - 1)) * 100 : 0;
  return (
    <div className="tracker-rail">
      <div className="tracker-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="tracker-steps">
        {steps.map((s, i) => (
          <Step
            key={s.key}
            index={i}
            label={s.label}
            at={i <= current ? s.at : null}
            detail={i <= current ? s.detail : s.upcoming}
            state={i < current || (i === current && s.final) ? 'done' : i === current ? 'current' : 'upcoming'}
            pulse={i === current && pulseKey}
          >
            {i <= current && s.extra}
          </Step>
        ))}
      </ol>
    </div>
  );
}

function fulfilmentSteps(o, policy) {
  const pickup = o.shipping_method === 'pickup' || o.courier_is_pickup;
  const exchangeUntil = addDays(o.delivered_at, policy?.exchange_days || 7);
  return [
    {
      key: 'confirmed',
      label: 'Order confirmed',
      at: o.paid_at,
      detail: o.invoice_number ? `Payment verified · Tax invoice ${o.invoice_number}` : 'Payment verified',
    },
    {
      key: 'processing',
      label: 'Being prepared',
      at: null,
      detail: 'Your piece is being prepared in our Bengaluru studio.',
      upcoming: 'The studio prepares your piece.',
    },
    {
      key: 'packed',
      label: 'Quality checked & packed',
      at: o.packed_at,
      detail: o.gift ? 'Inspected by the studio and gift-wrapped.' : 'Inspected by the studio and packed.',
      upcoming: 'Each piece is inspected before it is packed.',
    },
    {
      key: 'dispatched',
      label: pickup ? 'Ready for pickup' : 'Dispatched',
      at: o.dispatch_at,
      detail: pickup
        ? 'Ready at the Bengaluru studio. Bring your order number.'
        : [o.courier_partner && `Handed to ${o.courier_partner}`, o.tracking_number && `Tracking ${o.tracking_number}`].filter(Boolean).join(' · ') || 'Handed to the courier',
      upcoming: pickup ? 'We will tell you when it is ready to collect.' : 'Courier and tracking details appear here.',
      extra: !pickup && <CourierLink courier={o.courier_partner} url={o.tracking_url} />,
    },
    {
      key: 'delivered',
      label: pickup ? 'Collected' : 'Delivered',
      at: o.delivered_at,
      detail: exchangeUntil ? `Exchange window open until ${fmtDate(exchangeUntil)}.` : null,
      upcoming: `Exchanges open for ${policy?.exchange_days || 7} days after delivery.`,
      final: true,
    },
  ];
}

function BranchTimeline({ o }) {
  const paid = Boolean(o.paid_at);
  const refundState = o.payment_status === 'refunded' || o.status === 'refunded' ? 'refunded' : o.payment_status === 'refund_required' ? 'refund_required' : null;
  const steps = [{ key: 'placed', label: 'Order placed', at: o.created_at, state: 'done' }];
  if (paid) steps.push({ key: 'paid', label: 'Payment received', at: o.paid_at, state: 'done' });
  if (o.status === 'cancelled') steps.push({ key: 'cancelled', label: 'Order cancelled', at: o.cancelled_at, state: 'done', detail: paid ? 'Pieces returned to the studio.' : 'No payment was taken.' });
  if (refundState) {
    steps.push({
      key: 'refund_initiated',
      label: 'Refund initiated',
      at: null,
      state: 'done',
      detail: o.payment_failure_reason === 'out_of_stock' ? 'A piece sold out before your payment completed.' : 'A full refund to your original payment method.',
    });
    steps.push({
      key: 'refunded',
      label: refundState === 'refunded' ? 'Refund completed' : 'Refund processing',
      at: o.refunded_at,
      state: refundState === 'refunded' ? 'done' : 'current',
      detail:
        refundState === 'refunded'
          ? `${o.razorpay_refund_id ? `Razorpay reference ${o.razorpay_refund_id}. ` : ''}Banks usually show it within 5–7 working days.`
          : 'Razorpay is processing the refund. This page updates when it completes.',
    });
  }
  return (
    <ol className="tracker-steps tracker-branch">
      {steps.map((s, i) => (
        <Step key={s.key} index={i} label={s.label} at={s.at} detail={s.detail} state={s.state} />
      ))}
    </ol>
  );
}

function ExchangePanel({ exchange }) {
  if (!exchange) return null;
  if (['rejected', 'not_approved'].includes(exchange.status)) {
    return (
      <div className="tracker-exchange" style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '14px 16px', borderRadius: 4, marginTop: 18 }}>
        <p className="eyebrow" style={{ color: '#991b1b', margin: '0 0 4px', fontSize: 10 }}>{exchange.claim_type === 'damage' ? 'DAMAGE REPORT' : 'EXCHANGE'}</p>
        <strong style={{ color: '#991b1b', fontSize: 14, display: 'block', marginBottom: 4 }}>
          {exchange.status === 'not_approved' ? 'Exchange Not Approved' : 'Request Closed'}
        </strong>
        {exchange.resolution && <p style={{ color: '#7f1d1d', margin: 0, fontSize: 12, lineHeight: 1.5 }}>{exchange.resolution}</p>}
      </div>
    );
  }
  const idx = Math.max(0, EXCHANGE_STEPS.findIndex(([k]) => k === exchange.status));
  return (
    <div className="tracker-exchange">
      <p className="eyebrow">{exchange.status === 'completed' ? 'EXCHANGE COMPLETED' : 'EXCHANGE IN PROGRESS'}</p>
      <ol className="tracker-mini">
        {EXCHANGE_STEPS.map(([k, label], i) => (
          <li key={k} className={i < idx || exchange.status === 'completed' ? 'is-done' : i === idx ? 'is-current' : ''}>
            {label}
          </li>
        ))}
      </ol>
      {exchange.resolution && <p>{exchange.resolution}</p>}
    </div>
  );
}

export function OrderTracker({ order: o, policy, pulseKey, live }) {
  const branch = ['cancelled', 'refund_required', 'refunded', 'expired'].includes(o.status) || ['refund_required', 'refunded'].includes(o.payment_status);
  const latestExchange = (o.exchanges || [])[0];
  if (!branch && !isTrackable(o)) return null;

  return (
    <section className="order-tracker no-print" aria-labelledby="tracker-title">
      <div className="tracker-head">
        <h2 id="tracker-title">{branch ? 'Order status' : 'Track your order'}</h2>
        {live && (
          <span className="tracker-live" title="This page refreshes automatically">
            <i aria-hidden="true" /> Live
          </span>
        )}
      </div>
      {branch ? <BranchTimeline o={o} /> : <Timeline steps={fulfilmentSteps(o, policy)} current={STAGE[o.status]} pulseKey={pulseKey} />}
      <ExchangePanel exchange={latestExchange} />
    </section>
  );
}
