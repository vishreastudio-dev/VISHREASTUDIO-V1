#!/usr/bin/env node
// k6 against the isolated QA stack (load profile) only. Prepares QA-only tokens, samples
// /api/health during the run, and checks stock and payment integrity afterwards.
//   node tests/qa/run-k6.mjs <vus> [duration]
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { spawn } from 'child_process';
import { GATEWAY_PORT, QA_DB_URL, QA_PORT, ROOT, STATE_DIR } from './qa-env.mjs';

const vus = Number(process.argv[2] || 10);
const duration = process.argv[3] || '2m';
const BASE = `http://127.0.0.1:${QA_PORT}`;
const K6 = path.join(ROOT, 'scratch', 'tools', 'k6-v2.3.0-windows-amd64', 'k6.exe');
if (!fs.existsSync(K6)) throw new Error('k6 not found in scratch/tools');

const stack = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'stack.json'), 'utf8'));
if (stack.profile !== 'load') throw new Error('start the stack with --profile=load first');
const health = await (await fetch(`${BASE}/api/health`)).json();
if (!health.ok) throw new Error('QA stack is not healthy');

const secrets = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'secrets.json'), 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const tokenFor = (i) => {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: `usr_qa_${i}`, email: `qa-user-${i}@qa.test`, iat: now, exp: now + 6 * 3600 })}`;
  return `${head}.${crypto.createHmac('sha256', secrets.jwt).update(head).digest('base64url')}`;
};

const db = new pg.Client({ connectionString: QA_DB_URL });
await db.connect();
const variant = (await db.query("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'qa-checkout-stock' AND v.size_label = 'M'")).rows[0].id;
const slugs = (await db.query("SELECT slug FROM products WHERE slug LIKE 'qa-piece-%' AND is_active ORDER BY slug LIMIT 200")).rows.map((r) => r.slug);
const snapshot = async () => (await db.query(`SELECT
  (SELECT stock_quantity::int FROM product_variants WHERE id = $1) AS stock,
  (SELECT count(*)::int FROM orders WHERE payment_status = 'paid') AS paid_orders,
  (SELECT count(*)::int FROM orders WHERE auth_user_id LIKE 'usr_qa_%' AND status = 'pending_payment') AS pending,
  (SELECT count(*)::int FROM invoice_records) AS invoices,
  (SELECT count(*)::int FROM (SELECT razorpay_payment_id FROM orders WHERE razorpay_payment_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d) AS dup_payments,
  (SELECT count(*)::int FROM product_variants WHERE stock_quantity < 0) AS negative_stock`, [variant])).rows[0];

const dataFile = path.join(STATE_DIR, 'k6-data.json');
fs.writeFileSync(dataFile, JSON.stringify({
  base: BASE, gateway: `http://127.0.0.1:${GATEWAY_PORT}`, variant, slugs, razorpaySecret: secrets.razorpaySecret,
  address: { name: 'QA Load', phone: '+91 98450 00000', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  tokens: Array.from({ length: Math.max(vus, 10) }, (_, i) => tokenFor(i + 1)),
}));

const before = await snapshot();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawDir = path.join(STATE_DIR, 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const summaryFile = path.join(rawDir, `k6-${vus}vu-${stamp}.json`);
const samples = [];
const sampler = setInterval(async () => {
  try {
    const h = await (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).json();
    samples.push({ t: Date.now(), ...h.pool, rss_mb: h.process?.rss_mb, cpu_ms: h.process?.cpu_ms });
  } catch {
    samples.push({ t: Date.now(), error: true });
  }
}, 2000);

const out = fs.createWriteStream(path.join(rawDir, `k6-${vus}vu-${stamp}.txt`));
const code = await new Promise((resolve) => {
  const p = spawn(K6, ['run', '--quiet', '--summary-export', summaryFile, '-e', `VUS=${vus}`, '-e', `DURATION=${duration}`, path.join(ROOT, 'tests', 'qa', 'k6', 'shop.js')], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, K6_NO_USAGE_REPORT: 'true' } });
  p.stdout.pipe(out);
  p.stderr.pipe(out);
  p.stdout.pipe(process.stdout);
  p.stderr.pipe(process.stderr);
  p.on('close', resolve);
});
clearInterval(sampler);
fs.rmSync(dataFile, { force: true });

const after = await snapshot();
await db.end();
const s = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
const m = s.metrics;
const pick = (k) => (m[k] ? { p50: m[k].med, p95: m[k]['p(95)'], p99: m[k]['p(99)'], max: m[k].max } : null);
const ok = samples.filter((x) => !x.error);
const result = {
  vus, duration, k6_exit: code,
  requests: m.http_reqs?.count, rps: m.http_reqs?.rate, failed_rate: m.http_req_failed?.value ?? m.http_req_failed?.rate,
  checks_rate: m.checks?.value ?? m.checks?.rate,
  all: pick('http_req_duration'), browse: pick('http_req_duration{kind:browse}'), account: pick('http_req_duration{kind:account}'), checkout: pick('http_req_duration{kind:checkout}'),
  paid_orders_k6: m.paid_orders?.count || 0, repeat_verify_ok: m.duplicate_verify_ok?.count || 0,
  pool: { max: ok[0]?.max, peak_total: Math.max(0, ...ok.map((x) => x.total || 0)), peak_waiting: Math.max(0, ...ok.map((x) => x.waiting || 0)), health_failures: samples.length - ok.length },
  rss_mb_peak: Math.max(0, ...ok.map((x) => x.rss_mb || 0)),
  cpu_ms_used: ok.length > 1 ? ok[ok.length - 1].cpu_ms - ok[0].cpu_ms : null,
  integrity: {
    stock_drop: before.stock - after.stock, paid_orders_added: after.paid_orders - before.paid_orders, invoices_added: after.invoices - before.invoices,
    duplicate_payment_ids: after.dup_payments, negative_stock_variants: after.negative_stock, pending_left: after.pending,
  },
};
fs.writeFileSync(path.join(rawDir, `k6-${vus}vu-${stamp}.result.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
