#!/usr/bin/env node
// Failure and recovery against the isolated QA stack only.
// Database stop/start is refused unless the live connection is 127.0.0.1:55432/vishrea_qa
// and its data directory is the throwaway cluster under the user temp folder.
//   node tests/qa/failure-recovery.mjs
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { spawnSync } from 'child_process';
import { GATEWAY_PORT, QA_DB_URL, QA_PORT, STATE_DIR } from './qa-env.mjs';

const BASE = `http://127.0.0.1:${QA_PORT}`;
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const ADDR = { name: 'QA Failure', phone: '+91 98450 00009', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, result: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
const leaked = (text) => /\n\s+at .+:\d+:\d+|service_role|KEY_SECRET|WEBHOOK_SECRET|postgres(ql)?:\/\//.test(text || '');

function assertQaUrl() {
  const u = new URL(QA_DB_URL);
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || !u.pathname.includes('qa')) throw new Error('QA database URL is not local vishrea_qa');
}

async function call(method, urlPath, { token, body, timeoutMs = 25_000 } = {}) {
  const r = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { Origin: BASE, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json, text };
}

async function login(email) {
  const start = await call('POST', '/api/auth/start-login', { body: { email } });
  const code = start.json?.debug_code;
  if (start.status !== 200 || !/^\d{6}$/.test(code || '')) throw new Error(`start-login HTTP ${start.status}`);
  const verify = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const cookies = typeof verify.headers.getSetCookie === 'function' ? verify.headers.getSetCookie() : [verify.headers.get('set-cookie') || ''];
  const token = cookies.join(';').match(/vishrea_auth=([^;]+)/)?.[1];
  if (!verify.ok || !token) throw new Error(`verify-code HTTP ${verify.status}`);
  return token;
}

async function setMode(mode) {
  const r = await fetch(`${GATEWAY}/__mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (!r.ok) throw new Error(`stand-in mode ${mode} failed`);
}

function findPgCtl() {
  const candidates = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_ctl.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_ctl.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const stockSql = `SELECT COALESCE(sum(pv.stock_quantity), 0)::int AS qty
  FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE p.slug = 'qa-checkout-stock'`;

assertQaUrl();
const outDir = path.join(STATE_DIR, 'raw');
fs.mkdirSync(outDir, { recursive: true });

let client;
let dataDir = null;
let pgCtl = null;
let stopped = false;
const email = `qa-fail-${Date.now()}@qa.test`;
let token = null;
let variantId = null;

try {
  client = new pg.Client({ connectionString: QA_DB_URL });
  await client.connect();
  client.on('error', () => {});
  const ident = (await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS addr, inet_server_port() AS port, current_setting('data_directory') AS dir")).rows[0];
  const temp = (process.env.TEMP || process.env.TMP || '').toLowerCase();
  const local = ident.db === 'vishrea_qa' && ident.addr === '127.0.0.1' && Number(ident.port) === 55432;
  const throwaway = ident.dir.toLowerCase().startsWith(temp) || /vishrea_test/i.test(ident.dir);
  if (!local || !throwaway) throw new Error('refusing to continue: connection is not the throwaway QA cluster');
  dataDir = ident.dir;
  pgCtl = findPgCtl();
  record('database identity is the throwaway cluster', true);

  const health = await call('GET', '/api/health');
  record('baseline /api/health', health.status === 200 && health.json?.db === 'up' && !leaked(health.text), `HTTP ${health.status}`);

  const fixtureBefore = (await client.query(stockSql)).rows[0].qty;
  token = await login(email);
  const product = await call('GET', '/api/product?slug=qa-checkout-stock');
  variantId = product.json?.product?.variants?.find((v) => v.size_label === 'M')?.id;
  record('QA checkout fixture is readable', product.status === 200 && Boolean(variantId), `HTTP ${product.status}`);

  const added = await call('POST', '/api/cart', { token, body: { variant_id: variantId, quantity: 1 } });
  record('bag accepts one fixture unit', added.status === 200, `HTTP ${added.status}`);

  const nul = await call('PUT', '/api/account', { token, body: { full_name: 'QA\u0000B' } });
  record('null byte is rejected with 400', nul.status === 400 && nul.json?.error === 'invalid_full_name' && !leaked(nul.text), `HTTP ${nul.status} ${nul.json?.error || ''}`);

  for (const mode of ['timeout', 'error500', 'garbage']) {
    await setMode(mode);
    const started = Date.now();
    let res;
    try {
      res = await call('POST', '/api/checkout', { token, body: { shipping_method: 'delivery', shipping_address: ADDR, idempotency_key: `fail-${mode}-${Date.now()}` }, timeoutMs: mode === 'timeout' ? 25_000 : 15_000 });
    } catch (err) {
      res = { status: 0, json: null, text: err.name };
    }
    const qty = (await client.query(stockSql)).rows[0].qty;
    const graceful = [502, 503].includes(res.status) && !leaked(res.text) && qty === fixtureBefore;
    record(`gateway ${mode} → graceful error, stock unchanged`, graceful, `HTTP ${res.status} ${res.json?.error || res.text} in ${Date.now() - started}ms, stock ${qty}`);
  }
  await setMode('ok');

  const paidPath = await call('POST', '/api/checkout', { token, body: { shipping_method: 'delivery', shipping_address: ADDR, idempotency_key: `fail-ok-${Date.now()}` } });
  const orderId = paidPath.json?.order_id;
  const held = (await client.query(stockSql)).rows[0].qty;
  record('gateway recovery: checkout succeeds after modes reset', paidPath.status === 201 && Boolean(orderId) && held === fixtureBefore - 1, `HTTP ${paidPath.status}`);
  const cancelled = orderId ? await call('POST', '/api/checkout', { token, body: { action: 'cancel', order_id: orderId } }) : { status: 0, text: '' };
  const restored = (await client.query(stockSql)).rows[0].qty;
  record('cancel releases the reserved unit', cancelled.status === 200 && restored === fixtureBefore && !leaked(cancelled.text), `HTTP ${cancelled.status}, stock ${restored}`);

  const key = `fail-dup-${Date.now()}`;
  await call('POST', '/api/cart', { token, body: { variant_id: variantId, quantity: 1 } });
  const [one, two] = await Promise.all([
    call('POST', '/api/checkout', { token, body: { shipping_method: 'delivery', shipping_address: ADDR, idempotency_key: key } }),
    call('POST', '/api/checkout', { token, body: { shipping_method: 'delivery', shipping_address: ADDR, idempotency_key: key } }),
  ]);
  const ids = [...new Set([one.json?.order_id, two.json?.order_id].filter(Boolean))];
  record('duplicate checkout with one idempotency key creates one order', ids.length === 1, `HTTP ${one.status}/${two.status}, orders ${ids.length}`);
  for (const id of ids) await call('POST', '/api/checkout', { token, body: { action: 'cancel', order_id: id } });
  const afterDup = (await client.query(stockSql)).rows[0].qty;
  record('stock fixture restored after the duplicate checkout', afterDup === fixtureBefore, `stock ${afterDup} (was ${fixtureBefore})`);

  const ac = new AbortController();
  const hung = fetch(`${BASE}/api/catalogue`, { headers: { Origin: BASE }, signal: ac.signal });
  ac.abort();
  let aborted = false;
  try { await hung; } catch { aborted = true; }
  const afterAbort = await call('GET', '/api/health');
  record('client disconnect does not take the API down', aborted && afterAbort.status === 200 && afterAbort.json?.db === 'up', `health HTTP ${afterAbort.status}`);

  if (!pgCtl) {
    record('PostgreSQL stop and restart', false, 'pg_ctl.exe was not found under Program Files');
  } else {
    const logFile = path.join(STATE_DIR, 'pg-qa.log');
    const startArgs = ['start', '-D', dataDir, '-w', '-t', '60', '-l', logFile, '-o', '-p 55432 -c listen_addresses=127.0.0.1'];
    const stop = spawnSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], { encoding: 'utf8', timeout: 40_000 });
    stopped = stop.status === 0;
    record('throwaway cluster stops', stopped, (stop.stderr || stop.stdout || '').trim().slice(0, 180));
    let down;
    try { down = await call('GET', '/api/health', { timeoutMs: 8_000 }); } catch (err) { down = { status: 0, json: null, text: err.name }; }
    record('health reports the database down, with no stack trace', down.status === 503 && down.json?.db === 'down' && !leaked(down.text), `HTTP ${down.status} ${down.json?.error || down.json?.db || down.text}`);
    const start = spawnSync(pgCtl, startArgs, { encoding: 'utf8', timeout: 70_000 });
    stopped = start.status !== 0;
    record('throwaway cluster starts again', start.status === 0, (start.stderr || start.stdout || '').trim().slice(0, 180));
    let back = { status: 0, json: null, text: '' };
    for (let i = 0; i < 20; i += 1) {
      try { back = await call('GET', '/api/health', { timeoutMs: 5_000 }); } catch (err) { back = { status: 0, json: null, text: err.name }; }
      if (back.status === 200 && back.json?.db === 'up') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    record('API recovers after the database returns', back.status === 200 && back.json?.db === 'up', `HTTP ${back.status}`);
    await client.end().catch(() => {});
    client = new pg.Client({ connectionString: QA_DB_URL });
    await client.connect();
    client.on('error', () => {});
    const qty = (await client.query(stockSql)).rows[0].qty;
    record('stock fixture unchanged by the database outage', qty === fixtureBefore, `stock ${qty}`);
  }
} catch (err) {
  record('failure-recovery harness', false, err.message);
} finally {
  if (stopped && pgCtl && dataDir) {
    spawnSync(pgCtl, ['start', '-D', dataDir, '-w', '-t', '60', '-l', path.join(STATE_DIR, 'pg-qa.log'), '-o', '-p 55432 -c listen_addresses=127.0.0.1'], { encoding: 'utf8', timeout: 70_000 });
  }
  try { await setMode('ok'); } catch { /* stand-in may be down */ }
  if (client) await client.end().catch(() => {});
}

const out = path.join(outDir, `failure-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const passed = results.filter((r) => r.result === 'PASS').length;
console.log(`\n${passed}/${results.length} passed\n${out}`);
if (passed !== results.length) process.exitCode = 1;
