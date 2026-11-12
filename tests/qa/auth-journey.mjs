#!/usr/bin/env node
// Customer sign-in, profile persistence and guest-bag journey against the isolated QA stack only.
//   node tests/qa/auth-journey.mjs
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { QA_DB_URL, QA_PORT, STATE_DIR } from './qa-env.mjs';

const BASE = `http://127.0.0.1:${QA_PORT}`;
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, result: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

async function call(method, p, body, cookie) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data, cookie: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
}
async function signIn(email) {
  const s = await call('POST', '/api/auth/start-login', { email });
  if (!s.data?.debug_code) throw new Error(`start-login ${s.status} ${s.data?.error || ''}`);
  const v = await call('POST', '/api/auth/verify-code', { email, code: s.data.debug_code });
  return { ...v, code: s.data.debug_code };
}

const db = new pg.Client({ connectionString: QA_DB_URL });
await db.connect();
const variant = (await db.query("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'qa-checkout-stock' AND v.size_label = 'S'")).rows[0].id;
const email = `qa-journey-${Date.now()}@qa.test`;

try {
  const guest = await call('GET', '/api/auth/session');
  ok('guest session is null', guest.status === 200 && guest.data?.user === null);
  ok('guest is refused on /api/account', (await call('GET', '/api/account')).status === 401);

  const first = await signIn(email);
  const uid = first.data?.user?.id;
  ok('new email creates an account and a session cookie', first.status === 200 && Boolean(uid) && /vishrea_auth=/.test(first.cookie), uid ? 'account created' : `${first.status}`);
  const rows = (await db.query('SELECT (SELECT count(*)::int FROM profiles WHERE lower(email) = $1) p, (SELECT count(*)::int FROM customer_profiles WHERE lower(email) = $1) c', [email])).rows[0];
  ok('one profile and one customer_profile row in PostgreSQL', rows.p === 1 && rows.c === 1, `profiles ${rows.p}, customer_profiles ${rows.c}`);

  const reuse = await call('POST', '/api/auth/verify-code', { email, code: first.code });
  ok('a used code cannot sign in again', reuse.status === 400 && reuse.data?.error === 'invalid_code');

  const merged = await call('POST', '/api/cart', { action: 'merge', items: [{ variant_id: variant, quantity: 2 }] }, first.cookie);
  ok('guest bag merges into the account after sign-in', merged.status === 200 && merged.data?.items?.some((i) => i.variant_id === variant && i.quantity === 2));

  const saved = await call('PUT', '/api/account', { full_name: 'Asha Journey', phone: '+91 98450 11111' }, first.cookie);
  ok('profile edit saves', saved.status === 200 && saved.data?.profile?.full_name === 'Asha Journey', `${saved.status}`);

  const out = await call('POST', '/api/auth/signout', undefined, first.cookie);
  ok('sign-out succeeds and clears the cookie', out.status === 200 && /vishrea_auth=;|vishrea_auth=$/.test(out.cookie));
  ok('old session is revoked after sign-out', (await call('GET', '/api/account', undefined, first.cookie)).status === 401);

  await new Promise((r) => setTimeout(r, 31_000));
  const upper = email.replace('qa-journey', 'QA-Journey');
  const second = await signIn(upper);
  ok('same email (different case) signs in to the same account', second.status === 200 && second.data?.user?.id === uid);
  const account = await call('GET', '/api/account', undefined, second.cookie);
  ok('profile restored after signing in again', account.data?.profile?.full_name === 'Asha Journey' && account.data?.profile?.phone === '+91 98450 11111');
  const bag = await call('GET', '/api/cart', undefined, second.cookie);
  ok('bag restored after signing in again', bag.data?.items?.some((i) => i.variant_id === variant && i.quantity === 2));
  const dup = (await db.query('SELECT count(*)::int n FROM profiles WHERE lower(email) = $1', [email])).rows[0].n;
  ok('no duplicate account was created', dup === 1, `${dup}`);

  const wrong = await call('POST', '/api/auth/verify-code', { email, code: '000000' });
  ok('wrong code is refused with a clear message', wrong.status === 400 && /incorrect or has expired/.test(wrong.data?.message || ''));

  await call('DELETE', '/api/cart', { all: true }, second.cookie);
} catch (err) {
  ok('journey harness', false, err.message);
} finally {
  await db.end();
}
const file = path.join(STATE_DIR, 'raw', `auth-journey-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.result === 'PASS').length}/${results.length} passed`);
if (results.some((r) => r.result === 'FAIL')) process.exitCode = 1;
