import { calculateProductPrice } from './pricing.js';

/** SQL fragment: per-product variant summary (min/max effective price, availability, sizes). */
export const VARIANT_SUMMARY_SQL = `
  LEFT JOIN LATERAL (
    SELECT min(CASE WHEN v.sale_price_inr IS NOT NULL AND v.sale_price_inr < v.price_inr THEN v.sale_price_inr ELSE v.price_inr END) AS min_price,
           max(CASE WHEN v.sale_price_inr IS NOT NULL AND v.sale_price_inr < v.price_inr THEN v.sale_price_inr ELSE v.price_inr END) AS max_price,
           max(v.price_inr) FILTER (WHERE v.sale_price_inr IS NOT NULL AND v.sale_price_inr < v.price_inr) AS compare_at,
           bool_or(v.stock_quantity > 0) AS in_stock,
           count(*)::int AS variant_count,
           COALESCE(json_agg(v.size_label ORDER BY v.sort_order, v.created_at) FILTER (WHERE v.stock_quantity > 0), '[]') AS sizes_available
      FROM product_variants v WHERE v.product_id = p.id AND v.is_active
  ) vs ON true`;

const asArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/** Predictable public product shape regardless of which optional fields are populated. */
export function normalizeProduct(row) {
  const images = asArray(row.images);
  const primary = row.image_url || images[0] || row.catalogue_image_url || null;
  const minPrice = row.min_price ?? row.price_inr ?? null;
  return {
    id: row.id,
    name: row.name || 'Untitled piece',
    slug: row.slug,
    description: row.description || '',
    category: row.category || null,
    category_slug: row.category_slug || null,
    badge: row.badge || null,
    material: row.material || null,
    color: row.color || null,
    colour_season: row.colour_season || null,
    occasion: row.occasion || null,
    care_instructions: row.care_instructions || null,
    attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes : {},
    measurements: { bust_cm: row.bust_cm ?? null, waist_cm: row.waist_cm ?? null, hip_cm: row.hip_cm ?? null, length_cm: row.length_cm ?? null },
    featured: Boolean(row.featured),
    is_one_of_one: Boolean(row.is_one_of_one),
    image_url: primary,
    images: images.length ? images : primary ? [primary] : [],
    price_inr: minPrice !== null ? Number(minPrice) : null,
    price_max_inr: row.max_price !== undefined && row.max_price !== null ? Number(row.max_price) : minPrice !== null ? Number(minPrice) : null,
    compare_at_price: row.compare_at !== undefined && row.compare_at !== null ? Number(row.compare_at) : null,
    available: Boolean(row.in_stock),
    sizes: asArray(row.sizes_available),
    variant_count: row.variant_count ?? 0,
    created_at: row.created_at,
  };
}

/**
 * Drop scheduling (CAT-09, MEM-02): a piece in a drop is hidden until the drop starts, then on sale to
 * active members only for the early-access window, then to everyone. `member` and `earlyHours` are
 * server-derived values, never request input.
 */
export function dropVisibleSql(alias, { member = false, earlyHours = 48 } = {}) {
  const hours = Math.max(0, Math.floor(Number(earlyHours) || 0));
  const publicAt = `COALESCE(d.public_at, d.starts_at + interval '${hours} hours')`;
  return `NOT EXISTS (SELECT 1 FROM drop_settings d WHERE d.id = ${alias}.drop_id AND d.active AND (now() < d.starts_at${member ? '' : ` OR now() < ${publicAt}`}))`;
}

/** Early access is a benefit of an active membership. */
export async function hasEarlyAccess(db, user) {
  if (!user?.id) return false;
  return Boolean((await db.query("SELECT 1 FROM memberships WHERE auth_user_id = $1 AND status = 'active'", [user.id])).rows[0]);
}

/** Full public product (with variants) by slug or id, or null. */
export async function fetchProduct(db, slugOrId, { isUuid, visibility = { member: false, earlyHours: 48 } }) {
  const r = await db.query(
    `SELECT p.*, c.name AS category, c.slug AS category_slug, vs.*
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${VARIANT_SUMMARY_SQL}
      WHERE (p.slug = $1 ${isUuid(slugOrId) ? 'OR p.id = $1::uuid' : ''}) AND p.is_active = true AND p.archived_at IS NULL AND ${dropVisibleSql('p', visibility)}
      LIMIT 1`,
    [slugOrId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const variants = await db.query('SELECT * FROM product_variants WHERE product_id = $1 AND is_active ORDER BY sort_order, created_at', [row.id]);
  return {
    row,
    product: {
      ...normalizeProduct(row),
      hsn_code: row.hsn_code || null,
      variants: variants.rows.map((v) => normalizeVariant(v, { isOneOfOne: row.is_one_of_one })),
    },
  };
}

/** Live products for listings (category slug optional). */
export async function fetchProductList(db, { category = null, featured = false, limit = 48 } = {}) {
  const params = [limit];
  const where = ['p.is_active = true', 'p.archived_at IS NULL', 'vs.variant_count > 0', dropVisibleSql('p')];
  if (category) {
    params.push(category);
    where.push(`c.slug = $${params.length}`);
  }
  if (featured) where.push('p.featured = true');
  const r = await db.query(
    `SELECT p.id, p.name, p.slug, p.description, p.image_url, p.images, p.catalogue_image_url, p.badge, p.material, p.color,
            p.colour_season, p.occasion, p.featured, p.is_one_of_one, p.created_at, p.price_inr, c.name AS category, c.slug AS category_slug, vs.*
       FROM products p LEFT JOIN categories c ON c.id = p.category_id ${VARIANT_SUMMARY_SQL}
      WHERE ${where.join(' AND ')} ORDER BY p.featured DESC, p.created_at DESC LIMIT $1`,
    params
  );
  return r.rows.map(normalizeProduct);
}

export function normalizeVariant(v, { isOneOfOne }) {
  const effective = calculateProductPrice(v);
  const stock = Math.max(0, Number(v.stock_quantity) || 0);
  return {
    id: v.id,
    sku: v.sku,
    size_label: v.size_label || 'Free Size',
    attributes: v.attributes && typeof v.attributes === 'object' ? v.attributes : {},
    price_inr: Number(v.price_inr),
    sale_price_inr: v.sale_price_inr !== null && v.sale_price_inr !== undefined ? Number(v.sale_price_inr) : null,
    effective_price: effective,
    in_stock: stock > 0,
    stock_state: stock === 0 ? 'sold_out' : isOneOfOne ? 'one_of_one' : stock <= 2 ? 'low' : 'in_stock',
    available_quantity: Math.min(stock, isOneOfOne ? 1 : 10),
  };
}
