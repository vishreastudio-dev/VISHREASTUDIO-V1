# Structured data audit

Date: 2026-11-11. Builders: `vishrea-react/src/lib/schema.js`. They are shared by the server HTML (`lib/seo.js`) and the SPA
(`usePageSeo.js`), so the markup is generated from the same data the page shows.

| Page | Types (one `@graph`) | Source of values |
|---|---|---|
| Every indexable page | `ClothingStore` (organization), `WebSite` with `SearchAction` | `site.config.js`. Unknown values (legal name, street, postcode, hours, email) are **left out**, not invented |
| Home | `WebPage`, `ItemList` of featured products | database |
| Catalogue and category | `CollectionPage`, `BreadcrumbList`, `ItemList` | database |
| Product | `ItemPage`, `BreadcrumbList`, `Product`, plus `FAQPage` (new; the questions are visible on the page) | `fetchProduct()` |
| Contact, membership | `WebPage`, `BreadcrumbList`, `FAQPage` (visible questions) | `content/faqs.js` |
| Legal | `WebPage`, `BreadcrumbList` | `legal_pages` |
| Private, 404 | none | — |

`Product` fields: `name`, `description` (stored text only), `image` (all photos), `sku` (when there is a single variant), `brand`,
`category`, `color`, `material`, `size`. `offers` is one `Offer` per size, with SKU, price (2 decimals, INR),
`InStock`/`SoldOut`, `NewCondition`, URL, seller, `OfferShippingDetails` (₹99, India) and `MerchantReturnPolicy`
(7 days, exchange). When there are several sizes they are wrapped in an `AggregateOffer` with the low price, high price and count.

**Ratings:** there is no `AggregateRating` or `Review` anywhere. The site has no product reviews, and the store's Google rating
must never be attached to products. `test/seo.test.js` now fails if rating markup appears.

**Consistency:** price, availability, sizes, material and colour in JSON-LD come from the same object the page renders. Product
caches are 15 s (product) and 30 s (catalogue), so markup cannot drift from stock for long.

## Validation

- Automated: `test/seo.test.js` parses the JSON-LD on product, category, contact and static pages and checks types, offers, SKUs, breadcrumbs, the FAQ↔HTML match, and that there are no placeholders and no ratings. Result: 9/9.
- **Not yet run:** Google Rich Results Test and the Schema.org validator need a public URL. QA runs on `127.0.0.1` only. The owner, or the agent after deploy, should test one product page, one category, `/contact` and `/` with both tools.

## Gaps (owner data)

- `ClothingStore.address.streetAddress` and `postalCode`, `openingHours`, `email`, `legalName`: add them in `site.config.js` once verified (`LOCAL_SEO_AUDIT.md`).
- Delivery and return values in the markup are `SITE.shipping.fee = 99` and `SITE.returns.days = 7`. Confirm they match the checkout shipping fee in admin Settings and the published exchange policy.
