import { db } from '../lib/db.js';
import { dropVisibleSql, hasEarlyAccess, normalizeProduct, VARIANT_SUMMARY_SQL } from '../lib/catalogue.js';
import { sendError } from '../lib/http.js';
import { cachedPublic } from '../lib/public-cache.js';
import { hit } from '../lib/rate-limit.js';
import { catalogueVocabulary, cleanQuery, correctTokens, matchSql, SUGGEST_MIN, tokenize } from '../lib/search.js';
import { getSettings } from '../lib/settings.js';

export const access = 'public';
export const methods = ['GET'];

const PRODUCT_LIMIT = 6;
const CATEGORY_LIMIT = 4;
// Live suggestions fire while typing (debounced in the browser); this caps a runaway client.
const RATE = { windowMs: 60_000, max: 120 };

const live = (visibility) => `p.is_active = true AND p.archived_at IS NULL AND ${dropVisibleSql('p', visibility)}`;

/** Categories that currently have something to show, for the empty search panel. */
async function browse(visibility) {
  const r = await db.query(
    `SELECT c.name, c.slug, count(p.id)::int AS count
       FROM categories c
       JOIN products p ON p.category_id = c.id
      WHERE c.is_active = true AND ${live(visibility)}
        AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
      GROUP BY c.id, c.name, c.slug, c.sort_order
      ORDER BY c.sort_order, c.name`
  );
  return { categories: [], products: [], total: 0, corrected_query: null, browse: r.rows };
}

async function matches(tokens, visibility) {
  const productParams = [];
  const categoryParams = [];
  const forProducts = matchSql(tokens, productParams);
  const forCategories = matchSql(tokens, categoryParams);
  const where = (match) => `${live(visibility)} AND vs.variant_count > 0 AND ${match.where}`;
  const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id ${VARIANT_SUMMARY_SQL}`;
  const [products, categories] = await Promise.all([
    db.query(
      `SELECT p.id, p.name, p.slug, p.image_url, p.images, p.catalogue_image_url, p.badge, p.color, p.is_one_of_one, p.price_inr,
              c.name AS category, c.slug AS category_slug, vs.*, count(*) OVER () AS total_count
         ${from}
        WHERE ${where(forProducts)}
        ORDER BY ${forProducts.relevance}, p.featured DESC, p.created_at DESC, p.id
        LIMIT ${PRODUCT_LIMIT}`,
      productParams
    ),
    // A category whose own name matches comes first and links to the whole category; otherwise
    // the suggestion is "<query> in <category>", counting only the matching pieces.
    db.query(
      `SELECT c.name, c.slug, count(*)::int AS count, (${forCategories.allIn('lower(c.name)')}) AS name_match
         ${from}
        WHERE ${where(forCategories)} AND c.is_active = true
        GROUP BY c.id, c.name, c.slug, c.sort_order
        ORDER BY name_match DESC, count DESC, c.sort_order
        LIMIT ${CATEGORY_LIMIT}`,
      categoryParams
    ),
  ]);
  return {
    total: Number(products.rows[0]?.total_count ?? 0),
    categories: categories.rows,
    products: products.rows.map((row) => {
      const p = normalizeProduct(row);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        color: p.color,
        image_url: p.image_url,
        price_inr: p.price_inr,
        price_max_inr: p.price_max_inr,
        compare_at_price: p.compare_at_price,
        available: p.available,
        is_one_of_one: p.is_one_of_one,
      };
    }),
  };
}

async function suggest(tokens, visibility) {
  if (tokens.join('').length < SUGGEST_MIN) return browse(visibility);
  const found = await matches(tokens, visibility);
  if (found.total > 0) return { ...found, corrected_query: null };
  const fixed = correctTokens(tokens, await catalogueVocabulary(db, visibility));
  if (fixed) {
    const retry = await matches(fixed, visibility);
    if (retry.total > 0) return { ...retry, corrected_query: fixed.join(' ') };
  }
  return { ...found, corrected_query: null };
}

export default async function search(req, res) {
  const limited = hit(`search:${req.ip}`, RATE);
  if (!limited.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((limited.resetAt - Date.now()) / 1000)));
    return sendError(res, 429, 'rate_limited', 'Too many searches. Please wait a moment and try again.');
  }
  const q = cleanQuery(req.query?.q);
  const tokens = tokenize(q);
  const [member, settings] = await Promise.all([hasEarlyAccess(db, req.user), getSettings()]);
  const visibility = { member, earlyHours: settings.early_access_hours };

  let body;
  if (member) body = await suggest(tokens, visibility);
  else {
    const r = await cachedPublic(`search:${tokens.join(' ')}:${settings.early_access_hours}`, 30_000, () => suggest(tokens, visibility));
    res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
    body = r.value;
  }
  res.setHeader('Cache-Control', member ? 'private, max-age=15' : 'public, max-age=30');
  res.json({ ...body, query: q });
}
