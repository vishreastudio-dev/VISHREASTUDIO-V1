// Media storage on Supabase Storage (stand-in server, real @supabase/supabase-js SDK): buckets,
// public and private uploads, signed links, upload security, failure handling, compensation, safe
// deletion, orphan scanning, and the migration of the local store with verification and rollback.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { api, ctx, dbSkipReason, DELIVERY, fakeMp4, fakePng, login, pay, setup, storageMock, teardown, uniqueEmail, ADMIN_EMAIL, STORAGE_KEY } from './helpers.js';

const skip = await dbSkipReason();
let admin;
let storage;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const png = (w = 800, h = 1000) => Buffer.concat([fakePng(w, h), crypto.randomBytes(8)]);
const dataUrl = (buf) => `data:application/octet-stream;base64,${buf.toString('base64')}`;
const upload = (buf, purpose, cookie = admin.cookie, field = 'image') => api('POST', '/api/upload', { [field]: dataUrl(buf), ...(purpose ? { purpose } : {}) }, { cookie });
const objectCount = () => storageMock.objects.size;
const fetchBytes = async (url) => {
  const r = await fetch(url.startsWith('/') ? ctx.base + url : url);
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
};

async function deliveredOrder(buyerCookie) {
  const p = await api('POST', '/api/admin/ops?section=product', { name: `Evidence ${Date.now()}`, price_inr: 1500, category: 'Tops', is_one_of_one: true }, { cookie: admin.cookie });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  await api('DELETE', '/api/cart', { all: true }, { cookie: buyerCookie });
  await api('POST', '/api/cart', { variant_id: p.data.product.variants[0].id, quantity: 1 }, { cookie: buyerCookie });
  const co = await api('POST', '/api/checkout', DELIVERY, { cookie: buyerCookie });
  assert.equal(co.status, 201, JSON.stringify(co.data));
  await api('POST', '/api/payment-verify', { order_id: co.data.order_id, ...pay(co.data.razorpay.order_id) }, { cookie: buyerCookie });
  await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'dispatched', tracking_number: 'TRK-ST-1' }, { cookie: admin.cookie });
  await api('POST', '/api/admin/ops?section=order', { id: co.data.order_id, status: 'delivered' }, { cookie: admin.cookie });
  return co.data.order_id;
}

describe('Supabase Storage media', { skip, timeout: 300_000 }, () => {
  let productRef;
  let evidenceOwner;
  let evidenceOrder;

  before(async () => {
    await setup({ env: { STORAGE_DRIVER: 'supabase' } });
    admin = await login(ADMIN_EMAIL);
    storage = await import('../lib/storage.js');
  }, { timeout: 120_000 });
  after(teardown);

  test('bucket setup creates public and private buckets with limits, and corrects wrong visibility', async () => {
    assert.ok((await storage.ensureBuckets()).every((b) => b.status === 'missing'), 'report-only mode creates nothing');
    assert.equal(storageMock.buckets.size, 0);
    assert.ok((await storage.ensureBuckets({ fix: true })).every((b) => b.status === 'created'));
    for (const id of ['product-images', 'homepage-banners', 'instagram-media', 'customer-feedback']) assert.equal(storageMock.buckets.get(id).public, true, id);
    for (const id of ['exchange-evidence', 'media-archive']) assert.equal(storageMock.buckets.get(id).public, false, id);
    assert.equal(storageMock.buckets.get('exchange-evidence').file_size_limit, 5 * 1024 * 1024);
    storageMock.buckets.get('exchange-evidence').public = true;
    assert.match((await storage.ensureBuckets()).find((b) => b.id === 'exchange-evidence').status, /WRONG VISIBILITY/);
    await storage.ensureBuckets({ fix: true });
    assert.equal(storageMock.buckets.get('exchange-evidence').public, false);
  });

  test('product photos: public bucket, server-chosen names, metadata recorded, usable on a product', async () => {
    const buf = png(1200, 1500);
    const r = await upload(buf, 'product');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    productRef = r.data.ref;
    assert.match(productRef, new RegExp(`^${ctx.storageUrl}/storage/v1/object/public/product-images/products/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png$`));
    assert.equal(r.data.url, productRef, 'public files are displayed by their own URL');
    const pub = await fetchBytes(productRef);
    assert.equal(pub.status, 200);
    assert.equal(sha(pub.buf), sha(buf), 'the stored file is byte-identical');
    assert.equal(storageMock.objects.get(productRef.split('/public/')[1]).cacheControl, 'max-age=31536000', 'random public names cache for a year');
    const row = (await ctx.db.query('SELECT * FROM media_objects WHERE ref = $1', [productRef])).rows[0];
    assert.equal(row.driver, 'supabase');
    assert.equal(row.visibility, 'public');
    assert.equal(row.sha256, sha(buf));
    assert.equal(Number(row.bytes), buf.length);
    assert.deepEqual([row.width, row.height], [1200, 1500]);

    const second = await upload(png(900, 1200), 'product');
    const p = await api('POST', '/api/admin/ops?section=product', { name: `Stored ${Date.now()}`, price_inr: 1500, category: 'Tops', is_one_of_one: true, images: [productRef, second.data.ref] }, { cookie: admin.cookie });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    assert.deepEqual(p.data.product.images, [productRef, second.data.ref], 'multiple product images are kept in order');
    assert.equal(p.data.product.image_url, productRef);
  });

  test('an identical upload is stored once', async () => {
    const buf = png(640, 800);
    const first = await upload(buf, 'product');
    const before = objectCount();
    const again = await upload(buf, 'product');
    assert.equal(again.status, 200);
    assert.equal(again.data.deduplicated, true);
    assert.equal(again.data.ref, first.data.ref);
    assert.equal(objectCount(), before, 'no second object');
  });

  test('banners: banner bucket, sizes from metadata, publishable on the homepage carousel', async () => {
    const b = await upload(png(1920, 800), 'banner');
    assert.equal(b.status, 201);
    assert.match(b.data.ref, /\/homepage-banners\/banners\//);
    const first = (await api('GET', '/api/admin/homepage-carousel', undefined, { cookie: admin.cookie })).data.slides[0];
    const saved = await api('POST', '/api/admin/homepage-carousel', { action: 'update', id: first.id, version: first.version, publish: true, slide: { ...first.slide, desktop_image: { url: b.data.ref }, image_alt: 'Banner' } }, { cookie: admin.cookie });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.result.slide.desktop_image, { url: b.data.ref, width: 1920, height: 800 });
    assert.equal((await api('GET', '/api/homepage-carousel')).data.slides[0].desktop_image.url, b.data.ref);
    const home = await api('GET', '/');
    if (typeof home.data === 'string') assert.match(home.headers.get('content-security-policy') || home.headers.get('content-security-policy-report-only') || '', new RegExp(`media-src[^;]*${ctx.storageUrl.replace(/[.]/g, '\\.')}`));
  });

  test('customer videos: public bucket; a replaced file is deleted only when nothing uses it', async () => {
    const a = await upload(fakeMp4(5), 'video', admin.cookie, 'video');
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.match(a.data.ref, /\/customer-feedback\/videos\//);
    assert.equal(a.data.duration_seconds, 5);
    const save = (body) => api('POST', '/api/admin/ops?section=content', { type: 'video', title: 'Look', active: false, ...body }, { cookie: admin.cookie });
    assert.equal((await save({ video_url: a.data.ref })).status, 200);
    const id = (await ctx.db.query('SELECT id FROM feedback_videos WHERE video_url = $1', [a.data.ref])).rows[0].id;

    const b = await upload(Buffer.concat([fakeMp4(6), crypto.randomBytes(4)]), 'video', admin.cookie, 'video');
    assert.equal((await save({ id, video_url: b.data.ref })).status, 200);
    const keyA = new URL(a.data.ref).pathname.split('/public/')[1];
    assert.equal(storageMock.objects.has(keyA), false, 'the replaced, unused file was deleted after the change committed');
    assert.ok((await ctx.db.query('SELECT deleted_at FROM media_objects WHERE ref = $1', [a.data.ref])).rows[0].deleted_at);

    // A file still used by another row survives the replacement.
    assert.equal((await save({ video_url: b.data.ref, title: 'Second use' })).status, 200);
    const c = await upload(Buffer.concat([fakeMp4(4), crypto.randomBytes(4)]), 'video', admin.cookie, 'video');
    assert.equal((await save({ id, video_url: c.data.ref })).status, 200);
    assert.ok(storageMock.objects.has(new URL(b.data.ref).pathname.split('/public/')[1]), 'still referenced, so kept');

    assert.equal((await api('POST', '/api/admin/ops?section=content', { type: 'video', title: 'Fake', video_url: `${ctx.storageUrl}/storage/v1/object/public/customer-feedback/videos/nope.mp4` }, { cookie: admin.cookie })).status, 400, 'an unregistered URL is not accepted as an uploaded video');
  });

  test('exchange evidence is private: owner-only references, expiring signed links, visible to staff', async () => {
    const buyer = await login(uniqueEmail('evidence'));
    evidenceOwner = buyer.user.id;
    evidenceOrder = await deliveredOrder(buyer.cookie);
    const buf = png(1000, 1200);
    const up = await upload(buf, undefined, buyer.cookie);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.match(up.data.ref, new RegExp(`^storage://exchange-evidence/evidence/${evidenceOwner}/[0-9a-f]{32}\\.png$`));
    const objectKey = up.data.ref.slice('storage://'.length);
    assert.equal(storageMock.objects.get(objectKey).cacheControl, 'max-age=0', 'private evidence is never cached beyond its signed link');
    assert.equal((await fetchBytes(`${ctx.storageUrl}/storage/v1/object/public/${objectKey}`)).status, 400, 'no public URL works for a private bucket');
    const signed = await fetchBytes(up.data.url);
    assert.equal(signed.status, 200, 'the signed link works');
    assert.equal(sha(signed.buf), sha(buf));
    storageMock.expireSignedLinks();
    assert.equal((await fetchBytes(up.data.url)).status, 400, 'an expired signed link stops working');

    // Another customer cannot attach this evidence to their own claim.
    const other = await login(uniqueEmail('intruder'));
    const otherOrder = await deliveredOrder(other.cookie);
    const stolen = await api('POST', '/api/exchange', { order_id: otherOrder, reason: 'Damaged seam', claim_type: 'damage', evidence_urls: [up.data.ref] }, { cookie: other.cookie });
    assert.equal(stolen.status, 400);
    assert.equal(stolen.data.error, 'damage_photos_required', 'foreign evidence is ignored');

    const claim = await api('POST', '/api/exchange', { order_id: evidenceOrder, reason: 'Damaged seam', claim_type: 'damage', evidence_urls: [up.data.ref, '/uploads/whatever.png', 'https://evil.example/x.png'] }, { cookie: buyer.cookie });
    assert.equal(claim.status, 201, JSON.stringify(claim.data));
    const stored = (await ctx.db.query('SELECT evidence_urls FROM exchanges WHERE id = $1', [claim.data.exchange.id])).rows[0].evidence_urls;
    assert.deepEqual(stored, [up.data.ref], 'only the owner’s own upload is kept');

    assert.equal((await api('GET', '/api/admin/ops?section=exchanges', undefined, { cookie: buyer.cookie })).status, 403, 'customers cannot use the staff view');
    const staff = await api('GET', '/api/admin/ops?section=exchanges', undefined, { cookie: admin.cookie });
    const row = staff.data.exchanges.find((x) => x.id === claim.data.exchange.id);
    assert.equal(row.evidence[0].ref, up.data.ref);
    assert.match(row.evidence[0].url, /\/storage\/v1\/object\/sign\/exchange-evidence\//);
    assert.equal((await fetchBytes(row.evidence[0].url)).status, 200, 'staff get a fresh signed link');
    assert.equal(staff.headers.get('cache-control'), 'no-store', 'signed links are never cached');
  });

  test('upload security: type from bytes, purpose rules, size and readability limits, guests refused', async () => {
    const before = objectCount();
    const customer = await login(uniqueEmail('limits'));
    assert.equal((await api('POST', '/api/upload', { image: dataUrl(png()) })).status, 401);
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), undefined, customer.cookie)).status, 415);
    assert.equal((await upload(Buffer.from('<html><script>alert(1)</script></html>'), undefined, customer.cookie, 'file')).status, 415);
    assert.equal((await upload(Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(64)]), undefined, customer.cookie, 'file')).status, 415, 'executables are refused');
    assert.equal((await upload(png(), 'product', customer.cookie)).status, 403, 'customers can only upload evidence');
    assert.equal((await upload(fakeMp4(3), undefined, customer.cookie, 'video')).status, 403, 'customers cannot upload video');
    assert.equal((await upload(Buffer.concat([fakePng(800, 800), Buffer.alloc(5.5 * 1024 * 1024)]), undefined, customer.cookie)).status, 413, 'customer images over 5 MB');
    assert.equal((await upload(Buffer.concat([fakePng(0, 0), Buffer.alloc(32)]), 'product')).status, 422, 'an image without readable dimensions');
    assert.equal((await upload(fakePng(20000, 400), 'product')).status, 422, 'absurd dimensions');
    assert.equal((await upload(png(), 'evidence')).status, 400, 'staff purposes are limited');
    assert.equal((await upload(fakeMp4(5), 'product', admin.cookie, 'video')).status, 403, 'a video is not a product photo');
    assert.equal(objectCount(), before, 'nothing refused reached storage');
  });

  test('path traversal, client file names, forged links and unauthorised deletion are refused', async () => {
    const customer = await login(uniqueEmail('traversal'));
    const named = await api('POST', '/api/upload', { image: dataUrl(png()), filename: '../../server.js', name: '..\\..\\.env.png' }, { cookie: customer.cookie });
    assert.equal(named.status, 201, JSON.stringify(named.data));
    assert.match(named.data.ref, /^storage:\/\/exchange-evidence\/evidence\/[^/.]+\/[0-9a-f]{32}\.png$/, 'the stored name is always server-chosen');

    for (const ref of [
      'storage://exchange-evidence/../media-archive/x.png',
      'storage://exchange-evidence/evidence/../../x.png',
      `${ctx.storageUrl}/storage/v1/object/public/product-images/..%2F..%2Fx.png`,
      '/uploads/../.env',
    ]) {
      assert.equal(storage.parseRef(ref), null, ref);
      assert.equal(await storage.displayUrl(ref), null, ref);
    }
    const exp = Math.floor(Date.now() / 1000) + 300;
    const forged = await api('GET', `/api/media/signed?ref=${encodeURIComponent('storage://exchange-evidence/../../.env')}&exp=${exp}&sig=AAAA`);
    assert.equal(forged.status, 404, 'no signed link without a valid signature');

    assert.equal((await upload(png(), 'archive', customer.cookie)).status, 403, 'customers cannot write to the archive');
    assert.equal((await upload(png(), 'archive')).status, 400, 'the archive is not an upload purpose');
    const del = await api('DELETE', `/api/admin/ops?section=content&type=video&id=${crypto.randomUUID()}`, undefined, { cookie: customer.cookie });
    assert.equal(del.status, 403, 'customers cannot delete media records');
    assert.ok(storageMock.objects.has(productRef.split('/public/')[1]), 'existing files untouched');
  });

  test('storage failures: bounded retry, clear 503s, nothing leaked, server stays up, no orphans', async () => {
    const rows = async () => (await ctx.db.query('SELECT count(*)::int AS n FROM media_objects')).rows[0].n;
    storageMock.failNext = 1;
    assert.equal((await upload(png(), 'product')).status, 201, 'a single transient failure is retried');

    const n = await rows();
    for (const [label, apply, undo] of [
      ['outage', () => (storageMock.down = true), () => (storageMock.down = false)],
      ['permission denied', () => (storageMock.denyAll = true), () => (storageMock.denyAll = false)],
      ['repeated 5xx', () => (storageMock.failNext = 10), () => (storageMock.failNext = 0)],
    ]) {
      apply();
      const r = await upload(png(), 'product');
      undo();
      assert.equal(r.status, 503, label);
      assert.equal(r.data.error, 'storage_unavailable', label);
      const text = JSON.stringify(r.data);
      assert.ok(!text.includes(STORAGE_KEY) && !text.includes('127.0.0.1') && !/row-level|supabase/i.test(text), `${label}: no internals in the response`);
    }
    const saved = storageMock.buckets.get('instagram-media');
    storageMock.buckets.delete('instagram-media');
    assert.equal((await upload(png(), 'instagram')).status, 503, 'missing bucket');
    storageMock.buckets.set('instagram-media', saved);
    assert.equal(await rows(), n, 'no metadata rows for failed uploads');
    assert.equal((await api('GET', '/api/health')).status, 200, 'the server is still serving');
  });

  test('a failed metadata write removes the uploaded object again (compensation)', async () => {
    const before = objectCount();
    await ctx.db.query('ALTER TABLE media_objects ADD CONSTRAINT test_block_inserts CHECK (bytes < 0) NOT VALID');
    try {
      const r = await upload(png(), 'product');
      assert.equal(r.status, 503);
    } finally {
      await ctx.db.query('ALTER TABLE media_objects DROP CONSTRAINT test_block_inserts');
    }
    assert.equal(objectCount(), before, 'the object was removed after the failed insert');
  });

  test('safe deletion never removes a referenced file', async () => {
    const kept = await storage.safeDelete(productRef);
    assert.equal(kept.deleted, false);
    assert.equal(kept.reason, 'referenced');
    assert.ok(kept.references['products.image_url']);
    assert.ok(storageMock.objects.has(new URL(productRef).pathname.split('/public/')[1]));

    const loose = await upload(png(), 'product');
    assert.deepEqual(await storage.safeDelete(loose.data.ref), { deleted: true });
    assert.equal(storageMock.objects.has(new URL(loose.data.ref).pathname.split('/public/')[1]), false);
    assert.equal((await storage.mediaInfo(loose.data.ref)), null);
  });

  test('the orphan scanner reports unused and unregistered files and deletes nothing', async () => {
    const { findOrphans } = await import('../scripts/media-orphans.js');
    const loose = await upload(png(), 'banner');
    storageMock.objects.set('homepage-banners/stray/manual-upload.png', { buf: png(), type: 'image/png' });
    const before = objectCount();
    const report = await findOrphans({ minAgeHours: 0 });
    assert.ok(report.registered_orphans.some((o) => o.ref === loose.data.ref));
    assert.ok(!report.registered_orphans.some((o) => o.ref === productRef), 'a used file is never an orphan');
    assert.ok(report.unregistered_objects.some((o) => o.path === 'stray/manual-upload.png'));
    assert.equal(objectCount(), before, 'dry run');
    assert.equal((await findOrphans({ minAgeHours: 24 })).registered_orphans.some((o) => o.ref === loose.data.ref), false, 'recent uploads are given time to be saved');
  });

  test('migration of the local store: inventory, verified apply, idempotent re-run, verify and rollback', async () => {
    const { applyMigration, buildInventory, rollbackMigration, verifyMigration } = await import('../scripts/media-migrate.js');
    const dir = process.env.UPLOADS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const legacy = (name, buf) => {
      fs.writeFileSync(path.join(dir, name), buf);
      return { name, url: `/uploads/${name}`, buf };
    };
    const A = legacy('image_1700000000001_aaaaaaaaaaaaaaaa.png', png(1000, 1250));
    const B = legacy('image_1700000000002_bbbbbbbbbbbbbbbb.png', png(1000, 1250));
    const V = legacy('video_1700000000003_cccccccccccccccc.mp4', Buffer.concat([fakeMp4(7), crypto.randomBytes(4)]));
    const E = legacy('image_1700000000004_dddddddddddddddd.png', png(900, 900));
    const O = legacy('image_1700000000005_eeeeeeeeeeeeeeee.png', png(700, 700));
    const X = legacy('image_1700000000006_ffffffffffffffff.png', Buffer.from('not really an image, just text'));

    const product = (await ctx.db.query('SELECT id FROM products ORDER BY created_at LIMIT 1')).rows[0].id;
    await ctx.db.query('UPDATE products SET image_url = $2, images = $3 WHERE id = $1', [product, A.url, JSON.stringify([A.url, B.url])]);
    const video = (await ctx.db.query("INSERT INTO feedback_videos (title, video_url, duration_seconds, active) VALUES ('Legacy', $1, 7, false) RETURNING id", [V.url])).rows[0].id;
    await ctx.db.query("INSERT INTO feedback_videos (title, video_url, duration_seconds, active) VALUES ('Broken', '/uploads/video_1_missing0000000000.mp4', 3, false)");
    await ctx.db.query("UPDATE exchanges SET status = 'completed' WHERE order_id = $1", [evidenceOrder]); // one open request per order
    const exchange = (await ctx.db.query("INSERT INTO exchanges (order_id, auth_user_id, reason, claim_type, evidence_urls) VALUES ($1, $2, 'Legacy claim', 'damage', $3) RETURNING id", [evidenceOrder, evidenceOwner, JSON.stringify([E.url])])).rows[0].id;
    await ctx.db.query("INSERT INTO audit_logs (action, details) VALUES ('legacy_note', $1)", [JSON.stringify({ image: A.url })]);

    const inv = await buildInventory();
    const f = (n) => inv.files.find((x) => x.name === n.name);
    assert.equal(f(A).category, 'product');
    assert.equal(f(A).object_path, `products/${product}/${A.name}`);
    assert.equal(f(A).history_references, 1, 'audit log mentions are reported but never rewritten');
    assert.equal(f(B).category, 'product');
    assert.equal(f(V).category, 'video');
    assert.equal(f(E).category, 'evidence');
    assert.equal(f(E).visibility, 'private');
    assert.equal(f(E).object_path, `evidence/${evidenceOwner}/legacy-${E.name}`);
    assert.equal(f(O).status, 'orphan');
    assert.equal(f(O).bucket, 'media-archive');
    assert.equal(f(X).status, 'invalid');
    assert.equal(f(A).sha256, sha(A.buf));
    assert.ok(inv.broken_references.some((b) => b.url === '/uploads/video_1_missing0000000000.mp4'));

    await assert.rejects(applyMigration({ inventory: inv, confirm: 'wrong' }), /Checksum mismatch/);
    const results = await applyMigration({ inventory: inv, confirm: inv.checksum });
    const r = (n) => results.find((x) => x.name === n.name);
    for (const n of [A, B, V, E, O]) assert.equal(r(n).status, 'migrated', `${n.name}: ${r(n).error || ''}`);
    assert.equal(r(X).status, 'skipped');

    const prod = (await ctx.db.query('SELECT image_url, images FROM products WHERE id = $1', [product])).rows[0];
    assert.equal(prod.image_url, r(A).ref);
    assert.deepEqual(prod.images, [r(A).ref, r(B).ref], 'JSON arrays are rewritten element by element');
    assert.equal((await ctx.db.query('SELECT video_url FROM feedback_videos WHERE id = $1', [video])).rows[0].video_url, r(V).ref);
    const ev = (await ctx.db.query('SELECT evidence_urls FROM exchanges WHERE id = $1', [exchange])).rows[0].evidence_urls;
    assert.deepEqual(ev, [`storage://exchange-evidence/evidence/${evidenceOwner}/legacy-${E.name}`], 'evidence becomes a private reference');
    assert.match(JSON.stringify((await ctx.db.query("SELECT details FROM audit_logs WHERE action = 'legacy_note'")).rows[0].details), /\/uploads\//, 'history untouched');
    for (const n of [A, B, V, E, O, X]) assert.ok(fs.existsSync(path.join(dir, n.name)), `${n.name} kept on disk`);
    assert.equal(sha(storageMock.objects.get(`product-images/products/${product}/${A.name}`).buf), sha(A.buf));
    assert.equal((await fetchBytes(`${ctx.storageUrl}/storage/v1/object/public/exchange-evidence/evidence/${evidenceOwner}/legacy-${E.name}`)).status, 400, 'migrated evidence is not public');

    // Re-running is safe: nothing is uploaded twice.
    const objects = objectCount();
    const inv2 = await buildInventory();
    assert.equal(inv2.files.find((x) => x.name === A.name).status, 'already_migrated');
    const again = await applyMigration({ inventory: inv2, confirm: inv2.checksum });
    assert.ok(again.filter((x) => x.status === 'migrated').length === 0);
    assert.equal(objectCount(), objects, 'no duplicate objects');

    const checks = await verifyMigration({ results });
    assert.ok(checks.every((c) => c.references_in_place && c.retrievable), JSON.stringify(checks));

    const back = await rollbackMigration({ results });
    assert.ok(back.restored >= 5);
    const restored = (await ctx.db.query('SELECT image_url, images FROM products WHERE id = $1', [product])).rows[0];
    assert.equal(restored.image_url, A.url);
    assert.deepEqual(restored.images, [A.url, B.url]);
    assert.deepEqual((await ctx.db.query('SELECT evidence_urls FROM exchanges WHERE id = $1', [exchange])).rows[0].evidence_urls, [E.url]);
    assert.ok(storageMock.objects.has(`product-images/products/${product}/${A.name}`), 'rollback keeps the copies');
  });
});
