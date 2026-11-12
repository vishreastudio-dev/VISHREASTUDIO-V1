import { db } from '../lib/db.js';
import { notFound } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { pageParams, uuid } from '../lib/validate.js';

export const access = 'user';
export const methods = ['GET'];

const ORDER_COLUMNS = `o.id, o.status, o.payment_status, o.subtotal, o.shipping_fee, o.gift_packing_fee, o.total, o.taxable_amount, o.tax_amount,
  o.cgst_amount, o.sgst_amount, o.igst_amount, o.place_of_supply, o.credits_used, o.shipping_address, o.shipping_method, o.tracking_number,
  o.courier_partner, o.tracking_url, COALESCE((SELECT cr.is_pickup FROM couriers cr WHERE cr.id = o.courier_id), false) AS courier_is_pickup, o.gift, o.invoice_number, o.payment_expires_at, o.paid_at, o.packed_at, o.dispatch_at, o.delivered_at, o.cancelled_at,
  o.refunded_at, o.razorpay_refund_id, o.updated_at, o.created_at, o.payment_failure_reason, o.buyer_gstin`;

export default async function orders(req, res) {
  const uid = req.user.id;

  if (req.query?.id) {
    const id = uuid(req.query.id, 'order_id');
    const o = (await db.query(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = $1 AND o.auth_user_id = $2`, [id, uid])).rows[0];
    if (!o) throw notFound('order_not_found', 'Order not found');
    const [items, invoice, exchanges, settings] = await Promise.all([
      db.query(
        `SELECT oi.product_id, oi.variant_id, oi.product_name AS name, oi.sku, oi.variant_label, oi.unit_price, oi.quantity, oi.line_total,
                oi.use_credit, oi.reward_entitlement_id, oi.gst_rate, oi.taxable_value, oi.gst_amount, oi.hsn_code, p.slug, p.image_url
           FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.created_at`,
        [id]
      ),
      db.query('SELECT invoice_number, issued_at, taxable_value, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount, hsn_summary, place_of_supply, buyer_name, buyer_gstin, seller_gstin FROM invoice_records WHERE order_id = $1', [id]),
      db.query('SELECT id, claim_type, reason, status, resolution, created_at, updated_at FROM exchanges WHERE order_id = $1 AND auth_user_id = $2 ORDER BY created_at DESC', [id, uid]),
      getSettings(),
    ]);
    return res.json({
      order: { ...o, items: items.rows, exchanges: exchanges.rows },
      invoice: invoice.rows[0]
        ? { ...invoice.rows[0], seller_gstin: invoice.rows[0].seller_gstin || settings.seller_gstin || null, seller_state: settings.seller_state, seller_legal_name: settings.seller_legal_name || null, seller_address: settings.seller_address || null }
        : null,
      policy: { exchange_days: Number(settings.exchange_days), damage_report_hours: Number(settings.damage_report_hours) },
    });
  }

  const { limit, offset, page } = pageParams(req.query, { defaultLimit: 20, maxLimit: 50 });
  const r = await db.query(
    `SELECT ${ORDER_COLUMNS}, count(*) OVER () AS total_count,
            COALESCE((SELECT json_agg(json_build_object('product_id', i.product_id, 'name', i.product_name, 'size', i.variant_label,
                       'unit_price', i.unit_price, 'quantity', i.quantity, 'slug', p.slug,
                       'image_url', COALESCE(p.image_url, CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images->>0 END)) ORDER BY i.created_at)
                        FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id), '[]') AS items
       FROM orders o WHERE o.auth_user_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json({ orders: r.rows.map(({ total_count, ...o }) => o), total: r.rows[0]?.total_count ?? 0, page, limit });
}
