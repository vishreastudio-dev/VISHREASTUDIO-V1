import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

export const AUTH_COOKIE = 'vishrea_auth';
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export function cookieOptions(req) {
  return {
    httpOnly: true,
    secure: config.isProd || Boolean(req?.secure),
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(email, code) {
  return crypto.createHmac('sha256', config.otpPepper || config.jwtSecret).update(`${email}:${code}`).digest('hex');
}

export function otpMatches(storedHash, email, code) {
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hashOtp(email, code), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Owner-approved admin emails (ADMIN_ALLOWED_EMAILS, comma-separated). When set, an account needs
 * both an admin role in the database and an email on this list; roles themselves are never changed.
 * Read on every call so a restart is the only step needed after editing it.
 */
export function adminAllowlist() {
  const list = String(process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? new Set(list) : null;
}

export const hasAdminRole = (row) => Boolean(row?.is_admin || row?.role === 'admin' || row?.role === 'owner');

export const onAdminAllowlist = (email) => {
  const allow = adminAllowlist();
  return !allow || allow.has(String(email || '').toLowerCase());
};

export const isAdminRow = (row) => hasAdminRole(row) && onAdminAllowlist(row.email);

export const auth = {
  signToken(user) {
    return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: `${config.sessionDays}d`,
      algorithm: 'HS256',
    });
  },

  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
  },

  /**
   * Resolve the caller from the session cookie (or Bearer token for non-browser clients).
   * Role and active state always come from the database, never from token claims.
   */
  async extractUser(req) {
    let token = null;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) token = header.slice(7);
    else if (req.cookies?.[AUTH_COOKIE]) token = req.cookies[AUTH_COOKIE];
    if (!token) return null;

    const decoded = this.verifyToken(token);
    let uid = decoded?.sub || decoded?.id;
    let tokenIat = decoded?.iat;

    if (!uid && header && header.startsWith('Bearer ')) {
      try {
        const { verifySupabaseAccessToken } = await import('./supabase.js');
        const sbUser = await verifySupabaseAccessToken(token);
        if (sbUser?.id) {
          const matched = await db.query(
            'SELECT auth_user_id FROM profiles WHERE supabase_user_id = $1 OR lower(email) = $2 LIMIT 1',
            [sbUser.id, sbUser.email]
          );
          if (matched.rows[0]) {
            uid = matched.rows[0].auth_user_id;
            tokenIat = Math.floor(Date.now() / 1000);
          }
        }
      } catch {
        // Not a valid Supabase bearer token
      }
    }

    if (!uid) return null;

    const r = await db.query(
      `SELECT p.auth_user_id, p.full_name, p.email, p.is_admin, p.role, p.is_active, p.sessions_valid_after,
              COALESCE(cp.profile_completed, false) AS profile_completed,
              COALESCE(cp.onboarding_completed, false) AS onboarding_completed,
              cp.phone
       FROM profiles p
       LEFT JOIN customer_profiles cp ON cp.auth_user_id = p.auth_user_id
       WHERE p.auth_user_id = $1 LIMIT 1`,
      [uid]
    ).catch(async () => {
      return db.query(
        'SELECT auth_user_id, full_name, email, is_admin, role, is_active, sessions_valid_after FROM profiles WHERE auth_user_id = $1 LIMIT 1',
        [uid]
      );
    });
    const u = r.rows[0];
    if (!u || u.is_active === false) return null;
    // iat has one-second resolution; a token is revoked if it was issued in an earlier second.
    if (u.sessions_valid_after && ((tokenIat || 0) + 1) * 1000 <= new Date(u.sessions_valid_after).getTime()) return null;
    req.sessionIssuedAt = tokenIat || Math.floor(Date.now() / 1000);
    const admin = isAdminRow(u);
    return {
      id: u.auth_user_id,
      email: u.email,
      name: u.full_name || '',
      phone: u.phone || '',
      is_admin: admin,
      profile_completed: admin || Boolean(u.profile_completed || (u.phone && String(u.phone).trim().length > 5)),
      onboarding_completed: admin || Boolean(u.onboarding_completed),
    };
  },
};
