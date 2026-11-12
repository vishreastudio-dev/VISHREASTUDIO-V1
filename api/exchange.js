import { db } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { oneOf, text, uuid } from '../lib/validate.js';

export const access = 'user';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 20 };

export default async function exchange(req, res) {
  const uid = req.user.id;
  if (req.method === 'POST') {
    const b = req.body || {};
    const orderId = uuid(b.order_id, 'order_id');
    const reason = text(b.reason, { max: 500, field: 'reason', required: true });
    const claimType = oneOf(b.claim_type, ['exchange', 'damage'], { field: 'claim_type', fallback: /damage/i.test(reason) ? 'damage' : 'exchange' });
    // Evidence must be private uploads made by this customer (see /api/upload); anything else is ignored.
    const asked = [...new Set((Array.isArray(b.evidence_urls) ? b.evidence_urls : []).filter((v) => typeof v === 'string'))].slice(0, 5);
    const owned = asked.length
      ? (await db.query("SELECT ref FROM media_objects WHERE ref = ANY($1) AND purpose = 'evidence' AND owner_id = $2 AND deleted_at IS NULL", [asked, uid])).rows.map((r) => r.ref)
      : [];
    const evidence = asked.filter((ref) => owned.includes(ref));
    // EXC-03: a damage claim must come with photos.
    if (claimType === 'damage' && !evidence.length) throw badRequest('damage_photos_required', 'Add at least one photo of the damage');

    const settings = await getSettings();
    const created = await db.tx(async (c) => {
      const o = (await c.query('SELECT id, payment_status, status, delivered_at FROM orders WHERE id = $1 AND auth_user_id = $2 FOR UPDATE', [orderId, uid])).rows[0];
      if (!o) throw notFound('order_not_found', 'Order not found');
      if (o.payment_status !== 'paid') throw badRequest('order_not_paid', 'Exchanges are available for paid orders only');
      if (o.status !== 'delivered' || !o.delivered_at) throw badRequest('order_not_delivered', 'You can raise a request once your order has been delivered');
      const ageHours = (Date.now() - new Date(o.delivered_at).getTime()) / 3_600_000;
      if (claimType === 'damage' && ageHours > Number(settings.damage_report_hours)) {
        throw badRequest('damage_window_closed', `Damage must be reported within ${settings.damage_report_hours} hours of delivery`);
      }
      if (claimType === 'exchange' && ageHours > Number(settings.exchange_days) * 24) {
        throw badRequest('exchange_window_closed', `Exchanges are available within ${settings.exchange_days} days of delivery`);
      }
      const open = await c.query("SELECT 1 FROM exchanges WHERE order_id = $1 AND status IN ('requested','review')", [orderId]);
      if (open.rows[0]) throw conflict('exchange_already_open', 'There is already an open request for this order');
      const r = await c.query(
        'INSERT INTO exchanges (order_id, auth_user_id, reason, claim_type, evidence_urls) VALUES ($1,$2,$3,$4,$5) RETURNING id, order_id, claim_type, reason, status, created_at',
        [orderId, uid, reason, claimType, JSON.stringify(evidence)]
      );
      await audit(c, { actor: uid, action: 'exchange_requested', entityType: 'exchange', entityId: r.rows[0].id, details: { order_id: orderId, claim_type: claimType } });
      return r.rows[0];
    });
    return res.status(201).json({ exchange: created, ...(await list(uid)) });
  }
  res.json(await list(uid));
}

async function list(uid) {
  const r = await db.query('SELECT id, order_id, claim_type, reason, status, resolution, created_at FROM exchanges WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 100', [uid]);
  return { exchanges: r.rows };
}
