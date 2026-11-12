// EXPLAIN ANALYZE for the main read paths against the local load-test database (see scripts/load-test.js).
// Run: NODE_ENV=test node scripts/explain-queries.js
import pg from 'pg';
import { VARIANT_SUMMARY_SQL, dropVisibleSql } from '../lib/catalogue.js';

const c = new pg.Client({ connectionString: process.env.LOADTEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55432/vishrea_load' });
await c.connect();
const show = async (label, sql, params = []) => {
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const p = r.rows[0]['QUERY PLAN'][0];
  const nodes = [];
  (function walk(n) {
    if (n['Index Name'] || n['Relation Name']) nodes.push(`${n['Node Type']}:${n['Index Name'] || n['Relation Name']}`);
    (n.Plans || []).forEach(walk);
  })(p.Plan);
  console.log(label.padEnd(32), `exec ${p['Execution Time'].toFixed(2)} ms`.padEnd(16), [...new Set(nodes)].join(', '));
};
const where = ['p.is_active = true', 'p.archived_at IS NULL', dropVisibleSql('p', { member: false, earlyHours: 48 })].join(' AND ');
const list = (extra, order) =>
  `SELECT p.id, p.name, c.name AS category, vs.*, count(*) OVER () AS total_count FROM products p LEFT JOIN categories c ON c.id = p.category_id ${VARIANT_SUMMARY_SQL}
    WHERE ${where}${extra} AND vs.variant_count > 0 ORDER BY ${order} LIMIT 24 OFFSET 0`;

await show('catalogue featured (home)', list(' AND p.featured = true', 'p.featured DESC, p.created_at DESC'));
await show('catalogue all, featured sort', list('', 'p.featured DESC, p.created_at DESC'));
await show('catalogue by category', list(" AND (c.slug = 'tops' OR lower(c.name) = 'tops')", 'p.created_at DESC'));
await show('catalogue price_asc + in_stock', list(' AND vs.in_stock = true', 'vs.min_price ASC NULLS LAST, p.created_at DESC'));
await show('catalogue search', list(" AND (lower(p.name) LIKE '%wine%' OR lower(coalesce(p.description,'')) LIKE '%wine%' OR lower(coalesce(p.color,'')) LIKE '%wine%')", 'p.featured DESC, p.created_at DESC'));
await show('product by slug', `SELECT p.*, vs.* FROM products p ${VARIANT_SUMMARY_SQL} WHERE p.slug = 'lt-piece-7' AND p.is_active AND p.archived_at IS NULL LIMIT 1`);
const o = (await c.query('SELECT order_id FROM inventory_reservations ORDER BY created_at DESC LIMIT 1')).rows[0];
await show('reservations by order', "SELECT * FROM inventory_reservations WHERE order_id = $1 AND status = 'held'", [o.order_id]);
await show('customer order list', "SELECT o.id FROM orders o WHERE o.auth_user_id = 'usr_lt_1' ORDER BY o.created_at DESC LIMIT 20");
await show('session lookup', "SELECT auth_user_id FROM profiles WHERE auth_user_id = 'usr_lt_1' LIMIT 1");
await show('expiry sweep', "SELECT id FROM orders WHERE payment_status = 'pending' AND payment_expires_at < now() ORDER BY payment_expires_at LIMIT 50");
console.log('rows', JSON.stringify((await c.query('SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM inventory_reservations) AS reservations, (SELECT count(*) FROM profiles) AS profiles')).rows[0]));
await c.end();

