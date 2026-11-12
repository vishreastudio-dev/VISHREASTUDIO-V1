#!/usr/bin/env node
/**
 * Find stored media that nothing uses. Dry run by default: it only reports.
 *
 *   node scripts/media-orphans.js                       report (JSON)
 *   node scripts/media-orphans.js --min-age-hours=48    ignore files newer than 48 h (default 24)
 *   node scripts/media-orphans.js --delete --confirm=N  delete the N registered orphans just reported
 *
 * Deleting needs the owner's approval: `--confirm` must equal the number of orphans found in the
 * same run, and each deletion re-checks references (lib/storage.js safeDelete). Objects in a bucket
 * without a media_objects row are only reported, never deleted.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { assertNotProductionTarget, config } from '../lib/config.js';
import { db, pool } from '../lib/db.js';
import { allReferencedValues } from '../lib/media-references.js';
import { bucketPlan, listObjects, safeDelete } from '../lib/storage.js';

export async function findOrphans({ c = db, minAgeHours = 24 } = {}) {
  const referenced = await allReferencedValues(c);
  const cutoff = Date.now() - minAgeHours * 3_600_000;
  const rows = (await c.query('SELECT id, driver, ref, bucket, object_path, purpose, visibility, bytes, legacy_url, created_at FROM media_objects WHERE deleted_at IS NULL ORDER BY created_at')).rows;
  const registered = rows.filter((r) => !referenced.has(r.ref) && !(r.legacy_url && referenced.has(r.legacy_url)) && new Date(r.created_at).getTime() < cutoff);

  // Objects present in storage that the application never recorded (uploaded by other means).
  const known = new Set(rows.filter((r) => r.driver === config.storage.driver).map((r) => `${r.bucket}/${r.object_path}`));
  const unregistered = [];
  for (const b of bucketPlan()) {
    if (config.storage.driver === 'local' && b.public) continue; // the local public folder holds legacy files too
    let objects = [];
    try {
      objects = await listObjects(b.id, b.public ? 'public' : 'private');
    } catch (err) {
      unregistered.push({ bucket: b.id, error: `could not list (${err.kind || 'error'})` });
      continue;
    }
    for (const p of objects) if (!known.has(`${b.id}/${p}`)) unregistered.push({ bucket: b.id, path: p });
  }
  return {
    driver: config.storage.driver,
    min_age_hours: minAgeHours,
    registered_orphans: registered.map((r) => ({ ref: r.ref, bucket: r.bucket, path: r.object_path, purpose: r.purpose, bytes: Number(r.bytes), created_at: r.created_at })),
    unregistered_objects: unregistered,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const val = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
  if (args.includes('--delete')) assertNotProductionTarget('Orphan deletion', { allow: args.includes('--production') });
  const report = await findOrphans({ minAgeHours: Number(val('min-age-hours') || 24) });
  console.log(JSON.stringify(report, null, 2));
  if (!args.includes('--delete')) {
    console.log(`\nDry run: ${report.registered_orphans.length} registered orphan(s), ${report.unregistered_objects.length} unregistered object(s). Nothing was deleted.`);
    return;
  }
  if (Number(val('confirm')) !== report.registered_orphans.length) {
    throw new Error(`Refusing to delete: pass --confirm=${report.registered_orphans.length} after reviewing the list above (owner approval required).`);
  }
  for (const o of report.registered_orphans) console.log(o.ref, JSON.stringify(await safeDelete(o.ref, { actor: 'orphan-cleanup' })));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error(`[media-orphans] ${err.message}`);
      pool.end().finally(() => process.exit(1));
    });
}
