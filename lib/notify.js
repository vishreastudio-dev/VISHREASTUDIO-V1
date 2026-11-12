import { config } from './config.js';
import { AppError } from './http.js';
import { log } from './log.js';

const RESEND_URL = 'https://api.resend.com/emails';

/** Send one plain-text email through Resend. Throws on timeout or any non-2xx response. */
async function sendEmail({ to, subject, text }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, text }),
      signal: controller.signal,
    });
    if (!r.ok) {
      // Resend explains rejections (unverified domain, bad sender) in the body; it never echoes the API key.
      const detail = (await r.text().catch(() => '')).slice(0, 300);
      throw new Error(`email provider status ${r.status}${detail ? `: ${detail}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tell the customer their order left the studio. Never throws: the status change has
 * already been committed, so a delivery failure is logged and the admin is not blocked.
 */
export async function sendDispatchNotification({ email, name, orderId, courier, trackingNumber, trackingUrl, pickup }) {
  const ref = String(orderId).slice(0, 8).toUpperCase();
  log.info('order.dispatch_notification', { order_id: orderId, courier, tracking_number: trackingNumber, channel: config.email.resendApiKey ? 'email' : 'log' });
  if (!email) return { delivered: false, reason: 'no_email' };
  const lines = pickup
    ? [`Hi ${name || 'there'},`, '', `Your Vishrea Studio order #${ref} is ready for pickup at the Bengaluru studio.`]
    : [
        `Hi ${name || 'there'},`,
        '',
        `Your Vishrea Studio order #${ref} has been dispatched.`,
        courier ? `Courier: ${courier}` : null,
        trackingNumber ? `Tracking number: ${trackingNumber}` : null,
        trackingUrl ? `Track it: ${trackingUrl}` : null,
      ];
  const text = [...lines, '', `Order details: ${config.publicSiteUrl}/orders/${orderId}`].filter((l) => l !== null).join('\n');
  if (!config.email.resendApiKey) {
    if (!config.isProd) console.log(`\n[DEV NOTIFY] Dispatch email for ${email}:\n${text}\n`);
    else log.warn('order.dispatch_notification_unconfigured', { order_id: orderId });
    return { delivered: false, reason: 'no_provider' };
  }
  try {
    await sendEmail({ to: email, subject: pickup ? `Order #${ref} is ready for pickup` : `Order #${ref} is on its way`, text });
    return { delivered: true };
  } catch (err) {
    log.error('order.dispatch_notification_failed', { order_id: orderId, message: err.message });
    return { delivered: false, reason: 'provider_error' };
  }
}

/**
 * Customer messages for business events. Each is transactional unless listed as marketing; marketing
 * needs the customer's opt-in. `text` receives the event data and returns { subject, body }.
 */
const TEMPLATES = {
  membership_activated: { text: (d) => ({ subject: 'Welcome to the Walkin Wardrobe', body: `Your membership is active. ${d.credits} credits are ready, and your first monthly autopay debit of ₹${d.monthly} is on ${d.next_charge}.` }) },
  membership_renewed: { text: (d) => ({ subject: 'Your Walkin Wardrobe month has started', body: `We received ₹${d.amount}. ${d.credits} new credits are in your wardrobe.` }) },
  renewal_upcoming: { text: (d) => ({ subject: 'Your next Walkin Wardrobe debit', body: `Your monthly autopay debit of ₹${d.amount} is due on ${d.date}.` }) },
  payment_failed: { text: (d) => ({ subject: 'Your Walkin Wardrobe payment did not go through', body: `Your autopay debit of ₹${d.amount} failed. We will retry ${d.retries} times over ${d.days} days. Your credits are frozen until the payment succeeds. You can also pay now: ${d.link}` }) },
  membership_paused_payment: { text: (d) => ({ subject: 'Your Walkin Wardrobe is paused', body: `We could not collect your monthly payment after every retry, so your membership is paused (not cancelled). Restart it any time: ${d.link}` }) },
  membership_paused: { text: (d) => ({ subject: 'Your Walkin Wardrobe pause is confirmed', body: `Your membership pauses on ${d.starts} and restarts on ${d.ends}. No charge and no new credits while paused.` }) },
  membership_resumed: { text: () => ({ subject: 'Your Walkin Wardrobe has restarted', body: 'Your membership is active again.' }) },
  membership_cancelled: { text: (d) => ({ subject: 'Your Walkin Wardrobe is cancelled', body: `Your membership has been cancelled${d.reason === 'mandate_cancelled' ? ' because the UPI Autopay mandate was cancelled' : ''}. Pieces already in your Wardrobe Bag will still ship.` }) },
  credits_expiring: { text: (d) => ({ subject: `${d.credits} credits expire soon`, body: `${d.credits} wardrobe credits expire on ${d.date}. Pick your pieces: ${d.link}` }) },
  referral_success: { text: () => ({ subject: 'Your friend joined — a free piece is yours', body: 'Your friend has joined the Walkin Wardrobe. A free-piece reward is waiting in your account.' }) },
  loyalty_reward: { text: () => ({ subject: 'Your 6th-month free piece is ready', body: 'Thank you for 6 months with the Walkin Wardrobe. Your free piece is waiting in your account.' }) },
  gift_received: { text: (d) => ({ subject: `${d.from} sent you a Walkin Wardrobe membership`, body: `${d.from} gifted you ${d.months} months of the Walkin Wardrobe.${d.message ? `\n\n"${d.message}"` : ''}\n\n${d.starts ? `It starts on ${d.starts}. ` : ''}Activate it here: ${d.link}` }) },
  gift_ending: { text: (d) => ({ subject: 'Your gifted Walkin Wardrobe is ending', body: `Your gifted membership ends on ${d.date}. Continue on your own with 2 months upfront, then monthly: ${d.link}` }) },
  order_confirmed: { text: (d) => ({ subject: `Order #${d.ref} confirmed`, body: `Thank you — order #${d.ref} is confirmed${d.total > 0 ? ` (₹${d.total})` : ''}. Your GST invoice is on the order page: ${d.link}` }) },
  exchange_update: { text: (d) => ({ subject: `Your ${d.type} request: ${d.status}`, body: `Your ${d.type} request for order #${d.ref} is now ${d.status}.${d.note ? `\n\n${d.note}` : ''}\n\n${d.link}` }) },
  refund_processed: { text: (d) => ({ subject: `Refund of ₹${d.amount} processed`, body: `We have refunded ₹${d.amount} for ${d.what || `order #${d.ref}`} to your original payment method. Banks usually take 5–7 working days.` }) },
  bag_shipped: { text: (d) => ({ subject: 'Your Wardrobe Bag is being packed', body: `${d.pieces} pieces from your Wardrobe Bag are being packed. We dispatch within 48 hours.` }) },
};

async function contactFor(client, authUserId) {
  const r = await client.query(
    `SELECT p.email, cp.phone, np.whatsapp, np.email AS email_ok, np.marketing
       FROM profiles p LEFT JOIN customer_profiles cp ON cp.auth_user_id = p.auth_user_id
       LEFT JOIN notification_preferences np ON np.auth_user_id = p.auth_user_id
      WHERE p.auth_user_id = $1`,
    [authUserId]
  );
  return r.rows[0] || null;
}

async function logNotification(client, row) {
  await client.query(
    `INSERT INTO notifications (auth_user_id, event, channel, category, recipient, status, reason, dedupe_key, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dedupe_key, channel) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [row.authUserId || null, row.event, row.channel, row.category, row.recipient || null, row.status, row.reason || null, row.dedupeKey || null, JSON.stringify(row.details || {})]
  ).catch((err) => log.error('notify.log_failed', { event: row.event, message: err.message }));
}

/**
 * Send a customer notification. Never throws: the business change has already been committed.
 * `dedupeKey` makes repeated webhooks or job passes send a message once. WhatsApp is the main channel
 * in the requirements; until the WhatsApp Business API is connected it is logged as skipped.
 */
export async function notify(client, { authUserId, event, data = {}, dedupeKey = null, category = 'transactional', to = null }) {
  const tpl = TEMPLATES[event];
  if (!tpl) return { sent: false, reason: 'unknown_event' };
  try {
    if (dedupeKey) {
      const seen = await client.query("SELECT 1 FROM notifications WHERE dedupe_key = $1 AND channel IN ('email', 'log') LIMIT 1", [dedupeKey]);
      if (seen.rows[0]) return { sent: false, reason: 'duplicate' };
    }
    const contact = authUserId ? await contactFor(client, authUserId) : null;
    const email = to?.email || contact?.email || null;
    const { subject, body } = tpl.text(data);
    const base = { authUserId, event, category, dedupeKey, details: { subject } };
    if (category === 'marketing' && !contact?.marketing) {
      await logNotification(client, { ...base, channel: 'log', status: 'skipped', reason: 'no_marketing_consent' });
      return { sent: false, reason: 'no_marketing_consent' };
    }
    await logNotification(client, { ...base, channel: 'whatsapp', recipient: to?.phone || contact?.phone || null, status: 'skipped', reason: contact?.whatsapp === false ? 'opted_out' : 'provider_not_configured' });
    if (!email || contact?.email_ok === false) {
      await logNotification(client, { ...base, channel: 'email', status: 'skipped', reason: email ? 'opted_out' : 'no_email' });
      return { sent: false, reason: email ? 'opted_out' : 'no_email' };
    }
    if (!config.email.resendApiKey) {
      if (!config.isProd) console.log(`\n[DEV NOTIFY] ${event} → ${email}: ${subject}\n${body}\n`);
      await logNotification(client, { ...base, channel: 'email', recipient: email, status: 'skipped', reason: 'provider_not_configured' });
      return { sent: false, reason: 'no_provider' };
    }
    try {
      await sendEmail({ to: email, subject, text: `${body}\n\n${config.publicSiteUrl}` });
      await logNotification(client, { ...base, channel: 'email', recipient: email, status: 'sent' });
      return { sent: true };
    } catch (err) {
      log.error('notify.email_failed', { event, message: err.message });
      await logNotification(client, { ...base, channel: 'email', recipient: email, status: 'failed', reason: String(err.message).slice(0, 200) });
      return { sent: false, reason: 'provider_error' };
    }
  } catch (err) {
    log.error('notify.failed', { event, message: err.message });
    return { sent: false, reason: 'error' };
  }
}

/** Deliver a sign-in code. Uses Resend when configured; prints to the dev console otherwise. */
export async function sendOtpEmail(email, code) {
  if (config.email.resendApiKey) {
    try {
      await sendEmail({
        to: email,
        subject: 'Your Vishrea Studio sign-in code',
        text: `Your Vishrea Studio sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
      });
      return { delivered: true };
    } catch (err) {
      log.error('auth.otp_delivery_failed', { message: err.message });
      throw new AppError(502, 'otp_delivery_failed', 'We could not send the code right now. Please try again shortly.');
    }
  }
  if (config.isProd) {
    log.error('auth.otp_delivery_unconfigured', {});
    throw new AppError(503, 'otp_delivery_unavailable', 'Sign-in is temporarily unavailable.');
  }
  // Development only — never reached in production.
  console.log(`\n[DEV AUTH] Sign-in code for ${email}: ${code}\n`);
  return { delivered: false };
}
