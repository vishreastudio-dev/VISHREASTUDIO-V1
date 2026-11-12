// Runs the real app with NODE_ENV=production (separate process from the other suites).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ctx, dbSkipReason, setup, teardown } from './helpers.js';

const skip = await dbSkipReason();

const ORIGIN = 'https://shop.example.test';
const get = (path, headers = {}) => fetch(ctx.base + path, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https', ...headers } });

describe('production mode', { skip, timeout: 120_000 }, () => {
  before(() => setup({ env: { NODE_ENV: 'production', APP_ORIGIN: ORIGIN, TRUST_PROXY: 'true', JWT_SECRET: 'prod-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz', RESEND_API_KEY: '', STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://project-ref.supabase.co' } }), { timeout: 120_000 });
  after(teardown);

  test('plain HTTP is redirected (GET) or refused (mutations); health stays reachable', async () => {
    const r = await get('/catalogue', { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'evil.example' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), 'https://shop.example.test/catalogue');
    const p = await fetch(ctx.base + '/api/auth/start-login', { method: 'POST', headers: { 'X-Forwarded-Proto': 'http', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(p.status, 403);
    assert.equal((await get('/api/health', { 'X-Forwarded-Proto': 'http' })).status, 200);
  });

  test('HSTS and an enforcing CSP with upgrade-insecure-requests', async () => {
    const r = await get('/api/catalogue');
    assert.match(r.headers.get('strict-transport-security'), /max-age=31536000/);
    const html = await get('/');
    const csp = html.headers.get('content-security-policy') || '';
    assert.match(csp, /upgrade-insecure-requests/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src[^;]*https:\/\/checkout\.razorpay\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/api\.razorpay\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/checkout\.razorpay\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/lumberjack\.razorpay\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/api\.razorpay\.com/);
    assert.match(html.headers.get('x-content-type-options'), /nosniff/);
  });

  test('legacy coming-soon URLs redirect home', async () => {
    const r = await get('/coming-soon/lookbook');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/');
  });

  test('OTP is never echoed and sign-in fails closed without an email provider', async () => {
    const r = await fetch(ctx.base + '/api/auth/start-login', {
      method: 'POST',
      headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: 'prod@example.test' }),
    });
    const body = await r.json();
    assert.equal(r.status, 503);
    assert.equal(body.debug_code, undefined);
  });

  test('errors do not leak internals', async () => {
    const r = await get('/api/product?slug=' + 'x'.repeat(5));
    assert.equal(r.status, 404);
    const bad = await fetch(ctx.base + '/api/auth/start-login', { method: 'POST', headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{"email":' });
    const j = await bad.json();
    assert.equal(bad.status, 400);
    assert.equal(j.stack, undefined);
  });

  test('robots.txt allows indexing and points at the configured sitemap', async () => {
    const t = await (await get('/robots.txt')).text();
    assert.match(t, /Sitemap: https:\/\/shop\.example\.test\/sitemap\.xml/);
    for (const p of ['/api/', '/admin', '/account', '/cart', '/checkout', '/orders', '/login']) assert.ok(t.includes(`Disallow: ${p}\n`), p);
    assert.ok(!/^Disallow: \/$/m.test(t), 'production must not block the whole site');
  });

  test('server refuses to start with a weak JWT secret or a non-https origin', () => {
    const run = (env) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./lib/config.js')"], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, NODE_ENV: 'production', ...env },
        encoding: 'utf8',
      });
    const prodOk = {
      JWT_SECRET: 'b7f3c9a1e5d24f8b9c0e6a7d3f1b2c4e8a9d0f7c6b5e4a3d',
      AUTH_DEV_OTP_ECHO: 'false',
      APP_ORIGIN: ORIGIN,
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vishrea',
      RAZORPAY_KEY_ID: 'rzp_test_localmock',
      RAZORPAY_KEY_SECRET: 'test_key_secret_for_hmac',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-config-test-only',
    };
    assert.match(run({ ...prodOk, JWT_SECRET: 'short' }).stderr, /JWT_SECRET must be set/);
    assert.match(run({ ...prodOk, JWT_SECRET: 'vishrea_local_dev_jwt_key_987654321' }).stderr, /JWT_SECRET must be set/);
    assert.match(run({ ...prodOk, JWT_SECRET: 'x'.repeat(48) }).stderr, /JWT_SECRET must be set/);
    assert.match(run({ ...prodOk, AUTH_DEV_OTP_ECHO: 'true' }).stderr, /AUTH_DEV_OTP_ECHO must not be enabled/);
    assert.match(run({ ...prodOk, APP_ORIGIN: 'http://shop.example.test' }).stderr, /APP_ORIGIN must be/);
    assert.match(run({ ...prodOk, DATABASE_URL: '' }).stderr, /DATABASE_URL must be set/);
    assert.match(run({ ...prodOk, RAZORPAY_WEBHOOK_SECRET: '' }).stderr, /RAZORPAY_WEBHOOK_SECRET must be set/);
    // Production uploads must go to Supabase Storage, never the server disk, and need the server key.
    assert.match(run({ ...prodOk, STORAGE_DRIVER: 'local' }).stderr, /STORAGE_DRIVER must be "supabase" in production/);
    assert.match(run({ ...prodOk, SUPABASE_SERVICE_ROLE_KEY: '' }).stderr, /SUPABASE_SERVICE_ROLE_KEY must be set/);
    assert.match(run({ ...prodOk, SUPABASE_URL: 'http://project-ref.supabase.co' }).stderr, /SUPABASE_URL must be the https/);
    assert.ok(!/service-role-key-for-config-test-only/.test(run({ ...prodOk, SUPABASE_URL: 'nope' }).stderr), 'the key is never printed');
    assert.equal(run(prodOk).status, 0);
  });

  test('development refuses a remote database unless explicitly allowed, and never echoes OTPs against one', () => {
    const run = (env) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./lib/config.js')"], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db.example.supabase.co:5432/postgres', ALLOW_REMOTE_DATABASE: '', AUTH_DEV_OTP_ECHO: 'false', ...env },
        encoding: 'utf8',
      });
    assert.match(run({}).stderr, /remote DATABASE_URL/);
    assert.match(run({ ALLOW_REMOTE_DATABASE: 'true', AUTH_DEV_OTP_ECHO: 'true' }).stderr, /AUTH_DEV_OTP_ECHO=true is refused/);
    assert.equal(run({ ALLOW_REMOTE_DATABASE: 'true' }).status, 0);
    assert.equal(run({ DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/vishrea' }).status, 0);
  });

  test('development can never start against the production project; scripts need --production', () => {
    const PROD = 'prodprojectref000001';
    const devEnv = {
      ...process.env,
      NODE_ENV: 'development',
      PRODUCTION_SUPABASE_PROJECT_REF: PROD,
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/vishrea',
      ALLOW_REMOTE_DATABASE: 'true',
      AUTH_DEV_OTP_ECHO: 'false',
      STORAGE_DRIVER: 'local',
      SUPABASE_URL: 'https://devprojectref000002.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-config-test-only',
    };
    const cwd = new URL('..', import.meta.url);
    const check = (env, call) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import('./lib/config.js'); ${call}`], { cwd, env: { ...devEnv, ...env }, encoding: 'utf8' });
    const server = "m.assertNotProductionTarget('Server start', { script: false })";
    const script = (allow) => `m.assertNotProductionTarget('Bucket setup', { allow: ${allow} })`;

    assert.equal(check({}, server).status, 0, 'a separate development project is fine');
    const viaStorage = check({ SUPABASE_URL: `https://${PROD}.supabase.co` }, server);
    assert.match(viaStorage.stderr, /Server start refused: SUPABASE_URL point at the production Supabase project/);
    assert.ok(!/--production/.test(viaStorage.stderr), 'the web server has no override');
    assert.match(check({ DATABASE_URL: `postgresql://postgres.${PROD}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres` }, server).stderr, /DATABASE_URL point at the production/);
    assert.match(check({ SUPABASE_URL: `https://${PROD}.supabase.co` }, script(false)).stderr, /pass --production/);
    const allowed = check({ SUPABASE_URL: `https://${PROD}.supabase.co` }, script(true));
    assert.equal(allowed.status, 0);
    assert.match(allowed.stderr, /acting on the PRODUCTION project/);
    assert.ok(!/pw@|service-role-key/.test(viaStorage.stderr + allowed.stderr), 'no credentials in messages');
    assert.match(check({ PRODUCTION_SUPABASE_PROJECT_REF: 'not-a-ref' }, '').stderr, /must be the 20-character project reference/);

    // The real entry points refuse before connecting to anything.
    const node = (args, env) => spawnSync(process.execPath, args, { cwd, env: { ...devEnv, ...env }, encoding: 'utf8', timeout: 20_000 });
    const prodTarget = { SUPABASE_URL: `https://${PROD}.supabase.co` };
    const srv = node(['server.js'], { ...prodTarget, PORT: '0' });
    assert.notEqual(srv.status, 0);
    assert.match(srv.stderr, /Server start refused/);
    assert.match(node(['scripts/migrate.js'], prodTarget).stderr, /Database migration refused/);

    // Production must point at the project it names.
    const prod = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./lib/config.js')"], {
      cwd,
      env: {
        ...process.env, NODE_ENV: 'production', PRODUCTION_SUPABASE_PROJECT_REF: PROD, JWT_SECRET: 'b7f3c9a1e5d24f8b9c0e6a7d3f1b2c4e8a9d0f7c6b5e4a3d', APP_ORIGIN: ORIGIN,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vishrea', RAZORPAY_KEY_ID: 'rzp_test_localmock', RAZORPAY_KEY_SECRET: 'test_key_secret_for_hmac', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
        STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://devprojectref000002.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-config-test-only', AUTH_DEV_OTP_ECHO: 'false',
      },
      encoding: 'utf8',
    });
    assert.match(prod.stderr, /SUPABASE_URL is not the project named by PRODUCTION_SUPABASE_PROJECT_REF/);
  });
});
