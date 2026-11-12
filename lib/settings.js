import { db } from './db.js';

/**
 * Every owner-editable business setting: type, Settings-screen group, default, and whether the
 * default is a confirmed business rule or a proposal awaiting the owner. The Settings API, the
 * admin Settings screen and every calculation read this one table.
 *
 * Types: money · int · percent · bool · text · choice (one of `choices`) · int_list / text_list
 * (a subset of `choices`) · uuid_list (ids that must exist in `ref`).
 */
export const SETTING_META = {
  // Membership (BD-1, BD-3)
  membership_price: { type: 'money', group: 'membership', default: 1799, confirmed: true, label: 'Monthly membership price (₹)' },
  membership_plan_months: {
    type: 'int_list', group: 'membership', default: [2], choices: [1, 2, 3, 6, 12], confirmed: true, label: 'Months charged upfront at sign-up',
    help: 'MEM-01: 2 months are charged together at sign-up, then monthly by UPI Autopay.',
  },
  membership_upfront_months: { type: 'int', group: 'membership', default: 2, confirmed: true, label: 'Months charged upfront (default)', help: 'Must be one of the values above' },
  membership_lock_in_months: { type: 'int', group: 'membership', default: 2, min: 0, max: 12, confirmed: true, label: 'Lock-in (months)', help: 'Cancellation opens after this many months from sign-up (MEM-09).' },
  subscription_total_count: { type: 'int', group: 'membership', default: 120, min: 12, max: 600, confirmed: false, label: 'Autopay mandate length (monthly charges)', help: 'Number of monthly debits the UPI Autopay mandate allows before it must be renewed.' },
  autopay_retry_count: { type: 'int', group: 'membership', default: 3, min: 0, max: 10, confirmed: true, label: 'Autopay retries', help: 'Must match the retry setting in the Razorpay dashboard (MEM-07). Shown to members.' },
  autopay_retry_days: { type: 'int', group: 'membership', default: 5, min: 1, max: 30, confirmed: true, label: 'Autopay retry window (days)', help: 'Must match the Razorpay dashboard. Credits are frozen during this window.' },
  pause_length_months: { type: 'int', group: 'membership', default: 1, min: 1, max: 3, confirmed: true, label: 'Pause length (months)' },
  renewal_window_days: { type: 'int', group: 'membership', default: 0, confirmed: true, label: 'Early renewal window (days)', help: '0 = renew once the paid period has ended (confirmed). A larger value lets members renew early (proposal).' },
  renewal_grace_days: {
    type: 'int', group: 'membership', default: 5, min: 0, max: 30, confirmed: false, label: 'Renewal grace period (days)',
    help: 'A renewal paid within this many days after the paid period ends continues the consecutive-month count for the 6th-month free piece. Later renewals start again at month 1.',
  },
  membership_gst_rate: { type: 'percent', group: 'membership', default: 18, confirmed: false, label: 'Membership GST rate (%)' },
  pause_frequency_months: { type: 'int', group: 'membership', default: 6, confirmed: false, label: 'Pause allowed once every (months)' },
  six_month_reward_enabled: { type: 'bool', group: 'membership', default: true, confirmed: true, label: 'Free piece in the 6th month' },
  six_month_reward_qualification: {
    type: 'choice', group: 'membership', default: 'consecutive_months', choices: ['consecutive_months', 'six_month_plan'], confirmed: true,
    label: 'Who qualifies for the 6th-month free piece',
    help: 'consecutive_months = the 6th, 12th, … consecutive paid month, whether prepaid as 6 months or reached by renewing; a pause or a lapse resets the count (confirmed, MEM-10). six_month_plan = only month 6 of a paid 6-month prepaid plan (earlier rule).',
  },

  // Existing membership usage credits (one credit = one eligible piece; not money, not a wallet)
  credits_per_month: { type: 'int', group: 'credits', default: 4, confirmed: true, label: 'Usage credits per paid month' },
  credit_expiry_days: { type: 'int', group: 'credits', default: 60, confirmed: true, label: 'Credit expiry (days after grant)', help: 'MEM-04' },
  credit_holding_limit: { type: 'int', group: 'credits', default: 8, min: 1, max: 48, confirmed: true, label: 'Most credits a member can hold', help: 'MEM-04. When a new month would exceed it, the oldest credits lapse first.' },
  free_member_credits_to_ship: { type: 'int', group: 'credits', default: 4, confirmed: false, label: 'Credits redeemed in one order for free delivery' },

  // Free-piece rewards (BD-4, BD-5)
  reward_eligible_category_ids: { type: 'uuid_list', ref: 'categories', group: 'rewards', default: [], confirmed: true, label: 'Eligible categories', help: 'Nothing is eligible until the owner chooses categories or pieces' },
  reward_eligible_product_ids: { type: 'uuid_list', ref: 'products', group: 'rewards', default: [], confirmed: true, label: 'Eligible pieces' },
  reward_max_price_inr: { type: 'money', group: 'rewards', default: 0, confirmed: false, label: 'Highest piece price a reward covers (₹)', help: '0 = no price limit (proposal)' },

  // Referrals
  referral_discount_inr: { type: 'money', group: 'referrals', default: 150, confirmed: true, label: 'New-customer discount (₹)' },
  referral_plan_months: { type: 'int', group: 'referrals', default: 2, confirmed: true, label: 'Membership duration the discount applies to (months)' },
  referrer_reward_quantity: { type: 'int', group: 'referrals', default: 1, min: 1, max: 5, confirmed: true, label: 'Free pieces per successful referral' },

  // Gift memberships
  gift_enquiry_types: { type: 'text_list', group: 'gifts', default: ['individual', 'corporate'], choices: ['individual', 'corporate'], confirmed: true, label: 'Enquiry types accepted' },
  gift_membership_months: { type: 'int_list', group: 'gifts', default: [2, 3, 6, 12], choices: [2, 3, 6, 12], confirmed: true, label: 'Pre-booked gift durations (months)', help: 'MEM-14: minimum 2, no autopay.' },
  gift_token_valid_days: { type: 'int', group: 'gifts', default: 90, min: 1, max: 730, confirmed: false, label: 'Redemption code validity (days)' },

  // Shipping, checkout and tax
  shipping_fee: { type: 'money', group: 'checkout', default: 99, confirmed: true, label: 'Delivery fee (₹)' },
  gift_packing_fee: { type: 'money', group: 'checkout', default: 50, confirmed: false, label: 'Gift packing fee (₹)' },
  reservation_minutes: { type: 'int', group: 'checkout', default: 15, min: 5, max: 60, confirmed: false, label: 'Checkout hold (minutes)' },
  cod_enabled: { type: 'bool', group: 'checkout', default: false, confirmed: false, label: 'Cash on delivery' },
  gst_threshold: { type: 'money', group: 'checkout', default: 2500, confirmed: false, label: 'GST slab threshold per piece (₹)' },
  gst_rate_low: { type: 'percent', group: 'checkout', default: 5, confirmed: false, label: 'GST at or below threshold (%)' },
  gst_rate_high: { type: 'percent', group: 'checkout', default: 18, confirmed: false, label: 'GST above threshold (%)' },

  // Exchanges, content and operations
  exchange_days: { type: 'int', group: 'operations', default: 7, confirmed: true, label: 'Exchange window (days after delivery)' },
  damage_report_hours: { type: 'int', group: 'operations', default: 24, confirmed: true, label: 'Damage report window (hours)' },
  max_published_videos: { type: 'int', group: 'operations', default: 3, confirmed: true, label: 'Live customer videos (max 3)' },
  max_video_seconds: { type: 'int', group: 'operations', default: 10, confirmed: true, label: 'Customer video length (max 10 s)' },
  max_wearers: { type: 'int', group: 'operations', default: 5, confirmed: false, label: 'Wearer profiles per customer' },
  dispatch_hours: { type: 'int', group: 'operations', default: 48, confirmed: false, label: 'Dispatch target (hours)' },
  early_access_hours: { type: 'int', group: 'operations', default: 48, confirmed: false, label: 'Drop early access (hours, not shown to customers)' },
  offer_after_days: { type: 'int', group: 'operations', default: 21, confirmed: false, label: 'Stock-age offer after (days)' },

  // Legal information (BD-8) — supplied and verified by the owner; never invented
  seller_legal_name: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'Legal business name' },
  seller_address: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'Registered / business address', max: 400 },
  seller_gstin: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'GSTIN (if registered)' },
  seller_state: { type: 'text', group: 'legal', default: 'Karnataka', confirmed: true, label: 'State of supply' },
  grievance_officer_name: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'Grievance officer name' },
  grievance_officer_email: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'Grievance officer email' },
  grievance_officer_phone: { type: 'text', group: 'legal', default: '', confirmed: false, label: 'Grievance officer phone' },
  legal_details_verified: { type: 'bool', group: 'legal', default: false, confirmed: true, label: 'Owner has verified these details', help: 'Legal details are shown on the contact page only after this is ticked' },
};

/** Rules that are confirmed and deliberately not configurable; shown read-only in Settings. */
export const FIXED_RULES = {
  referrals: [
    'Only a customer who has never paid for a membership can use a referral discount.',
    'The referral discount does not combine with any other offer.',
    'Self-referrals, a second referrer and repeat discounts are refused.',
    'The referrer’s free piece is issued once the referred customer’s first membership payment is verified, whichever duration she chooses.',
    'The new customer’s discount applies only to the referral duration (2 months); choosing another duration forgoes it.',
  ],
  rewards: [
    'A free-piece reward covers one eligible piece; it is not money and cannot be converted into credits or a discount.',
    'Eligibility, stock and one-time redemption are checked on the server at checkout.',
    'If the payment that earned a reward is refunded: an unused reward is revoked; a reward already used is flagged for admin review. No money is deducted and no other order changes.',
  ],
  gifts: [
    'Statuses: pending → processed → invoiced. Redemption codes can be issued only after invoicing.',
    'Each code works once, expires after the configured validity and can be revoked; only its hash is stored.',
  ],
  membership: [
    'Sign-up charges the upfront months and authorises a UPI Autopay mandate in one checkout; monthly debits start when the upfront months end.',
    'A membership is extended only by a payment verified on the server (signature + gateway check, or a signed webhook). Browser success alone never issues credits.',
    'During autopay retries credits are frozen; when every retry fails the membership pauses (it is not cancelled).',
    'Cancelling the UPI mandate from the customer’s UPI app is treated as a cancellation.',
  ],
};

export const SETTING_DEFAULTS = Object.fromEntries(Object.entries(SETTING_META).map(([k, m]) => [k, m.default]));

/** Settings an admin may edit, with their type (derived from SETTING_META). */
export const EDITABLE_SETTINGS = Object.fromEntries(Object.entries(SETTING_META).map(([k, m]) => [k, m.type]));

let cache = null;
let cachedAt = 0;
const TTL_MS = 30_000;

function parse(raw) {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Coerce a stored value to its declared type; anything unusable falls back to the default. */
function coerce(key, value) {
  const meta = SETTING_META[key];
  const fallback = meta ? meta.default : value;
  if (!meta) return value;
  switch (meta.type) {
    case 'money':
    case 'int':
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    case 'bool':
      return value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback;
    case 'int_list':
      return Array.isArray(value) ? value.map(Number).filter((n) => meta.choices.includes(n)) : fallback;
    case 'text_list':
      return Array.isArray(value) ? value.filter((v) => meta.choices.includes(v)) : fallback;
    case 'uuid_list':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && UUID_RE.test(v)) : fallback;
    case 'choice':
      return meta.choices.includes(value) ? value : fallback;
    default:
      return value === null || value === undefined ? fallback : String(value);
  }
}

export async function getSettings(client = db) {
  if (cache && Date.now() - cachedAt < TTL_MS && client === db) return cache;
  const r = await client.query('SELECT key, value FROM app_settings');
  const out = { ...SETTING_DEFAULTS };
  for (const row of r.rows) {
    const v = parse(row.value);
    if (SETTING_META[row.key]) out[row.key] = coerce(row.key, v);
    else if (v !== '' && v !== null && v !== undefined) out[row.key] = v;
  }
  // A plan list emptied by mistake must not take membership off sale.
  if (!out.membership_plan_months.length) out.membership_plan_months = SETTING_DEFAULTS.membership_plan_months;
  if (client === db) {
    cache = out;
    cachedAt = Date.now();
  }
  return out;
}

export function invalidateSettings() {
  cache = null;
}

/** Prepaid membership durations currently on sale (months), sorted. */
export const membershipPlans = (settings) => [...new Set(settings.membership_plan_months)].sort((a, b) => a - b);

/** Published customer videos. Settings may tighten these; they cannot raise them. */
export const CUSTOMER_VIDEO_CAP = { max_published_videos: 3, max_video_seconds: 10 };

export function customerVideoLimits(settings = {}) {
  const published = Number(settings.max_published_videos);
  const seconds = Number(settings.max_video_seconds);
  return {
    max_published_videos: Math.min(CUSTOMER_VIDEO_CAP.max_published_videos, Math.max(1, Number.isFinite(published) && published > 0 ? published : CUSTOMER_VIDEO_CAP.max_published_videos)),
    max_video_seconds: Math.min(CUSTOMER_VIDEO_CAP.max_video_seconds, Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : CUSTOMER_VIDEO_CAP.max_video_seconds)),
  };
}
