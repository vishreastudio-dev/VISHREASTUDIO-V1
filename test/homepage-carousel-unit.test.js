// Homepage carousel rules without a database: image headers, slide validation, CTA safety and
// publish checks. The same schema module is used by the server and the admin editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef';

const { imageDimensions } = await import('../lib/uploads.js');
const { ctaLink, imageProblem, naturalRatios, normalizeSettings, normalizeSlide, publishProblems, withinSchedule, DEFAULT_SLIDE, SPLIT_IMAGE_SHARE } = await import('../vishrea-react/src/lib/heroCarousel.js');
const { fakePng: png } = await import('./helpers.js');

function jpeg(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

function webp(chunk, w, h) {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0);
  b.writeUInt32LE(24, 4);
  b.write('WEBP', 8);
  b.write(chunk, 12);
  if (chunk === 'VP8X') {
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  } else if (chunk === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE((((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)) >>> 0, 21);
  } else {
    b.set([0x9d, 0x01, 0x2a], 23);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  }
  return b;
}

test('banner dimensions are read from PNG, JPEG and every WEBP flavour', () => {
  assert.deepEqual(imageDimensions(png(1920, 800)), { width: 1920, height: 800 });
  assert.deepEqual(imageDimensions(jpeg(2400, 1000)), { width: 2400, height: 1000 });
  assert.deepEqual(imageDimensions(webp('VP8X', 1600, 900)), { width: 1600, height: 900 });
  assert.deepEqual(imageDimensions(webp('VP8L', 1200, 1500)), { width: 1200, height: 1500 });
  assert.deepEqual(imageDimensions(webp('VP8 ', 1280, 720)), { width: 1280, height: 720 });
  assert.equal(imageDimensions(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('missing values fall back to brand defaults; stored data never needs every key', () => {
  const { slide, errors } = normalizeSlide({ heading: '  Cozy   Layers ', heading_style: { size: 64 } }, { strict: true });
  assert.deepEqual(errors, {});
  assert.equal(slide.heading, 'Cozy Layers');
  assert.equal(slide.heading_style.size, 64);
  assert.equal(slide.heading_style.font, DEFAULT_SLIDE.heading_style.font);
  assert.deepEqual(slide.overlay, DEFAULT_SLIDE.overlay);
});

test('strict validation rejects long text, unknown fonts, unsafe colours and out-of-range layout values', () => {
  const { errors } = normalizeSlide(
    {
      heading: 'x'.repeat(81),
      subtitle: 'y'.repeat(121),
      description: 'z'.repeat(221),
      heading_style: { font: 'Comic Sans', size: 400, color: 'red; background:url(x)' },
      overlay: { desktop: { max_width: 140, x: 'offscreen' }, panel_opacity: 99 },
      primary_cta: { label: 'L'.repeat(31), url: 'javascript:alert(1)' },
      layout_type: 'diagonal',
    },
    { strict: true }
  );
  for (const key of ['heading', 'subtitle', 'description', 'heading_style.font', 'heading_style.size', 'heading_style.color', 'overlay.desktop.max_width', 'overlay.desktop.x', 'overlay.panel_opacity', 'primary_cta.label', 'primary_cta.url', 'layout_type']) {
    assert.ok(errors[key], `expected an error for ${key}`);
  }
});

test('lenient reading never lets stored junk through to the page', () => {
  const { slide } = normalizeSlide({ heading_style: { color: 'expression(alert(1))', size: 'huge' }, primary_cta: { url: 'javascript:alert(1)' }, desktop_image: { url: 'https://evil.example/x.png' } });
  assert.equal(slide.heading_style.color, DEFAULT_SLIDE.heading_style.color);
  assert.equal(slide.heading_style.size, DEFAULT_SLIDE.heading_style.size);
  assert.equal(slide.primary_cta.url, '');
  assert.equal(slide.desktop_image, null, 'only images from the upload store are accepted');
});

test('CTA destinations: site paths and http(s) only', () => {
  assert.deepEqual(ctaLink('/catalogue/sweaters'), { internal: true, href: '/catalogue/sweaters' });
  assert.deepEqual(ctaLink('https://instagram.com/vishreastudio'), { internal: false, href: 'https://instagram.com/vishreastudio' });
  assert.equal(ctaLink('http://example.com/a').internal, false);
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example', '/x" onmouseover="a', 'mailto:a@b.c', 'catalogue', '']) assert.equal(ctaLink(bad), null, bad);
});

test('banner size and shape rules follow the layout', () => {
  assert.equal(imageProblem('desktop', 'full', 1920, 800), null);
  assert.match(imageProblem('desktop', 'full', 800, 400), /at least 1200 × 480/);
  assert.match(imageProblem('desktop', 'full', 1500, 1500), /landscape/);
  assert.equal(imageProblem('desktop', 'split_image_right', 1200, 1500), null);
  assert.match(imageProblem('desktop', 'split_image_left', 2400, 900), /portrait or square/);
  assert.equal(imageProblem('mobile', 'full', 900, 1400), null);
  assert.match(imageProblem('mobile', 'full', 1600, 900), /portrait or square/);
  assert.match(imageProblem('desktop', 'full', 0, 0), /could not be read/);
});

test('publish checks: banner, alt text, visible buttons and schedule', () => {
  const base = normalizeSlide({ heading: 'Cozy', image_alt: 'Green sweater', desktop_image: { url: '/uploads/image_1_aaaaaaaaaaaaaaaa.png', width: 1920, height: 800 } }).slide;
  assert.deepEqual(publishProblems(base), {}, 'an empty button is simply not shown, so nothing blocks');
  const visibleCta = { ...base, primary_cta: { ...base.primary_cta, visible: true, label: 'Shop', url: '' } };
  assert.ok(publishProblems(visibleCta)['primary_cta.url']);
  assert.ok(publishProblems({ ...base, primary_cta: { ...base.primary_cta, label: '', url: '/catalogue' } })['primary_cta.label']);
  assert.deepEqual(publishProblems({ ...visibleCta, display_mode: 'image_only' }), {}, 'image-only banners ignore button settings');
  assert.ok(publishProblems({ ...base, desktop_image: null }).desktop_image);
  assert.ok(publishProblems({ ...base, image_alt: '' }).image_alt);
  assert.ok(publishProblems({ ...base, ends_at: new Date(Date.now() - 1000).toISOString() }).ends_at);
  assert.ok(publishProblems({ ...base, desktop_image: { ...base.desktop_image, width: 900, height: 900 } }).desktop_image);
});

test('schedule window and end-before-start', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(withinSchedule({ starts_at: '2026-11-08T00:00:00Z' }, now), false);
  assert.equal(withinSchedule({ ends_at: '2026-11-07T11:00:00Z' }, now), false);
  assert.equal(withinSchedule({ starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' }, now), true);
  assert.ok(normalizeSlide({ starts_at: '2026-11-10T00:00:00Z', ends_at: '2026-11-09T00:00:00Z' }, { strict: true }).errors.ends_at);
});

test('banners are never cropped unless "fill" is chosen: natural fit is the default and keeps the image proportions', () => {
  const desktop = { url: '/uploads/image_1_aaaaaaaaaaaaaaaa.jpg', width: 1774, height: 887 };
  const slide = normalizeSlide({ desktop_image: desktop }).slide;
  assert.equal(slide.image_settings.fit, 'natural');
  assert.deepEqual(naturalRatios(slide), { slide: 2, image: 2, mobile: 2 }, 'a 1774 × 887 banner gives a 2:1 slide');
  const split = normalizeSlide({ desktop_image: { ...desktop, width: 1200, height: 1500 }, layout_type: 'split_image_right' }).slide;
  assert.equal(naturalRatios(split).slide.toFixed(3), (0.8 / SPLIT_IMAGE_SHARE).toFixed(3), 'split slides size the image column to the banner');
  const withMobile = normalizeSlide({ desktop_image: desktop, mobile_image: { url: '/uploads/image_2_bbbbbbbbbbbbbbbb.jpg', width: 900, height: 1400 } }).slide;
  assert.equal(naturalRatios(withMobile).mobile.toFixed(3), (900 / 1400).toFixed(3), 'phones use the mobile banner proportions');
  assert.equal(naturalRatios(normalizeSlide({}).slide), null, 'no banner, no ratio: the set height is used');
  assert.equal(normalizeSlide({ image_settings: { fit: 'cover' } }).slide.image_settings.fit, 'cover');
  assert.ok(normalizeSlide({ image_settings: { fit: 'stretch' } }, { strict: true }).errors['image_settings.fit'], 'distorting fits are not allowed');
});

test('carousel settings are bounded', () => {
  assert.deepEqual(normalizeSettings({ autoplay_interval: 1000, transition_type: 'spin', mobile_height: 5000 }, { strict: true }).errors, {
    autoplay_interval: 'Autoplay interval must be between 3000 and 15000',
    transition_type: 'Transition type must be one of slide, fade',
    mobile_height: 'Mobile height must be between 380 and 820',
  });
  assert.deepEqual(normalizeSettings({ autoplay_interval: 8000 }, { strict: true }).errors, {});
});
