import { db } from '../../lib/db.js';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const isTopSpending = req.query.sort === 'top_spending' || req.query.top_spending === 'true';
  const r = await db.query(
    `SELECT cp.id, cp.auth_user_id, cp.full_name, cp.phone, cp.email, cp.created_at,
            COALESCE(m.status, 'inactive') AS membership_status,
            COALESCE(m.credits_balance, 0) AS credits,
            COALESCE(orders_summary.order_count, 0)::int AS order_count,
            COALESCE(orders_summary.total_spent, 0)::numeric(12,2) AS total_spent
       FROM customer_profiles cp
       LEFT JOIN memberships m ON m.auth_user_id = cp.auth_user_id
       LEFT JOIN (
         SELECT auth_user_id,
                count(*)::int AS order_count,
                COALESCE(SUM(total), 0)::numeric(12,2) AS total_spent
           FROM orders
          WHERE payment_status = 'paid'
          GROUP BY auth_user_id
       ) orders_summary ON orders_summary.auth_user_id = cp.auth_user_id
      ORDER BY ${isTopSpending ? 'COALESCE(orders_summary.total_spent, 0) DESC, ' : ''}cp.created_at DESC
      LIMIT 200`
  );
  res.json({ customers: r.rows });
}
