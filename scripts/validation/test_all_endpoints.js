import { createApp } from '../server.js';
import http from 'http';
import assert from 'node:assert/strict';
import { auth, AUTH_COOKIE } from '../lib/auth.js';

async function testAll() {
  const app = await createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Server listening on ${baseUrl} for endpoint audit...\n`);

  const results = [];
  async function check(name, url, options = {}, expectStatus = 200, validateFn = null) {
    try {
      const res = await fetch(`${baseUrl}${url}`, options);
      const isExpected = Array.isArray(expectStatus) ? expectStatus.includes(res.status) : res.status === expectStatus;
      let body = null;
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = text; }

      if (!isExpected) {
        throw new Error(`Expected status ${expectStatus}, got ${res.status}: ${text.slice(0, 100)}`);
      }
      if (validateFn) {
        await validateFn(body, res);
      }
      results.push({ name, url, status: 'PASS', code: res.status });
      console.log(`  ✔ PASS [${res.status}]: ${name} (${url})`);
    } catch (err) {
      results.push({ name, url, status: 'FAIL', error: err.message });
      console.error(`  ❌ FAIL: ${name} (${url}) -> ${err.message}`);
    }
  }

  // 1. Health & Config
  await check('Health Check', '/api/health', {}, 200, (b) => assert.equal(b.ok, true));
  await check('Auth Public Config', '/api/auth/config', {}, 200, (b) => {
    assert.ok(b.supabase_url);
    assert.ok(b.supabase_anon_key);
    assert.equal(b.is_configured, true);
  });
  await check('Robots.txt', '/robots.txt', {}, 200, (b) => assert.ok(b.includes('User-agent')));
  await check('Sitemap.xml', '/sitemap.xml', {}, 200, (b) => assert.ok(b.includes('urlset')));

  // 2. Public Storefront APIs
  await check('Catalogue Listing', '/api/catalogue', {}, 200, (b) => assert.ok(Array.isArray(b.products)));
  await check('Homepage Carousel', '/api/homepage-carousel', {}, 200);
  await check('Search Catalogue', '/api/search?q=dress', {}, 200, (b) => assert.ok(Array.isArray(b.products)));
  await check('Legal Pages', '/api/legal', {}, 200);
  await check('Payment Config', '/api/payment-config', {}, 200, (b) => assert.ok(b.configured !== undefined));
  await check('Public Offers Validate (Empty Code)', '/api/offers/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '' }) }, 400);

  // 3. Protected Customer Endpoints (Unauthenticated -> 401)
  await check('Account Protected (401)', '/api/account', {}, 401);
  await check('Cart Protected (401)', '/api/cart', {}, 401);
  await check('Checkout Protected (401)', '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }, 401);
  await check('Orders Protected (401)', '/api/orders', {}, 401);
  await check('Wardrobe Protected (401)', '/api/wardrobe', {}, 401);
  await check('Size Profiles Protected (401)', '/api/size-profiles', {}, 401);

  // 4. Admin Endpoints Without Auth -> 401
  await check('Admin Ops Unauthenticated (401)', '/api/admin/ops', {}, 401);
  await check('Admin Homepage Carousel Unauthenticated (401)', '/api/admin/homepage-carousel', {}, 401);
  await check('Admin AI Studio Unauthenticated (401)', '/api/admin/ai-studio', {}, 401);

  // 5. Customer Authentication Context (Real customer from DB)
  const custAuthId = 'usr_5084b742a8d04371b1f3352261c71515'; // luckyboyvaishal@gmail.com
  const customerToken = auth.signToken({ id: custAuthId, email: 'luckyboyvaishal@gmail.com' });
  const custCookieHeader = { Cookie: `${AUTH_COOKIE}=${customerToken}` };

  await check('Account with Customer Token', '/api/account', { headers: custCookieHeader }, 200, (b) => assert.ok(b.profile));
  await check('Orders with Customer Token', '/api/orders', { headers: custCookieHeader }, 200, (b) => assert.ok(Array.isArray(b.orders)));
  await check('Size Profiles with Customer Token', '/api/size-profiles', { headers: custCookieHeader }, 200, (b) => assert.ok(Array.isArray(b.profiles)));
  await check('Cart with Customer Token', '/api/cart', { headers: custCookieHeader }, 200, (b) => assert.ok(Array.isArray(b.items)));

  // Customer attempting Admin API -> 403 Forbidden!
  await check('Customer Denied Admin Ops (403)', '/api/admin/ops', { headers: custCookieHeader }, 403);
  await check('Customer Denied Admin Carousel (403)', '/api/admin/homepage-carousel', { headers: custCookieHeader }, 403);
  await check('Customer Denied Admin AI Studio (403)', '/api/admin/ai-studio', { headers: custCookieHeader }, 403);

  // 6. Admin Authentication Context (Real admin from DB)
  const adminAuthId = 'usr_06dd03e3e48d4a8f930445dcaf8587ab'; // vishreastudio.admin@gmail.com
  const adminToken = auth.signToken({ id: adminAuthId, email: 'vishreastudio.admin@gmail.com' });
  const adminCookieHeader = { Cookie: `${AUTH_COOKIE}=${adminToken}` };

  await check('Admin Ops Authorized (200)', '/api/admin/ops', { headers: adminCookieHeader }, 200);
  await check('Admin Carousel Authorized (200)', '/api/admin/homepage-carousel', { headers: adminCookieHeader }, 200);
  await check('Admin AI Studio Authorized (200)', '/api/admin/ai-studio', { headers: adminCookieHeader }, 200);

  server.close();

  console.log(`\n================================================================`);
  console.log(`  Endpoint Audit Summary: ${results.filter(r => r.status === 'PASS').length} / ${results.length} endpoints passed.`);
  console.log(`================================================================\n`);
  process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
}

testAll().catch(err => {
  console.error('Audit run failed:', err);
  process.exit(1);
});
