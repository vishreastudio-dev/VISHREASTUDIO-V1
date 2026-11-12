import { db } from '../lib/db.js';
import { customerVideoLimits, getSettings, membershipPlans } from '../lib/settings.js';
import { calculateMembershipPrice } from '../lib/pricing.js';
import { planOffer } from '../lib/membership.js';
import { cachedPublic } from '../lib/public-cache.js';

export const access = 'public';
export const methods = ['GET'];

/** Seller and grievance details are published only after the owner confirms them in Settings. */
function legalInfo(settings) {
  if (!settings.legal_details_verified) return null;
  return {
    legal_name: settings.seller_legal_name || null,
    address: settings.seller_address || null,
    gstin: settings.seller_gstin || null,
    state: settings.seller_state || null,
    grievance_officer: settings.grievance_officer_name
      ? { name: settings.grievance_officer_name, email: settings.grievance_officer_email || null, phone: settings.grievance_officer_phone || null }
      : null,
  };
}

export default async function content(req, res) {
  const r = await cachedPublic('content', 30_000, contentView);
  res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(r.value);
}

async function contentView() {
  const settings = await getSettings();
  const [i, v, s] = await Promise.all([
    db.query('SELECT id, title, post_url, image_url FROM instagram_content WHERE active = true ORDER BY sort_order, created_at DESC LIMIT 12'),
    db.query('SELECT id, title, customer_name, video_url, duration_seconds FROM feedback_videos WHERE active = true ORDER BY sort_order, created_at DESC LIMIT $1', [
      customerVideoLimits(settings).max_published_videos,
    ]),
    db.query('SELECT store_name, pickup_enabled, pickup_note FROM store_settings ORDER BY updated_at DESC LIMIT 1'),
  ]);
  // Public list prices for the membership page (personal discounts are applied only at checkout).
  const plans = membershipPlans(settings).map((months) => {
    const p = calculateMembershipPrice(settings, { months });
    return { months, monthly_price: settings.membership_price, list_total: p.list_total, discount: 0, total: p.total, credits_total: months * settings.credits_per_month, offer: planOffer(months, settings) };
  });
  return {
    instagram: i.rows,
    feedback_videos: v.rows,
    store: s.rows[0] || { store_name: 'Vishrea Studio', pickup_enabled: true },
    membership_plans: plans,
    referral_discount_inr: settings.referral_discount_inr,
    referral_plan_months: settings.referral_plan_months,
    gift_options: settings.gift_membership_months.map((months) => ({ months, total: calculateMembershipPrice(settings, { months }).total })),
    gift_enquiry_types: settings.gift_enquiry_types,
    legal: legalInfo(settings),
  };
}
