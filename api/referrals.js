import { db } from '../lib/db.js';
import { AppError, badRequest } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { hit } from '../lib/rate-limit.js';
import { attributeReferral, ensureReferralCode, findReferrer, hasPaidMembership, maskEmail, referralLink } from '../lib/referrals.js';

// Public for code validation only (a visitor landing on /?ref=CODE); everything else needs a session.
export const access = 'public';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 30 };

export default async function referrals(req, res) {
  const user = req.user || null;

  if (req.method === 'GET' && req.query?.code !== undefined) {
    const limiter = hit(`referral_check:${req.ip}`, { windowMs: 60 * 60_000, max: 60 });
    if (!limiter.allowed) throw new AppError(429, 'rate_limited', 'Too many requests. Please try again later.');
    const settings = await getSettings();
    const ref = await findReferrer(db, req.query.code);
    const own = Boolean(ref && user && ref.auth_user_id === user.id);
    return res.json({
      valid: Boolean(ref) && !own,
      reason: !ref ? 'invalid' : own ? 'own_code' : null,
      offer: ref && !own ? { discount_inr: Number(settings.referral_discount_inr) || 0, plan_months: Number(settings.referral_plan_months) } : null,
    });
  }

  if (!user) throw new AppError(401, 'unauthorized', 'Please sign in to continue');

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.action !== 'attribute') throw badRequest('unsupported_action', 'Unsupported referral action');
    const { referral, created } = await db.tx((c) => attributeReferral(c, user, b.code));
    return res.status(created ? 201 : 200).json({ ok: true, status: referral.status });
  }

  const settings = await getSettings();
  const code = await db.tx((c) => ensureReferralCode(c, user));
  const [history, rewards, mine, firstMembership] = await Promise.all([
    db.query(
      `SELECT id, referred_email, status, attributed_at, qualified_at, created_at FROM referrals
        WHERE referrer_user_id = $1 AND referred_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 100`,
      [user.id]
    ),
    db.query("SELECT id, status, referral_id, created_at, redeemed_at, flag_reason FROM reward_entitlements WHERE auth_user_id = $1 AND kind = 'referral' ORDER BY created_at DESC", [user.id]),
    db.query('SELECT status, referral_code, attributed_at, qualified_at FROM referrals WHERE referred_user_id = $1', [user.id]),
    hasPaidMembership(db, user.id),
  ]);
  const rows = history.rows;
  res.json({
    code,
    link: referralLink(code, req),
    offer: { discount_inr: Number(settings.referral_discount_inr) || 0, plan_months: Number(settings.referral_plan_months) },
    summary: {
      successful: rows.filter((r) => r.status === 'qualified').length,
      pending: rows.filter((r) => r.status === 'attributed').length,
      rewards_available: rewards.rows.filter((r) => r.status === 'available').length,
      rewards_redeemed: rewards.rows.filter((r) => r.status === 'redeemed').length,
    },
    history: rows.map((r) => ({ id: r.id, friend: maskEmail(r.referred_email), status: r.status, joined_at: r.attributed_at || r.created_at, qualified_at: r.qualified_at })),
    rewards: rewards.rows,
    referred_by: mine.rows[0] ? { status: mine.rows[0].status, code: mine.rows[0].referral_code, discount_pending: mine.rows[0].status === 'attributed' && !firstMembership } : null,
  });
}
