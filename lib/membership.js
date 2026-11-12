/**
 * Membership lifecycle. A membership is a sequence of paid (or gifted) months, one
 * `membership_periods` row each. `memberships.paid_through` is the end of the last month.
 *
 * - Paying (or redeeming a gift) appends months. While the membership is still running the new
 *   months start at `paid_through`; otherwise they start now. The consecutive-month count
 *   (`streak_month`) continues while running or when renewed within `renewal_grace_days` of the
 *   paid period ending, and restarts at month 1 after a longer lapse, a cancellation or a pause.
 * - Credits for a month are granted when that month starts (`grantDuePeriods`), once per month.
 * - The 6th, 12th, … consecutive paid month issues one free-piece entitlement (MEM-10).
 * - When `paid_through` passes, the membership becomes `expired`; nothing is charged.
 */
import { db } from './db.js';
import { audit } from './audit.js';
import { log } from './log.js';
import { getSettings } from './settings.js';
import { reconcileExpiredCredits } from './credits.js';

const RUNNING = ['active', 'paused'];

/**
 * Append `months` months to a membership inside transaction `c`. Idempotent per
 * (membership_payment_id | gift_membership_id, month_index).
 */
export async function appendMembershipMonths(c, { membershipId, months, source, membershipPaymentId = null, giftMembershipId = null, creditsPerMonth, settings, alignToPaidThrough = false }) {
  const m = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [membershipId])).rows[0];
  if (!m) throw Object.assign(new Error('membership_not_found'), { code: 'not_found' });

  const ref = membershipPaymentId ? ['membership_payment_id', membershipPaymentId] : ['gift_membership_id', giftMembershipId];
  const existing = (await c.query(`SELECT count(*)::int AS n FROM membership_periods WHERE ${ref[0]} = $1`, [ref[1]])).rows[0].n;
  if (existing) return { appended: 0, membership: m };

  const s = settings || (await getSettings(c));
  // Database transaction time, so "starts now" and the grant check (`starts_at <= now()`) agree exactly.
  const now = new Date((await c.query('SELECT now() AS now')).rows[0].now);
  // An autopay debit that lands late (bank delay or a successful retry) still starts at `paid_through`,
  // so the billing cycle and the consecutive count stay aligned with the mandate.
  const aligned = alignToPaidThrough && m.paid_through && m.status !== 'cancelled' && m.pause_reason !== 'customer'
    && now.getTime() - new Date(m.paid_through).getTime() <= (Math.max(1, Number(s.autopay_retry_days) || 5) + 2) * 86_400_000;
  const running = Boolean(aligned) || (RUNNING.includes(m.status) && m.paid_through && new Date(m.paid_through) > now);
  const continuing = running || isWithinRenewalGrace(m, now, s);
  const last = continuing
    ? (await c.query('SELECT streak_month, credits_granted_at FROM membership_periods WHERE membership_id = $1 AND voided_at IS NULL ORDER BY ends_at DESC LIMIT 1', [m.id])).rows[0]
    : null;
  // Months already paid but not started carry the count forward; otherwise it is the count reached so far
  // (0 after a pause, which resets it).
  const streakBase = !continuing ? 0 : last && !last.credits_granted_at ? Number(last.streak_month) : Number(m.consecutive_paid_months) || 0;
  const start = running ? new Date(m.paid_through) : now;

  await c.query(
    `INSERT INTO membership_periods (membership_id, auth_user_id, source, membership_payment_id, gift_membership_id, month_index, streak_month, starts_at, ends_at, credits)
     SELECT $1, $2, $3, $4, $5, i, $6 + i, $7::timestamptz + make_interval(months => i - 1), $7::timestamptz + make_interval(months => i), $8
       FROM generate_series(1, $9::int) AS i`,
    [m.id, m.auth_user_id, source, membershipPaymentId, giftMembershipId, streakBase, start.toISOString(), creditsPerMonth, months]
  );
  const updated = (
    await c.query(
      `UPDATE memberships SET
          status = CASE WHEN status = 'paused' AND $3 THEN 'paused' ELSE 'active' END,
          started_at = CASE WHEN $5 THEN COALESCE(started_at, now()) ELSE now() END,
          paid_through = $2::timestamptz + make_interval(months => $4::int),
          renewal_at = $2::timestamptz + make_interval(months => $4::int),
          prepaid_months = $4, expired_at = NULL, cancelled_at = CASE WHEN $3 THEN cancelled_at ELSE NULL END,
          consecutive_paid_months = CASE WHEN $5 THEN consecutive_paid_months ELSE 0 END,
          updated_at = now()
        WHERE id = $1 RETURNING *`,
      [m.id, start.toISOString(), running, months, continuing]
    )
  ).rows[0];
  return { appended: months, membership: updated, streakRestarted: !continuing };
}

/**
 * Whether a membership whose paid period has ended is still inside the renewal grace period, so a
 * renewal now continues the consecutive-month count. A cancelled membership never continues.
 */
export function isWithinRenewalGrace(m, now, settings) {
  if (!m?.paid_through || m.cancelled_at || m.status === 'cancelled') return false;
  const endedMs = now.getTime() - new Date(m.paid_through).getTime();
  return endedMs >= 0 && endedMs <= Math.max(0, Number(settings.renewal_grace_days) || 0) * 86_400_000;
}

/**
 * A pause resets the consecutive-month count to zero (MEM-08, MEM-10): paid months that have not
 * started are renumbered from month 1, so the free piece comes 6 months after the next one starts.
 */
export async function resetConsecutiveMonths(c, membershipId) {
  const base = (await c.query(
    `SELECT COALESCE(max(streak_month) FILTER (WHERE credits_granted_at IS NOT NULL), 0)::int AS n
       FROM membership_periods WHERE membership_id = $1 AND voided_at IS NULL`,
    [membershipId]
  )).rows[0].n;
  await c.query(
    `UPDATE membership_periods SET streak_month = GREATEST(1, streak_month - $2)
      WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL`,
    [membershipId, base]
  );
  await c.query('UPDATE memberships SET consecutive_paid_months = 0, updated_at = now() WHERE id = $1', [membershipId]);
}

/** Issue the free-piece entitlement for a qualifying (6th, 12th, …) consecutive month, once. */
async function issueMilestoneReward(c, m, period) {
  const previous = (await c.query("SELECT count(*)::int AS n FROM reward_entitlements WHERE membership_id = $1 AND kind = 'six_month_milestone'", [m.id])).rows[0].n;
  const r = await c.query(
    `INSERT INTO reward_entitlements (auth_user_id, kind, membership_id, membership_period_id, milestone_number, source_payment_id)
     VALUES ($1, 'six_month_milestone', $2, $3, $4, $5)
     ON CONFLICT (membership_period_id) WHERE kind = 'six_month_milestone' DO NOTHING RETURNING id`,
    [m.auth_user_id, m.id, period.id, previous + 1, period.membership_payment_id]
  );
  if (r.rows[0]) {
    await audit(c, { actor: 'system', action: 'reward_issued', entityType: 'reward_entitlement', entityId: r.rows[0].id, details: { kind: 'six_month_milestone', streak_month: period.streak_month } });
  }
  return r.rows[0]?.id || null;
}

/** Customer-facing offer line for a plan, matching how the six-month reward is configured. */
export function planOffer(months, settings) {
  if (!settings.six_month_reward_enabled) return null;
  if (settings.six_month_reward_qualification === 'consecutive_months') {
    return Number(months) >= 6 ? 'Get 1 piece free in your 6th month' : 'Stay 6 months in a row — your 6th month brings 1 free piece';
  }
  return Number(months) === 6 ? 'Get 1 piece free in your 6th month' : null;
}

/**
 * Whether the month that just started earns the six-month free piece.
 * consecutive_months (MEM-10, default): the 6th, 12th, … consecutive paid month, prepaid or renewed.
 * six_month_plan (earlier rule): month 6 of a paid 6-month prepaid plan only.
 * Gifted and admin-added months never qualify.
 */
async function qualifiesForSixMonthReward(c, period, settings) {
  if (!settings.six_month_reward_enabled || period.source !== 'payment') return false;
  if (settings.six_month_reward_qualification === 'consecutive_months') return Number(period.streak_month) % 6 === 0;
  if (Number(period.month_index) !== 6) return false;
  const mp = (await c.query("SELECT months, status FROM membership_payments WHERE id = $1", [period.membership_payment_id])).rows[0];
  return Number(mp?.months) === 6 && mp.status === 'paid';
}

/**
 * Grant the existing membership usage credits (and the six-month reward) for every month of this
 * membership that has started. Credits for a paid month are granted once, whether or not the
 * membership is paused — pausing only stops credits being spent (unchanged behaviour).
 */
export async function grantDuePeriods(c, membershipId, settings) {
  const s = settings || (await getSettings(c));
  const m = (await c.query('SELECT * FROM memberships WHERE id = $1 FOR UPDATE', [membershipId])).rows[0];
  if (!m || !RUNNING.includes(m.status)) return { granted: 0, rewards: 0 };

  const due = await c.query(
    `SELECT * FROM membership_periods
      WHERE membership_id = $1 AND credits_granted_at IS NULL AND voided_at IS NULL AND starts_at <= now()
      ORDER BY starts_at`,
    [m.id]
  );
  let granted = 0;
  let rewards = 0;
  for (const p of due.rows) {
    const credit = Number(p.credits) || 0;
    const reason = p.source === 'gift' ? 'gift_membership' : p.source === 'admin' ? 'admin_membership' : 'membership_payment';
    const ins = await c.query(
      `INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason, expires_at, membership_payment_id, membership_period_id)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7)
       ON CONFLICT (membership_period_id) WHERE membership_period_id IS NOT NULL DO NOTHING RETURNING id`,
      [m.auth_user_id, m.id, credit, reason, Number(s.credit_expiry_days) || 60, p.membership_payment_id, p.id]
    );
    await c.query('UPDATE membership_periods SET credits_granted_at = now() WHERE id = $1', [p.id]);
    if (!ins.rows[0]) continue;
    granted += credit;
    await c.query(
      'UPDATE memberships SET credits_balance = credits_balance + $2, consecutive_paid_months = GREATEST(COALESCE(consecutive_paid_months, 0), $3), updated_at = now() WHERE id = $1',
      [m.id, credit, p.streak_month]
    );
    if ((await qualifiesForSixMonthReward(c, p, s)) && (await issueMilestoneReward(c, m, p))) rewards += 1;
  }
  if (granted) await enforceHoldingLimit(c, m, s);
  return { granted, rewards };
}

/**
 * MEM-04: a member holds at most `credit_holding_limit` credits. When a new month would exceed it,
 * the credits closest to expiry lapse first (ledger reason `holding_limit`), never the new ones.
 */
async function enforceHoldingLimit(c, m, settings) {
  const limit = Math.max(1, Number(settings.credit_holding_limit) || 8);
  await reconcileExpiredCredits(c, m.auth_user_id);
  const cur = (await c.query('SELECT credits_balance FROM memberships WHERE id = $1', [m.id])).rows[0];
  const excess = Number(cur.credits_balance) - limit;
  if (excess <= 0) return 0;
  await c.query('UPDATE memberships SET credits_balance = credits_balance - $2, updated_at = now() WHERE id = $1', [m.id, excess]);
  await c.query("INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason) VALUES ($1, $2, $3, 'holding_limit')", [m.auth_user_id, m.id, -excess]);
  await audit(c, { actor: 'system', action: 'credits_holding_limit', entityType: 'membership', entityId: m.id, details: { lapsed: excess, limit } });
  return excess;
}

/** Move memberships whose paid period has ended to `expired`. Returns expired membership ids. */
export async function expireLapsedMemberships(c, { authUserId = null, settings = null } = {}) {
  const s = settings || (await getSettings(c));
  // Not lapsed: an autopay debit is due (inside the retry window), a customer pause has not ended,
  // or the membership is paused after failed retries (MEM-07: paused, never cancelled by the system).
  const r = await c.query(
    `UPDATE memberships SET status = 'expired', expired_at = now(), updated_at = now()
      WHERE status IN ('active', 'paused') AND paid_through IS NOT NULL AND paid_through <= now()
        AND ($1::text IS NULL OR auth_user_id = $1)
        AND NOT (billing_status IN ('active', 'retrying') AND paid_through > now() - make_interval(days => $2::int))
        AND billing_status <> 'halted'
        AND NOT (COALESCE(pause_reason, '') = 'customer' AND COALESCE(pause_ends_at, '-infinity'::timestamptz) > now() - interval '1 day')
      RETURNING id, auth_user_id`,
    [authUserId, Math.max(1, Number(s.autopay_retry_days) || 5) + 2]
  );
  for (const row of r.rows) {
    await audit(c, { actor: 'system', action: 'membership_expired', entityType: 'membership', entityId: row.id });
  }
  return r.rows;
}

/** Bring one customer's membership up to date (credits for started months, then expiry). */
export async function refreshMembership(c, authUserId, settings) {
  const m = (await c.query('SELECT id FROM memberships WHERE auth_user_id = $1', [authUserId])).rows[0];
  if (!m) return null;
  await grantDuePeriods(c, m.id, settings);
  await expireLapsedMemberships(c, { authUserId, settings });
  return (await c.query('SELECT * FROM memberships WHERE id = $1', [m.id])).rows[0];
}

/** Background pass: grant due months and expire lapsed memberships across all customers. */
export async function runMembershipLifecycle(limit = 200) {
  const settings = await getSettings();
  const due = await db.query(
    `SELECT DISTINCT p.membership_id FROM membership_periods p JOIN memberships m ON m.id = p.membership_id
      WHERE p.credits_granted_at IS NULL AND p.voided_at IS NULL AND p.starts_at <= now() AND m.status IN ('active', 'paused')
      LIMIT $1`,
    [limit]
  );
  let granted = 0;
  for (const row of due.rows) {
    try {
      granted += (await db.tx((c) => grantDuePeriods(c, row.membership_id, settings))).granted;
    } catch (err) {
      log.error('membership.grant_failed', { membership_id: row.membership_id, message: err.message });
    }
  }
  const expired = await db.tx((c) => expireLapsedMemberships(c, { settings }));
  if (granted || expired.length) log.info('membership.lifecycle', { granted, expired: expired.length });
  return { granted, expired: expired.length };
}

/** Void months that have not started yet (cancellation, refund). Returns the number voided. */
export async function voidFuturePeriods(c, { membershipId, membershipPaymentId = null, reason }) {
  const r = await c.query(
    `UPDATE membership_periods SET voided_at = now(), void_reason = $3
      WHERE membership_id = $1 AND voided_at IS NULL AND credits_granted_at IS NULL
        AND ($2::uuid IS NULL OR membership_payment_id = $2)
      RETURNING id`,
    [membershipId, membershipPaymentId, reason]
  );
  return r.rowCount;
}

/** Paid-through follows the last month that is still owed (not voided); left as is when there are no period rows. */
export async function syncPaidThrough(c, membershipId) {
  await c.query(
    `UPDATE memberships m SET paid_through = sub.ends, renewal_at = sub.ends, updated_at = now()
       FROM (SELECT max(ends_at) AS ends FROM membership_periods WHERE membership_id = $1 AND voided_at IS NULL) sub
      WHERE m.id = $1 AND sub.ends IS NOT NULL`,
    [membershipId]
  );
}

/** Credit totals from the ledger: available (cache), granted, consumed (net of reversals), expired. */
export async function creditSummary(client, authUserId) {
  const r = await client.query(
    `SELECT
        COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND reason NOT IN ('redemption_reversal')), 0)::int AS granted,
        COALESCE(-SUM(delta) FILTER (WHERE reason IN ('redemption', 'redemption_late_payment')), 0)::int
          - COALESCE(SUM(delta) FILTER (WHERE reason = 'redemption_reversal'), 0)::int AS consumed,
        COALESCE(-SUM(delta) FILTER (WHERE reason IN ('expiry', 'holding_limit')), 0)::int AS expired,
        COALESCE(-SUM(delta) FILTER (WHERE reason = 'cancellation_forfeit'), 0)::int AS forfeited
       FROM credit_ledger WHERE auth_user_id = $1`,
    [authUserId]
  );
  return r.rows[0];
}

/**
 * Six-month reward progress from verified paid periods, under the configured qualification rule.
 * six_month_plan: progress through the current paid 6-month plan (month n of 6).
 * consecutive_months: the current consecutive paid streak.
 */
export async function milestoneProgress(client, membership, settings) {
  const s = settings || (await getSettings(client));
  const rule = s.six_month_reward_qualification;
  const base = { rule, enabled: Boolean(s.six_month_reward_enabled) };
  const running = membership?.id && RUNNING.includes(membership.status);
  if (!running) return { ...base, on_qualifying_plan: false, current_month: 0, months_to_reward: rule === 'six_month_plan' ? null : 6 };

  if (rule === 'consecutive_months') {
    const streak = Number(membership.consecutive_paid_months) || 0;
    const current = streak % 6 || (streak ? 6 : 0);
    return { ...base, on_qualifying_plan: true, consecutive_months: streak, current_month: current, months_to_reward: 6 - current };
  }
  // The 6-month paid plan covering now (or starting next), and how far through it the member is.
  const plan = (await client.query(
    `SELECT mp.id, max(p.month_index) FILTER (WHERE p.starts_at <= now()) AS current_month, min(p.starts_at) AS starts_at
       FROM membership_periods p JOIN membership_payments mp ON mp.id = p.membership_payment_id
      WHERE p.membership_id = $1 AND p.voided_at IS NULL AND mp.months = 6 AND mp.status = 'paid'
      GROUP BY mp.id HAVING max(p.ends_at) > now() ORDER BY min(p.starts_at) LIMIT 1`,
    [membership.id]
  )).rows[0];
  if (!plan) return { ...base, on_qualifying_plan: false, current_month: 0, months_to_reward: null };
  const current = Number(plan.current_month) || 0;
  return { ...base, on_qualifying_plan: true, current_month: current, months_to_reward: Math.max(0, 6 - current), plan_starts_at: plan.starts_at };
}
