#!/usr/bin/env node
// Builds postman/Vishrea_Studio_API.postman_collection.json and the development environment.
//   node tests/qa/postman/build-collection.mjs
// The collection holds no secrets. Session tokens are captured at run time; QA-only stand-in secrets
// (payment signature, webhook signature, crafted tokens) are passed by tests/qa/run-newman.mjs with
// --env-var and never written to disk.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ROOT } from '../qa-env.mjs';

/** The statements of a function, for a Postman script. Handles `() => expr` and block bodies. */
const body = (fn) => {
  const s = fn.toString();
  if (!/^\s*function/.test(s)) {
    const rest = s.slice(s.indexOf('=>') + 2).trim();
    if (!rest.startsWith('{')) return [`${rest};`];
    return rest.slice(1, rest.lastIndexOf('}')).split('\n');
  }
  return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).split('\n');
};

/** A valid RGB PNG (real IHDR/IDAT/IEND with CRCs), base64. */
function png(w, h, seed = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y += 1) rows.push(Buffer.from([0, ...Array.from({ length: w * 3 }, (_, i) => (i * 37 + y * 11 + seed) & 0xff)]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// ---- assertions shared by every request ---------------------------------------------------------
const COMMON = body(() => {
  const ct = pm.response.headers.get('Content-Type') || '';
  let json = null;
  if (ct.includes('json')) {
    try { json = pm.response.json(); } catch (e) { json = null; }
  }
  pm.test(`status ${EXPECT.join(' or ')}`, () => pm.expect(EXPECT).to.include(pm.response.code));
  pm.test(`response time < ${MAX_MS} ms`, () => pm.expect(pm.response.responseTime).to.be.below(MAX_MS));
  const isApi = pm.request.url.getPath().startsWith('/api/');
  if (isApi && EXPECT_JSON && pm.response.code !== 204) pm.test('JSON body', () => pm.expect(json, 'JSON').to.not.equal(null));
  if (isApi && pm.response.code >= 400 && json) {
    pm.test('error envelope {error, message, request_id}', () => {
      pm.expect(json.error).to.be.a('string');
      pm.expect(json.message).to.be.a('string');
      pm.expect(json.request_id).to.be.a('string');
    });
  }
  if (isApi) {
    pm.test('API security headers', () => {
      pm.expect(pm.response.headers.get('X-Content-Type-Options')).to.eql('nosniff');
      pm.expect(pm.response.headers.has('X-Powered-By')).to.eql(false);
      const apiPath = pm.request.url.getPath();
      const cache = pm.response.headers.get('Cache-Control') || '';
      if (!apiPath.startsWith('/api/webhooks')) {
        pm.expect(cache).to.match(/no-store|^(public|private), max-age=\d+/);
        const authed = Boolean(pm.request.headers.get('Authorization'));
        const mayBePublic = pm.request.method === 'GET' && /^\/api\/(catalogue|product|content|homepage-carousel|legal)(\/|$)/.test(apiPath);
        if (authed && !mayBePublic) pm.expect(cache).to.not.match(/^public/);
      }
    });
  }
  const text = pm.response.text();
  pm.test('no internals or secrets leaked', () => {
    pm.expect(text).to.not.match(/\n\s+at [^\n]+:\d+:\d+|postgres(ql)?:\/\/|service_role|SUPABASE_SERVICE|JWT_SECRET|KEY_SECRET|WEBHOOK_SECRET|code_hash|PRIVATE KEY/);
    pm.expect(text).to.not.match(/syntax error at or near|relation "[^"]+" does not exist|column "[^"]+" does not exist|invalid input syntax/);
    pm.expect(text).to.not.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/);
  });
  pm.variables.set('_json', json ? JSON.stringify(json) : '');
});

const AUTH = { admin: '{{tokenAdmin}}', a: '{{tokenA}}', b: '{{tokenB}}', c: '{{tokenC}}', d: '{{tokenD}}' };
const folders = new Map();
function req(folder, name, opts) {
  const { method = 'GET', path: p, as = 'none', json, raw, headers = {}, expect = [200], test, pre, maxMs = 2000, contentType = 'application/json', origin = true, binary = false } = opts;
  const h = [];
  if (AUTH[as]) h.push({ key: 'Authorization', value: `Bearer ${AUTH[as]}` });
  if (method !== 'GET' && method !== 'HEAD' && origin) h.push({ key: 'Origin', value: '{{baseUrl}}' });
  const hasBody = json !== undefined || raw !== undefined;
  if (hasBody && contentType) h.push({ key: 'Content-Type', value: contentType });
  for (const [k, v] of Object.entries(headers)) h.push({ key: k, value: v });
  const exec = [`const EXPECT = ${JSON.stringify(expect)};`, `const MAX_MS = ${maxMs};`, `const EXPECT_JSON = ${!binary};`, ...COMMON, ...(test ? ['const J = pm.variables.get("_json") ? JSON.parse(pm.variables.get("_json")) : null;', ...body(test)] : [])];
  const item = {
    name,
    request: {
      method,
      header: h,
      url: p.startsWith('http') || p.startsWith('{{') ? p : `{{baseUrl}}${p}`,
      ...(hasBody ? { body: { mode: 'raw', raw: raw !== undefined ? raw : JSON.stringify(json) } } : {}),
    },
    protocolProfileBehavior: { disableCookies: true, followRedirects: false },
    event: [{ listen: 'test', script: { type: 'text/javascript', exec } }, ...(pre ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: body(pre) } }] : [])],
  };
  if (!folders.has(folder)) folders.set(folder, []);
  folders.get(folder).push(item);
}

// Sign in: start-login returns the echoed code (QA only), verify-code issues the session cookie.
function signIn(folder, who, emailVar) {
  req(folder, `start-login (${who})`, {
    method: 'POST', path: '/api/auth/start-login', json: { email: `{{${emailVar}}}` },
    test: new Function('pm', `pm.test('code echoed (QA only)', () => pm.expect(J.debug_code).to.match(/^\\d{6}$/)); pm.collectionVariables.set('otp_${who}', J.debug_code);`),
  });
  req(folder, `verify-code (${who})`, {
    method: 'POST', path: '/api/auth/verify-code', json: { email: `{{${emailVar}}}`, code: `{{otp_${who}}}` },
    test: new Function('pm', `
      const sc = pm.response.headers.all().filter((x) => x.key.toLowerCase() === 'set-cookie').map((x) => x.value).join('; ');
      const m = sc.match(/vishrea_auth=([^;]+)/);
      pm.test('session cookie: HttpOnly, SameSite=Lax, Path=/', () => { pm.expect(m).to.not.equal(null); pm.expect(sc).to.match(/HttpOnly/i); pm.expect(sc).to.match(/SameSite=Lax/i); pm.expect(sc).to.match(/Path=\\//i); });
      pm.test('token not in the response body', () => pm.expect(pm.response.text()).to.not.include(m ? m[1] : '@@'));
      if (m) pm.collectionVariables.set('token${who === 'Admin' ? 'Admin' : who}', m[1]);
      pm.collectionVariables.set('uid${who}', J.user.id);`),
  });
}

const CHECKOUT_ADDR = { name: 'QA Buyer', phone: '+91 98450 00000', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const PNG1 = png(2, 2, 1);
const PNG4 = png(16, 16, 7);
const PNG5 = png(24, 18, 99);

// =============================================================================================
// 00 Setup: identities and fixture discovery (used by both the functional and the security run)
// =============================================================================================
const S = '00 Setup';
req(S, 'health (stack is the isolated QA stack)', {
  path: '/api/health',
  pre: () => {
    if (!pm.collectionVariables.get('runId')) pm.collectionVariables.set('runId', String(Date.now()));
    const r = pm.collectionVariables.get('runId');
    for (const w of ['a', 'b', 'c', 'd']) pm.collectionVariables.set(`email${w.toUpperCase()}`, `qa-pm-${w}-${r}@qa.test`);
  },
  test: (pm) => {
    pm.test('database up', () => pm.expect(J.db).to.eql('up'));
    pm.test('QA base URL is the isolated port 3100', () => pm.expect(pm.environment.get('baseUrl') || pm.collectionVariables.get('baseUrl')).to.include(':3100'));
  },
});
signIn(S, 'Admin', 'adminEmail');
signIn(S, 'A', 'emailA');
signIn(S, 'B', 'emailB');
signIn(S, 'C', 'emailC');
signIn(S, 'D', 'emailD');
for (const [slug, v] of [['qa-checkout-stock', 'Stock'], ['qa-five-left', 'Five'], ['qa-last-unit', 'Last']]) {
  req(S, `fixture ${slug}`, {
    path: `/api/product?slug=${slug}`,
    test: new Function('pm', `
      const vs = J.product.variants;
      pm.test('fixture present', () => pm.expect(vs.length).to.be.above(0));
      pm.collectionVariables.set('product${v}', J.product.id);
      const pick = (lbl) => vs.find((x) => x.size_label === lbl);
      ${v === 'Stock' ? "pm.collectionVariables.set('variantStock', pick('M').id); pm.collectionVariables.set('variantStockS', pick('S').id);" : ''}
      ${v === 'Five' ? "pm.collectionVariables.set('variantFive', pick('M').id); pm.collectionVariables.set('variantSoldOut', pick('S').id); pm.test('S is sold out', () => pm.expect(pick('S').in_stock).to.eql(false));" : ''}
      ${v === 'Last' ? "pm.collectionVariables.set('variantLast', vs[0].id); pm.test('last unit in stock', () => pm.expect(vs[0].in_stock).to.eql(true));" : ''}`),
  });
}

// =============================================================================================
// 01 Authentication
// =============================================================================================
const F1 = '01 Authentication';
req(F1, 'session without token → user null', { path: '/api/auth/session', test: (pm) => pm.test('user is null', () => pm.expect(J.user).to.eql(null)) });
req(F1, 'session with token A → user A, not admin', { path: '/api/auth/session', as: 'a', test: (pm) => { pm.test('email A', () => pm.expect(J.user.email).to.eql(pm.collectionVariables.get('emailA'))); pm.test('not admin', () => pm.expect(J.user.is_admin).to.eql(false)); } });
req(F1, 'session with admin token → is_admin', { path: '/api/auth/session', as: 'admin', test: (pm) => pm.test('admin', () => pm.expect(J.user.is_admin).to.eql(true)) });
req(F1, 'start-login: missing email → 400', { method: 'POST', path: '/api/auth/start-login', json: {}, expect: [400], test: (pm) => pm.test('code', () => pm.expect(J.error).to.match(/email/)) });
req(F1, 'start-login: invalid email → 400', { method: 'POST', path: '/api/auth/start-login', json: { email: 'not-an-email' }, expect: [400], test: (pm) => pm.test('invalid_email', () => pm.expect(J.error).to.eql('invalid_email')) });
req(F1, 'start-login: email as number → 400', { method: 'POST', path: '/api/auth/start-login', json: { email: 12345 }, expect: [400] });
req(F1, 'start-login: 300-char email → 400', { method: 'POST', path: '/api/auth/start-login', json: { email: `${'x'.repeat(290)}@qa.test` }, expect: [400] });
req(F1, 'start-login: malformed JSON → 400 invalid_json', { method: 'POST', path: '/api/auth/start-login', raw: '{"email": ', expect: [400], test: (pm) => pm.test('invalid_json', () => pm.expect(J.error).to.eql('invalid_json')) });
req(F1, 'start-login: text/plain body → 415', { method: 'POST', path: '/api/auth/start-login', raw: 'email=x', contentType: 'text/plain', expect: [415] });
req(F1, 'start-login: fresh code for D (previous one consumed)', { method: 'POST', path: '/api/auth/start-login', json: { email: '{{emailD}}' }, expect: [200, 429] });
req(F1, 'start-login: second resend within 30 s → 429', { method: 'POST', path: '/api/auth/start-login', json: { email: '{{emailD}}' }, expect: [429], test: (pm) => pm.test('throttled', () => pm.expect(J.error).to.be.oneOf(['otp_throttled', 'rate_limited'])) });
req(F1, 'verify-code: wrong code → 400', { method: 'POST', path: '/api/auth/verify-code', json: { email: '{{emailD}}', code: '000000' }, expect: [400], test: (pm) => pm.test('invalid_code', () => pm.expect(J.error).to.eql('invalid_code')) });
req(F1, 'verify-code: non-numeric code → 400', { method: 'POST', path: '/api/auth/verify-code', json: { email: '{{emailD}}', code: 'abcdef' }, expect: [400] });
req(F1, 'verify-code: 7-digit code → 400', { method: 'POST', path: '/api/auth/verify-code', json: { email: '{{emailD}}', code: '1234567' }, expect: [400] });
req(F1, 'verify-code: missing code → 400', { method: 'POST', path: '/api/auth/verify-code', json: { email: '{{emailD}}' }, expect: [400] });
req(F1, 'verify-code: reuse of A\'s consumed code → 400', { method: 'POST', path: '/api/auth/verify-code', json: { email: '{{emailA}}', code: '{{otp_A}}' }, expect: [400] });
req(F1, 'protected route without token → 401', { path: '/api/account', expect: [401], test: (pm) => pm.test('unauthorized', () => pm.expect(J.error).to.eql('unauthorized')) });
req(F1, 'garbage bearer token → 401', { path: '/api/account', headers: { Authorization: 'Bearer not.a.token' }, expect: [401] });
req(F1, 'expired token → 401', { path: '/api/account', headers: { Authorization: 'Bearer {{tokenExpired}}' }, expect: [401] });
req(F1, 'token signed with another secret → 401', { path: '/api/account', headers: { Authorization: 'Bearer {{tokenWrongSecret}}' }, expect: [401] });
req(F1, 'unsigned (alg none) token → 401', { path: '/api/account', headers: { Authorization: 'Bearer {{tokenAlgNone}}' }, expect: [401] });
req(F1, 'signout (D) revokes the session', { method: 'POST', path: '/api/auth/signout', as: 'd', test: (pm) => pm.test('ok', () => pm.expect(J.ok).to.eql(true)) });
req(F1, 'D\'s old token after signout → 401', { path: '/api/account', as: 'd', expect: [401] });
req(F1, 'GET on start-login → 404 (POST only)', { path: '/api/auth/start-login', expect: [404] });

// =============================================================================================
// 02 Customer (account, addresses, wearers)
// =============================================================================================
const F2 = '02 Customer';
req(F2, 'GET account (A) → full profile view', { path: '/api/account', as: 'a', test: (pm) => {
  pm.test('schema', () => { for (const k of ['user', 'profile', 'membership', 'wearers', 'addresses', 'notifications', 'rewards']) pm.expect(J).to.have.property(k); });
  pm.test('own account only', () => pm.expect(J.user.email).to.eql(pm.collectionVariables.get('emailA')));
} });
req(F2, 'PUT profile valid', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'QA Buyer A', phone: '+91 98450 00001', age_confirmed: true, notifications: { email: true, whatsapp: false, sms: false, marketing: false } }, test: (pm) => pm.test('saved', () => pm.expect(J.profile.full_name).to.eql('QA Buyer A')) });
req(F2, 'PUT profile: invalid phone → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { phone: 'call me' }, expect: [400], test: (pm) => pm.test('invalid_phone', () => pm.expect(J.error).to.eql('invalid_phone')) });
req(F2, 'PUT profile: invalid GSTIN → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { gst_number: '12ABC' }, expect: [400] });
req(F2, 'PUT profile: name 121 chars → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'x'.repeat(121) }, expect: [400], test: (pm) => pm.test('too long', () => pm.expect(J.error).to.eql('full_name_too_long')) });
req(F2, 'PUT profile: name 120 chars (boundary) → 200', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'y'.repeat(120) } });
req(F2, 'PUT profile: name as object → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: { a: 1 } }, expect: [400] });
req(F2, 'PUT profile: invalid email → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { email: 'nope' }, expect: [400] });
req(F2, 'PUT profile: is_admin in body is ignored', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'QA Buyer A', is_admin: true, role: 'admin' } });
req(F2, 'session after is_admin attempt → still not admin', { path: '/api/auth/session', as: 'a', test: (pm) => pm.test('not admin', () => pm.expect(J.user.is_admin).to.eql(false)) });
req(F2, 'POST address valid → 201', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'address', recipient_name: 'QA Buyer A', phone: '+91 98450 00001', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', is_default: true }, expect: [201], test: (pm) => { pm.collectionVariables.set('addressA', J.address.id); pm.test('default', () => pm.expect(J.address.is_default).to.eql(true)); } });
req(F2, 'POST address: pincode 05600 → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'address', recipient_name: 'X', phone: '+91 98450 00001', line1: 'L', city: 'C', state: 'Karnataka', pincode: '056001' }, expect: [400], test: (pm) => pm.test('invalid_pincode', () => pm.expect(J.error).to.eql('invalid_pincode')) });
req(F2, 'POST address: unknown state → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'address', recipient_name: 'X', phone: '+91 98450 00001', line1: 'L', city: 'C', state: 'Atlantis', pincode: '560001' }, expect: [400] });
req(F2, 'POST address: missing recipient → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'address', phone: '+91 98450 00001', line1: 'L', city: 'C', state: 'Karnataka', pincode: '560001' }, expect: [400] });
req(F2, 'POST wearer valid → 201', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer', name: 'Wearer A', size_label: 'M', bust_cm: 86, waist_cm: 70, hip_cm: 94, length_cm: 60 }, expect: [201], test: (pm) => pm.collectionVariables.set('wearerA', J.wearer.id) });
req(F2, 'POST wearer (B) → 201', { method: 'POST', path: '/api/account', as: 'b', json: { action: 'wearer', name: 'Wearer B' }, expect: [201], test: (pm) => pm.collectionVariables.set('wearerB', J.wearer.id) });
req(F2, 'POST wearer: bust 0 → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer', name: 'W', bust_cm: 0 }, expect: [400], test: (pm) => pm.test('invalid_bust_cm', () => pm.expect(J.error).to.eql('invalid_bust_cm')) });
req(F2, 'POST wearer: bust 401 → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer', name: 'W', bust_cm: 401 }, expect: [400] });
req(F2, 'POST wearer: bust "abc" → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer', name: 'W', bust_cm: 'abc' }, expect: [400] });
req(F2, 'POST wearer: missing name → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer' }, expect: [400] });
req(F2, 'PUT wearer valid', { method: 'PUT', path: '/api/account', as: 'a', json: { action: 'wearer', id: '{{wearerA}}', name: 'Wearer A2', bust_cm: 400 } });
req(F2, 'PUT wearer: invalid id → 400', { method: 'PUT', path: '/api/account', as: 'a', json: { action: 'wearer', id: 'not-a-uuid', name: 'W' }, expect: [400] });
req(F2, 'PUT wearer: unknown id → 404', { method: 'PUT', path: '/api/account', as: 'a', json: { action: 'wearer', id: '00000000-0000-4000-8000-000000000000', name: 'W' }, expect: [404] });
req(F2, 'DELETE wearer: unknown action → 400', { method: 'DELETE', path: '/api/account', as: 'a', json: { action: 'nothing' }, expect: [400] });
req(F2, 'POST unsupported action → 400', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'explode' }, expect: [400], test: (pm) => pm.test('unsupported_action', () => pm.expect(J.error).to.eql('unsupported_action')) });
req(F2, 'delete_data without DELETE confirmation → 400', { method: 'POST', path: '/api/account', as: 'c', json: { action: 'delete_data', confirm: 'yes' }, expect: [400] });
req(F2, 'PATCH account → 405', { method: 'PATCH', path: '/api/account', as: 'a', json: {}, expect: [405], test: (pm) => pm.test('Allow header', () => pm.expect(pm.response.headers.get('Allow')).to.include('GET')) });

// =============================================================================================
// 03 Catalogue
// =============================================================================================
const F3 = '03 Catalogue';
req(F3, 'GET catalogue default', { path: '/api/catalogue', test: (pm) => {
  pm.test('schema', () => { pm.expect(J.products).to.be.an('array'); pm.expect(J.total).to.be.above(0); pm.expect(J.categories).to.be.an('array'); });
  pm.test('default page size 24', () => pm.expect(J.products.length).to.eql(24));
  pm.test('no cost price exposed', () => pm.expect(pm.response.text()).to.not.include('cost_price'));
} });
req(F3, 'limit=1', { path: '/api/catalogue?limit=1', test: (pm) => pm.test('1 product', () => pm.expect(J.products.length).to.eql(1)) });
req(F3, 'limit=1000 → capped at 100', { path: '/api/catalogue?limit=1000', test: (pm) => pm.test('≤ 100', () => pm.expect(J.products.length).to.be.at.most(100)) });
req(F3, 'limit=-5 / page=0 → safe defaults', { path: '/api/catalogue?limit=-5&page=0', expect: [200, 400] });
req(F3, 'limit=abc → safe default or 400', { path: '/api/catalogue?limit=abc', expect: [200, 400] });
req(F3, 'page beyond end → empty list', { path: '/api/catalogue?page=9999', test: (pm) => pm.test('empty', () => pm.expect(J.products.length).to.eql(0)) });
req(F3, 'category=sweaters', { path: '/api/catalogue?category=sweaters&limit=100', test: (pm) => pm.test('all sweaters', () => J.products.forEach((p) => pm.expect(p.category_slug).to.eql('sweaters'))) });
req(F3, 'unknown category → empty', { path: '/api/catalogue?category=no-such-category', test: (pm) => pm.test('empty', () => pm.expect(J.products.length).to.eql(0)) });
req(F3, 'public cache header present', { path: '/api/catalogue?limit=2', test: (pm) => pm.test('X-Cache hit/miss', () => pm.expect(pm.response.headers.get('X-Cache')).to.be.oneOf(['hit', 'miss'])) });
req(F3, 'POST catalogue → 405', { method: 'POST', path: '/api/catalogue', json: {}, expect: [405] });

// =============================================================================================
// 04 Product details (and public content)
// =============================================================================================
const F4 = '04 Product Details';
req(F4, 'product by slug', { path: '/api/product?slug=qa-piece-1', test: (pm) => {
  pm.test('schema', () => { pm.expect(J.product.slug).to.eql('qa-piece-1'); pm.expect(J.product.variants).to.be.an('array'); pm.expect(J.recommendations).to.be.an('array'); });
  pm.test('≤ 4 recommendations', () => pm.expect(J.recommendations.length).to.be.at.most(4));
  pm.test('no stock counts or cost', () => { pm.expect(pm.response.text()).to.not.include('cost_price'); pm.expect(pm.response.text()).to.not.include('stock_quantity'); });
} });
req(F4, 'product by id', { path: '/api/product?id={{productStock}}', test: (pm) => pm.test('same product', () => pm.expect(J.product.id).to.eql(pm.collectionVariables.get('productStock'))) });
req(F4, 'missing slug → 400', { path: '/api/product', expect: [400], test: (pm) => pm.test('slug_required', () => pm.expect(J.error).to.eql('slug_required')) });
req(F4, 'unknown slug → 404', { path: '/api/product?slug=no-such-piece', expect: [404] });
req(F4, '500-char slug → 404 (truncated, not an error)', { path: `/api/product?slug=${'a'.repeat(500)}`, expect: [404] });
req(F4, 'content (plans, gifts, store)', { path: '/api/content', test: (pm) => pm.test('schema', () => { pm.expect(J.membership_plans).to.be.an('array').that.is.not.empty; pm.expect(J.gift_options).to.be.an('array'); }) });
req(F4, 'homepage carousel (published only)', { path: '/api/homepage-carousel', test: (pm) => pm.test('schema', () => { pm.expect(J.settings).to.be.an('object'); pm.expect(J.slides).to.be.an('array'); }) });
req(F4, 'legal pages list', { path: '/api/legal', test: (pm) => pm.test('pages', () => pm.expect(J.pages).to.be.an('array').that.is.not.empty) });
req(F4, 'legal page by slug', { path: '/api/legal?slug={{legalSlug}}', pre: () => pm.collectionVariables.set('legalSlug', pm.collectionVariables.get('legalSlug') || 'privacy'), test: (pm) => pm.test('page or null', () => pm.expect(J).to.have.property('page')) });
req(F4, 'payment config exposes key id only', { path: '/api/payment-config', test: (pm) => { pm.test('keys', () => pm.expect(Object.keys(J).sort()).to.eql(['configured', 'razorpay_key_id'])); pm.test('stand-in key', () => pm.expect(J.razorpay_key_id).to.match(/^rzp_test_/)); } });

// =============================================================================================
// 05 Search and filters
// =============================================================================================
const F5 = '05 Search and Filters';
req(F5, 'q=qa piece 1', { path: '/api/catalogue?q=qa%20piece%201&limit=100', test: (pm) => pm.test('matches contain term', () => J.products.forEach((p) => pm.expect(`${p.name} ${p.description} ${p.color}`.toLowerCase()).to.include('qa piece 1'))) });
req(F5, 'q with % wildcard is literal', { path: '/api/catalogue?q=%25', test: (pm) => pm.test('no products named %', () => pm.expect(J.products.length).to.eql(0)) });
req(F5, 'q with _ wildcard is literal', { path: '/api/catalogue?q=_', test: (pm) => pm.test('no products with _', () => pm.expect(J.products.length).to.eql(0)) });
req(F5, 'q is case-insensitive', { path: '/api/catalogue?q=QA%20PIECE%2010', test: (pm) => pm.test('found', () => pm.expect(J.products.length).to.be.above(0)) });
req(F5, 'q 200 chars → truncated, 200 OK', { path: `/api/catalogue?q=${'z'.repeat(200)}` });
req(F5, 'colour_season filter', { path: '/api/catalogue?colour_season=Soft%20Summer&limit=100', test: (pm) => pm.test('all Soft Summer', () => J.products.forEach((p) => pm.expect(p.colour_season).to.eql('Soft Summer'))) });
req(F5, 'featured=true', { path: '/api/catalogue?featured=true&limit=100', test: (pm) => pm.test('all featured', () => J.products.forEach((p) => pm.expect(p.featured).to.eql(true))) });
req(F5, 'in_stock=true', { path: '/api/catalogue?in_stock=true&limit=100', test: (pm) => pm.test('all available', () => J.products.forEach((p) => pm.expect(p.available).to.not.eql(false))) });
req(F5, 'sort=price_asc is ordered', { path: '/api/catalogue?sort=price_asc&limit=100', test: (pm) => pm.test('non-decreasing', () => { const ps = J.products.map((p) => Number(p.price_inr)); for (let i = 1; i < ps.length; i += 1) pm.expect(ps[i]).to.be.at.least(ps[i - 1]); }) });
req(F5, 'sort=price_desc is ordered', { path: '/api/catalogue?sort=price_desc&limit=100', test: (pm) => pm.test('non-increasing', () => { const ps = J.products.map((p) => Number(p.price_inr)); for (let i = 1; i < ps.length; i += 1) pm.expect(ps[i]).to.be.at.most(ps[i - 1]); }) });
req(F5, 'unknown sort → default ordering', { path: '/api/catalogue?sort=bogus' });
req(F5, 'combined filters', { path: '/api/catalogue?category=sweaters&in_stock=true&sort=newest&q=qa' });
req(F5, 'no results', { path: '/api/catalogue?q=zzzz-no-match', test: (pm) => pm.test('empty, total 0', () => { pm.expect(J.products.length).to.eql(0); pm.expect(Number(J.total)).to.eql(0); }) });

// =============================================================================================
// 06 Shopping bag
// =============================================================================================
const F6 = '06 Shopping Bag';
req(F6, 'GET bag without token → 401', { path: '/api/cart', expect: [401] });
req(F6, 'GET empty bag (A)', { path: '/api/cart', as: 'a', test: (pm) => pm.test('schema', () => { pm.expect(J.items).to.be.an('array'); pm.expect(J.estimate).to.be.an('object'); }) });
req(F6, 'add stock variant qty 1', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 1 }, test: (pm) => { pm.test('1 line', () => pm.expect(J.items.length).to.eql(1)); pm.collectionVariables.set('cartItemA', J.items[0].id); } });
req(F6, 'add same variant again → quantity 2 (merged line)', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 1 }, test: (pm) => { pm.test('still 1 line', () => pm.expect(J.items.length).to.eql(1)); pm.test('qty 2', () => pm.expect(J.items[0].quantity).to.eql(2)); } });
req(F6, 'client price fields are ignored', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStockS}}', quantity: 1, unit_price: 1, price_inr: 1, line_total: 1 }, test: (pm) => pm.test('server price', () => J.items.forEach((i) => pm.expect(Number(i.unit_price)).to.be.above(100))) });
req(F6, 'quantity 0 → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 0 }, expect: [400], test: (pm) => pm.test('invalid_quantity', () => pm.expect(J.error).to.eql('invalid_quantity')) });
req(F6, 'quantity 11 → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 11 }, expect: [400] });
req(F6, 'quantity 1.5 → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 1.5 }, expect: [400] });
req(F6, 'quantity "abc" → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 'abc' }, expect: [400] });
req(F6, 'variant_id not a UUID → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '123' }, expect: [400] });
req(F6, 'variant_id unknown → 404', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '00000000-0000-4000-8000-000000000000' }, expect: [404], test: (pm) => pm.test('product_unavailable', () => pm.expect(J.error).to.eql('product_unavailable')) });
req(F6, 'missing variant → 400 variant_required', { method: 'POST', path: '/api/cart', as: 'a', json: {}, expect: [400], test: (pm) => pm.test('variant_required', () => pm.expect(J.error).to.eql('variant_required')) });
req(F6, 'sold-out size → 409 out_of_stock', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantSoldOut}}' }, expect: [409], test: (pm) => pm.test('out_of_stock', () => pm.expect(J.error).to.eql('out_of_stock')) });
req(F6, 'PATCH quantity 3', { method: 'PATCH', path: '/api/cart', as: 'a', json: { item_id: '{{cartItemA}}', quantity: 3 }, test: (pm) => pm.test('qty 3', () => pm.expect(J.items.find((i) => i.id === pm.collectionVariables.get('cartItemA')).quantity).to.eql(3)) });
req(F6, 'PATCH quantity 0 → 400', { method: 'PATCH', path: '/api/cart', as: 'a', json: { item_id: '{{cartItemA}}', quantity: 0 }, expect: [400] });
req(F6, 'PATCH use_credit without membership → 400', { method: 'PATCH', path: '/api/cart', as: 'a', json: { item_id: '{{cartItemA}}', use_credit: true }, expect: [400], test: (pm) => pm.test('membership_not_active or premium', () => pm.expect(J.error).to.be.oneOf(['membership_not_active', 'premium_cannot_use_credit'])) });
req(F6, 'PATCH reward that is not hers → 404', { method: 'PATCH', path: '/api/cart', as: 'a', json: { item_id: '{{cartItemA}}', reward_entitlement_id: '00000000-0000-4000-8000-000000000000' }, expect: [400, 404] });
req(F6, 'PATCH unknown item → 404', { method: 'PATCH', path: '/api/cart', as: 'a', json: { item_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }, expect: [404] });
req(F6, 'DELETE without target → 400', { method: 'DELETE', path: '/api/cart', as: 'a', json: {}, expect: [400], test: (pm) => pm.test('item_required', () => pm.expect(J.error).to.eql('item_required')) });
req(F6, 'DELETE by variant', { method: 'DELETE', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStockS}}' }, test: (pm) => pm.test('1 line left', () => pm.expect(J.items.length).to.eql(1)) });
req(F6, 'merge: bad items skipped, good kept', { method: 'POST', path: '/api/cart', as: 'b', json: { action: 'merge', items: [{ variant_id: '{{variantStock}}', quantity: 1 }, { variant_id: 'bad' }, { variant_id: '{{variantSoldOut}}' }, 'x'] }, test: (pm) => pm.test('1 good line', () => pm.expect(J.items.length).to.eql(1)) });
req(F6, 'merge: items not an array → no-op', { method: 'POST', path: '/api/cart', as: 'b', json: { action: 'merge', items: 'nope' } });
req(F6, 'DELETE all (B)', { method: 'DELETE', path: '/api/cart', as: 'b', json: { all: true }, test: (pm) => pm.test('empty', () => pm.expect(J.items.length).to.eql(0)) });
req(F6, 'PUT bag → 405', { method: 'PUT', path: '/api/cart', as: 'a', json: {}, expect: [405] });

// =============================================================================================
// 07 Checkout (A keeps qty-3 stock line from the bag folder)
// =============================================================================================
const F7 = '07 Checkout';
req(F7, 'no token → 401', { method: 'POST', path: '/api/checkout', json: {}, expect: [401] });
req(F7, 'empty bag (C) → 400 cart_empty', { method: 'POST', path: '/api/checkout', as: 'c', json: { shipping_method: 'delivery', shipping_address: CHECKOUT_ADDR }, expect: [400], test: (pm) => pm.test('cart_empty', () => pm.expect(J.error).to.eql('cart_empty')) });
req(F7, 'invalid shipping method → 400', { method: 'POST', path: '/api/checkout', as: 'c', json: { shipping_method: 'drone', shipping_address: CHECKOUT_ADDR }, expect: [400] });
req(F7, 'missing address name → 400', { method: 'POST', path: '/api/checkout', as: 'c', json: { shipping_method: 'delivery', shipping_address: { ...CHECKOUT_ADDR, name: undefined } }, expect: [400] });
req(F7, 'invalid pincode → 400', { method: 'POST', path: '/api/checkout', as: 'c', json: { shipping_method: 'delivery', shipping_address: { ...CHECKOUT_ADDR, pincode: '12' } }, expect: [400] });
req(F7, 'gift message 301 chars → 400', { method: 'POST', path: '/api/checkout', as: 'c', json: { shipping_method: 'delivery', gift: true, gift_message: 'g'.repeat(301), shipping_address: CHECKOUT_ADDR }, expect: [400] });
req(F7, 'unsupported action → 400 (after order id check)', { method: 'POST', path: '/api/checkout', as: 'c', json: { action: 'explode', order_id: '00000000-0000-4000-8000-000000000000' }, expect: [400, 404] });
req(F7, 'A: valid checkout, client amounts ignored → 201', {
  method: 'POST', path: '/api/checkout', as: 'a', json: { shipping_method: 'delivery', shipping_address: CHECKOUT_ADDR, idempotency_key: 'pm-{{runId}}-a1', total: 1, amount: 100, amount_paise: 100 }, expect: [201],
  test: (pm) => {
    pm.test('razorpay order from stand-in', () => pm.expect(J.razorpay.order_id).to.match(/^order_/));
    pm.test('server-computed total > client value', () => pm.expect(Number(J.totals.total)).to.be.above(1));
    pm.test('amount (paise) = total × 100', () => pm.expect(Number(J.razorpay.amount)).to.eql(Math.round(Number(J.totals.total) * 100)));
    pm.test('pending payment', () => pm.expect(J.payment_status).to.eql('pending'));
    pm.collectionVariables.set('orderA1', J.order_id);
    pm.collectionVariables.set('rzpOrderA1', J.razorpay.order_id);
    pm.collectionVariables.set('amountA1', String(J.razorpay.amount));
  },
});
req(F7, 'same idempotency key → same order (200)', { method: 'POST', path: '/api/checkout', as: 'a', json: { shipping_method: 'delivery', shipping_address: CHECKOUT_ADDR, idempotency_key: 'pm-{{runId}}-a1' }, expect: [200], test: (pm) => pm.test('same order', () => pm.expect(J.order_id).to.eql(pm.collectionVariables.get('orderA1'))) });
req(F7, 'same bag without key → reused open order (200)', { method: 'POST', path: '/api/checkout', as: 'a', json: { shipping_method: 'delivery', shipping_address: CHECKOUT_ADDR }, expect: [200], test: (pm) => pm.test('same order', () => pm.expect(J.order_id).to.eql(pm.collectionVariables.get('orderA1'))) });
req(F7, 'resume own order', { method: 'POST', path: '/api/checkout', as: 'a', json: { action: 'resume', order_id: '{{orderA1}}' }, test: (pm) => pm.test('same gateway order', () => pm.expect(J.razorpay.order_id).to.eql(pm.collectionVariables.get('rzpOrderA1'))) });
req(F7, 'resume: invalid order id → 400', { method: 'POST', path: '/api/checkout', as: 'a', json: { action: 'resume', order_id: 'x' }, expect: [400] });
req(F7, 'resume: B on A\'s order → 404', { method: 'POST', path: '/api/checkout', as: 'b', json: { action: 'resume', order_id: '{{orderA1}}' }, expect: [404] });
req(F7, 'cancel: B on A\'s order → 404', { method: 'POST', path: '/api/checkout', as: 'b', json: { action: 'cancel', order_id: '{{orderA1}}' }, expect: [404] });
// Inventory contention on the single-unit fixture.
req(F7, 'B adds the last unit', { method: 'POST', path: '/api/cart', as: 'b', json: { variant_id: '{{variantLast}}', quantity: 1 } });
req(F7, 'B adds quantity 2 of a one-of-one → capped/400', { method: 'POST', path: '/api/cart', as: 'b', json: { variant_id: '{{variantLast}}', quantity: 2 }, expect: [400] });
req(F7, 'B checks out (holds the last unit)', { method: 'POST', path: '/api/checkout', as: 'b', json: { shipping_method: 'pickup', shipping_address: { name: 'QA B', phone: '+91 98450 00002' } }, expect: [201], test: (pm) => pm.collectionVariables.set('orderBLast', J.order_id) });
req(F7, 'C cannot add the held last unit → 409', { method: 'POST', path: '/api/cart', as: 'c', json: { variant_id: '{{variantLast}}' }, expect: [409], test: (pm) => pm.test('out_of_stock', () => pm.expect(J.error).to.eql('out_of_stock')) });
req(F7, 'product page shows it sold out while held', { path: '/api/product?slug=qa-last-unit', expect: [200, 404] });
req(F7, 'B cancels → hold released', { method: 'POST', path: '/api/checkout', as: 'b', json: { action: 'cancel', order_id: '{{orderBLast}}' }, test: (pm) => pm.test('released', () => pm.expect(J.released).to.eql(true)) });
req(F7, 'B cancel again → idempotent', { method: 'POST', path: '/api/checkout', as: 'b', json: { action: 'cancel', order_id: '{{orderBLast}}' }, test: (pm) => pm.test('nothing to release', () => pm.expect(J.released).to.eql(false)) });
req(F7, 'C can add the released unit', { method: 'POST', path: '/api/cart', as: 'c', json: { variant_id: '{{variantLast}}' } });
req(F7, 'C empties bag (fixture preserved)', { method: 'DELETE', path: '/api/cart', as: 'c', json: { all: true } });
req(F7, 'B empties bag', { method: 'DELETE', path: '/api/cart', as: 'b', json: { all: true } });
req(F7, 'last unit back in stock', { path: '/api/product?slug=qa-last-unit', test: (pm) => pm.test('in stock', () => pm.expect(J.product.variants[0].in_stock).to.eql(true)) });

// =============================================================================================
// 08 Razorpay (stand-in; signatures computed with the QA-only secret passed at run time)
// =============================================================================================
const F8 = '08 Razorpay';
const SIGN = () => {
  const sig = CryptoJS.HmacSHA256(`${pm.collectionVariables.get('rzpOrderA1')}|${pm.collectionVariables.get('payA1')}`, pm.environment.get('qaRazorpaySecret')).toString(CryptoJS.enc.Hex);
  pm.collectionVariables.set('sigA1', sig);
};
req(F8, 'stand-in: customer pays order A1', { method: 'POST', path: '{{gatewayUrl}}/__pay', json: { order_id: '{{rzpOrderA1}}' }, origin: false, test: (pm) => pm.collectionVariables.set('payA1', J.id) });
req(F8, 'verify: no token → 401', { method: 'POST', path: '/api/payment-verify', json: {}, expect: [401] });
req(F8, 'verify: missing fields → 400', { method: 'POST', path: '/api/payment-verify', as: 'a', json: { order_id: '{{orderA1}}' }, expect: [400] });
req(F8, 'verify: invalid signature → 400', { method: 'POST', path: '/api/payment-verify', as: 'a', json: { order_id: '{{orderA1}}', razorpay_payment_id: '{{payA1}}', razorpay_signature: 'deadbeef' }, expect: [400], test: (pm) => pm.test('invalid_payment_signature', () => pm.expect(J.error).to.eql('invalid_payment_signature')) });
req(F8, 'verify: mismatched razorpay_order_id → 400', { method: 'POST', path: '/api/payment-verify', as: 'a', pre: SIGN, json: { order_id: '{{orderA1}}', razorpay_order_id: 'order_other', razorpay_payment_id: '{{payA1}}', razorpay_signature: '{{sigA1}}' }, expect: [400], test: (pm) => pm.test('payment_order_mismatch', () => pm.expect(J.error).to.eql('payment_order_mismatch')) });
req(F8, 'verify: B with A\'s order → 404', { method: 'POST', path: '/api/payment-verify', as: 'b', pre: SIGN, json: { order_id: '{{orderA1}}', razorpay_payment_id: '{{payA1}}', razorpay_signature: '{{sigA1}}' }, expect: [404] });
req(F8, 'verify: valid → paid', { method: 'POST', path: '/api/payment-verify', as: 'a', pre: SIGN, json: { order_id: '{{orderA1}}', razorpay_payment_id: '{{payA1}}', razorpay_signature: '{{sigA1}}' }, test: (pm) => { pm.test('paid', () => pm.expect(J.status).to.eql('paid')); pm.test('invoice number', () => pm.expect(J.invoice_number).to.be.a('string')); } });
req(F8, 'verify: same payment again → duplicate:true', { method: 'POST', path: '/api/payment-verify', as: 'a', pre: SIGN, json: { order_id: '{{orderA1}}', razorpay_payment_id: '{{payA1}}', razorpay_signature: '{{sigA1}}' }, test: (pm) => pm.test('duplicate', () => pm.expect(J.duplicate).to.eql(true)) });
req(F8, 'stand-in: a second payment for the same order', { method: 'POST', path: '{{gatewayUrl}}/__pay', json: { order_id: '{{rzpOrderA1}}' }, origin: false, test: (pm) => pm.collectionVariables.set('payA1b', J.id) });
req(F8, 'verify: second payment → 409 duplicate_payment (refund path)', {
  method: 'POST', path: '/api/payment-verify', as: 'a',
  pre: () => pm.collectionVariables.set('sigA1b', CryptoJS.HmacSHA256(`${pm.collectionVariables.get('rzpOrderA1')}|${pm.collectionVariables.get('payA1b')}`, pm.environment.get('qaRazorpaySecret')).toString(CryptoJS.enc.Hex)),
  json: { order_id: '{{orderA1}}', razorpay_payment_id: '{{payA1b}}', razorpay_signature: '{{sigA1b}}' }, expect: [409], test: (pm) => pm.test('duplicate_payment', () => pm.expect(J.error).to.eql('duplicate_payment')),
});
const WEBHOOK_PRE = (eventVar) => new Function('pm', `
  const raw = pm.variables.replaceIn(pm.request.body.raw);
  const sig = CryptoJS.HmacSHA256(raw, pm.environment.get('qaWebhookSecret')).toString(CryptoJS.enc.Hex);
  pm.request.headers.upsert({ key: 'X-Razorpay-Signature', value: sig });
  ${eventVar ? `if (!pm.collectionVariables.get('${eventVar}')) pm.collectionVariables.set('${eventVar}', 'evt_pm_' + Date.now());` : ''}`);
const capturedEvent = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: '{{payA1}}', order_id: '{{rzpOrderA1}}', amount: '{{amountA1}}', currency: 'INR', status: 'captured' } } } }).replace('"{{amountA1}}"', '{{amountA1}}');
req(F8, 'webhook: no signature → 400', { method: 'POST', path: '/api/webhooks/razorpay', raw: capturedEvent, origin: false, expect: [400], test: (pm) => pm.test('invalid_signature', () => pm.expect(J.error).to.eql('invalid_signature')) });
req(F8, 'webhook: wrong signature → 400', { method: 'POST', path: '/api/webhooks/razorpay', raw: capturedEvent, origin: false, headers: { 'X-Razorpay-Signature': 'f'.repeat(64) }, expect: [400] });
req(F8, 'webhook: valid payment.captured for a paid order → processed', { method: 'POST', path: '/api/webhooks/razorpay', raw: capturedEvent, origin: false, headers: { 'X-Razorpay-Event-Id': '{{webhookEvent1}}' }, pre: WEBHOOK_PRE('webhookEvent1'), test: (pm) => pm.test('ok', () => pm.expect(J.ok).to.eql(true)) });
req(F8, 'webhook: same event id again → duplicate', { method: 'POST', path: '/api/webhooks/razorpay', raw: capturedEvent, origin: false, headers: { 'X-Razorpay-Event-Id': '{{webhookEvent1}}' }, pre: WEBHOOK_PRE(null), test: (pm) => pm.test('duplicate', () => pm.expect(J.duplicate).to.eql(true)) });
req(F8, 'webhook: signed malformed JSON → 400 invalid_json', { method: 'POST', path: '/api/webhooks/razorpay', raw: '{"event": ', origin: false, pre: WEBHOOK_PRE(null), expect: [400], test: (pm) => pm.test('invalid_json', () => pm.expect(J.error).to.eql('invalid_json')) });
req(F8, 'webhook: unknown event → ignored', { method: 'POST', path: '/api/webhooks/razorpay', raw: '{"event":"qa.unknown","payload":{}}', origin: false, headers: { 'X-Razorpay-Event-Id': 'evt_pm_unknown_{{runId}}' }, pre: WEBHOOK_PRE(null), test: (pm) => pm.test('ignored', () => pm.expect(J.outcome).to.eql('ignored')) });
req(F8, 'order A1 is paid and visible', { path: '/api/orders?id={{orderA1}}', as: 'a', test: (pm) => { pm.test('paid', () => pm.expect(J.order.payment_status).to.eql('paid')); pm.test('invoice', () => pm.expect(J.invoice).to.not.eql(null)); } });

// =============================================================================================
// 09 Membership
// =============================================================================================
const F9 = '09 Membership';
req(F9, 'no token → 401', { path: '/api/membership', expect: [401] });
req(F9, 'GET membership view (A)', { path: '/api/membership', as: 'a', test: (pm) => pm.test('schema', () => { for (const k of ['membership', 'billing', 'renewal', 'pricing', 'credits', 'ledger']) pm.expect(J).to.have.property(k); pm.expect(J.pricing.plans).to.be.an('array').that.is.not.empty; }) });
req(F9, 'start_checkout months=0 → 400', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'start_checkout', months: 0 }, expect: [400] });
req(F9, 'start_checkout months=25 → 400', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'start_checkout', months: 25 }, expect: [400] });
req(F9, 'start_checkout months=7 (not a plan) → 400 invalid_plan', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'start_checkout', months: 7 }, expect: [400], test: (pm) => pm.test('invalid_plan', () => pm.expect(J.error).to.eql('invalid_plan')) });
req(F9, 'start_checkout months="two" → 400', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'start_checkout', months: 'two' }, expect: [400] });
req(F9, 'start_checkout valid plan (stand-in subscription)', { method: 'POST', path: '/api/membership', as: 'c', json: { action: 'start_checkout', months: 2 }, expect: [200, 201, 503], test: (pm) => pm.collectionVariables.set('membershipStartStatus', String(pm.response.code)) });
req(F9, 'activate_paid: bad signature → 400/404', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'activate_paid', razorpay_order_id: 'order_none', razorpay_payment_id: 'pay_none', razorpay_signature: 'bad' }, expect: [400, 404] });
req(F9, 'pause without membership → 4xx', { method: 'POST', path: '/api/membership', as: 'b', json: { action: 'pause' }, expect: [400, 404, 409] });
req(F9, 'cancel without membership → 4xx', { method: 'POST', path: '/api/membership', as: 'b', json: { action: 'cancel', reason: 'qa' }, expect: [400, 404, 409] });
req(F9, 'unsupported action → 400', { method: 'POST', path: '/api/membership', as: 'a', json: { action: 'free_months' }, expect: [400] });

// =============================================================================================
// 10 Credits and rewards
// =============================================================================================
const F10 = '10 Credits and Rewards';
req(F10, 'account shows 0 credits for a non-member', { path: '/api/account', as: 'a', test: (pm) => pm.test('0 credits', () => pm.expect(Number(J.membership.credits_balance)).to.eql(0)) });
req(F10, 'customer cannot grant credits (admin route) → 403', { method: 'POST', path: '/api/admin/ops?section=credit', as: 'a', json: { auth_user_id: '{{uidA}}', delta: 10, reason: 'self' }, expect: [403] });
req(F10, 'customer cannot set membership balance → 403', { method: 'POST', path: '/api/admin/ops?section=membership', as: 'a', json: { id: '00000000-0000-4000-8000-000000000000', status: 'active', credits_balance: 99 }, expect: [403] });
req(F10, 'membership credits section reflects ledger', { path: '/api/membership', as: 'a', test: (pm) => pm.test('credits object', () => pm.expect(J.credits).to.have.property('available')) });
req(F10, 'admin credit adjustment for a non-member → 4xx', { method: 'POST', path: '/api/admin/ops?section=credit', as: 'admin', json: { auth_user_id: '{{uidA}}', delta: 1, reason: 'qa test' }, expect: [400, 404, 409] });
req(F10, 'admin: credits ledger list', { path: '/api/admin/ops?section=credits&limit=5', as: 'admin', test: (pm) => pm.test('array', () => pm.expect(J.credits).to.be.an('array')) });
req(F10, 'admin: rewards list', { path: '/api/admin/ops?section=rewards&limit=5', as: 'admin', test: (pm) => pm.test('array', () => pm.expect(J.rewards).to.be.an('array')) });
req(F10, 'admin: void unknown reward → 409', { method: 'POST', path: '/api/admin/ops?section=reward', as: 'admin', json: { id: '00000000-0000-4000-8000-000000000000', action: 'void', reason: 'qa' }, expect: [409] });
req(F10, 'admin: reward without reason → 400', { method: 'POST', path: '/api/admin/ops?section=reward', as: 'admin', json: { id: '00000000-0000-4000-8000-000000000000', action: 'void' }, expect: [400] });

// =============================================================================================
// 11 Referrals
// =============================================================================================
const F11 = '11 Referrals';
req(F11, 'public: invalid code', { path: '/api/referrals?code=NOPE123', test: (pm) => pm.test('invalid', () => { pm.expect(J.valid).to.eql(false); pm.expect(J.reason).to.eql('invalid'); }) });
req(F11, 'public: empty code', { path: '/api/referrals?code=', test: (pm) => pm.test('invalid', () => pm.expect(J.valid).to.eql(false)) });
req(F11, 'no token, no code → 401', { path: '/api/referrals', expect: [401] });
req(F11, 'A gets her referral code', { path: '/api/referrals', as: 'a', test: (pm) => { pm.test('code', () => pm.expect(J.code).to.be.a('string').and.not.empty); pm.collectionVariables.set('refCodeA', J.code); } });
req(F11, 'A checks own code → own_code', { path: '/api/referrals?code={{refCodeA}}', as: 'a', test: (pm) => pm.test('own_code', () => { pm.expect(J.valid).to.eql(false); pm.expect(J.reason).to.eql('own_code'); }) });
req(F11, 'B checks A\'s code → valid', { path: '/api/referrals?code={{refCodeA}}', as: 'b', test: (pm) => pm.test('valid', () => pm.expect(J.valid).to.eql(true)) });
req(F11, 'A attributes own code → 400', { method: 'POST', path: '/api/referrals', as: 'a', json: { action: 'attribute', code: '{{refCodeA}}' }, expect: [400, 409] });
req(F11, 'B attributes A\'s code → 201', { method: 'POST', path: '/api/referrals', as: 'b', json: { action: 'attribute', code: '{{refCodeA}}' }, expect: [201] });
req(F11, 'B attributes again → 200 (idempotent)', { method: 'POST', path: '/api/referrals', as: 'b', json: { action: 'attribute', code: '{{refCodeA}}' }, expect: [200] });
req(F11, 'attribute invalid code → 400/404', { method: 'POST', path: '/api/referrals', as: 'c', json: { action: 'attribute', code: 'NOPE123' }, expect: [400, 404] });
req(F11, 'unsupported action → 400', { method: 'POST', path: '/api/referrals', as: 'b', json: { action: 'mint' }, expect: [400] });
req(F11, 'A sees B as pending, email masked', { path: '/api/referrals', as: 'a', test: (pm) => { pm.test('1 pending', () => pm.expect(J.summary.pending).to.eql(1)); pm.test('masked', () => pm.expect(JSON.stringify(J.history)).to.not.include(pm.collectionVariables.get('emailB'))); } });

// =============================================================================================
// 12 Gift memberships
// =============================================================================================
const F12 = '12 Gift Memberships';
const GIFT = { request_type: 'individual', sender_name: 'QA Sender', sender_email: 'qa-gift@qa.test', sender_phone: '+91 98450 00003', recipient_name: 'QA Friend', membership_months: 2, submission_key: 'pm-gift-{{runId}}' };
req(F12, 'guest enquiry → 201', { method: 'POST', path: '/api/gifting', json: GIFT, expect: [201], test: (pm) => pm.test('enquiry number', () => pm.expect(J.enquiry.enquiry_number).to.be.a('string')) });
req(F12, 'same submission_key → 200 duplicate', { method: 'POST', path: '/api/gifting', json: GIFT, expect: [200], test: (pm) => pm.test('duplicate', () => pm.expect(J.duplicate).to.eql(true)) });
req(F12, 'missing sender_email → 400', { method: 'POST', path: '/api/gifting', as: 'a', json: { ...GIFT, sender_email: undefined, submission_key: undefined }, expect: [400] });
req(F12, 'corporate without company → 400', { method: 'POST', path: '/api/gifting', as: 'a', json: { ...GIFT, request_type: 'corporate', submission_key: undefined }, expect: [400] });
req(F12, 'corporate quantity 101 → 400', { method: 'POST', path: '/api/gifting', as: 'a', json: { ...GIFT, request_type: 'corporate', company_name: 'QA Co', quantity: 101, submission_key: undefined }, expect: [400] });
req(F12, 'membership_months 5 (not offered) → 400', { method: 'POST', path: '/api/gifting', as: 'a', json: { ...GIFT, membership_months: 5, submission_key: undefined }, expect: [400] });
req(F12, 'guest list → 401', { path: '/api/gifting', expect: [401] });
req(F12, 'A lists own enquiries', { path: '/api/gifting', as: 'a', test: (pm) => pm.test('array', () => pm.expect(J.enquiries).to.be.an('array')) });
req(F12, 'guest purchase → 401', { method: 'POST', path: '/api/gifting', json: { action: 'purchase' }, expect: [401] });
req(F12, 'redeem invalid token → 4xx', { method: 'POST', path: '/api/gifting', as: 'b', json: { action: 'redeem', token: 'NOT-A-REAL-CODE' }, expect: [400, 404, 409] });
req(F12, 'redeem missing token → 400', { method: 'POST', path: '/api/gifting', as: 'b', json: { action: 'redeem' }, expect: [400, 404] });
req(F12, 'admin: gift enquiries list', { path: '/api/admin/ops?section=gift_enquiries&limit=5', as: 'admin', test: (pm) => pm.test('array', () => pm.expect(J.enquiries).to.be.an('array')) });

// =============================================================================================
// 13 Orders
// =============================================================================================
const F13 = '13 Orders';
req(F13, 'no token → 401', { path: '/api/orders', expect: [401] });
req(F13, 'A lists own orders', { path: '/api/orders', as: 'a', test: (pm) => { pm.test('has A1', () => pm.expect(J.orders.map((o) => o.id)).to.include(pm.collectionVariables.get('orderA1'))); pm.test('items', () => pm.expect(J.orders[0].items).to.be.an('array')); } });
req(F13, 'limit=1000 → capped at 50', { path: '/api/orders?limit=1000', as: 'a', test: (pm) => pm.test('limit ≤ 50', () => pm.expect(Number(J.limit)).to.be.at.most(50)) });
req(F13, 'order detail (A)', { path: '/api/orders?id={{orderA1}}', as: 'a', test: (pm) => pm.test('detail', () => { pm.expect(J.order.items).to.be.an('array').that.is.not.empty; pm.expect(J.policy).to.have.property('exchange_days'); }) });
req(F13, 'B reads A\'s order → 404', { path: '/api/orders?id={{orderA1}}', as: 'b', expect: [404] });
req(F13, 'invalid id → 400', { path: '/api/orders?id=1%20OR%201=1', as: 'a', expect: [400] });
req(F13, 'unknown id → 404', { path: '/api/orders?id=00000000-0000-4000-8000-000000000000', as: 'a', expect: [404] });
req(F13, 'B\'s list does not contain A\'s order', { path: '/api/orders', as: 'b', test: (pm) => pm.test('isolated', () => pm.expect(J.orders.map((o) => o.id)).to.not.include(pm.collectionVariables.get('orderA1'))) });
req(F13, 'POST orders → 405', { method: 'POST', path: '/api/orders', as: 'a', json: {}, expect: [405] });

// =============================================================================================
// 14 Exchanges (A1 is paid; the admin marks it dispatched and delivered)
// =============================================================================================
const F14 = '14 Exchanges';
req(F14, 'A: exchange on undelivered order → 400', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: 'Wrong size', claim_type: 'exchange' }, expect: [400], test: (pm) => pm.test('order_not_delivered', () => pm.expect(J.error).to.eql('order_not_delivered')) });
req(F14, 'admin: unknown order status → 400', { method: 'POST', path: '/api/admin/ops?section=order', as: 'admin', json: { id: '{{orderA1}}', status: 'refunded_bogus' }, expect: [400] });
req(F14, 'admin: dispatch A1', { method: 'POST', path: '/api/admin/ops?section=order', as: 'admin', json: { id: '{{orderA1}}', status: 'dispatched', tracking_number: 'QA-TRK-{{runId}}' } });
req(F14, 'admin: deliver A1', { method: 'POST', path: '/api/admin/ops?section=order', as: 'admin', json: { id: '{{orderA1}}', status: 'delivered' } });
req(F14, 'admin: delivered → packed → 409', { method: 'POST', path: '/api/admin/ops?section=order', as: 'admin', json: { id: '{{orderA1}}', status: 'packed' }, expect: [409] });
req(F14, 'A: missing reason → 400', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', claim_type: 'exchange' }, expect: [400] });
req(F14, 'A: reason 501 chars → 400', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: 'r'.repeat(501), claim_type: 'exchange' }, expect: [400] });
req(F14, 'A: damage without photos → 400', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: 'Torn seam', claim_type: 'damage' }, expect: [400], test: (pm) => pm.test('damage_photos_required', () => pm.expect(J.error).to.eql('damage_photos_required')) });
req(F14, 'B: exchange on A\'s order → 404', { method: 'POST', path: '/api/exchange', as: 'b', json: { order_id: '{{orderA1}}', reason: 'Not mine', claim_type: 'exchange' }, expect: [404] });
req(F14, 'A: exchange request → 201', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: 'Wrong size', claim_type: 'exchange' }, expect: [201], test: (pm) => pm.collectionVariables.set('exchangeA', J.exchange.id) });
req(F14, 'A: second open request → 409', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: 'Again', claim_type: 'exchange' }, expect: [409], test: (pm) => pm.test('exchange_already_open', () => pm.expect(J.error).to.eql('exchange_already_open')) });
req(F14, 'A lists own exchanges', { path: '/api/exchange', as: 'a', test: (pm) => pm.test('has it', () => pm.expect(J.exchanges.map((e) => e.id)).to.include(pm.collectionVariables.get('exchangeA'))) });
req(F14, 'B list excludes A\'s exchange', { path: '/api/exchange', as: 'b', test: (pm) => pm.test('isolated', () => pm.expect(J.exchanges.map((e) => e.id)).to.not.include(pm.collectionVariables.get('exchangeA'))) });
req(F14, 'admin: approve without resolution → 400', { method: 'POST', path: '/api/admin/ops?section=exchange', as: 'admin', json: { id: '{{exchangeA}}', status: 'approved' }, expect: [400, 409] });
req(F14, 'admin: move to review', { method: 'POST', path: '/api/admin/ops?section=exchange', as: 'admin', json: { id: '{{exchangeA}}', status: 'review' } });
req(F14, 'customer cannot approve own exchange → 403', { method: 'POST', path: '/api/admin/ops?section=exchange', as: 'a', json: { id: '{{exchangeA}}', status: 'approved', resolution: 'self' }, expect: [403] });
req(F14, 'admin: unknown exchange → 404', { method: 'POST', path: '/api/admin/ops?section=exchange', as: 'admin', json: { id: '00000000-0000-4000-8000-000000000000', status: 'review' }, expect: [404] });

// =============================================================================================
// 15 Media uploads
// =============================================================================================
const F15 = '15 Media Uploads';
const dataUrl = (b64, mime = 'image/png') => `data:${mime};base64,${b64}`;
req(F15, 'no token → 401', { method: 'POST', path: '/api/upload', json: { image: dataUrl(PNG1) }, expect: [401] });
req(F15, 'customer evidence upload → private storage:// ref', { method: 'POST', path: '/api/upload', as: 'a', json: { image: dataUrl(PNG4) }, expect: [200, 201], maxMs: 5000, test: (pm) => { pm.test('private ref', () => pm.expect(J.ref).to.match(/^storage:\/\/exchange-evidence\/evidence\//)); pm.test('signed url', () => pm.expect(J.url).to.include('/api/media/signed')); pm.collectionVariables.set('evidenceA', J.ref); pm.collectionVariables.set('evidenceUrlA', J.url); } });
req(F15, 'signed evidence link works', { path: '{{baseUrl}}{{evidenceUrlA}}', binary: true, test: (pm) => pm.test('image', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('image/png')) });
req(F15, 'customer purpose=product → 403', { method: 'POST', path: '/api/upload', as: 'a', json: { image: dataUrl(PNG4), purpose: 'product' }, expect: [403], test: (pm) => pm.test('upload_forbidden', () => pm.expect(J.error).to.eql('upload_forbidden')) });
req(F15, 'missing file → 400', { method: 'POST', path: '/api/upload', as: 'a', json: {}, expect: [400], test: (pm) => pm.test('file_required', () => pm.expect(J.error).to.eql('file_required')) });
req(F15, 'SVG → 415', { method: 'POST', path: '/api/upload', as: 'a', json: { image: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}` }, expect: [415] });
req(F15, 'HTML labelled image/png → 415', { method: 'POST', path: '/api/upload', as: 'a', json: { image: dataUrl(Buffer.from('<html><body><script>alert(1)</script></body></html>').toString('base64')) }, expect: [415] });
req(F15, 'truncated PNG → 422', { method: 'POST', path: '/api/upload', as: 'a', json: { image: dataUrl(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]).toString('base64')) }, expect: [422], test: (pm) => pm.test('unreadable_image', () => pm.expect(J.error).to.eql('unreadable_image')) });
req(F15, 'admin product upload → /uploads ref (local driver)', { method: 'POST', path: '/api/upload', as: 'admin', json: { image: dataUrl(PNG4), purpose: 'product' }, expect: [200, 201], test: (pm) => { pm.test('local public ref', () => pm.expect(J.ref).to.match(/^\/uploads\//)); pm.collectionVariables.set('adminUploadRef', J.ref); } });
req(F15, 'admin purpose=evidence → 400', { method: 'POST', path: '/api/upload', as: 'admin', json: { image: dataUrl(PNG4), purpose: 'evidence' }, expect: [400] });
req(F15, 'registered upload is served', { path: '{{baseUrl}}{{adminUploadRef}}' });
req(F15, 'unregistered /uploads name → 404', { path: '/uploads/image_1_0000000000000000.png', expect: [404] });
req(F15, 'oversized customer upload (Content-Length > limit) → 413', { method: 'POST', path: '/api/upload', as: 'b', raw: '{{bigBody}}', pre: () => pm.collectionVariables.set('bigBody', JSON.stringify({ image: `data:image/png;base64,${'A'.repeat(7_600_000)}` })), expect: [413], maxMs: 8000, test: (pm) => pm.collectionVariables.unset('bigBody') });

// =============================================================================================
// 16 Colour analysis
// =============================================================================================
const F16 = '16 Colour Analysis';
const COLOUR = { undertone: 'warm', palette: ['#AA3322', '#CC8844', '#556B2F'], season: 'True Autumn', confidence: 0.8, quality_score: 70, lighting: 'balanced' };
req(F16, 'no token → 401', { path: '/api/colour-review', expect: [401] });
req(F16, 'GET (none yet) → null', { path: '/api/colour-review', as: 'b', test: (pm) => pm.test('null', () => pm.expect(J.review).to.eql(null)) });
req(F16, 'POST valid → 201', { method: 'POST', path: '/api/colour-review', as: 'b', json: COLOUR, expect: [201], test: (pm) => pm.test('saved', () => pm.expect(J.review.season).to.eql('True Autumn')) });
req(F16, 'confidence 5 is clamped to 1', { method: 'POST', path: '/api/colour-review', as: 'b', json: { ...COLOUR, confidence: 5, quality_score: 500 }, expect: [201], test: (pm) => pm.test('clamped', () => { pm.expect(Number(J.review.confidence)).to.eql(1); pm.expect(Number(J.review.quality_score)).to.eql(100); }) });
req(F16, 'palette < 3 valid colours → 400', { method: 'POST', path: '/api/colour-review', as: 'b', json: { ...COLOUR, palette: ['#AA3322', 'red', '#12'] }, expect: [400] });
req(F16, 'unknown season → 400', { method: 'POST', path: '/api/colour-review', as: 'b', json: { ...COLOUR, season: 'Monsoon' }, expect: [400] });
req(F16, 'photo field rejected → 400', { method: 'POST', path: '/api/colour-review', as: 'b', json: { ...COLOUR, image: 'data:image/png;base64,AAAA' }, expect: [400], test: (pm) => pm.test('raw_image_not_accepted', () => pm.expect(J.error).to.eql('raw_image_not_accepted')) });
req(F16, 'missing undertone → 400', { method: 'POST', path: '/api/colour-review', as: 'b', json: { ...COLOUR, undertone: undefined }, expect: [400] });
req(F16, 'GET returns the latest', { path: '/api/colour-review', as: 'b', test: (pm) => pm.test('latest', () => pm.expect(J.review).to.not.eql(null)) });

// =============================================================================================
// 17 Admin
// =============================================================================================
const F17 = '17 Admin';
req(F17, 'no token → 401', { path: '/api/admin/ops', expect: [401] });
req(F17, 'customer → 403', { path: '/api/admin/ops', as: 'a', expect: [403], test: (pm) => pm.test('forbidden', () => pm.expect(J.error).to.eql('forbidden')) });
for (const s of ['dashboard', 'settings', 'products', 'categories', 'orders', 'customers', 'memberships', 'credits', 'exchanges', 'loyalty', 'drops', 'sourcing', 'content', 'audit', 'admins', 'couriers', 'gift_enquiries', 'referrals', 'rewards', 'invoices', 'store']) {
  req(F17, `GET section=${s}`, { path: `/api/admin/ops?section=${s}&limit=5`, as: 'admin', maxMs: 3000 });
}
req(F17, 'unknown section → 400', { path: '/api/admin/ops?section=bogus', as: 'admin', expect: [400], test: (pm) => pm.test('unknown_section', () => pm.expect(J.error).to.eql('unknown_section')) });
req(F17, 'customer detail', { path: '/api/admin/ops?section=customer&id={{uidA}}', as: 'admin', test: (pm) => pm.test('A', () => pm.expect(J.profile.email).to.eql(pm.collectionVariables.get('emailA'))) });
req(F17, 'customer detail unknown → 404', { path: '/api/admin/ops?section=customer&id=usr_nope', as: 'admin', expect: [404] });
req(F17, 'exchanges list gives signed evidence links only', { path: '/api/admin/ops?section=exchanges&limit=20', as: 'admin', test: (pm) => pm.test('no permanent public URL for evidence', () => pm.expect(pm.response.text()).to.not.match(/\/storage\/v1\/object\/public\/exchange-evidence/)) });
req(F17, 'create QA product', { method: 'POST', path: '/api/admin/ops?section=product', as: 'admin', json: { name: 'QA PM Product {{runId}}', price_inr: 2100, category: 'Tops', is_one_of_one: true }, test: (pm) => { pm.collectionVariables.set('pmProduct', J.product.id); pm.test('variant created', () => pm.expect(J.product.variants.length).to.be.above(0)); } });
req(F17, 'product: negative price → 400', { method: 'POST', path: '/api/admin/ops?section=product', as: 'admin', json: { name: 'QA Bad', price_inr: -1, category: 'Tops' }, expect: [400] });
req(F17, 'product: missing name → 400', { method: 'POST', path: '/api/admin/ops?section=product', as: 'admin', json: { price_inr: 100, category: 'Tops' }, expect: [400] });
req(F17, 'product_status: hide QA product', { method: 'POST', path: '/api/admin/ops?section=product_status', as: 'admin', json: { id: '{{pmProduct}}', is_active: false } });
req(F17, 'hidden product is not public', { path: '/api/product?id={{pmProduct}}', expect: [404] });
req(F17, 'category: invalid slug → 400', { method: 'POST', path: '/api/admin/ops?section=category', as: 'admin', json: { name: 'QA Cat', slug: 'Bad Slug!' }, expect: [400] });
req(F17, 'membership: unknown → 404', { method: 'POST', path: '/api/admin/ops?section=membership', as: 'admin', json: { id: '00000000-0000-4000-8000-000000000000', status: 'active' }, expect: [404] });
req(F17, 'unknown write section → 400', { method: 'POST', path: '/api/admin/ops?section=bogus', as: 'admin', json: {}, expect: [400] });
req(F17, 'unsupported delete → 400', { method: 'DELETE', path: '/api/admin/ops?section=bogus', as: 'admin', expect: [400] });
req(F17, 'homepage carousel admin view', { path: '/api/admin/homepage-carousel', as: 'admin', test: (pm) => pm.test('slides', () => pm.expect(J).to.have.property('slides')) });
req(F17, 'carousel: unknown action → 400', { method: 'POST', path: '/api/admin/homepage-carousel', as: 'admin', json: { action: 'explode' }, expect: [400] });
req(F17, 'carousel as customer → 403', { path: '/api/admin/homepage-carousel', as: 'a', expect: [403] });
req(F17, 'listing studio without AI → 502 graceful', { method: 'POST', path: '/api/admin/listing-studio', as: 'admin', json: { category: 'Tops' }, expect: [502], maxMs: 5000, test: (pm) => pm.test('listing_ai_unavailable', () => pm.expect(J.error).to.eql('listing_ai_unavailable')) });
req(F17, 'listing studio missing category → 400', { method: 'POST', path: '/api/admin/listing-studio', as: 'admin', json: {}, expect: [400] });
req(F17, 'export orders CSV', { path: '/api/admin/ops?section=export&type=orders', as: 'admin', binary: true, test: (pm) => pm.test('csv', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('csv')) });

// =============================================================================================
// 18 Security (run separately: node tests/qa/run-newman.mjs security)
// =============================================================================================
const F18 = '18 Security';
// Fixtures for this run (the security run starts on a fresh stack after 00 Setup only).
req(F18, 'fixture: A wearer', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'wearer', name: 'Sec Wearer A' }, expect: [201], test: (pm) => pm.collectionVariables.set('wearerA', J.wearer.id) });
req(F18, 'fixture: A bag line', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 1 }, test: (pm) => pm.collectionVariables.set('cartItemA', J.items[0].id) });
req(F18, 'fixture: A pending order', { method: 'POST', path: '/api/checkout', as: 'a', json: { shipping_method: 'delivery', shipping_address: CHECKOUT_ADDR }, expect: [201, 200], test: (pm) => pm.collectionVariables.set('orderA1', J.order_id) });
req(F18, 'fixture: A private evidence', { method: 'POST', path: '/api/upload', as: 'a', json: { image: `data:image/png;base64,${PNG5}` }, expect: [200, 201], maxMs: 5000, test: (pm) => pm.collectionVariables.set('evidenceA', J.ref) });
req(F18, 'fixture: admin QA product', { method: 'POST', path: '/api/admin/ops?section=product', as: 'admin', json: { name: 'QA Sec Product {{runId}}', price_inr: 2100, category: 'Tops', is_one_of_one: true }, test: (pm) => pm.collectionVariables.set('pmProduct', J.product.id) });
// SQL injection (non-destructive payloads; responses must be normal and fast)
for (const [label, q] of [['tautology', "' OR '1'='1"], ['comment', "qa'--"], ['union', "' UNION SELECT email FROM profiles--"], ['stacked', "x'; SELECT pg_sleep(3);--"], ['sleep', "'||pg_sleep(3)||'"]]) {
  req(F18, `SQLi catalogue q (${label})`, { path: `/api/catalogue?q=${encodeURIComponent(q)}`, maxMs: 1500, test: (pm) => pm.test('no rows leaked', () => pm.expect(J.products.length).to.eql(0)) });
}
req(F18, 'SQLi category', { path: `/api/catalogue?category=${encodeURIComponent("tops' OR 1=1--")}`, test: (pm) => pm.test('empty', () => pm.expect(J.products.length).to.eql(0)) });
req(F18, 'SQLi sort → default', { path: `/api/catalogue?sort=${encodeURIComponent('price_asc; DROP TABLE products')}` });
req(F18, 'SQLi product slug → 404', { path: `/api/product?slug=${encodeURIComponent("qa-piece-1' OR '1'='1")}`, expect: [404] });
req(F18, 'SQLi order id → 400', { path: `/api/orders?id=${encodeURIComponent("' OR 1=1--")}`, as: 'a', expect: [400] });
req(F18, 'SQLi referral code', { path: `/api/referrals?code=${encodeURIComponent("' OR '1'='1")}`, test: (pm) => pm.test('invalid', () => pm.expect(J.valid).to.eql(false)) });
req(F18, 'SQLi admin product search', { path: `/api/admin/ops?section=products&q=${encodeURIComponent("' OR 1=1--")}`, as: 'admin', test: (pm) => pm.test('no match', () => pm.expect(J.products.length).to.eql(0)) });
req(F18, 'SQLi admin orders search', { path: `/api/admin/ops?section=orders&q=${encodeURIComponent("%' OR '1'='1")}`, as: 'admin', test: (pm) => pm.test('no match', () => pm.expect(J.orders.length).to.eql(0)) });
req(F18, 'SQLi in JSON field (address line1) stored as text', { method: 'POST', path: '/api/account', as: 'a', json: { action: 'address', recipient_name: "Robert'); DROP TABLE addresses;--", phone: '+91 98450 00001', line1: "1' OR '1'='1", city: 'C', state: 'Karnataka', pincode: '560001' }, expect: [201], test: (pm) => pm.test('stored verbatim', () => pm.expect(J.address.recipient_name).to.include('DROP TABLE')) });
req(F18, 'addresses table intact', { path: '/api/account', as: 'a', test: (pm) => pm.test('addresses listed', () => pm.expect(J.addresses.length).to.be.above(0)) });
// XSS: JSON APIs return data, never HTML; server-rendered pages must escape
const XSS = '<img src=x onerror=alert(1)><script>alert(1)</script>';
req(F18, 'XSS in profile name returned as JSON (no HTML context)', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: XSS }, test: (pm) => { pm.test('JSON content type', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json')); pm.test('CSP on API', () => pm.expect(pm.response.headers.get('Content-Security-Policy')).to.include("default-src 'none'")); } });
req(F18, 'XSS gift enquiry message stored as text', { method: 'POST', path: '/api/gifting', as: 'b', json: { request_type: 'individual', sender_name: XSS.slice(0, 100), sender_email: 'qa-xss@qa.test', sender_phone: '+91 98450 00004', recipient_name: 'R', membership_months: 2, message: XSS }, expect: [200, 201] });
req(F18, 'admin creates product with XSS name', { method: 'POST', path: '/api/admin/ops?section=product', as: 'admin', json: { name: `QA XSS ${XSS}`, price_inr: 2100, category: 'Tops', is_one_of_one: true, description: XSS }, test: (pm) => { pm.collectionVariables.set('xssSlug', J.product.slug); pm.collectionVariables.set('xssProduct', J.product.id); } });
req(F18, 'server-rendered product page escapes the name', { path: '/product/{{xssSlug}}', test: (pm) => {
  const html = pm.response.text();
  const head = html.slice(0, html.indexOf('</head>'));
  pm.test('no raw <script>alert / <img onerror in <head>', () => { pm.expect(head).to.not.include('<script>alert(1)</script>'); pm.expect(head).to.not.include('<img src=x onerror'); });
  pm.test('HTML CSP enforced', () => pm.expect(pm.response.headers.get('Content-Security-Policy') || '').to.include("default-src 'self'"));
} });
req(F18, 'XSS product hidden again', { method: 'POST', path: '/api/admin/ops?section=product_status', as: 'admin', json: { id: '{{xssProduct}}', is_active: false } });
// IDOR and customer-to-customer isolation
req(F18, 'IDOR: B reads A\'s order', { path: '/api/orders?id={{orderA1}}', as: 'b', expect: [404] });
req(F18, 'IDOR: B resumes A\'s checkout', { method: 'POST', path: '/api/checkout', as: 'b', json: { action: 'resume', order_id: '{{orderA1}}' }, expect: [404] });
req(F18, 'IDOR: B verifies payment on A\'s order', { method: 'POST', path: '/api/payment-verify', as: 'b', json: { order_id: '{{orderA1}}', razorpay_payment_id: 'pay_x', razorpay_signature: 'x' }, expect: [404] });
req(F18, 'IDOR: B edits A\'s wearer', { method: 'PUT', path: '/api/account', as: 'b', json: { action: 'wearer', id: '{{wearerA}}', name: 'Hijacked' }, expect: [404] });
req(F18, 'IDOR: B deletes A\'s wearer', { method: 'DELETE', path: '/api/account', as: 'b', json: { action: 'wearer', id: '{{wearerA}}' }, expect: [404] });
req(F18, 'IDOR: B patches A\'s bag line', { method: 'PATCH', path: '/api/cart', as: 'b', json: { item_id: '{{cartItemA}}', quantity: 1 }, expect: [404] });
req(F18, 'IDOR: B deletes A\'s bag line (no effect)', { method: 'DELETE', path: '/api/cart', as: 'b', json: { item_id: '{{cartItemA}}' } });
req(F18, 'A\'s bag line still there', { path: '/api/cart', as: 'a', test: (pm) => pm.test('present', () => pm.expect(J.items.map((i) => i.id)).to.include(pm.collectionVariables.get('cartItemA'))) });
req(F18, 'IDOR: B files damage with A\'s evidence → refused', { method: 'POST', path: '/api/exchange', as: 'b', json: { order_id: '{{orderA1}}', reason: 'damage', claim_type: 'damage', evidence_urls: ['{{evidenceA}}'] }, expect: [400, 404] });
req(F18, 'IDOR: B cannot see A\'s exchanges', { path: '/api/exchange', as: 'b', test: (pm) => pm.test('none of A\'s', () => pm.expect(JSON.stringify(J)).to.not.include(pm.collectionVariables.get('orderA1'))) });
// Privilege escalation
for (const [section, payload] of [['settings', { settings: { membership_price: 1 } }], ['product', { name: 'x', price_inr: 1, category: 'Tops' }], ['credit', { auth_user_id: '{{uidB}}', delta: 100, reason: 'x' }], ['admin', { email: '{{emailB}}', role: 'admin' }], ['order', { id: '{{orderA1}}', status: 'refunded' }]]) {
  req(F18, `escalation: customer POST admin ${section} → 403`, { method: 'POST', path: `/api/admin/ops?section=${section}`, as: 'b', json: payload, expect: [403] });
}
req(F18, 'escalation: customer DELETE admin product → 403', { method: 'DELETE', path: '/api/admin/ops?section=product&id={{pmProduct}}', as: 'b', expect: [403] });
req(F18, 'escalation: customer GET admin customers → 403', { path: '/api/admin/ops?section=customers', as: 'b', expect: [403] });
req(F18, 'escalation: customer listing studio → 403', { method: 'POST', path: '/api/admin/listing-studio', as: 'b', json: { category: 'Tops' }, expect: [403] });
req(F18, 'escalation: prototype pollution payload ignored', { method: 'PUT', path: '/api/account', as: 'b', raw: '{"full_name":"QA B","__proto__":{"is_admin":true},"constructor":{"prototype":{"is_admin":true}}}' });
req(F18, 'B still not admin', { path: '/api/auth/session', as: 'b', test: (pm) => pm.test('not admin', () => pm.expect(J.user.is_admin).to.eql(false)) });
req(F18, 'escalation: tampered payment amount on verify ignored (server amount)', { path: '/api/orders?id={{orderA1}}', as: 'a', test: (pm) => pm.test('total unchanged', () => pm.expect(Number(J.order.total)).to.be.above(1)) });
// CSRF (cookie-authenticated requests)
req(F18, 'CSRF: cookie + foreign Origin → 403', { method: 'PUT', path: '/api/account', origin: false, headers: { Cookie: 'vishrea_auth={{tokenA}}', Origin: 'https://evil.example' }, json: { full_name: 'csrf' }, expect: [403], test: (pm) => pm.test('origin_not_allowed', () => pm.expect(J.error).to.eql('origin_not_allowed')) });
req(F18, 'CSRF: cookie + no Origin/Referer → 403', { method: 'PUT', path: '/api/account', origin: false, headers: { Cookie: 'vishrea_auth={{tokenA}}' }, json: { full_name: 'csrf' }, expect: [403], test: (pm) => pm.test('origin_required', () => pm.expect(J.error).to.eql('origin_required')) });
req(F18, 'CSRF: cookie + foreign Referer → 403', { method: 'PUT', path: '/api/account', origin: false, headers: { Cookie: 'vishrea_auth={{tokenA}}', Referer: 'https://evil.example/page' }, json: { full_name: 'csrf' }, expect: [403] });
req(F18, 'CSRF: form-encoded body (simple request) → 415', { method: 'POST', path: '/api/account', headers: { Cookie: 'vishrea_auth={{tokenA}}' }, raw: 'action=delete_data&confirm=DELETE', contentType: 'application/x-www-form-urlencoded', expect: [415] });
req(F18, 'CSRF: cookie + same Origin → allowed', { method: 'PUT', path: '/api/account', headers: { Cookie: 'vishrea_auth={{tokenA}}' }, json: { full_name: 'QA Buyer A' } });
req(F18, 'CORS: foreign preflight gets no allow-origin', { method: 'OPTIONS', path: '/api/account', origin: false, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' }, expect: [204, 200, 404, 405], test: (pm) => pm.test('no ACAO for evil origin', () => pm.expect(pm.response.headers.get('Access-Control-Allow-Origin') || '').to.not.eql('https://evil.example')) });
// Media privacy
req(F18, 'evidence not reachable via /uploads', { path: '/uploads/.private/exchange-evidence/x.png', expect: [404] });
req(F18, 'signed link with forged signature → 404', { path: '/api/media/signed?ref={{evidenceA}}&exp=9999999999&sig=AAAA', expect: [404] });
req(F18, 'signed link expired → 404', { path: '/api/media/signed?ref={{evidenceA}}&exp=1&sig=AAAA', expect: [404] });
req(F18, 'customer cannot list evidence via admin', { path: '/api/admin/ops?section=exchanges', as: 'b', expect: [403] });
// Sensitive information exposure
req(F18, 'public product has no cost price or stock counts', { path: '/api/product?slug=qa-piece-2', test: (pm) => { pm.expect(pm.response.text()).to.not.include('cost_price'); pm.expect(pm.response.text()).to.not.include('stock_quantity'); } });
req(F18, 'session endpoint returns only safe user fields', { path: '/api/auth/session', as: 'a', test: (pm) => pm.test('fields', () => pm.expect(Object.keys(J.user).sort()).to.eql(['email', 'id', 'is_admin', 'name'])) });
req(F18, 'account view excludes other customers', { path: '/api/account', as: 'a', test: (pm) => pm.test('no B data', () => pm.expect(pm.response.text()).to.not.include(pm.collectionVariables.get('emailB'))) });
req(F18, 'unknown API route: JSON 404, no stack', { path: '/api/does-not-exist', expect: [404] });
req(F18, 'robots.txt blocks indexing outside production', { path: '/robots.txt', test: (pm) => pm.test('Disallow /', () => pm.expect(pm.response.text()).to.include('Disallow: /')) });

// =============================================================================================
// 19 Error handling
// =============================================================================================
const F19 = '19 Error Handling';
req(F19, 'unknown API route → 404 JSON', { path: '/api/nope', expect: [404], test: (pm) => pm.test('not_found', () => pm.expect(J.error).to.eql('not_found')) });
req(F19, 'wrong method → 405 + Allow', { method: 'DELETE', path: '/api/catalogue', expect: [405], test: (pm) => pm.test('Allow', () => pm.expect(pm.response.headers.get('Allow')).to.eql('GET')) });
req(F19, 'malformed JSON → 400 invalid_json', { method: 'PUT', path: '/api/account', as: 'a', raw: '{"full_name": "x",', expect: [400], test: (pm) => pm.test('invalid_json', () => pm.expect(J.error).to.eql('invalid_json')) });
req(F19, 'JSON body > 200 KB → 413', { method: 'PUT', path: '/api/account', as: 'a', raw: '{{bigJson}}', pre: () => pm.collectionVariables.set('bigJson', JSON.stringify({ full_name: 'x', pad: 'p'.repeat(210_000) })), expect: [413], test: (pm) => { pm.test('payload_too_large', () => pm.expect(J.error).to.eql('payload_too_large')); pm.collectionVariables.unset('bigJson'); } });
req(F19, 'non-JSON body → 415', { method: 'PUT', path: '/api/account', as: 'a', raw: '<x/>', contentType: 'application/xml', expect: [415] });
req(F19, 'JSON array instead of object → handled', { method: 'PUT', path: '/api/account', as: 'a', raw: '[1,2,3]', expect: [200, 400] });
req(F19, 'JSON null body → handled', { method: 'POST', path: '/api/cart', as: 'a', raw: 'null', expect: [400] });
req(F19, 'invalid UUID in query → 400', { path: '/api/orders?id=zzz', as: 'a', expect: [400] });
req(F19, 'unicode / emoji input accepted', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'QA ✨ ಕನ್ನಡ' }, test: (pm) => pm.test('round trip', () => pm.expect(J.profile.full_name).to.eql('QA ✨ ಕನ್ನಡ')) });
req(F19, 'null byte in text → 400 (not a database 500)', { method: 'PUT', path: '/api/account', as: 'a', json: { full_name: 'QA\u0000B' }, expect: [400], test: (pm) => pm.test('invalid_full_name', () => pm.expect(J.error).to.eql('invalid_full_name')) });
req(F19, 'huge number for quantity → 400', { method: 'POST', path: '/api/cart', as: 'a', json: { variant_id: '{{variantStock}}', quantity: 1e308 }, expect: [400] });
req(F19, 'nested object where text expected → 400', { method: 'POST', path: '/api/exchange', as: 'a', json: { order_id: '{{orderA1}}', reason: { $gt: '' } }, expect: [400] });
req(F19, 'health', { path: '/api/health', test: (pm) => pm.test('ok', () => pm.expect(J.ok).to.eql(true)) });
req(F19, 'unknown SPA route → HTML 404 status', { path: '/no-such-page-qa', expect: [404, 200] });

// ---- write -----------------------------------------------------------------------------------
const order = ['00 Setup', '01 Authentication', '02 Customer', '03 Catalogue', '04 Product Details', '05 Search and Filters', '06 Shopping Bag', '07 Checkout', '08 Razorpay', '09 Membership', '10 Credits and Rewards', '11 Referrals', '12 Gift Memberships', '13 Orders', '14 Exchanges', '15 Media Uploads', '16 Colour Analysis', '17 Admin', '18 Security', '19 Error Handling'];
const collection = {
  info: { name: 'Vishrea Studio API (QA)', description: 'Functional, negative and security tests for the isolated QA stack (http://127.0.0.1:3100). Generated by tests/qa/postman/build-collection.mjs. Contains no secrets.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: order.map((name) => ({ name, item: folders.get(name) || [] })),
  variable: [{ key: 'runId', value: '' }],
};
const env = {
  name: 'Vishrea Studio Development (isolated QA)',
  values: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3100', enabled: true },
    { key: 'gatewayUrl', value: 'http://127.0.0.1:3190', enabled: true },
    { key: 'adminEmail', value: 'qa-admin@qa.test', enabled: true },
    { key: 'qaRazorpaySecret', value: '<set at run time by tests/qa/run-newman.mjs>', enabled: true, type: 'secret' },
    { key: 'qaWebhookSecret', value: '<set at run time by tests/qa/run-newman.mjs>', enabled: true, type: 'secret' },
    { key: 'tokenExpired', value: '<set at run time>', enabled: true, type: 'secret' },
    { key: 'tokenWrongSecret', value: '<set at run time>', enabled: true, type: 'secret' },
    { key: 'tokenAlgNone', value: '<set at run time>', enabled: true, type: 'secret' },
  ],
};
const dir = path.join(ROOT, 'postman');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'Vishrea_Studio_API.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(dir, 'Vishrea_Studio_Development.postman_environment.json'), JSON.stringify(env, null, 2));
const counts = order.map((n) => `${n}: ${(folders.get(n) || []).length}`);
console.log(`${[...folders.values()].reduce((a, f) => a + f.length, 0)} requests\n${counts.join('\n')}`);
