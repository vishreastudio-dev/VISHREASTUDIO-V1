import { db } from '../lib/db.js';
import { AppError, notFound } from '../lib/http.js';
import { issueLocalOrderPayment } from '../lib/local-pay.js';
import { audit } from '../lib/audit.js';
import { hit } from '../lib/rate-limit.js';
import { confirmGiftPayment, redeemGiftToken, startGiftPurchase } from '../lib/gifts.js';
import { getSettings } from '../lib/settings.js';
import { email as validEmail, int, oneOf, phone, text, uuid } from '../lib/validate.js';

// Enquiries may come from guests; redemption and history need a session.
export const access = 'public';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 20 };

const PUBLIC_COLUMNS = 'id, enquiry_number, request_type, source, gift_mode, recipient_name, membership_months, quantity, status, amount, paid_at, refund_status, start_date, created_at, updated_at';

function enquiryValues(b, settings) {
  const types = settings.gift_enquiry_types;
  const durations = settings.gift_membership_months;
  const requestType = oneOf(b.request_type, types, { field: 'request_type', fallback: types[0] });
  return {
    request_type: requestType,
    sender_name: text(b.sender_name, { max: 120, field: 'sender_name', required: true }),
    sender_email: validEmail(b.sender_email, 'sender_email'),
    sender_phone: phone(b.sender_phone, { required: true }),
    company_name: requestType === 'corporate' ? text(b.company_name, { max: 160, field: 'company_name', required: true }) : null,
    recipient_name: requestType === 'individual' ? text(b.recipient_name, { max: 120, field: 'recipient_name', required: true }) : text(b.recipient_name, { max: 120, field: 'recipient_name' }),
    recipient_email: b.recipient_email ? validEmail(b.recipient_email, 'recipient_email') : null,
    recipient_phone: b.recipient_phone ? phone(b.recipient_phone) : null,
    membership_months: b.membership_months === undefined || b.membership_months === '' ? durations[0] : oneOf(Number(b.membership_months), durations, { field: 'membership_months' }),
    quantity: requestType === 'corporate' ? int(b.quantity ?? 1, { min: 1, max: 100, field: 'quantity' }) : 1,
    message: text(b.message, { max: 1000, field: 'message' }),
  };
}

export default async function gifting(req, res) {
  const user = req.user || null;
  const b = req.body || {};

  if (req.method === 'POST' && (b.action === 'purchase' || b.action === 'confirm_payment' || b.action === 'complete_local')) {
    if (!user) throw new AppError(401, 'unauthorized', 'Please sign in to buy a gift membership');
    if (b.action === 'purchase') return res.json(await startGiftPurchase(user, b));
    if (b.action === 'complete_local') {
      const id = uuid(b.enquiry_id, 'enquiry_id');
      const e = (await db.query('SELECT * FROM admin_gift_enquiries WHERE id = $1 AND submitted_by = $2', [id, user.id])).rows[0];
      if (!e) throw notFound('gift_not_found', 'No gift purchase found for this payment');
      return res.json(await issueLocalOrderPayment({ gatewayOrderId: e.razorpay_order_id, amountPaise: Math.round(Number(e.amount) * 100), outcome: b.outcome }));
    }
    const r = await confirmGiftPayment(user, b);
    if (r.status === 'pending_confirmation') throw new AppError(503, 'payment_confirmation_pending', 'Your payment is being confirmed. Refresh in a moment — you will not be charged twice.');
    return res.json({ ok: true, ...r });
  }

  if (req.method === 'POST' && b.action === 'redeem') {
    if (!user) throw new AppError(401, 'unauthorized', 'Please sign in to redeem your gift');
    const limiter = hit(`gift_redeem:${user.id}`, { windowMs: 60 * 60_000, max: 10 });
    if (!limiter.allowed) throw new AppError(429, 'rate_limited', 'Too many attempts. Please try again later.');
    const membership = await db.tx((c) => redeemGiftToken(c, user, b.token));
    return res.json({ ok: true, membership });
  }

  if (req.method === 'POST') {
    const limiter = hit(`gift_enquiry:${user?.id || req.ip}`, { windowMs: 60 * 60_000, max: 6 });
    if (!limiter.allowed) throw new AppError(429, 'rate_limited', 'Too many enquiries. Please try again later.');
    const v = enquiryValues(b, await getSettings());
    const submissionKey = b.submission_key ? text(b.submission_key, { max: 80, field: 'submission_key' }) : null;
    // A double submit (same key, or the same enquiry from the same sender within 10 minutes) returns the first one.
    const dup = (await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM admin_gift_enquiries
        WHERE ($1::text IS NOT NULL AND submission_key = $1)
           OR (lower(sender_email) = $2 AND request_type = $3 AND recipient_name IS NOT DISTINCT FROM $4 AND recipient_email IS NOT DISTINCT FROM $5
               AND membership_months = $6 AND quantity = $7 AND created_at > now() - interval '10 minutes')
        ORDER BY created_at LIMIT 1`,
      [submissionKey, v.sender_email, v.request_type, v.recipient_name, v.recipient_email, v.membership_months, v.quantity]
    )).rows[0];
    if (dup) return res.json({ ok: true, duplicate: true, enquiry: dup });
    const cols = Object.keys(v);
    const r = await db.query(
      `INSERT INTO admin_gift_enquiries (${cols.join(', ')}, submitted_by, submission_key) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 2})
       ON CONFLICT (submission_key) WHERE submission_key IS NOT NULL DO NOTHING RETURNING ${PUBLIC_COLUMNS}`,
      [...cols.map((k) => v[k]), user?.id || null, submissionKey]
    );
    const enquiry = r.rows[0] || (await db.query(`SELECT ${PUBLIC_COLUMNS} FROM admin_gift_enquiries WHERE submission_key = $1`, [submissionKey])).rows[0];
    await audit(db, { actor: user?.id || 'guest', action: 'gift_enquiry_created', entityType: 'gift_enquiry', entityId: enquiry.id, details: { type: v.request_type, months: v.membership_months } });
    return res.status(r.rows[0] ? 201 : 200).json({ ok: true, enquiry });
  }

  if (!user) throw new AppError(401, 'unauthorized', 'Please sign in to view your gift enquiries');
  const r = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_gift_enquiries WHERE submitted_by = $1 OR lower(sender_email) = lower($2) ORDER BY created_at DESC LIMIT 50`,
    [user.id, user.email]
  );
  res.json({ enquiries: r.rows });
}
