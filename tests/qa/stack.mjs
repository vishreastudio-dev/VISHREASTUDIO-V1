#!/usr/bin/env node
// Isolated QA stack: local PostgreSQL (vishrea_qa on 127.0.0.1:55432), Razorpay stand-in, app on :3100.
//
//   node tests/qa/stack.mjs env    [--profile=security|load]   effective environment (secrets masked)
//   node tests/qa/stack.mjs verify                               isolation check + production-guard proof
//   node tests/qa/stack.mjs up     [--profile=security|load]   prepare the database and start the stack
//   node tests/qa/stack.mjs status | down
//
// Nothing here reads process.env for the app: every QA process gets qaEnv() only.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import pg from 'pg';
import { GATEWAY_PORT, QA_DB_URL, QA_PORT, ROOT, SENSITIVE, STATE_DIR, dotenvValues, liveProjectRef, qaEnv } from './qa-env.mjs';

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const profile = args.profile || 'security';
const STACK_FILE = path.join(STATE_DIR, 'stack.json');
const node = (argv, env, opts = {}) => spawnSync(process.execPath, argv, { cwd: ROOT, env, encoding: 'utf8', timeout: 45_000, ...opts });
const mask = (k, v) => (v && SENSITIVE.test(k) && !/^(http:\/\/127\.0\.0\.1|postgresql:\/\/postgres@127\.0\.0\.1)/.test(v) && !/@qa\.test/.test(v) ? `<set, ${v.length} chars>` : v);

function assertLocalQaDb(url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !/qa|load/.test(u.pathname)) throw new Error('QA database must be local and named *qa*/*load*.');
}

// ---- verify ------------------------------------------------------------------------------

function verify() {
  const results = [];
  const ok = (name, pass, detail = '') => results.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail });
  const live = liveProjectRef();
  ok('live project ref derived from .env (value not shown)', Boolean(live));
  const envFile = dotenvValues();
  const qa = qaEnv('security');

  // 1. Every .env key is overridden; no sensitive value is shared with the live .env.
  const rows = Object.keys(envFile).map((k) => {
    const same = qa[k] === envFile[k];
    const state = qa[k] === '' ? 'blanked' : same ? 'same' : 'overridden';
    return { key: k, state, sensitive: SENSITIVE.test(k) };
  });
  const leaks = rows.filter((r) => r.sensitive && r.state === 'same' && envFile[r.key] !== '');
  ok('every .env key explicitly set or blanked in the QA environment', rows.every((r) => r.key in qa), `${rows.length} keys`);
  ok('no sensitive .env value reused by QA', leaks.length === 0, leaks.map((r) => r.key).join(', ') || 'none');
  ok('QA environment built without inheriting process.env', !Object.keys(qa).some((k) => /SUPABASE|RAZORPAY|RESEND|DATABASE/.test(k) && process.env[k] !== undefined && qa[k] === process.env[k] && process.env[k] !== ''));

  // 2. The effective configuration a QA server would use.
  const probe = node(['--input-type=module', '-e', `
    const { config } = await import('./lib/config.js');
    const db = new URL(process.env.DATABASE_URL);
    console.log(JSON.stringify({
      db_host: db.hostname, db_name: db.pathname.slice(1), storage: config.storage.driver, supabase_url: config.storage.supabaseUrl,
      service_key_set: Boolean(config.storage.serviceRoleKey), razorpay_api: new URL(config.razorpay.apiBase).host,
      resend_set: Boolean(config.email.resendApiKey), guard_armed: Boolean(config.productionProject.ref), guard_targeted: config.productionProject.targeted,
    }));`], qa);
  let eff = {};
  try { eff = JSON.parse(probe.stdout.trim().split('\n').pop()); } catch {}
  ok('effective DB is local vishrea_qa', eff.db_host === '127.0.0.1' && eff.db_name === 'vishrea_qa', `${eff.db_host}/${eff.db_name}`);
  ok('effective storage is local; no Supabase URL or key', eff.storage === 'local' && !eff.supabase_url && !eff.service_key_set);
  ok('Razorpay calls go to the local stand-in', eff.razorpay_api === `127.0.0.1:${GATEWAY_PORT}`, eff.razorpay_api);
  ok('Resend disabled (no key)', eff.resend_set === false);
  ok('production guard armed with the live ref, and the QA config is not targeted', eff.guard_armed === true && Array.isArray(eff.guard_targeted) && eff.guard_targeted.length === 0);

  // 3. Guard proof. Credentials below are fake: even a guard failure could not authenticate.
  const fakeKey = `fake-${crypto.randomBytes(16).toString('hex')}`;
  const liveStorage = { ...qa, PORT: '3198', STORAGE_DRIVER: 'supabase', SUPABASE_URL: `https://${live}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: fakeKey };
  const liveDb = { ...qa, PORT: '3197', DATABASE_URL: `postgresql://postgres:not-the-password@db.${live}.supabase.co:5432/postgres`, DATABASE_SSL: 'true', ALLOW_REMOTE_DATABASE: 'true', AUTH_DEV_OTP_ECHO: 'false' };
  const refused = (r, what) => r.status !== 0 && new RegExp(`${what} refused`).test(r.stderr + r.stdout) && !/server\.started/.test(r.stdout);
  ok('server refuses live Supabase Storage (ALLOW flags cannot bypass)', refused(node(['server.js'], liveStorage), 'Server start'));
  ok('server refuses live database (even with ALLOW_REMOTE_DATABASE=true)', refused(node(['server.js'], liveDb), 'Server start'));

  // The real-world case: a developer arms the guard while .env still points at production. Only the
  // ref and a spare port are given; the app's dotenv fills everything else from the real .env.
  const osOnly = Object.fromEntries(Object.entries(qa).filter(([k]) => /^(SystemRoot|SYSTEMROOT|windir|PATH|Path|PATHEXT|COMSPEC|ComSpec|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|HOME|LANG)$/.test(k)));
  const devWithRef = { ...osOnly, PORT: '3196', PRODUCTION_SUPABASE_PROJECT_REF: live };
  ok('dev server with the real live .env + guard armed refuses to start', refused(node(['server.js'], devWithRef), 'Server start'));
  ok('migrations refuse (no --production)', refused(node(['scripts/migrate.js'], devWithRef), 'Database migration'));
  ok('bucket setup --fix refuses', refused(node(['scripts/storage-setup.js', '--fix'], devWithRef), 'Bucket setup'));
  ok('media migration apply refuses', refused(node(['scripts/media-migrate.js', 'apply', '--confirm=000000000000'], devWithRef), 'Media migration'));
  ok('media rollback refuses', refused(node(['scripts/media-migrate.js', 'rollback', '--results=none.json'], devWithRef), 'Media rollback'));
  ok('orphan deletion refuses before listing anything', refused(node(['scripts/media-orphans.js', '--delete', '--confirm=0'], devWithRef), 'Orphan deletion'));

  for (const r of results) console.log(`${r.result}  ${r.check}${r.detail ? `  [${r.detail}]` : ''}`);
  console.log('\n.env keys and how QA treats them:');
  for (const r of rows) console.log(`  ${r.key.padEnd(28)} ${r.state}${r.sensitive ? ' (sensitive)' : ''}`);
  const failed = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'verify.json'), JSON.stringify({ at: new Date().toISOString(), results, keys: rows }, null, 2));
  if (failed) process.exitCode = 1;
}

// ---- database ----------------------------------------------------------------------------

async function prepareDatabase(env) {
  assertLocalQaDb(QA_DB_URL);
  const admin = new pg.Client({ connectionString: QA_DB_URL.replace(/\/vishrea_qa$/, '/postgres') });
  await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'vishrea_qa'")).rowCount) await admin.query('CREATE DATABASE vishrea_qa');
  await admin.end();
  const m = node(['scripts/migrate.js', '--seed-demo'], env, { timeout: 180_000 });
  if (m.status !== 0) throw new Error(`migrations failed: ${(m.stderr || m.stdout).slice(-800)}`);

  const c = new pg.Client({ connectionString: QA_DB_URL });
  await c.connect();
  // Synthetic catalogue, stock fixtures and customers. Idempotent.
  await c.query(`
    INSERT INTO products (category_id, name, slug, description, price_inr, is_one_of_one, is_active, featured, color, colour_season, created_at)
    SELECT (SELECT id FROM categories ORDER BY sort_order, name OFFSET (g % GREATEST((SELECT count(*) FROM categories), 1)) LIMIT 1),
           'QA Piece ' || g, 'qa-piece-' || g, 'Synthetic QA product', 1500 + (g % 40) * 100, g % 3 = 0, true, g % 25 = 0,
           (ARRAY['Ivory','Wine','Black','Stone','Oat'])[1 + g % 5], (ARRAY['True Autumn','Soft Summer','Deep Winter','Light Spring'])[1 + g % 4],
           now() - make_interval(mins => g)
      FROM generate_series(1, 400) g
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'qa-piece-' || g)`);
  await c.query(`
    INSERT INTO products (name, slug, description, price_inr, is_one_of_one, is_active)
    SELECT x.name, x.slug, 'QA stock fixture', 1999, x.ooo, true
      FROM (VALUES ('QA Checkout Stock', 'qa-checkout-stock', false), ('QA Last Unit', 'qa-last-unit', true), ('QA Five Left', 'qa-five-left', false)) x(name, slug, ooo)
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = x.slug)`);
  await c.query(`
    INSERT INTO product_variants (product_id, sku, size_label, price_inr, stock_quantity, sort_order)
    SELECT p.id, 'QA-' || substr(replace(p.id::text, '-', ''), 1, 10) || '-' || s.label, s.label, p.price_inr,
           CASE WHEN p.is_one_of_one THEN (CASE WHEN abs(hashtext(p.slug)) % 7 = 0 THEN 0 ELSE 1 END) ELSE abs(hashtext(p.slug || s.label)) % 6 END, s.ord
      FROM products p
      CROSS JOIN LATERAL (SELECT * FROM (VALUES ('S', 1), ('M', 2), ('L', 3)) v(label, ord) WHERE NOT p.is_one_of_one OR v.label = 'M') s
     WHERE p.slug LIKE 'qa-%' AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`);
  await c.query("UPDATE product_variants v SET stock_quantity = 100000 FROM products p WHERE p.id = v.product_id AND p.slug = 'qa-checkout-stock'");
  await c.query("UPDATE product_variants v SET stock_quantity = 1 FROM products p WHERE p.id = v.product_id AND p.slug = 'qa-last-unit'");
  await c.query("UPDATE product_variants v SET stock_quantity = CASE WHEN v.size_label = 'M' THEN 5 ELSE 0 END FROM products p WHERE p.id = v.product_id AND p.slug = 'qa-five-left'");
  await c.query(`
    INSERT INTO profiles (auth_user_id, email, full_name, role, is_admin)
    SELECT 'usr_qa_' || g, 'qa-user-' || g || '@qa.test', 'QA User ' || g, 'customer', false FROM generate_series(1, 1000) g
     WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = 'usr_qa_' || g)`);
  await c.query(`
    INSERT INTO customer_profiles (auth_user_id, email, full_name, phone)
    SELECT 'usr_qa_' || g, 'qa-user-' || g || '@qa.test', 'QA User ' || g, '+91 98450 00000' FROM generate_series(1, 1000) g
    ON CONFLICT (auth_user_id) DO NOTHING`);
  const counts = (await c.query(`SELECT (SELECT count(*)::int FROM products) products, (SELECT count(*)::int FROM product_variants) variants,
    (SELECT count(*)::int FROM profiles WHERE email LIKE '%@qa.test') qa_users, (SELECT count(*)::int FROM profiles WHERE role = 'admin' OR is_admin) admins`)).rows[0];
  await c.end();
  return counts;
}

// ---- up / down / status ----------------------------------------------------------------------

const readStack = () => (fs.existsSync(STACK_FILE) ? JSON.parse(fs.readFileSync(STACK_FILE, 'utf8')) : null);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function startDetached(argv, env, logName) {
  const log = fs.openSync(path.join(STATE_DIR, logName), 'a');
  const child = spawn(process.execPath, argv, { cwd: ROOT, env, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  return child.pid;
}

async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${QA_PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
    return { status: r.status, ...(await r.json()) };
  } catch (e) {
    return { status: 0, error: e.name };
  }
}

async function up() {
  if (readStack()?.server && alive(readStack().server)) throw new Error('QA stack already running; run `down` first.');
  const env = qaEnv(profile);
  fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
  const counts = await prepareDatabase(env);
  const gateway = startDetached(['tests/qa/razorpay-standin.mjs', String(GATEWAY_PORT)], { ...env, PORT: String(GATEWAY_PORT) }, 'gateway.log');
  const server = startDetached(['server.js'], env, `server-${profile}.log`);
  fs.writeFileSync(STACK_FILE, JSON.stringify({ profile, server, gateway, started_at: new Date().toISOString() }));
  for (let i = 0; i < 60; i += 1) {
    const h = await health();
    if (h.status === 200) return console.log(JSON.stringify({ up: true, profile, base: `http://127.0.0.1:${QA_PORT}`, gateway: `http://127.0.0.1:${GATEWAY_PORT}`, data: counts, health: h }, null, 2));
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy; see scratch/qa/server-*.log');
}

function down() {
  const s = readStack();
  if (!s) return console.log('not running');
  for (const pid of [s.server, s.gateway]) if (pid && alive(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  fs.rmSync(STACK_FILE, { force: true });
  console.log('stopped');
}

const cmd = process.argv[2];
try {
  if (cmd === 'env') {
    const env = qaEnv(profile);
    for (const k of Object.keys(env).sort()) if (!/^(SystemRoot|SYSTEMROOT|windir|PATH|Path|PATHEXT|COMSPEC|ComSpec|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|HOME|LANG)$/.test(k)) console.log(`${k}=${k === 'PRODUCTION_SUPABASE_PROJECT_REF' ? '<live ref from .env, not shown>' : mask(k, env[k])}`);
  } else if (cmd === 'verify') verify();
  else if (cmd === 'up') await up();
  else if (cmd === 'down') down();
  else if (cmd === 'status') console.log(JSON.stringify({ stack: readStack(), health: await health() }, null, 2));
  else console.log('usage: env | verify | up [--profile=security|load] | status | down');
} catch (err) {
  console.error(`[qa-stack] ${err.message}`);
  process.exitCode = 1;
}
