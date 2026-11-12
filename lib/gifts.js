/**
 * Gift memberships are fulfilled by the studio: a customer submits an enquiry, the admin processes
 * and invoices it offline, then issues one redemption token per gifted membership. Only the token's
 * SHA-256 hash is stored; the plaintext is shown to the admin once. A token activates a membership
 * exactly once, and only while its enquiry is invoiced and the token is unexpired.
 */
import crypto from 'crypto';
import { audit } from './audit.js';
import { config } from './config.js';
import { db } from './db.js';
import { log } from './log.js';
import { AppError, badRequest, conflict, notFound } from './http.js';
import { appendMembershipMonths, grantDuePeriods } from './membership.js';
import { getSettings } from './settings.js';
import { calculateMembershipPrice } from './pricing.js';
import { razorpay, verifyPaymentSignature } from './razorpay.js';
import { checkoutFields, issueLocalOrderPayment } from './local-pay.js';
import { notify } from './notify.js';
import { applyEntityRefund } from './payments.js';
import { email as validEmail, oneOf, phone, text, uuid } from './validate.js';

export const GIFT_ENQUIRY_FLOW = { pending: ['processed'], processed: ['invoiced'], invoiced: [] };

export const hashGiftToken = (token) => crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
export const giftRedeemLink = (token) => `${config.publicSiteUrl}/gift/redeem#${token}`;

export async function issueGiftToken(c, actor, enquiryId) {
  const settings = await getSettings(c);
  const e = (await c.query('SELECT * FROM admin_gift_enquiries WHERE id = $1 FOR UPDATE', [enquiryId])).rows[0];
  if (!e) throw notFound('gift_enquiry_not_found', 'Gift enquiry not found');
  if (e.status !== 'invoiced') throw conflict('gift_not_invoiced', 'Record the invoice before issuing redemption codes');
  if (e.source === 'online' && !e.paid_at) throw conflict('gift_not_paid', 'This online gift has not been paid');
  if (e.refund_status === 'refunded') throw conflict('gift_refunded', 'This gift was refunded; no redemption code can be issued');
  const issued = (await c.query("SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1 AND status <> 'revoked'", [e.id])).rows[0].n;
  if (issued >= e.quantity) throw conflict('gift_tokens_exhausted', `All ${e.quantity} redemption code(s) for this enquiry have been issued`);
  const token = crypto.randomBytes(24).toString('base64url');
  const days = Math.max(1, Number(settings.gift_token_valid_days) || 90);
  const g = (await c.query(
    `INSERT INTO gift_memberships (enquiry_id, membership_months, token_hash, token_hint, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id, membership_months, token_hint, status, expires_at, created_at`,
    [e.id, e.membership_months, hashGiftToken(token), token.slice(-4), actor, days]
  )).rows[0];
  await audit(c, { actor, action: 'gift_token_issued', entityType: 'gift_membership', entityId: g.id, details: { enquiry_id: e.id } });
  return { ...g, token, link: giftRedeemLink(token) };
}

export async function redeemGiftToken(c, user, token) {
  const raw = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(raw)) throw badRequest('invalid_gift_code', 'This gift code is not valid');
  const g = (await c.query('SELECT * FROM gift_memberships WHERE token_hash = $1 FOR UPDATE', [hashGiftToken(raw)])).rows[0];
  if (!g) throw badRequest('invalid_gift_code', 'This gift code is not valid');
  if (g.status === 'redeemed') throw conflict('gift_already_redeemed', 'This gift has already been redeemed');
  if (g.status !== 'issued') throw badRequest('invalid_gift_code', 'This gift code is no longer valid');
  if (new Date(g.expires_at) <= new Date()) throw badRequest('gift_code_expired', 'This gift code has expired. Please contact the studio.');
  const e = (await c.query("SELECT status, start_date, to_char(start_date, 'DD Mon YYYY') AS starts FROM admin_gift_enquiries WHERE id = $1", [g.enquiry_id])).rows[0];
  if (e?.status !== 'invoiced') throw conflict('gift_not_ready', 'This gift is not ready to redeem yet. Please contact the studio.');
  if (e.start_date && (await c.query("SELECT $1::date > (now() AT TIME ZONE 'Asia/Kolkata')::date AS later", [e.start_date])).rows[0].later) {
    throw conflict('gift_not_started', `This gift starts on ${e.starts}. You can activate it from that day.`);
  }

  const settings = await getSettings(c);
  let m = (await c.query('SELECT * FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [user.id])).rows[0];
  if (m && ['active', 'retrying', 'pending_authorisation'].includes(m.billing_status) && ['active', 'paused', 'pending_payment'].includes(m.status)) {
    // Prepaid gift months cannot sit on top of a running autopay mandate without double billing.
    throw conflict('autopay_membership_active', 'You already have a membership on UPI Autopay. Redeem this gift after cancelling autopay, or contact the studio to apply it.');
  }
  if (!m) {
    m = (await c.query(
      "INSERT INTO memberships (auth_user_id, status, monthly_price, credits_per_month, credits_balance, upfront_months, gift) VALUES ($1,'inactive',$2,$3,0,$4,true) RETURNING *",
      [user.id, settings.membership_price, settings.credits_per_month, g.membership_months]
    )).rows[0];
  }
  const claimed = await c.query(
    "UPDATE gift_memberships SET status = 'redeemed', redeemed_by = $2, redeemed_at = now(), membership_id = $3 WHERE id = $1 AND status = 'issued' RETURNING id",
    [g.id, user.id, m.id]
  );
  if (!claimed.rows[0]) throw conflict('gift_already_redeemed', 'This gift has already been redeemed');
  await appendMembershipMonths(c, { membershipId: m.id, months: g.membership_months, source: 'gift', giftMembershipId: g.id, creditsPerMonth: Number(settings.credits_per_month) || 4, settings });
  await c.query("UPDATE memberships SET gift = true, billing_status = CASE WHEN billing_status IN ('none', 'cancelled', 'completed') THEN 'prepaid' ELSE billing_status END WHERE id = $1", [m.id]);
  await grantDuePeriods(c, m.id, settings);
  await audit(c, { actor: user.id, action: 'gift_redeemed', entityType: 'gift_membership', entityId: g.id, details: { months: g.membership_months } });
  return (await c.query('SELECT status, paid_through, credits_balance FROM memberships WHERE id = $1', [m.id])).rows[0];
}

/**
 * Online gift purchase (MEM-12..14): a pre-booked membership of `gift_membership_months` (minimum 2),
 * paid once, never on autopay. Two modes:
 * - gift_to_her: the wearer receives a one-time activation link and sets up her own account;
 * - pick_for_her: the gifter keeps the membership and picks for the saved wearer profile.
 * The ₹50 gift packing (MEM-15) is charged per gift box at checkout ("This is a gift").
 */
export async function startGiftPurchase(user, b) {
  const settings = await getSettings();
  const months = oneOf(Number(b.membership_months), settings.gift_membership_months, { field: 'membership_months' });
  const mode = oneOf(b.gift_mode, ['gift_to_her', 'pick_for_her'], { field: 'gift_mode' });
  const sender = {
    sender_name: text(b.sender_name || user.name, { max: 120, field: 'sender_name', required: true }),
    sender_email: validEmail(b.sender_email || user.email, 'sender_email'),
    sender_phone: phone(b.sender_phone, { required: true }),
  };
  let recipient = { recipient_name: null, recipient_email: null, recipient_phone: null, wearer_id: null, start_date: null };
  if (mode === 'gift_to_her') {
    recipient = {
      recipient_name: text(b.recipient_name, { max: 120, field: 'recipient_name', required: true }),
      recipient_email: validEmail(b.recipient_email, 'recipient_email'),
      recipient_phone: b.recipient_phone ? phone(b.recipient_phone) : null,
      wearer_id: null,
      start_date: null,
    };
    if (b.start_date) {
      const d = new Date(`${String(b.start_date).slice(0, 10)}T00:00:00+05:30`);
      const days = (d.getTime() - Date.now()) / 86_400_000;
      if (Number.isNaN(d.getTime()) || days < -1 || days > 90) throw badRequest('invalid_start_date', 'Choose a start date within the next 90 days');
      recipient.start_date = String(b.start_date).slice(0, 10);
    }
  } else {
    const wearerId = uuid(b.wearer_id, 'wearer_id');
    const w = (await db.query('SELECT id, name FROM wearer_profiles WHERE id = $1 AND auth_user_id = $2', [wearerId, user.id])).rows[0];
    if (!w) throw badRequest('wearer_not_found', 'Choose one of your saved wearer profiles');
    const m = (await db.query('SELECT status, billing_status FROM memberships WHERE auth_user_id = $1', [user.id])).rows[0];
    if (m && ['active', 'retrying', 'pending_authorisation'].includes(m.billing_status) && ['active', 'paused', 'pending_payment'].includes(m.status)) {
      throw conflict('autopay_membership_active', 'Your account already has a membership on UPI Autopay. Choose "Gift to her" to send this gift to her own account.');
    }
    recipient = { recipient_name: w.name, recipient_email: null, recipient_phone: null, wearer_id: w.id, start_date: null };
  }
  const price = calculateMembershipPrice(settings, { months });
  if (!razorpay.configured) throw new AppError(503, 'payments_unavailable', 'Online payment is not available right now. Please try again later.');
  const submissionKey = b.submission_key ? text(b.submission_key, { max: 80, field: 'submission_key' }) : null;

  const prior = async () => (submissionKey ? (await db.query('SELECT * FROM admin_gift_enquiries WHERE submission_key = $1', [submissionKey])).rows[0] : null);
  let enquiry = await prior();
  if (!enquiry) {
    enquiry = (await db.query(
      `INSERT INTO admin_gift_enquiries (request_type, source, gift_mode, sender_name, sender_email, sender_phone, recipient_name, recipient_email, recipient_phone,
                                         wearer_id, start_date, membership_months, quantity, message, amount, submitted_by, submission_key)
       VALUES ('individual', 'online', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13, $14)
       ON CONFLICT (submission_key) WHERE submission_key IS NOT NULL DO NOTHING RETURNING *`,
      [mode, sender.sender_name, sender.sender_email, sender.sender_phone, recipient.recipient_name, recipient.recipient_email, recipient.recipient_phone,
       recipient.wearer_id, recipient.start_date, months, text(b.message, { max: 1000, field: 'message' }), price.total, user.id, submissionKey]
    )).rows[0];
    if (enquiry) await audit(db, { actor: user.id, action: 'gift_purchase_started', entityType: 'gift_enquiry', entityId: enquiry.id, details: { months, mode, amount: price.total } });
    else enquiry = await prior();
  }
  if (enquiry.submitted_by !== user.id || enquiry.source !== 'online') throw conflict('submission_key_in_use', 'Please refresh the page and try again.');
  // A paid gift is never charged again from the same form submission (double click, back button, retry).
  if (enquiry.paid_at) throw conflict('gift_already_paid', `This gift (${enquiry.enquiry_number}) is already paid. Start a new gift to buy another.`);
  if (!enquiry.razorpay_order_id) {
    const rp = await razorpay.createOrder({ amountPaise: price.amount_paise, receipt: `gift-${enquiry.id}`, notes: { gift_enquiry_id: enquiry.id, customer: user.id } });
    if (Number(rp.amount) !== price.amount_paise || rp.currency !== 'INR') throw new AppError(502, 'payment_gateway_error', 'Gateway amount mismatch');
    enquiry = (await db.query('UPDATE admin_gift_enquiries SET razorpay_order_id = $2, updated_at = now() WHERE id = $1 AND razorpay_order_id IS NULL RETURNING *', [enquiry.id, rp.id])).rows[0]
      || (await db.query('SELECT * FROM admin_gift_enquiries WHERE id = $1', [enquiry.id])).rows[0];
  }
  return {
    enquiry_id: enquiry.id,
    enquiry_number: enquiry.enquiry_number,
    amount: Number(enquiry.amount),
    months,
    gift_mode: mode,
    razorpay: checkoutFields({ key_id: razorpay.keyId, order_id: enquiry.razorpay_order_id, amount: Math.round(Number(enquiry.amount) * 100), currency: 'INR', name: 'Vishrea Studio', description: `Gift · Walkin Wardrobe ${months} months`, local_confirm: { path: '/api/gifting', body: { action: 'complete_local', enquiry_id: enquiry.id } } }),
  };
}

/** Mark a gift paid exactly once (browser verification or webhook), issue the code and deliver it. */
export async function finalizeGiftPurchase({ enquiryId, paymentId, amountPaise, source }) {
  const r = await db.tx(async (c) => {
    const e = (await c.query('SELECT * FROM admin_gift_enquiries WHERE id = $1 FOR UPDATE', [enquiryId])).rows[0];
    if (!e || e.source !== 'online') return { status: 'ignored' };
    if (e.paid_at) return { status: e.provider_payment_id === paymentId ? 'already_paid' : 'duplicate_payment' };
    if (Number(amountPaise) !== Math.round(Number(e.amount) * 100)) {
      log.warn('gift.amount_mismatch', { enquiry_id: e.id, amount_paise: amountPaise });
      return { status: 'amount_mismatch' };
    }
    await c.query(
      `UPDATE admin_gift_enquiries SET status = 'invoiced', provider_payment_id = $2, paid_at = now(), invoice_reference = $2, invoice_amount = amount,
              processed_at = now(), invoiced_at = now(), status_changed_by = 'system', status_changed_at = now(), updated_at = now() WHERE id = $1`,
      [e.id, paymentId]
    );
    const token = await issueGiftToken(c, source === 'webhook' ? 'razorpay_webhook' : e.submitted_by, e.id);
    if (e.start_date) {
      // The code stays valid for the usual period counted from the chosen start date.
      await c.query(
        `UPDATE gift_memberships SET expires_at = GREATEST(expires_at, ($2::date + make_interval(days => $3))::timestamptz) WHERE id = $1`,
        [token.id, e.start_date, Math.max(1, Number((await getSettings(c)).gift_token_valid_days) || 90)]
      );
    }
    let membership = null;
    if (e.gift_mode === 'pick_for_her') {
      const buyer = (await c.query('SELECT auth_user_id AS id, email FROM profiles WHERE auth_user_id = $1', [e.submitted_by])).rows[0];
      membership = await redeemGiftToken(c, buyer, token.token);
      await c.query("UPDATE memberships SET gift_mode = 'pick_for_her', gift_wearer_id = $2, gift_message = $3 WHERE auth_user_id = $1", [e.submitted_by, e.wearer_id, e.message]);
    }
    await audit(c, { actor: source === 'webhook' ? 'razorpay_webhook' : e.submitted_by, action: 'gift_purchase_paid', entityType: 'gift_enquiry', entityId: e.id, details: { payment_id: paymentId, mode: e.gift_mode } });
    return { status: 'paid', enquiry: e, token, membership };
  });
  if (r.status === 'paid' && r.enquiry.gift_mode === 'gift_to_her') {
    await notify(db, {
      event: 'gift_received',
      to: { email: r.enquiry.recipient_email, phone: r.enquiry.recipient_phone },
      data: { from: r.enquiry.sender_name, months: r.enquiry.membership_months, message: r.enquiry.message, link: r.token.link, starts: r.enquiry.start_date ? new Date(r.enquiry.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null },
      dedupeKey: `gift:${r.enquiry.id}`,
    });
  }
  return { status: r.status, gift_mode: r.enquiry?.gift_mode, membership: r.membership || null, token_hint: r.token?.token_hint || null };
}

export async function confirmGiftPayment(user, b) {
  const rzpOrderId = text(b.razorpay_order_id, { max: 64, field: 'razorpay_order_id', required: true });
  const paymentId = text(b.razorpay_payment_id, { max: 64, field: 'razorpay_payment_id', required: true });
  const signature = text(b.razorpay_signature, { max: 128, field: 'razorpay_signature', required: true });
  const e = (await db.query('SELECT * FROM admin_gift_enquiries WHERE razorpay_order_id = $1 AND submitted_by = $2', [rzpOrderId, user.id])).rows[0];
  if (!e) throw notFound('gift_not_found', 'No gift purchase found for this payment');
  if (!verifyPaymentSignature({ razorpayOrderId: rzpOrderId, razorpayPaymentId: paymentId, signature })) {
    await audit(db, { actor: user.id, action: 'gift_payment_signature_invalid', entityType: 'gift_enquiry', entityId: e.id, details: { payment_id: paymentId } });
    log.warn('gift.invalid_signature', { enquiry_id: e.id });
    throw badRequest('invalid_payment_signature', 'Payment could not be verified');
  }
  let p;
  try {
    p = await razorpay.fetchPayment(paymentId);
  } catch (err) {
    if (err instanceof AppError && err.upstreamStatus >= 400 && err.upstreamStatus < 500) throw badRequest('payment_not_verified', 'Payment could not be confirmed with the gateway.');
    return { status: 'pending_confirmation' };
  }
  const expected = Math.round(Number(e.amount) * 100);
  if (p.order_id !== rzpOrderId || (p.currency && p.currency !== 'INR') || Number(p.amount) !== expected) throw badRequest('amount_mismatch', 'Payment does not match this gift');
  if (p.status === 'authorized') await razorpay.capturePayment(paymentId, expected);
  else if (p.status !== 'captured') throw badRequest('payment_not_captured', `Payment status is ${p.status}`);
  return finalizeGiftPurchase({ enquiryId: e.id, paymentId, amountPaise: expected, source: 'verify' });
}

/**
 * refund.processed for an online gift. A full refund revokes codes that were not redeemed yet. A
 * membership already activated from the gift is kept and the refund is flagged for the studio,
 * the same policy as rewards from a refunded membership payment. Returns null if not a gift payment.
 */
export async function recordGiftRefund(c, refund) {
  const e = (await c.query("SELECT * FROM admin_gift_enquiries WHERE provider_payment_id = $1 AND source = 'online' FOR UPDATE", [refund?.payment_id])).rows[0];
  if (!e) return null;
  const applied = await applyEntityRefund(c, { table: 'admin_gift_enquiries', entityType: 'gift_enquiry', row: e, refund, paidPaise: Math.round(Number(e.amount) * 100) });
  if (!applied) return { status: 'already_refunded' };
  let revoked = 0;
  let redeemed = 0;
  if (applied.full) {
    revoked = (await c.query("UPDATE gift_memberships SET status = 'revoked', revoked_by = 'razorpay_webhook', revoked_at = now() WHERE enquiry_id = $1 AND status = 'issued' RETURNING id", [e.id])).rowCount;
    redeemed = (await c.query("SELECT count(*)::int AS n FROM gift_memberships WHERE enquiry_id = $1 AND status = 'redeemed'", [e.id])).rows[0].n;
  }
  const details = { refund_id: applied.refundId, payment_id: refund.payment_id, amount_paise: applied.refundPaise, refunded_total_paise: applied.totalPaise, codes_revoked: revoked, redeemed_kept: redeemed };
  await audit(c, { actor: 'razorpay_webhook', action: applied.full ? 'gift_refunded' : 'gift_partial_refund', entityType: 'gift_enquiry', entityId: e.id, details });
  if (redeemed) await audit(c, { actor: 'razorpay_webhook', action: 'gift_refund_after_redemption', entityType: 'gift_enquiry', entityId: e.id, details });
  return {
    status: applied.full ? 'processed' : 'partial',
    notice: e.submitted_by ? { authUserId: e.submitted_by, amount: applied.refundPaise / 100, what: `gift ${e.enquiry_number}`, refundId: applied.refundId } : null,
  };
}
