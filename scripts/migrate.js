import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertNotProductionTarget } from '../lib/config.js';
import { pool } from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function runMigrations({ seedDemo = false, quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  say('[Migration] Connecting to database...');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const appliedRes = await client.query('SELECT filename FROM _schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map((r) => r.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        say(`[Migration] Already applied: ${file}`);
        continue;
      }
      say(`[Migration] Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        say(`[Migration] Successfully applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migration] Error applying ${file}:`, err.message);
        throw err;
      }
    }

    const { POLICIES } = await import('../vishrea-react/src/content/policies.js');
    for (const [slug, page] of Object.entries(POLICIES)) {
      await client.query(
        'INSERT INTO legal_pages (slug, title, body) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING',
        [slug, page.title, page.body]
      );
    }
    say('[Migration] Legal pages ensured.');

    if (seedDemo) {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
      await client.query(fs.readFileSync(path.join(__dirname, 'seed-demo.sql'), 'utf8'));
      say('[Migration] Demo catalogue seeded.');
    }

    // Bootstrap the first administrator from configuration (never from email heuristics).
    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || '').trim().toLowerCase();
    if (adminEmail) {
      const adminCheck = await client.query("SELECT 1 FROM profiles WHERE role='admin' OR is_admin=true LIMIT 1");
      if (adminCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO profiles (auth_user_id, full_name, email, is_admin, role)
           VALUES ('usr_' || replace(gen_random_uuid()::text,'-',''), 'Vishrea Admin', $1, true, 'admin')
           ON CONFLICT DO NOTHING`,
          [adminEmail]
        );
        await client.query("UPDATE profiles SET is_admin=true, role='admin' WHERE lower(email)=$1", [adminEmail]);
        say(`[Migration] Bootstrapped administrator: ${adminEmail}`);
      }
    }

    say('[Migration] All migrations completed successfully.');
  } finally {
    client.release();
  }
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(path.resolve(process.argv[1]), __filename)) {
  Promise.resolve()
    .then(() => assertNotProductionTarget('Database migration', { allow: process.argv.includes('--production') }))
    .then(() => runMigrations({ seedDemo: process.argv.includes('--seed-demo') }))
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}

export { runMigrations };
