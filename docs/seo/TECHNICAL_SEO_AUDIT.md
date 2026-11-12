# Technical SEO audit

Date: 2026-11-11. Method: source review of `lib/seo.js`, `vishrea-react/src/lib/{schema,productCopy,usePageSeo,pages}.js`
and `server.js`, plus automated tests on QA data (`test/seo.test.js`, 9/9; `test/product-copy.test.js`, 3/3).

## How the site is made crawlable (existing, kept)

The SPA stays React + Vite. For every public URL, Express runs `pageMeta()` before sending `index.html`:
- the real `<title>`, description, robots meta, canonical, Open Graph, Twitter card and JSON-LD go in the initial `<head>`;
- the page's real content (H1, product facts, product links, FAQs) goes in the initial HTML inside `<noscript>`, built from the same database queries the API uses;
- the first hero image is preloaded with `fetchpriority="high"`;
- legacy URLs return 301: `/catalogue?category=x` → `/catalogue/x`, `/legal?slug=x` → `/legal/x`, trailing slash → none, product by UUID → canonical slug URL;
- private paths (`/account`, `/orders`, `/checkout`, `/cart`, `/wardrobe`, `/admin`, `/login`, `/gift/redeem`) get `X-Robots-Tag: noindex` and no structured data;
- unknown paths return **HTTP 404** with `noindex`, and the SPA shows `NotFound`;
- `sitemap.xml` lists the static pages, categories, legal pages and every visible product with image entries;
- `robots.txt` allows crawling in production and blocks everything elsewhere (tested).

Prerendering or SSR is therefore **not needed**: crawlers receive the title, canonical, product data and structured data in the first response. This was proven by `test/seo.test.js` against the built `dist/index.html`.

## Findings

| # | Severity | Finding | Evidence | File | Fix | Test | Owner action |
|---|---|---|---|---|---|---|---|
| 1 | Medium | Product pages had no visible shopper Q&A, so they could not directly answer "what is it made of", "which sizes", "how to wash" or "can I exchange" | PDP source | `ProductDetail.jsx`, `lib/seo.js` | **Fixed.** `productFaqs()` builds up to 4 answers from stored data only: material, in-stock sizes, care, exchange and delivery policy. Shown in a "Questions" panel, in the server HTML and as matching `FAQPage` JSON-LD | `seo.test.js` (FAQ matches HTML, no ratings) and `product-copy.test.js` | Fill material and care on listings |
| 2 | Low | Measurements showed in cm only | PDP | `productCopy.js` | **Fixed.** `measurementText()` shows cm with inches, and only values that were actually measured | `product-copy.test.js` | — |
| 3 | Medium | Admins had no prompt for missing listing facts | Admin editor | `Admin.jsx` | **Fixed.** The editor lists what is missing (description, material, care, colour, measurements, photos); nothing is auto-filled | `product-copy.test.js` | Complete listings before launch |
| 4 | Low | The product's server HTML had no category link | `lib/seo.js` | `lib/seo.js` | **Fixed.** "More {category}" link added (the SPA already links related products and the category) | `seo.test.js` | — |
| 5 | Medium | Initial-HTML content sits in `<noscript>`. Google renders JavaScript and sees the full page, but non-rendering crawlers may ignore `<noscript>` | `renderHtml()` | `lib/seo.js` | Not changed: moving it into `#root` risks a layout shift on every page view. Title, description, canonical and JSON-LD are already outside `noscript` | — | Revisit after launch with Search Console data |
| 6 | Low | No "About / Our Story" or store-location page exists | `App.jsx` routes | — | Not created: content and the address must come from the owner (see `LOCAL_SEO_AUDIT.md`) | — | Provide verified story and store details |
| 7 | Info | Duplicate-content control: the internal search and filter combinations (`/catalogue?q=` etc.) canonicalise to `/catalogue`. The sitemap only lists clean URLs | `usePageSeo.js`, `sitemapEntries()` | — | Already correct | `seo.test.js` | — |
| 8 | Info | One H1 per page in the server HTML; the SPA uses one `<h1>` on PDP, category and home | Source | — | Browser heading check: see `docs/production/UI_UX_AUDIT.md` | — | — |

## Performance notes (from the build)

- The main bundle is 101 KB gzip; route chunks are lazy-loaded; JS, CSS and WASM are brotli-precompressed (15.5 MB → 3.5 MB, the largest part being the on-device colour model, loaded only on `/skin-tone`).
- The hero image is preloaded; product thumbnails have `width`, `height` and `loading="lazy"`.
- **Owner/asset item:** the two homepage banner PNGs are 2.2 MB and 1.9 MB. WebP versions are about 130 KB and 85 KB (`FINAL_STORAGE_PRODUCTION_READINESS.md` §11). Replace them before re-activating the slides, or the home page's largest image will load slowly on mobile.
- Core Web Vitals were **not measured** on production (no live URL). Measure them with PageSpeed Insights and Search Console after launch.
