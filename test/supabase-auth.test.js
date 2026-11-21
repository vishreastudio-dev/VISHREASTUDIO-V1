import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.LOG_SILENT = 'true';

const { config } = await import('../lib/config.js');
const { auth, AUTH_COOKIE, cookieOptions, isAdminRow, onAdminAllowlist, hasAdminRole } = await import('../lib/auth.js');
const { verifySupabaseAccessToken } = await import('../lib/supabase.js');

describe('Supabase Authentication Security & Token Verification', () => {
  const TEST_JWT_SECRET = config.jwtSecret;
  const SUPABASE_PROJECT_URL = config.supabase.url || 'https://djledhngxizbrtgfoclud.supabase.co';

  test('rejects missing or empty Supabase access token', async () => {
    await assert.rejects(
      () => verifySupabaseAccessToken(''),
      { code: 'invalid_token' }
    );
    await assert.rejects(
      () => verifySupabaseAccessToken(null),
      { code: 'invalid_token' }
    );
  });

  test('rejects malformed token strings that are not valid JWTs', async () => {
    await assert.rejects(
      () => verifySupabaseAccessToken('not.a.valid.jwt.token'),
      { code: 'invalid_token' }
    );
    await assert.rejects(
      () => verifySupabaseAccessToken('random-garbage-string'),
      { code: 'invalid_token' }
    );
  });

  test('rejects expired Supabase tokens', async () => {
    const expiredToken = jwt.sign(
      {
        sub: 'user-uuid-1234',
        email: 'test@vishrea.test',
        aud: 'authenticated',
        iss: `${SUPABASE_PROJECT_URL}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
      },
      'some-secret',
      { algorithm: 'HS256' }
    );

    await assert.rejects(
      () => verifySupabaseAccessToken(expiredToken),
      { code: 'token_expired' }
    );
  });

  test('rejects tokens from a mismatched issuer or foreign Supabase project', async () => {
    const foreignToken = jwt.sign(
      {
        sub: 'user-uuid-1234',
        email: 'test@vishrea.test',
        aud: 'authenticated',
        iss: 'https://attacker-fake-project.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'some-secret',
      { algorithm: 'HS256' }
    );

    await assert.rejects(
      () => verifySupabaseAccessToken(foreignToken),
      { code: 'invalid_token' }
    );
  });

  test('rejects tokens with non-authenticated audience (e.g. anon, service_role)', async () => {
    const anonToken = jwt.sign(
      {
        sub: 'user-uuid-1234',
        email: 'test@vishrea.test',
        aud: 'anon',
        iss: `${SUPABASE_PROJECT_URL}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'some-secret',
      { algorithm: 'HS256' }
    );

    await assert.rejects(
      () => verifySupabaseAccessToken(anonToken),
      { code: 'invalid_token' }
    );
  });

  test('rejects forged application JWT with modified secret', async () => {
    const forgedToken = jwt.sign(
      { sub: 'usr_c1fa52ef56954909a7150db447dde20d', email: 'attacker@evil.com' },
      'wrong-attacker-secret-key-that-does-not-match-real-key',
      { expiresIn: '14d', algorithm: 'HS256' }
    );

    const verified = auth.verifyToken(forgedToken);
    assert.equal(verified, null, 'Forged JWT signature must return null');
  });

  test('application session tokens round-trip cleanly with signature and expiration', () => {
    const user = { id: 'usr_valid_customer_123', email: 'customer@example.com' };
    const token = auth.signToken(user);
    assert.ok(typeof token === 'string' && token.length > 20);

    const decoded = auth.verifyToken(token);
    assert.equal(decoded.sub, user.id);
    assert.equal(decoded.email, user.email);
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
  });

  test('session cookie options enforce HttpOnly, Lax SameSite and proper path', () => {
    const opts = cookieOptions({ secure: false });
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.path, '/');
    assert.ok(opts.maxAge > 0);
  });

  test('admin role checks strictly require database admin role AND admin allowlist', () => {
    // 1. Regular customer cannot become admin
    const customerRow = { email: 'customer@example.com', is_admin: false, role: 'customer' };
    assert.equal(hasAdminRole(customerRow), false);
    assert.equal(isAdminRow(customerRow), false);

    // 2. Row claiming is_admin: true but email not on allowlist
    const rogueAdmin = { email: 'hacker@example.com', is_admin: true, role: 'admin' };
    assert.equal(hasAdminRole(rogueAdmin), true);
    // When ADMIN_ALLOWED_EMAILS is configured, must be rejected if not in allowlist
    const allowlist = (process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length > 0) {
      assert.equal(onAdminAllowlist('hacker@example.com'), false);
      assert.equal(isAdminRow(rogueAdmin), false);
    }

    // 3. Known valid admin from allowlist
    if (allowlist.length > 0) {
      const allowedEmail = allowlist[0];
      const validAdmin = { email: allowedEmail, is_admin: true, role: 'admin' };
      assert.equal(hasAdminRole(validAdmin), true);
      assert.equal(onAdminAllowlist(allowedEmail), true);
      assert.equal(isAdminRow(validAdmin), true);
    }
  });

  test('admin status cannot be acquired by email pattern alone', () => {
    const lookalike = { email: 'admin@impostor.com', is_admin: false, role: 'customer' };
    assert.equal(isAdminRow(lookalike), false);

    const containsAdmin = { email: 'notanadmin@gmail.com', is_admin: false, role: 'customer' };
    assert.equal(isAdminRow(containsAdmin), false);
  });
});
