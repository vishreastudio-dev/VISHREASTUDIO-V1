import { db } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/http.js';
import { customerVideoLimits, getSettings } from '../../lib/settings.js';
import { pruneRewardReference, saveSettings, setProductRewardEligible, settingsView } from '../../lib/settings-admin.js';
import { addAdmin, listAdmins, removeAdmin, updateAdmin } from '../../lib/admins.js';
import { reconcileExpiredCredits } from '../../lib/credits.js';
import { calculateCartPrice } from '../../lib/pricing.js';
import { expireOrder, releaseReservations, releaseRewards, reverseCredits, syncProductInventory, takeStock } from '../../lib/inventory.js';
import { createOrderInvoice } from '../../lib/payments.js';
import { deleteOrArchiveProduct, getProductWithVariants, saveProduct } from '../../lib/products-admin.js';
import { GIFT_ENQUIRY_FLOW, issueGiftToken } from '../../lib/gifts.js';
import { resetConsecutiveMonths, voidFuturePeriods } from '../../lib/membership.js';
import { displayUrl, mediaInfo, safeDelete } from '../../lib/storage.js';
import { notify, sendDispatchNotification } from '../../lib/notify.js';
import { config } from '../../lib/config.js';
import { log } from '../../lib/log.js';
import { buildTrackingUrl, deleteCourier, listCouriers, orderCourier, resolveCourier, saveCourier, setCourierActive, trackingNumber } from '../../lib/couriers.js';
import { nextHumanId, ID_PREFIXES } from '../../lib/id-generator.js';
import { bool, email as validEmail, gstin, indianState, int, isSlug, mediaUrl, money, oneOf, pageParams, slugify, text, uuid } from '../../lib/validate.js';
import {
  suggestBatchId,
  calculateCostPerUnit,
  calculateStockLeft,
  calculateStockValue,
  classifyInventory,
  calculateSaleTotals,
  calculateCustomerLoyalty,
  calculatePurchaseOrderTotals,
  calculateRetentionRate,
} from '../../lib/business-calculations.js';

export const access = 'admin';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 240 };

const ORDER_STATUSES = ['pending_payment', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'refund_required', 'refunded'];
const FULFILMENT_FLOW = { processing: ['packed', 'dispatched', 'cancelled'], packed: ['dispatched', 'processing', 'cancelled'], dispatched: ['delivered'], delivered: [], pending_payment: ['cancelled'] };
const EXCHANGE_STATUSES = ['requested', 'review', 'approved', 'not_approved', 'rejected', 'completed'];
const EXCHANGE_FLOW = {
  requested: ['review', 'approved', 'not_approved', 'rejected'],
  review: ['approved', 'not_approved', 'rejected'],
  approved: ['not_approved', 'completed', 'review', 'rejected'],
  not_approved: ['approved', 'review', 'rejected', 'completed'],
  rejected: ['review', 'approved', 'not_approved'],
  completed: ['approved', 'not_approved'],
};

const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

async function dashboard(query = {}) {
  // Range is [from, to] inclusive of whole days; defaults to the current month.
  const from = isoDate(query.from);
  const to = isoDate(query.to);
  if (from && to && from > to) throw badRequest('invalid_range', 'The start date must be before the end date');
  const range = [from, to];
  const inRange = (col) => `${col} >= COALESCE($1::date, date_trunc('month', now())::date) AND ${col} < COALESCE($2::date + 1, now() + interval '1 day')`;
  const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows).catch((err) => { log.warn('dashboard_query_warn', { message: err.message }); return []; });
  const [
    [sales],
    [orders],
    [allTimeSales],
    [todaySales],
    [profitRow],
    [membershipSales],
    [products],
    [customers],
    [newCustMonth],
    [repeatCust],
    [members],
    [credits],
    [exchanges],
    stockAge,
    gaps,
    [failed],
    [refunds],
    [gifts],
    [expiring],
    revenueHistory,
    bestCategories,
    [stockValRow],
    [lowStockRow],
    [fastMovingRow],
    [deadStockRow],
    [poMetrics],
    [vendorMetrics],
    [topVendorProd]
  ] = await Promise.all([
    q(`SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE payment_status='paid' AND ${inRange('paid_at')}`, range),
    q(`SELECT count(*)::int AS n FROM orders WHERE payment_status = 'paid' AND ${inRange('paid_at')}`, range),
    q("SELECT COALESCE(SUM(total),0) AS revenue, count(*)::int AS n FROM orders WHERE payment_status = 'paid'"),
    q("SELECT COALESCE(SUM(total),0) AS revenue, count(*)::int AS n FROM orders WHERE payment_status = 'paid' AND paid_at >= current_date"),
    q("SELECT COALESCE(SUM(total - COALESCE(estimated_cost, 0)), 0) AS profit FROM orders WHERE payment_status = 'paid'"),
    q(`SELECT COALESCE(SUM(amount),0) AS revenue, count(*)::int AS n FROM membership_payments WHERE status = 'paid' AND ${inRange('paid_at')}`, range),
    q('SELECT count(*)::int AS n FROM products WHERE is_active = true AND archived_at IS NULL'),
    q('SELECT count(*)::int AS n FROM customer_profiles'),
    q("SELECT count(*)::int AS n FROM customer_profiles WHERE created_at >= date_trunc('month', now())"),
    q("SELECT count(*)::int AS n FROM (SELECT auth_user_id FROM orders WHERE payment_status = 'paid' AND auth_user_id IS NOT NULL GROUP BY auth_user_id HAVING count(*) >= 2) t"),
    q("SELECT count(*)::int AS n FROM memberships WHERE status = 'active'"),
    q("SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0)::int AS issued, COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0)::int AS used FROM credit_ledger WHERE created_at >= date_trunc('month', now())"),
    q("SELECT count(*)::int AS n FROM exchanges WHERE status IN ('requested','review')"),
    q("SELECT CASE WHEN i.updated_at < now()-interval '21 days' THEN '21+' WHEN i.updated_at < now()-interval '14 days' THEN '14-20' WHEN i.updated_at < now()-interval '7 days' THEN '7-13' ELSE '0-6' END AS age, count(*)::int AS count FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.status = 'available' AND p.is_active GROUP BY 1 ORDER BY 1"),
    q("SELECT v.size_label, p.colour_season, sum(v.stock_quantity)::int AS stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_active AND v.is_active GROUP BY v.size_label, p.colour_season ORDER BY stock ASC LIMIT 12"),
    q("SELECT count(*)::int AS n FROM membership_payments WHERE status = 'failed' AND attempted_at >= now() - interval '7 days'"),
    q("SELECT count(*)::int AS n FROM orders WHERE payment_status = 'refund_required'"),
    q("SELECT count(*)::int AS n FROM admin_gift_enquiries WHERE status = 'pending'"),
    q("SELECT count(*)::int AS n FROM memberships WHERE status IN ('active','paused') AND paid_through < now() + interval '7 days'"),
    q("SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month_key, to_char(date_trunc('month', paid_at), 'Mon YYYY') AS label, COALESCE(SUM(total), 0)::numeric(12,2) AS revenue, count(*)::int AS orders FROM orders WHERE payment_status = 'paid' AND paid_at >= date_trunc('month', now() - interval '5 months') GROUP BY 1, 2 ORDER BY 1 ASC"),
    q("SELECT COALESCE(c.name, 'Unassigned') AS name, sum(oi.quantity)::int AS units, COALESCE(sum(oi.quantity * oi.unit_price), 0)::numeric(12,2) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE o.payment_status = 'paid' GROUP BY 1 ORDER BY units DESC LIMIT 5"),
    q("SELECT COALESCE(SUM(v.stock_quantity * COALESCE(p.cost_price_inr, 0)), 0)::numeric(12,2) AS val FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active AND p.is_active"),
    q("SELECT count(*)::int AS n FROM (SELECT p.id, sum(v.stock_quantity) as total_stock, p.low_stock_threshold FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.is_active GROUP BY p.id, p.low_stock_threshold HAVING sum(v.stock_quantity) <= COALESCE(p.low_stock_threshold, 2)) t"),
    q("SELECT count(*)::int AS n FROM (SELECT p.id, p.purchase_quantity, COALESCE(sum(oi.quantity), 0) AS sold FROM products p JOIN order_items oi ON oi.product_id = p.id JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'paid' AND p.purchase_quantity > 0 GROUP BY p.id, p.purchase_quantity HAVING sum(oi.quantity) > (p.purchase_quantity * 0.5)) t"),
    q("SELECT count(*)::int AS n FROM products p WHERE p.purchase_quantity > 0 AND p.is_active AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid')"),
    q("SELECT count(*)::int AS total_pos, count(*) FILTER (WHERE status = 'unfulfilled')::int AS pending_pos, count(*) FILTER (WHERE status = 'fulfilled')::int AS fulfilled_pos, COALESCE(SUM(grand_total), 0)::numeric(12,2) AS total_val FROM purchase_orders"),
    q("SELECT count(*)::int AS total_vendors, count(*) FILTER (WHERE is_active = true)::int AS active_vendors FROM vendors"),
    q("SELECT oi.product_name, sum(oi.quantity)::int as units FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'paid' GROUP BY oi.product_name ORDER BY units DESC LIMIT 1"),
  ]);

  const eligibleOrders = Number(orders?.n || 0);
  const aov = eligibleOrders > 0 ? Math.round((Number(sales?.revenue || 0) / eligibleOrders) * 100) / 100 : 0;
  const purchasingCustRow = await q("SELECT count(DISTINCT auth_user_id)::int AS n FROM orders WHERE payment_status = 'paid'");
  const totalPurchasingCustomers = Number(purchasingCustRow[0]?.n || 0);
  const retentionRate = calculateRetentionRate(Number(repeatCust?.n || 0), totalPurchasingCustomers);

  const recentOrders = await q(
    `SELECT o.id, o.created_at, o.total, o.payment_status, o.status, o.channel,
            COALESCE(cp.full_name, 'Client') AS customer_name,
            COALESCE((SELECT c.name FROM order_items oi JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE oi.order_id = o.id LIMIT 1), 'Apparel') AS category,
            COALESCE((SELECT sum(quantity) FROM order_items WHERE order_id = o.id), 1)::int AS items_count
       FROM orders o
       LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id
      ORDER BY o.created_at DESC
      LIMIT 8`
  );

  return {
    range: { from: from || null, to: to || null },
    revenue: Number(sales?.revenue || 0),
    orders: Number(orders?.n || 0),
    all_time_revenue: Number(allTimeSales?.revenue || 0),
    all_time_orders: Number(allTimeSales?.n || 0),
    today_revenue: Number(todaySales?.revenue || 0),
    today_orders: Number(todaySales?.n || 0),
    aov,
    estimated_profit: Number(profitRow?.profit || 0),
    membership_revenue: Number(membershipSales?.revenue || 0),
    membership_payments: Number(membershipSales?.n || 0),
    total_revenue: Number(sales?.revenue || 0) + Number(membershipSales?.revenue || 0),
    products: Number(products?.n || 0),
    customers: Number(customers?.n || 0),
    new_customers_month: Number(newCustMonth?.n || 0),
    repeat_customers: Number(repeatCust?.n || 0),
    retention_rate: retentionRate,
    members: Number(members?.n || 0),
    credits_issued: credits?.issued || 0,
    credits_used: credits?.used || 0,
    exchanges: exchanges?.n || 0,
    failed_payments: failed?.n || 0,
    refunds_required: refunds?.n || 0,
    pending_gift_enquiries: gifts?.n || 0,
    memberships_ending_soon: expiring?.n || 0,
    stock_age: stockAge || [],
    gaps: gaps || [],
    revenue_history: revenueHistory || [],
    six_month_revenue: (revenueHistory || []).map((r) => ({
      month: r.label || r.month_key,
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
    })),
    best_categories: bestCategories || [],
    best_selling_categories: (bestCategories || []).map((c) => ({
      category: c.name,
      units: Number(c.units || 0),
      revenue: Number(c.revenue || 0),
    })),
    recent_orders: recentOrders || [],
    stock_value: Number(stockValRow?.val || 0),
    low_stock_count: Number(lowStockRow?.n || 0),
    fast_moving_count: Number(fastMovingRow?.n || 0),
    dead_stock_count: Number(deadStockRow?.n || 0),
    total_pos: Number(poMetrics?.total_pos || 0),
    pending_pos: Number(poMetrics?.pending_pos || 0),
    fulfilled_pos: Number(poMetrics?.fulfilled_pos || 0),
    total_po_value: Number(poMetrics?.total_val || 0),
    total_vendors: Number(vendorMetrics?.total_vendors || 0),
    active_vendors: Number(vendorMetrics?.active_vendors || 0),
    top_selling_product: topVendorProd?.product_name || '—',
  };
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return `"${s.replaceAll('"', '""')}"`;
};

async function exportCsv(type, res) {
  const queries = {
    customers: 'SELECT customer_code, auth_user_id, full_name, email, phone, gst_number, marketing_opt_in, whatsapp_opt_in, created_at FROM customer_profiles ORDER BY created_at DESC LIMIT 20000',
    products: `SELECT p.product_code, p.name, p.slug, c.name AS category, v.sku, v.size_label, v.price_inr, v.sale_price_inr, v.stock_quantity, v.is_active AS variant_active, p.is_active
                 FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN product_variants v ON v.product_id = p.id ORDER BY p.created_at DESC LIMIT 20000`,
    invoices: 'SELECT invoice_number, order_id, membership_payment_id, taxable_value, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount, place_of_supply, buyer_gstin, issued_at FROM invoice_records ORDER BY issued_at DESC LIMIT 20000',
    orders: `SELECT o.order_number, o.id, o.created_at, o.status, o.payment_status, o.subtotal, o.shipping_fee, o.total, o.tax_amount, o.invoice_number, o.channel, o.shipping_method,
                    o.tracking_number, o.razorpay_payment_id, cp.full_name, cp.email
               FROM orders o LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id ORDER BY o.created_at DESC LIMIT 20000`,
    membership_payments: `SELECT mp.paid_at, mp.attempted_at, mp.status, mp.charge_kind, mp.kind, mp.months, mp.list_amount, mp.discount_amount, mp.amount,
                                 mp.provider_payment_id, mp.provider_subscription_id, mp.razorpay_invoice_id, mp.refunded_at, ir.invoice_number, ir.taxable_value, ir.gst_amount,
                                 p.email
                            FROM membership_payments mp LEFT JOIN invoice_records ir ON ir.membership_payment_id = mp.id LEFT JOIN profiles p ON p.auth_user_id = mp.auth_user_id
                           WHERE mp.status <> 'pending' ORDER BY mp.attempted_at DESC LIMIT 20000`,
    payment_attempts: `SELECT a.created_at, a.outcome, a.amount, a.attempt_no, a.failure_reason, a.provider_payment_id, a.razorpay_subscription_id, p.email
                         FROM membership_payment_attempts a LEFT JOIN profiles p ON p.auth_user_id = a.auth_user_id ORDER BY a.created_at DESC LIMIT 20000`,
    bag_shipments: 'SELECT id, created_at, paid_at, status, shipping_method, pieces, shipping_fee, provider_payment_id, refund_status, refunded_amount_paise, refunded_at FROM bag_shipments ORDER BY created_at DESC LIMIT 20000',
  };
  const r = await db.query(queries[type] || queries.orders);
  const cols = r.fields.map((f) => f.name);
  const csv = [cols.join(','), ...r.rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=vishrea-${queries[type] ? type : 'orders'}.csv`);
  return res.send(csv);
}

async function handleGet(req, res) {
  const q = { ...(req.query || {}) };
  let section = q.section || 'dashboard';
  if (typeof section === 'string' && (section.includes('?') || section.includes('&'))) {
    const parts = section.split(/[?&]/);
    section = parts[0];
    q.section = section;
    for (let i = 1; i < parts.length; i++) {
      const pair = parts[i];
      if (!pair) continue;
      const [k, v] = pair.split('=');
      if (k && q[decodeURIComponent(k)] === undefined) {
        q[decodeURIComponent(k)] = v !== undefined ? decodeURIComponent(v) : '';
      }
    }
  }
  const { limit, offset } = pageParams(q, { defaultLimit: 200, maxLimit: 500 });
  const rows = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

  switch (section) {
    case 'dashboard':
      return res.json(await dashboard(q));
    case 'settings':
      return res.json(await settingsView(db));
    case 'products': {
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      return res.json({
        products: await rows(
          `SELECT p.id, p.product_code, p.name, p.slug, p.price_inr, p.cost_price_inr, p.badge, p.is_active, p.archived_at, p.featured, p.is_one_of_one, p.image_url, p.images,
                  p.color, p.colour_season, p.size_label, p.category_id, p.credit_eligible, p.drop_id, c.name AS category, p.created_at,
                  p.batch_id, p.purchase_date, p.purchase_quantity, p.purchase_price_per_piece, p.courier_charge, p.low_stock_threshold, p.supplier_name, p.vendor_id,
                  COALESCE(vnd.name, p.supplier_name) AS vendor_name,
                  COALESCE(vs.variants, '[]') AS variants, COALESCE(vs.stock, 0)::int AS stock_total, vs.min_price, vs.max_price,
                  COALESCE(sold_sub.units_sold, 0)::int AS units_sold,
                  ROUND(COALESCE(vs.stock, 0) * COALESCE(p.cost_price_inr, 0), 2) AS remaining_stock_value,
                  ROUND(COALESCE(p.purchase_quantity, COALESCE(vs.stock, 0)) * COALESCE(p.cost_price_inr, 0), 2) AS inventory_value
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN vendors vnd ON vnd.id = p.vendor_id
             LEFT JOIN LATERAL (
               SELECT sum(oi.quantity)::int AS units_sold
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND o.payment_status = 'paid'
             ) sold_sub ON true
             LEFT JOIN LATERAL (
               SELECT json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_label', v.size_label, 'price_inr', v.price_inr, 'sale_price_inr', v.sale_price_inr,
                                                 'stock_quantity', v.stock_quantity, 'is_active', v.is_active) ORDER BY v.sort_order, v.created_at) AS variants,
                      sum(v.stock_quantity) FILTER (WHERE v.is_active) AS stock, min(v.price_inr) FILTER (WHERE v.is_active) AS min_price, max(v.price_inr) FILTER (WHERE v.is_active) AS max_price
                 FROM product_variants v WHERE v.product_id = p.id) vs ON true
            WHERE ($1 = '' OR lower(p.name) LIKE '%' || $1 || '%' OR lower(COALESCE(p.product_code, '')) LIKE '%' || $1 || '%' OR lower(COALESCE(p.batch_id, '')) LIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND lower(sv.sku) LIKE '%' || $1 || '%'))
              AND ($4::boolean OR p.archived_at IS NULL)
              AND ($5::uuid IS NULL OR p.category_id = $5)
              AND ($6 = '' OR ($6 = 'live' AND p.is_active AND p.archived_at IS NULL) OR ($6 = 'hidden' AND NOT p.is_active AND p.archived_at IS NULL)
                   OR ($6 = 'out_of_stock' AND COALESCE(vs.stock, 0) = 0) OR ($6 = 'low_stock' AND COALESCE(vs.stock, 0) <= COALESCE(p.low_stock_threshold, 2)))
            ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
          [search, limit, offset, bool(q.include_archived), q.category_id ? uuid(q.category_id, 'category_id') : null, oneOf(q.state || '', ['', 'live', 'hidden', 'out_of_stock', 'low_stock'], { field: 'state' })]
        ),
        drops: await rows('SELECT id, name, starts_at, public_at FROM drop_settings WHERE active ORDER BY starts_at DESC LIMIT 50'),
      });
    }
    case 'product':
      return res.json({ product: await getProductWithVariants(db, uuid(q.id)) });
    case 'categories':
      return res.json({ categories: await rows('SELECT id, category_code, name, slug, is_active, sort_order, parent_id FROM categories ORDER BY sort_order, name') });
    case 'orders': {
      // Abandoned checkouts (never paid, then expired or cancelled) are hidden unless asked for.
      const showAbandoned = bool(q.abandoned) || ['expired', 'cancelled'].includes(q.payment_status) || ['expired', 'cancelled'].includes(q.status);
      const abandoned = "(o.paid_at IS NULL AND o.payment_status IN ('expired', 'cancelled'))";
      return res.json({
        abandoned_hidden: showAbandoned ? 0 : (await rows(`SELECT count(*)::int AS n FROM orders o WHERE ${abandoned}`))[0].n,
        orders: await rows(
          `SELECT o.id, o.order_number, o.auth_user_id, o.status, o.payment_status, o.total, o.tax_amount, o.channel, o.shipping_method, o.tracking_number, o.courier_partner, o.courier_id, o.tracking_url, o.invoice_number,
                  o.created_at, o.paid_at, o.payment_failure_reason, cp.customer_code, cp.full_name, cp.email,
                  COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'sku', i.sku, 'qty', i.quantity, 'image_url', p.image_url, 'images', p.images))
                              FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id), '[]') AS items
             FROM orders o LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id
            WHERE ($1 = '' OR o.payment_status = $1) AND ($4 = '' OR o.status = $4) AND ($6::boolean OR NOT ${abandoned})
              AND ($5 = '' OR o.id::text LIKE $5 || '%' OR lower(COALESCE(o.order_number, '')) LIKE '%' || $5 || '%' OR lower(COALESCE(cp.email, '')) LIKE '%' || $5 || '%' OR lower(COALESCE(cp.full_name, '')) LIKE '%' || $5 || '%'
                   OR lower(COALESCE(o.invoice_number, '')) LIKE '%' || $5 || '%' OR lower(COALESCE(o.tracking_number, '')) LIKE '%' || $5 || '%')
            ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
          [
            oneOf(q.payment_status || '', ['', 'pending', 'paid', 'failed', 'refund_required', 'refunded', 'cancelled', 'expired'], { field: 'payment_status' }),
            limit,
            offset,
            oneOf(q.status || '', ['', ...ORDER_STATUSES, 'expired'], { field: 'status' }),
            String(q.q || '').trim().toLowerCase().slice(0, 80),
            showAbandoned,
          ]
        ),
      });
    }
    case 'customers': {
      const minSpent = Math.max(0, Number(q.min_spent) || 0);
      const sort = String(q.sort || '').toLowerCase();
      const isTopSpending = sort === 'top_spending' || sort === 'spent_desc' || q.top_spending === 'true';
      return res.json({
        customers: await rows(
          `SELECT cp.customer_code, cp.auth_user_id, cp.full_name, cp.email, cp.phone, cp.marketing_opt_in, cp.created_at,
                  m.status AS membership_status, m.credits_balance,
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
            WHERE ($3 = '' OR lower(COALESCE(cp.full_name, '')) LIKE '%' || $3 || '%' OR lower(COALESCE(cp.customer_code, '')) LIKE '%' || $3 || '%' OR lower(COALESCE(cp.email, '')) LIKE '%' || $3 || '%'
                   OR regexp_replace(COALESCE(cp.phone, ''), '\\D', '', 'g') LIKE '%' || NULLIF(regexp_replace($3, '\\D', '', 'g'), '') || '%')
              AND ($4 = '' OR ($4 = 'none' AND m.id IS NULL) OR m.status = $4)
              AND ($5::numeric = 0 OR COALESCE(orders_summary.total_spent, 0) >= $5::numeric)
            ORDER BY ${isTopSpending ? 'COALESCE(orders_summary.total_spent, 0) DESC, ' : ''}cp.created_at DESC
            LIMIT $1 OFFSET $2`,
          [
            limit,
            offset,
            String(q.q || '').trim().toLowerCase().slice(0, 80),
            oneOf(q.membership || '', ['', 'none', 'active', 'paused', 'expired', 'cancelled', 'pending_payment', 'payment_failed', 'inactive'], { field: 'membership' }),
            minSpent,
          ]
        ),
      });
    }
    case 'memberships':
      return res.json({ memberships: await rows('SELECT m.*, cp.customer_code, cp.full_name, cp.email FROM memberships m LEFT JOIN customer_profiles cp ON cp.auth_user_id = m.auth_user_id ORDER BY m.updated_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
    case 'credits':
      return res.json({ credits: await rows('SELECT cl.*, cp.customer_code, cp.full_name, cp.email FROM credit_ledger cl LEFT JOIN customer_profiles cp ON cp.auth_user_id = cl.auth_user_id ORDER BY cl.created_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
    case 'exchanges': {
      const list = await rows('SELECT e.*, o.order_number, o.total, o.delivered_at, cp.customer_code, cp.full_name, cp.email FROM exchanges e JOIN orders o ON o.id = e.order_id LEFT JOIN customer_profiles cp ON cp.auth_user_id = e.auth_user_id ORDER BY e.created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
      // Evidence is private: staff get short-lived signed links, generated per request and never cached.
      for (const e of list) {
        const refs = Array.isArray(e.evidence_urls) ? e.evidence_urls : [];
        e.evidence = await Promise.all(refs.map(async (ref) => ({ ref, url: await displayUrl(ref) })));
      }
      return res.json({ exchanges: list });
    }
    case 'loyalty': {
      const [rules, events, offers] = await Promise.all([
        rows('SELECT * FROM loyalty_rules ORDER BY created_at DESC LIMIT 200'),
        rows('SELECT le.*, lr.name AS rule_name FROM loyalty_events le LEFT JOIN loyalty_rules lr ON lr.id = le.rule_id ORDER BY le.created_at DESC LIMIT 100'),
        rows('SELECT * FROM offers ORDER BY created_at DESC LIMIT 50'),
      ]);
      return res.json({ rules, events, offers });
    }
    case 'drops':
      return res.json({ drops: await rows('SELECT * FROM drop_settings ORDER BY starts_at DESC LIMIT 200') });
    case 'sourcing':
      return res.json({ batches: await rows('SELECT * FROM sourcing_batches ORDER BY batch_date DESC, created_at DESC LIMIT 200') });
    case 'vendors': {
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      const list = await rows(
        `SELECT v.*,
                COALESCE(po_sub.pos_served, 0)::int AS pos_served,
                COALESCE(po_sub.total_purchases, 0)::numeric(12,2) AS total_purchases,
                COALESCE(prof_sub.sales_profit, 0)::numeric(12,2) AS sales_profit,
                COALESCE(top_sub.top_product, '—') AS top_product
           FROM vendors v
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS pos_served, sum(grand_total) AS total_purchases
               FROM purchase_orders po WHERE po.vendor_id = v.id
           ) po_sub ON true
           LEFT JOIN LATERAL (
             SELECT sum(oi.quantity * (oi.unit_price - COALESCE(p.cost_price_inr, 0))) AS sales_profit
               FROM products p
               JOIN order_items oi ON oi.product_id = p.id
               JOIN orders o ON o.id = oi.order_id
              WHERE p.vendor_id = v.id AND o.payment_status = 'paid'
           ) prof_sub ON true
           LEFT JOIN LATERAL (
             SELECT oi.product_name AS top_product
               FROM products p
               JOIN order_items oi ON oi.product_id = p.id
               JOIN orders o ON o.id = oi.order_id
              WHERE p.vendor_id = v.id AND o.payment_status = 'paid'
              GROUP BY oi.product_name
              ORDER BY sum(oi.quantity) DESC
              LIMIT 1
           ) top_sub ON true
          WHERE ($1 = '' OR lower(v.name) LIKE '%' || $1 || '%' OR lower(COALESCE(v.contact_phone, '')) LIKE '%' || $1 || '%')
          ORDER BY v.created_at DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset]
      );
      return res.json({ vendors: list });
    }
    case 'vendor': {
      const v = (await rows('SELECT * FROM vendors WHERE id = $1', [uuid(q.id)]))[0];
      if (!v) throw notFound('vendor_not_found', 'Vendor not found');
      return res.json({ vendor: v });
    }
    case 'procurement':
    case 'purchase_orders': {
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      const statusFilter = q.status && ['unfulfilled', 'fulfilled', 'cancelled'].includes(q.status) ? q.status : null;
      const list = await rows(
        `SELECT po.*,
                COALESCE((SELECT json_agg(json_build_object('id', poi.id, 'item_name', poi.item_name, 'category', poi.category, 'quantity', poi.quantity, 'unit_cost', poi.unit_cost, 'line_total', poi.line_total))
                            FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id), '[]') AS items
           FROM purchase_orders po
          WHERE ($1 = '' OR lower(po.po_number) LIKE '%' || $1 || '%' OR lower(po.vendor_name) LIKE '%' || $1 || '%' OR lower(po.batch_id) LIKE '%' || $1 || '%')
            AND ($4::text IS NULL OR po.status = $4)
          ORDER BY po.order_date DESC, po.created_at DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset, statusFilter]
      );
      const vendorList = await rows('SELECT id, name, COALESCE(code, vendor_code) AS code, COALESCE(vendor_code, code) AS vendor_code, COALESCE(contact_person, contact_name) AS contact_person, COALESCE(contact_name, contact_person) AS contact_name, COALESCE(phone, contact_phone) AS phone, categories FROM vendors WHERE is_active = true ORDER BY name ASC');
      return res.json({ purchase_orders: list, vendors: vendorList });
    }
    case 'purchase_order': {
      const po = (await rows('SELECT * FROM purchase_orders WHERE id = $1', [uuid(q.id)]))[0];
      if (!po) throw notFound('po_not_found', 'Purchase order not found');
      const items = await rows('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY created_at ASC', [po.id]);
      return res.json({ purchase_order: { ...po, items } });
    }
    case 'sales': {
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      const statusFilter = q.status && ['paid', 'partially_paid', 'due', 'cancelled'].includes(q.status) ? q.status : null;
      const list = await rows(
        `SELECT o.id, o.order_number, o.sale_date, o.customer_id, o.customer_name, o.customer_phone, o.channel,
                o.subtotal, o.discount_amount, o.total, o.amount_paid, o.amount_due, o.payment_status,
                o.status, o.estimated_cost, o.estimated_profit, o.invoice_number, o.created_at,
                COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'quantity', i.quantity, 'unit_price', i.unit_price))
                            FROM order_items i WHERE i.order_id = o.id), '[]') AS items
           FROM orders o
          WHERE (o.channel = 'studio' OR o.channel = 'pos' OR o.customer_name IS NOT NULL)
            AND ($1 = '' OR lower(COALESCE(o.customer_name, '')) LIKE '%' || $1 || '%' OR lower(COALESCE(o.customer_phone, '')) LIKE '%' || $1 || '%' OR lower(o.id::text) LIKE '%' || $1 || '%' OR lower(COALESCE(o.order_number, '')) LIKE '%' || $1 || '%')
            AND ($4::text IS NULL OR o.payment_status = $4)
          ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset, statusFilter]
      );
      return res.json({ sales: list });
    }
    case 'content': {
      const [i, v, s, l, settings] = await Promise.all([
        rows('SELECT * FROM instagram_content ORDER BY sort_order, created_at DESC'),
        rows('SELECT * FROM feedback_videos ORDER BY sort_order, created_at DESC'),
        rows('SELECT * FROM store_settings ORDER BY updated_at DESC'),
        rows('SELECT slug, title, updated_at FROM legal_pages ORDER BY slug'),
        getSettings(),
      ]);
      return res.json({ instagram: i, videos: v, store: s, legal: l, limits: customerVideoLimits(settings) });
    }
    case 'audit': {
      // entity_id is free text; only a well-formed uuid is cast, so the lookups can use primary keys.
      const eid = "(CASE WHEN a.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.entity_id::uuid END)";
      return res.json({
        logs: await rows(
          `SELECT a.*, ap.full_name AS actor_name, ap.email AS actor_email, (ap.is_admin OR ap.role IN ('admin','owner')) AS actor_is_admin,
                  CASE a.entity_type
                    WHEN 'order' THEN (SELECT COALESCE(NULLIF(cp.full_name, ''), cp.email) FROM orders o LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id WHERE o.id = ${eid})
                    WHEN 'membership' THEN (SELECT COALESCE(NULLIF(mp.full_name, ''), mp.email) FROM memberships m JOIN profiles mp ON mp.auth_user_id = m.auth_user_id WHERE m.id = ${eid})
                    WHEN 'product' THEN (SELECT name FROM products WHERE id = ${eid})
                    WHEN 'product_variant' THEN (SELECT p.name || ' · ' || v.size_label FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${eid})
                    WHEN 'category' THEN (SELECT name FROM categories WHERE id = ${eid} OR slug = a.entity_id LIMIT 1)
                    WHEN 'courier' THEN (SELECT name FROM couriers WHERE id = ${eid})
                    WHEN 'profile' THEN (SELECT COALESCE(NULLIF(pp.full_name, ''), pp.email) FROM profiles pp WHERE pp.auth_user_id = a.entity_id)
                  END AS entity_label
             FROM audit_logs a LEFT JOIN profiles ap ON ap.auth_user_id = a.auth_user_id
            ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
      });
    }
    case 'admins':
      return res.json(await listAdmins(db, req.user.id));
    case 'couriers':
      return res.json({ couriers: await listCouriers(db, { q: q.q, activeOnly: bool(q.active) }) });
    case 'order_shipments':
      return res.json({
        events: await rows(
          'SELECT id, status, courier_id, courier_name, tracking_number, tracking_url, actor, created_at FROM order_shipment_events WHERE order_id = $1 ORDER BY created_at DESC LIMIT 100',
          [uuid(q.id, 'order_id')]
        ),
      });
    case 'customer': {
      const id = text(q.id, { max: 80, field: 'id', required: true });
      const profile = (await rows(
        `SELECT p.auth_user_id, p.email, p.role, p.is_admin, p.is_active, p.created_at, cp.full_name, cp.phone, cp.gst_number, cp.marketing_opt_in, cp.whatsapp_opt_in, cp.referral_code, cp.notes, cp.tags
           FROM profiles p LEFT JOIN customer_profiles cp ON cp.auth_user_id = p.auth_user_id WHERE p.auth_user_id = $1`,
        [id]
      ))[0];
      if (!profile) throw notFound('customer_not_found', 'Customer not found');
      const [membership, wearers, orders, colour, referrals, rewards, credits, periods, sizeProfiles] = await Promise.all([
        rows('SELECT * FROM memberships WHERE auth_user_id = $1', [id]),
        rows('SELECT id, name, relationship, size_label, bust_cm, waist_cm, hip_cm, length_cm, birthday, created_at FROM wearer_profiles WHERE auth_user_id = $1 ORDER BY created_at', [id]),
        rows(`SELECT o.id, o.created_at, o.status, o.payment_status, o.total, o.invoice_number, o.channel, o.credits_used, o.rewards_used, o.discount_amount,
                     COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'qty', i.quantity, 'unit_price', i.unit_price)) FROM order_items i WHERE i.order_id = o.id), '[]') AS items
                FROM orders o WHERE o.auth_user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [id]),
        rows('SELECT undertone, season, palette, confidence, lighting, created_at FROM colour_reviews WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 5', [id]),
        rows(`SELECT r.id, r.status, r.referred_email, r.referrer_user_id, r.referred_user_id, r.attributed_at, r.qualified_at FROM referrals r
               WHERE (r.referrer_user_id = $1 OR r.referred_user_id = $1) AND r.referred_user_id IS NOT NULL ORDER BY r.created_at DESC`, [id]),
        rows('SELECT * FROM reward_entitlements WHERE auth_user_id = $1 ORDER BY created_at DESC', [id]),
        rows('SELECT delta, reason, expires_at, order_id, created_at FROM credit_ledger WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
        rows(`SELECT mp.month_index, mp.streak_month, mp.source, mp.starts_at, mp.ends_at, mp.credits, mp.credits_granted_at, mp.voided_at
                FROM membership_periods mp JOIN memberships m ON m.id = mp.membership_id WHERE m.auth_user_id = $1 ORDER BY mp.starts_at DESC LIMIT 36`, [id]),
        rows('SELECT id, name, relationship, is_primary, size_standard, clothing_size, category_sizes, fit_preference, silhouette_preference, created_at FROM customer_size_profiles WHERE auth_user_id = $1 ORDER BY is_primary DESC, created_at ASC', [id]).catch(() => []),
      ]);

      const paidOrders = orders.filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled');
      const lifetimeSpend = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
      const aov = paidOrders.length ? Math.round((lifetimeSpend / paidOrders.length) * 100) / 100 : 0;
      const lastPurchaseDate = paidOrders.length ? paidOrders[0].created_at : null;
      const loyalty = calculateCustomerLoyalty(paidOrders.length);

      return res.json({
        profile,
        membership: membership[0] || null,
        periods,
        wearers,
        size_profiles: sizeProfiles,
        orders,
        colour_reviews: colour,
        referrals,
        rewards,
        credits,
        stats: {
          lifetime_orders: paidOrders.length,
          lifetime_spend: lifetimeSpend,
          aov,
          last_purchase_date: lastPurchaseDate,
          loyalty,
        },
      });
    }
    case 'gift_enquiries': {
      const status = q.status && q.status !== 'all' ? oneOf(q.status, Object.keys(GIFT_ENQUIRY_FLOW), { field: 'status' }) : null;
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      return res.json({
        enquiries: await rows(
          `SELECT e.*, (SELECT count(*)::int FROM gift_memberships g WHERE g.enquiry_id = e.id AND g.status <> 'revoked') AS tokens_issued,
                  (SELECT count(*)::int FROM gift_memberships g WHERE g.enquiry_id = e.id AND g.status = 'redeemed') AS tokens_redeemed
             FROM admin_gift_enquiries e
            WHERE ($1::text IS NULL OR e.status = $1)
              AND ($2 = '' OR lower(e.enquiry_number) LIKE '%' || $2 || '%' OR lower(e.sender_name) LIKE '%' || $2 || '%' OR lower(e.sender_email) LIKE '%' || $2 || '%'
                   OR lower(coalesce(e.recipient_name,'')) LIKE '%' || $2 || '%' OR lower(coalesce(e.company_name,'')) LIKE '%' || $2 || '%')
            ORDER BY e.created_at DESC LIMIT $3 OFFSET $4`,
          [status, search.replace(/[\\%_]/g, (m) => `\\${m}`), limit, offset]
        ),
      });
    }
    case 'gift_enquiry': {
      const e = (await rows('SELECT * FROM admin_gift_enquiries WHERE id = $1', [uuid(q.id)]))[0];
      if (!e) throw notFound('gift_enquiry_not_found', 'Gift enquiry not found');
      const tokens = await rows(
        `SELECT g.id, g.membership_months, g.token_hint, g.status, g.created_by, g.created_at, g.expires_at, g.redeemed_at, g.revoked_at, p.email AS redeemed_by_email
           FROM gift_memberships g LEFT JOIN profiles p ON p.auth_user_id = g.redeemed_by WHERE g.enquiry_id = $1 ORDER BY g.created_at`,
        [e.id]
      );
      return res.json({ enquiry: e, tokens, next_statuses: GIFT_ENQUIRY_FLOW[e.status] || [] });
    }
    case 'referrals':
      return res.json({
        referrals: await rows(
          `SELECT r.id, r.status, r.referral_code, r.attributed_at, r.qualified_at, r.discount_amount, r.created_at,
                  rp.email AS referrer_email, dp.email AS referred_email, re.id AS reward_id, re.status AS reward_status, re.flag_reason
             FROM referrals r
             LEFT JOIN profiles rp ON rp.auth_user_id = r.referrer_user_id
             LEFT JOIN profiles dp ON dp.auth_user_id = r.referred_user_id
             LEFT JOIN reward_entitlements re ON re.referral_id = r.id AND re.kind = 'referral'
            WHERE r.referred_user_id IS NOT NULL ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
      });
    case 'rewards':
      return res.json({
        rewards: await rows(
          `SELECT re.*, p.email FROM reward_entitlements re LEFT JOIN profiles p ON p.auth_user_id = re.auth_user_id
            ORDER BY (re.flagged_at IS NOT NULL) DESC, re.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
      });
    case 'invoices':
      return res.json({ invoices: await rows('SELECT ir.*, o.auth_user_id, cp.full_name, cp.email FROM invoice_records ir LEFT JOIN orders o ON o.id = ir.order_id LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id ORDER BY ir.issued_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
    case 'store': {
      const search = String(q.q || '').trim().toLowerCase().slice(0, 80);
      const statusFilter = q.status && ['paid', 'partially_paid', 'due', 'cancelled'].includes(q.status) ? q.status : null;
      const salesList = await rows(
        `SELECT o.id, o.sale_date, o.customer_id, o.customer_name, o.customer_phone, o.channel,
                o.subtotal, o.discount_amount, o.total, o.amount_paid, o.amount_due, o.payment_status,
                o.status, o.estimated_cost, o.estimated_profit, o.invoice_number, o.created_at,
                COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'quantity', i.quantity, 'unit_price', i.unit_price))
                            FROM order_items i WHERE i.order_id = o.id), '[]') AS items
           FROM orders o
          WHERE (o.channel = 'studio' OR o.channel = 'pos' OR o.customer_name IS NOT NULL)
            AND ($1 = '' OR lower(COALESCE(o.customer_name, '')) LIKE '%' || $1 || '%' OR lower(COALESCE(o.customer_phone, '')) LIKE '%' || $1 || '%' OR lower(o.id::text) LIKE '%' || $1 || '%')
            AND ($4::text IS NULL OR o.payment_status = $4)
          ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset, statusFilter]
      );
      const activeProducts = await rows(
        `SELECT p.id, p.name, p.cost_price_inr, v.id AS variant_id, v.sku, v.size_label, v.price_inr, v.sale_price_inr, v.stock_quantity
           FROM products p JOIN product_variants v ON v.product_id = p.id
          WHERE p.is_active AND v.is_active AND v.stock_quantity > 0 ORDER BY p.name, v.sort_order LIMIT 1000`
      );
      const custList = await rows(
        `SELECT auth_user_id, full_name, email, phone FROM customer_profiles ORDER BY full_name ASC LIMIT 500`
      );
      return res.json({
        products: activeProducts,
        sales: salesList,
        customers: custList,
      });
    }
    case 'export':
      return exportCsv(String(q.type || 'orders'), res);
    case 'listing':
      return res.json({ ok: true });
    default:
      throw badRequest('unknown_section', 'Unknown admin section');
  }
}

async function updateOrder(c, uid, b) {
  const id = uuid(b.id);
  const o = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!o) throw notFound('order_not_found', 'Order not found');
  const next = b.status ? oneOf(b.status, ORDER_STATUSES, { field: 'status' }) : o.status;
  const tracking = b.tracking_number !== undefined ? trackingNumber(b.tracking_number) || null : o.tracking_number;
  const courierRef = b.courier_id !== undefined ? b.courier_id : b.courier_partner;
  let courierRow;
  if (courierRef === undefined) courierRow = await orderCourier(c, o);
  else if (courierRef === null || courierRef === '') courierRow = null;
  else courierRow = await resolveCourier(c, { id: b.courier_id || null, name: b.courier_id ? null : b.courier_partner, currentId: o.courier_id });
  // Orders dispatched before couriers were configurable may name a courier with no row; keep that name.
  const courierName = courierRow ? courierRow.name : courierRef === undefined ? o.courier_partner : null;
  const courierId = courierRow?.id || null;
  if (next === 'dispatched' && courierRow?.requires_tracking && !tracking) {
    throw unprocessable('tracking_required', `Add the ${courierRow.name} tracking number before dispatching`);
  }
  // The link is fixed when courier or AWB is set, so later template edits never rewrite history.
  const shipmentChanged = courierId !== (o.courier_id || null) || courierName !== o.courier_partner || tracking !== o.tracking_number;
  const trackingLink = shipmentChanged || !o.tracking_url ? (courierRow ? buildTrackingUrl(courierRow.tracking_url_template, tracking) : null) : o.tracking_url;

  if (next !== o.status) {
    const allowed = FULFILMENT_FLOW[o.status] || [];
    if (next === 'refunded') {
      if (!['paid', 'refund_required'].includes(o.payment_status)) throw conflict('invalid_transition', 'Only paid orders can be marked refunded');
    } else if (!allowed.includes(next)) {
      throw conflict('invalid_transition', `Cannot move an order from ${o.status} to ${next}`);
    }
    if (['packed', 'dispatched', 'delivered'].includes(next) && o.payment_status !== 'paid') throw conflict('order_not_paid', 'Unpaid orders cannot be fulfilled');
  }

  if (next === 'cancelled' && o.status !== 'cancelled') {
    if (o.payment_status === 'pending') {
      await expireOrder(c, o.id, 'cancelled_by_admin');
      await c.query("UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now() WHERE id = $1", [o.id]);
    } else {
      // Paid order cancelled before dispatch: return stock; the payment must be refunded.
      const r = await c.query("UPDATE inventory_reservations SET status = 'held' WHERE order_id = $1 AND status = 'committed' RETURNING 1", [o.id]);
      if (r.rowCount) await releaseReservations(c, o.id);
      await reverseCredits(c, o);
      await releaseRewards(c, o.id);
      await c.query(
        `UPDATE orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()),
                payment_status = CASE
                  WHEN payment_status = 'paid' AND amount_paise = 0 THEN 'refunded'
                  WHEN payment_status = 'paid' THEN 'refund_required'
                  ELSE payment_status END,
                refunded_at = CASE WHEN payment_status = 'paid' AND amount_paise = 0 THEN COALESCE(refunded_at, now()) ELSE refunded_at END,
                updated_at = now()
          WHERE id = $1`,
        [o.id]
      );
    }
  } else {
    await c.query(
      `UPDATE orders SET status = $2, tracking_number = $3, courier_partner = $4, courier_id = $5, tracking_url = $6,
              payment_status = CASE WHEN $2 = 'refunded' THEN 'refunded' ELSE payment_status END,
              packed_at = CASE WHEN $2 = 'packed' THEN COALESCE(packed_at, now()) ELSE packed_at END,
              dispatch_at = CASE WHEN $2 = 'dispatched' THEN COALESCE(dispatch_at, now()) ELSE dispatch_at END,
              delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
              refunded_at = CASE WHEN $2 = 'refunded' THEN COALESCE(refunded_at, now()) ELSE refunded_at END,
              updated_at = now()
        WHERE id = $1`,
      [o.id, next, tracking, courierName, courierId, trackingLink]
    );
  }
  // A cancellation keeps the order's existing shipment details, so history records those.
  const cancelling = next === 'cancelled' && o.status !== 'cancelled';
  if (next !== o.status || (shipmentChanged && !cancelling)) {
    const stored = cancelling ? [o.courier_id || null, o.courier_partner, o.tracking_number, o.tracking_url] : [courierId, courierName, tracking, trackingLink];
    await c.query(
      `INSERT INTO order_shipment_events (order_id, status, courier_id, courier_name, tracking_number, tracking_url, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [o.id, next, ...stored, uid]
    );
  }
  await audit(c, { actor: uid, action: 'update_order', entityType: 'order', entityId: o.id, details: { from: o.status, to: next, tracking_number: tracking, courier_partner: courierName, courier_id: courierId } });
  return { orderId: o.id, dispatched: next === 'dispatched' && o.status !== 'dispatched' };
}

/** Runs after the status change has committed; failures are logged, never surfaced to the admin. */
async function notifyDispatched(orderId) {
  try {
    const o = (
      await db.query(
        `SELECT o.id, o.courier_partner, o.tracking_number, o.tracking_url, o.shipping_method, o.shipping_address, COALESCE(cr.is_pickup, false) AS courier_is_pickup,
                COALESCE(cp.email, p.email) AS email, COALESCE(cp.full_name, p.full_name) AS full_name
           FROM orders o
           LEFT JOIN couriers cr ON cr.id = o.courier_id
           LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id
           LEFT JOIN profiles p ON p.auth_user_id = o.auth_user_id
          WHERE o.id = $1 LIMIT 1`,
        [orderId]
      )
    ).rows[0];
    if (!o) return;
    const sent = await sendDispatchNotification({
      email: o.email,
      name: o.shipping_address?.name || o.full_name,
      orderId: o.id,
      courier: o.courier_partner,
      trackingNumber: o.tracking_number,
      trackingUrl: o.tracking_url,
      pickup: o.shipping_method === 'pickup' || o.courier_is_pickup,
    });
    if (sent.delivered) await db.query('UPDATE orders SET dispatch_notified_at = now() WHERE id = $1', [o.id]);
  } catch (err) {
    log.error('order.dispatch_notification_error', { order_id: orderId, message: err.message });
  }
}

async function adjustCredits(c, uid, b) {
  const membershipId = uuid(b.membership_id, 'membership_id');
  const delta = int(b.delta, { min: -100, max: 100, field: 'delta' });
  if (delta === 0) throw badRequest('invalid_delta', 'Credit change cannot be zero');
  const reason = text(b.reason, { max: 200, field: 'reason' }) || 'manual_adjustment';
  const owner = (await c.query('SELECT auth_user_id FROM memberships WHERE id = $1', [membershipId])).rows[0];
  if (!owner) throw conflict('insufficient_credits', 'Membership not found or the balance would become negative');
  await reconcileExpiredCredits(c, owner.auth_user_id);
  const r = await c.query(
    'UPDATE memberships SET credits_balance = credits_balance + $2, updated_at = now() WHERE id = $1 AND credits_balance + $2 >= 0 RETURNING auth_user_id, credits_balance',
    [membershipId, delta]
  );
  if (!r.rows[0]) throw conflict('insufficient_credits', 'Membership not found or the balance would become negative');
  // Granted credits expire like any other grant unless the admin sets a date; deductions carry no expiry.
  const settings = await getSettings(c);
  const explicit = b.expires_at && !Number.isNaN(Date.parse(b.expires_at)) ? new Date(b.expires_at) : null;
  const expiresAt = delta > 0 ? explicit || new Date(Date.now() + (Number(settings.credit_expiry_days) || 60) * 86_400_000) : null;
  await c.query('INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, expires_at) VALUES ($1,$2,$3,$4,$5)', [
    r.rows[0].auth_user_id, membershipId, delta, `admin: ${reason}`, expiresAt,
  ]);
  await audit(c, { actor: uid, action: 'adjust_credits', entityType: 'membership', entityId: membershipId, details: { delta, reason, balance: r.rows[0].credits_balance } });
}

/** In-studio sale: stock is taken atomically, order is paid at the counter and invoiced. */
async function storeSale(c, uid, b) {
  const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (!items.length) throw badRequest('items_required', 'Add at least one piece');
  const mode = oneOf(b.payment_mode, ['upi', 'cash', 'card', 'credit'], { field: 'payment_mode' });
  const settings = await getSettings(c);

  const lines = [];
  for (const it of items) {
    const v = it.variant_id
      ? (await c.query('SELECT v.*, p.name, p.badge, p.hsn_code, p.is_one_of_one FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1', [uuid(it.variant_id, 'variant_id')])).rows[0]
      : (await c.query('SELECT v.*, p.name, p.badge, p.hsn_code, p.is_one_of_one FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.product_id = $1 AND v.is_active ORDER BY v.sort_order LIMIT 1', [uuid(it.product_id, 'product_id')])).rows[0];
    if (!v) throw notFound('product_not_found', 'Piece not found');
    lines.push({ ...v, variant_id: v.id, quantity: int(it.quantity ?? 1, { min: 1, max: v.is_one_of_one ? 1 : 20, field: 'quantity' }), use_credit: mode === 'credit' });
  }

  let customerId = `store_walkin`;
  let membership = null;
  if (b.customer_email) {
    const em = validEmail(b.customer_email, 'customer_email');
    const p = (await c.query('SELECT auth_user_id FROM profiles WHERE lower(email) = $1', [em])).rows[0];
    if (p) customerId = p.auth_user_id;
    membership = p ? (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [p.auth_user_id])).rows[0] : null;
  }
  if (membership) {
    const reconciled = await reconcileExpiredCredits(c, customerId);
    if (reconciled) membership.credits_balance = reconciled.balance;
  }
  if (mode === 'credit' && membership?.status !== 'active') throw badRequest('membership_required', 'Credit sales need an active member email');

  const price = calculateCartPrice({ lines, method: 'pickup', placeOfSupply: settings.seller_state, membership, settings });
  const orderNumber = await nextHumanId(c, ID_PREFIXES.SALE);
  const o = (await c.query(
    `INSERT INTO orders (auth_user_id, status, payment_status, subtotal, shipping_fee, total, channel, shipping_method, amount_paise, paid_at, delivered_at,
                         taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount, place_of_supply, credits_used, shipping_address, order_number)
     VALUES ($1,'delivered','paid',$2,0,$3,'store','pickup',$4,now(),now(),$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [customerId, price.subtotal, price.total, price.amount_paise, price.taxable_amount, price.cgst, price.sgst, price.igst, price.tax_amount,
     price.place_of_supply, price.credits_used, JSON.stringify({ name: text(b.customer_name, { max: 120, field: 'customer_name' }) || 'Studio customer' }), orderNumber]
  )).rows[0];
  for (const l of price.lines) {
    await c.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, sku, variant_label, product_name, unit_price, quantity, line_total, selected_size, use_credit, gst_rate, taxable_value, gst_amount, hsn_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$13,$14)`,
      [o.id, l.product_id, l.variant_id, l.sku, l.size_label, l.name, l.unit_price, l.quantity, l.line_total, l.use_credit, l.gst_rate, l.taxable_value, l.gst_amount, l.hsn_code || '6204']
    );
    await c.query("INSERT INTO inventory_reservations (order_id, variant_id, quantity, status, expires_at) VALUES ($1,$2,$3,'committed',now())", [o.id, l.variant_id, l.quantity]);
  }
  await takeStock(c, price.lines);
  if (price.credits_used) {
    const d = await c.query('UPDATE memberships SET credits_balance = credits_balance - $2, updated_at = now() WHERE id = $1 AND credits_balance >= $2 RETURNING id', [membership.id, price.credits_used]);
    if (!d.rows[0]) throw badRequest('insufficient_credits', 'Member does not have enough credits');
    await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, order_id) VALUES ($1,$2,$3,'redemption',$4)", [customerId, membership.id, -price.credits_used, o.id]);
  }
  await syncProductInventory(c, price.lines.map((l) => l.product_id));
  await c.query('INSERT INTO store_sales (order_id, sold_by, payment_mode) VALUES ($1,$2,$3)', [o.id, uid, mode]);
  const invoice = await createOrderInvoice(c, o);
  await audit(c, { actor: uid, action: 'store_sale', entityType: 'order', entityId: o.id, details: { total: price.total, mode } });
  return { order_id: o.id, total: price.total, invoice_number: invoice.invoice_number };
}

/** Save one content item. Returns media references this change stopped using (deleted after commit). */
async function saveContent(c, uid, b, settings) {
  const type = b.type;
  const released = [];
  if (type === 'legal') {
    const slug = String(b.slug || '').trim();
    if (!isSlug(slug)) throw badRequest('invalid_slug', 'Invalid legal page slug');
    await c.query('INSERT INTO legal_pages (slug, title, body) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET title = $2, body = $3, updated_at = now()', [
      slug, text(b.title, { max: 160, field: 'title', required: true }), text(b.body, { max: 50000, field: 'body', required: true }),
    ]);
  } else if (type === 'instagram') {
    const postUrl = mediaUrl(b.post_url, { field: 'post_url' });
    if (!postUrl) throw badRequest('post_url_required', 'Add an Instagram link or upload a video');
    if (!/^https:\/\/(www\.)?instagram\.com\//i.test(postUrl)) {
      const media = await mediaInfo(postUrl, c);
      if (!media || media.visibility !== 'public') throw badRequest('invalid_post_url', 'Use an instagram.com link or an uploaded video');
    }
    const title = text(b.customer_name ? `${b.customer_name}: ${b.title || ''}` : b.title, { max: 160, field: 'title' }) || '';
    const image = b.image_url ? mediaUrl(b.image_url, { field: 'image_url' }) : '';
    if (b.id) await c.query('UPDATE instagram_content SET title = $1, post_url = $2, image_url = $3, sort_order = COALESCE($5, sort_order) WHERE id = $4', [title, postUrl, image, uuid(b.id), b.sort_order ?? null]);
    else await c.query('INSERT INTO instagram_content (title, post_url, image_url, sort_order, active) VALUES ($1,$2,$3,$4,true)', [title, postUrl, image, Number(b.sort_order) || 0]);
  } else if (type === 'video' || type === 'video_status') {
    const { max_published_videos: maxLive, max_video_seconds: maxSeconds } = customerVideoLimits(settings);
    // Serialise publish decisions so the live-video limit cannot be exceeded by parallel requests.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('feedback_videos_publish'))");
    const id = b.id ? uuid(b.id) : null;
    let publish;
    if (type === 'video_status') {
      publish = bool(b.active);
      if (!id) throw badRequest('id_required', 'Video id is required');
    } else {
      publish = b.active === undefined ? !id : bool(b.active);
    }
    let duration = null;
    if (type === 'video' && b.video_url !== undefined) {
      const media = typeof b.video_url === 'string' ? await mediaInfo(b.video_url, c) : null;
      if (!media) throw badRequest('invalid_video_url', 'Upload the customer video file');
      if (media.kind !== 'video' || media.visibility !== 'public') throw badRequest('invalid_video_url', 'Upload the customer video file');
      duration = media.duration_seconds;
      if (duration === null) throw unprocessable('unreadable_video', 'Video file not found or unreadable');
      if (duration > maxSeconds + 0.05) throw unprocessable('video_too_long', `Customer videos must be ${maxSeconds} seconds or shorter (this one is ${duration}s)`);
    }
    if (publish) {
      if (type === 'video_status') {
        const row = (await c.query('SELECT duration_seconds FROM feedback_videos WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!row) throw notFound('video_not_found', 'Video not found');
        if (row.duration_seconds === null || Number(row.duration_seconds) > maxSeconds + 0.05) {
          throw unprocessable('video_too_long', `Customer videos must be ${maxSeconds} seconds or shorter`);
        }
      }
      const live = (await c.query('SELECT count(*)::int AS n FROM feedback_videos WHERE active = true AND ($1::uuid IS NULL OR id <> $1)', [id])).rows[0].n;
      if (live >= maxLive) throw conflict('video_limit_reached', `Only ${maxLive} customer videos can be live. Unpublish one first.`);
    }
    if (type === 'video_status') {
      const r = await c.query('UPDATE feedback_videos SET active = $2, updated_at = now() WHERE id = $1 RETURNING id', [id, publish]);
      if (!r.rows[0]) throw notFound('video_not_found', 'Video not found');
    } else {
      const title = text(b.title, { max: 160, field: 'title' }) || '';
      const customer = text(b.customer_name, { max: 80, field: 'customer_name' });
      if (id) {
        const prev = (await c.query('SELECT video_url FROM feedback_videos WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!prev) throw notFound('video_not_found', 'Video not found');
        await c.query(
          `UPDATE feedback_videos SET title = $2, customer_name = COALESCE($3, customer_name), video_url = COALESCE($4, video_url),
                  duration_seconds = COALESCE($5, duration_seconds), sort_order = COALESCE($6, sort_order), active = $7, updated_at = now() WHERE id = $1`,
          [id, title, customer, b.video_url ?? null, duration, b.sort_order ?? null, publish]
        );
        // The old file is released only after this transaction commits (see handleWrite).
        if (b.video_url && prev.video_url !== b.video_url) released.push(prev.video_url);
      } else {
        if (duration === null) throw badRequest('video_required', 'Upload the customer video file');
        await c.query('INSERT INTO feedback_videos (title, customer_name, video_url, duration_seconds, sort_order, active) VALUES ($1,$2,$3,$4,$5,$6)', [
          title, customer, b.video_url, duration, Number(b.sort_order) || 0, publish,
        ]);
      }
    }
  } else if (type === 'instagram_status') {
    await c.query('UPDATE instagram_content SET active = $1 WHERE id = $2', [bool(b.active), uuid(b.id)]);
  } else if (type === 'store') {
    await c.query('UPDATE store_settings SET store_name = $1, pickup_enabled = $2, pickup_note = $3, updated_at = now() WHERE id = $4', [
      text(b.store_name, { max: 120, field: 'store_name', required: true }), b.pickup_enabled !== false, text(b.pickup_note, { max: 300, field: 'pickup_note' }) || '', uuid(b.id),
    ]);
  } else {
    throw badRequest('unknown_content_type', 'Unknown content type');
  }
  await audit(c, { actor: uid, action: `content_${type}`, entityType: 'content', entityId: b.id || b.slug || null, details: { title: b.title, active: b.active } });
  return released;
}

/** Delete files a committed change no longer uses. Failures are logged, never surfaced: the save succeeded. */
async function releaseMedia(refs, actor) {
  for (const ref of refs) await safeDelete(ref, { actor }).catch((err) => log.error('storage.release_failed', { message: err.message }));
}

async function handleWrite(req, res) {
  const uid = req.user.id;
  const b = req.body || {};
  const section = req.query?.section || b.section;

  if (section === 'settings') {
    const changes = await db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('app_settings'))");
      return saveSettings(c, uid, b.settings);
    });
    return res.json({ ok: true, changed: Object.keys(changes) });
  }

  if (section === 'category') {
    const name = text(b.name, { max: 80, field: 'name', required: true });
    const slug = b.slug ? String(b.slug).trim().toLowerCase() : slugify(name);
    if (!isSlug(slug)) throw badRequest('invalid_slug', 'Slug may contain lowercase letters, numbers and hyphens');
    const sort = int(b.sort_order ?? 0, { min: -1000, max: 100000, field: 'sort_order' });
    const parent = b.parent_id ? uuid(b.parent_id, 'parent_id') : null;
    if (b.id) await db.query('UPDATE categories SET name = $1, slug = $2, is_active = $3, sort_order = $4, parent_id = $5 WHERE id = $6', [name, slug, b.is_active !== false, sort, parent, uuid(b.id)]);
    else {
      const catCode = await nextHumanId(db, ID_PREFIXES.CATEGORY);
      await db.query('INSERT INTO categories (name, slug, is_active, sort_order, parent_id, category_code) VALUES ($1,$2,$3,$4,$5,$6)', [name, slug, b.is_active !== false, sort, parent, catCode]);
    }
    await audit(db, { actor: uid, action: 'save_category', entityType: 'category', entityId: b.id || slug, details: { name, slug } });
    return res.json({ ok: true });
  }

  if (section === 'product') {
    const id = await db.tx(async (c) => {
      const saved = await saveProduct(c, uid, b);
      if (typeof b.reward_eligible === 'boolean') await setProductRewardEligible(c, uid, saved, b.reward_eligible);
      return saved;
    });
    return res.json({ ok: true, product: await getProductWithVariants(db, id) });
  }

  if (section === 'product_status') {
    const id = uuid(b.id);
    await db.query('UPDATE products SET is_active = $2, archived_at = CASE WHEN $2 THEN NULL ELSE archived_at END, updated_at = now() WHERE id = $1', [id, bool(b.is_active)]);
    await audit(db, { actor: uid, action: 'product_visibility', entityType: 'product', entityId: id, details: { is_active: bool(b.is_active) } });
    return res.json({ ok: true });
  }

  if (section === 'product_featured') {
    const id = uuid(b.id);
    const featuredVal = bool(b.featured);
    await db.query('UPDATE products SET featured = $2, updated_at = now() WHERE id = $1', [id, featuredVal]);
    await audit(db, { actor: uid, action: 'product_featured_toggle', entityType: 'product', entityId: id, details: { featured: featuredVal } });
    return res.json({ ok: true, featured: featuredVal });
  }

  if (section === 'order') {
    const result = await db.tx((c) => updateOrder(c, uid, b));
    if (result.dispatched) await notifyDispatched(result.orderId);
    return res.json({ ok: true });
  }

  if (section === 'membership') {
    const id = uuid(b.id);
    const status = oneOf(b.status, ['active', 'paused', 'cancelled', 'payment_failed', 'inactive', 'expired'], { field: 'status' });
    await db.tx(async (c) => {
      const m = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound('membership_not_found', 'Membership not found');
      // Re-activating requires a paid period: an admin override never creates free membership time.
      if (['active', 'paused'].includes(status) && !(m.paid_through && new Date(m.paid_through) > new Date())) {
        throw conflict('no_paid_period', 'This membership has no paid period left. The customer needs to renew.');
      }
      if (status === 'cancelled' && m.status !== 'cancelled') await voidFuturePeriods(c, { membershipId: id, reason: 'cancelled_by_admin' });
      if (status === 'paused' && m.status !== 'paused') await resetConsecutiveMonths(c, id);
      await c.query(
        "UPDATE memberships SET status = $2, cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END, updated_at = now() WHERE id = $1",
        [id, status]
      );
      if (b.credits_balance !== undefined && Number(b.credits_balance) !== m.credits_balance) {
        await adjustCredits(c, uid, { membership_id: id, delta: Number(b.credits_balance) - m.credits_balance, reason: 'balance set by admin' });
      }
      await audit(c, { actor: uid, action: 'update_membership', entityType: 'membership', entityId: id, details: { from: m.status, to: status } });
    });
    return res.json({ ok: true });
  }

  if (section === 'credit') {
    await db.tx((c) => adjustCredits(c, uid, b));
    return res.json({ ok: true });
  }

  if (section === 'exchange') {
    const id = uuid(b.id);
    await db.tx(async (c) => {
      const x = (await c.query('SELECT * FROM exchanges WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!x) throw notFound('exchange_not_found', 'Exchange request not found');
      const next = b.status === undefined ? x.status : oneOf(b.status, EXCHANGE_STATUSES, { field: 'status' });
      if (next !== x.status && !(EXCHANGE_FLOW[x.status] || []).includes(next)) {
        throw conflict('invalid_transition', `Cannot move an exchange from ${x.status} to ${next}`);
      }
      if (['approved', 'not_approved', 'rejected'].includes(next) && next !== x.status && !text(b.resolution ?? x.resolution, { max: 500, field: 'resolution' })) {
        throw badRequest('resolution_required', 'Add a resolution note for the customer');
      }
      await c.query('UPDATE exchanges SET status = $1, resolution = $2, quality_check = $3, return_tracking = $4, updated_at = now() WHERE id = $5', [
        next,
        b.resolution !== undefined ? text(b.resolution, { max: 500, field: 'resolution' }) : x.resolution,
        b.quality_check !== undefined ? text(b.quality_check, { max: 300, field: 'quality_check' }) : x.quality_check,
        b.return_tracking !== undefined ? text(b.return_tracking, { max: 80, field: 'return_tracking' }) : x.return_tracking,
        id,
      ]);
      await audit(c, { actor: uid, action: 'update_exchange', entityType: 'exchange', entityId: id, details: { from: x.status, to: next } });
      return { x, next };
    }).then(async ({ x, next }) => {
      if (next === x.status) return;
      const resolution = (await db.query('SELECT resolution FROM exchanges WHERE id = $1', [id])).rows[0]?.resolution;
      await notify(db, {
        authUserId: x.auth_user_id,
        event: 'exchange_update',
        data: { type: x.claim_type === 'damage' ? 'damage' : 'exchange', status: next, note: resolution, ref: String(x.order_id).slice(0, 8).toUpperCase(), link: `${config.publicSiteUrl}/orders/${x.order_id}` },
        dedupeKey: `exchange:${id}:${next}`,
      });
    });
    return res.json({ ok: true });
  }

  if (section === 'gift_enquiry') {
    const id = uuid(b.id);
    await db.tx(async (c) => {
      const e = (await c.query('SELECT * FROM admin_gift_enquiries WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!e) throw notFound('gift_enquiry_not_found', 'Gift enquiry not found');
      const next = b.status === undefined || b.status === e.status ? e.status : oneOf(b.status, Object.keys(GIFT_ENQUIRY_FLOW), { field: 'status' });
      if (next !== e.status && !GIFT_ENQUIRY_FLOW[e.status].includes(next)) throw conflict('invalid_transition', `Cannot move an enquiry from ${e.status} to ${next}`);
      if (next !== e.status && e.source === 'online') throw conflict('online_gift_payment_driven', 'Online gift purchases move to invoiced only when their payment is confirmed');
      const invoiceRef = b.invoice_reference !== undefined ? text(b.invoice_reference, { max: 80, field: 'invoice_reference' }) : e.invoice_reference;
      const invoiceAmount = b.invoice_amount !== undefined && b.invoice_amount !== '' && b.invoice_amount !== null ? money(b.invoice_amount, { field: 'invoice_amount' }) : e.invoice_amount;
      if (next === 'invoiced' && !invoiceRef) throw badRequest('invoice_reference_required', 'Record the invoice reference before marking the enquiry invoiced');
      const changed = next !== e.status;
      await c.query(
        `UPDATE admin_gift_enquiries SET status = $2, admin_notes = $3, invoice_reference = $4, invoice_amount = $5,
                status_changed_by = CASE WHEN $6 THEN $7 ELSE status_changed_by END, status_changed_at = CASE WHEN $6 THEN now() ELSE status_changed_at END,
                processed_at = CASE WHEN $2 = 'processed' AND $6 THEN now() ELSE processed_at END,
                invoiced_at = CASE WHEN $2 = 'invoiced' AND $6 THEN now() ELSE invoiced_at END, updated_at = now()
          WHERE id = $1`,
        [id, next, b.admin_notes !== undefined ? text(b.admin_notes, { max: 4000, field: 'admin_notes' }) : e.admin_notes, invoiceRef, invoiceAmount, changed, uid]
      );
      await audit(c, { actor: uid, action: 'update_gift_enquiry', entityType: 'gift_enquiry', entityId: id, details: { from: e.status, to: next } });
    });
    return res.json({ ok: true });
  }

  if (section === 'gift_token') {
    const issued = await db.tx((c) => issueGiftToken(c, uid, uuid(b.enquiry_id, 'enquiry_id')));
    // The plaintext code is returned once, to this admin, and never stored.
    return res.status(201).json({ ok: true, token: issued.token, link: issued.link, gift: { id: issued.id, token_hint: issued.token_hint, expires_at: issued.expires_at, membership_months: issued.membership_months } });
  }

  if (section === 'gift_token_revoke') {
    const r = await db.query("UPDATE gift_memberships SET status = 'revoked', revoked_by = $2, revoked_at = now() WHERE id = $1 AND status = 'issued' RETURNING id", [uuid(b.id), uid]);
    if (!r.rows[0]) throw conflict('gift_token_not_revocable', 'Only unredeemed codes can be revoked');
    await audit(db, { actor: uid, action: 'gift_token_revoked', entityType: 'gift_membership', entityId: r.rows[0].id });
    return res.json({ ok: true });
  }

  if (section === 'reward') {
    const id = uuid(b.id);
    const action = oneOf(b.action, ['void', 'clear_flag'], { field: 'action' });
    const reason = text(b.reason, { max: 300, field: 'reason', required: true });
    const r = action === 'void'
      ? await db.query("UPDATE reward_entitlements SET status = 'void', void_reason = $2, voided_at = now(), voided_by = $3, updated_at = now() WHERE id = $1 AND status = 'available' RETURNING id", [id, reason, uid])
      : await db.query('UPDATE reward_entitlements SET flag_reason = NULL, flagged_at = NULL, updated_at = now() WHERE id = $1 AND flagged_at IS NOT NULL RETURNING id', [id]);
    if (!r.rows[0]) throw conflict('reward_not_changeable', action === 'void' ? 'Only an unused reward can be voided' : 'This reward is not flagged');
    await audit(db, { actor: uid, action: `reward_${action}`, entityType: 'reward_entitlement', entityId: id, details: { reason } });
    return res.json({ ok: true });
  }

  if (section === 'loyalty') {
    const name = text(b.name, { max: 120, field: 'name', required: true });
    const obj = (v) => JSON.stringify(v && typeof v === 'object' ? v : {}).slice(0, 4000);
    const date = (v) => (v && !Number.isNaN(Date.parse(v)) ? v : null);
    const vals = [name, obj(b.audience), obj(b.trigger_config), obj(b.reward_config), obj(b.applies_to), obj(b.limits), date(b.starts_at), date(b.ends_at), bool(b.active), money(b.estimated_monthly_cost ?? 0, { field: 'estimated_monthly_cost' })];
    if (b.id) await db.query('UPDATE loyalty_rules SET name=$1, audience=$2, trigger_config=$3, reward_config=$4, applies_to=$5, limits=$6, starts_at=$7, ends_at=$8, active=$9, estimated_monthly_cost=$10, updated_at=now() WHERE id=$11', [...vals, uuid(b.id)]);
    else await db.query('INSERT INTO loyalty_rules (name, audience, trigger_config, reward_config, applies_to, limits, starts_at, ends_at, active, estimated_monthly_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', vals);
    await audit(db, { actor: uid, action: 'save_loyalty_rule', entityType: 'loyalty_rule', entityId: b.id || null, details: { name, active: bool(b.active) } });
    return res.json({ ok: true });
  }

  if (section === 'distribute_offer') {
    const customerIds = Array.isArray(b.customer_ids) ? b.customer_ids : b.auth_user_id ? [b.auth_user_id] : [];
    if (!customerIds.length) throw badRequest('customer_required', 'Select at least one customer');
    const code = text(b.code, { max: 30, field: 'code', required: true }).toUpperCase();
    const title = text(b.title, { max: 120, field: 'title', required: true });
    const description = text(b.description, { max: 300, field: 'description' }) || `Special VIP offer: ${title}`;
    const discountType = oneOf(b.discount_type || 'percentage', ['percentage', 'fixed'], { field: 'discount_type' });
    const discountValue = Math.max(1, Number(b.discount_value) || 10);
    const validDays = Math.max(1, Math.min(365, Number(b.valid_days) || 30));

    await db.query(
      `INSERT INTO offers (code, title, description, discount_type, discount_value, active, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, true, now(), now() + make_interval(days => $6))
       ON CONFLICT (code) DO UPDATE SET title = excluded.title, description = excluded.description,
         discount_type = excluded.discount_type, discount_value = excluded.discount_value, active = true,
         ends_at = now() + make_interval(days => $6)`,
      [code, title, description, discountType, discountValue, validDays]
    );

    for (const authUserId of customerIds) {
      await db.query(
        `INSERT INTO loyalty_events (auth_user_id, event_type, reward_value, details)
         VALUES ($1, 'special_offer_distributed', $2, $3)`,
        [authUserId, discountValue, JSON.stringify({ code, title, discount_type: discountType, valid_days: validDays })]
      );
      await notify(db, {
        authUserId,
        event: 'special_offer_granted',
        data: {
          code,
          title,
          discount: discountType === 'percentage' ? `${discountValue}% OFF` : `₹${discountValue} OFF`,
          link: `${config.publicSiteUrl}/catalogue`,
        },
        dedupeKey: `offer:${authUserId}:${code}`,
      }).catch(() => {});
    }

    await audit(db, {
      actor: uid,
      action: 'distribute_special_offer',
      entityType: 'offer',
      entityId: code,
      details: { customers_count: customerIds.length, discount_type: discountType, discount_value: discountValue },
    });

    return res.json({ ok: true, count: customerIds.length, code });
  }

  if (section === 'run_loyalty_triggers') {
    const rules = (await db.query("SELECT * FROM loyalty_rules WHERE active = true AND (trigger_config->>'event' LIKE 'tenure%' OR trigger_config->>'event' = 'tenure')")).rows;
    let triggeredCount = 0;
    const triggeredDetails = [];

    for (const rule of rules) {
      let months = Number(rule.trigger_config?.months);
      if (!months) {
        const match = String(rule.trigger_config?.event || '').match(/tenure_(\d+)_months/);
        if (match) months = Number(match[1]);
      }
      if (!months || months < 1) continue;

      const eligible = (await db.query(
        `SELECT cp.auth_user_id, cp.email, cp.full_name, cp.created_at
           FROM customer_profiles cp
          WHERE cp.created_at <= now() - make_interval(months => $1)
            AND NOT EXISTS (
              SELECT 1 FROM loyalty_events le
               WHERE le.auth_user_id = cp.auth_user_id
                 AND (le.rule_id = $2 OR (le.event_type = 'tenure_milestone' AND (le.details->>'tenure_months')::int = $1))
            )
          LIMIT 100`,
        [months, rule.id]
      )).rows;

      for (const cust of eligible) {
        await db.query(
          `INSERT INTO loyalty_events (rule_id, auth_user_id, event_type, reward_value, details)
           VALUES ($1, $2, 'tenure_milestone', $3, $4)`,
          [rule.id, cust.auth_user_id, Number(rule.reward_config?.discount?.replace(/\\D/g, '') || rule.reward_config?.credits || 0), JSON.stringify({ tenure_months: months, rule_name: rule.name })]
        );
        await notify(db, {
          authUserId: cust.auth_user_id,
          event: 'loyalty_milestone_reward',
          data: {
            milestone: `${months} Months Tenure Loyalty Privilege`,
            message: `Thank you for being with Vishrea Studio for ${months} months! A special tenure privilege has been unlocked on your account.`,
            reward: rule.reward_config,
            link: `${config.publicSiteUrl}/account`,
          },
          dedupeKey: `tenure:${cust.auth_user_id}:${rule.id}`,
        }).catch(() => {});

        triggeredCount += 1;
        triggeredDetails.push({ customer: cust.email || cust.full_name, rule: rule.name, months });
      }
    }

    await audit(db, {
      actor: uid,
      action: 'run_loyalty_tenure_triggers',
      entityType: 'loyalty_rule',
      details: { triggered_count: triggeredCount, rules_count: rules.length },
    });

    return res.json({ ok: true, triggered_count: triggeredCount, details: triggeredDetails });
  }

  if (section === 'drop') {
    const startsAt = b.starts_at && !Number.isNaN(Date.parse(b.starts_at)) ? b.starts_at : null;
    const publicAt = b.public_at && !Number.isNaN(Date.parse(b.public_at)) ? b.public_at : null;
    if (!startsAt || !publicAt) throw badRequest('dates_required', 'Member and public dates are required');
    if (Date.parse(publicAt) < Date.parse(startsAt)) throw badRequest('invalid_dates', 'Public launch must be after member access');
    await db.query('INSERT INTO drop_settings (name, starts_at, public_at, active) VALUES ($1,$2,$3,$4)', [text(b.name, { max: 120, field: 'name', required: true }), startsAt, publicAt, b.active !== false]);
    await audit(db, { actor: uid, action: 'create_drop', entityType: 'drop', details: { name: b.name } });
    return res.json({ ok: true });
  }

  if (section === 'source') {
    await db.query('INSERT INTO sourcing_batches (supplier_name, batch_date, notes) VALUES ($1,$2,$3)', [
      text(b.supplier_name, { max: 160, field: 'supplier_name', required: true }), b.batch_date && /^\d{4}-\d{2}-\d{2}$/.test(b.batch_date) ? b.batch_date : null, text(b.notes, { max: 2000, field: 'notes' }) || '',
    ]);
    await audit(db, { actor: uid, action: 'create_sourcing_batch', entityType: 'sourcing', details: { supplier: b.supplier_name } });
    return res.json({ ok: true });
  }

  if (section === 'content') {
    const settings = await getSettings();
    const released = await db.tx((c) => saveContent(c, uid, b, settings));
    await releaseMedia(released, uid);
    return res.json({ ok: true });
  }

  if (section === 'courier') {
    const courier = await db.tx((c) => saveCourier(c, uid, b));
    return res.json({ ok: true, courier });
  }

  if (section === 'courier_status') {
    const courier = await db.tx((c) => setCourierActive(c, uid, b.id, bool(b.is_active)));
    return res.json({ ok: true, courier });
  }

  if (section === 'store_sale' || section === 'sale') {
    const r = await db.tx(async (c) => {
      const items = Array.isArray(b.items) && b.items.length ? b.items : [];
      if (!items.length) throw badRequest('items_required', 'Add at least one piece to the sale');
      
      let customerId = b.customer_id || b.auth_user_id;
      let customerName = text(b.customer_name, { max: 120, field: 'customer_name' }) || '';
      let customerPhone = text(b.customer_phone, { max: 40, field: 'customer_phone' }) || '';

      if (customerId) {
        const cp = (await c.query('SELECT full_name, phone, email FROM customer_profiles WHERE auth_user_id = $1', [customerId])).rows[0];
        if (cp) {
          if (!customerName) customerName = cp.full_name;
          if (!customerPhone) customerPhone = cp.phone;
        }
      } else if (customerName) {
        const genUid = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const custCode = await nextHumanId(c, ID_PREFIXES.CUSTOMER);
        await c.query('INSERT INTO profiles (auth_user_id, full_name, email, role) VALUES ($1,$2,$3,$4)', [genUid, customerName, `${genUid}@store.local`, 'customer']);
        await c.query('INSERT INTO customer_profiles (auth_user_id, full_name, phone, customer_code) VALUES ($1,$2,$3,$4)', [genUid, customerName, customerPhone, custCode]);
        customerId = genUid;
      } else {
        throw badRequest('customer_required', 'Customer selection or name is required');
      }

      const lines = [];
      const stockTakeLines = [];
      for (const it of items) {
        const v = it.variant_id
          ? (await c.query('SELECT v.*, p.name, p.cost_price_inr, p.hsn_code FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1', [uuid(it.variant_id, 'variant_id')])).rows[0]
          : (await c.query('SELECT v.*, p.name, p.cost_price_inr, p.hsn_code FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.product_id = $1 AND v.is_active ORDER BY v.sort_order LIMIT 1', [uuid(it.product_id, 'product_id')])).rows[0];
        
        if (!v) throw notFound('variant_not_found', 'Product or size not found');
        const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
        if (Number(v.stock_quantity) < qty) {
          throw conflict('insufficient_stock', `Insufficient stock for ${v.name} (${v.size_label}). Available: ${v.stock_quantity}`);
        }
        const saleRate = it.sale_rate !== undefined ? money(it.sale_rate, { field: 'sale_rate' }) : Number(v.sale_price_inr || v.price_inr);
        lines.push({
          product_id: v.product_id,
          variant_id: v.id,
          name: v.name,
          size_label: v.size_label,
          quantity: qty,
          sale_rate: saleRate,
          unit_price: saleRate,
          cost_price_inr: Number(v.cost_price_inr || 0),
          hsn_code: v.hsn_code || '6204',
        });
        stockTakeLines.push({
          product_id: v.product_id,
          variant_id: v.id,
          quantity: qty,
          name: v.name,
          size_label: v.size_label,
        });
      }

      await takeStock(c, stockTakeLines);

      const totals = calculateSaleTotals(lines, b.discount || b.discount_amount || 0, b.amount_paid !== undefined ? b.amount_paid : b.total);

      const saleNumber = await nextHumanId(c, ID_PREFIXES.SALE);
      const insOrder = await c.query(
        `INSERT INTO orders (auth_user_id, status, payment_status, subtotal, shipping_fee, total, discount_amount, channel,
                             amount_paid, amount_due, sale_date, customer_id, customer_name, customer_phone, estimated_cost, estimated_profit, manual_discount, order_number)
         VALUES ($1, $2, $3, $4, 0, $5, $6, 'studio', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [customerId, totals.paymentStatus === 'paid' ? 'delivered' : 'processing', totals.paymentStatus, totals.subtotal, totals.finalAmount, totals.discount,
         totals.amountPaid, totals.amountDue, b.sale_date || new Date().toISOString().slice(0, 10), customerId, customerName, customerPhone, totals.estimatedCost, totals.estimatedProfit, totals.discount, saleNumber]
      );
      const order = insOrder.rows[0];

      for (const l of lines) {
        await c.query(
          'INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, tax_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [order.id, l.product_id, l.variant_id, l.name, l.size_label, l.quantity, l.sale_rate, 5]
        );
      }

      await c.query('INSERT INTO store_sales (order_id, sold_by, payment_mode) VALUES ($1,$2,$3)', [order.id, uid, b.payment_mode || 'counter']);
      await syncProductInventory(c, lines.map((l) => l.product_id));

      const invoice = await createOrderInvoice(c, order).catch(() => null);
      await audit(c, { actor: uid, action: 'create_sale', entityType: 'order', entityId: order.id, details: { total: totals.finalAmount, status: totals.paymentStatus } });

      return {
        order_id: order.id,
        total: totals.finalAmount,
        payment_status: totals.paymentStatus,
        invoice_number: invoice?.invoice_number || null,
      };
    });
    return res.json({ ok: true, ...r });
  }

  if (section === 'vendor') {
    const name = text(b.name, { max: 160, field: 'name', required: true });
    const contactName = text(b.contact_name || b.contact_person, { max: 120, field: 'contact_name' }) || '';
    const contactPhone = text(b.contact_phone || b.phone, { max: 40, field: 'contact_phone' }) || '';
    const notes = text(b.notes, { max: 2000, field: 'notes' }) || '';
    const categories = Array.isArray(b.categories) ? b.categories.map((c) => String(c).trim()).filter(Boolean) : (typeof b.categories === 'string' ? b.categories.split(',').map((c) => c.trim()).filter(Boolean) : []);
    const isActive = b.is_active !== false;

    if (b.id) {
      await db.query(
        'UPDATE vendors SET name = $1, contact_name = $2, contact_person = $2, contact_phone = $3, phone = $3, categories = $4, notes = $5, is_active = $6, updated_at = now() WHERE id = $7',
        [name, contactName, contactPhone, JSON.stringify(categories), notes, isActive, uuid(b.id)]
      );
      await audit(db, { actor: uid, action: 'update_vendor', entityType: 'vendor', entityId: b.id, details: { name } });
    } else {
      const vendorCode = text(b.vendor_code || b.code, { max: 40, field: 'vendor_code' }) || await nextHumanId(db, ID_PREFIXES.VENDOR);
      await db.query(
        'INSERT INTO vendors (vendor_code, code, name, contact_name, contact_person, contact_phone, phone, categories, notes, is_active) VALUES ($1,$1,$2,$3,$3,$4,$4,$5,$6,$7)',
        [vendorCode, name, contactName, contactPhone, JSON.stringify(categories), notes, isActive]
      );
      await audit(db, { actor: uid, action: 'create_vendor', entityType: 'vendor', details: { name, vendorCode } });
    }
    return res.json({ ok: true });
  }

  if (section === 'purchase_order') {
    const vendorId = b.vendor_id ? uuid(b.vendor_id, 'vendor_id') : null;
    const vendorName = text(b.vendor_name, { max: 160, field: 'vendor_name', required: true });
    const orderDate = b.order_date && /^\d{4}-\d{2}-\d{2}$/.test(b.order_date) ? b.order_date : new Date().toISOString().slice(0, 10);
    const batchId = text(b.batch_id, { max: 60, field: 'batch_id', required: true });
    const courierCharges = money(b.courier_charges || 0, { field: 'courier_charges' });
    const notes = text(b.notes, { max: 2000, field: 'notes' }) || '';
    const rawItems = Array.isArray(b.items) && b.items.length ? b.items : [];
    if (!rawItems.length) throw badRequest('items_required', 'Add at least one item to purchase order');

    const poTotals = calculatePurchaseOrderTotals(rawItems, courierCharges);

    const poId = await db.tx(async (c) => {
      let currentPoId = b.id ? uuid(b.id) : null;
      if (currentPoId) {
        const existing = (await c.query('SELECT status FROM purchase_orders WHERE id = $1', [currentPoId])).rows[0];
        if (!existing) throw notFound('po_not_found', 'Purchase order not found');
        if (existing.status === 'fulfilled') throw conflict('fulfilled_po_immutable', 'Fulfilled purchase orders cannot be modified');
        await c.query(
          'UPDATE purchase_orders SET vendor_id = $1, vendor_name = $2, order_date = $3, batch_id = $4, courier_charges = $5, subtotal = $6, grand_total = $7, notes = $8, updated_at = now() WHERE id = $9',
          [vendorId, vendorName, orderDate, batchId, poTotals.courierCharges, poTotals.subtotal, poTotals.grandTotal, notes, currentPoId]
        );
        await c.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [currentPoId]);
      } else {
        const poNumber = await nextHumanId(c, ID_PREFIXES.PROCUREMENT);
        const ins = await c.query(
          'INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, order_date, batch_id, courier_charges, subtotal, grand_total, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [poNumber, vendorId, vendorName, orderDate, batchId, poTotals.courierCharges, poTotals.subtotal, poTotals.grandTotal, notes]
        );
        currentPoId = ins.rows[0].id;
      }

      for (const it of poTotals.items) {
        await c.query(
          'INSERT INTO purchase_order_items (purchase_order_id, item_name, category, category_id, quantity, unit_cost, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [currentPoId, text(it.item_name, { max: 160, field: 'item_name', required: true }), text(it.category, { max: 80, field: 'category' }) || '', it.category_id && isUuid(it.category_id) ? it.category_id : null, it.quantity, it.unit_cost, it.line_total]
        );
      }
      return currentPoId;
    });

    await audit(db, { actor: uid, action: b.id ? 'update_purchase_order' : 'create_purchase_order', entityType: 'purchase_order', entityId: poId });
    return res.json({ ok: true, po_id: poId });
  }

  if (section === 'fulfil_purchase_order') {
    const poId = uuid(b.id, 'id');
    await db.tx(async (c) => {
      const po = (await c.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId])).rows[0];
      if (!po) throw notFound('po_not_found', 'Purchase order not found');
      if (po.status === 'fulfilled') throw conflict('already_fulfilled', 'This purchase order has already been fulfilled');

      const items = (await c.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1', [poId])).rows;
      if (!items.length) throw badRequest('no_items', 'Purchase order contains no items');

      const totals = calculatePurchaseOrderTotals(items, Number(po.courier_charges || 0));

      for (const it of totals.items) {
        const itemCourier = Math.round(Number(it.freight_per_unit || 0) * it.quantity * 100) / 100;
        await saveProduct(c, uid, {
          name: it.item_name,
          category: it.category,
          category_id: it.category_id,
          vendor_id: po.vendor_id,
          supplier_name: po.vendor_name,
          batch_id: po.batch_id,
          purchase_date: po.order_date,
          purchase_quantity: it.quantity,
          purchase_price_per_piece: it.unit_cost,
          courier_charge: itemCourier,
          cost_price_inr: it.landed_cost_per_unit,
          price_inr: Math.round(it.landed_cost_per_unit * 2.4),
          is_one_of_one: it.quantity === 1,
          is_active: true,
          variants: [{
            size_label: 'Free Size',
            price_inr: Math.round(it.landed_cost_per_unit * 2.4),
            stock_quantity: it.quantity,
            is_active: true,
          }],
        });
      }

      await c.query("UPDATE purchase_orders SET status = 'fulfilled', fulfilled_at = now(), updated_at = now() WHERE id = $1", [poId]);
      await audit(c, { actor: uid, action: 'fulfil_purchase_order', entityType: 'purchase_order', entityId: poId, details: { po_number: po.po_number, items: items.length } });
    });
    return res.json({ ok: true });
  }

  if (section === 'customer') {
    const fullName = text(b.full_name, { max: 120, field: 'full_name', required: true });
    const email = b.email ? validEmail(b.email, { field: 'email' }) : '';
    const phone = text(b.phone, { max: 40, field: 'phone' }) || '';
    const notes = text(b.notes, { max: 2000, field: 'notes' }) || '';
    const tags = Array.isArray(b.tags) ? b.tags : [];

    let authUserId = b.auth_user_id || b.id;
    if (authUserId) {
      await db.tx(async (c) => {
        await c.query(
          'UPDATE customer_profiles SET full_name = $1, phone = $2, notes = $3, tags = $4, updated_at = now() WHERE auth_user_id = $5',
          [fullName, phone, notes, JSON.stringify(tags), authUserId]
        );
        if (email) {
          await c.query('UPDATE profiles SET full_name = $1, email = $2, updated_at = now() WHERE auth_user_id = $3', [fullName, email, authUserId]);
          await c.query('UPDATE customer_profiles SET email = $1 WHERE auth_user_id = $2', [email, authUserId]);
        }
      });
      await audit(db, { actor: uid, action: 'update_customer', entityType: 'customer', entityId: authUserId });
    } else {
      if (!email) throw badRequest('email_required', 'Email is required for new customer');
      authUserId = await db.tx(async (c) => {
        const generatedUid = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await c.query(
          'INSERT INTO profiles (auth_user_id, full_name, email, role, is_admin) VALUES ($1,$2,$3,$4,$5)',
          [generatedUid, fullName, email, 'customer', false]
        );
        const custCode = await nextHumanId(c, ID_PREFIXES.CUSTOMER);
        await c.query(
          'INSERT INTO customer_profiles (auth_user_id, full_name, email, phone, notes, tags, customer_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [generatedUid, fullName, email, phone, notes, JSON.stringify(tags), custCode]
        );
        return generatedUid;
      });
      await audit(db, { actor: uid, action: 'create_customer', entityType: 'customer', entityId: authUserId });
    }
    return res.json({ ok: true, auth_user_id: authUserId });
  }

  if (section === 'admin') {
    const r = await db.tx((c) => (b.id ? updateAdmin(c, uid, b) : addAdmin(c, uid, b)));
    return res.status(b.id ? 200 : 201).json({ ok: true, ...r });
  }

  throw badRequest('unknown_action', 'Unknown admin action');
}

async function handleDelete(req, res) {
  const uid = req.user.id;
  const q = { ...(req.body || {}), ...(req.query || {}) };
  let section = q.section;
  if (typeof section === 'string' && (section.includes('?') || section.includes('&'))) {
    const parts = section.split(/[?&]/);
    section = parts[0];
    q.section = section;
  }
  if (section === 'product') {
    const result = await db.tx((c) => deleteOrArchiveProduct(c, uid, uuid(q.id)));
    return res.json({ ok: true, result });
  }
  if (section === 'category') {
    const id = uuid(q.id);
    await db.tx(async (c) => {
      await c.query('UPDATE products SET category_id = NULL WHERE category_id = $1', [id]);
      await c.query('UPDATE categories SET parent_id = NULL WHERE parent_id = $1', [id]);
      await c.query('DELETE FROM categories WHERE id = $1', [id]);
      await pruneRewardReference(c, uid, 'categories', id);
      await audit(c, { actor: uid, action: 'delete_category', entityType: 'category', entityId: id });
    });
    return res.json({ ok: true });
  }
  if (section === 'courier') {
    return res.json({ ok: true, ...(await db.tx((c) => deleteCourier(c, uid, q.id))) });
  }
  if (section === 'vendor') {
    const id = uuid(q.id);
    const hasPOs = (await db.query('SELECT 1 FROM purchase_orders WHERE vendor_id = $1 LIMIT 1', [id])).rows[0];
    const hasProducts = (await db.query('SELECT 1 FROM products WHERE vendor_id = $1 LIMIT 1', [id])).rows[0];
    if (hasPOs || hasProducts) {
      throw conflict('vendor_in_use', 'Cannot delete vendor with purchase orders or product inventory. Mark the vendor inactive instead.');
    }
    await db.query('DELETE FROM vendors WHERE id = $1', [id]);
    await audit(db, { actor: uid, action: 'delete_vendor', entityType: 'vendor', entityId: id });
    return res.json({ ok: true });
  }
  if (section === 'purchase_order') {
    const id = uuid(q.id);
    const po = (await db.query('SELECT status FROM purchase_orders WHERE id = $1', [id])).rows[0];
    if (!po) throw notFound('po_not_found', 'Purchase order not found');
    if (po.status === 'fulfilled') {
      throw conflict('fulfilled_po_immutable', 'Fulfilled purchase orders cannot be deleted.');
    }
    await db.query('DELETE FROM purchase_orders WHERE id = $1', [id]);
    await audit(db, { actor: uid, action: 'delete_purchase_order', entityType: 'purchase_order', entityId: id });
    return res.json({ ok: true });
  }
  if (section === 'customer') {
    const authUserId = text(q.id, { max: 80, field: 'id', required: true });
    const hasOrders = (await db.query("SELECT 1 FROM orders WHERE (auth_user_id = $1 OR customer_id = $1) AND payment_status = 'paid' LIMIT 1", [authUserId])).rows[0];
    if (hasOrders) {
      throw conflict('customer_has_orders', 'Cannot delete customer with purchase history. Customer records are preserved for accounting and loyalty.');
    }
    await db.tx(async (c) => {
      await c.query('DELETE FROM customer_profiles WHERE auth_user_id = $1', [authUserId]);
      await c.query('DELETE FROM wearer_profiles WHERE auth_user_id = $1', [authUserId]);
      await c.query('DELETE FROM profiles WHERE auth_user_id = $1', [authUserId]);
    });
    await audit(db, { actor: uid, action: 'delete_customer', entityType: 'customer', entityId: authUserId });
    return res.json({ ok: true });
  }
  if (section === 'sale') {
    const id = uuid(q.id, 'id');
    await db.tx(async (c) => {
      const order = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!order) throw notFound('sale_not_found', 'Sale not found');
      if (order.status === 'cancelled') return;
      const items = (await c.query('SELECT variant_id, quantity, product_id FROM order_items WHERE order_id = $1', [id])).rows;
      for (const it of items) {
        if (it.variant_id) {
          await c.query('UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1', [it.variant_id, it.quantity]);
        }
      }
      await syncProductInventory(c, items.map((i) => i.product_id).filter(Boolean));
      await c.query("UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      await audit(c, { actor: uid, action: 'cancel_sale', entityType: 'order', entityId: id, details: { total: order.total } });
    });
    return res.json({ ok: true });
  }
  if (section === 'admin') {
    return res.json({ ok: true, ...(await db.tx((c) => removeAdmin(c, uid, q.id))) });
  }
  if (section === 'loyalty') {
    await db.query('UPDATE loyalty_rules SET active = false, updated_at = now() WHERE id = $1', [uuid(q.id)]);
    return res.json({ ok: true });
  }
  if (section === 'content') {
    const id = uuid(q.id);
    if (q.type === 'instagram') {
      const r = await db.query('DELETE FROM instagram_content WHERE id = $1 RETURNING post_url, image_url', [id]);
      if (r.rows[0]) await releaseMedia([r.rows[0].post_url, r.rows[0].image_url].filter(Boolean), uid);
    } else if (q.type === 'video') {
      const r = await db.query('DELETE FROM feedback_videos WHERE id = $1 RETURNING video_url', [id]);
      if (r.rows[0]?.video_url) await releaseMedia([r.rows[0].video_url], uid);
    } else throw badRequest('unknown_content_type', 'Unknown content type');
    await audit(db, { actor: uid, action: `delete_${q.type}`, entityType: 'content', entityId: id });
    return res.json({ ok: true });
  }
  throw badRequest('unsupported_delete', 'Unsupported delete');
}

export default async function ops(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST' || req.method === 'PUT') return handleWrite(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
}
