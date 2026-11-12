import { db } from '../../lib/db.js';

export const access = 'admin';
export const methods = ['GET'];

export default async function adminDashboard(req, res) {
  const [p, o, c, m, e] = await Promise.all([
    db.query('SELECT count(*)::int AS n FROM products WHERE is_active = true AND archived_at IS NULL'),
    db.query("SELECT count(*)::int AS n FROM orders WHERE created_at >= now() - interval '30 days' AND payment_status = 'paid'"),
    db.query('SELECT count(*)::int AS n FROM customer_profiles'),
    db.query("SELECT count(*)::int AS n FROM memberships WHERE status = 'active'"),
    db.query("SELECT count(*)::int AS n FROM exchanges WHERE status = 'requested'"),
  ]);
  res.json({ products: p.rows[0].n, orders_30d: o.rows[0].n, customers: c.rows[0].n, active_memberships: m.rows[0].n, pending_exchanges: e.rows[0].n });
}
