import { db } from '../lib/db.js';
import { dropVisibleSql, hasEarlyAccess, normalizeProduct, VARIANT_SUMMARY_SQL } from '../lib/catalogue.js';
import { cachedPublic } from '../lib/public-cache.js';
import { catalogueVocabulary, cleanQuery, correctTokens, listParam, matchSql, rupeeParam, sortSizes, tokenize } from '../lib/search.js';
import { getSettings } from '../lib/settings.js';
import { bool, isUuid, pageParams } from '../lib/validate.js';
import { categoryToSizeKey, matchProductToSize, WAIST_TO_LETTER, LETTER_TO_WAIST } from '../lib/size-profiles.js';

export const access = 'public';
export const methods = ['GET'];

// `p.id` last keeps the order total, so pages never repeat or skip a product.
const ORDER = {
  featured: 'p.featured DESC, p.created_at DESC, p.id',
  newest: 'p.created_at DESC, p.id',
  price_asc: 'vs.min_price ASC NULLS LAST, p.created_at DESC, p.id',
  price_desc: 'vs.min_price DESC NULLS LAST, p.created_at DESC, p.id',
  name: 'lower(p.name) ASC, p.id',
};
const SORTS = [...Object.keys(ORDER), 'relevance'];

const FROM = `FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         ${VARIANT_SUMMARY_SQL}`;

/** Visibility, search words and category: the set the filter options are drawn from. */
function baseWhere({ q, tokens, category, member, earlyHours }, params) {
  const where = ['p.is_active = true', 'p.archived_at IS NULL', dropVisibleSql('p', { member, earlyHours }), 'vs.variant_count > 0'];
  const match = matchSql(tokens, params);
  if (match) where.push(match.where);
  // A query of symbols only has nothing to search for.
  else if (q) where.push('false');
  if (category) {
    params.push(category.toLowerCase());
    where.push(`(c.slug = $${params.length} OR lower(c.name) = $${params.length})`);
  }
  return { where, match };
}

function filterWhere({ season, featured, new_arrivals, inStock, soldOnly, sizes, colours, occasions, priceMin, priceMax }, params) {
  const where = [];
  if (season) {
    params.push(season.toLowerCase());
    where.push(`lower(coalesce(p.colour_season, '')) = $${params.length}`);
  }
  if (featured && !new_arrivals) where.push('p.featured = true');
  if (soldOnly) {
    where.push('vs.in_stock = false');
  } else if (inStock || new_arrivals) {
    where.push('vs.in_stock = true');
  }
  // A size filter means the piece can be bought in that size now (or was made in that size if viewing sold pieces)
  if (sizes.length) {
    params.push(sizes.map((s) => s.toLowerCase()));
    const stockCondition = soldOnly ? '' : 'AND sv.stock_quantity > 0';
    where.push(`EXISTS (
      SELECT 1 FROM product_variants sv
      WHERE sv.product_id = p.id AND sv.is_active ${stockCondition}
      AND (
        lower(btrim(sv.size_label)) = ANY($${params.length}::text[])
        OR lower(btrim(sv.size_label)) IN ('free size', 'one size', 'os')
      )
    )`);
  }
  if (colours.length) {
    params.push(colours.map((s) => s.toLowerCase()));
    where.push(`lower(btrim(coalesce(p.color, ''))) = ANY($${params.length}::text[])`);
  }
  if (occasions.length) {
    params.push(occasions.map((s) => s.toLowerCase()));
    where.push(`lower(btrim(coalesce(p.occasion, ''))) = ANY($${params.length}::text[])`);
  }
  if (priceMin !== null) {
    params.push(priceMin);
    where.push(`vs.min_price >= $${params.length}`);
  }
  if (priceMax !== null) {
    params.push(priceMax);
    where.push(`vs.min_price <= $${params.length}`);
  }
  return where;
}

/** Filter values that exist among the pieces matching the search and category. */
async function facets(args) {
  const params = [];
  const { where } = baseWhere(args, params);
  const distinct = (col) =>
    `(SELECT coalesce(json_agg(v ORDER BY lower(v)), '[]') FROM (SELECT min(btrim(${col})) AS v FROM base WHERE btrim(coalesce(${col}, '')) <> '' GROUP BY lower(btrim(${col}))) t)`;
  const r = await db.query(
    `WITH base AS (SELECT p.id, p.color, p.occasion, vs.min_price ${FROM} WHERE ${where.join(' AND ')})
     SELECT ${distinct('color')} AS colours,
            ${distinct('occasion')} AS occasions,
            (SELECT coalesce(json_agg(v), '[]') FROM (
               SELECT min(btrim(sv.size_label)) AS v FROM product_variants sv JOIN base b ON b.id = sv.product_id
                WHERE sv.is_active AND sv.stock_quantity > 0 AND btrim(coalesce(sv.size_label, '')) <> ''
                GROUP BY lower(btrim(sv.size_label))) t) AS sizes,
            (SELECT floor(min(min_price)) FROM base) AS price_min,
            (SELECT ceil(max(min_price)) FROM base) AS price_max`,
    params
  );
  const row = r.rows[0];
  return {
    sizes: sortSizes(row.sizes),
    colours: row.colours,
    occasions: row.occasions,
    price: row.price_min === null ? null : { min: Number(row.price_min), max: Number(row.price_max) },
  };
}

async function listing(args) {
  const params = [];
  const base = baseWhere(args, params);
  const where = [...base.where, ...filterWhere(args, params)];
  const order = args.sort === 'relevance' && base.match ? `${base.match.relevance}, ${ORDER.featured}` : ORDER[args.sort] || ORDER.featured;
  params.push(args.limit, args.offset);
  const [r, categories, options] = await Promise.all([
    db.query(
      `SELECT p.id, p.name, p.slug, p.description, p.image_url, p.images, p.catalogue_image_url, p.badge, p.material, p.color,
              p.colour_season, p.occasion, p.featured, p.is_one_of_one, p.created_at, p.price_inr,
              p.fit_type, p.one_size_fit_range, p.size_notes,
              c.name AS category, c.slug AS category_slug, vs.*, count(*) OVER () AS total_count
         ${FROM}
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    db.query(`SELECT c.id, c.name, c.slug, c.sort_order,
                     (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.is_active = true AND p.archived_at IS NULL) AS product_count
                FROM categories c
               WHERE c.is_active = true
               ORDER BY c.sort_order, c.name`),
    // Filter options are only needed with the first page; "Show more" keeps the ones it has.
    args.offset === 0 ? facets(args) : null,
  ]);
  const products = r.rows.map((row) => {
    const prod = normalizeProduct(row);
    if (args.profile) {
      const match = matchProductToSize(prod, args.profile);
      prod.fits_profile = match.matches;
      prod.matching_size = match.matching_size;
    }
    return prod;
  });
  return {
    products,
    total: Number(r.rows[0]?.total_count ?? 0),
    page: args.page,
    limit: args.limit,
    categories: categories.rows,
    sort: args.sort,
    ...(options ? { facets: options } : {}),
  };
}

/** Listing for the query as typed; if it finds nothing, one retry with misspelt words corrected. */
async function search(args) {
  const body = await listing(args);
  if (body.total > 0 || !args.tokens.length) return { ...body, corrected_query: null };
  const fixed = correctTokens(args.tokens, await catalogueVocabulary(db, args));
  if (fixed) {
    const retry = await listing({ ...args, tokens: fixed });
    if (retry.total > 0) return { ...retry, corrected_query: fixed.join(' ') };
  }
  return { ...body, corrected_query: null };
}

export function catalogueFilters(query) {
  const { limit, offset, page } = pageParams(query, { defaultLimit: 24, maxLimit: 100 });
  const q = cleanQuery(query?.q);
  const requested = typeof query?.sort === 'string' && SORTS.includes(query.sort) ? query.sort : null;
  let priceMin = rupeeParam(query?.price_min);
  let priceMax = rupeeParam(query?.price_max);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  const isNewArrivals = bool(query?.new_arrivals);
  const isFeatured = bool(query?.featured);
  const availability = cleanQuery(query?.availability, 20);
  const isSoldOnly = availability === 'sold' || bool(query?.sold_only);
  return {
    q,
    tokens: tokenize(q),
    category: cleanQuery(query?.category),
    season: cleanQuery(query?.colour_season, 40),
    featured: isFeatured,
    new_arrivals: isNewArrivals,
    inStock: isSoldOnly ? false : (availability === 'in_stock' || bool(query?.in_stock) || isNewArrivals || (isFeatured && !query?.include_sold)),
    soldOnly: isSoldOnly,
    availability: isSoldOnly ? 'sold' : bool(query?.in_stock) || availability === 'in_stock' ? 'in_stock' : 'all',
    sizes: listParam(query?.size),
    colours: listParam(query?.colour ?? query?.color),
    occasions: listParam(query?.occasion, { max: 80 }),
    priceMin,
    priceMax,
    sort: requested && !(requested === 'relevance' && !q) ? requested : q ? 'relevance' : 'featured',
    profile_id: isUuid(query?.profile_id) ? query.profile_id : null,
    size_filter: query?.size_filter !== undefined ? query.size_filter !== 'false' : null,
    limit,
    offset,
    page,
  };
}

export default async function catalogue(req, res) {
  const filters = catalogueFilters(req.query);
  try {
    const [member, settings] = await Promise.all([
      hasEarlyAccess(db, req.user).catch(() => false),
      getSettings().catch(() => ({ early_access_hours: 0 })),
    ]);

    // Resolve active size profile (either passed explicitly via profile_id or customer's active profile)
    let profile = null;
    if (filters.profile_id) {
      profile = (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1', [filters.profile_id])).rows[0] || null;
    } else if (req.user?.id) {
      const cust = (await db.query('SELECT active_size_profile_id FROM customer_profiles WHERE auth_user_id = $1', [req.user.id])).rows[0];
      const pId = cust?.active_size_profile_id;
      if (pId) {
        profile = (await db.query('SELECT * FROM customer_size_profiles WHERE id = $1', [pId])).rows[0] || null;
      }
      if (!profile) {
        profile = (await db.query('SELECT * FROM customer_size_profiles WHERE auth_user_id = $1 AND is_primary = true LIMIT 1', [req.user.id])).rows[0] || null;
      }
    }

    const sizeFilterRequested = filters.size_filter === true || (filters.size_filter !== false && !filters.featured && !filters.new_arrivals && (req.query?.size_filter === 'true' || Boolean(profile && req.query?.size_filter !== 'false' && req.user?.id)));
    if (sizeFilterRequested && profile && !filters.sizes.length) {
      if (filters.category) {
        const catKey = categoryToSizeKey(filters.category);
        const target = profile.category_sizes?.[catKey] || profile.clothing_size || 'M';
        const sList = [target];
        if (catKey === 'pants' || catKey === 'jeans') {
          if (WAIST_TO_LETTER[target]) sList.push(WAIST_TO_LETTER[target]);
          if (LETTER_TO_WAIST[target.toUpperCase()]) sList.push(LETTER_TO_WAIST[target.toUpperCase()]);
        }
        filters.sizes = sList;
      } else {
        const catVals = Object.values(profile.category_sizes || {});
        const allSizes = Array.from(new Set([...catVals, profile.clothing_size].filter(Boolean)));
        if (allSizes.length) filters.sizes = allSizes;
      }
    }

    const args = { ...filters, member, earlyHours: settings.early_access_hours, profile };

    // Members can see early-access pieces, and personalized profiles are user-specific,
    // so only the shared generic guest view is cached.
    let body;
    if (member || profile) body = await search(args);
    else {
      const { tokens, ...keyed } = filters;
      const lower = (v) => (Array.isArray(v) ? v.map((s) => s.toLowerCase()).sort() : typeof v === 'string' ? v.toLowerCase() : v);
      const key = `catalogue:${JSON.stringify({ ...Object.fromEntries(Object.entries(keyed).map(([k, v]) => [k, lower(v)])), tokens, h: settings.early_access_hours })}`;
      const r = await cachedPublic(key, 10_000, () => search(args));
      res.setHeader('X-Cache', r.cached ? 'hit' : 'miss');
      body = r.value;
    }
    res.setHeader('Cache-Control', (member || profile) ? 'private, max-age=15' : 'public, max-age=30');
    res.json({
      ...body,
      query: filters.q,
      size_profile: profile ? {
        id: profile.id,
        name: profile.name,
        relationship: profile.relationship,
        clothing_size: profile.clothing_size,
        category_sizes: profile.category_sizes,
        is_primary: profile.is_primary,
      } : null,
      size_filter_active: Boolean(profile && sizeFilterRequested),
    });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      products: [],
      total: 0,
      page: filters.page,
      limit: filters.limit,
      categories: [],
      facets: { sizes: [], colours: [], occasions: [], price: null },
      sort: filters.sort,
      query: filters.q,
      offline: true,
    });
  }
}
