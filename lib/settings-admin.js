/**
 * Admin Settings: typed validation, persistence with before/after audit, and the read-only
 * context (fixed rules, upload storage, administrators) shown alongside the editable values.
 */
import { audit } from './audit.js';
import { badRequest } from './http.js';
import { adminAllowlist, hasAdminRole, isAdminRow } from './auth.js';
import { CUSTOMER_VIDEO_CAP, FIXED_RULES, SETTING_META, getSettings, invalidateSettings } from './settings.js';
import { storageStatus } from './uploads.js';
import { storageSummary } from './storage.js';
import { bool, email as validEmail, gstin, indianState, int, isUuid, money, phone, text } from './validate.js';

export const SETTING_GROUPS = [
  { id: 'membership', label: 'Membership' },
  { id: 'credits', label: 'Membership usage credits' },
  { id: 'rewards', label: 'Free-piece rewards' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'gifts', label: 'Gift memberships' },
  { id: 'checkout', label: 'Delivery, checkout & tax' },
  { id: 'operations', label: 'Exchanges, content & operations' },
  { id: 'legal', label: 'Legal information' },
];

const REF_TABLES = { categories: 'categories', products: 'products' };
const NON_EMPTY_LISTS = new Set(['membership_plan_months', 'gift_membership_months', 'gift_enquiry_types']);

function invalid(key, message) {
  return badRequest(`invalid_${key}`, message);
}

/** Validate one submitted value against its declared type. Returns the value to store. */
async function validateValue(c, key, value) {
  const meta = SETTING_META[key];
  switch (meta.type) {
    case 'money':
      return money(value, { field: key });
    case 'int': {
      const v = int(value, { min: meta.min ?? 0, max: meta.max ?? 100000, field: key });
      if (key === 'max_published_videos' && v > CUSTOMER_VIDEO_CAP.max_published_videos) {
        throw badRequest('video_limit', `At most ${CUSTOMER_VIDEO_CAP.max_published_videos} customer videos can be published`);
      }
      if (key === 'max_video_seconds' && v > CUSTOMER_VIDEO_CAP.max_video_seconds) {
        throw badRequest('video_limit', `Customer videos cannot be longer than ${CUSTOMER_VIDEO_CAP.max_video_seconds} seconds`);
      }
      return v;
    }
    case 'percent': {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0 || v > 40) throw invalid(key, `${meta.label} must be between 0 and 40`);
      return v;
    }
    case 'bool':
      if (typeof value !== 'boolean') throw invalid(key, `${meta.label} must be true or false`);
      return bool(value);
    case 'choice':
      if (!meta.choices.includes(value)) throw invalid(key, `${meta.label} must be one of: ${meta.choices.join(', ')}`);
      return value;
    case 'int_list':
    case 'text_list': {
      if (!Array.isArray(value) || value.length > 50) throw invalid(key, `${meta.label} must be a list`);
      const items = meta.type === 'int_list' ? value.map(Number) : value;
      const bad = items.find((v) => !meta.choices.includes(v));
      if (bad !== undefined) throw invalid(key, `${meta.label} may only contain: ${meta.choices.join(', ')}`);
      const unique = [...new Set(items)];
      if (NON_EMPTY_LISTS.has(key) && !unique.length) throw invalid(key, `${meta.label} needs at least one value`);
      return meta.type === 'int_list' ? unique.sort((a, b) => a - b) : unique;
    }
    case 'uuid_list': {
      if (!Array.isArray(value) || value.length > 500) throw invalid(key, `${meta.label} must be a list of at most 500 ids`);
      if (value.some((v) => !isUuid(v))) throw invalid(key, `${meta.label} contains an invalid id`);
      const unique = [...new Set(value.map((v) => v.toLowerCase()))];
      if (unique.length) {
        const found = (await c.query(`SELECT id::text FROM ${REF_TABLES[meta.ref]} WHERE id = ANY($1::uuid[])`, [unique])).rows.map((r) => r.id);
        const missing = unique.filter((id) => !found.includes(id));
        if (missing.length) throw invalid(key, `${meta.label}: ${missing.length} selected item(s) no longer exist`);
      }
      return unique;
    }
    default: {
      const v = text(value ?? '', { max: meta.max ?? 200, field: key }) || '';
      if (!v) return '';
      if (key === 'seller_gstin') return gstin(v);
      if (key === 'seller_state') return indianState(v);
      if (key === 'grievance_officer_email') return validEmail(v, key);
      if (key === 'grievance_officer_phone') return phone(v);
      return v;
    }
    case 'json': {
      if (key === 'fit_preference_options') {
        if (!Array.isArray(value) || !value.length) throw invalid(key, 'At least one fit preference option is required');
        const cleaned = value.map((opt, idx) => {
          const id = String(opt?.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
          const label = String(opt?.label || '').trim();
          const description = String(opt?.description || '').trim();
          const active = opt?.active !== false;
          const sort_order = Number.isFinite(Number(opt?.sort_order)) ? Number(opt.sort_order) : idx + 1;
          if (!id || !label) throw invalid(key, 'Each fit preference option requires an ID and label');
          return { id, label, description, active, sort_order };
        });
        if (!cleaned.some((o) => o.active)) throw invalid(key, 'At least one fit preference option must remain active');
        return cleaned.sort((a, b) => a.sort_order - b.sort_order);
      }
      return value;
    }
  }
}

/** Rules that span several settings, checked against the would-be result of the save. */
function validateCombination(next) {
  const plans = next.membership_plan_months;
  if (!plans.includes(Number(next.membership_upfront_months))) {
    throw invalid('membership_upfront_months', 'The default duration must be one of the durations on sale');
  }
  if (!plans.includes(Number(next.referral_plan_months))) {
    throw invalid('referral_plan_months', 'The referral discount must apply to a duration that is on sale');
  }
  if (next.six_month_reward_enabled && next.six_month_reward_qualification === 'six_month_plan' && !plans.includes(6)) {
    throw invalid('six_month_reward_qualification', 'The 6-month plan must be on sale while the 6th-month free piece is tied to it');
  }
  if (next.legal_details_verified) {
    const missing = ['seller_legal_name', 'seller_address', 'grievance_officer_name', 'grievance_officer_email'].filter((k) => !next[k]);
    if (missing.length) throw invalid('legal_details_verified', `Fill in ${missing.map((k) => SETTING_META[k].label).join(', ')} before marking the details verified`);
  }
}

/** Save submitted settings in one transaction; audit only the values that changed. */
export async function saveSettings(c, actor, submitted) {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw badRequest('invalid_settings', 'settings must be an object');
  const current = await getSettings(c);
  const next = { ...current };
  const changes = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (!SETTING_META[key]) throw badRequest('unknown_setting', `${key} is not an editable setting`);
    const v = await validateValue(c, key, value);
    next[key] = v;
    if (JSON.stringify(v) !== JSON.stringify(current[key])) changes[key] = { before: current[key], after: v };
  }
  validateCombination(next);
  for (const [key, { after }] of Object.entries(changes)) {
    await c.query('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, JSON.stringify(after)]);
  }
  if (Object.keys(changes).length) await audit(c, { actor, action: 'update_settings', entityType: 'settings', entityId: 'global', details: changes });
  invalidateSettings();
  return changes;
}

/** Add or remove one product from the reward-eligible list (validated and audited like any edit). */
export async function setProductRewardEligible(c, actor, productId, eligible) {
  const current = (await getSettings(c)).reward_eligible_product_ids;
  const next = eligible ? [...new Set([...current, productId])] : current.filter((id) => id !== productId);
  if (next.length !== current.length) await saveSettings(c, actor, { reward_eligible_product_ids: next });
}

/** Drop a deleted product or category from the eligibility lists so Settings stays saveable. */
export async function pruneRewardReference(c, actor, ref, id) {
  const key = ref === 'categories' ? 'reward_eligible_category_ids' : 'reward_eligible_product_ids';
  const current = (await getSettings(c))[key];
  if (current.includes(id)) await saveSettings(c, actor, { [key]: current.filter((x) => x !== id) });
}

/** Accounts holding an admin role, and whether each currently has admin access. Read-only. */
async function adminAccounts(c) {
  const allow = adminAllowlist();
  const rows = (await c.query(
    `SELECT p.email, p.role, p.is_admin, p.is_active, p.created_at,
            (SELECT max(a.created_at) FROM audit_logs a WHERE a.auth_user_id = p.auth_user_id) AS last_admin_action
       FROM profiles p WHERE p.is_admin OR p.role IN ('admin','owner') ORDER BY p.created_at`
  )).rows;
  return {
    allowlist_configured: Boolean(allow),
    accounts: rows.filter(hasAdminRole).map((r) => ({
      email: r.email,
      role: r.role,
      active: r.is_active !== false,
      on_allowlist: allow ? allow.has(String(r.email).toLowerCase()) : null,
      has_admin_access: r.is_active !== false && isAdminRow(r),
      created_at: r.created_at,
      last_admin_action: r.last_admin_action,
    })),
  };
}

/** Everything the Settings screen shows. Contains no secrets or environment values. */
export async function settingsView(c) {
  const [values, updated, admins] = await Promise.all([
    getSettings(c),
    c.query('SELECT key, updated_at FROM app_settings').then((r) => Object.fromEntries(r.rows.map((row) => [row.key, row.updated_at]))),
    adminAccounts(c),
  ]);
  const [categories, products, history] = await Promise.all([
    c.query('SELECT id, name, is_active FROM categories ORDER BY sort_order, name').then((r) => r.rows),
    c.query('SELECT id, name, slug, is_active, archived_at IS NOT NULL AS archived FROM products ORDER BY name LIMIT 2000').then((r) => r.rows),
    c.query(
      `SELECT p.email AS changed_by, a.details, a.created_at FROM audit_logs a LEFT JOIN profiles p ON p.auth_user_id = a.auth_user_id
        WHERE a.action = 'update_settings' ORDER BY a.created_at DESC LIMIT 20`
    ).then((r) => r.rows),
  ]);
  const meta = Object.fromEntries(Object.entries(SETTING_META).map(([k, m]) => [k, { ...m, value: values[k], updated_at: updated[k] || null }]));
  return {
    groups: SETTING_GROUPS,
    meta,
    fixed_rules: FIXED_RULES,
    options: { categories, products },
    storage: { ...storageSummary(), local: storageSummary().driver === 'local' ? storageStatus() : null },
    admins,
    history,
  };
}
