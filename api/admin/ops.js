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
import { bool, email as validEmail, gstin, indianState, int, isSlug, mediaUrl, money, oneOf, pageParams, slugify, text, uuid } from '../../lib/validate.js';

export const access = 'admin';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 240 };

const ORDER_STATUSES = ['pending_payment', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'refund_required', 'refunded'];
const FULFILMENT_FLOW = { processing: ['packed', 'dispatched', 'cancelled'], packed: ['dispatched', 'processing', 'cancelled'], dispatched: ['delivered'], delivered: [], pending_payment: ['cancelled'] };
const EXCHANGE_STATUSES = ['requested', 'review', 'approved', 'rejected', 'completed'];
const EXCHANGE_FLOW = { requested: ['review', 'approved', 'rejected'], review: ['approved', 'rejected'], approved: ['completed'], rejected: [], completed: [] };

const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

async function dashboard(query = {}) {
  // Range is [from, to] inclusive of whole days; defaults to the current month.
  const from = isoDate(query.from);
  const to = isoDate(query.to);
  if (from && to && from > to) throw badRequest('invalid_range', 'The start date must be before the end date');
  const range = [from, to];
  const inRange = (col) => `${col} >= COALESCE($1::date, date_trunc('month', now())::date) AND ${col} < COALESCE($2::date + 1, now() + interval '1 day')`;
  const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows);
  const [[sales], [orders], [membershipSales], [products], [customers], [members], [credits], [exchanges], stockAge, gaps, [failed], [refunds], [gifts], [expiring]] = await Promise.all([
    q(`SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE payment_status='paid' AND ${inRange('paid_at')}`, range),
    q(`SELECT count(*)::int AS n FROM orders WHERE payment_status = 'paid' AND ${inRange('paid_at')}`, range),
    q(`SELECT COALESCE(SUM(amount),0) AS revenue, count(*)::int AS n FROM membership_payments WHERE status = 'paid' AND ${inRange('paid_at')}`, range),
    q('SELECT count(*)::int AS n FROM products WHERE is_active = true AND archived_at IS NULL'),
    q('SELECT count(*)::int AS n FROM customer_profiles'),
    q("SELECT count(*)::int AS n FROM memberships WHERE status = 'active'"),
    q("SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0)::int AS issued, COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0)::int AS used FROM credit_ledger WHERE created_at >= date_trunc('month', now())"),
    q("SELECT count(*)::int AS n FROM exchanges WHERE status IN ('requested','review')"),
    q("SELECT CASE WHEN i.updated_at < now()-interval '21 days' THEN '21+' WHEN i.updated_at < now()-interval '14 days' THEN '14-20' WHEN i.updated_at < now()-interval '7 days' THEN '7-13' ELSE '0-6' END AS age, count(*)::int AS count FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.status = 'available' AND p.is_active GROUP BY 1 ORDER BY 1"),
    q("SELECT v.size_label, p.colour_season, sum(v.stock_quantity)::int AS stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_active AND v.is_active GROUP BY v.size_label, p.colour_season ORDER BY stock ASC LIMIT 12"),
    q("SELECT count(*)::int AS n FROM membership_payments WHERE status = 'failed' AND attempted_at >= now() - interval '7 days'"),
    q("SELECT count(*)::int AS n FROM orders WHERE payment_status = 'refund_required'"),
    q("SELECT count(*)::int AS n FROM admin_gift_enquiries WHERE status = 'pending'"),
    q("SELECT count(*)::int AS n FROM memberships WHERE status IN ('active','paused') AND paid_through < now() + interval '7 days'"),
  ]);
  return {
    range: { from: from || null, to: to || null },
    revenue: Number(sales.revenue), orders: orders.n, membership_revenue: Number(membershipSales.revenue), membership_payments: membershipSales.n,
    total_revenue: Number(sales.revenue) + Number(membershipSales.revenue),
    products: products.n, customers: customers.n, members: members.n,
    credits_issued: credits.issued, credits_used: credits.used, exchanges: exchanges.n, failed_payments: failed.n,
    refunds_required: refunds.n, pending_gift_enquiries: gifts.n, memberships_ending_soon: expiring.n, stock_age: stockAge, gaps,
  };
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return `"${s.replaceAll('"', '""')}"`;
};

async function exportCsv(type, res) {
  const queries = {
    customers: 'SELECT auth_user_id, full_name, email, phone, gst_number, marketing_opt_in, whatsapp_opt_in, created_at FROM customer_profiles ORDER BY created_at DESC LIMIT 20000',
    products: `SELECT p.name, p.slug, c.name AS category, v.sku, v.size_label, v.price_inr, v.sale_price_inr, v.stock_quantity, v.is_active AS variant_active, p.is_active
                 FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN product_variants v ON v.product_id = p.id ORDER BY p.created_at DESC LIMIT 20000`,
    invoices: 'SELECT invoice_number, order_id, membership_payment_id, taxable_value, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount, place_of_supply, buyer_gstin, issued_at FROM invoice_records ORDER BY issued_at DESC LIMIT 20000',
    orders: `SELECT o.id, o.created_at, o.status, o.payment_status, o.subtotal, o.shipping_fee, o.total, o.tax_amount, o.invoice_number, o.channel, o.shipping_method,
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
  const q = req.query || {};
  const section = q.section || 'dashboard';
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
          `SELECT p.id, p.name, p.slug, p.price_inr, p.cost_price_inr, p.badge, p.is_active, p.archived_at, p.featured, p.is_one_of_one, p.image_url, p.images,
                  p.color, p.colour_season, p.size_label, p.category_id, p.credit_eligible, p.drop_id, c.name AS category, p.created_at,
                  COALESCE(vs.variants, '[]') AS variants, COALESCE(vs.stock, 0)::int AS stock_total, vs.min_price, vs.max_price
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN LATERAL (
               SELECT json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_label', v.size_label, 'price_inr', v.price_inr, 'sale_price_inr', v.sale_price_inr,
                                                 'stock_quantity', v.stock_quantity, 'is_active', v.is_active) ORDER BY v.sort_order, v.created_at) AS variants,
                      sum(v.stock_quantity) FILTER (WHERE v.is_active) AS stock, min(v.price_inr) FILTER (WHERE v.is_active) AS min_price, max(v.price_inr) FILTER (WHERE v.is_active) AS max_price
                 FROM product_variants v WHERE v.product_id = p.id) vs ON true
            WHERE ($1 = '' OR lower(p.name) LIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND lower(sv.sku) LIKE '%' || $1 || '%'))
              AND ($4::boolean OR p.archived_at IS NULL)
              AND ($5::uuid IS NULL OR p.category_id = $5)
              AND ($6 = '' OR ($6 = 'live' AND p.is_active AND p.archived_at IS NULL) OR ($6 = 'hidden' AND NOT p.is_active AND p.archived_at IS NULL)
                   OR ($6 = 'out_of_stock' AND COALESCE(vs.stock, 0) = 0) OR ($6 = 'low_stock' AND COALESCE(vs.stock, 0) BETWEEN 1 AND 2))
            ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
          [search, limit, offset, bool(q.include_archived), q.category_id ? uuid(q.category_id, 'category_id') : null, oneOf(q.state || '', ['', 'live', 'hidden', 'out_of_stock', 'low_stock'], { field: 'state' })]
        ),
        drops: await rows('SELECT id, name, starts_at, public_at FROM drop_settings WHERE active ORDER BY starts_at DESC LIMIT 50'),
      });
    }
    case 'product':
      return res.json({ product: await getProductWithVariants(db, uuid(q.id)) });
    case 'categories':
      return res.json({ categories: await rows('SELECT * FROM categories ORDER BY sort_order, name') });
    case 'orders': {
      // Abandoned checkouts (never paid, then expired or cancelled) are hidden unless asked for.
      const showAbandoned = bool(q.abandoned) || ['expired', 'cancelled'].includes(q.payment_status) || ['expired', 'cancelled'].includes(q.status);
      const abandoned = "(o.paid_at IS NULL AND o.payment_status IN ('expired', 'cancelled'))";
      return res.json({
        abandoned_hidden: showAbandoned ? 0 : (await rows(`SELECT count(*)::int AS n FROM orders o WHERE ${abandoned}`))[0].n,
        orders: await rows(
          `SELECT o.id, o.auth_user_id, o.status, o.payment_status, o.total, o.tax_amount, o.channel, o.shipping_method, o.tracking_number, o.courier_partner, o.courier_id, o.tracking_url, o.invoice_number,
                  o.created_at, o.paid_at, o.payment_failure_reason, cp.full_name, cp.email,
                  COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'sku', i.sku, 'qty', i.quantity, 'image_url', p.image_url, 'images', p.images))
                              FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id), '[]') AS items
             FROM orders o LEFT JOIN customer_profiles cp ON cp.auth_user_id = o.auth_user_id
            WHERE ($1 = '' OR o.payment_status = $1) AND ($4 = '' OR o.status = $4) AND ($6::boolean OR NOT ${abandoned})
              AND ($5 = '' OR o.id::text LIKE $5 || '%' OR lower(COALESCE(cp.email, '')) LIKE '%' || $5 || '%' OR lower(COALESCE(cp.full_name, '')) LIKE '%' || $5 || '%'
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
    case 'customers':
      return res.json({
        customers: await rows(
          `SELECT cp.auth_user_id, cp.full_name, cp.email, cp.phone, cp.marketing_opt_in, cp.created_at, m.status AS membership_status, m.credits_balance,
                  (SELECT count(*)::int FROM orders o WHERE o.auth_user_id = cp.auth_user_id AND o.payment_status = 'paid') AS order_count
             FROM customer_profiles cp LEFT JOIN memberships m ON m.auth_user_id = cp.auth_user_id
            WHERE ($3 = '' OR lower(COALESCE(cp.full_name, '')) LIKE '%' || $3 || '%' OR lower(COALESCE(cp.email, '')) LIKE '%' || $3 || '%'
                   OR regexp_replace(COALESCE(cp.phone, ''), '\\D', '', 'g') LIKE '%' || NULLIF(regexp_replace($3, '\\D', '', 'g'), '') || '%')
              AND ($4 = '' OR ($4 = 'none' AND m.id IS NULL) OR m.status = $4)
            ORDER BY cp.created_at DESC LIMIT $1 OFFSET $2`,
          [
            limit,
            offset,
            String(q.q || '').trim().toLowerCase().slice(0, 80),
            oneOf(q.membership || '', ['', 'none', 'active', 'paused', 'expired', 'cancelled', 'pending_payment', 'payment_failed', 'inactive'], { field: 'membership' }),
          ]
        ),
      });
    case 'memberships':
      return res.json({ memberships: await rows('SELECT m.*, cp.full_name, cp.email FROM memberships m LEFT JOIN customer_profiles cp ON cp.auth_user_id = m.auth_user_id ORDER BY m.updated_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
    case 'credits':
      return res.json({ credits: await rows('SELECT cl.*, cp.full_name, cp.email FROM credit_ledger cl LEFT JOIN customer_profiles cp ON cp.auth_user_id = cl.auth_user_id ORDER BY cl.created_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
    case 'exchanges': {
      const list = await rows('SELECT e.*, o.total, o.delivered_at, cp.full_name, cp.email FROM exchanges e JOIN orders o ON o.id = e.order_id LEFT JOIN customer_profiles cp ON cp.auth_user_id = e.auth_user_id ORDER BY e.created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
      // Evidence is private: staff get short-lived signed links, generated per request and never cached.
      for (const e of list) {
        const refs = Array.isArray(e.evidence_urls) ? e.evidence_urls : [];
        e.evidence = await Promise.all(refs.map(async (ref) => ({ ref, url: await displayUrl(ref) })));
      }
      return res.json({ exchanges: list });
    }
    case 'loyalty': {
      const [rules, events] = await Promise.all([rows('SELECT * FROM loyalty_rules ORDER BY created_at DESC LIMIT 200'), rows('SELECT le.*, lr.name AS rule_name FROM loyalty_events le LEFT JOIN loyalty_rules lr ON lr.id = le.rule_id ORDER BY le.created_at DESC LIMIT 100')]);
      return res.json({ rules, events });
    }
    case 'drops':
      return res.json({ drops: await rows('SELECT * FROM drop_settings ORDER BY starts_at DESC LIMIT 200') });
    case 'sourcing':
      return res.json({ batches: await rows('SELECT * FROM sourcing_batches ORDER BY batch_date DESC, created_at DESC LIMIT 200') });
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
        `SELECT p.auth_user_id, p.email, p.role, p.is_admin, p.is_active, p.created_at, cp.full_name, cp.phone, cp.gst_number, cp.marketing_opt_in, cp.whatsapp_opt_in, cp.referral_code
           FROM profiles p LEFT JOIN customer_profiles cp ON cp.auth_user_id = p.auth_user_id WHERE p.auth_user_id = $1`,
        [id]
      ))[0];
      if (!profile) throw notFound('customer_not_found', 'Customer not found');
      const [membership, wearers, orders, colour, referrals, rewards, credits, periods] = await Promise.all([
        rows('SELECT * FROM memberships WHERE auth_user_id = $1', [id]),
        rows('SELECT id, name, relationship, size_label, bust_cm, waist_cm, hip_cm, length_cm, birthday, created_at FROM wearer_profiles WHERE auth_user_id = $1 ORDER BY created_at', [id]),
        rows(`SELECT o.id, o.created_at, o.status, o.payment_status, o.total, o.invoice_number, o.channel, o.credits_used, o.rewards_used,
                     COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'size', i.variant_label, 'qty', i.quantity)) FROM order_items i WHERE i.order_id = o.id), '[]') AS items
                FROM orders o WHERE o.auth_user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [id]),
        rows('SELECT undertone, season, palette, confidence, lighting, created_at FROM colour_reviews WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 5', [id]),
        rows(`SELECT r.id, r.status, r.referred_email, r.referrer_user_id, r.referred_user_id, r.attributed_at, r.qualified_at FROM referrals r
               WHERE (r.referrer_user_id = $1 OR r.referred_user_id = $1) AND r.referred_user_id IS NOT NULL ORDER BY r.created_at DESC`, [id]),
        rows('SELECT * FROM reward_entitlements WHERE auth_user_id = $1 ORDER BY created_at DESC', [id]),
        rows('SELECT delta, reason, expires_at, order_id, created_at FROM credit_ledger WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
        rows(`SELECT mp.month_index, mp.streak_month, mp.source, mp.starts_at, mp.ends_at, mp.credits, mp.credits_granted_at, mp.voided_at
                FROM membership_periods mp JOIN memberships m ON m.id = mp.membership_id WHERE m.auth_user_id = $1 ORDER BY mp.starts_at DESC LIMIT 36`, [id]),
      ]);
      return res.json({ profile, membership: membership[0] || null, periods, wearers, orders, colour_reviews: colour, referrals, rewards, credits });
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
    case 'store':
      return res.json({
        products: await rows(
          `SELECT p.id, p.name, v.id AS variant_id, v.sku, v.size_label, v.price_inr, v.sale_price_inr, v.stock_quantity
             FROM products p JOIN product_variants v ON v.product_id = p.id
            WHERE p.is_active AND v.is_active AND v.stock_quantity > 0 ORDER BY p.name, v.sort_order LIMIT 1000`
        ),
      });
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
  const o = (await c.query(
    `INSERT INTO orders (auth_user_id, status, payment_status, subtotal, shipping_fee, total, channel, shipping_method, amount_paise, paid_at, delivered_at,
                         taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount, place_of_supply, credits_used, shipping_address)
     VALUES ($1,'delivered','paid',$2,0,$3,'store','pickup',$4,now(),now(),$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [customerId, price.subtotal, price.total, price.amount_paise, price.taxable_amount, price.cgst, price.sgst, price.igst, price.tax_amount,
     price.place_of_supply, price.credits_used, JSON.stringify({ name: text(b.customer_name, { max: 120, field: 'customer_name' }) || 'Studio customer' })]
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
    else await db.query('INSERT INTO categories (name, slug, is_active, sort_order, parent_id) VALUES ($1,$2,$3,$4,$5)', [name, slug, b.is_active !== false, sort, parent]);
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
      if (['approved', 'rejected'].includes(next) && next !== x.status && !text(b.resolution ?? x.resolution, { max: 500, field: 'resolution' })) {
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

  if (section === 'store_sale') {
    const r = await db.tx((c) => storeSale(c, uid, b));
    return res.json({ ok: true, ...r });
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
  const section = q.section;
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
