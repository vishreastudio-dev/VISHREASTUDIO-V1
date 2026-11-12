/**
 * Administrator accounts. An administrator is a profile with role `admin` or `owner`; sign-in stays
 * the e-mail code, so adding one never creates a password. Removing an administrator demotes the
 * profile to a customer: the account, its orders and its audit history are kept.
 *
 * Rules: only an owner may grant the owner role or change an owner's account; nobody may change
 * their own role, disable or remove themselves; at least one active administrator always remains.
 */
import { audit } from './audit.js';
import { AppError, badRequest, conflict, notFound } from './http.js';
import { adminAllowlist, hasAdminRole } from './auth.js';
import { bool, email as validEmail, oneOf, text } from './validate.js';

const ROLES = ['admin', 'owner'];
const forbidden = (code, message) => new AppError(403, code, message);
// Same lock as the sign-in bootstrap, so adding an admin and a first login never race.
const lock = (c) => c.query("SELECT pg_advisory_xact_lock(hashtext('admin_bootstrap'))");

const allowlistWarning = (email) => {
  const allow = adminAllowlist();
  return allow && !allow.has(email.toLowerCase())
    ? `${email} is not in ADMIN_ALLOWED_EMAILS, so it cannot open the admin panel until that list is updated and the server restarted.`
    : null;
};

async function actorRole(c, actor) {
  const r = (await c.query('SELECT role, is_admin FROM profiles WHERE auth_user_id = $1', [actor])).rows[0];
  return r?.role === 'owner' ? 'owner' : 'admin';
}

async function activeAdminCount(c) {
  return (await c.query("SELECT count(*)::int AS n FROM profiles WHERE (is_admin OR role IN ('admin','owner')) AND is_active IS NOT false")).rows[0].n;
}

export async function listAdmins(c, actor) {
  const allow = adminAllowlist();
  const rows = (
    await c.query(
      `SELECT p.auth_user_id, p.email, p.full_name, p.role, p.is_admin, p.is_active, p.created_at,
              (SELECT max(a.created_at) FROM audit_logs a WHERE a.auth_user_id = p.auth_user_id AND a.action = 'admin_login') AS last_sign_in,
              (SELECT max(a.created_at) FROM audit_logs a WHERE a.auth_user_id = p.auth_user_id) AS last_activity
         FROM profiles p WHERE p.is_admin OR p.role IN ('admin','owner') ORDER BY p.created_at`
    )
  ).rows;
  return {
    me: actor,
    my_role: await actorRole(c, actor),
    allowlist_configured: Boolean(allow),
    admins: rows.filter(hasAdminRole).map((r) => ({
      id: r.auth_user_id,
      email: r.email,
      name: r.full_name || '',
      role: r.role === 'owner' ? 'owner' : 'admin',
      active: r.is_active !== false,
      on_allowlist: allow ? allow.has(String(r.email).toLowerCase()) : null,
      created_at: r.created_at,
      last_sign_in: r.last_sign_in,
      last_activity: r.last_activity,
    })),
  };
}

/** Add an administrator: promotes an existing account with that e-mail, or creates one. */
export async function addAdmin(c, actor, b) {
  await lock(c);
  const email = validEmail(b.email);
  const name = text(b.name, { max: 120, field: 'name' }) || null;
  const role = oneOf(b.role, ROLES, { field: 'role', fallback: 'admin' });
  if (role === 'owner' && (await actorRole(c, actor)) !== 'owner') throw forbidden('owner_only', 'Only an owner can add another owner');

  let p = (await c.query('SELECT * FROM profiles WHERE lower(email) = $1 ORDER BY created_at LIMIT 1', [email])).rows[0];
  if (p && hasAdminRole(p)) throw conflict('already_admin', `${email} is already an administrator`);
  const existed = Boolean(p);
  if (p) {
    p = (
      await c.query(
        'UPDATE profiles SET is_admin = true, role = $2, is_active = true, full_name = COALESCE($3, full_name), updated_at = now() WHERE id = $1 RETURNING *',
        [p.id, role, name]
      )
    ).rows[0];
  } else {
    p = (
      await c.query(
        `INSERT INTO profiles (auth_user_id, email, full_name, is_admin, role)
         VALUES ('usr_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, true, $3) RETURNING *`,
        [email, name || email.split('@')[0], role]
      )
    ).rows[0];
    await c.query('INSERT INTO customer_profiles (auth_user_id, email, full_name) VALUES ($1, $2, $3) ON CONFLICT (auth_user_id) DO NOTHING', [p.auth_user_id, p.email, p.full_name]);
  }
  await audit(c, { actor, action: 'admin_added', entityType: 'profile', entityId: p.auth_user_id, details: { email, role, existing_account: existed } });
  return { id: p.auth_user_id, existing_account: existed, warning: allowlistWarning(email) };
}

async function loadTarget(c, actor, id) {
  const target = (await c.query('SELECT * FROM profiles WHERE auth_user_id = $1 FOR UPDATE', [text(id, { max: 80, field: 'id', required: true })])).rows[0];
  if (!target || !hasAdminRole(target)) throw notFound('admin_not_found', 'Administrator not found');
  if (target.role === 'owner' && (await actorRole(c, actor)) !== 'owner') throw forbidden('owner_only', "Only an owner can change an owner's account");
  return target;
}

/** Edit name, role and whether the account may sign in. */
export async function updateAdmin(c, actor, b) {
  await lock(c);
  const target = await loadTarget(c, actor, b.id);
  const self = target.auth_user_id === actor;
  const name = b.name !== undefined ? text(b.name, { max: 120, field: 'name' }) || null : target.full_name;
  const role = b.role !== undefined ? oneOf(b.role, ROLES, { field: 'role' }) : target.role === 'owner' ? 'owner' : 'admin';
  const active = b.active !== undefined ? bool(b.active) : target.is_active !== false;
  const currentRole = target.role === 'owner' ? 'owner' : 'admin';

  if (self && role !== currentRole) throw badRequest('cannot_change_own_role', 'You cannot change your own role. Ask another owner.');
  if (self && !active) throw badRequest('cannot_disable_self', 'You cannot disable your own account');
  if (role === 'owner' && currentRole !== 'owner' && (await actorRole(c, actor)) !== 'owner') throw forbidden('owner_only', 'Only an owner can make someone an owner');
  if (!active && target.is_active !== false && (await activeAdminCount(c)) <= 1) throw conflict('last_admin', 'At least one active administrator must remain');

  await c.query(
    `UPDATE profiles SET full_name = $2, role = $3, is_admin = true, is_active = $4, updated_at = now(),
            sessions_valid_after = CASE WHEN $4 THEN sessions_valid_after ELSE now() + interval '1 second' END
      WHERE auth_user_id = $1`,
    [target.auth_user_id, name, role, active]
  );
  const changes = {};
  if ((target.full_name || null) !== name) changes.name = { before: target.full_name, after: name };
  if (currentRole !== role) changes.role = { before: currentRole, after: role };
  if ((target.is_active !== false) !== active) changes.active = { before: target.is_active !== false, after: active };
  if (Object.keys(changes).length) await audit(c, { actor, action: 'admin_updated', entityType: 'profile', entityId: target.auth_user_id, details: { email: target.email, ...changes } });
  return { id: target.auth_user_id, warning: allowlistWarning(target.email) };
}

/** Remove admin access. The account stays as a customer and is signed out everywhere. */
export async function removeAdmin(c, actor, id) {
  await lock(c);
  const target = await loadTarget(c, actor, id);
  if (target.auth_user_id === actor) throw badRequest('cannot_remove_self', 'You cannot remove your own admin access');
  if (target.is_active !== false && (await activeAdminCount(c)) <= 1) throw conflict('last_admin', 'At least one active administrator must remain');
  await c.query("UPDATE profiles SET is_admin = false, role = 'customer', sessions_valid_after = now() + interval '1 second', updated_at = now() WHERE auth_user_id = $1", [target.auth_user_id]);
  await audit(c, { actor, action: 'admin_removed', entityType: 'profile', entityId: target.auth_user_id, details: { email: target.email, role: target.role } });
  return { removed: true };
}
