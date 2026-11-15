import { db } from '../lib/db.js';
import { badRequest, notFound } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { bool, email as validEmail, gstin, indianState, label, phone, text, uuid } from '../lib/validate.js';
import { cancelMembershipTx } from '../lib/billing.js';
import { AUTH_COOKIE, cookieOptions } from '../lib/auth.js';
import { razorpay } from '../lib/razorpay.js';
import { fetchCustomerSizeProfiles, createSizeProfile, updateSizeProfile } from '../lib/size-profiles.js';

export const access = 'user';
export const methods = ['GET', 'PUT', 'POST', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60_000, max: 60 };

const measure = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 400) throw badRequest(`invalid_${field}`, `${label(field)} must be a number between 1 and 400`);
  return Math.round(n * 10) / 10;
};

const jsonObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v).slice(0, 4000) : '{}');

function wearerValues(b) {
  return [
    text(b.name, { max: 80, field: 'name', required: true }),
    text(b.relationship, { max: 40, field: 'relationship' }) || '',
    text(b.size_label, { max: 20, field: 'size_label' }) || '',
    measure(b.bust_cm, 'bust_cm'),
    measure(b.waist_cm, 'waist_cm'),
    measure(b.hip_cm, 'hip_cm'),
    measure(b.length_cm, 'length_cm'),
    jsonObject(b.style_preferences),
    jsonObject(b.occasion_preferences),
    b.birthday && /^\d{4}-\d{2}-\d{2}$/.test(b.birthday) ? b.birthday : null,
  ];
}

export default async function account(req, res) {
  const uid = req.user.id;
  const b = req.body || {};
  const action = b.action;

  if (req.method === 'GET') {
    const [p, m, w, a, n, l, colour, rewards, sizeData] = await Promise.all([
      db.query(
        'SELECT full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in, COALESCE(profile_completed, false) AS profile_completed, COALESCE(onboarding_completed, false) AS onboarding_completed FROM customer_profiles WHERE auth_user_id = $1',
        [uid]
      ).catch(() =>
        db.query('SELECT full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in FROM customer_profiles WHERE auth_user_id = $1', [uid])
      ),
      db.query('SELECT status, credits_balance, renewal_at, paid_through, consecutive_paid_months FROM memberships WHERE auth_user_id = $1', [uid]),
      db.query('SELECT * FROM wearer_profiles WHERE auth_user_id = $1 ORDER BY created_at', [uid]),
      db.query('SELECT * FROM addresses WHERE auth_user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 20', [uid]),
      db.query('SELECT whatsapp, email, sms, marketing FROM notification_preferences WHERE auth_user_id = $1', [uid]),
      db.query('SELECT id, name, created_at FROM saved_looks WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 50', [uid]),
      db.query('SELECT undertone, season, palette, confidence, lighting, created_at FROM colour_reviews WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 1', [uid]),
      db.query("SELECT count(*) FILTER (WHERE status = 'available')::int AS available, count(*) FILTER (WHERE status = 'redeemed')::int AS redeemed FROM reward_entitlements WHERE auth_user_id = $1", [uid]),
      fetchCustomerSizeProfiles(db, uid).catch(() => ({ profiles: [], active_profile_id: null, active_profile: null })),
    ]);
    const settings = await getSettings();
    return res.json({
      user: req.user,
      profile: p.rows[0] || null,
      membership: m.rows[0] || { status: 'inactive', credits_balance: 0 },
      wearers: w.rows,
      size_profiles: sizeData?.profiles || [],
      active_size_profile_id: sizeData?.active_profile_id || null,
      active_size_profile: sizeData?.active_profile || null,
      max_wearers: Number(settings.max_wearers),
      addresses: a.rows,
      notifications: n.rows[0] || { whatsapp: true, email: true, sms: true, marketing: false },
      saved_looks: l.rows,
      colour_profile: colour.rows[0] || null,
      rewards: rewards.rows[0] || { available: 0, redeemed: 0 },
    });
  }

  if (req.method === 'PUT' && !action) {
    const profCompleted = b.profile_completed !== undefined ? bool(b.profile_completed) : Boolean(b.full_name && b.phone);
    const onboardCompleted = b.onboarding_completed !== undefined ? bool(b.onboarding_completed) : false;
    let r;
    try {
      r = await db.query(
        `INSERT INTO customer_profiles (auth_user_id, full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in, profile_completed, onboarding_completed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (auth_user_id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
           gst_number = excluded.gst_number, age_confirmed = excluded.age_confirmed, marketing_opt_in = excluded.marketing_opt_in,
           whatsapp_opt_in = excluded.whatsapp_opt_in,
           profile_completed = CASE WHEN customer_profiles.profile_completed OR excluded.profile_completed THEN true ELSE false END,
           onboarding_completed = CASE WHEN customer_profiles.onboarding_completed OR excluded.onboarding_completed THEN true ELSE false END,
           updated_at = now()
         RETURNING full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in, profile_completed, onboarding_completed`,
        [uid, text(b.full_name, { max: 120, field: 'full_name' }) || req.user.name || '', phone(b.phone) || '', b.email ? validEmail(b.email) : req.user.email,
         gstin(b.gst_number) || '', bool(b.age_confirmed), bool(b.marketing_opt_in), bool(b.whatsapp_opt_in), profCompleted, onboardCompleted]
      );
    } catch {
      // Fallback if migration columns not added yet
      r = await db.query(
        `INSERT INTO customer_profiles (auth_user_id, full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (auth_user_id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
           gst_number = excluded.gst_number, age_confirmed = excluded.age_confirmed, marketing_opt_in = excluded.marketing_opt_in,
           whatsapp_opt_in = excluded.whatsapp_opt_in, updated_at = now()
         RETURNING full_name, phone, email, gst_number, age_confirmed, marketing_opt_in, whatsapp_opt_in`,
        [uid, text(b.full_name, { max: 120, field: 'full_name' }) || req.user.name || '', phone(b.phone) || '', b.email ? validEmail(b.email) : req.user.email,
         gstin(b.gst_number) || '', bool(b.age_confirmed), bool(b.marketing_opt_in), bool(b.whatsapp_opt_in)]
      );
    }
    // Also update full_name on profiles table
    if (b.full_name) {
      await db.query('UPDATE profiles SET full_name = $1 WHERE auth_user_id = $2', [text(b.full_name, { max: 120, field: 'full_name' }), uid]).catch(() => {});
    }
    if (b.preferred_silhouette) {
      await db.query('UPDATE customer_profiles SET preferred_silhouette = $1 WHERE auth_user_id = $2', [text(b.preferred_silhouette, { max: 80, field: 'preferred_silhouette' }), uid]).catch(() => {});
    }
    // Update or bootstrap primary size profile
    let sizeProfile = null;
    if (b.clothing_size || b.category_sizes || b.size_standard || b.bust || b.waist || b.fit_preference || b.preferred_silhouette) {
      try {
        const existingPrimary = (await db.query('SELECT id FROM customer_size_profiles WHERE auth_user_id = $1 AND is_primary = true LIMIT 1', [uid])).rows[0];
        if (existingPrimary) {
          sizeProfile = await updateSizeProfile(db, uid, existingPrimary.id, {
            name: b.full_name || undefined,
            size_standard: b.size_standard,
            clothing_size: b.clothing_size,
            custom_size: b.custom_size,
            category_sizes: b.category_sizes,
            bust: b.bust,
            waist: b.waist,
            hips: b.hips,
            shoulder: b.shoulder,
            inseam: b.inseam,
            height: b.height,
            measurement_unit: b.measurement_unit,
            fit_preference: b.fit_preference,
            silhouette_preference: b.preferred_silhouette,
          });
        } else {
          sizeProfile = await createSizeProfile(db, uid, {
            name: b.full_name || 'My Wardrobe',
            relationship: 'self',
            is_primary: true,
            make_active: true,
            size_standard: b.size_standard || 'India',
            clothing_size: b.clothing_size || 'M',
            custom_size: b.custom_size,
            category_sizes: b.category_sizes,
            bust: b.bust,
            waist: b.waist,
            hips: b.hips,
            shoulder: b.shoulder,
            inseam: b.inseam,
            height: b.height,
            measurement_unit: b.measurement_unit || 'cm',
            fit_preference: b.fit_preference || 'regular',
            silhouette_preference: b.preferred_silhouette,
          });
        }
      } catch (err) {
        // Non-blocking for primary profile save
      }
    }
    if (b.notifications && typeof b.notifications === 'object') {
      const nf = b.notifications;
      await db.query(
        `INSERT INTO notification_preferences (auth_user_id, whatsapp, email, sms, marketing) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (auth_user_id) DO UPDATE SET whatsapp = $2, email = $3, sms = $4, marketing = $5, updated_at = now()`,
        [uid, bool(nf.whatsapp), bool(nf.email), bool(nf.sms), bool(nf.marketing)]
      );
    }
    return res.json({ profile: r.rows[0], size_profile: sizeProfile });
  }

  if (req.method === 'POST' && action === 'wearer') {
    const settings = await getSettings();
    const r = await db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('wearer:' || $1))", [uid]);
      const count = (await c.query('SELECT count(*)::int AS n FROM wearer_profiles WHERE auth_user_id = $1', [uid])).rows[0].n;
      if (count >= Number(settings.max_wearers)) throw badRequest('max_wearers_reached', `You can save up to ${settings.max_wearers} wearer profiles`);
      return c.query(
        `INSERT INTO wearer_profiles (auth_user_id, name, relationship, size_label, bust_cm, waist_cm, hip_cm, length_cm, style_preferences, occasion_preferences, birthday)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [uid, ...wearerValues(b)]
      );
    });
    return res.status(201).json({ wearer: r.rows[0] });
  }

  if (req.method === 'PUT' && action === 'wearer') {
    const r = await db.query(
      `UPDATE wearer_profiles SET name = $1, relationship = $2, size_label = $3, bust_cm = $4, waist_cm = $5, hip_cm = $6, length_cm = $7,
              style_preferences = $8, occasion_preferences = $9, birthday = $10, updated_at = now()
        WHERE id = $11 AND auth_user_id = $12 RETURNING *`,
      [...wearerValues(b), uuid(b.id), uid]
    );
    if (!r.rows[0]) throw notFound('wearer_not_found', 'Wearer profile not found');
    return res.json({ wearer: r.rows[0] });
  }

  if (req.method === 'DELETE' && action === 'wearer') {
    const r = await db.query('DELETE FROM wearer_profiles WHERE id = $1 AND auth_user_id = $2 RETURNING id', [uuid(b.id), uid]);
    if (!r.rows[0]) throw notFound('wearer_not_found', 'Wearer profile not found');
    return res.json({ ok: true });
  }

  if (req.method === 'POST' && action === 'address') {
    const pincode = text(b.pincode, { max: 6, field: 'pincode', required: true });
    if (!/^[1-9]\d{5}$/.test(pincode)) throw badRequest('invalid_pincode', 'Enter a valid 6-digit PIN code');
    const values = [
      uid,
      text(b.label, { max: 40, field: 'label' }) || 'Home',
      text(b.recipient_name, { max: 120, field: 'recipient_name', required: true }),
      phone(b.phone, { required: true }),
      text(b.line1, { max: 200, field: 'line1', required: true }),
      text(b.line2, { max: 200, field: 'line2' }) || '',
      text(b.city, { max: 80, field: 'city', required: true }),
      indianState(b.state, { required: true }),
      pincode,
      bool(b.is_default),
    ];
    const r = await db.tx(async (c) => {
      if (bool(b.is_default)) await c.query('UPDATE addresses SET is_default = false WHERE auth_user_id = $1', [uid]);
      return c.query(
        'INSERT INTO addresses (auth_user_id, label, recipient_name, phone, line1, line2, city, state, pincode, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        values
      );
    });
    return res.status(201).json({ address: r.rows[0] });
  }

  if (req.method === 'POST' && action === 'delete_data') {
    if (b.confirm !== 'DELETE') throw badRequest('confirmation_required', 'Type DELETE to confirm that your account data should be erased');
    // Billing must stop before personal data goes: end the membership and its UPI Autopay mandate.
    const m = (await db.query("SELECT * FROM memberships WHERE auth_user_id = $1 AND status IN ('active','paused','pending_payment','payment_failed')", [uid])).rows[0];
    if (m) {
      await db.tx(async (c) => {
        const row = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [m.id])).rows[0];
        if (row.autopay_subscription_id) await c.query("UPDATE membership_subscriptions SET cancel_initiated_by = 'customer_deletion' WHERE razorpay_subscription_id = $1", [row.autopay_subscription_id]);
        await cancelMembershipTx(c, row, { actor: uid, reason: 'account_deleted' });
      });
      if (m.autopay_subscription_id && razorpay.configured) {
        await razorpay.cancelSubscription(m.autopay_subscription_id).catch(async () => {
          await db.query("UPDATE memberships SET mandate_status = 'cancel_pending' WHERE id = $1", [m.id]);
        });
      }
    }
    // Orders and invoices are retained for statutory accounting; personal app data is erased.
    await db.tx(async (c) => {
      for (const sql of [
        'DELETE FROM notification_preferences WHERE auth_user_id = $1',
        'DELETE FROM saved_look_items WHERE look_id IN (SELECT id FROM saved_looks WHERE auth_user_id = $1)',
        'DELETE FROM saved_looks WHERE auth_user_id = $1',
        'DELETE FROM addresses WHERE auth_user_id = $1',
        'DELETE FROM wearer_profiles WHERE auth_user_id = $1',
        'DELETE FROM colour_reviews WHERE auth_user_id = $1',
        'DELETE FROM wardrobe_items WHERE auth_user_id = $1',
        'DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE auth_user_id = $1)',
        "UPDATE customer_profiles SET full_name = NULL, phone = NULL, gst_number = NULL, marketing_opt_in = false, whatsapp_opt_in = false, updated_at = now() WHERE auth_user_id = $1",
        // Every session on every device ends now, including one issued in this same second.
        "UPDATE profiles SET sessions_valid_after = now() + interval '1 second' WHERE auth_user_id = $1",
      ]) {
        await c.query(sql, [uid]);
      }
      await audit(c, { actor: uid, action: 'customer_data_deleted', entityType: 'profile', entityId: uid });
    });
    const { maxAge, ...cookieOpts } = cookieOptions(req);
    res.clearCookie(AUTH_COOKIE, cookieOpts);
    return res.json({ ok: true, message: 'Your Vishrea application data has been deleted. Order and invoice records are retained as required by law.' });
  }

  throw badRequest('unsupported_action', 'Unsupported account action');
}
