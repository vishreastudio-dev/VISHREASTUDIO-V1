// Public access to the local upload store: only files the application still uses are served.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { api, ctx, dbSkipReason, fakePng, login, setup, teardown, uniqueEmail, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();
let admin;
let UPLOAD_DIR;

const png = () => Buffer.concat([fakePng(800, 1000), crypto.randomBytes(8)]);
const dataUrl = (buf) => `data:application/octet-stream;base64,${buf.toString('base64')}`;
const get = async (url) => {
  const r = await fetch(ctx.base + url);
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
};
/** A request whose path is sent exactly as written (fetch would normalise `..`). */
const raw = (rawPath, method = 'GET') =>
  new Promise((resolve, reject) => {
    const u = new URL(ctx.base);
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
const strayFile = (bytes = png()) => {
  const name = `image_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
  return name;
};
const saveProduct = (images) =>
  api('POST', '/api/admin/ops?section=product', { name: `Uploads ${Date.now()}`, price_inr: 1500, category: 'Tops', is_one_of_one: true, images }, { cookie: admin.cookie });

describe('local /uploads access', { skip, timeout: 180_000 }, () => {
  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
    ({ UPLOAD_DIR } = await import('../lib/uploads.js'));
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }, { timeout: 120_000 });
  after(teardown);

  test('a registered upload is served, before and after it is saved on a product', async () => {
    const buf = png();
    const up = await api('POST', '/api/upload', { image: dataUrl(buf), purpose: 'product' }, { cookie: admin.cookie });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.match(up.data.ref, /^\/uploads\/image_\d+_[0-9a-f]{16}\.png$/);
    const fresh = await get(up.data.ref);
    assert.equal(fresh.status, 200, 'the admin preview works straight after upload');
    assert.ok(fresh.buf.equals(buf));
    assert.equal((await saveProduct([up.data.ref])).status, 200);
    assert.equal((await get(up.data.ref)).status, 200);
  });

  test('an orphan file on disk answers 404 until a record uses it', async () => {
    const orphan = strayFile();
    const before = await get(`/uploads/${orphan}`);
    assert.equal(before.status, 404, 'unreferenced files are not public');
    assert.ok(!before.buf.includes(Buffer.from('PNG')), 'no file bytes in the 404');
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, orphan)), 'the file itself is kept');

    const legacy = strayFile();
    const p = await saveProduct([`/uploads/${legacy}`]);
    assert.equal(p.status, 200, JSON.stringify(p.data));
    assert.equal((await get(`/uploads/${legacy}`)).status, 200, 'a referenced legacy file stays public');
  });

  test('originals kept for rollback are private while nothing references them', async () => {
    const original = strayFile();
    await ctx.db.query(
      `INSERT INTO media_objects (driver, bucket, object_path, visibility, purpose, ref, kind, mime, bytes, sha256, legacy_url)
       VALUES ('supabase', 'product-images', $1, 'public', 'product', $2, 'image', 'image/png', 10, $3, $4)`,
      [`products/x/${original}`, `https://example.invalid/storage/v1/object/public/product-images/products/x/${original}`, 'a'.repeat(64), `/uploads/${original}`]
    );
    assert.equal((await get(`/uploads/${original}`)).status, 404);
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, original)));
  });

  test('a deleted upload stops being served', async () => {
    const storage = await import('../lib/storage.js');
    const up = await api('POST', '/api/upload', { image: dataUrl(png()), purpose: 'banner' }, { cookie: admin.cookie });
    assert.equal((await get(up.data.ref)).status, 200);
    assert.deepEqual(await storage.safeDelete(up.data.ref), { deleted: true });
    assert.equal((await get(up.data.ref)).status, 404);
  });

  test('path traversal, hidden folders and odd names are refused', async () => {
    const served = strayFile();
    await saveProduct([`/uploads/${served}`]);
    for (const p of [
      '/uploads/../server.js',
      '/uploads/..%2fserver.js',
      '/uploads/%2e%2e/server.js',
      '/uploads/%2e%2e%2fpackage.json',
      '/uploads/..\\server.js',
      '/uploads/.private/x.png',
      `/uploads/sub/${served}`,
      `/uploads/${served}%00.png`,
      `/uploads/${served}/`,
      '/uploads/',
      '/uploads',
    ]) {
      const r = await raw(p);
      assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!/"type":\s*"module"|import express|PNG/.test(r.body), `${p} leaked file content`);
    }
  });

  test('approved cleanup: verified backup first, refuses on any mismatch or reference, keeps backups', async () => {
    const { prepare, check, remove } = await import('../scripts/media-local-cleanup.js');
    const os = await import('os');
    const sha = (n) => crypto.createHash('sha256').update(fs.readFileSync(path.join(UPLOAD_DIR, n))).digest('hex');
    const a = strayFile();
    const b = strayFile();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vishrea-cleanup-'));
    const list = path.join(work, 'list.json');

    fs.writeFileSync(list, JSON.stringify([{ name: a, sha256: '0'.repeat(64) }]));
    assert.throws(() => prepare({ list, out: path.join(work, 'bad') }), /SHA-256 differs/);
    fs.writeFileSync(list, JSON.stringify([{ name: '../server.js', sha256: '0'.repeat(64) }]));
    assert.throws(() => prepare({ list, out: path.join(work, 'bad2') }), /not a plain upload file name/);

    fs.writeFileSync(list, JSON.stringify([{ name: a, sha256: sha(a) }, { name: b, sha256: sha(b) }]));
    const out = path.join(work, 'backup');
    const manifest = prepare({ list, out });
    const manifestFile = path.join(out, 'manifest.json');
    assert.equal((await check({ manifestFile })).ok, true);
    await assert.rejects(remove({ manifestFile, confirm: 'wrong' }), /pass --confirm=/);

    await saveProduct([`/uploads/${b}`]);
    const blocked = await check({ manifestFile });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.problems, [b], 'a referenced file blocks the run');
    await assert.rejects(remove({ manifestFile, confirm: manifest.checksum }), /failed a check/);
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, a)) && fs.existsSync(path.join(UPLOAD_DIR, b)), 'nothing deleted');

    fs.writeFileSync(list, JSON.stringify([{ name: a, sha256: sha(a) }]));
    const out2 = path.join(work, 'backup2');
    const m2 = prepare({ list, out: out2 });
    const r = await remove({ manifestFile: path.join(out2, 'manifest.json'), confirm: m2.checksum });
    assert.deepEqual(r.deleted, [a]);
    assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, a)));
    assert.ok(fs.existsSync(path.join(out2, a)), 'the backup is kept');
    fs.rmSync(work, { recursive: true, force: true });
  });

  test('private evidence is never reachable through /uploads, and writes are refused', async () => {
    const customer = await login(uniqueEmail('uploads-private'));
    const up = await api('POST', '/api/upload', { image: dataUrl(png()) }, { cookie: customer.cookie });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const key = up.data.ref.replace(/^storage:\/\//, '');
    for (const p of [`/uploads/.private/${key}`, `/uploads/${path.basename(key)}`, `/uploads/.private/${key.split('/')[0]}`]) {
      assert.equal((await raw(p)).status, 404, p);
    }
    const served = strayFile();
    await saveProduct([`/uploads/${served}`]);
    const before = fs.readFileSync(path.join(UPLOAD_DIR, served));
    for (const method of ['PUT', 'POST', 'DELETE']) {
      assert.equal((await raw(`/uploads/${served}`, method)).status, 404, method);
    }
    assert.ok(fs.readFileSync(path.join(UPLOAD_DIR, served)).equals(before), 'the file is unchanged');
    assert.equal((await raw(`/uploads/${served}`, 'HEAD')).status, 200);
  });
});
