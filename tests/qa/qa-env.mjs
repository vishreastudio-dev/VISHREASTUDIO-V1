// The isolated QA environment. Built from scratch (never from process.env), so no value from the
// developer's live-connected .env can reach a QA process. Every variable the app reads is set
// explicitly, and every key found in .env that is not set here is blanked, because the app's
// dotenv loader only fills variables that are missing.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const QA_PORT = 3100;
export const GATEWAY_PORT = 3190;
export const QA_DB_URL = 'postgresql://postgres@127.0.0.1:55432/vishrea_qa';
export const QA_ADMIN_EMAIL = 'qa-admin@qa.test';
export const STATE_DIR = path.join(ROOT, 'scratch', 'qa');

// Only what Node and child processes need from the operating system.
const OS_KEYS = ['SystemRoot', 'SYSTEMROOT', 'windir', 'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'HOME', 'LANG'];

/** Keys present in the developer .env (names only are used outside the isolation check). */
export function dotenvValues() {
  const file = path.join(ROOT, '.env');
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
}

/** The <ref> of the live project, taken from .env SUPABASE_URL. Never printed. */
export function liveProjectRef() {
  try {
    const host = new URL(dotenvValues().SUPABASE_URL || '').hostname.toLowerCase();
    return /^[a-z0-9]{20}\.supabase\.(co|in)$/.test(host) ? host.split('.')[0] : null;
  } catch {
    return null;
  }
}

function secrets() {
  const file = path.join(STATE_DIR, 'secrets.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const s = { jwt: crypto.randomBytes(48).toString('hex'), pepper: crypto.randomBytes(48).toString('hex'), razorpaySecret: crypto.randomBytes(24).toString('hex'), webhookSecret: crypto.randomBytes(24).toString('hex') };
  fs.writeFileSync(file, JSON.stringify(s));
  return s;
}

/**
 * profile "security": rate limits on, client IP from the socket (X-Forwarded-For ignored).
 * profile "load": rate limits on, TRUST_PROXY=1 so each virtual user's own X-Forwarded-For address
 * is its client identity, as behind the production proxy. Nothing is disabled globally.
 */
export function qaEnv(profile = 'security') {
  if (!['security', 'load'].includes(profile)) throw new Error(`unknown profile ${profile}`);
  const s = secrets();
  const base = Object.fromEntries(OS_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  const origin = `http://127.0.0.1:${QA_PORT}`;
  const explicit = {
    NODE_ENV: 'development',
    SITE_ENV: 'qa',
    PORT: String(QA_PORT),
    APP_ORIGIN: origin,
    PUBLIC_SITE_URL: origin,
    CORS_ORIGINS: '',
    FORCE_HTTPS: 'false',
    CSP_MODE: 'enforce',
    TRUST_PROXY: profile === 'load' ? '1' : 'false',
    PUBLIC_CACHE: 'on',
    RATE_LIMIT_DISABLED: 'false',
    RATE_LIMIT_GLOBAL: '',
    RUN_BACKGROUND_JOBS: 'true',
    LOG_SILENT: '',

    JWT_SECRET: s.jwt,
    OTP_PEPPER: s.pepper,
    SESSION_DAYS: '1',
    AUTH_DEV_OTP_ECHO: 'true',
    DEFAULT_ADMIN_EMAIL: QA_ADMIN_EMAIL,
    ADMIN_ALLOWED_EMAILS: QA_ADMIN_EMAIL,

    DATABASE_URL: QA_DB_URL,
    LOADTEST_DATABASE_URL: QA_DB_URL,
    DATABASE_SSL: 'false',
    DATABASE_SSL_CA_FILE: '',
    DATABASE_SSL_REJECT_UNAUTHORIZED: '',
    ALLOW_REMOTE_DATABASE: 'false',
    DB_POOL_MAX: '10',
    DB_CONNECT_TIMEOUT_MS: '10000',
    DB_STATEMENT_TIMEOUT_MS: '15000',
    PGHOST: '', PGPORT: '', PGUSER: '', PGPASSWORD: '', PGDATABASE: '',

    RESEND_API_KEY: '',
    EMAIL_FROM: 'Vishrea QA <qa@qa.test>',
    OTP_FROM_EMAIL: '',

    RAZORPAY_KEY_ID: 'rzp_test_qa_standin',
    RAZORPAY_KEY_SECRET: s.razorpaySecret,
    RAZORPAY_WEBHOOK_SECRET: s.webhookSecret,
    RAZORPAY_API_BASE: `http://127.0.0.1:${GATEWAY_PORT}`,
    RAZORPAY_MEMBERSHIP_PLAN_ID: '',
    RAZORPAY_AUTO_REFUND: 'true',

    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: 'http://127.0.0.1:9',
    AI_MODEL: 'qa-none',

    STORAGE_DRIVER: 'local',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_ANON_KEY: '',
    STORAGE_SIGNED_URL_SECONDS: '300',
    STORAGE_TIMEOUT_MS: '20000',
    STORAGE_BUCKET_PRODUCTS: '', STORAGE_BUCKET_BANNERS: '', STORAGE_BUCKET_INSTAGRAM: '', STORAGE_BUCKET_VIDEOS: '', STORAGE_BUCKET_EVIDENCE: '', STORAGE_BUCKET_ARCHIVE: '',
    UPLOADS_DIR: path.join(STATE_DIR, 'uploads'),
    UPLOAD_ORPHAN_CLEANUP_DAYS: '',

    // Arms the production guard: if anything above ever pointed at the live project, the server
    // and the maintenance scripts would refuse to run.
    PRODUCTION_SUPABASE_PROJECT_REF: liveProjectRef() || '',
  };
  const blanked = Object.fromEntries(Object.keys(dotenvValues()).filter((k) => !(k in explicit)).map((k) => [k, '']));
  return { ...base, ...blanked, ...explicit };
}

/** Names whose values would connect to, or authenticate against, an external system. */
export const SENSITIVE = /URL|KEY|SECRET|PASSWORD|TOKEN|PEPPER|EMAIL|ORIGIN|API_BASE|PLAN_ID|PG(HOST|USER|DATABASE)/;
