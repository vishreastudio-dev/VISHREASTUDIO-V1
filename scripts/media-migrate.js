#!/usr/bin/env node
/**
 * Move the local upload store (public/uploads or UPLOADS_DIR) into Supabase Storage.
 *
 *   node scripts/media-migrate.js inventory [--write-doc]   read-only: files, hashes, every DB reference
 *   node scripts/media-migrate.js apply --confirm=<checksum> upload, verify, then rewrite references
 *   node scripts/media-migrate.js verify --results=<file>   re-check every migrated file
 *   node scripts/media-migrate.js rollback --results=<file> put the original /uploads/... references back
 *
 * Safety
 *  - Local files are never deleted or modified.
 *  - `apply` needs STORAGE_DRIVER=supabase and the checksum printed by `inventory`, so it only runs
 *    against exactly the inventory that was reviewed (any new file or reference changes the checksum).
 *  - Each file is uploaded and verified (download + SHA-256) before any database row changes; all of
 *    a file's references then change in one transaction and are re-read to confirm.
 *  - Re-running is safe: files already migrated are recognised by their legacy URL and not uploaded
 *    again, and references already rewritten are left alone.
 *  - audit_logs is history and is never rewritten.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertNotProductionTarget, config } from '../lib/config.js';
import { db, pool } from '../lib/db.js';
import { UPLOAD_DIR, imageDimensions, mp4DurationSeconds, sniff } from '../lib/uploads.js';
import { PURPOSES, bucketFor, displayUrl, inspect, putObject, readObject } from '../lib/storage.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OUT_DIR = path.join(root, 'scratch', 'media-migration');
const FILE_RE = /\/uploads\/([A-Za-z0-9_.-]{1,120})/g;
const HISTORY_TABLES = new Set(['audit_logs', 'media_objects', '_schema_migrations']);

// Which storage category a referencing table implies.
const CATEGORY = {
  products: 'product',
  product_photos: 'product',
  homepage_carousel_slides: 'banner',
  feedback_videos: 'video',
  instagram_content: 'instagram',
  exchanges: 'evidence',
  piece_requests: 'archive',
  story_consents: 'archive',
};
const PUBLIC_PRIORITY = ['banner', 'product', 'instagram', 'video'];
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Every text/JSON column (outside history tables) and each table's primary key. */
async function scanColumns(c) {
  const cols = (await c.query(
    `SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      ORDER BY c.table_name, c.column_name`
  )).rows;
  const pks = (await c.query(
    `SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() ORDER BY kcu.ordinal_position`
  )).rows;
  const pkOf = new Map();
  for (const r of pks) pkOf.set(r.table_name, [...(pkOf.get(r.table_name) || []), r.column_name]);
  return { cols, pkOf };
}

/** All database values that mention /uploads/<file>, with the row that holds them. */
async function findReferences(c) {
  const { cols, pkOf } = await scanColumns(c);
  const refs = [];
  for (const col of cols) {
    const pk = pkOf.get(col.table_name) || [];
    const keySel = pk.length ? pk.map((k) => `${q(k)}::text AS ${q(`pk_${k}`)}`).join(', ') : 'NULL AS pk_none';
    const rows = (await c.query(`SELECT ${keySel}, ${q(col.column_name)}::text AS v FROM ${q(col.table_name)} WHERE ${q(col.column_name)}::text LIKE '%/uploads/%'`)).rows;
    for (const r of rows) {
      const names = new Set([...String(r.v).matchAll(FILE_RE)].map((m) => m[1]));
      for (const name of names) {
        refs.push({
          file: name,
          table: col.table_name,
          column: col.column_name,
          json: col.data_type === 'jsonb' || col.data_type === 'json',
          type: col.data_type,
          key: pk.length ? Object.fromEntries(pk.map((k) => [k, r[`pk_${k}`]])) : null,
          history: HISTORY_TABLES.has(col.table_name),
          exact: !(col.data_type === 'jsonb' || col.data_type === 'json') && r.v === `/uploads/${name}`,
        });
      }
    }
  }
  return refs;
}

function targetPath(category, name, { productIds, owner }) {
  const safe = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  switch (category) {
    case 'product':
      return productIds.length === 1 ? `products/${productIds[0]}/${safe}` : `products/legacy/${safe}`;
    case 'banner':
      return `banners/legacy/${safe}`;
    case 'video':
      return `videos/legacy/${safe}`;
    case 'instagram':
      return `instagram/legacy/${safe}`;
    case 'evidence':
      return `evidence/${String(owner).replace(/[^A-Za-z0-9_-]/g, '')}/legacy-${safe}`;
    default:
      return `legacy/${safe}`;
  }
}

/** Read-only inventory of the local store and every database reference to it. */
export async function buildInventory({ c = db, uploadDir = UPLOAD_DIR } = {}) {
  const names = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).filter((n) => !n.startsWith('.') && fs.statSync(path.join(uploadDir, n)).isFile()).sort() : [];
  const refs = await findReferences(c);
  // Files already copied by an earlier run (their references may already point at the new copy).
  // (media_objects arrives with migration 023; before that nothing can have been migrated.)
  const hasMedia = (await c.query("SELECT to_regclass('media_objects') IS NOT NULL AS ok")).rows[0].ok;
  const done = new Map(
    hasMedia
      ? (await c.query("SELECT legacy_url, ref, bucket, object_path FROM media_objects WHERE driver = 'supabase' AND legacy_url IS NOT NULL AND deleted_at IS NULL")).rows.map((r) => [r.legacy_url, r])
      : []
  );
  const files = [];
  for (const name of names) {
    const buf = fs.readFileSync(path.join(uploadDir, name));
    const type = sniff(buf);
    const dims = type?.kind === 'image' ? imageDimensions(buf) : null;
    const mine = refs.filter((r) => r.file === name);
    const live = mine.filter((r) => !r.history);
    const categories = [...new Set(live.map((r) => CATEGORY[r.table] || 'archive'))];
    const entry = {
      name,
      legacy_url: `/uploads/${name}`,
      bytes: buf.length,
      mime: type?.mime || 'unknown',
      kind: type?.kind || null,
      sha256: sha256(buf),
      width: dims?.width || null,
      height: dims?.height || null,
      duration_seconds: type?.kind === 'video' ? mp4DurationSeconds(buf) : null,
      references: live.map(({ table, column, json, type: t, key, exact }) => ({ table, column, json, type: t, key, exact })),
      history_references: mine.filter((r) => r.history).length,
      category: null,
      status: 'ready',
      notes: [],
    };
    const migrated = done.get(entry.legacy_url);
    if (migrated && !live.length) {
      entry.status = 'already_migrated';
      entry.migrated_to = migrated.ref;
      entry.notes.push(`Already copied to ${migrated.bucket}/${migrated.object_path}; nothing left to do.`);
      files.push(entry);
      continue;
    }
    if (!type) {
      entry.status = 'invalid';
      entry.notes.push('Not a JPG, PNG, WEBP, MP4 or MOV file; left in place.');
    } else if (!live.length) {
      entry.category = 'archive';
      entry.status = 'orphan';
      entry.notes.push('No database row uses this file; it is archived privately, not published.');
    } else {
      const publicCats = categories.filter((x) => PURPOSES[x]?.visibility === 'public');
      const privateCats = categories.filter((x) => PURPOSES[x]?.visibility === 'private');
      if (publicCats.length && privateCats.length) {
        entry.status = 'conflict';
        entry.notes.push(`Used both publicly (${publicCats.join(', ')}) and privately (${privateCats.join(', ')}); needs a manual decision.`);
      } else if (privateCats.length) {
        entry.category = privateCats.includes('evidence') ? 'evidence' : 'archive';
      } else {
        entry.category = PUBLIC_PRIORITY.find((x) => publicCats.includes(x));
      }
      if (entry.category && !PURPOSES[entry.category].kinds.includes(type.kind)) {
        entry.status = 'conflict';
        entry.notes.push(`A ${type.kind} referenced as ${entry.category} media; needs a manual decision.`);
      }
      const unwritable = live.filter((r) => !r.key || (!r.json && !r.exact));
      if (unwritable.length) {
        entry.status = 'conflict';
        entry.notes.push(`${unwritable.length} reference(s) cannot be rewritten automatically (no primary key, or the URL is embedded in longer text).`);
      }
    }
    if (entry.category && entry.status !== 'invalid') {
      const productIds = [...new Set(live.filter((r) => r.table === 'products').map((r) => r.key?.id).filter(Boolean))];
      let owner = null;
      if (entry.category === 'evidence') {
        const ids = live.filter((r) => r.table === 'exchanges').map((r) => r.key?.id).filter(Boolean);
        const owners = ids.length ? (await c.query('SELECT DISTINCT auth_user_id FROM exchanges WHERE id::text = ANY($1)', [ids])).rows.map((r) => r.auth_user_id) : [];
        if (owners.length !== 1) {
          entry.status = 'conflict';
          entry.notes.push('Evidence shared by more than one customer (or none); needs a manual decision.');
        }
        owner = owners[0] || null;
      }
      entry.owner_id = owner;
      entry.bucket = bucketFor(entry.category);
      entry.visibility = PURPOSES[entry.category].visibility;
      entry.object_path = targetPath(entry.category, name, { productIds, owner });
    }
    files.push(entry);
  }
  const onDisk = new Set(names);
  const broken = [...new Set(refs.filter((r) => !r.history && !onDisk.has(r.file)).map((r) => `/uploads/${r.file}`))].map((url) => ({
    url,
    where: refs.filter((r) => `/uploads/${r.file}` === url && !r.history).map((r) => `${r.table}.${r.column}`),
  }));
  const checksum = sha256(JSON.stringify(files.map((f) => [f.name, f.sha256, f.category, f.status, f.object_path, f.references]))).slice(0, 12);
  return {
    generated_at: new Date().toISOString(),
    upload_dir: path.relative(root, uploadDir) || '.',
    totals: {
      files: files.length,
      bytes: files.reduce((a, f) => a + f.bytes, 0),
      ready: files.filter((f) => f.status === 'ready').length,
      already_migrated: files.filter((f) => f.status === 'already_migrated').length,
      orphan: files.filter((f) => f.status === 'orphan').length,
      conflict: files.filter((f) => f.status === 'conflict').length,
      invalid: files.filter((f) => f.status === 'invalid').length,
      references: files.reduce((a, f) => a + f.references.length, 0),
      broken_references: broken.length,
    },
    files,
    broken_references: broken,
    checksum,
  };
}

async function rewriteReferences(c, file, from, to) {
  let changed = 0;
  for (const r of file.references) {
    const where = Object.keys(r.key).map((k, i) => `${q(k)}::text = $${i + 3}`).join(' AND ');
    const params = [from, to, ...Object.values(r.key)];
    const sql = r.json
      ? `UPDATE ${q(r.table)} SET ${q(r.column)} = replace(${q(r.column)}::text, $1, $2)::${r.type} WHERE ${where} AND position($1 IN ${q(r.column)}::text) > 0`
      : `UPDATE ${q(r.table)} SET ${q(r.column)} = $2 WHERE ${where} AND ${q(r.column)} = $1`;
    // JSON values are matched as whole quoted strings so a longer URL can never be partly replaced.
    const jsonParams = r.json ? [JSON.stringify(from), JSON.stringify(to), ...Object.values(r.key)] : params;
    changed += (await c.query(sql, jsonParams)).rowCount;
  }
  return changed;
}

async function confirmReferences(c, file, expected, gone) {
  for (const r of file.references) {
    const where = Object.keys(r.key).map((k, i) => `${q(k)}::text = $${i + 1}`).join(' AND ');
    const v = (await c.query(`SELECT ${q(r.column)}::text AS v FROM ${q(r.table)} WHERE ${where}`, Object.values(r.key))).rows[0]?.v || '';
    if (!v.includes(expected) || v.includes(JSON.stringify(gone)) || v === gone) return false;
  }
  return true;
}

async function fetchHash(url) {
  const absolute = url.startsWith('/') ? `${config.publicSiteUrl}${url}` : url;
  const res = await fetch(absolute, { signal: AbortSignal.timeout(config.storage.timeoutMs) });
  if (!res.ok) return null;
  return sha256(Buffer.from(await res.arrayBuffer()));
}

/** Upload, verify and re-point every file in an inventory. Returns per-file results (for verify/rollback). */
export async function applyMigration({ inventory, confirm, uploadDir = UPLOAD_DIR, includeOrphans = true, say = () => {} }) {
  if (config.storage.driver !== 'supabase') throw new Error('apply needs STORAGE_DRIVER=supabase (and the project credentials).');
  if (confirm !== inventory.checksum) throw new Error(`Checksum mismatch: run inventory again and pass --confirm=${inventory.checksum} after reviewing it.`);
  const fresh = await buildInventory({ uploadDir });
  if (fresh.checksum !== inventory.checksum) throw new Error('Files or database references changed since the inventory; review the new inventory first.');
  const results = [];
  for (const f of inventory.files) {
    const result = { name: f.name, legacy_url: f.legacy_url, sha256: f.sha256, status: 'skipped', references: f.references, notes: [...f.notes] };
    results.push(result);
    if (f.status === 'invalid' || f.status === 'conflict' || f.status === 'already_migrated' || (f.status === 'orphan' && !includeOrphans)) {
      result.reason = f.status;
      continue;
    }
    try {
      const buf = fs.readFileSync(path.join(uploadDir, f.name));
      if (sha256(buf) !== f.sha256) throw new Error('local file changed since the inventory');
      const visibility = PURPOSES[f.category].visibility;
      let row = (await pool.query("SELECT * FROM media_objects WHERE legacy_url = $1 AND driver = 'supabase' AND deleted_at IS NULL", [f.legacy_url])).rows[0];
      if (!row) {
        const facts = inspect(buf, f.category, { enforceSize: false });
        await putObject({ purpose: f.category, buffer: buf, inspected: facts, ownerId: f.owner_id || null, uploadedBy: 'media-migration', objectPath: f.object_path, legacyUrl: f.legacy_url });
        row = (await pool.query("SELECT * FROM media_objects WHERE legacy_url = $1 AND driver = 'supabase' AND deleted_at IS NULL", [f.legacy_url])).rows[0];
      }
      // Integrity: the stored copy must be byte-identical before any reference moves to it.
      const copy = await readObject(row.bucket, row.object_path, visibility);
      if (sha256(copy) !== f.sha256 || copy.length !== f.bytes) throw new Error('stored copy does not match the original');
      result.bucket = row.bucket;
      result.object_path = row.object_path;
      result.ref = row.ref;
      const changed = await db.tx(async (c) => {
        const n = await rewriteReferences(c, f, f.legacy_url, row.ref);
        if (!(await confirmReferences(c, f, row.ref, f.legacy_url))) throw new Error('references did not all update; rolled back');
        return n;
      });
      result.references_updated = changed;
      const shown = await displayUrl(row.ref);
      result.retrievable = Boolean(shown) && (await fetchHash(shown)) === f.sha256;
      result.status = result.retrievable ? 'migrated' : 'migrated_unverified';
      say(`${result.status.padEnd(20)} ${f.name} -> ${row.bucket}/${row.object_path} (${changed} reference(s))`);
    } catch (err) {
      result.status = 'failed';
      result.error = err.message;
      say(`failed               ${f.name}: ${err.message}`);
    }
  }
  return results;
}

/** Put the original /uploads/... references back for every migrated file. Stored objects are kept. */
export async function rollbackMigration({ results, say = () => {} }) {
  let restored = 0;
  for (const r of results.filter((x) => x.ref && x.references_updated)) {
    await db.tx(async (c) => {
      const n = await rewriteReferences(c, r, r.ref, r.legacy_url);
      restored += n;
    });
    say(`restored ${r.name}`);
  }
  return { restored };
}

/** Re-check that each migrated reference is in place and its file still downloads intact. */
export async function verifyMigration({ results }) {
  const out = [];
  for (const r of results.filter((x) => x.ref)) {
    const inPlace = await db.tx((c) => confirmReferences(c, r, r.ref, r.legacy_url));
    const shown = await displayUrl(r.ref);
    out.push({ name: r.name, references_in_place: inPlace, retrievable: Boolean(shown) && (await fetchHash(shown)) === r.sha256 });
  }
  return out;
}

export function manifestMarkdown(inv) {
  const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
  const lines = [
    '# Media migration manifest',
    '',
    `Generated ${inv.generated_at} by \`node scripts/media-migrate.js inventory --write-doc\` (read-only).`,
    '',
    `Source: \`${inv.upload_dir}\` · inventory checksum **${inv.checksum}** (pass it to \`apply --confirm=\`).`,
    '',
    '| Total files | Total size | Ready | Already migrated | Orphans | Conflicts | Invalid | References to rewrite | Broken references |',
    '|---|---|---|---|---|---|---|---|---|',
    `| ${inv.totals.files} | ${mb(inv.totals.bytes)} | ${inv.totals.ready} | ${inv.totals.already_migrated} | ${inv.totals.orphan} | ${inv.totals.conflict} | ${inv.totals.invalid} | ${inv.totals.references} | ${inv.totals.broken_references} |`,
    '',
    '## Files',
    '',
    '| File | Size | Type | SHA-256 (first 16) | Pixels / length | Used by | Target | Status |',
    '|---|---|---|---|---|---|---|---|',
    ...inv.files.map((f) => {
      const used = f.references.length ? f.references.map((r) => `${r.table}.${r.column}`).filter((v, i, a) => a.indexOf(v) === i).join(', ') : '—';
      const shape = f.kind === 'image' ? `${f.width}×${f.height}` : f.kind === 'video' ? `${f.duration_seconds ?? '?'} s` : '—';
      const target = f.bucket ? `${f.bucket} (${f.visibility})<br>\`${f.object_path}\`` : '—';
      return `| \`${f.name}\` | ${mb(f.bytes)} | ${f.mime} | \`${f.sha256.slice(0, 16)}\` | ${shape} | ${used}${f.history_references ? ` (+${f.history_references} in audit log)` : ''} | ${target} | ${f.status}${f.notes.length ? `: ${f.notes.join(' ')}` : ''} |`;
    }),
    '',
    '## Database values pointing at files that are not on disk',
    '',
    inv.broken_references.length ? inv.broken_references.map((b) => `- \`${b.url}\` in ${[...new Set(b.where)].join(', ')}`).join('\n') : 'None.',
    '',
  ];
  return lines.join('\n');
}

// ---- CLI ---------------------------------------------------------------------------------

async function main() {
  const [cmd = 'inventory', ...rest] = process.argv.slice(2);
  const arg = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (cmd === 'inventory') {
    const inv = await buildInventory();
    const file = path.join(OUT_DIR, `manifest-${inv.checksum}.json`);
    fs.writeFileSync(file, JSON.stringify(inv, null, 2));
    if (rest.includes('--write-doc')) fs.writeFileSync(path.join(root, 'docs', 'security', 'MEDIA_MIGRATION_MANIFEST.md'), manifestMarkdown(inv));
    console.log(JSON.stringify(inv.totals));
    console.log(`Manifest: ${path.relative(root, file)}\nChecksum: ${inv.checksum}`);
  } else if (cmd === 'apply') {
    assertNotProductionTarget('Media migration', { allow: rest.includes('--production') });
    const confirm = arg('confirm');
    if (!confirm) throw new Error('apply needs --confirm=<checksum from inventory>');
    const inv = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `manifest-${confirm}.json`), 'utf8'));
    const results = await applyMigration({ inventory: inv, confirm, includeOrphans: !rest.includes('--skip-orphans'), say: console.log });
    const out = path.join(OUT_DIR, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`Results: ${path.relative(root, out)}`);
  } else if (cmd === 'verify' || cmd === 'rollback') {
    if (cmd === 'rollback') assertNotProductionTarget('Media rollback', { allow: rest.includes('--production') });
    const results = JSON.parse(fs.readFileSync(path.resolve(arg('results')), 'utf8'));
    const out = cmd === 'verify' ? await verifyMigration({ results }) : await rollbackMigration({ results, say: console.log });
    console.log(JSON.stringify(out, null, 2));
  } else {
    throw new Error(`Unknown command ${cmd}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error(`[media-migrate] ${err.message}`);
      pool.end().finally(() => process.exit(1));
    });
}
