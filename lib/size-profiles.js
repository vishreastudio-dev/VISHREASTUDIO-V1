import { badRequest, notFound, unprocessable } from './http.js';
import { isUuid, text, uuid } from './validate.js';
import { getSettings, SETTING_DEFAULTS } from './settings.js';

export const SIZE_STANDARDS = ['India', 'UK', 'US', 'EU'];
export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Custom'];
export const FIT_PREFERENCES = ['relaxed', 'regular', 'slim', 'oversized'];
export const RELATIONSHIPS = ['self', 'friend', 'sister', 'mother', 'partner', 'family', 'other'];

/** Load admin-configured fit preference options from app settings */
export async function getFitPreferenceConfig(client) {
  try {
    const settings = await getSettings(client);
    if (Array.isArray(settings?.fit_preference_options) && settings.fit_preference_options.length) {
      return settings.fit_preference_options;
    }
  } catch {
    // fallback if DB connection fails
  }
  return SETTING_DEFAULTS.fit_preference_options || [
    { id: 'relaxed', label: 'Relaxed Fit', description: 'Easy, roomy drape with ease throughout', active: true, sort_order: 1 },
    { id: 'regular', label: 'Regular / Tailored', description: 'Classic silhouette following natural body contours', active: true, sort_order: 2 },
    { id: 'slim', label: 'Slim / Structured', description: 'Fitted cut with sculpted waist and clean lines', active: true, sort_order: 3 },
    { id: 'oversized', label: 'Oversized / Fluid', description: 'Generous silhouette with intentional volume', active: true, sort_order: 4 },
  ];
}

export async function getActiveFitPreferences(client) {
  const options = await getFitPreferenceConfig(client);
  return options.filter((o) => o.active !== false);
}

/** Maps category slug to standard category sizing key */
export function categoryToSizeKey(slug = '') {
  const s = String(slug || '').toLowerCase().trim();
  if (['dresses', 'party-dresses'].includes(s)) return 'dresses';
  if (['tops', 'crop-tops', 'sweaters', 'sweatshirts-hoodies', 'cardigans'].includes(s)) return 'tops';
  if (['pants', 'trousers'].includes(s)) return 'pants';
  if (['jeans', 'denim'].includes(s)) return 'jeans';
  if (['skirts'].includes(s)) return 'skirts';
  if (['coord-sets', 'co-ord-sets', 'sets'].includes(s)) return 'coord_sets';
  if (['long-coats-shrugs', 'outerwear', 'jackets', 'coats'].includes(s)) return 'outerwear';
  return s || 'tops';
}

/** Numerical waist size to letter mapping and vice versa for pants */
export const WAIST_TO_LETTER = {
  '26': 'XS',
  '28': 'S',
  '30': 'M',
  '32': 'L',
  '34': 'XL',
  '36': 'XXL',
};

export const LETTER_TO_WAIST = {
  XS: '26',
  S: '28',
  M: '30',
  L: '32',
  XL: '34',
  XXL: '36',
};

/** Normalize size strings for comparison */
export function normalizeSize(s) {
  if (!s) return '';
  const clean = String(s).trim();
  const upper = clean.toUpperCase();
  if (['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].includes(upper)) return upper;
  if (/^\d{2}$/.test(clean)) return clean;
  return clean;
}

/** Check if a target size is inside a One Size range string like "Fits XS to L" or "Fits 28 to 34" */
export function matchesOneSizeRange(rangeStr, targetSize) {
  if (!rangeStr || !targetSize) return false;
  const str = rangeStr.toLowerCase();
  const target = targetSize.toUpperCase();

  const letterOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const targetIdx = letterOrder.indexOf(target);

  if (targetIdx !== -1) {
    // Check patterns like "xs to l", "xs - l", "fits all"
    if (str.includes('fits all') || str.includes('free size') || str.includes('one size')) return true;
    const match = str.match(/([a-z]+)\s*(?:to|-)\s*([a-z]+)/);
    if (match) {
      const minIdx = letterOrder.indexOf(match[1].toUpperCase());
      const maxIdx = letterOrder.indexOf(match[2].toUpperCase());
      if (minIdx !== -1 && maxIdx !== -1) {
        return targetIdx >= minIdx && targetIdx <= maxIdx;
      }
    }
  }

  // Numerical check
  const numTarget = parseInt(targetSize, 10);
  if (!isNaN(numTarget)) {
    const match = str.match(/(\d{2})\s*(?:to|-)\s*(\d{2})/);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      return numTarget >= min && numTarget <= max;
    }
  }

  return false;
}

/**
 * Pure function: determine if a product matches a customer's size profile.
 * Returns: { matches: boolean, matching_size: string, target_size: string, reason: string }
 */
export function matchProductToSize(product, profile) {
  if (!product || !profile) {
    return { matches: false, matching_size: null, target_size: null, reason: 'missing_input' };
  }

  const categoryKey = categoryToSizeKey(product.category_slug || product.category);
  const categorySizes = profile.category_sizes && typeof profile.category_sizes === 'object' ? profile.category_sizes : {};

  // Resolve target size: specific category size -> general clothing size -> fallback 'M'
  const targetRaw = categorySizes[categoryKey] || profile.clothing_size || 'M';
  const targetSize = normalizeSize(targetRaw);

  const availableSizes = Array.isArray(product.sizes) ? product.sizes : [];
  if (!availableSizes.length) {
    return { matches: false, matching_size: null, target_size: targetSize, reason: 'no_available_sizes' };
  }

  // 1. Direct match on available variant sizes
  for (const s of availableSizes) {
    const norm = normalizeSize(s);
    if (norm.toUpperCase() === targetSize.toUpperCase()) {
      return { matches: true, matching_size: s, target_size: targetSize, reason: 'exact_match' };
    }

    // Check waist number to letter match for pants/bottoms
    if (categoryKey === 'pants' || categoryKey === 'jeans') {
      const letterFromNum = WAIST_TO_LETTER[norm] || null;
      const numFromLetter = LETTER_TO_WAIST[norm.toUpperCase()] || null;
      if (letterFromNum && letterFromNum === targetSize.toUpperCase()) {
        return { matches: true, matching_size: s, target_size: targetSize, reason: 'waist_letter_match' };
      }
      if (numFromLetter && numFromLetter === targetSize) {
        return { matches: true, matching_size: s, target_size: targetSize, reason: 'letter_waist_match' };
      }
    }
  }

  // 2. Check one-size / free size pieces with configured fit range
  const isOneSize = availableSizes.some((s) => ['free size', 'one size', 'os'].includes(String(s).trim().toLowerCase()));
  if (isOneSize) {
    if (product.one_size_fit_range) {
      if (matchesOneSizeRange(product.one_size_fit_range, targetSize)) {
        return { matches: true, matching_size: 'Free Size', target_size: targetSize, reason: 'one_size_range_match' };
      }
    } else {
      // In Vishrea Studio, Free Size pieces are designed as fluid, versatile fits accommodating standard sizes XS through XL
      const fitsStandard = ['XS', 'S', 'M', 'L', 'XL'].includes(targetSize.toUpperCase()) || !targetSize;
      if (fitsStandard) {
        return { matches: true, matching_size: 'Free Size', target_size: targetSize, reason: 'free_size_default' };
      }
    }
  }

  return { matches: false, matching_size: null, target_size: targetSize, reason: 'size_unavailable' };
}

/** Sanitize and validate measurement numbers (must be positive float/int, max 300) */
function sanitizeMeasure(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (isNaN(n) || n < 10 || n > 350) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Fetch all size profiles for a customer.
 * Returns { profiles: Array, active_profile_id: string, active_profile: Object }
 */
export async function fetchCustomerSizeProfiles(db, authUserId) {
  if (!authUserId) return { profiles: [], active_profile_id: null, active_profile: null };

  const [profilesRes, custRes] = await Promise.all([
    db.query(
      `SELECT id, auth_user_id, name, relationship, is_primary, size_standard, clothing_size, custom_size,
              category_sizes, bust, waist, hips, shoulder, inseam, height, measurement_unit,
              fit_preference, silhouette_preference, created_at, updated_at
         FROM customer_size_profiles
        WHERE auth_user_id = $1
        ORDER BY is_primary DESC, created_at ASC`,
      [authUserId]
    ),
    db.query('SELECT active_size_profile_id, full_name, preferred_silhouette FROM customer_profiles WHERE auth_user_id = $1 LIMIT 1', [authUserId]),
  ]);

  let profiles = profilesRes.rows;

  // Auto-bootstrap primary profile if user has none
  if (!profiles.length) {
    const cust = custRes.rows[0];
    const defaultName = cust?.full_name?.trim() || 'My Wardrobe';
    const ins = await db.query(
      `INSERT INTO customer_size_profiles (auth_user_id, name, relationship, is_primary, size_standard, clothing_size, category_sizes, fit_preference, silhouette_preference)
       VALUES ($1, $2, 'self', true, 'India', 'M', '{"tops": "M", "dresses": "M", "skirts": "M", "pants": "30", "jeans": "30", "coord_sets": "M"}'::jsonb, 'regular', $3)
       RETURNING *`,
      [authUserId, defaultName, cust?.preferred_silhouette || 'Fluid & Relaxed']
    );
    profiles = [ins.rows[0]];
    await db.query('UPDATE customer_profiles SET active_size_profile_id = $1 WHERE auth_user_id = $2', [profiles[0].id, authUserId]);
  }

  const activeId = custRes.rows[0]?.active_size_profile_id || profiles.find((p) => p.is_primary)?.id || profiles[0]?.id;
  const activeProfile = profiles.find((p) => p.id === activeId) || profiles[0] || null;

  const allFitOptions = await getFitPreferenceConfig(db);
  const activeFitOptions = allFitOptions.filter((o) => o.active !== false);

  return {
    profiles,
    active_profile_id: activeProfile?.id || null,
    active_profile: activeProfile,
    fit_preferences: activeFitOptions,
    all_fit_preferences: allFitOptions,
  };
}

/** Create a new size profile (additional shopping profile for someone else or primary) */
export async function createSizeProfile(db, authUserId, payload = {}) {
  if (!authUserId) throw badRequest('auth_required', 'Authentication required');

  const allFitOptions = await getFitPreferenceConfig(db);
  const validFitIds = allFitOptions.map((o) => o.id);

  const name = text(payload.name, { max: 80, field: 'name', required: true });
  const relationship = RELATIONSHIPS.includes(payload.relationship) ? payload.relationship : 'friend';
  const sizeStandard = SIZE_STANDARDS.includes(payload.size_standard) ? payload.size_standard : 'India';
  const clothingSize = CLOTHING_SIZES.includes(payload.clothing_size) ? payload.clothing_size : 'M';
  const customSize = text(payload.custom_size, { max: 40, field: 'custom_size' }) || null;
  const fitPreference = validFitIds.includes(payload.fit_preference) || FIT_PREFERENCES.includes(payload.fit_preference)
    ? payload.fit_preference
    : 'regular';
  const silhouettePreference = text(payload.silhouette_preference, { max: 80, field: 'silhouette_preference' }) || null;
  const measurementUnit = ['cm', 'inches'].includes(payload.measurement_unit) ? payload.measurement_unit : 'cm';

  const categorySizes = payload.category_sizes && typeof payload.category_sizes === 'object' && !Array.isArray(payload.category_sizes)
    ? payload.category_sizes
    : { tops: clothingSize, dresses: clothingSize, pants: '30' };

  // Limit profiles per customer to 10
  const countRes = await db.query('SELECT count(*)::int AS total FROM customer_size_profiles WHERE auth_user_id = $1', [authUserId]);
  if ((countRes.rows[0]?.total ?? 0) >= 10) {
    throw badRequest('max_profiles_reached', 'You can save up to 10 size profiles.');
  }

  const isPrimary = Boolean(payload.is_primary);
  if (isPrimary) {
    // Clear any previous primary
    await db.query('UPDATE customer_size_profiles SET is_primary = false WHERE auth_user_id = $1', [authUserId]);
  }

  const ins = await db.query(
    `INSERT INTO customer_size_profiles (
       auth_user_id, name, relationship, is_primary, size_standard, clothing_size, custom_size,
       category_sizes, bust, waist, hips, shoulder, inseam, height, measurement_unit,
       fit_preference, silhouette_preference
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      authUserId,
      name,
      relationship,
      isPrimary,
      sizeStandard,
      clothingSize,
      customSize,
      JSON.stringify(categorySizes),
      sanitizeMeasure(payload.bust),
      sanitizeMeasure(payload.waist),
      sanitizeMeasure(payload.hips),
      sanitizeMeasure(payload.shoulder),
      sanitizeMeasure(payload.inseam),
      sanitizeMeasure(payload.height),
      measurementUnit,
      fitPreference,
      silhouettePreference,
    ]
  );

  const profile = ins.rows[0];

  // If marked active or if primary, update customer_profiles
  if (payload.make_active || isPrimary) {
    await db.query('UPDATE customer_profiles SET active_size_profile_id = $1 WHERE auth_user_id = $2', [profile.id, authUserId]);
  }

  return profile;
}

/** Update an existing size profile */
export async function updateSizeProfile(db, authUserId, profileId, payload = {}) {
  if (!authUserId) throw badRequest('auth_required', 'Authentication required');
  const id = uuid(profileId, 'profile_id');

  const existing = (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1 AND auth_user_id = $2', [id, authUserId])).rows[0];
  if (!existing) throw notFound('profile_not_found', 'Size profile not found');

  const allFitOptions = await getFitPreferenceConfig(db);
  const validFitIds = allFitOptions.map((o) => o.id);

  const name = payload.name !== undefined ? text(payload.name, { max: 80, field: 'name', required: true }) : existing.name;
  const relationship = payload.relationship !== undefined && RELATIONSHIPS.includes(payload.relationship) ? payload.relationship : existing.relationship;
  const sizeStandard = payload.size_standard !== undefined && SIZE_STANDARDS.includes(payload.size_standard) ? payload.size_standard : existing.size_standard;
  const clothingSize = payload.clothing_size !== undefined && CLOTHING_SIZES.includes(payload.clothing_size) ? payload.clothing_size : existing.clothing_size;
  const customSize = payload.custom_size !== undefined ? text(payload.custom_size, { max: 40, field: 'custom_size' }) || null : existing.custom_size;
  const fitPreference = payload.fit_preference !== undefined
    ? (validFitIds.includes(payload.fit_preference) || FIT_PREFERENCES.includes(payload.fit_preference) ? payload.fit_preference : existing.fit_preference)
    : existing.fit_preference;
  const silhouettePreference = payload.silhouette_preference !== undefined ? text(payload.silhouette_preference, { max: 80, field: 'silhouette_preference' }) : existing.silhouette_preference;
  const measurementUnit = payload.measurement_unit !== undefined && ['cm', 'inches'].includes(payload.measurement_unit) ? payload.measurement_unit : existing.measurement_unit;

  const categorySizes = payload.category_sizes !== undefined && typeof payload.category_sizes === 'object' && !Array.isArray(payload.category_sizes)
    ? payload.category_sizes
    : existing.category_sizes;

  const bust = payload.bust !== undefined ? sanitizeMeasure(payload.bust) : existing.bust;
  const waist = payload.waist !== undefined ? sanitizeMeasure(payload.waist) : existing.waist;
  const hips = payload.hips !== undefined ? sanitizeMeasure(payload.hips) : existing.hips;
  const shoulder = payload.shoulder !== undefined ? sanitizeMeasure(payload.shoulder) : existing.shoulder;
  const inseam = payload.inseam !== undefined ? sanitizeMeasure(payload.inseam) : existing.inseam;
  const height = payload.height !== undefined ? sanitizeMeasure(payload.height) : existing.height;

  let isPrimary = existing.is_primary;
  if (payload.is_primary === true && !existing.is_primary) {
    await db.query('UPDATE customer_size_profiles SET is_primary = false WHERE auth_user_id = $1', [authUserId]);
    isPrimary = true;
  }

  const upd = await db.query(
    `UPDATE customer_size_profiles SET
       name = $1, relationship = $2, is_primary = $3, size_standard = $4, clothing_size = $5,
       custom_size = $6, category_sizes = $7, bust = $8, waist = $9, hips = $10, shoulder = $11,
       inseam = $12, height = $13, measurement_unit = $14, fit_preference = $15,
       silhouette_preference = $16, updated_at = now()
     WHERE id = $17 AND auth_user_id = $18
     RETURNING *`,
    [
      name,
      relationship,
      isPrimary,
      sizeStandard,
      clothingSize,
      customSize,
      JSON.stringify(categorySizes),
      bust,
      waist,
      hips,
      shoulder,
      inseam,
      height,
      measurementUnit,
      fitPreference,
      silhouettePreference,
      id,
      authUserId,
    ]
  );

  return upd.rows[0];
}

/** Delete an additional size profile. Primary profile cannot be deleted. */
export async function deleteSizeProfile(db, authUserId, profileId) {
  if (!authUserId) throw badRequest('auth_required', 'Authentication required');
  const id = uuid(profileId, 'profile_id');

  const existing = (await db.query('SELECT is_primary FROM customer_size_profiles WHERE id = $1 AND auth_user_id = $2', [id, authUserId])).rows[0];
  if (!existing) throw notFound('profile_not_found', 'Size profile not found');
  if (existing.is_primary) {
    throw unprocessable('cannot_delete_primary', 'Your primary profile cannot be deleted. You can edit its sizes.');
  }

  await db.query('DELETE FROM customer_size_profiles WHERE id = $1 AND auth_user_id = $2', [id, authUserId]);

  // If this was active profile, reset active profile to primary profile
  const primary = (await db.query('SELECT id FROM customer_size_profiles WHERE auth_user_id = $1 AND is_primary = true LIMIT 1', [authUserId])).rows[0];
  if (primary) {
    await db.query('UPDATE customer_profiles SET active_size_profile_id = $1 WHERE auth_user_id = $2 AND active_size_profile_id = $3', [primary.id, authUserId, id]);
  }

  return { ok: true, active_profile_id: primary?.id || null };
}

/** Switch the active shopping profile */
export async function setActiveProfile(db, authUserId, profileId) {
  if (!authUserId) throw badRequest('auth_required', 'Authentication required');
  const id = uuid(profileId, 'profile_id');

  const profile = (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1 AND auth_user_id = $2', [id, authUserId])).rows[0];
  if (!profile) throw notFound('profile_not_found', 'Size profile not found');

  await db.query('UPDATE customer_profiles SET active_size_profile_id = $1 WHERE auth_user_id = $2', [id, authUserId]);

  return { ok: true, active_profile: profile };
}
