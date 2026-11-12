// Homepage hero carousel end to end: the seeded draft, upload → draft → publish, draft privacy,
// editing text without replacing the banner, validation, ordering, schedule, settings, cache
// invalidation, the homepage <head> preload, upload retention and admin-only access.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { api, ctx, dbSkipReason, fakePng, login, setup, teardown, uniqueEmail, ADMIN_EMAIL } from './helpers.js';

const skip = await dbSkipReason();
let admin;

const ADMIN = '/api/admin/homepage-carousel';
const act = (action, body, cookie = admin.cookie) => api('POST', ADMIN, { action, ...body }, { cookie });
const adminView = async () => (await api('GET', ADMIN, undefined, { cookie: admin.cookie })).data;
const publicView = async () => (await api('GET', '/api/homepage-carousel')).data;

// Each call uploads a distinct file (random tail bytes), so identical-upload de-duplication does not merge them.
async function upload(w, h) {
  const png = Buffer.concat([fakePng(w, h), crypto.randomBytes(8)]);
  const r = await api('POST', '/api/upload', { image: `data:image/png;base64,${png.toString('base64')}`, purpose: 'banner' }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { url: r.data.ref, width: w, height: h };
}

const ready = (over = {}) => ({ heading: 'Cozy Layers for Every Mood', image_alt: 'Model in a green sweater', ...over });

describe('homepage hero carousel', { skip, timeout: 300_000 }, () => {
  let seeded;
  let banner;

  before(async () => {
    await setup();
    admin = await login(ADMIN_EMAIL);
    banner = await upload(1920, 800);
  }, { timeout: 120_000 });
  after(teardown);

  test('the migration seeds the requested first slide as a private draft', async () => {
    const data = await adminView();
    assert.equal(data.slides.length, 1);
    seeded = data.slides[0];
    assert.equal(seeded.publication_status, 'draft');
    assert.equal(seeded.slide.heading, 'Cozy Layers for Every Mood');
    assert.equal(seeded.slide.subtitle, 'Sweaters, cardigans and more — effortless warmth, all season long.');
    assert.equal(seeded.slide.primary_cta.label, 'EXPLORE SWEATERS');
    assert.equal(seeded.slide.primary_cta.url, '/catalogue/sweaters');
    assert.equal(seeded.slide.desktop_image, null, 'no image path is invented');
    assert.ok(seeded.problems.desktop_image, 'publishing waits for a banner upload');
    assert.ok(data.categories.some((c) => c.slug === 'sweaters'), 'the CTA points at a real category');
    assert.equal(data.settings.autoplay_enabled, true);
    assert.deepEqual((await publicView()).slides, [], 'drafts are never public');

    const home = await api('GET', '/');
    if (typeof home.data === 'string' && home.status === 200) {
      assert.match(home.data, /<meta name="hero-carousel" content="none"/);
      assert.match(home.data, /rel="preload" as="image" href="\/assets\/hero-editorial\.jpg"/);
    }
  });

  test('only administrators can read or change the carousel', async () => {
    const customer = await login(uniqueEmail('nohero'));
    assert.equal((await api('GET', ADMIN)).status, 401);
    assert.equal((await api('GET', ADMIN, undefined, { cookie: customer.cookie })).status, 403);
    assert.equal((await act('create', { slide: ready() }, customer.cookie)).status, 403);
    assert.equal((await act('publish', { id: seeded.id }, customer.cookie)).status, 403);
    assert.equal((await api('DELETE', `${ADMIN}?id=${seeded.id}&confirm=true`, undefined, { cookie: customer.cookie })).status, 403);
    assert.equal((await act('settings', { settings: { is_enabled: false } }, customer.cookie)).status, 403);
    const r = await api('GET', ADMIN, undefined, { cookie: admin.cookie });
    assert.equal(r.headers.get('cache-control'), 'no-store', 'admin data is never cached publicly');
  });

  test('upload a banner, save a draft (still private), then publish (public)', async () => {
    const saved = await act('update', { id: seeded.id, version: seeded.version, slide: { ...seeded.slide, desktop_image: banner } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.result.slide.desktop_image, banner);
    assert.deepEqual((await publicView()).slides, [], 'saving a draft does not change the homepage');

    const pub = await act('publish', { id: seeded.id, version: saved.data.result.version });
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    const view = await publicView();
    assert.equal(view.slides.length, 1);
    const s = view.slides[0];
    assert.equal(s.heading, 'Cozy Layers for Every Mood');
    assert.equal(s.desktop_image.url, banner.url);
    assert.equal(s.primary_cta.url, '/catalogue/sweaters');
    assert.equal('starts_at' in s, false, 'schedule internals are not published');
    assert.equal(view.settings.transition_type, 'fade');

    const home = await api('GET', '/');
    if (typeof home.data === 'string' && home.status === 200) {
      assert.match(home.data, /<meta name="hero-carousel" content="live"/);
      assert.ok(home.data.includes(`href="${banner.url}"`), 'the first banner is preloaded');
      assert.doesNotMatch(home.data, /rel="preload" as="image" href="\/assets\/hero-editorial\.jpg"/, 'only the visible hero image is preloaded');
    }
  });

  test('editing text keeps the banner, and the live version changes only on publish', async () => {
    const entry = (await adminView()).slides.find((e) => e.id === seeded.id);
    const draft = {
      ...entry.slide,
      heading: 'Knits for Cooler Days',
      subtitle: 'New subtitle',
      description: 'Fine-gauge pullovers to chunky knits.',
      heading_style: { ...entry.slide.heading_style, font: 'didone', color: '#ffffff', size: 88, italic: true },
      overlay: { ...entry.slide.overlay, desktop: { ...entry.slide.overlay.desktop, x: 'right', y: 'bottom' } },
      primary_cta: { ...entry.slide.primary_cta, label: 'SHOP KNITS', bg: '#2f4f3a' },
    };
    const saved = await act('update', { id: seeded.id, version: entry.version, slide: draft });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.result.has_unpublished_changes, true);
    assert.equal((await publicView()).slides[0].heading, 'Cozy Layers for Every Mood', 'the draft stays private');

    const pub = await act('publish', { id: seeded.id, version: saved.data.result.version });
    assert.equal(pub.status, 200);
    assert.equal(pub.data.result.has_unpublished_changes, false);
    const live = (await publicView()).slides[0];
    assert.equal(live.heading, 'Knits for Cooler Days');
    assert.equal(live.description, 'Fine-gauge pullovers to chunky knits.');
    assert.equal(live.heading_style.font, 'didone');
    assert.equal(live.heading_style.italic, true);
    assert.equal(live.overlay.desktop.x, 'right');
    assert.equal(live.primary_cta.label, 'SHOP KNITS');
    assert.equal(live.desktop_image.url, banner.url, 'the banner was not replaced');
  });

  test('a stale editor cannot overwrite newer changes', async () => {
    const entry = (await adminView()).slides.find((e) => e.id === seeded.id);
    const ok = await act('update', { id: seeded.id, version: entry.version, slide: entry.slide });
    assert.equal(ok.status, 200);
    const stale = await act('update', { id: seeded.id, version: entry.version, slide: { ...entry.slide, heading: 'Stale' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error, 'slide_changed');
  });

  test('invalid content is rejected with field messages', async () => {
    const cases = [
      [{ heading: 'x'.repeat(81) }, 'heading'],
      [{ primary_cta: { label: 'Go', url: 'javascript:alert(1)' } }, 'primary_cta.url'],
      [{ heading_style: { size: 500 } }, 'heading_style.size'],
      [{ heading_style: { font: 'Papyrus' } }, 'heading_style.font'],
      [{ heading_style: { color: 'url(x)' } }, 'heading_style.color'],
      [{ desktop_image: { url: 'https://elsewhere.example/banner.jpg' } }, 'desktop_image'],
    ];
    for (const [slide, field] of cases) {
      const r = await act('create', { slide: ready(slide) });
      assert.equal(r.status, 400, field);
      assert.ok(r.data.details?.fields?.[field], `${field}: ${JSON.stringify(r.data)}`);
    }
    const missing = await act('create', { slide: ready({ desktop_image: { url: '/uploads/image_1_0123456789abcdef.png' } }) });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'desktop_image_missing');
  });

  test('publishing needs a suitable banner; image-only banners ignore buttons', async () => {
    const noImage = await act('create', { slide: ready() });
    assert.equal(noImage.status, 201);
    const r1 = await act('publish', { id: noImage.data.result.id });
    assert.equal(r1.status, 422);
    assert.ok(r1.data.details.fields.desktop_image);

    const square = await upload(900, 900);
    const small = await act('update', { id: noImage.data.result.id, slide: ready({ desktop_image: square }) });
    assert.equal(small.status, 200, 'a draft may hold an unsuitable image while it is being prepared');
    assert.ok(small.data.result.problems.desktop_image);
    assert.equal((await act('publish', { id: noImage.data.result.id })).status, 422);

    const imageOnly = await act('create', { slide: ready({ heading: '', display_mode: 'image_only', desktop_image: banner, primary_cta: { visible: true, label: 'Half', url: '' } }) });
    assert.equal(imageOnly.status, 201);
    const pub = await act('publish', { id: imageOnly.data.result.id });
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    const s = (await publicView()).slides.find((x) => x.id === imageOnly.data.result.id);
    assert.equal(s.display_mode, 'image_only');
    assert.equal((await api('DELETE', `${ADMIN}?id=${noImage.data.result.id}`, undefined, { cookie: admin.cookie })).status, 200);
    assert.equal((await api('DELETE', `${ADMIN}?id=${imageOnly.data.result.id}&confirm=true`, undefined, { cookie: admin.cookie })).status, 200);
  });

  test('a mobile banner is stored with its real size and preloaded for phones', async () => {
    const mobile = await upload(900, 1400);
    const entry = (await adminView()).slides.find((e) => e.id === seeded.id);
    const r = await act('update', { id: seeded.id, version: entry.version, publish: true, slide: { ...entry.slide, mobile_image: { ...mobile, width: 1, height: 1 } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.result.slide.mobile_image, mobile, 'dimensions come from the file, not the browser');
    assert.equal((await publicView()).slides[0].mobile_image.url, mobile.url);
    const home = await api('GET', '/');
    if (typeof home.data === 'string' && home.status === 200) {
      assert.ok(home.data.includes(`href="${mobile.url}" fetchpriority="high" media="(max-width: 640px)"`));
      assert.ok(home.data.includes(`href="${banner.url}" fetchpriority="high" media="(min-width: 641px)"`));
    }
  });

  test('ordering, activation, scheduling and duplication', async () => {
    const second = await act('create', { slide: ready({ heading: 'Second', desktop_image: banner }) });
    const secondId = second.data.result.id;
    assert.equal((await act('publish', { id: secondId })).status, 200);
    assert.deepEqual((await publicView()).slides.map((s) => s.heading), ['Knits for Cooler Days', 'Second']);

    const reorder = await act('reorder', { ids: [secondId, seeded.id] });
    assert.equal(reorder.status, 200, JSON.stringify(reorder.data));
    assert.deepEqual((await publicView()).slides.map((s) => s.heading), ['Second', 'Knits for Cooler Days'], 'order applies at once');
    assert.equal((await act('reorder', { ids: [secondId] })).status, 409, 'an incomplete order is refused');

    assert.equal((await act('activate', { id: secondId, is_active: false })).status, 200);
    assert.deepEqual((await publicView()).slides.map((s) => s.heading), ['Knits for Cooler Days']);
    assert.equal((await act('activate', { id: secondId, is_active: true })).status, 200);

    const later = new Date(Date.now() + 86_400_000).toISOString();
    const sched = await act('update', { id: secondId, publish: true, slide: ready({ heading: 'Second', desktop_image: banner, starts_at: later }) });
    assert.equal(sched.status, 200, JSON.stringify(sched.data));
    assert.deepEqual((await publicView()).slides.map((s) => s.heading), ['Knits for Cooler Days'], 'a scheduled slide waits for its start');
    const ended = await act('update', { id: secondId, publish: true, slide: ready({ heading: 'Second', desktop_image: banner, ends_at: new Date(Date.now() - 60_000).toISOString() }) });
    assert.equal(ended.status, 422, 'an end date in the past cannot be published');

    const dup = await act('duplicate', { id: seeded.id });
    assert.equal(dup.status, 201);
    assert.equal(dup.data.result.publication_status, 'draft');
    assert.equal(dup.data.result.slide.heading, 'Knits for Cooler Days (copy)');
    assert.equal(dup.data.result.slide.desktop_image.url, banner.url);
    assert.equal((await publicView()).slides.some((s) => s.id === dup.data.result.id), false, 'a duplicate starts as a private draft');

    const del = await api('DELETE', `${ADMIN}?id=${secondId}`, undefined, { cookie: admin.cookie });
    assert.equal(del.status, 409, 'deleting a published slide needs confirmation');
    assert.equal((await api('DELETE', `${ADMIN}?id=${secondId}&confirm=true`, undefined, { cookie: admin.cookie })).status, 200);
    assert.equal((await api('DELETE', `${ADMIN}?id=${dup.data.result.id}`, undefined, { cookie: admin.cookie })).status, 200);
  });

  test('settings apply immediately and are validated; switching off hides every slide', async () => {
    const bad = await act('settings', { settings: { autoplay_interval: 500 } });
    assert.equal(bad.status, 400);
    const ok = await act('settings', { settings: { autoplay_interval: 8000, transition_type: 'slide', show_navigation: false } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const v = await publicView();
    assert.equal(v.settings.autoplay_interval, 8000);
    assert.equal(v.settings.transition_type, 'slide');
    assert.equal(v.settings.show_navigation, false);
    assert.equal(v.settings.pause_on_hover, true, 'unsent settings keep their values');

    assert.equal((await act('settings', { settings: { is_enabled: false } })).status, 200);
    assert.deepEqual((await publicView()).slides, []);
    assert.equal((await act('settings', { settings: { is_enabled: true } })).status, 200);
    assert.equal((await publicView()).slides.length, 1);
  });

  test('the public response is cached and every admin change clears it', async () => {
    const first = await api('GET', '/api/homepage-carousel');
    const second = await api('GET', '/api/homepage-carousel');
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.match(second.headers.get('cache-control'), /^public, max-age=\d+$/);
    assert.equal(first.data.slides[0].heading, 'Knits for Cooler Days');
    assert.equal((await act('unpublish', { id: seeded.id })).status, 200);
    const after = await api('GET', '/api/homepage-carousel');
    assert.equal(after.headers.get('x-cache'), 'miss');
    assert.deepEqual(after.data.slides, [], 'unpublishing is visible on the next request');
  });

  test('banners used by a slide or its live version survive orphan-upload cleanup', async () => {
    const { cleanOrphanUploads, UPLOAD_DIR } = await import('../lib/uploads.js');
    const kept = await upload(1920, 800);
    const entry = (await adminView()).slides.find((e) => e.id === seeded.id);
    assert.equal((await act('update', { id: seeded.id, version: entry.version, publish: true, slide: { ...entry.slide, desktop_image: kept } })).status, 200);
    // Replace the draft banner: the old one is still referenced by the published version.
    const replacement = await upload(1920, 800);
    const e2 = (await adminView()).slides.find((e) => e.id === seeded.id);
    assert.equal((await act('update', { id: seeded.id, version: e2.version, slide: { ...e2.slide, desktop_image: replacement } })).status, 200);
    const orphan = await upload(1920, 800);
    const old = new Date(Date.now() - 10 * 86_400_000);
    for (const u of [kept, replacement, orphan]) fs.utimesSync(path.join(UPLOAD_DIR, path.basename(u.url)), old, old);
    const prev = process.env.UPLOAD_ORPHAN_CLEANUP_DAYS;
    process.env.UPLOAD_ORPHAN_CLEANUP_DAYS = '1';
    try {
      await cleanOrphanUploads({ force: true });
    } finally {
      if (prev === undefined) delete process.env.UPLOAD_ORPHAN_CLEANUP_DAYS;
      else process.env.UPLOAD_ORPHAN_CLEANUP_DAYS = prev;
    }
    const exists = (u) => fs.existsSync(path.join(UPLOAD_DIR, path.basename(u.url)));
    assert.equal(exists(kept), true, 'the live banner is kept');
    assert.equal(exists(replacement), true, 'the draft banner is kept');
    assert.equal(exists(orphan), false, 'an unused old upload is removed');
  });

  test('every carousel change is in the audit log', async () => {
    const actions = (await ctx.db.query("SELECT DISTINCT action FROM audit_logs WHERE action LIKE 'carousel_%'")).rows.map((r) => r.action);
    for (const a of ['carousel_slide_created', 'carousel_slide_updated', 'carousel_slide_published', 'carousel_slide_unpublished', 'carousel_slide_duplicated', 'carousel_slide_deleted', 'carousel_slides_reordered', 'carousel_settings_updated', 'carousel_slide_deactivated']) {
      assert.ok(actions.includes(a), a);
    }
  });
});
