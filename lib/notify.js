import { config } from './config.js';
import { AppError } from './http.js';
import { log } from './log.js';

const RESEND_URL = 'https://api.resend.com/emails';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export const hasEmailProvider = () => Boolean(config.email.resendApiKey || config.email.brevoApiKey);

/** Send one email through configured provider (Resend or Brevo). Throws on timeout or non-2xx. */
async function sendEmail({ to, subject, text, html }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (config.email.brevoApiKey) {
      const r = await fetch(BREVO_URL, {
        method: 'POST',
        headers: {
          'api-key': config.email.brevoApiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'Vishrea Studio', email: config.email.fromEmail || 'no-reply@vishreastudio.com' },
          to: [{ email: to }],
          subject,
          textContent: text,
          ...(html ? { htmlContent: html } : {}),
        }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).slice(0, 300);
        throw new Error(`brevo email status ${r.status}${detail ? `: ${detail}` : ''}`);
      }
      return;
    }

    if (config.email.resendApiKey) {
      // Resend requires onboarding@resend.dev for unverified testing domains; personal @gmail.com senders are rejected.
      let fromAddress = config.email.from;
      if (/@gmail\.com>?$/i.test(fromAddress) || !fromAddress) {
        fromAddress = 'Vishrea Studio <onboarding@resend.dev>';
      }
      const r = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [to], subject, text, ...(html ? { html } : {}) }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).slice(0, 300);
        throw new Error(`resend email status ${r.status}${detail ? `: ${detail}` : ''}`);
      }
      return;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Render a luxury HTML email for customer sign-in codes. */
function renderOtpEmailHtml(code) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Verification Code — VISHREA STUDIO</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f6f3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1a1a1a;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f7f6f3; padding: 48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e8e4dc; border-radius: 2px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.03);">
          <tr>
            <td style="padding: 44px 40px 24px; text-align: center; border-bottom: 1px solid #f2ede4;">
              <div style="font-family: Georgia, 'Playfair Display', serif; font-size: 22px; font-weight: 400; letter-spacing: 5px; color: #111111; text-transform: uppercase;">
                V I S H R E A
              </div>
              <div style="font-size: 10px; font-weight: 500; letter-spacing: 3px; color: #9a8f82; text-transform: uppercase; margin-top: 4px;">
                S T U D I O
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px 20px; text-align: center;">
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #8a7864; margin-bottom: 12px;">
                Private Wardrobe Access
              </div>
              <h1 style="font-family: Georgia, 'Playfair Display', serif; font-size: 24px; font-weight: 400; color: #141414; margin: 0 0 16px; line-height: 1.3;">
                Your Verification Code
              </h1>
              <p style="font-size: 14px; line-height: 1.6; color: #5c5751; margin: 0 0 32px; max-width: 380px; display: inline-block;">
                Use the one-time code below to securely authenticate your private session. No password is required.
              </p>
              <div style="background-color: #faf9f6; border: 1px solid #dfd8cc; padding: 22px 32px; margin: 0 auto 32px; display: inline-block; border-radius: 2px;">
                <span style="font-family: 'SF Mono', 'SF Pro Mono', Monaco, Menlo, Consolas, monospace; font-size: 34px; font-weight: 600; letter-spacing: 8px; color: #111111; display: block;">
                  ${code}
                </span>
              </div>
              <p style="font-size: 12px; color: #8e8880; line-height: 1.5; margin: 0 0 8px;">
                This code is confidential and expires in <strong>10 minutes</strong>.
              </p>
              <p style="font-size: 12px; color: #b0aaa2; line-height: 1.5; margin: 0;">
                If you did not request this sign-in, you can safely discard this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <div style="border-top: 1px solid #f2ede4; height: 1px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; text-align: center;">
              <p style="font-size: 11px; letter-spacing: 1px; color: #a49e96; margin: 0; text-transform: uppercase;">
                Curated Luxury &amp; Tailored Experiences
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; margin-top: 24px;">
          <tr>
            <td style="text-align: center; font-size: 11px; color: #a49e96; line-height: 1.6;">
              &copy; 2026 VISHREA STUDIO. All rights reserved.<br>
              This is an automated security transmission. Please do not reply directly to this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
  if (!hasEmailProvider()) {
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
    if (!hasEmailProvider()) {
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

/** Deliver a sign-in code. Uses Resend/Brevo when configured; prints to the dev console otherwise. */
export async function sendOtpEmail(email, code) {
  if (hasEmailProvider()) {
    try {
      await sendEmail({
        to: email,
        subject: `Your Vishrea Studio sign-in code: ${code}`,
        text: `Your Vishrea Studio sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
        html: renderOtpEmailHtml(code),
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
