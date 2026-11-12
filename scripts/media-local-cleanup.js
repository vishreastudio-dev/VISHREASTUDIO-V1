#!/usr/bin/env node
/**
 * Remove an approved list of unused files from the local upload store, with a verified backup.
 *
 *   node scripts/media-local-cleanup.js prepare --list=<file.json> --out=<backup dir>
 *       copy each listed file into the backup dir, verify every copy, write manifest.json
 *   node scripts/media-local-cleanup.js check --manifest=<backup dir>/manifest.json
 *       dry run: originals and backups still match, and nothing references any file
 *   node scripts/media-local-cleanup.js delete --manifest=<…>/manifest.json --confirm=<checksum>
 *       the same checks, then delete the originals from the upload store (backups are kept)
 *
 * The list is JSON: [{ "name": "<file in UPLOAD_DIR>", "sha256": "<expected hex>" }, ...]. A file
 * whose bytes, backup or references differ from the manifest stops the whole run before anything
 * is deleted. Only files directly inside UPLOAD_DIR can be listed.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { pool } from '../lib/db.js';
import { countReferences } from '../lib/media-references.js';
import { UPLOAD_DIR } from '../lib/uploads.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checksumOf = (files) => crypto.createHash('sha256').update(JSON.stringify(files.map((f) => [f.name, f.sha256, f.bytes]))).digest('hex').slice(0, 12);

function original(name) {
  if (!NAME.test(name) || name.includes('..')) throw new Error(`not a plain upload file name: ${name}`);
  return path.join(UPLOAD_DIR, name);
}

export function prepare({ list, out }) {
  const wanted = JSON.parse(fs.readFileSync(list, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const files = wanted.map(({ name, sha256: expected }) => {
    const src = original(name);
    if (!fs.existsSync(src)) throw new Error(`${name}: not found in the upload store`);
    if (sha256(src) !== expected) throw new Error(`${name}: SHA-256 differs from the approved manifest`);
    const dest = path.join(out, name);
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    if (sha256(dest) !== expected) throw new Error(`${name}: backup copy does not match`);
    return { name, sha256: expected, bytes: fs.statSync(src).size, backup: name };
  });
  const manifest = { created_at: new Date().toISOString(), upload_dir: UPLOAD_DIR, files, checksum: checksumOf(files) };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function check({ manifestFile, c = pool }) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const dir = path.dirname(manifestFile);
  if (checksumOf(manifest.files) !== manifest.checksum) throw new Error('manifest has been edited since it was prepared');
  const rows = [];
  for (const f of manifest.files) {
    const src = original(f.name);
    const ref = `/uploads/${f.name}`;
    const refs = await countReferences(c, ref);
    const registered = (await c.query('SELECT count(*)::int AS n FROM media_objects WHERE (ref = $1 OR legacy_url = $1) AND deleted_at IS NULL', [ref])).rows[0].n;
    rows.push({
      name: f.name,
      present: fs.existsSync(src),
      original_matches: fs.existsSync(src) && sha256(src) === f.sha256,
      backup_matches: fs.existsSync(path.join(dir, f.backup)) && sha256(path.join(dir, f.backup)) === f.sha256,
      references: refs.total,
      registered,
    });
  }
  const problems = rows.filter((r) => r.present && (!r.original_matches || !r.backup_matches || r.references || r.registered));
  return { checksum: manifest.checksum, rows, ok: problems.length === 0, problems: problems.map((p) => p.name) };
}

export async function remove({ manifestFile, confirm, c = pool }) {
  const result = await check({ manifestFile, c });
  if (confirm !== result.checksum) throw new Error(`Refusing to delete: pass --confirm=${result.checksum} after reviewing the check.`);
  if (!result.ok) throw new Error(`Refusing to delete: ${result.problems.join(', ')} failed a check.`);
  const deleted = [];
  for (const r of result.rows.filter((x) => x.present)) {
    fs.rmSync(original(r.name));
    deleted.push(r.name);
  }
  return { deleted, kept_backups: path.dirname(manifestFile) };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n) => rest.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (cmd === 'prepare') return console.log(JSON.stringify(prepare({ list: arg('list'), out: arg('out') }), null, 2));
  if (cmd === 'check') return console.log(JSON.stringify(await check({ manifestFile: arg('manifest') }), null, 2));
  if (cmd === 'delete') return console.log(JSON.stringify(await remove({ manifestFile: arg('manifest'), confirm: arg('confirm') }), null, 2));
  throw new Error('Usage: prepare --list=<json> --out=<dir> | check --manifest=<file> | delete --manifest=<file> --confirm=<checksum>');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error(`[media-local-cleanup] ${err.message}`);
      pool.end().finally(() => process.exit(1));
    });
}
