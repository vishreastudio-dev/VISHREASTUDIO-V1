// Local stand-in for the Razorpay REST API used by lib/razorpay.js. No request ever leaves the
// machine. Failure modes for recovery tests: POST /__mode {"mode":"ok"|"timeout"|"error500"|"garbage"}.
//   node tests/qa/razorpay-standin.mjs [port]
import crypto from 'crypto';
import http from 'http';
import { pathToFileURL } from 'url';
import path from 'path';

export function startGateway(port = 0) {
  const orders = new Map();
  const payments = new Map();
  const plans = new Map();
  const subs = new Map();
  const invoices = new Map();
  const stats = { requests: 0, byRoute: {} };
  let mode = 'ok';
  const id = (p) => `${p}_${crypto.randomBytes(7).toString('hex')}`;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__mode' && req.method === 'POST') {
        mode = JSON.parse(body || '{}').mode || 'ok';
        return send(200, { mode });
      }
      if (url.pathname === '/__stats') return send(200, { mode, ...stats, orders: orders.size, payments: payments.size });
      const route = `${req.method} ${url.pathname.replace(/\/(order|pay|sub|inv)_[A-Za-z0-9]+/g, '/:id')}`;
      stats.requests += 1;
      stats.byRoute[route] = (stats.byRoute[route] || 0) + 1;
      if (mode === 'timeout') return; // never answers; the client's timeout must fire
      if (mode === 'error500') return send(500, { error: { code: 'SERVER_ERROR', description: 'stand-in failure' } });
      if (mode === 'garbage') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{not json');
      }
      const j = body ? JSON.parse(body) : {};
      let m;
      if (req.method === 'POST' && url.pathname === '/orders') {
        const o = { id: id('order'), entity: 'order', amount: j.amount, currency: j.currency || 'INR', receipt: j.receipt, notes: j.notes || {}, status: 'created', created_at: Math.floor(Date.now() / 1000) };
        orders.set(o.id, o);
        return send(200, o);
      }
      if ((m = url.pathname.match(/^\/payments\/([^/]+)$/)) && req.method === 'GET') {
        const p = payments.get(m[1]);
        return p ? send(200, p) : send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
      }
      if ((m = url.pathname.match(/^\/payments\/([^/]+)\/capture$/))) {
        const p = payments.get(m[1]);
        if (!p) return send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
        p.status = 'captured';
        p.captured = true;
        return send(200, p);
      }
      if ((m = url.pathname.match(/^\/payments\/([^/]+)\/refund$/))) {
        const p = payments.get(m[1]);
        if (!p) return send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
        return send(200, { id: id('rfnd'), entity: 'refund', payment_id: p.id, amount: j.amount ?? p.amount, status: 'processed' });
      }
      if (req.method === 'POST' && url.pathname === '/plans') {
        const plan = { id: id('plan'), entity: 'plan', period: 'monthly', interval: 1, item: { name: j.item?.name || 'plan', amount: j.item?.amount, currency: j.item?.currency || 'INR', description: j.item?.description || '' } };
        plans.set(plan.id, plan);
        return send(200, plan);
      }
      if ((m = url.pathname.match(/^\/plans\/([^/]+)$/)) && req.method === 'GET') {
        const plan = plans.get(m[1]);
        return plan ? send(200, plan) : send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
      }
      if (req.method === 'POST' && url.pathname === '/subscriptions') {
        const sub = { id: id('sub'), entity: 'subscription', status: 'created', plan_id: j.plan_id, start_at: j.start_at || null, charge_at: j.start_at || null, addons: j.addons || [], short_url: 'http://127.0.0.1/qa-subscription' };
        subs.set(sub.id, sub);
        return send(200, sub);
      }
      if ((m = url.pathname.match(/^\/subscriptions\/([^/]+)$/)) && req.method === 'GET') {
        const sub = subs.get(m[1]);
        return sub ? send(200, sub) : send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
      }
      if (req.method === 'POST' && url.pathname === '/__checkout') {
        const sub = subs.get(j.subscription_id);
        if (!sub) return send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'unknown subscription' } });
        const status = j.status || 'captured';
        const inv = { id: id('inv'), entity: 'invoice', subscription_id: sub.id, status: status === 'captured' ? 'paid' : 'issued' };
        const p = { id: id('pay'), entity: 'payment', invoice_id: inv.id, amount: j.amount, currency: 'INR', status, captured: status === 'captured' };
        inv.payment_id = p.id;
        invoices.set(inv.id, inv);
        payments.set(p.id, p);
        if (status === 'captured') sub.status = sub.start_at ? 'authenticated' : 'active';
        return send(200, p);
      }
      if ((m = url.pathname.match(/^\/invoices\/([^/]+)$/)) && req.method === 'GET') {
        const inv = invoices.get(m[1]);
        return inv ? send(200, inv) : send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
      }
      if (url.pathname.startsWith('/subscriptions')) return send(200, { id: id('sub'), entity: 'subscription', status: 'cancelled', short_url: 'http://127.0.0.1/qa-subscription' });
      // Test hook (not part of Razorpay): register a captured payment for an order, as the checkout
      // widget would after a successful sandbox payment.
      if (req.method === 'POST' && url.pathname === '/__pay') {
        const o = orders.get(j.order_id);
        if (!o) return send(404, { error: 'unknown order' });
        const p = { id: id('pay'), entity: 'payment', order_id: o.id, amount: j.amount ?? o.amount, currency: 'INR', status: j.status || 'captured', captured: (j.status || 'captured') === 'captured', method: 'upi' };
        payments.set(p.id, p);
        return send(200, p);
      }
      return send(404, { error: { code: 'NOT_FOUND', description: `stand-in has no route ${route}` } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.argv[2] || 3190);
  startGateway(port).then(() => console.log(JSON.stringify({ event: 'gateway.started', port })));
}
