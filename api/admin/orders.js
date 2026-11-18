import { db } from '../../lib/db.js';
import { pageParams } from '../../lib/validate.js';

export const access = 'admin';
// Read-only. Order status changes go through /api/admin/ops?section=order, which enforces
// fulfilment transitions and never alters payment status implicitly.
export const methods = ['GET'];

export default async function adminOrders(req, res) {
  const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
  const r = await db.query(
    `SELECT o.id, o.order_number, o.auth_user_id, o.status, o.payment_status, o.total, o.created_at,
            COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'qty', i.quantity)) FROM order_items i WHERE i.order_id = o.id), '[]') AS items
       FROM orders o ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ orders: r.rows });
}
