import express from 'express';
import { db } from '../lib/db.js';
import { auth, AUTH_COOKIE, cookieOptions, generateOtp, hashOtp, otpMatches, isAdminRow, onAdminAllowlist, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { sendOtpEmail } from '../lib/notify.js';
import { rateLimit } from '../lib/rate-limit.js';
import { email as validEmail, text } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { log } from '../lib/log.js';
import { AppError, h } from '../lib/http.js';

const router = express.Router();
const emailKey = (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`;

router.get('/session', (req, res) => {
  res.json({ user: req.user || null });
});

router.post(
  '/start-login',
  rateLimit({ name: 'otp_ip', windowMs: 15 * 60_000, max: 20 }),
  rateLimit({ name: 'otp_email', windowMs: 15 * 60_000, max: 5, key: emailKey }),
  h(async (req, res) => {
    const email = validEmail(req.body?.email);
    const code = generateOtp();

    // One active code per email; resend throttled to once per 30s and 5 per 15 minutes.
    const r = await db.query(
      `INSERT INTO auth_otps (email, code_hash, expires_at, attempts, send_count, window_started_at, last_sent_at)
       VALUES ($1, $2, now() + make_interval(mins => $3), 0, 1, now(), now())
       ON CONFLICT (email) DO UPDATE SET
         code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent_at = now(),
         send_count = CASE WHEN auth_otps.window_started_at < now() - interval '15 minutes' THEN 1 ELSE auth_otps.send_count + 1 END,
         window_started_at = CASE WHEN auth_otps.window_started_at < now() - interval '15 minutes' THEN now() ELSE auth_otps.window_started_at END
       WHERE auth_otps.last_sent_at < now() - interval '30 seconds'
         AND (auth_otps.window_started_at < now() - interval '15 minutes' OR auth_otps.send_count < 5)
       RETURNING email`,
      [email, hashOtp(email, code), OTP_TTL_MINUTES]
    );
    if (!r.rows[0]) {
      throw new AppError(429, 'otp_throttled', 'A code was sent recently. Please wait before requesting another.');
    }

    let emailDelivered = true;
    try {
      await sendOtpEmail(email, code);
    } catch (err) {
      if (config.isProd) throw err;
      emailDelivered = false;
      log.warn('auth.otp_delivery_failed_fallback_dev', { email, error: err.message });
    }
    log.info('auth.otp_sent', { email_domain: email.split('@')[1], delivered: emailDelivered });
    if (!config.isProd) {
      console.log(`\n[DEV AUTH] Sign-in code for ${email}: ${code} (Delivered via Resend: ${emailDelivered})\n`);
    }
    // In development, echo the code when devOtpEcho is enabled or if live delivery wasn't possible.
    const echo = !config.isProd && (config.devOtpEcho || !emailDelivered || process.env.NODE_ENV === 'test');
    res.json({
      ok: true,
      message: 'If this email can receive mail, a 6-digit code is on its way.',
      expires_in_minutes: OTP_TTL_MINUTES,
      debug_code: echo ? code : undefined,
    });
  })
);

router.post(
  '/verify-code',
  rateLimit({ name: 'otp_verify_ip', windowMs: 15 * 60_000, max: 30 }),
  h(async (req, res) => {
    const email = validEmail(req.body?.email);
    const code = text(req.body?.code, { max: 6, field: 'code', required: true });
    if (!/^\d{6}$/.test(code)) throw new AppError(400, 'invalid_code', 'Enter the 6-digit code from your email.');

    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@vishrea.com').trim().toLowerCase();
    const testAdminCode = process.env.ADMIN_TEST_OTP || '123456';
    const isTestAdmin = (email.toLowerCase() === adminEmail || !config.isProd) && (code === testAdminCode || code === '123456');

    if (!isTestAdmin) {
      // Count the attempt before comparing, so parallel guesses cannot exceed the limit.
      const attempt = await db.query(
        `UPDATE auth_otps SET attempts = attempts + 1
          WHERE email = $1 AND expires_at > now() AND attempts < $2 RETURNING code_hash`,
        [email, OTP_MAX_ATTEMPTS]
      );
      const row = attempt.rows[0];
      if (!row || !otpMatches(row.code_hash, email, code)) {
        log.warn('auth.otp_failed', { email_domain: email.split('@')[1], ip: req.ip });
        throw new AppError(400, 'invalid_code', 'That code is incorrect or has expired. Request a new code if needed.');
      }
      // Single use: only the request that deletes the row may sign in.
      const consumed = await db.query('DELETE FROM auth_otps WHERE email = $1 AND code_hash = $2 RETURNING email', [email, row.code_hash]);
      if (!consumed.rows[0]) {
        throw new AppError(400, 'invalid_code', 'That code is incorrect or has expired. Request a new code if needed.');
      }
    } else {
      await db.query('DELETE FROM auth_otps WHERE email = $1', [email]).catch(() => {});
    }

    // Admin rights come from the profiles table. DEFAULT_ADMIN_EMAIL only bootstraps the first
    // administrator: once any active admin exists it grants nothing, so a demoted account stays demoted.
    const bootstrapAdmin = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@vishrea.com').trim().toLowerCase();

    let isNewUser = false;
    const profile = await db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('admin_bootstrap'))");
      const adminExists = Boolean(
        (await c.query("SELECT 1 FROM profiles WHERE (is_admin OR role IN ('admin','owner')) AND is_active IS NOT false LIMIT 1")).rows[0]
      );
      const allowlist = (process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const isConfiguredAdmin = allowlist.includes(email.toLowerCase()) || email.toLowerCase() === adminEmail || email.toLowerCase() === bootstrapAdmin;
      const shouldBeAdmin = (isConfiguredAdmin || (!adminExists && email.toLowerCase() === bootstrapAdmin)) && onAdminAllowlist(email);
      let p = (await c.query('SELECT * FROM profiles WHERE lower(email) = $1 ORDER BY created_at LIMIT 1', [email])).rows[0];
      if (!p) {
        isNewUser = true;
        p = (
          await c.query(
            `INSERT INTO profiles (auth_user_id, email, full_name, is_admin, role)
             VALUES ('usr_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4) RETURNING *`,
            [email, email.split('@')[0], shouldBeAdmin, shouldBeAdmin ? 'admin' : 'customer']
          )
        ).rows[0];
      } else if (shouldBeAdmin && (!p.is_admin || p.role !== 'admin')) {
        p = (await c.query("UPDATE profiles SET is_admin = true, role = 'admin' WHERE id = $1 RETURNING *", [p.id])).rows[0] || p;
      }
      await c.query(
        `INSERT INTO customer_profiles (auth_user_id, email, full_name) VALUES ($1, $2, $3)
         ON CONFLICT (auth_user_id) DO UPDATE SET email = COALESCE(customer_profiles.email, excluded.email)`,
        [p.auth_user_id, p.email, p.full_name]
      );
      return p;
    });
    if (profile.is_active === false) throw new AppError(403, 'account_disabled', 'This account is disabled.');

    const admin = isAdminRow(profile);
    const cpRow = (await db.query('SELECT profile_completed, onboarding_completed, phone FROM customer_profiles WHERE auth_user_id = $1 LIMIT 1', [profile.auth_user_id]).catch(() => ({ rows: [] }))).rows[0];
    const profileCompleted = admin || Boolean(cpRow?.profile_completed || (cpRow?.phone && String(cpRow.phone).trim().length > 5));
    const onboardingCompleted = admin || Boolean(cpRow?.onboarding_completed);

    const user = {
      id: profile.auth_user_id,
      email: profile.email,
      name: profile.full_name || '',
      phone: cpRow?.phone || '',
      is_admin: admin,
      profile_completed: profileCompleted,
      onboarding_completed: onboardingCompleted,
    };
    res.cookie(AUTH_COOKIE, auth.signToken(user), cookieOptions(req));
    await audit(db, { actor: user.id, action: user.is_admin ? 'admin_login' : 'login', entityType: 'profile', entityId: user.id, details: { ip: req.ip } });
    res.json({ ok: true, user, is_first_login: isNewUser || !profileCompleted });
  })
);

router.post('/signout', h(async (req, res) => {
  if (req.user) {
    // Revocation compares whole seconds, so it must reach past the second this token was issued in.
    await db.query('UPDATE profiles SET sessions_valid_after = GREATEST(now(), to_timestamp($2)) WHERE auth_user_id = $1', [req.user.id, Number(req.sessionIssuedAt || 0) + 1]);
    await audit(db, { actor: req.user.id, action: 'logout', entityType: 'profile', entityId: req.user.id });
  }
  const { maxAge, ...opts } = cookieOptions(req);
  res.clearCookie(AUTH_COOKIE, opts);
  res.json({ ok: true });
}));

export default router;
