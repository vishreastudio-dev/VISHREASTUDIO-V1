import { badRequest } from './http.js';
import { config } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_UPLOAD_RE = /^\/uploads\/[a-z0-9_.-]{1,120}$/i;

/** Customer-facing name for an API field (`sender_name` → "Sender name", `bust_cm` → "Bust (cm)"). */
export function label(field) {
  const s = String(field).replace(/_cm$/, ' (cm)').replace(/_inr$/, ' (₹)').replace(/_id$/, '').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
export const isSlug = (v) => typeof v === 'string' && v.length <= 120 && SLUG_RE.test(v);
export const isLocalUpload = (v) => typeof v === 'string' && LOCAL_UPLOAD_RE.test(v) && !v.includes('..');

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Trimmed string or null; throws if longer than `max`. */
export function text(value, { max = 500, field = 'value', required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field}_required`, `${label(field)} is required`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`invalid_${field}`, `${label(field)} must be text`);
  const raw = String(value);
  // PostgreSQL rejects U+0000 with a UTF-8 error, which would otherwise surface as HTTP 500.
  if (raw.includes('\u0000')) throw badRequest(`invalid_${field}`, `${label(field)} contains an unsupported character`);
  const s = raw.trim();
  if (!s) {
    if (required) throw badRequest(`${field}_required`, `${label(field)} is required`);
    return null;
  }
  if (s.length > max) throw badRequest(`${field}_too_long`, `${label(field)} must be at most ${max} characters`);
  return s;
}

export function int(value, { min = -Infinity, max = Infinity, field = 'value', fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field}_required`, `${label(field)} is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    const range = Number.isFinite(min) && Number.isFinite(max) ? ` between ${min} and ${max}` : Number.isFinite(min) ? ` of at least ${min}` : Number.isFinite(max) ? ` of at most ${max}` : '';
    throw badRequest(`invalid_${field}`, `${label(field)} must be a whole number${range}`);
  }
  return n;
}

export function money(value, { field = 'price', allowNull = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    throw badRequest(`${field}_required`, `${label(field)} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw badRequest(`invalid_${field}`, `${label(field)} must be a non-negative amount`);
  return Math.round(n * 100) / 100;
}

export function uuid(value, field = 'id') {
  if (!isUuid(value)) throw badRequest(`invalid_${field}`, `${label(field)} is not a valid identifier`);
  return value;
}

/** http(s) URL only (blocks javascript:, data:, file: and similar). */
export function httpUrl(value, { field = 'url', max = 1000 } = {}) {
  const s = text(value, { max, field });
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw badRequest(`invalid_${field}`, `${label(field)} must be a valid web address`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest(`invalid_${field}`, `${label(field)} must start with http(s)://`);
  return u.toString();
}

/** Either a locally stored upload path, a public file in this site's storage, or an https URL. */
export function mediaUrl(value, { field = 'url' } = {}) {
  const s = text(value, { max: 1000, field });
  if (!s) return null;
  if (isLocalUpload(s)) return s;
  // The configured Supabase project (always https in production; http only for a local test server).
  const storageBase = config.storage.supabaseUrl ? `${config.storage.supabaseUrl}/storage/v1/object/public/` : null;
  if (storageBase && s.startsWith(storageBase) && !s.includes('..')) return s;
  const u = httpUrl(s, { field });
  if (!u.startsWith('https://')) throw badRequest(`invalid_${field}`, `${label(field)} must use https`);
  return u;
}

export function email(value, field = 'email') {
  const s = text(value, { max: 254, field, required: true }).toLowerCase();
  if (!isEmail(s)) throw badRequest(`invalid_${field}`, 'A valid email address is required');
  return s;
}

export function phone(value, { required = false } = {}) {
  const s = text(value, { max: 20, field: 'phone', required });
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(s)) throw badRequest('invalid_phone', 'A valid phone number is required');
  return s;
}

/**
 * Validates 10-digit Indian mobile numbers or standard E.164 international numbers.
 * For numbers originating in India (+91 / 0 prefix or 10 digits):
 * strictly validates exactly 10 digits starting with 6, 7, 8, or 9.
 */
export function indianMobile(value, { required = false, field = 'phone' } = {}) {
  const s = text(value, { max: 25, field, required });
  if (!s) return null;
  let cleaned = s.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);

  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return cleaned;
  }
  throw badRequest(`invalid_${field}`, 'Enter a valid 10-digit mobile number (e.g. 9876543210)');
}

/**
 * Validates personal names: letters, spaces, hyphens, apostrophes, and dots.
 * Supports Unicode regional & international letters.
 */
export function personName(value, { min = 2, max = 100, field = 'full_name', required = false } = {}) {
  const s = text(value, { max, field, required });
  if (!s) return null;
  if (s.length < min) throw badRequest(`${field}_too_short`, `${label(field)} must be at least ${min} characters`);
  if (!/^[\p{L}\s.'-]+$/u.test(s) || !/[\p{L}]/u.test(s)) {
    throw badRequest(`invalid_${field}`, `${label(field)} contains invalid characters`);
  }
  return s;
}

export function gstin(value) {
  const s = text(value, { max: 15, field: 'gstin' });
  if (!s) return null;
  const up = s.toUpperCase();
  if (!GSTIN_RE.test(up)) throw badRequest('invalid_gstin', 'GSTIN must be a valid 15-character GST number');
  return up;
}

export function oneOf(value, allowed, { field = 'value', fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw badRequest(`invalid_${field}`, `${label(field)} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function pageParams(query, { defaultLimit = 24, maxLimit = 100 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query?.limit, 10) || defaultLimit));
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const offset = query?.offset !== undefined ? Math.max(0, Number.parseInt(query.offset, 10) || 0) : (page - 1) * limit;
  return { limit, offset, page };
}

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export function indianState(value, { required = false } = {}) {
  const s = text(value, { max: 60, field: 'state', required });
  if (!s) return null;
  const match = INDIAN_STATES.find((x) => x.toLowerCase() === s.toLowerCase());
  if (!match) throw badRequest('invalid_state', 'Select a valid Indian state or union territory');
  return match;
}
