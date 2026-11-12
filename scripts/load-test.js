// Reproducible load test: no third-party tools, no real gateway calls, no real payments.
//
//   node scripts/load-test.js [--vus=100,500,1000] [--duration=20] [--checkout-vus=50,100] [--race=200]
//
// Uses LOADTEST_DATABASE_URL (default postgresql://postgres@127.0.0.1:55432/vishrea_load) and refuses
// any database that is not on this machine or whose name lacks "load". It creates/refreshes that
// database (migrations, demo catalogue, 400 generated pieces, 1000 test customers), starts a local
// Razorpay stand-in and the app on --port (3100), runs the scenarios and writes
// scratch/loadtest-results.json. Rate limiting is disabled on the test server because every virtual
// user shares one IP; in production the per-IP limits apply per customer.
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const VUS = String(args.vus || '100,500,1000').split(',').map(Number).filter(Boolean);
const CHECKOUT_VUS = String(args['checkout-vus'] || '50,100').split(',').map(Number).filter(Boolean);
const RACE = Number(args.race ?? 200);
const DURATION_MS = Number(args.duration || 20) * 1000;
const PORT = Number(args.port || 3100);
const DB_URL = process.env.LOADTEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55432/vishrea_load';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const BASE = `http://127.0.0.1:${PORT}`;
const DELIVERY = { shipping_method: 'delivery', shipping_address: { name: 'Load Test', phone: '+91 98450 00000', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } };

function assertLocal(url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname) || !/load/.test(u.pathname)) {
    throw new Error(`Refusing to load-test ${u.hostname}${u.pathname}: use a local database whose name contains "load".`);
  }
}

async function prepareDatabase() {
  assertLocal(DB_URL);
  const u = new URL(DB_URL);
  const name = u.pathname.slice(1);
  const adminUrl = new URL(DB_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  await admin.end();

  const m = spawnSync(process.execPath, ['scripts/migrate.js', '--seed-demo'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: DB_URL, DATABASE_SSL: 'false', NODE_ENV: 'development', DEFAULT_ADMIN_EMAIL: '' },
    encoding: 'utf8',
  });
  if (m.status !== 0) throw new Error(`migrations failed: ${m.stderr || m.stdout}`);

  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query(`
    INSERT INTO products (category_id, name, slug, description, price_inr, is_one_of_one, is_active, featured, color, colour_season, created_at)
    SELECT (SELECT id FROM categories ORDER BY sort_order, name OFFSET (g % GREATEST((SELECT count(*) FROM categories), 1)) LIMIT 1),
           'Load Piece ' || g, 'lt-piece-' || g, 'Generated for load testing', 1500 + (g % 40) * 100, g % 3 = 0, true, g % 25 = 0,
           (ARRAY['Ivory','Wine','Black','Stone','Oat'])[1 + g % 5], (ARRAY['True Autumn','Soft Summer','Deep Winter','Light Spring'])[1 + g % 4],
           now() - make_interval(mins => g)
      FROM generate_series(1, 400) g
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'lt-piece-' || g)`);
  await c.query(`
    INSERT INTO products (name, slug, description, price_inr, is_one_of_one, is_active)
    SELECT x.name, x.slug, 'Load-test fixture', 1999, x.ooo, true FROM (VALUES ('Load Checkout Stock', 'lt-checkout', false), ('Load Last Unit', 'lt-last-unit', true)) x(name, slug, ooo)
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = x.slug)`);
  await c.query(`
    INSERT INTO product_variants (product_id, sku, size_label, price_inr, stock_quantity, sort_order)
    SELECT p.id, 'LT-' || substr(replace(p.id::text, '-', ''), 1, 10) || '-' || s.label, s.label, p.price_inr,
           CASE WHEN p.is_one_of_one THEN (CASE WHEN abs(hashtext(p.slug)) % 7 = 0 THEN 0 ELSE 1 END) ELSE abs(hashtext(p.slug || s.label)) % 6 END, s.ord
      FROM products p
      CROSS JOIN LATERAL (SELECT * FROM (VALUES ('S', 1), ('M', 2), ('L', 3)) v(label, ord) WHERE NOT p.is_one_of_one OR v.label = 'M') s
     WHERE p.slug LIKE 'lt-%' AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`);
  await c.query(`
    INSERT INTO profiles (auth_user_id, email, full_name, role, is_admin)
    SELECT 'usr_lt_' || g, 'lt-user-' || g || '@load.test', 'Load User ' || g, 'customer', false FROM generate_series(1, 1000) g
     WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = 'usr_lt_' || g)`);
  await c.query(`
    INSERT INTO customer_profiles (auth_user_id, email, full_name, phone)
    SELECT 'usr_lt_' || g, 'lt-user-' || g || '@load.test', 'Load User ' || g, '+91 98450 00000' FROM generate_series(1, 1000) g
    ON CONFLICT (auth_user_id) DO NOTHING`);
  const products = (await c.query("SELECT p.slug FROM products p WHERE p.is_active AND p.archived_at IS NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id) AND p.slug NOT LIKE 'lt-checkout' AND p.slug NOT LIKE 'lt-last-unit'")).rows.map((r) => r.slug);
  const categories = (await c.query('SELECT slug FROM categories WHERE is_active')).rows.map((r) => r.slug);
  const counts = (await c.query("SELECT (SELECT count(*)::int FROM products) AS products, (SELECT count(*)::int FROM product_variants) AS variants, (SELECT count(*)::int FROM product_variants WHERE stock_quantity = 0) AS sold_out_variants")).rows[0];
  return { c, products, categories, counts };
}

function startGatewayStandIn() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/orders') {
        const j = body ? JSON.parse(body) : {};
        return res.end(JSON.stringify({ id: `order_${crypto.randomBytes(7).toString('hex')}`, amount: j.amount, currency: 'INR', status: 'created' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function startApp(gatewayPort) {
  const log = fs.createWriteStream(path.join(root, 'scratch', 'loadtest-server.log'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: DB_URL, DATABASE_SSL: 'false', JWT_SECRET,
      RAZORPAY_KEY_ID: 'rzp_test_load', RAZORPAY_KEY_SECRET: 'load_secret', RAZORPAY_WEBHOOK_SECRET: 'load_webhook', RAZORPAY_API_BASE: `http://127.0.0.1:${gatewayPort}`,
      RESEND_API_KEY: '', AUTH_DEV_OTP_ECHO: 'false', RATE_LIMIT_DISABLED: 'true', DEFAULT_ADMIN_EMAIL: '', CSP_MODE: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('app did not become healthy; see scratch/loadtest-server.log');
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const summarise = (lat) => {
  const s = [...lat].sort((a, b) => a - b);
  return { count: s.length, avg: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.at(-1) || 0 };
};

function recorder() {
  const byLabel = new Map();
  const all = [];
  let errors = 0;
  const statuses = {};
  return {
    /** Timed request; resolves to the status, or `{ status, data }` when `json` is set. */
    async req(label, p, { method = 'GET', body, token, expect = [200], json = false } = {}) {
      const t = performance.now();
      let status = 0;
      let data = null;
      try {
        const r = await fetch(BASE + p, {
          method,
          headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        status = r.status;
        const text = await r.text();
        if (json) data = text ? JSON.parse(text) : null;
      } catch {
        status = status || 0;
      }
      const ms = Math.round(performance.now() - t);
      if (!byLabel.has(label)) byLabel.set(label, { lat: [], errors: 0 });
      const b = byLabel.get(label);
      b.lat.push(ms);
      all.push(ms);
      statuses[status] = (statuses[status] || 0) + 1;
      if (!expect.includes(status)) {
        b.errors += 1;
        errors += 1;
      }
      return json ? { status, data } : status;
    },
    report(wallMs) {
      return {
        requests: all.length,
        rps: Math.round((all.length / wallMs) * 1000),
        error_rate_pct: all.length ? Math.round((errors / all.length) * 10000) / 100 : 0,
        errors,
        statuses,
        latency_ms: summarise(all),
        endpoints: Object.fromEntries([...byLabel].map(([k, v]) => [k, { ...summarise(v.lat), errors: v.errors }]).sort((a, b) => b[1].p95 - a[1].p95)),
      };
    },
  };
}

function sampler() {
  const s = { pool_total_max: 0, pool_waiting_max: 0, rss_mb_max: 0, cpu_ms_start: null, cpu_ms_end: null, samples: 0 };
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const h = await (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })).json();
        s.pool_total_max = Math.max(s.pool_total_max, h.pool.total);
        s.pool_waiting_max = Math.max(s.pool_waiting_max, h.pool.waiting);
        s.pool_max = h.pool.max;
        s.rss_mb_max = Math.max(s.rss_mb_max, h.process.rss_mb);
        if (s.cpu_ms_start === null) s.cpu_ms_start = h.process.cpu_ms;
        s.cpu_ms_end = h.process.cpu_ms;
        s.samples += 1;
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  return {
    async done(wallMs) {
      stop = true;
      await loop;
      const cpu = s.cpu_ms_end !== null ? s.cpu_ms_end - s.cpu_ms_start : 0;
      return { pool_max: s.pool_max, pool_total_max: s.pool_total_max, pool_waiting_max: s.pool_waiting_max, rss_mb_max: s.rss_mb_max, server_cpu_pct_of_one_core: Math.round((cpu / wallMs) * 100), samples: s.samples };
    },
  };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORDS = ['dress', 'wine', 'ivory', 'top', 'black', 'load piece 1', 'silk', 'stone'];
const SORTS = ['featured', 'newest', 'price_asc', 'price_desc'];

async function browsePhase(vus, data, tokens) {
  const rec = recorder();
  const smp = sampler();
  const start = performance.now();
  const deadline = Date.now() + DURATION_MS;
  const vu = async (i) => {
    await sleep(Math.random() * 3000); // ramp up over 3 s
    const token = tokens[i % tokens.length];
    while (Date.now() < deadline) {
      const r = Math.random();
      if (r < 0.3) {
        await Promise.all([rec.req('session', '/api/auth/session'), rec.req('catalogue_featured', '/api/catalogue?featured=true&limit=4'), rec.req('content', '/api/content')]);
      } else if (r < 0.55) {
        const qs = new URLSearchParams({ limit: '24', page: String(1 + Math.floor(Math.random() * 3)), sort: pick(SORTS) });
        if (Math.random() < 0.7) qs.set('category', pick(data.categories));
        if (Math.random() < 0.3) qs.set('in_stock', 'true');
        await rec.req('catalogue_browse', `/api/catalogue?${qs}`);
      } else if (r < 0.75) {
        await rec.req('product_detail', `/api/product?slug=${encodeURIComponent(pick(data.products))}`);
      } else if (r < 0.85) {
        await rec.req('search', `/api/catalogue?q=${encodeURIComponent(pick(WORDS))}&limit=24`);
      } else if (r < 0.95) {
        await Promise.all([rec.req('account', '/api/account', { token }), rec.req('orders', '/api/orders?limit=1', { token })]);
      } else {
        await rec.req('cart', '/api/cart', { token });
      }
      await sleep(250 + Math.random() * 500); // think time
    }
  };
  await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
  const wall = performance.now() - start;
  return { scenario: 'browse', vus, duration_s: Math.round(wall / 1000), ...rec.report(wall), server: await smp.done(wall) };
}

async function checkoutPhase(vus, c, tokens) {
  const variant = (await c.query("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'lt-checkout' ORDER BY v.sort_order LIMIT 1")).rows[0].id;
  await c.query("UPDATE product_variants v SET stock_quantity = 100000 FROM products p WHERE p.id = v.product_id AND p.slug = 'lt-checkout'");
  const rec = recorder();
  const smp = sampler();
  const start = performance.now();
  const deadline = Date.now() + DURATION_MS;
  await Promise.all(
    Array.from({ length: vus }, async (_, i) => {
      const token = tokens[i];
      await sleep(Math.random() * 2000);
      while (Date.now() < deadline) {
        await rec.req('cart_clear', '/api/cart', { method: 'DELETE', body: { all: true }, token });
        await rec.req('cart_add', '/api/cart', { method: 'POST', body: { variant_id: variant, quantity: 1 }, token });
        const co = await rec.req('checkout', '/api/checkout', { method: 'POST', body: DELIVERY, token, expect: [201], json: true });
        if (co.status === 201 && co.data?.order_id) await rec.req('checkout_cancel', '/api/checkout', { method: 'POST', body: { action: 'cancel', order_id: co.data.order_id }, token });
        await sleep(300 + Math.random() * 400);
      }
    })
  );
  const wall = performance.now() - start;
  const held = (await c.query("SELECT count(*)::int AS n FROM inventory_reservations ir JOIN product_variants v ON v.id = ir.variant_id JOIN products p ON p.id = v.product_id WHERE p.slug = 'lt-checkout' AND ir.status = 'held'")).rows[0].n;
  const stock = (await c.query("SELECT stock_quantity FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'lt-checkout'")).rows[0].stock_quantity;
  const report = rec.report(wall);
  return {
    scenario: 'checkout', vus, duration_s: Math.round(wall / 1000), ...report,
    checkout: report.endpoints.checkout,
    stock_after: { held_reservations_left: held, stock_quantity: stock, expected: 100000 - held, consistent: stock === 100000 - held },
    server: await smp.done(wall),
  };
}

async function racePhase(buyers, c, tokens) {
  const variant = (await c.query("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'lt-last-unit'")).rows[0].id;
  await c.query('UPDATE inventory_reservations SET status = $2 WHERE variant_id = $1 AND status = $3', [variant, 'released', 'held']);
  await c.query('UPDATE product_variants SET stock_quantity = 1 WHERE id = $1', [variant]);
  const group = tokens.slice(0, buyers);
  for (let i = 0; i < group.length; i += 50) {
    await Promise.all(group.slice(i, i + 50).map(async (token) => {
      await fetch(`${BASE}/api/cart`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ all: true }) });
      const r = await fetch(`${BASE}/api/cart`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ variant_id: variant, quantity: 1 }) });
      if (r.status !== 200) throw new Error(`race setup: cart add returned ${r.status}`);
    }));
  }
  const start = performance.now();
  const results = await Promise.all(group.map(async (token) => {
    const t = performance.now();
    const r = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(DELIVERY) }).catch(() => ({ status: 0 }));
    return { status: r.status, ms: Math.round(performance.now() - t) };
  }));
  const wall = performance.now() - start;
  const stock = (await c.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variant])).rows[0].stock_quantity;
  const held = (await c.query("SELECT count(*)::int AS n FROM inventory_reservations WHERE variant_id = $1 AND status = 'held'", [variant])).rows[0].n;
  const statuses = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  return {
    scenario: 'last_unit_race', buyers, wall_ms: Math.round(wall), statuses, latency_ms: summarise(results.map((r) => r.ms)),
    winners: statuses[201] || 0, stock_quantity_after: stock, held_reservations: held,
    correct: (statuses[201] || 0) === 1 && stock === 0 && held === 1 && (statuses[409] || 0) === buyers - 1,
  };
}

async function main() {
  fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
  console.log(`[load] preparing ${new URL(DB_URL).pathname.slice(1)} …`);
  const data = await prepareDatabase();
  const gw = await startGatewayStandIn();
  const app = await startApp(gw.address().port);
  const tokens = Array.from({ length: 1000 }, (_, i) => jwt.sign({ sub: `usr_lt_${i + 1}`, email: `lt-user-${i + 1}@load.test` }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1d' }));
  const results = { generated_at: new Date().toISOString(), machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, mem_gb: Math.round(os.totalmem() / 1073741824), node: process.version }, dataset: data.counts, config: { duration_s: DURATION_MS / 1000, db_pool_max: Number(process.env.DB_POOL_MAX || 10), public_cache: process.env.PUBLIC_CACHE === 'off' ? 'off' : 'on', rate_limit: 'disabled for test (single client IP)' }, phases: [] };
  try {
    await fetch(`${BASE}/api/catalogue?limit=24`);
    for (const v of VUS) {
      console.log(`[load] browse ${v} VUs for ${DURATION_MS / 1000}s …`);
      const r = await browsePhase(v, data, tokens);
      results.phases.push(r);
      console.log(`        ${r.requests} req, ${r.rps} req/s, p50 ${r.latency_ms.p50} ms, p95 ${r.latency_ms.p95} ms, p99 ${r.latency_ms.p99} ms, errors ${r.error_rate_pct}%, pool ${r.server.pool_total_max}/${r.server.pool_max} (waiting max ${r.server.pool_waiting_max})`);
      await sleep(3000);
    }
    for (const v of CHECKOUT_VUS) {
      console.log(`[load] checkout ${v} VUs for ${DURATION_MS / 1000}s …`);
      const r = await checkoutPhase(v, data.c, tokens);
      results.phases.push(r);
      console.log(`        ${r.checkout.count} checkouts (${r.checkout.errors} failed), checkout p50 ${r.checkout.p50} ms p95 ${r.checkout.p95} ms, all requests ${r.rps} req/s errors ${r.error_rate_pct}%, stock consistent: ${r.stock_after.consistent}`);
      await sleep(3000);
    }
    if (RACE > 0) {
      console.log(`[load] last-unit race with ${RACE} simultaneous buyers …`);
      const race = await racePhase(RACE, data.c, tokens);
      results.phases.push(race);
      console.log(`        winners ${race.winners}, statuses ${JSON.stringify(race.statuses)}, stock after ${race.stock_quantity_after}, correct: ${race.correct}`);
    }
  } finally {
    app.kill();
    gw.close();
    await data.c.end();
  }
  const serverLog = fs.readFileSync(path.join(root, 'scratch', 'loadtest-server.log'), 'utf8');
  results.server_log = { errors: (serverLog.match(/"level":"error"/g) || []).length, warnings: (serverLog.match(/"level":"warn"/g) || []).length };
  const out = path.join(root, 'scratch', args.out || 'loadtest-results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`[load] results written to ${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error('[load] failed:', err.message);
  process.exit(1);
});
