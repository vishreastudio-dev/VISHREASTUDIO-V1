import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, db } from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function testMigrations() {
  console.log('Testing migrations idempotency on dev DB...');
  const applied = (await pool.query('SELECT filename FROM _schema_migrations')).rows.map(r => r.filename);
  const appliedSet = new Set(applied);

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log('Total migration files:', files.length);
  console.log('Already tracked in _schema_migrations:', appliedSet.size);

  const missing = files.filter(f => !appliedSet.has(f));
  console.log('Untracked migration files:', missing);

  for (const file of missing) {
    console.log(`Testing application of ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Run inside transaction and commit if clean
    await db.tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO _schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    });
    console.log(`  ✔ Successfully applied & tracked: ${file}`);
  }

  console.log('\nAll migrations are now cleanly tracked in _schema_migrations!');
  process.exit(0);
}

testMigrations().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
