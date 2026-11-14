import { db } from '../lib/db.js';
import { notFound, badRequest } from '../lib/http.js';
import { dropVisibleSql, fetchProduct, hasEarlyAccess, normalizeProduct, VARIANT_SUMMARY_SQL } from '../lib/catalogue.js';
import { cachedPublic } from '../lib/public-cache.js';
import { getSettings } from '../lib/settings.js';
import { isUuid } from '../lib/validate.js';
import { matchProductToSize } from '../lib/size-profiles.js';

export const access = 'public';
export const methods = ['GET'];

/** Product and recommendations, or null when the piece is not visible to this audience. */
async function productView(slug, visibility, member, user, profileId) {
  const found = await fetchProduct(db, slug, { isUuid, visibility });
  if (!found) return null;
  const { row, product: item } = found;

  const [rec, guideRes, profileRes] = await Promise.all([
    db.query(
      `SELECT p.id, p.name, p.slug, p.image_url, p.images, p.badge, p.is_one_of_one, p.created_at,
              p.fit_type, p.one_size_fit_range, p.size_notes, c.name AS category, c.slug AS category_slug, vs.*
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         ${VARIANT_SUMMARY_SQL}
        WHERE p.is_active AND p.archived_at IS NULL AND p.id <> $1 AND vs.variant_count > 0 AND ${dropVisibleSql('p', visibility)}
        ORDER BY (p.category_id IS NOT DISTINCT FROM $2) DESC, p.featured DESC, p.created_at DESC LIMIT 4`,
      [row.id, row.category_id]
    ),
    db.query(
      `SELECT id, category_name, standard, size_chart, fit_guidance
         FROM product_size_guides
        WHERE id = $1 OR category_id = $2 OR category_name ILIKE $3
        ORDER BY (id = $1) DESC LIMIT 1`,
      [row.size_guide_id, row.category_id, item.category || 'Tops']
    ),
    (async () => {
      if (profileId) {
        return (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1', [profileId])).rows[0] || null;
      }
      if (user?.id) {
        const cust = (await db.query('SELECT active_size_profile_id FROM customer_profiles WHERE auth_user_id = $1', [user.id])).rows[0];
        if (cust?.active_size_profile_id) {
          return (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1', [cust.active_size_profile_id])).rows[0] || null;
        }
        return (await db.query('SELECT * FROM customer_size_profiles WHERE auth_user_id = $1 AND is_primary = true LIMIT 1', [user.id])).rows[0] || null;
      }
      return null;
    })(),
  ]);

  const profile = profileRes;
  let profileMatch = null;
  if (profile) {
    const res = matchProductToSize(item, profile);
    profileMatch = {
      profile_id: profile.id,
      profile_name: profile.name,
      relationship: profile.relationship,
      is_primary: profile.is_primary,
      matches: res.matches,
      matching_size: res.matching_size,
      target_size: res.target_size,
      reason: res.reason,
    };
  }

  return {
    product: {
      ...item,
      fit_type: row.fit_type || 'regular',
      one_size_fit_range: row.one_size_fit_range || null,
      size_notes: row.size_notes || null,
      members_early_access: Boolean(row.drop_id && member && (await inEarlyAccess(row.drop_id, visibility.earlyHours))),
      size_guide: guideRes.rows[0] || null,
      profile_match: profileMatch,
    },
    recommendations: rec.rows.map(normalizeProduct),
  };
}

export default async function product(req, res) {
  const slug = String(req.query?.slug || req.query?.id || '').trim().slice(0, 120);
  if (!slug) throw badRequest('slug_required', 'Product reference is required');

  const [member, settings] = await Promise.all([hasEarlyAccess(db, req.user), getSettings()]);
  const visibility = { member, earlyHours: settings.early_access_hours };
  const profileId = isUuid(req.query?.profile_id) ? req.query.profile_id : null;

  let body;
  if (member || req.user?.id || profileId) {
    body = await productView(slug, visibility, member, req.user, profileId);
  } else {
    const r = await cachedPublic(`product:${slug}:${settings.early_access_hours}`, 10_000, () => productView(slug, visibility, member, null, null));
    res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
    body = r.value;
  }
  if (!body) throw notFound('product_not_found', 'This piece is not available');

  res.setHeader('Cache-Control', (member || req.user?.id || profileId) ? 'private, max-age=15' : 'public, max-age=15');
  res.json(body);
}

async function inEarlyAccess(dropId, hours) {
  const r = await db.query(
    `SELECT now() < COALESCE(public_at, starts_at + make_interval(hours => $2)) AS early FROM drop_settings WHERE id = $1 AND active`,
    [dropId, Math.max(0, Number(hours) || 0)]
  );
  return Boolean(r.rows[0]?.early);
}
