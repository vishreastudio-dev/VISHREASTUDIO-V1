// Rehearses the production migration on a database shaped like the live one (2026-11-05 audit):
// 001–014 recorded, 016 DDL applied by hand but not recorded, max_video_seconds = 30, plus data
// written by the pre-remediation code. The real runner must bring it to 017 without data loss,
// and a second run must change nothing.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveTestDatabase } from './helpers.js';

const target = await resolveTestDatabase();
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const DB = `vishrea_rehearsal_${process.pid}`;
let url;

describe('production migration rehearsal', { skip: target && target.mode === 'database' ? false : 'needs a PostgreSQL server where databases can be created', timeout: 120_000 }, () => {
  before(async () => {
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    const u = new URL(target.adminUrl);
    u.pathname = `/${DB}`;
    url = u.toString();

    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query('CREATE TABLE _schema_migrations (id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ DEFAULT now())');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (f > '014_order_tracking.sql') break;
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO _schema_migrations (filename) VALUES ($1)', [f]);
    }
    await c.query(fs.readFileSync(path.join(dir, '016_payment_reconciliation.sql'), 'utf8'));
    await c.query("INSERT INTO app_settings (key, value) VALUES ('max_video_seconds', '30') ON CONFLICT (key) DO UPDATE SET value = '30'");
    await c.query("INSERT INTO products (name, slug, price_inr, badge, is_active) VALUES ('Legacy Premium', 'legacy-premium', 5000, 'PREMIUM', true)");
    const m = (await c.query("INSERT INTO memberships (auth_user_id, status, credits_balance, renewal_at, consecutive_paid_months) VALUES ('usr_legacy','active',4, now() + interval '20 days', 2) RETURNING id")).rows[0];
    const mp = (await c.query("INSERT INTO membership_payments (membership_id, auth_user_id, amount, status, paid_at) VALUES ($1,'usr_legacy',3598,'paid', now() - interval '40 days') RETURNING id", [m.id])).rows[0];
    await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, expires_at, membership_payment_id) VALUES ('usr_legacy',$1,4,'membership_payment', now() + interval '20 days', $2)", [m.id, mp.id]);
    await c.query("INSERT INTO orders (auth_user_id, status, payment_status, total, courier_partner, tracking_number) VALUES ('usr_legacy', 'dispatched', 'paid', 2000, 'Delhivery', 'VS-DEL-1001')");
    await c.end();
  });

  after(async () => {
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.end();
  });

  test('015, 016 and 017 apply to the live-shaped schema, preserve data, and re-running is a no-op', async () => {
    const run = (extra = '') => {
      const child = require_('node:child_process').spawnSync(process.execPath, ['--input-type=module', '-e', `const { runMigrations } = await import('./scripts/migrate.js'); await runMigrations({ quiet: true }); const { pool } = await import('./lib/db.js'); await pool.end();${extra}`], {
        cwd: path.join(dir, '..'),
        env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, DATABASE_SSL: 'false', DEFAULT_ADMIN_EMAIL: '' },
        encoding: 'utf8',
      });
      assert.equal(child.status, 0, child.stderr);
    };
    run();
    run();

    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const q = async (sql) => (await c.query(sql)).rows;
    try {
      const recorded = (await q('SELECT filename FROM _schema_migrations ORDER BY 1')).map((r) => r.filename);
      for (const f of ['015_credit_and_video_caps.sql', '016_payment_reconciliation.sql', '017_membership_lifecycle_rewards.sql']) assert.ok(recorded.includes(f), f);
      assert.equal(recorded.length, new Set(recorded).size);
      assert.equal((await q("SELECT value::text AS v FROM app_settings WHERE key = 'max_video_seconds'"))[0].v, '10');
      const member = (await q("SELECT status, credits_balance, paid_through IS NOT NULL AS has_paid_through FROM memberships WHERE auth_user_id = 'usr_legacy'"))[0];
      assert.deepEqual(member, { status: 'active', credits_balance: 4, has_paid_through: true });
      assert.equal((await q("SELECT count(*)::int AS n FROM credit_ledger WHERE auth_user_id = 'usr_legacy'"))[0].n, 1);
      assert.equal((await q("SELECT credit_eligible FROM products WHERE slug = 'legacy-premium'"))[0].credit_eligible, false);
      const settings = Object.fromEntries((await q("SELECT key, jsonb_typeof(value) AS t FROM app_settings WHERE key IN ('referral_discount_inr','renewal_window_days','membership_plan_months','reward_eligible_product_ids','six_month_reward_qualification','legal_details_verified','max_credit_balance','pause_credit_policy')")).map((r) => [r.key, r.t]));
      assert.deepEqual(settings, {
        legal_details_verified: 'boolean', membership_plan_months: 'array', referral_discount_inr: 'number', renewal_window_days: 'number',
        reward_eligible_product_ids: 'array', six_month_reward_qualification: 'string',
      }, 'typed defaults inserted; no credit cap or pause-credit settings');
      assert.deepEqual((await q("SELECT value FROM app_settings WHERE key = 'reward_eligible_product_ids'"))[0].value, [], 'nothing is reward-eligible by default');
      const tables = (await q("SELECT table_name FROM information_schema.tables WHERE table_name IN ('membership_periods','reward_entitlements','admin_gift_enquiries','gift_memberships')")).length;
      assert.equal(tables, 4);
      const shipped = (await q("SELECT o.courier_partner, o.tracking_number, o.tracking_url, c.name AS courier FROM orders o LEFT JOIN couriers c ON c.id = o.courier_id WHERE o.auth_user_id = 'usr_legacy'"))[0];
      assert.deepEqual(shipped, { courier_partner: 'Delhivery', tracking_number: 'VS-DEL-1001', tracking_url: 'https://www.delhivery.com/track/package/VS-DEL-1001', courier: 'Delhivery' }, '021 links existing shipments to the courier rows');
      assert.equal((await q('SELECT count(*)::int AS n FROM couriers'))[0].n, 7, 'courier seed is not duplicated by a re-run');
      assert.equal((await q("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'piece_requests'"))[0].n, 1, 'retired feature data is retained');
    } finally {
      await c.end();
    }
  });
});

import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
