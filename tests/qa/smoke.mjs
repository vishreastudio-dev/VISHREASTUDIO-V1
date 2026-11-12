#!/usr/bin/env node
// End-to-end proof that the QA stack's writes stay local: sign-in, upload, bag, checkout.
//   node tests/qa/smoke.mjs        (stack must be up)
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { GATEWAY_PORT, QA_ADMIN_EMAIL, QA_DB_URL, QA_PORT, ROOT, STATE_DIR } from './qa-env.mjs';

const BASE = `http://127.0.0.1:${QA_PORT}`;
const headers = (cookie) => ({ 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) });
async function call(method, p, body, cookie) {
  const r = await fetch(BASE + p, { method, headers: headers(cookie), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, setCookie: r.headers.getSetCookie?.() || [] };
}
async function signIn(email) {
  const s = await call('POST', '/api/auth/start-login', { email });
  if (!s.data?.debug_code) throw new Error(`start-login ${s.status}`);
  const v = await call('POST', '/api/auth/verify-code', { email, code: s.data.debug_code });
  if (v.status !== 200) throw new Error(`verify-code ${v.status}`);
  return v.setCookie.map((c) => c.split(';')[0]).join('; ');
}
const gatewayStats = async () => (await fetch(`http://127.0.0.1:${GATEWAY_PORT}/__stats`)).json();

const checks = [];
const ok = (name, pass, detail = '') => checks.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);

const admin = await signIn(QA_ADMIN_EMAIL);
const session = await call('GET', '/api/auth/session', null, admin);
ok('QA admin signs in with the echoed code (no email sent)', session.data?.user?.is_admin === true);

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa7e1c8e50000000049454e44ae426082', 'hex');
const up = await call('POST', '/api/upload', { image: `data:image/png;base64,${png.toString('base64')}`, purpose: 'product' }, admin);
const uploadDir = path.join(STATE_DIR, 'uploads');
const stored = up.data?.ref && fs.existsSync(path.join(uploadDir, path.basename(up.data.ref)));
ok('admin upload is stored in scratch/qa/uploads (local driver), not Supabase', [200, 201].includes(up.status) && /^\/uploads\//.test(up.data.ref) && stored, `${up.status} ${up.data?.ref || up.data?.error}`);
ok('nothing was written to public/uploads', !fs.existsSync(path.join(ROOT, 'public', 'uploads', path.basename(up.data?.ref || 'x'))));

const db = new pg.Client({ connectionString: QA_DB_URL });
await db.connect();
const variant = (await db.query("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'qa-checkout-stock' ORDER BY v.sort_order LIMIT 1")).rows[0].id;
const customer = await signIn(`qa-smoke-${Date.now()}@qa.test`);
const before = await gatewayStats();
await call('DELETE', '/api/cart', { all: true }, customer);
const add = await call('POST', '/api/cart', { variant_id: variant, quantity: 1 }, customer);
const co = await call('POST', '/api/checkout', { shipping_method: 'delivery', shipping_address: { name: 'QA Smoke', phone: '+91 98450 00000', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } }, customer);
const after = await gatewayStats();
ok('bag add + checkout succeed', add.status < 300 && co.status === 201, `${add.status}/${co.status}`);
ok('Razorpay order was created on the local stand-in', after.byRoute['POST /orders'] === (before.byRoute['POST /orders'] || 0) + 1 && /^order_/.test(co.data?.razorpay?.order_id || ''));
const order = (await db.query('SELECT status, total FROM orders WHERE id = $1', [co.data?.order_id])).rows[0];
ok('order recorded in the local vishrea_qa database', Boolean(order), order ? `${order.status}, total ${order.total}` : 'missing');
await db.end();

const log = fs.readFileSync(fs.readdirSync(STATE_DIR).filter((f) => f.startsWith('server-')).map((f) => path.join(STATE_DIR, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], 'utf8');
ok('server log shows no Resend or Supabase traffic', !/api\.resend\.com|supabase\.co/.test(log) && /"email":false/.test(log));

console.log(checks.join('\n'));
if (checks.some((c) => c.startsWith('FAIL'))) process.exitCode = 1;
