# VISHREA STUDIO — TECHNICAL SEO, STRUCTURED DATA & INDIA MARKET INDEXING STRATEGY

**Date:** 2026-11-17  
**Scope:** Technical Crawlability, Meta Tags, Schema.org JSON-LD, Canonical Mapping, Regional Growth (Bengaluru, Chennai, Hyderabad, Mumbai, Delhi).

---

## 1. Technical SEO Architecture

Vishrea Studio implements a hybrid SEO architecture where the Express server pre-renders complete `<head>` metadata, OpenGraph tags, and JSON-LD structured data on initial page request (`lib/seo.js`). This guarantees that search engine spiders (Googlebot, Bingbot) and social crawlers (WhatsApp, Facebook, Twitter, iMessage) receive rich, indexable HTML without needing to execute JavaScript.

### Core Technical Directives
- **Canonical Domain:** `https://vishreastudio.com/` (enforced via `absoluteUrl()` helper).
- **Robots Directive on Public Routes:** `<meta name="robots" content="index, follow, max-image-preview:large" />`.
- **Private Route Protection:** Automatic `X-Robots-Tag: noindex, nofollow` HTTP headers served for:
  - `/api/*`
  - `/admin/*`
  - `/account/*`
  - `/cart`
  - `/checkout`
  - `/orders/*`
  - `/login`
  - `/wardrobe`
  - `/gift/redeem`
  - Internal search queries (`/catalogue?q=...`) send `noindex, follow` to prevent search result index bloat.

---

## 2. India-Focused Regional SEO Strategy (100x Growth Focus)

To capture high-intent luxury fashion demand across South India and primary metropolitan fashion hubs, metadata and structured data have been calibrated around high-volume, high-converting buyer search queries:

### Targeted Regional Hubs & Search Terms
1. **Bengaluru (Atelier Location):**
   - *Target terms:* "bespoke designer dresses Bengaluru", "luxury womenswear boutique Bengaluru", "designer capsule wardrobe Indiranagar / Koramangala", "curated party dresses studio pickup Bangalore".
2. **Chennai:**
   - *Target terms:* "designer cocktail dresses Chennai", "curated luxury pret Chennai", "silk column gowns Chennai fashion", "contemporary designer co-ord sets Chennai".
3. **Hyderabad & Mumbai & Delhi NCR:**
   - *Target terms:* "one-of-one designer dresses India", "Walkin Wardrobe luxury rental India", "online bespoke womenswear India", "custom fit designer lehenga & cocktail gowns".

---

## 3. Schema.org JSON-LD Structured Data Implementation

The following verified structured data schemas are injected on relevant indexable routes:

### A. Organization & Local Business Schema (`/#organization`)
Configured in `vishrea-react/src/lib/schema.js`:
```json
{
  "@context": "https://schema.org",
  "@type": "ClothingStore",
  "@id": "https://vishreastudio.com/#organization",
  "name": "Vishrea Studio",
  "url": "https://vishreastudio.com",
  "telephone": "+91 6364116567",
  "priceRange": "₹₹₹",
  "currenciesAccepted": "INR",
  "paymentAccepted": "UPI, Credit Card, Debit Card, Net Banking",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Bengaluru",
    "addressRegion": "Karnataka",
    "addressCountry": "IN"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "areaServed": [
    { "@type": "City", "name": "Bengaluru" },
    { "@type": "City", "name": "Chennai" },
    { "@type": "City", "name": "Hyderabad" },
    { "@type": "City", "name": "Mumbai" },
    { "@type": "City", "name": "Delhi" },
    { "@type": "Country", "name": "India" }
  ]
}
```

### B. Product & Offer Schema (`/product/:slug`)
- Dynamic entity generation based on actual database product data.
- Includes `name`, `description`, `image` array, `sku`, `itemCondition: "https://schema.org/NewCondition"`, `availability` (`InStock` or `SoldOut`), and currency `INR`.
- Includes `OfferShippingDetails` (₹99 nationwide, free Bengaluru studio pickup) and `MerchantReturnPolicy` (7-day exchange window).
- Automatically pairs with `FAQPage` schema based on product care and fabric details.

### C. BreadcrumbList & CollectionPage Schema
- Embedded on `/catalogue`, `/catalogue/:category`, and individual product pages to generate rich navigational breadcrumb snippets in Google Search results.

---

## 4. Robots.txt and XML Sitemap Verification

- **Production `robots.txt` (`server.js`):**
  ```text
  User-agent: *
  Allow: /
  Disallow: /api/
  Disallow: /admin
  Disallow: /account
  Disallow: /cart
  Disallow: /checkout
  Disallow: /orders
  Disallow: /login

  Sitemap: https://vishreastudio.com/sitemap.xml
  ```
- **Image-Enabled XML Sitemap (`/sitemap.xml`):**
  - Includes all static landing pages (`/`, `/catalogue`, `/membership`, `/skin-tone`, `/contact`, `/gifting`).
  - Includes all active category pages.
  - Dynamically queries all active, non-archived products and includes up to 5 image references per product (`image:loc`, `image:title`), powering Google Image Search visibility.
