// Server-rendered SEO: what crawlers and link previews receive before any JavaScript runs.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ctx, dbSkipReason, setup, teardown } from './helpers.js';

const dbSkip = await dbSkipReason();

const distIndex = new URL('../vishrea-react/dist/index.html', import.meta.url);
const get = (p) => fetch(ctx.base + p, { redirect: 'manual' });
const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json" id="json-ld-seo">([\s\S]*?)<\/script>/)[1]);
const tag = (html, re) => (html.match(re) || [])[1];

describe('server-rendered SEO', { skip: dbSkip || (!fs.existsSync(distIndex) && 'run `npm run build` first'), timeout: 120_000 }, () => {
  before(() => setup(), { timeout: 120_000 });
  after(teardown);

  test('product page: unique title, description, canonical, OG and Product schema with per-size offers', async () => {
    const r = await get('/product/premium-silk-column-dress');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(tag(html, /<title>(.*?)<\/title>/), /^Premium Silk Column Dress — Dresses \| Vishrea Studio$/);
    assert.match(tag(html, /<meta name="description" content="(.*?)"/), /Premium Silk Column Dress, from ₹5,200/);
    assert.equal(tag(html, /<link rel="canonical" href="(.*?)"/), 'https://vishreastudio.com/product/premium-silk-column-dress');
    assert.equal(tag(html, /<meta property="og:type" content="(.*?)"/), 'product');
    assert.equal(html.match(/<title>/g).length, 1, 'template defaults replaced, not duplicated');

    const graph = jsonLd(html)['@graph'];
    const product = graph.find((n) => n['@type'] === 'Product');
    assert.equal(product.brand.name, 'Vishrea Studio');
    assert.equal(product.offers['@type'], 'AggregateOffer');
    assert.equal(product.offers.lowPrice, '5200.00');
    assert.equal(product.offers.highPrice, '6100.00');
    assert.deepEqual(product.offers.offers.map((o) => o.sku), ['PSCD-S', 'PSCD-M', 'PSCD-L', 'PSCD-XXL']);
    assert.ok(product.offers.offers.every((o) => o.priceCurrency === 'INR' && o.availability.endsWith('InStock')));
    assert.equal(product.offers.offers[0].hasMerchantReturnPolicy.merchantReturnDays, 7);
    const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name);
    assert.deepEqual(crumbs, ['Home', 'Shop', 'Dresses', 'Premium Silk Column Dress']);
    const org = graph.find((n) => n['@type'] === 'ClothingStore');
    assert.ok(!JSON.stringify(org).includes('[Your'), 'no placeholder values published');
    assert.match(html, /<noscript>[\s\S]*<h1>Premium Silk Column Dress<\/h1>[\s\S]*Sizes<\/dt><dd>Small, Medium, Large, Double XL/);
  });

  test('product FAQs come from stored data, are in the page HTML and match FAQPage; no invented ratings', async () => {
    const html = await (await get('/product/premium-silk-column-dress')).text();
    const graph = jsonLd(html)['@graph'];
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    assert.ok(faq && faq.mainEntity.length >= 2 && faq.mainEntity.length <= 4);
    for (const q of faq.mainEntity) assert.ok(html.includes(`<h3>${q.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}</h3>`), q.name);
    assert.ok(faq.mainEntity.some((q) => q.name === 'Can I exchange it?' && /within 7 days of delivery/.test(q.acceptedAnswer.text)));
    assert.doesNotMatch(html, /AggregateRating|"Review"|ratingValue/);
    assert.match(html, /<a href="\/catalogue\/dresses">More dresses<\/a>/);
  });

  test('category pages use clean URLs; legacy query URLs 301 to them', async () => {
    const legacy = await get('/catalogue?category=dresses');
    assert.equal(legacy.status, 301);
    assert.equal(legacy.headers.get('location'), '/catalogue/dresses');
    const r = await get('/catalogue/dresses');
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.equal(tag(html, /<title>(.*?)<\/title>/), 'Dresses | Vishrea Studio');
    assert.ok(jsonLd(html)['@graph'].some((n) => n['@type'] === 'ItemList' && n.itemListElement.length > 0));
    assert.equal((await get('/legal?slug=privacy')).headers.get('location'), '/legal/privacy');
  });

  test('help page publishes FAQPage matching visible questions', async () => {
    const html = await (await get('/contact')).text();
    const faq = jsonLd(html)['@graph'].find((n) => n['@type'] === 'FAQPage');
    assert.ok(faq.mainEntity.length >= 5);
    for (const q of faq.mainEntity) assert.ok(html.includes(`<h3>${q.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}</h3>`), q.name);
  });

  test('unknown pages and products return a real 404, not a soft 404', async () => {
    for (const p of ['/product/does-not-exist', '/no/such/page', '/catalogue/not-a-category', '/legal/nope']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.match(await r.text(), /noindex/);
    }
  });

  test('private pages are noindex (header and meta) and carry no structured data', async () => {
    for (const p of ['/cart', '/checkout', '/account', '/orders', '/orders/abc', '/admin', '/login']) {
      const r = await get(p);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      const html = await r.text();
      assert.match(html, /<meta name="robots" content="noindex/);
      assert.ok(!html.includes('application/ld+json'));
    }
  });

  test('sitemap lists clean category and product URLs; non-production robots blocks everything', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    assert.match(xml, /<loc>https:\/\/vishreastudio\.com\/catalogue\/dresses<\/loc>/);
    assert.match(xml, /<loc>https:\/\/vishreastudio\.com\/product\/premium-silk-column-dress<\/loc>/);
    assert.ok(!xml.includes('?category='));
    assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  });

  test('every indexable static page has a distinct title and description', async () => {
    const seen = new Set();
    for (const p of ['/', '/catalogue', '/membership', '/skin-tone', '/contact', '/gifting']) {
      const html = await (await get(p)).text();
      const t = tag(html, /<title>(.*?)<\/title>/);
      const d = tag(html, /<meta name="description" content="(.*?)"/);
      assert.ok(t && d && d.length >= 70 && d.length <= 170, `${p}: ${d?.length}`);
      assert.ok(!seen.has(t) && !seen.has(d), `duplicate metadata on ${p}`);
      seen.add(t);
      seen.add(d);
    }
  });
});
