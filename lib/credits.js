/**
 * Wardrobe credits are a ledger. `memberships.credits_balance` is a cache of what can still be spent.
 * Grants carry expires_at; redemptions consume the soonest-expiring grant that was still valid at the time.
 * Rows with reason 'expiry' are the cache adjustment itself and are not applied twice.
 */

export function spendableFromLedger(rows, now = new Date()) {
  const buckets = [];
  const atNow = now instanceof Date ? now.getTime() : new Date(now).getTime();
  for (const row of rows || []) {
    if (row.reason === 'expiry') continue;
    const delta = Number(row.delta);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const at = new Date(row.created_at || now).getTime();
    if (delta > 0) {
      buckets.push({ remaining: delta, expires: row.expires_at ? new Date(row.expires_at).getTime() : null });
      continue;
    }
    let need = -delta;
    const usable = buckets
      .filter((b) => b.remaining > 0 && (b.expires === null || b.expires > at))
      .sort((a, b) => (a.expires ?? Number.POSITIVE_INFINITY) - (b.expires ?? Number.POSITIVE_INFINITY));
    for (const b of usable) {
      if (need <= 0) break;
      const take = Math.min(b.remaining, need);
      b.remaining -= take;
      need -= take;
    }
  }
  let spendable = 0;
  for (const b of buckets) {
    if (b.remaining > 0 && (b.expires === null || b.expires > atNow)) spendable += b.remaining;
  }
  return { spendable };
}

/**
 * Drop credits whose grants have expired. Safe to call repeatedly and from concurrent transactions:
 * the membership row is locked, and the expiry ledger row is derived from the balance difference.
 */
export async function reconcileExpiredCredits(client, authUserId) {
  const m = (await client.query('SELECT id, credits_balance FROM memberships WHERE auth_user_id = $1 FOR UPDATE', [authUserId])).rows[0];
  if (!m) return null;
  const ledger = await client.query(
    'SELECT delta, reason, expires_at, created_at FROM credit_ledger WHERE membership_id = $1 ORDER BY created_at ASC, id ASC',
    [m.id]
  );
  const { spendable } = spendableFromLedger(ledger.rows, new Date());
  const balance = Number(m.credits_balance);
  if (balance <= spendable) return { balance, expired: 0, membership_id: m.id };
  const drop = balance - spendable;
  await client.query('UPDATE memberships SET credits_balance = credits_balance - $2, updated_at = now() WHERE id = $1', [m.id, drop]);
  await client.query(
    "INSERT INTO credit_ledger (auth_user_id, membership_id, delta, reason) VALUES ($1, $2, $3, 'expiry')",
    [authUserId, m.id, -drop]
  );
  return { balance: spendable, expired: drop, membership_id: m.id };
}
