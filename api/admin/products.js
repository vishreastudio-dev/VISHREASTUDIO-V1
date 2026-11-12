import { db } from '../../lib/db.js';
import { pageParams } from '../../lib/validate.js';

export const access = 'admin';
// Read-only. Product writes go through /api/admin/ops?section=product so that variants,
// pricing and inventory are always saved together.
export const methods = ['GET'];

export default async function adminProducts(req, res) {
  const { limit, offset } = pageParams(req.query, { defaultLimit: 200, maxLimit: 500 });
  const r = await db.query(
    `SELECT p.id, p.name, p.slug, p.price_inr, p.badge, p.is_active, c.name AS category,
            COALESCE((SELECT sum(v.stock_quantity) FROM product_variants v WHERE v.product_id = p.id AND v.is_active), 0)::int AS available_units
       FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ products: r.rows });
}
