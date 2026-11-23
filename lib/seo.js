// Server-rendered <head> metadata, JSON-LD and a <noscript> content summary for every
// storefront route, so crawlers and link previews that do not run JavaScript see the same
// titles, descriptions, canonical URLs and product facts as the React app.
import fs from 'fs';
import { db } from './db.js';
import { dropVisibleSql, fetchProduct, fetchProductList } from './catalogue.js';
import { isUuid } from './validate.js';
import { cachedPublicCarousel } from './carousel.js';
import { HERO_BREAKPOINTS } from '../vishrea-react/src/lib/heroCarousel.js';
import { SITE, absoluteUrl } from '../vishrea-react/src/site.config.js';
import { LEGAL_PAGES, PAGES, PRIVATE_PATHS } from '../vishrea-react/src/lib/pages.js';
import { breadcrumbSchema, faqSchema, graph, itemListSchema, jsonLdString, productSchema, webPageSchema } from '../vishrea-react/src/lib/schema.js';
import { describeProduct, measurementText, priceText, productFaqs, productMetaDescription } from '../vishrea-react/src/lib/productCopy.js';
import { categoryIntro } from '../vishrea-react/src/content/categories.js';
import { HELP_FAQS, HOME_LOCAL_FAQS, MEMBERSHIP_FAQS } from '../vishrea-react/src/content/faqs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATIC = {
  '/': 'home',
  '/catalogue': 'catalogue',
  '/membership': 'membership',
  '/skin-tone': 'skinTone',
  '/contact': 'contact',
  '/gifting': 'gifting',
};

const CLIENT_ROUTES = [/^\/orders\/[^/]+$/];

async function categories() {
  try {
    const r = await db.query('SELECT name, slug FROM categories WHERE is_active = true ORDER BY sort_order, name');
    return r.rows;
  } catch {
    return [
      { name: 'Tops', slug: 'tops' },
      { name: 'Dresses', slug: 'dresses' },
      { name: 'Co-ord sets', slug: 'coord-sets' },
      { name: 'Trousers', slug: 'pants' },
      { name: 'Party dresses', slug: 'party-dresses' },
    ];
  }
}

function headTags({ title, description, url, image, type = 'website', indexable, jsonLd, product }) {
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="keywords" content="Vishrea Studio, Bengaluru womenswear, curated fashion Bangalore, one-of-one silhouettes, bespoke dresses Bengaluru, Walkin Wardrobe membership, personal styling Electronic City" />`,
    `<meta name="author" content="Vishrea Studio" />`,
    `<meta name="geo.region" content="IN-KA" />`,
    `<meta name="geo.placename" content="Bengaluru" />`,
    `<meta name="geo.position" content="12.8368;77.6833" />`,
    `<meta name="ICBM" content="12.8368, 77.6833" />`,
    `<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:locale" content="${SITE.locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (product?.price_inr != null) {
    tags.push(`<meta property="product:price:amount" content="${esc(product.price_inr)}" />`, '<meta property="product:price:currency" content="INR" />');
  }
  if (indexable && jsonLd) tags.push(`<script type="application/ld+json" id="json-ld-seo">${jsonLdString(jsonLd)}</script>`);
  return tags.join('\n    ');
}

function navHtml(cats) {
  const links = [['/catalogue', 'Shop all'], ...cats.map((c) => [`/catalogue/${c.slug}`, c.name]), ['/membership', 'Membership'], ['/skin-tone', 'Find your colours'], ['/gifting', 'Gifting'], ['/contact', 'Help & contact']];
  return `<nav aria-label="Main"><a href="/">${esc(SITE.name)}</a> ${links.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join(' ')}</nav>`;
}

const productListHtml = (products) =>
  products.length ? `<ul>${products.map((p) => `<li><a href="/product/${esc(p.slug)}">${esc(p.name)}</a>${priceText(p) ? ` — ${esc(priceText(p))}` : ''}${p.available === false ? ' (sold out)' : ''}</li>`).join('')}</ul>` : '';

/**
 * Preload only the first visible hero image (the first live carousel slide, or the static hero),
 * and tell the app which hero to draw so it never shows a placeholder that is then replaced.
 */
async function heroPreload() {
  const tag = (href, media) => `\n    <link rel="preload" as="image" href="${esc(href)}" fetchpriority="high"${media ? ` media="${media}"` : ''} />`;
  const hint = (state) => `\n    <meta name="hero-carousel" content="${state}" />`;
  try {
    const first = (await cachedPublicCarousel(db)).value.slides[0];
    if (first) {
      const images = first.mobile_image
        ? tag(first.desktop_image.url, `(min-width: ${HERO_BREAKPOINTS.mobile + 1}px)`) + tag(first.mobile_image.url, `(max-width: ${HERO_BREAKPOINTS.mobile}px)`)
        : tag(first.desktop_image.url);
      return hint('live') + images;
    }
    return hint('none') + tag('/assets/hero-editorial.jpg');
  } catch {
    // The page still renders; the app asks the API itself and the browser finds the image later.
    return tag('/assets/hero-editorial.jpg');
  }
}

const faqHtml = (faqs) => `<section><h2>Questions</h2>${faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>`;

/**
 * Build metadata for a path. Returns { status, head, body, headers } or { redirect }.
 */
export async function pageMeta(req) {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  if (path !== req.path) return { redirect: path + (req.originalUrl.slice(req.path.length) || '') };

  // Consolidate legacy query-string URLs onto clean paths.
  if (path === '/shop') return { redirect: '/catalogue' };
  const shopMatch = path.match(/^\/shop\/([a-z0-9-]+)$/);
  if (shopMatch) return { redirect: `/catalogue/${shopMatch[1]}` };
  if (path === '/catalogue' && typeof req.query.category === 'string' && req.query.category && Object.keys(req.query).length === 1) {
    return { redirect: `/catalogue/${encodeURIComponent(req.query.category.toLowerCase())}` };
  }
  if (path === '/legal' && typeof req.query.slug === 'string' && Object.keys(req.query).length === 1) {
    return { redirect: `/legal/${encodeURIComponent(req.query.slug)}` };
  }
  if (path === '/legal') return { redirect: '/legal/privacy' };

  const isPrivate = PRIVATE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPrivate || CLIENT_ROUTES.some((re) => re.test(path))) {
    const reg = Object.values(PAGES).find((p) => path.startsWith(p.path) && p.path !== '/') || {};
    return { status: 200, headers: { 'X-Robots-Tag': 'noindex, nofollow' }, head: headTags({ title: reg.title || SITE.name, description: reg.description || SITE.description, url: absoluteUrl(path), image: absoluteUrl(SITE.defaultImage), indexable: false }), body: '' };
  }

  const cats = await categories();
  const nav = navHtml(cats);
  const page = (o) => ({ status: 200, headers: {}, ...o });

  if (STATIC[path]) {
    const reg = PAGES[STATIC[path]];
    const url = absoluteUrl(path === '/' ? '/' : path);
    const crumbs = path === '/' ? null : [{ name: 'Home', url: '/' }, { name: reg.title.split(' | ')[0].split(' — ')[0], url: path }];
    const nodes = [webPageSchema({ url, title: reg.title, description: reg.description, type: path === '/catalogue' ? 'CollectionPage' : 'WebPage' }), breadcrumbSchema(url, crumbs)];
    const h1Title = path === '/' ? 'Curated Women’s Fashion & One-of-One Silhouettes' : reg.title.split(' | ')[0].split(' — ')[0];
    let body = `<h1>${esc(h1Title)}</h1><p>${esc(reg.description)}</p>`;
    if (path === '/' || path === '/catalogue') {
      let products = [];
      try {
        products = await fetchProductList(db, { featured: path === '/', limit: path === '/' ? 8 : 48 });
      } catch {
        products = [];
      }
      nodes.push(itemListSchema(url, products));
      body += productListHtml(products);
    }
    if (path === '/') {
      body += `<section><h2>Bengaluru Womenswear Studio</h2><p>Vishrea Studio is an independent fashion studio located in Electronic City Phase 2, Bengaluru. We specialize in one-of-one silhouettes, curated wardrobe staples, bespoke occasion wear, and private colour analysis consultations. Enjoy free studio pickups in Bengaluru or flat ₹99 tracked shipping across India.</p></section>`;
      nodes.push(faqSchema(url, HOME_LOCAL_FAQS));
      body += faqHtml(HOME_LOCAL_FAQS);
    }
    if (path === '/catalogue') {
      body += `<section><h2>Curated Fashion Collection</h2><p>Explore the complete Vishrea Studio edit — tops, bespoke dresses, co-ord sets, tailored trousers, knitwear, and lightweight layers. Each piece is chosen or created with intention, emphasizing premium fabrics, enduring cuts, and versatile styling potential for work, evenings, and weekend getaways.</p></section>`;
    }
    if (path === '/skin-tone') {
      body += `<section><h2>Private Colour &amp; Style Analysis</h2><p>Discover the precise shades, undertones, and silhouettes that complement your natural features. Our colour analysis methodology guides you through seasonal palettes — from warm earthy tones to crisp jewel shades — helping you curate a cohesive wardrobe that brings confidence and effortless elegance to your daily dressing.</p></section>`;
    }
    if (path === '/gifting') {
      body += `<section><h2>Gift a Curated Wardrobe Experience</h2><p>Delight someone special with a personalized Vishrea Studio Walkin Wardrobe membership, bespoke styling consultation, or custom fashion voucher. Our team handles every detail from luxury presentation to private redemption and studio appointments in Bengaluru.</p></section>`;
    }
    if (path === '/contact') {
      nodes.push(faqSchema(url, HELP_FAQS));
      body += faqHtml(HELP_FAQS);
    }
    if (path === '/membership') {
      nodes.push(faqSchema(url, MEMBERSHIP_FAQS));
      body += faqHtml(MEMBERSHIP_FAQS);
    }
    const preload = path === '/' ? await heroPreload() : '';
    return page({ head: headTags({ title: reg.title, description: reg.description, url, image: absoluteUrl(reg.ogImage), indexable: true, jsonLd: graph(nodes) }) + preload, body: nav + body });
  }

  const cat = path.match(/^\/catalogue\/([a-z0-9-]+)$/);
  if (cat) {
    const c = cats.find((x) => x.slug === cat[1]);
    if (c) {
      const url = absoluteUrl(path);
      const title = `${c.name} | Vishrea Studio`;
      const description = categoryIntro(c.slug, c.name);
      let products = [];
      try {
        products = await fetchProductList(db, { category: c.slug, limit: 48 });
      } catch {
        products = [];
      }
      const crumbs = [{ name: 'Home', url: '/' }, { name: 'Shop', url: '/catalogue' }, { name: c.name, url: path }];
      const jsonLd = graph([webPageSchema({ url, title, description, type: 'CollectionPage' }), breadcrumbSchema(url, crumbs), itemListSchema(url, products)]);
      const categoryStudioSection = `<section><h2>Curated Styling &amp; Studio Craftsmanship</h2><p>Every piece in our ${esc(c.name.toLowerCase())} collection is chosen or tailored in limited runs to ensure individuality, comfort, and enduring style. We source tactile fabrics that breathe well and drape beautifully, creating pieces that move effortlessly from daytime studio appointments to celebratory evening plans.</p><p>Our Bengaluru atelier focuses on thoughtful finishing, subtle details, and flattering lines across every silhouette. Whether you are building an everyday capsule or seeking a standout piece for a special occasion, our stylists are available to guide you on sizing, colour harmony, and styling combinations.</p><h2>Visit Our Bengaluru Studio</h2><p>Located in Electronic City Phase 2, Bengaluru, Vishrea Studio welcomes clients for personal styling sessions, private color analysis consultations, and complimentary studio pickups. Experience our Walkin Wardrobe collection in person, or order online with express tracked delivery across India for flat ₹99 and 7-day size exchanges.</p><p>Vishrea Studio also provides tailored alteration consultations and early drop access through the Walkin Wardrobe membership. Feel free to connect directly on WhatsApp (+91 6364116567) with any questions regarding measurements, fabric care, or bespoke styling requests.</p></section>`;
      return page({ head: headTags({ title, description, url, image: absoluteUrl(products[0]?.image_url || '/assets/editorial.jpg'), indexable: true, jsonLd }), body: `${nav}<h1>${esc(c.name)}</h1><p>${esc(description)}</p>${productListHtml(products)}${categoryStudioSection}` });
    }
  }

  const prod = path.match(/^\/product\/([^/]+)$/);
  if (prod) {
    const slug = decodeURIComponent(prod[1]).slice(0, 120);
    const found = await fetchProduct(db, slug, { isUuid });
    if (found) {
      const p = found.product;
      // Product URLs are canonical by slug, even when reached by id.
      if (isUuid(slug) && p.slug !== slug) return { redirect: `/product/${encodeURIComponent(p.slug)}` };
      const url = absoluteUrl(`/product/${p.slug}`);
      const title = `${p.name}${p.category ? ` — ${p.category}` : ''} | Vishrea Studio`;
      const description = productMetaDescription(p);
      const crumbs = [{ name: 'Home', url: '/' }, { name: 'Shop', url: '/catalogue' }, ...(p.category_slug ? [{ name: p.category, url: `/catalogue/${p.category_slug}` }] : []), { name: p.name, url: `/product/${p.slug}` }];
      const faqs = productFaqs(p);
      const jsonLd = graph([webPageSchema({ url, title, description, type: 'ItemPage' }), breadcrumbSchema(url, crumbs), productSchema(p, url), faqSchema(url, faqs)]);
      const facts = [
        ['Price', priceText(p) ? `${priceText(p)} (incl. GST)` : null],
        ['Availability', p.available ? 'In stock' : 'Sold out'],
        ['Sizes', p.variants.filter((v) => v.in_stock).map((v) => v.size_label).join(', ') || null],
        ['Colour', p.color],
        ['Material', p.material],
        ['Measurements', measurementText(p)],
        ['Care', p.care_instructions],
        ['Category', p.category],
        ['Delivery', `₹${SITE.shipping.fee} across India, or free studio pickup in Bengaluru`],
      ].filter(([, v]) => v);
      const more = p.category_slug ? `<p><a href="/catalogue/${esc(p.category_slug)}">More ${esc(String(p.category).toLowerCase())}</a></p>` : '';
      const studioDetails = `<section><h2>Craftsmanship &amp; Silhouette</h2><p>Each silhouette at Vishrea Studio is intentionally curated and cut in one-of-one or limited edition runs. Our Bengaluru atelier emphasizes timeless design lines, structured drapes, and premium finishing for elevated personal style.</p><h2>Bengaluru Studio Try-On &amp; Pickup</h2><p>Visit our Electronic City studio in Bengaluru for complimentary 1-on-1 styling and personal colour analysis. Feel the fabrics in person, try your favourite silhouettes, and enjoy free local pickup or convenient same-day studio appointments.</p><h2>Pan-India Delivery &amp; Size Exchange</h2><p>Every order is packaged with utmost care and dispatched with tracked delivery across India for flat ₹99. We offer hassle-free 7-day size exchanges and direct WhatsApp assistance at +91 6364116567.</p></section>`;
      const body = `${nav}<h1>${esc(p.name)}</h1><p>${esc(describeProduct(p))}</p><dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${faqHtml(faqs)}${more}${studioDetails}`;
      return page({ head: headTags({ title, description, url, image: absoluteUrl(p.image_url || SITE.defaultImage), type: 'product', indexable: true, jsonLd, product: p }), body });
    }
  }

  const legal = path.match(/^\/legal\/([a-z0-9-]+)$/);
  if (legal) {
    const row = (await db.query('SELECT title, body FROM legal_pages WHERE slug = $1', [legal[1]])).rows[0];
    const known = LEGAL_PAGES[legal[1]];
    if (row || known) {
      const url = absoluteUrl(path);
      const title = `${row?.title || known.title} | Vishrea Studio`;
      const description = known?.description || `${row.title} — Vishrea Studio.`;
      const jsonLd = graph([webPageSchema({ url, title, description }), breadcrumbSchema(url, [{ name: 'Home', url: '/' }, { name: row?.title || known.title, url: path }])]);
      const text = esc(row?.body || known?.body || '').replace(/\n/g, '<br>');
      return page({ head: headTags({ title, description, url, image: absoluteUrl(SITE.defaultImage), indexable: true, jsonLd }), body: `${nav}<h1>${esc(row?.title || known.title)}</h1><div>${text}</div>` });
    }
  }

  return {
    status: 404,
    headers: { 'X-Robots-Tag': 'noindex' },
    head: headTags({ title: 'Page not found | Vishrea Studio', description: 'This page could not be found.', url: absoluteUrl(path), image: absoluteUrl(SITE.defaultImage), indexable: false }),
    body: `${nav}<h1>Page not found</h1>`,
  };
}

let template = null;
let templateMtime = 0;
export function loadTemplate(file) {
  const stat = fs.statSync(file);
  if (!template || stat.mtimeMs !== templateMtime) {
    template = fs.readFileSync(file, 'utf8');
    templateMtime = stat.mtimeMs;
  }
  return template;
}

export function renderHtml(tpl, { head, body }) {
  const withHead = tpl.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, head);
  return withHead.replace('<!--seo:body-->', body ? `<noscript>${body}</noscript>${body}` : '');
}

/** URLs for sitemap.xml */
export async function sitemapEntries() {
  let productsRows = [];
  let catsRows = [];
  let legalRows = [];
  try {
    const [products, cats, legal] = await Promise.all([
      db.query(`SELECT p.slug, p.updated_at, p.image_url, p.images, p.name FROM products p
                 WHERE p.is_active AND p.archived_at IS NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
                   AND ${dropVisibleSql('p')}
                 ORDER BY p.updated_at DESC LIMIT 45000`),
      db.query('SELECT slug FROM categories WHERE is_active = true ORDER BY sort_order'),
      db.query('SELECT slug, updated_at FROM legal_pages ORDER BY slug'),
    ]);
    productsRows = products.rows;
    catsRows = cats.rows;
    legalRows = legal.rows;
  } catch {
    catsRows = await categories();
  }
  if (!catsRows.length) {
    catsRows = await categories();
  }
  const entries = [
    ...Object.values(STATIC).map((k) => ({ loc: absoluteUrl(PAGES[k].path) })),
    ...catsRows.map((c) => ({ loc: absoluteUrl(`/catalogue/${c.slug}`) })),
    ...legalRows.map((l) => ({ loc: absoluteUrl(`/legal/${l.slug}`), lastmod: l.updated_at })),
    ...productsRows.map((p) => {
      const imgs = Array.isArray(p.images) && p.images.length ? p.images : p.image_url ? [p.image_url] : [];
      return { loc: absoluteUrl(`/product/${p.slug}`), lastmod: p.updated_at, images: imgs.slice(0, 5).map(absoluteUrl), title: p.name };
    }),
  ];
  return entries;
}
