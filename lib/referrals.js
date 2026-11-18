/**
 * Referrals. Every customer has one code. A new customer attributed to a code (before their
 * first paid membership) receives the configured discount if that first membership is the
 * referral duration (2 months). When her first membership payment is verified, whatever its
 * duration, the referrer receives the configured free-piece entitlements. All checks run on the
 * server; attribution never changes once recorded.
 */
import crypto from 'crypto';
import { audit } from './audit.js';
import { config } from './config.js';
import { badRequest, conflict } from './http.js';

const CODE_RE = /^VS[A-HJ-NP-Z2-9]{6}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const normaliseCode = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const isReferralCode = (v) => CODE_RE.test(normaliseCode(v));
export const referralLink = (code, req = null) => {
  if (req) {
    const host = req.get ? (req.get('x-forwarded-host') || req.get('host')) : (req.headers && (req.headers['x-forwarded-host'] || req.headers['host']));
    const proto = req.get ? (req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http')) : ((req.headers && req.headers['x-forwarded-proto']) || 'http');
    if (config.isProd) {
      const base = process.env.PUBLIC_SITE_URL || (host ? `${proto}://${host}` : config.publicSiteUrl);
      return `${base.replace(/\/$/, '')}/?ref=${encodeURIComponent(code)}`;
    }
    if (host) {
      return `${proto}://${host}/?ref=${encodeURIComponent(code)}`;
    }
  }
  return `${config.publicSiteUrl}/?ref=${encodeURIComponent(code)}`;
};

function newCode() {
  const bytes = crypto.randomBytes(6);
  return 'VS' + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The customer's referral code, created on first use. */
export async function ensureReferralCode(c, user) {
  const row = (await c.query('SELECT referral_code FROM customer_profiles WHERE auth_user_id = $1', [user.id])).rows[0];
  if (row?.referral_code) return row.referral_code;
  for (let i = 0; i < 8; i += 1) {
    const code = newCode();
    const r = await c.query(
      `INSERT INTO customer_profiles (auth_user_id, email, referral_code) VALUES ($1, $2, $3)
       ON CONFLICT (auth_user_id) DO UPDATE SET referral_code = COALESCE(customer_profiles.referral_code, excluded.referral_code)
       RETURNING referral_code`,
      [user.id, user.email, code]
    ).catch((err) => (err.code === '23505' ? null : Promise.reject(err)));
    if (r?.rows[0]?.referral_code) return r.rows[0].referral_code;
  }
  throw new Error('referral_code_generation_failed');
}

export async function findReferrer(c, code) {
  const n = normaliseCode(code);
  if (!CODE_RE.test(n)) return null;
  return (await c.query('SELECT auth_user_id, referral_code FROM customer_profiles WHERE referral_code = $1', [n])).rows[0] || null;
}

export async function hasPaidMembership(c, authUserId) {
  return Boolean((await c.query("SELECT 1 FROM membership_payments WHERE auth_user_id = $1 AND status IN ('paid', 'refunded') LIMIT 1", [authUserId])).rows[0]);
}

/** Record that `user` joined through `code`. First attribution wins; only before a first paid membership. */
export async function attributeReferral(c, user, code) {
  const referrer = await findReferrer(c, code);
  if (!referrer) throw badRequest('invalid_referral_code', 'This referral code is not valid');
  if (referrer.auth_user_id === user.id) throw badRequest('self_referral', 'You cannot use your own referral code');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('referral:' || $1))", [user.id]);
  const existing = (await c.query('SELECT * FROM referrals WHERE referred_user_id = $1', [user.id])).rows[0];
  if (existing) {
    if (existing.referrer_user_id === referrer.auth_user_id) return { referral: existing, created: false };
    throw conflict('referral_already_recorded', 'A referral is already recorded for your account');
  }
  if (await hasPaidMembership(c, user.id)) throw conflict('not_first_membership', 'Referral offers are for a first membership only');
  const r = await c.query(
    `INSERT INTO referrals (referrer_user_id, referred_user_id, referred_email, referral_code, status, attributed_at)
     VALUES ($1, $2, $3, $4, 'attributed', now())
     ON CONFLICT (referred_user_id) WHERE referred_user_id IS NOT NULL DO NOTHING RETURNING *`,
    [referrer.auth_user_id, user.id, String(user.email || '').toLowerCase(), referrer.referral_code]
  );
  const referral = r.rows[0] || (await c.query('SELECT * FROM referrals WHERE referred_user_id = $1', [user.id])).rows[0];
  if (r.rows[0]) await audit(c, { actor: user.id, action: 'referral_attributed', entityType: 'referral', entityId: referral.id, details: { referrer: referrer.auth_user_id } });
  return { referral, created: Boolean(r.rows[0]) };
}

/** Server-side referral discount for a membership checkout, or { amount: 0 }. */
export async function referralDiscountFor(c, authUserId, months, settings) {
  if (Number(months) !== Number(settings.referral_plan_months)) return { amount: 0, referralId: null };
  const amount = Math.max(0, Number(settings.referral_discount_inr) || 0);
  if (!amount) return { amount: 0, referralId: null };
  const ref = (await c.query("SELECT id FROM referrals WHERE referred_user_id = $1 AND status = 'attributed'", [authUserId])).rows[0];
  if (!ref) return { amount: 0, referralId: null };
  if (await hasPaidMembership(c, authUserId)) return { amount: 0, referralId: null };
  return { amount, referralId: ref.id };
}

/**
 * The referral a verified membership payment qualifies: the one it was discounted for, or else the
 * customer's attributed referral when this is her first paid membership, whatever its duration.
 */
export async function referralForFirstPayment(c, mp) {
  if (mp.referral_id) return mp.referral_id;
  const earlier = await c.query(
    "SELECT 1 FROM membership_payments WHERE auth_user_id = $1 AND id <> $2 AND status IN ('paid', 'refunded') LIMIT 1",
    [mp.auth_user_id, mp.id]
  );
  if (earlier.rows[0]) return null;
  return (await c.query("SELECT id FROM referrals WHERE referred_user_id = $1 AND status = 'attributed'", [mp.auth_user_id])).rows[0]?.id || null;
}

/** Called inside the membership-payment transaction once the payment is verified. */
export async function qualifyReferral(c, { referralId, membershipPaymentId, discount, quantity = 1 }) {
  if (!referralId) return null;
  const q = await c.query(
    `UPDATE referrals SET status = 'qualified', qualified_at = now(), qualifying_payment_id = $2, discount_amount = $3, updated_at = now()
      WHERE id = $1 AND status = 'attributed' RETURNING *`,
    [referralId, membershipPaymentId, discount || 0]
  );
  const ref = q.rows[0];
  if (!ref) return null;
  const reward = await c.query(
    `INSERT INTO reward_entitlements (auth_user_id, kind, referral_id, sequence_no, source_payment_id)
     SELECT $1, 'referral', $2, n, $3 FROM generate_series(1, $4::int) AS n
     ON CONFLICT (referral_id, sequence_no) WHERE kind = 'referral' DO NOTHING RETURNING id`,
    [ref.referrer_user_id, ref.id, membershipPaymentId, Math.max(1, Math.min(5, Number(quantity) || 1))]
  );
  await audit(c, { actor: 'system', action: 'referral_qualified', entityType: 'referral', entityId: ref.id, details: { reward_ids: reward.rows.map((r) => r.id) } });
  return ref;
}

export const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
};
