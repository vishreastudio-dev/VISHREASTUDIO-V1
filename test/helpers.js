// Integration-test harness: an isolated PostgreSQL namespace per run, the real Express app on an
// ephemeral port, and a local stand-in for the Razorpay REST API that issues real HMAC signatures.
//
// Database selection, first reachable wins:
//   TEST_DATABASE_URL        always schema isolation (works on hosted Postgres without superuser)
//   TEST_DATABASE_ADMIN_URL  a fresh database per run, falling back to a schema if CREATE DATABASE is denied
//   postgresql://postgres@127.0.0.1:55432/postgres   (npm run test:docker)
//   postgresql://postgres@127.0.0.1:5432/postgres    (uses PGPASSWORD when set)
// With none reachable, integration suites skip with a warning and unit suites still run.
import crypto from 'crypto';
import http from 'http';
import pg from 'pg';

const DB_NAME = `vishrea_ci_${process.pid}`;
const SCHEMA = `test_run_${process.pid}`;

function candidates() {
  const list = [];
  if (process.env.TEST_DATABASE_URL) list.push({ url: process.env.TEST_DATABASE_URL, mode: 'schema' });
  if (process.env.TEST_DATABASE_ADMIN_URL) list.push({ url: process.env.TEST_DATABASE_ADMIN_URL, mode: 'database' });
  list.push({ url: 'postgresql://postgres@127.0.0.1:55432/postgres', mode: 'database' });
  const pw = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  list.push({ url: `postgresql://postgres${pw}@127.0.0.1:5432/postgres`, mode: 'database' });
  return list;
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function withSearchPath(url) {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${SCHEMA},public`);
  return u.toString();
}

let target;
let warned = false;

/** Resolve a usable test database once per process. Returns null when PostgreSQL is unreachable. */
export async function resolveTestDatabase() {
  if (target !== undefined) return target;
  const tried = [];
  for (const c of candidates()) {
    const client = new pg.Client({ connectionString: c.url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      target = { adminUrl: c.url, mode: c.mode };
      await client.end();
      return target;
    } catch (err) {
      tried.push(`${c.url.replace(/:[^:@/]*@/, ':***@')} (${err.message})`);
      await client.end().catch(() => {});
    }
  }
  target = null;
  if (!warned) {
    warned = true;
    console.warn(`[tests] PostgreSQL unavailable; integration suites are skipped. Tried:\n  ${tried.join('\n  ')}\n  Start one with: npm run test:docker  (or set TEST_DATABASE_URL)`);
  }
  return target;
}

/** `skip` option for describe(): false when a database is available, otherwise the reason. */
export async function dbSkipReason() {
  return (await resolveTestDatabase()) ? false : 'PostgreSQL unavailable (npm run test:docker or set TEST_DATABASE_URL)';
}

export let TEST_DB_URL = '';

export const RZP_KEY_ID = 'rzp_test_localmock';
export const RZP_SECRET = 'test_key_secret_for_hmac';
export const RZP_WEBHOOK_SECRET = 'test_webhook_secret';
export const ADMIN_EMAIL = 'owner@vishrea.test';

// ---- Razorpay API stand-in --------------------------------------------------------------
export const gateway = { orders: new Map(), payments: new Map(), refunds: [], plans: new Map(), subscriptions: new Map(), invoices: new Map(), failNextOrder: false, failNextPaymentFetch: false, failNextRefund: false, failNextPause: false };

function startGatewayMock() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.method === 'POST' && req.url === '/orders') {
        if (gateway.failNextOrder) {
          gateway.failNextOrder = false;
          return send(500, { error: { code: 'SERVER_ERROR' } });
        }
        const id = `order_${crypto.randomBytes(7).toString('hex')}`;
        const o = { id, amount: json.amount, currency: json.currency, receipt: json.receipt, status: 'created' };
        gateway.orders.set(id, o);
        return send(200, o);
      }
      const m = req.url.match(/^\/payments\/([^/]+)(\/(capture|refund))?$/);
      if (m) {
        const p = gateway.payments.get(decodeURIComponent(m[1]));
        if (!p) return send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
        if (!m[3] && gateway.failNextPaymentFetch) {
          gateway.failNextPaymentFetch = false;
          return send(500, { error: { code: 'SERVER_ERROR' } });
        }
        if (m[3] === 'capture') p.status = 'captured';
        if (m[3] === 'refund') {
          if (gateway.failNextRefund) {
            gateway.failNextRefund = false;
            return send(500, { error: { code: 'SERVER_ERROR' } });
          }
          const refund = { id: `rfnd_${crypto.randomBytes(7).toString('hex')}`, entity: 'refund', payment_id: p.id, amount: json.amount ?? p.amount, currency: 'INR', status: 'processed' };
          gateway.refunds.push(refund);
          return send(200, refund);
        }
        return send(200, p);
      }
      if (req.method === 'POST' && req.url === '/plans') {
        const p = { id: `plan_${crypto.randomBytes(7).toString('hex')}`, period: json.period, interval: json.interval, item: json.item };
        gateway.plans.set(p.id, p);
        return send(200, p);
      }
      const planMatch = req.url.match(/^\/plans\/([^/]+)$/);
      if (planMatch) return gateway.plans.has(planMatch[1]) ? send(200, gateway.plans.get(planMatch[1])) : send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
      if (req.method === 'POST' && req.url === '/subscriptions') {
        const plan = gateway.plans.get(json.plan_id);
        if (!plan) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'plan not found' } });
        const s = { id: `sub_${crypto.randomBytes(7).toString('hex')}`, plan_id: json.plan_id, status: 'created', total_count: json.total_count, start_at: json.start_at || null,
          charge_at: json.start_at || null, addons: json.addons || [], notes: json.notes, short_url: 'https://rzp.io/i/test', plan_amount: plan.item.amount };
        gateway.subscriptions.set(s.id, s);
        return send(200, s);
      }
      const subMatch = req.url.match(/^\/subscriptions\/([^/]+)(\/(cancel|pause|resume))?$/);
      if (subMatch) {
        const s = gateway.subscriptions.get(decodeURIComponent(subMatch[1]));
        if (!s) return send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
        if (subMatch[3] === 'pause' && gateway.failNextPause) {
          gateway.failNextPause = false;
          return send(500, { error: { code: 'SERVER_ERROR' } });
        }
        if (subMatch[3] === 'cancel') s.status = 'cancelled';
        if (subMatch[3] === 'pause') s.status = 'paused';
        if (subMatch[3] === 'resume') s.status = 'active';
        return send(200, s);
      }
      if (req.method === 'POST' && req.url === '/__pay') {
        const o = gateway.orders.get(json.order_id);
        if (!o) return send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'unknown order' } });
        const status = json.status || 'captured';
        const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
        gateway.payments.set(id, { id, order_id: o.id, amount: json.amount ?? o.amount, currency: 'INR', status, captured: status === 'captured' });
        return send(200, gateway.payments.get(id));
      }
      if (req.method === 'POST' && req.url === '/__checkout') {
        const s = gateway.subscriptions.get(json.subscription_id);
        if (!s) return send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'unknown subscription' } });
        const status = json.status || 'captured';
        const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
        const invoiceId = `inv_${crypto.randomBytes(7).toString('hex')}`;
        gateway.payments.set(id, { id, invoice_id: invoiceId, amount: json.amount, currency: 'INR', status, captured: status === 'captured' });
        gateway.invoices.set(invoiceId, { id: invoiceId, subscription_id: s.id, payment_id: id });
        if (status === 'captured') s.status = s.start_at ? 'authenticated' : 'active';
        return send(200, gateway.payments.get(id));
      }
      const invMatch = req.url.match(/^\/invoices\/([^/]+)$/);
      if (invMatch) return gateway.invoices.has(invMatch[1]) ? send(200, gateway.invoices.get(invMatch[1])) : send(404, { error: { code: 'BAD_REQUEST_ERROR' } });
      send(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- Supabase Storage stand-in ----------------------------------------------------------
// Implements the Storage REST calls @supabase/supabase-js makes, so the real SDK is exercised.
// Never the real project: tests always point SUPABASE_URL here.
export const STORAGE_KEY = 'test-service-role-key-0123456789abcdef';
export const storageMock = {
  buckets: new Map(), // id -> { id, public, file_size_limit }
  objects: new Map(), // `${bucket}/${path}` -> { buf, type }
  tokens: new Map(), // token -> { key, exp }
  requests: [],
  failNext: 0, // respond 500 to the next N requests
  down: false, // drop connections (outage)
  denyAll: false, // respond 403 (bad key / revoked permission)
  reset() {
    this.buckets.clear();
    this.objects.clear();
    this.tokens.clear();
    this.requests = [];
    this.failNext = 0;
    this.down = false;
    this.denyAll = false;
  },
  expireSignedLinks() {
    for (const t of this.tokens.values()) t.exp = 0;
  },
};

function startStorageMock() {
  const server = http.createServer((req, res) => {
    if (storageMock.down) return req.socket.destroy();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.replace(/^\/storage\/v1\//, '').split('/').map(decodeURIComponent);
      const send = (status, data, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(type === 'application/json' ? JSON.stringify(data) : data);
      };
      const err = (status, error, message) => send(status, { statusCode: String(status), error, message });
      storageMock.requests.push(`${req.method} ${parts.join('/')}`);
      if (storageMock.failNext > 0) {
        storageMock.failNext -= 1;
        return err(500, 'internal', 'Internal Server Error');
      }
      const publicRead = req.method === 'GET' && parts[0] === 'object' && (parts[1] === 'public' || parts[1] === 'sign');
      if (!publicRead && (storageMock.denyAll || req.headers.authorization !== `Bearer ${STORAGE_KEY}`)) return err(403, 'Unauthorized', 'new row violates row-level security policy');

      const json = () => (body.length ? JSON.parse(body.toString()) : {});
      if (parts[0] === 'bucket') {
        if (req.method === 'POST' && parts.length === 1) {
          const b = json();
          storageMock.buckets.set(b.id, { id: b.id, name: b.id, public: Boolean(b.public), file_size_limit: b.file_size_limit || null, allowed_mime_types: b.allowed_mime_types || null });
          return send(200, { name: b.id });
        }
        const b = storageMock.buckets.get(parts[1]);
        if (!b) return err(404, 'Bucket not found', 'Bucket not found');
        if (req.method === 'PUT') {
          Object.assign(b, { public: Boolean(json().public) });
          return send(200, { message: 'Successfully updated' });
        }
        return send(200, b);
      }
      if (parts[0] !== 'object') return err(404, 'not_found', 'Not found');
      const objectAt = (bucket, p) => storageMock.objects.get(`${bucket}/${p}`);
      if (req.method === 'GET' && parts[1] === 'public') {
        const b = storageMock.buckets.get(parts[2]);
        const o = objectAt(parts[2], parts.slice(3).join('/'));
        if (!b || !b.public || !o) return err(400, 'not_found', 'Object not found');
        return send(200, o.buf, o.type);
      }
      if (parts[1] === 'sign') {
        const key = `${parts[2]}/${parts.slice(3).join('/')}`;
        if (req.method === 'POST') {
          if (!storageMock.objects.has(key)) return err(400, 'not_found', 'Object not found');
          const token = crypto.randomBytes(12).toString('hex');
          storageMock.tokens.set(token, { key, exp: Date.now() + Number(json().expiresIn) * 1000 });
          return send(200, { signedURL: `/object/sign/${parts.slice(2).map(encodeURIComponent).join('/')}?token=${token}` });
        }
        const t = storageMock.tokens.get(url.searchParams.get('token'));
        if (!t || t.key !== key || t.exp < Date.now()) return err(400, 'InvalidJWT', 'jwt expired');
        const o = storageMock.objects.get(key);
        return o ? send(200, o.buf, o.type) : err(400, 'not_found', 'Object not found');
      }
      if (parts[1] === 'info') {
        const o = objectAt(parts[2], parts.slice(3).join('/'));
        return o ? send(200, { name: parts.slice(3).join('/'), size: o.buf.length, content_type: o.type }) : err(404, 'not_found', 'Object not found');
      }
      if (parts[1] === 'list' && req.method === 'POST') {
        const bucket = parts[2];
        const asked = json().prefix || '';
        const prefix = asked ? `${asked.replace(/\/+$/, '')}/` : '';
        const seen = new Map();
        for (const [k, o] of storageMock.objects) {
          if (!k.startsWith(`${bucket}/${prefix}`)) continue;
          const rest = k.slice(bucket.length + 1 + prefix.length);
          const [first, ...more] = rest.split('/');
          seen.set(first, more.length ? { name: first, id: null } : { name: first, id: crypto.createHash('md5').update(k).digest('hex'), metadata: { size: o.buf.length, mimetype: o.type } });
        }
        return send(200, [...seen.values()]);
      }
      const bucket = parts[1];
      const p = parts.slice(2).join('/');
      if (req.method === 'DELETE' && parts.length === 2) {
        const removed = (json().prefixes || []).filter((x) => storageMock.objects.delete(`${bucket}/${x}`)).map((name) => ({ name }));
        return send(200, removed);
      }
      const b = storageMock.buckets.get(bucket);
      if (req.method === 'POST' || req.method === 'PUT') {
        if (!b) return err(404, 'Bucket not found', 'Bucket not found');
        if (storageMock.objects.has(`${bucket}/${p}`) && req.headers['x-upsert'] !== 'true') return err(409, 'Duplicate', 'The resource already exists');
        if (b.file_size_limit && body.length > b.file_size_limit) return err(413, 'Payload too large', 'The object exceeded the maximum allowed size');
        storageMock.objects.set(`${bucket}/${p}`, { buf: body, type: req.headers['content-type'], cacheControl: req.headers['cache-control'] });
        return send(200, { Key: `${bucket}/${p}`, Id: crypto.randomUUID() });
      }
      if (req.method === 'GET') {
        const o = objectAt(bucket, p);
        return o ? send(200, o.buf, o.type) : err(404, 'not_found', 'Object not found');
      }
      return err(405, 'method', 'Method not allowed');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Simulate the customer completing Razorpay Checkout for `rzpOrderId`. */
export function pay(rzpOrderId, { amount, status = 'captured' } = {}) {
  const o = gateway.orders.get(rzpOrderId);
  const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
  gateway.payments.set(id, { id, order_id: rzpOrderId, amount: amount ?? o?.amount, currency: 'INR', status });
  const signature = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrderId}|${id}`).digest('hex');
  return { razorpay_order_id: rzpOrderId, razorpay_payment_id: id, razorpay_signature: signature };
}

/**
 * Simulate the customer authorising a UPI Autopay mandate in Razorpay Checkout. The authorisation
 * payment is the upfront add-on (or, for an immediate start, the first month).
 */
export function authoriseSubscription(subscriptionId, { amount } = {}) {
  const s = gateway.subscriptions.get(subscriptionId);
  const upfront = (s?.addons || []).reduce((n, a) => n + Number(a.item.amount), 0);
  const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
  const invoiceId = `inv_${crypto.randomBytes(7).toString('hex')}`;
  gateway.payments.set(id, { id, order_id: `order_${crypto.randomBytes(7).toString('hex')}`, invoice_id: invoiceId, amount: amount ?? (upfront || s?.plan_amount), currency: 'INR', status: 'captured' });
  gateway.invoices.set(invoiceId, { id: invoiceId, subscription_id: subscriptionId, payment_id: id });
  if (s) s.status = s.start_at ? 'authenticated' : 'active';
  const signature = crypto.createHmac('sha256', RZP_SECRET).update(`${id}|${subscriptionId}`).digest('hex');
  return { razorpay_subscription_id: subscriptionId, razorpay_payment_id: id, razorpay_signature: signature };
}

/** A signed Razorpay webhook for a subscription event, optionally with a payment entity. */
export function subscriptionEvent(event, subscriptionId, { payment = null, status, chargeAt = null } = {}) {
  const s = gateway.subscriptions.get(subscriptionId) || { id: subscriptionId };
  if (status) s.status = status;
  if (chargeAt) s.charge_at = chargeAt;
  const payload = { subscription: { entity: { ...s, id: subscriptionId } } };
  if (payment) payload.payment = { entity: payment };
  const raw = JSON.stringify({ entity: 'event', event, contains: Object.keys(payload), payload, created_at: Math.floor(Date.now() / 1000) });
  return { raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhookSignature(raw), 'X-Razorpay-Event-Id': `evt_${crypto.randomBytes(8).toString('hex')}` } };
}

/** A monthly debit by the mandate (a new captured payment with its invoice). */
export function recurringPayment(subscriptionId, { amount } = {}) {
  const s = gateway.subscriptions.get(subscriptionId);
  const id = `pay_${crypto.randomBytes(7).toString('hex')}`;
  const invoiceId = `inv_${crypto.randomBytes(7).toString('hex')}`;
  const p = { id, order_id: `order_${crypto.randomBytes(7).toString('hex')}`, invoice_id: invoiceId, amount: amount ?? s?.plan_amount ?? 179900, currency: 'INR', status: 'captured' };
  gateway.payments.set(id, p);
  gateway.invoices.set(invoiceId, { id: invoiceId, subscription_id: subscriptionId, payment_id: id });
  return p;
}

export function webhookBody(event, payment) {
  return JSON.stringify({ entity: 'event', event, contains: ['payment'], payload: { payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) });
}
export const webhookSignature = (raw) => crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(raw).digest('hex');

// ---- App + DB lifecycle -----------------------------------------------------------------
export const ctx = { base: '', server: null, gatewayServer: null, storageServer: null, storageUrl: '', db: null, pool: null };

export async function setup({ env = {} } = {}) {
  const t = await resolveTestDatabase();
  if (!t) throw new Error('Test PostgreSQL unavailable. Run `npm run test:docker` or set TEST_DATABASE_URL.');

  const admin = new pg.Client({ connectionString: t.adminUrl });
  await admin.connect();
  try {
    if (t.mode === 'database') {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        TEST_DB_URL = withDatabase(t.adminUrl, DB_NAME);
      } catch (err) {
        if (err.code !== '42501') throw err;
        t.mode = 'schema';
      }
    }
    if (t.mode === 'schema') {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      TEST_DB_URL = withSearchPath(t.adminUrl);
    }
  } finally {
    await admin.end();
  }

  ctx.gatewayServer = await startGatewayMock();
  ctx.storageServer = await startStorageMock();
  ctx.storageUrl = `http://127.0.0.1:${ctx.storageServer.address().port}`;
  Object.assign(process.env, {
    // Storage always points at the stand-in, never at credentials from a developer's .env.
    STORAGE_DRIVER: 'local',
    SUPABASE_URL: ctx.storageUrl,
    SUPABASE_SERVICE_ROLE_KEY: STORAGE_KEY,
    SUPABASE_ANON_KEY: '',
    PRODUCTION_SUPABASE_PROJECT_REF: '',
    STORAGE_TIMEOUT_MS: '3000',
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    DATABASE_SSL: 'false',
    JWT_SECRET: 'integration-test-secret-0123456789-abcdefghijklmnop',
    AUTH_DEV_OTP_ECHO: env.NODE_ENV === 'production' ? 'false' : 'true',
    DEFAULT_ADMIN_EMAIL: ADMIN_EMAIL,
    RAZORPAY_KEY_ID: RZP_KEY_ID,
    RAZORPAY_KEY_SECRET: RZP_SECRET,
    RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK_SECRET,
    RAZORPAY_API_BASE: `http://127.0.0.1:${ctx.gatewayServer.address().port}`,
    RATE_LIMIT_DISABLED: 'true',
    RESEND_API_KEY: '', // a key in .env must never send real mail from a test run
    LOG_SILENT: 'true',
    CSP_MODE: 'enforce',
    UPLOADS_DIR: `${process.env.TEMP || '/tmp'}/vishrea-test-uploads-${process.pid}`,
    ...env,
  });

  const { runMigrations } = await import('../scripts/migrate.js');
  const realEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test'; // demo seed is refused in production
  await runMigrations({ seedDemo: true, quiet: true });
  process.env.NODE_ENV = realEnv;
  const { createApp } = await import('../server.js');
  const dbm = await import('../lib/db.js');
  ctx.db = dbm.db;
  ctx.pool = dbm.pool;
  const app = await createApp();
  ctx.server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`;
}

export async function teardown() {
  // Close only servers that started; a setup that failed part-way must not hang the run.
  const close = (s) => (s ? new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }) : Promise.resolve());
  await close(ctx.server);
  await close(ctx.gatewayServer);
  await close(ctx.storageServer);
  await ctx.pool?.end();
  if (!target) return;
  const admin = new pg.Client({ connectionString: target.adminUrl });
  await admin.connect();
  try {
    if (target.mode === 'schema') await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    else await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// ---- HTTP client ------------------------------------------------------------------------
export async function api(method, path, body, { cookie, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  // Browsers send Origin on every non-GET request; pass `Origin: null` to simulate a client that omits it.
  if (!['GET', 'HEAD'].includes(method) && !('Origin' in h)) h.Origin = ctx.base;
  if (h.Origin === null) delete h.Origin;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h['Content-Type'] = h['Content-Type'] || 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(ctx.base + path, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

export async function login(email) {
  const s = await api('POST', '/api/auth/start-login', { email });
  if (s.status !== 200) throw new Error(`start-login ${s.status} ${JSON.stringify(s.data)}`);
  const v = await api('POST', '/api/auth/verify-code', { email, code: s.data.debug_code });
  if (v.status !== 200) throw new Error(`verify-code ${v.status} ${JSON.stringify(v.data)}`);
  const cookie = v.headers.get('set-cookie').split(';')[0];
  return { cookie, user: v.data.user };
}

let seq = 0;
export const uniqueEmail = (tag = 'c') => `${tag}${Date.now()}${seq++}@example.test`;

export async function variantOf(slug, size) {
  const r = await ctx.db.query(
    `SELECT v.* FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = $1 ${size ? 'AND v.size_label = $2' : ''} ORDER BY v.sort_order LIMIT 1`,
    size ? [slug, size] : [slug]
  );
  return r.rows[0];
}

export const DELIVERY = { shipping_method: 'delivery', shipping_address: { name: 'Asha Rao', phone: '+91 98450 00000', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } };

/** A PNG header declaring `w`×`h` pixels: enough for the upload type check and size reader. */
export function fakePng(w, h) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(16)]);
}

/** Build a minimal ISO-BMFF file whose moov/mvhd declares `seconds` of duration. */
export function fakeMp4(seconds) {
  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0); ftyp.write('ftyp', 4); ftyp.write('isom', 8); ftyp.writeUInt32BE(0x200, 12); ftyp.write('isom', 16);
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0); mvhd.write('mvhd', 4); mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(Math.round(seconds * 1000), 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0); moov.write('moov', 4);
  return Buffer.concat([ftyp, moov, mvhd]);
}
