// Read-only owner review of administrator accounts (BD-6). Changes nothing: runs inside
// BEGIN READ ONLY and rolls back. Usage: node scripts/list-admins.js
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const allowed = String(process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
});

await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const r = await client.query(
    `SELECT p.email, p.role, p.is_admin, p.is_active, p.created_at::date AS created,
            (SELECT max(a.created_at)::date FROM audit_logs a WHERE a.auth_user_id = p.auth_user_id AND a.action = 'admin_login') AS last_admin_login
       FROM profiles p WHERE p.is_admin OR p.role IN ('admin', 'owner') ORDER BY p.created_at`
  );
  console.table(r.rows.map((row) => ({ ...row, on_allowlist: allowed.length ? allowed.includes(String(row.email).toLowerCase()) : 'no allowlist set' })));
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
