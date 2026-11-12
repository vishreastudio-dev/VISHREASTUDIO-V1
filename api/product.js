import { db } from '../lib/db.js';
import { notFound, badRequest } from '../lib/http.js';
import { dropVisibleSql, fetchProduct, hasEarlyAccess, normalizeProduct, VARIANT_SUMMARY_SQL } from '../lib/catalogue.js';
import { cachedPublic } from '../lib/public-cache.js';
import { getSettings } from '../lib/settings.js';
import { isUuid } from '../lib/validate.js';

export const access = 'public';
export const methods = ['GET'];

/** Product and recommendations, or null when the piece is not visible to this audience. */
async function productView(slug, visibility, member) {
  const found = await fetchProduct(db, slug, { isUuid, visibility });
  if (!found) return null;
  const { row, product: item } = found;

  const rec = await db.query(
    `SELECT p.id, p.name, p.slug, p.image_url, p.images, p.badge, p.is_one_of_one, p.created_at, c.name AS category, c.slug AS category_slug, vs.*
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${VARIANT_SUMMARY_SQL}
      WHERE p.is_active AND p.archived_at IS NULL AND p.id <> $1 AND vs.variant_count > 0 AND ${dropVisibleSql('p', visibility)}
      ORDER BY (p.category_id IS NOT DISTINCT FROM $2) DESC, p.featured DESC, p.created_at DESC LIMIT 4`,
    [row.id, row.category_id]
  );
  return {
    product: { ...item, members_early_access: Boolean(row.drop_id && member && (await inEarlyAccess(row.drop_id, visibility.earlyHours))) },
    recommendations: rec.rows.map(normalizeProduct),
  };
}

export default async function product(req, res) {
  const slug = String(req.query?.slug || req.query?.id || '').trim().slice(0, 120);
  if (!slug) throw badRequest('slug_required', 'Product reference is required');

  const [member, settings] = await Promise.all([hasEarlyAccess(db, req.user), getSettings()]);
  const visibility = { member, earlyHours: settings.early_access_hours };
  let body;
  if (member) body = await productView(slug, visibility, member);
  else {
    const r = await cachedPublic(`product:${slug}:${settings.early_access_hours}`, 10_000, () => productView(slug, visibility, member));
    res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
    body = r.value;
  }
  if (!body) throw notFound('product_not_found', 'This piece is not available');

  // Members can see pieces that are not public yet, so their responses are never shared-cached.
  res.setHeader('Cache-Control', member ? 'private, max-age=15' : 'public, max-age=15');
  res.json(body);
}

async function inEarlyAccess(dropId, hours) {
  const r = await db.query(
    `SELECT now() < COALESCE(public_at, starts_at + make_interval(hours => $2)) AS early FROM drop_settings WHERE id = $1 AND active`,
    [dropId, Math.max(0, Number(hours) || 0)]
  );
  return Boolean(r.rows[0]?.early);
}
