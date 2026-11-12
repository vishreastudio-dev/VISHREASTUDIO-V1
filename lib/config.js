import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const env = process.env;
export const isProd = env.NODE_ENV === 'production';

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// Values that have appeared in tracked files or documentation and must never sign real sessions.
const KNOWN_WEAK_SECRETS = ['vishrea_local_dev_jwt_key_987654321', 'vishrea_auto_jwt_secret_9988776655', 'your_super_secret_jwt_key_at_least_32_chars'];

export function isWeakSecret(secret) {
  const s = String(secret || '');
  return !s || s.length < 32 || KNOWN_WEAK_SECRETS.includes(s) || /change_me|replace-in-production|YourTest|local_dev|super_secret/i.test(s) || new Set(s).size < 10;
}

function resolveJwtSecret() {
  const secret = env.JWT_SECRET || '';
  if (isProd && isWeakSecret(secret)) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production (generate with crypto.randomBytes(48)).');
  }
  if (isProd && env.OTP_PEPPER && isWeakSecret(env.OTP_PEPPER)) {
    throw new Error('OTP_PEPPER, when set, must be a random value of at least 32 characters in production.');
  }
  if (!secret) {
    // Development only: an ephemeral secret means sessions reset on restart, never a shared default.
    return crypto.randomBytes(48).toString('hex');
  }
  return secret;
}

const appOrigin = (env.APP_ORIGIN || (isProd ? '' : 'http://localhost:5173')).replace(/\/$/, '');
if (isProd && !/^https:\/\//.test(appOrigin)) {
  throw new Error('APP_ORIGIN must be the public https:// origin of the storefront in production.');
}

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  appOrigin,
  publicSiteUrl: (env.PUBLIC_SITE_URL || appOrigin || 'https://vishreastudio.com').replace(/\/$/, ''),
  allowedOrigins: Array.from(
    new Set([
      appOrigin,
      ...list(env.CORS_ORIGINS),
      ...(isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']),
    ].filter(Boolean))
  ),
  trustProxy: env.TRUST_PROXY !== undefined ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true') : isProd ? 1 : false,
  forceHttps: env.FORCE_HTTPS ? env.FORCE_HTTPS === 'true' : isProd,
  cspMode: env.CSP_MODE || (isProd ? 'enforce' : 'report-only'),
  jwtSecret: resolveJwtSecret(),
  otpPepper: env.OTP_PEPPER || '',
  sessionDays: Number(env.SESSION_DAYS || 14),
  // Explicit opt-in, never implied by NODE_ENV: echoes OTP codes in API responses for local testing.
  devOtpEcho: !isProd && env.AUTH_DEV_OTP_ECHO === 'true',
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    // Loaded for a future autopay plan. Checkout charges an upfront order and does not create a subscription.
    membershipPlanId: env.RAZORPAY_MEMBERSHIP_PLAN_ID || '',
    apiBase: env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1',
    get configured() {
      return Boolean(this.keyId && this.keySecret);
    },
    /** True only when the REST API is the local stand-in. The browser must not open Razorpay's hosted checkout with those ids. */
    get localCheckout() {
      try {
        const host = new URL(this.apiBase).hostname;
        return host === '127.0.0.1' || host === 'localhost';
      } catch {
        return false;
      }
    },
  },
  email: {
    resendApiKey: env.RESEND_API_KEY || '',
    // One sender for sign-in codes and order emails; OTP_FROM_EMAIL is the older name.
    from: env.EMAIL_FROM || env.OTP_FROM_EMAIL || 'Vishrea Studio <no-reply@vishreastudio.com>',
  },
  uploadsDir: env.UPLOADS_DIR || '',
  storage: resolveStorage(),
  productionProject: resolveProductionProject(),
};

/**
 * Where uploaded media is kept. Production always uses Supabase Storage so uploads never depend on
 * the app server's disk. Development uses the local store unless STORAGE_DRIVER=supabase is set, so
 * credentials in a developer's .env never cause writes to a shared project by accident.
 */
function resolveStorage() {
  const driver = env.STORAGE_DRIVER || (isProd ? 'supabase' : 'local');
  if (!['supabase', 'local'].includes(driver)) throw new Error('STORAGE_DRIVER must be "supabase" or "local".');
  if (isProd && driver !== 'supabase') throw new Error('STORAGE_DRIVER must be "supabase" in production: uploads must not depend on the server disk.');
  const supabaseUrl = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (driver === 'supabase') {
    let ok = false;
    try {
      const u = new URL(supabaseUrl);
      ok = u.protocol === 'https:' || (!isProd && ['127.0.0.1', 'localhost'].includes(u.hostname));
    } catch {
      ok = false;
    }
    if (!ok) throw new Error('SUPABASE_URL must be the https:// URL of the Supabase project when STORAGE_DRIVER=supabase.');
    if (serviceRoleKey.length < 20) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set (server-side only) when STORAGE_DRIVER=supabase.');
  }
  const bounded = (name, fallback, min, max) => {
    if (env[name] === undefined || env[name] === '') return fallback;
    const n = Number(env[name]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
    return n;
  };
  const bucket = (name, fallback) => {
    const v = env[name] || fallback;
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v)) throw new Error(`${name} must be a valid bucket name (lower-case letters, digits and hyphens).`);
    return v;
  };
  return {
    driver,
    supabaseUrl,
    serviceRoleKey,
    signedUrlSeconds: bounded('STORAGE_SIGNED_URL_SECONDS', 300, 30, 3600),
    timeoutMs: bounded('STORAGE_TIMEOUT_MS', 20000, 2000, 120000),
    buckets: {
      product: bucket('STORAGE_BUCKET_PRODUCTS', 'product-images'),
      banner: bucket('STORAGE_BUCKET_BANNERS', 'homepage-banners'),
      instagram: bucket('STORAGE_BUCKET_INSTAGRAM', 'instagram-media'),
      video: bucket('STORAGE_BUCKET_VIDEOS', 'customer-feedback'),
      evidence: bucket('STORAGE_BUCKET_EVIDENCE', 'exchange-evidence'),
      archive: bucket('STORAGE_BUCKET_ARCHIVE', 'media-archive'),
    },
  };
}

/** The `<ref>` of https://<ref>.supabase.co, or null for any other URL. */
export function supabaseProjectRef(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /^[a-z0-9]{20}\.supabase\.(co|in)$/.test(host) ? host.split('.')[0] : null;
  } catch {
    return null;
  }
}

/**
 * PRODUCTION_SUPABASE_PROJECT_REF names the live project (it is public: it appears in every image
 * URL). Outside production, `targeted` lists which settings point at it, so development can be
 * stopped before it reads or writes live data. In production it must match SUPABASE_URL.
 */
function resolveProductionProject() {
  const ref = (env.PRODUCTION_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  if (!ref) return { ref: null, targeted: [] };
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('PRODUCTION_SUPABASE_PROJECT_REF must be the 20-character project reference from https://<ref>.supabase.co.');
  if (isProd) {
    if (env.SUPABASE_URL && supabaseProjectRef(env.SUPABASE_URL) !== ref) throw new Error('SUPABASE_URL is not the project named by PRODUCTION_SUPABASE_PROJECT_REF.');
    return { ref, targeted: [] };
  }
  const targeted = [];
  if (supabaseProjectRef(env.SUPABASE_URL) === ref) targeted.push('SUPABASE_URL');
  if ((env.DATABASE_URL || '').toLowerCase().includes(ref)) targeted.push('DATABASE_URL');
  return { ref, targeted };
}

/**
 * Stop a non-production process that points at the production project. The web server never may;
 * maintenance scripts may only when the operator passes --production for that one run.
 */
export function assertNotProductionTarget(what, { allow = false, script = true } = {}) {
  const hit = config.productionProject.targeted;
  if (!hit.length) return false;
  if (!allow) {
    const override = script ? ', or pass --production to act on production deliberately' : '';
    throw new Error(`${what} refused: ${hit.join(' and ')} point at the production Supabase project (PRODUCTION_SUPABASE_PROJECT_REF). Use the development project for local work${override}.`);
  }
  console.warn(`[production] ${what} is acting on the PRODUCTION project (${hit.join(', ')}).`);
  return true;
}

if (isProd && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in production.');
}
if (isProd && env.AUTH_DEV_OTP_ECHO === 'true') {
  throw new Error('AUTH_DEV_OTP_ECHO must not be enabled in production.');
}

/** True when DATABASE_URL points somewhere other than this machine. */
export function isRemoteDatabase(url = env.DATABASE_URL) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return !['localhost', '127.0.0.1', '::1', ''].includes(host);
  } catch {
    return true;
  }
}

// Development and test must never reach a shared/live database by accident. A remote database in
// development is an explicit opt-in, and sign-in codes are never echoed while connected to one.
if (!isProd && env.NODE_ENV !== 'test' && isRemoteDatabase()) {
  if (config.devOtpEcho) {
    throw new Error('AUTH_DEV_OTP_ECHO=true is refused while DATABASE_URL points to a remote database. Use a local database for development.');
  }
  if (env.ALLOW_REMOTE_DATABASE !== 'true') {
    throw new Error('Development is pointed at a remote DATABASE_URL. Use a local/staging database, or set ALLOW_REMOTE_DATABASE=true to opt in explicitly (never for the production database).');
  }
}
if (isProd && !config.razorpay.keyId) throw new Error('RAZORPAY_KEY_ID must be set in production.');
if (isProd && !config.razorpay.keySecret) throw new Error('RAZORPAY_KEY_SECRET must be set in production.');
if (isProd && !config.razorpay.webhookSecret) throw new Error('RAZORPAY_WEBHOOK_SECRET must be set in production.');

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  if (!config.isProd) {
    try {
      const u = new URL(origin);
      // Tunnel origins must be listed explicitly in CORS_ORIGINS; no wildcard tunnel domains.
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    } catch {}
  }
  return false;
}
