import { audit } from './audit.js';
import { badRequest, conflict, notFound, unprocessable } from './http.js';
import { syncProductInventory } from './inventory.js';
import { pruneRewardReference } from './settings-admin.js';
import { bool, int, isUuid, mediaUrl, money, slugify, text, isSlug, uuid } from './validate.js';

const VARIANT_LIMIT = 50;

/** Colour seasons the on-device analysis returns; products are tagged with one so the catalogue can filter by it. */
export const COLOUR_SEASONS = ['Light Spring', 'True Autumn', 'Soft Autumn', 'Deep Autumn', 'Light Summer', 'Soft Summer', 'True Winter', 'Deep Winter'];

function colourSeason(value) {
  const s = text(value, { max: 40, field: 'colour_season' });
  if (!s) return '';
  const match = COLOUR_SEASONS.find((x) => x.toLowerCase() === s.toLowerCase());
  if (!match) throw badRequest('invalid_colour_season', `Colour season must be one of: ${COLOUR_SEASONS.join(', ')}`);
  return match;
}

function normalizeAttributes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 10)) {
    const key = String(k).trim().toLowerCase().slice(0, 40);
    if (!key || v === null || v === undefined || v === '') continue;
    out[key] = String(v).trim().slice(0, 80);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function parseVariants(list, fallback) {
  const variants = (Array.isArray(list) ? list : []).slice(0, VARIANT_LIMIT).map((v, i) => {
    const price = money(v.price_inr, { field: 'variant_price' });
    const sale = money(v.sale_price_inr, { field: 'variant_sale_price', allowNull: true });
    if (sale !== null && sale >= price) throw unprocessable('invalid_sale_price', `Sale price for ${v.size_label || 'variant'} must be lower than its price`);
    return {
      id: v.id && isUuid(v.id) ? v.id : null,
      sku: text(v.sku, { max: 64, field: 'sku' }),
      size_label: text(v.size_label, { max: 40, field: 'size_label' }) || 'Free Size',
      attributes: normalizeAttributes(v.attributes),
      price_inr: price,
      sale_price_inr: sale,
      stock_quantity: int(v.stock_quantity ?? 0, { min: 0, max: 100000, field: 'stock_quantity' }),
      stock_base: v.stock_base === undefined || v.stock_base === null ? null : int(v.stock_base, { min: 0, max: 100000, field: 'stock_base' }),
      is_active: v.is_active !== false,
      sort_order: Number.isInteger(Number(v.sort_order)) ? Number(v.sort_order) : i,
    };
  });
  if (!variants.length && fallback) variants.push(fallback);
  const seen = new Set();
  for (const v of variants) {
    const key = `${v.size_label.toLowerCase()}|${JSON.stringify(v.attributes)}`;
    if (seen.has(key)) throw unprocessable('duplicate_variant', `Size "${v.size_label}" is listed more than once with the same attributes`);
    seen.add(key);
  }
  const skus = variants.filter((v) => v.sku).map((v) => v.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) throw unprocessable('duplicate_sku', 'Each variant needs a unique SKU');
  return variants;
}

async function uniqueSlug(c, base, excludeId) {
  let slug = base || 'piece';
  for (let i = 2; i < 50; i += 1) {
    const r = await c.query('SELECT 1 FROM products WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)', [slug, excludeId]);
    if (!r.rows[0]) return slug;
    slug = `${base}-${i}`;
  }
  throw conflict('slug_taken', 'Choose a different product URL slug');
}

async function resolveCategory(c, b) {
  if (b.category_id && isUuid(b.category_id)) return b.category_id;
  const name = text(b.category, { max: 80, field: 'category' });
  if (!name) return null;
  const r = await c.query('SELECT id FROM categories WHERE lower(name) = lower($1) OR slug = $2 LIMIT 1', [name, slugify(name)]);
  return r.rows[0]?.id || null;
}

/** Create or update a product and its variants atomically. */
export async function saveProduct(c, actor, b) {
  const id = b.id && isUuid(b.id) ? b.id : null;
  const name = text(b.name, { max: 160, field: 'name', required: true });
  const requestedSlug = b.slug ? String(b.slug).trim().toLowerCase() : '';
  if (requestedSlug && !isSlug(requestedSlug)) throw badRequest('invalid_slug', 'Slug may contain lowercase letters, numbers and hyphens');
  const images = (Array.isArray(b.images) ? b.images : [])
    .map((u) => (u ? mediaUrl(u, { field: 'image' }) : null))
    .filter(Boolean)
    .slice(0, 8);
  const imageUrl = b.image_url ? mediaUrl(b.image_url, { field: 'image_url' }) : images[0] || null;
  const isOneOfOne = b.is_one_of_one !== false;
  const basePrice = b.price_inr !== undefined && b.price_inr !== '' ? money(b.price_inr) : null;

  const fields = {
    category_id: await resolveCategory(c, b),
    name,
    description: text(b.description, { max: 5000, field: 'description' }) || '',
    badge: text(b.badge, { max: 30, field: 'badge' }) || '',
    material: text(b.material, { max: 200, field: 'material' }) || '',
    color: text(b.color, { max: 60, field: 'color' }) || '',
    occasion: text(b.occasion, { max: 80, field: 'occasion' }) || '',
    colour_season: colourSeason(b.colour_season),
    size_label: text(b.size_label, { max: 40, field: 'size_label' }) || '',
    care_instructions: text(b.care_instructions, { max: 1000, field: 'care_instructions' }),
    attributes: JSON.stringify(normalizeAttributes(b.attributes)),
    bust_cm: b.bust_cm ? money(b.bust_cm, { field: 'bust_cm' }) : null,
    waist_cm: b.waist_cm ? money(b.waist_cm, { field: 'waist_cm' }) : null,
    hip_cm: b.hip_cm ? money(b.hip_cm, { field: 'hip_cm' }) : null,
    length_cm: b.length_cm ? money(b.length_cm, { field: 'length_cm' }) : null,
    cost_price_inr: b.cost_price_inr ? money(b.cost_price_inr, { field: 'cost_price' }) : 0,
    supplier_name: text(b.supplier_name, { max: 120, field: 'supplier_name' }) || '',
    hsn_code: (text(b.hsn_code, { max: 8, field: 'hsn_code' }) || '6204').replace(/[^0-9]/g, '') || '6204',
    is_active: b.is_active !== false,
    featured: bool(b.featured),
    is_one_of_one: isOneOfOne,
    // Premium pieces default to ineligible for credits and free-piece rewards; the admin can override.
    credit_eligible: b.credit_eligible === undefined ? !/premium/i.test(String(b.badge || '')) : bool(b.credit_eligible),
    image_url: imageUrl,
    images: JSON.stringify(images.length ? images : imageUrl ? [imageUrl] : []),
    catalogue_image_url: b.catalogue_image_url ? mediaUrl(b.catalogue_image_url, { field: 'catalogue_image_url' }) : null,
  };
  // Scheduling into a drop (members' early access) changes only when the field is sent.
  if (b.drop_id !== undefined) {
    fields.drop_id = b.drop_id ? uuid(b.drop_id, 'drop_id') : null;
    if (fields.drop_id && !(await c.query('SELECT 1 FROM drop_settings WHERE id = $1', [fields.drop_id])).rows[0]) throw badRequest('drop_not_found', 'That drop no longer exists');
  }

  const fallbackVariant =
    basePrice !== null && !id
      ? { id: null, sku: null, size_label: fields.size_label || 'Free Size', attributes: {}, price_inr: basePrice, sale_price_inr: null, stock_quantity: isOneOfOne ? 1 : 0, stock_base: null, is_active: true, sort_order: 0 }
      : null;
  const variants = parseVariants(b.variants, fallbackVariant);
  if (!id && !variants.length) throw unprocessable('variants_required', 'Add at least one size with a price');
  if (isOneOfOne && variants.some((v) => v.stock_quantity > 1)) throw unprocessable('one_of_one_stock', 'A one-of-one piece can have at most 1 unit per size');

  let productId = id;
  if (id) {
    const exists = (await c.query('SELECT slug FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!exists) throw notFound('product_not_found', 'Product not found');
    const slug = requestedSlug && requestedSlug !== exists.slug ? await uniqueSlug(c, requestedSlug, id) : exists.slug;
    const keys = Object.keys(fields);
    await c.query(
      `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, slug = $${keys.length + 2}, archived_at = CASE WHEN $${keys.length + 3}::boolean THEN NULL ELSE archived_at END, updated_at = now() WHERE id = $1`,
      [id, ...keys.map((k) => fields[k]), slug, fields.is_active]
    );
  } else {
    const slug = await uniqueSlug(c, requestedSlug || slugify(name), null);
    const keys = [...Object.keys(fields), 'slug', 'price_inr'];
    const vals = [...Object.values(fields), slug, Math.min(...variants.map((v) => v.price_inr))];
    const r = await c.query(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
    productId = r.rows[0].id;
  }

  const stockChanges = [];
  for (const v of variants) {
    const sku = v.sku || `${slugify(name).slice(0, 18).toUpperCase()}-${slugify(v.size_label).toUpperCase() || 'OS'}-${productId.slice(0, 4).toUpperCase()}`;
    if (v.id) {
      // Stock edits are applied as a delta against the value the admin loaded, so units held by
      // in-flight checkouts are never overwritten.
      const delta = v.stock_base === null ? null : v.stock_quantity - v.stock_base;
      const before = (await c.query('SELECT stock_quantity FROM product_variants WHERE id = $1 AND product_id = $2 FOR UPDATE', [v.id, productId])).rows[0];
      const r = await c.query(
        `UPDATE product_variants SET sku = $3, size_label = $4, attributes = $5, price_inr = $6, sale_price_inr = $7,
                stock_quantity = CASE WHEN $8::int IS NULL THEN $9 ELSE stock_quantity + $8::int END,
                is_active = $10, sort_order = $11, updated_at = now()
          WHERE id = $1 AND product_id = $2 AND ($8::int IS NULL OR stock_quantity + $8::int >= 0)
          RETURNING id, stock_quantity`,
        [v.id, productId, sku, v.size_label, JSON.stringify(v.attributes), v.price_inr, v.sale_price_inr, delta, v.stock_quantity, v.is_active, v.sort_order]
      );
      if (!r.rows[0]) throw conflict('stock_changed', `Stock for ${v.size_label} changed while you were editing (units are held in checkout). Reload and try again.`);
      if (before && Number(before.stock_quantity) !== Number(r.rows[0].stock_quantity)) {
        stockChanges.push({ variant_id: v.id, sku, before: Number(before.stock_quantity), after: Number(r.rows[0].stock_quantity) });
      }
    } else {
      await c.query(
        `INSERT INTO product_variants (product_id, sku, size_label, attributes, price_inr, sale_price_inr, stock_quantity, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [productId, sku, v.size_label, JSON.stringify(v.attributes), v.price_inr, v.sale_price_inr, v.stock_quantity, v.is_active, v.sort_order]
      );
    }
  }

  const after = await c.query('SELECT min(price_inr) AS p, max(stock_quantity) AS s FROM product_variants WHERE product_id = $1 AND is_active', [productId]);
  if (after.rows[0]?.p !== null && after.rows[0]?.p !== undefined) {
    await c.query('UPDATE products SET price_inr = $2 WHERE id = $1', [productId, after.rows[0].p]);
  }
  if (isOneOfOne && Number(after.rows[0]?.s) > 1) throw unprocessable('one_of_one_stock', 'A one-of-one piece can have at most 1 unit per size');
  await syncProductInventory(c, [productId]);
  await audit(c, { actor, action: id ? 'update_product' : 'create_product', entityType: 'product', entityId: productId, details: { name, variants: variants.length } });
  for (const s of stockChanges) {
    await audit(c, { actor, action: 'inventory_adjusted', entityType: 'product_variant', entityId: s.variant_id, details: { product_id: productId, sku: s.sku, before: s.before, after: s.after, reason: b.stock_reason ? String(b.stock_reason).slice(0, 200) : null } });
  }
  return productId;
}

export async function getProductWithVariants(c, id) {
  const p = (await c.query('SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1', [id])).rows[0];
  if (!p) throw notFound('product_not_found', 'Product not found');
  const v = await c.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order, created_at', [id]);
  const held = await c.query(
    "SELECT variant_id, sum(quantity)::int AS held FROM inventory_reservations WHERE status = 'held' AND variant_id = ANY($1::uuid[]) GROUP BY variant_id",
    [v.rows.map((x) => x.id)]
  );
  const heldBy = Object.fromEntries(held.rows.map((r) => [r.variant_id, r.held]));
  const reward = (await c.query("SELECT value FROM app_settings WHERE key = 'reward_eligible_product_ids'")).rows[0]?.value;
  return { ...p, reward_eligible: Array.isArray(reward) && reward.includes(p.id), variants: v.rows.map((x) => ({ ...x, held_quantity: heldBy[x.id] || 0 })) };
}

/** Products referenced by orders are archived (history is preserved); unsold products are deleted. */
export async function deleteOrArchiveProduct(c, actor, id) {
  const sold = await c.query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [id]);
  if (sold.rows[0]) {
    await c.query('UPDATE products SET is_active = false, archived_at = now(), updated_at = now() WHERE id = $1', [id]);
    await c.query('DELETE FROM cart_items WHERE product_id = $1', [id]);
    await audit(c, { actor, action: 'archive_product', entityType: 'product', entityId: id });
    return 'archived';
  }
  const held = await c.query("SELECT 1 FROM inventory_reservations ir JOIN product_variants v ON v.id = ir.variant_id WHERE v.product_id = $1 AND ir.status = 'held' LIMIT 1", [id]);
  if (held.rows[0]) throw conflict('product_in_checkout', 'This piece is in an active checkout. Hide it instead, or try again shortly.');
  await c.query('DELETE FROM saved_look_items WHERE product_id = $1', [id]);
  await c.query('DELETE FROM wardrobe_items WHERE product_id = $1', [id]);
  const r = await c.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
  if (!r.rows[0]) throw notFound('product_not_found', 'Product not found');
  await pruneRewardReference(c, actor, 'products', id);
  await audit(c, { actor, action: 'delete_product', entityType: 'product', entityId: id });
  return 'deleted';
}
