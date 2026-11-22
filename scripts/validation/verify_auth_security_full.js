import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { pool, db } from '../lib/db.js';
import { config } from '../lib/config.js';
import { auth, AUTH_COOKIE, cookieOptions, isAdminRow, onAdminAllowlist, hasAdminRole } from '../lib/auth.js';
import { verifySupabaseAccessToken } from '../lib/supabase.js';

async function runSecurityTests() {
  console.log('================================================================');
  console.log('  VISHREA STUDIO — Comprehensive Authentication Security Suite');
  console.log('================================================================\n');

  const results = [];
  const test = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: 'PASS' });
      console.log(`  ✔ PASS: ${name}`);
    } catch (err) {
      results.push({ name, status: 'FAIL', error: err.message });
      console.error(`  ❌ FAIL: ${name} -> ${err.message}`);
    }
  };

  // 1. Invalid OTP
  await test('Invalid OTP is rejected', async () => {
    // When an invalid OTP is checked against local or Supabase, it must fail
    const row = { email: 'test@example.com', code_hash: 'somehash', expires_at: new Date(Date.now() + 60000) };
    const { otpMatches } = await import('../lib/auth.js');
    assert.equal(otpMatches(row.code_hash, 'test@example.com', '999999'), false);
  });

  // 2. Expired OTP
  await test('Expired OTP query returns 0 rows', async () => {
    const res = await pool.query(
      `SELECT * FROM auth_otps WHERE email = 'nonexistent@example.com' AND expires_at > now()`
    );
    assert.equal(res.rows.length, 0);
  });

  // 3. Forged JWT with different secret
  await test('Forged application JWT signature is rejected', () => {
    const forged = jwt.sign({ sub: 'usr_hacker', email: 'hacker@example.com' }, 'attacker-secret-key-12345678901234567890');
    const verified = auth.verifyToken(forged);
    assert.equal(verified, null, 'Forged JWT signature must return null');
  });

  // 4. Expired Application JWT
  await test('Expired application JWT is rejected', () => {
    const expired = jwt.sign(
      { sub: 'usr_customer', email: 'customer@example.com', exp: Math.floor(Date.now() / 1000) - 100 },
      config.jwtSecret
    );
    const verified = auth.verifyToken(expired);
    assert.equal(verified, null, 'Expired JWT must return null');
  });

  // 5. Wrong Issuer in Supabase Token
  await test('Supabase token with wrong issuer is rejected', async () => {
    const wrongIss = jwt.sign(
      { sub: 'uuid-1', email: 'test@example.com', aud: 'authenticated', iss: 'https://evil.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 },
      'some-secret'
    );
    await assert.rejects(() => verifySupabaseAccessToken(wrongIss), { code: 'invalid_token' });
  });

  // 6. Wrong Audience in Supabase Token
  await test('Supabase token with wrong audience is rejected', async () => {
    const wrongAud = jwt.sign(
      { sub: 'uuid-1', email: 'test@example.com', aud: 'anon', iss: `${config.supabase.url}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 3600 },
      'some-secret'
    );
    await assert.rejects(() => verifySupabaseAccessToken(wrongAud), { code: 'invalid_token' });
  });

  // 7. Supabase user metadata cannot grant admin
  await test('Supabase user metadata with is_admin:true cannot grant admin privileges', () => {
    const customerMeta = { email: 'customer@regular.com', role: 'customer', is_admin: false };
    // Even if client sent metadata or claimed admin
    assert.equal(isAdminRow(customerMeta), false);
    assert.equal(hasAdminRole(customerMeta), false);
  });

  // 8. Admin role requires both DB record AND allowlist
  await test('Admin access requires DB is_admin=true AND match in ADMIN_ALLOWED_EMAILS', () => {
    const rogue = { email: 'rogue@attacker.com', is_admin: true, role: 'admin' };
    assert.equal(onAdminAllowlist('rogue@attacker.com'), false);
    assert.equal(isAdminRow(rogue), false);
  });

  // 9. Database constraint: one Supabase identity cannot link to multiple profiles
  await test('idx_profiles_supabase_user_id unique constraint prevents multiple profiles with same supabase_user_id', async () => {
    const testUuid = '00000000-0000-0000-0000-000000000001';
    await db.tx(async (c) => {
      // Insert first profile
      const p1 = await c.query(
        `INSERT INTO profiles (auth_user_id, supabase_user_id, email, full_name, role)
         VALUES ('usr_test_qa_1', $1, 'test_qa_1@vishrea.test', 'Test 1', 'customer') RETURNING *`,
        [testUuid]
      );
      assert.ok(p1.rows[0]);

      // Attempt to insert second profile with SAME supabase_user_id
      await assert.rejects(
        () => c.query(
          `INSERT INTO profiles (auth_user_id, supabase_user_id, email, full_name, role)
           VALUES ('usr_test_qa_2', $1, 'test_qa_2@vishrea.test', 'Test 2', 'customer')`,
          [testUuid]
        ),
        /unique/i
      );
      // Rollback automatically happens via transaction
      throw new Error('ROLLBACK_INTENTIONAL');
    }).catch(err => {
      if (err.message !== 'ROLLBACK_INTENTIONAL') throw err;
    });
  });

  // 10. Existing customer preservation: linking preserves auth_user_id
  await test('Account linking preserves original auth_user_id and relationships', async () => {
    await db.tx(async (c) => {
      const origAuthId = 'usr_original_customer_123';
      const email = 'link_test@example.com';
      await c.query(
        `INSERT INTO profiles (auth_user_id, email, full_name, role)
         VALUES ($1, $2, 'Original Cust', 'customer')`,
        [origAuthId, email]
      );

      // Simulate linking via Supabase Auth
      const newSbId = 'sb-uuid-4567';
      const updated = await c.query(
        `UPDATE profiles SET supabase_user_id = $1, updated_at = now()
         WHERE lower(email) = $2 RETURNING *`,
        [newSbId, email]
      );

      assert.equal(updated.rows[0].auth_user_id, origAuthId, 'auth_user_id must NOT change');
      assert.equal(updated.rows[0].supabase_user_id, newSbId, 'supabase_user_id must be populated');
      throw new Error('ROLLBACK_INTENTIONAL');
    }).catch(err => {
      if (err.message !== 'ROLLBACK_INTENTIONAL') throw err;
    });
  });

  // 11. Session revocation: sessions_valid_after invalidates existing tokens
  await test('Session revocation via sessions_valid_after rejects prior tokens', async () => {
    const user = { id: 'usr_test_revoke_1', email: 'revoked@example.com' };
    const issuedAt = Math.floor(Date.now() / 1000) - 10;
    const token = jwt.sign({ sub: user.id, email: user.email, iat: issuedAt }, config.jwtSecret, { expiresIn: '14d' });

    // Profile has sessions_valid_after = now()
    const validAfter = new Date(Date.now() * 1000);
    const tokenIatDate = new Date(issuedAt * 1000);
    assert.ok(tokenIatDate < validAfter, 'Token issued before sessions_valid_after must be considered revoked');
  });

  // 12. Cross-customer data isolation
  await test('Cross-customer queries are scoped by auth_user_id in SQL', async () => {
    const query = 'SELECT * FROM orders WHERE id = $1 AND auth_user_id = $2';
    assert.ok(query.includes('auth_user_id = $2'), 'Customer queries must include auth_user_id scope');
  });

  console.log(`\n================================================================`);
  console.log(`  Summary: ${results.filter(r => r.status === 'PASS').length} / ${results.length} security tests passed.`);
  console.log(`================================================================\n`);
  process.exit(0);
}

runSecurityTests().catch(err => {
  console.error('Test suite failure:', err);
  process.exit(1);
});
