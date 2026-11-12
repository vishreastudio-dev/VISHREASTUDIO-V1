#!/usr/bin/env node
/**
 * Check the Supabase Storage buckets this application needs.
 *
 *   node scripts/storage-setup.js          report only
 *   node scripts/storage-setup.js --fix    create missing buckets and correct public/private flags
 *
 * Never deletes a bucket or any object. Needs STORAGE_DRIVER=supabase, SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (server-side only).
 */
import { assertNotProductionTarget, config } from '../lib/config.js';
import { bucketPlan, ensureBuckets } from '../lib/storage.js';

if (config.storage.driver !== 'supabase') {
  console.error('[storage-setup] STORAGE_DRIVER is not "supabase"; nothing to check.');
  process.exit(1);
}
const fix = process.argv.includes('--fix');
if (fix) {
  try {
    assertNotProductionTarget('Bucket setup', { allow: process.argv.includes('--production') });
  } catch (err) {
    console.error(`[storage-setup] ${err.message}`);
    process.exit(1);
  }
}
const plan = new Map(bucketPlan().map((b) => [b.id, b]));
for (const r of await ensureBuckets({ fix })) {
  const b = plan.get(r.id);
  console.log(`${r.id.padEnd(20)} ${(b.public ? 'public' : 'private').padEnd(8)} ${String(Math.round(b.fileSizeLimit / 1048576)).padStart(3)} MB  ${r.status}`);
}
if (!fix) console.log('\nReport only. Run with --fix to create missing buckets (owner approval required for production).');
