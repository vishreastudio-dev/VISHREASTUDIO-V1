// Schema.org builders shared by the client and the server-rendered HTML, so structured data
// always matches what the page shows. Nothing unknown is published (null fields are omitted).
import { SITE, absoluteUrl } from '../site.config.js';

const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;

const clean = (obj) => {
  if (Array.isArray(obj)) return obj.map(clean).filter((v) => v !== undefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = clean(v);
      if (c === null || c === undefined || c === '' || (Array.isArray(c) && !c.length)) continue;
      if (typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).filter((x) => x !== '@type').length) continue;
      out[k] = c;
    }
    return out;
  }
  return obj;
};

export function organizationSchema() {
  return clean({
    '@type': 'ClothingStore',
    '@id': ORG_ID,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: absoluteUrl(SITE.logo),
    image: absoluteUrl(SITE.defaultImage),
    description: SITE.description,
    telephone: SITE.contact.phone || SITE.contact.whatsapp,
    email: SITE.contact.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: SITE.address.streetAddress,
      addressLocality: SITE.address.locality,
      addressRegion: SITE.address.region,
      postalCode: SITE.address.postalCode,
      addressCountry: SITE.address.country,
    },
    openingHours: SITE.openingHours,
    priceRange: SITE.priceRange,
    aggregateRating: SITE.rating
      ? {
          '@type': 'AggregateRating',
          ratingValue: SITE.rating.ratingValue,
          reviewCount: SITE.rating.reviewCount,
          bestRating: '5',
          worstRating: '1',
        }
      : undefined,
    currenciesAccepted: 'INR',
    paymentAccepted: 'UPI, Credit Card, Debit Card, Net Banking',
    areaServed: 'IN',
    sameAs: SITE.sameAs,
  });
}

export function websiteSchema() {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: SITE.url,
    name: SITE.name,
    inLanguage: 'en-IN',
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/catalogue?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function webPageSchema({ url, title, description, type = 'WebPage' }) {
  return clean({ '@type': type, '@id': `${url}#webpage`, url, name: title, description, isPartOf: { '@id': SITE_ID }, inLanguage: 'en-IN' });
}

export function breadcrumbSchema(url, crumbs) {
  if (!crumbs?.length) return null;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => clean({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url ? absoluteUrl(c.url) : undefined })),
  };
}

const availability = (inStock) => (inStock ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut');

const shippingDetails = () => ({
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: SITE.shipping.fee, currency: SITE.shipping.currency },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: SITE.shipping.country },
});

const returnPolicy = () => ({
  '@type': 'MerchantReturnPolicy',
  applicableCountry: SITE.shipping.country,
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: SITE.returns.days,
  refundType: 'https://schema.org/ExchangeRefund',
  returnMethod: 'https://schema.org/ReturnByMail',
});

/** Product with one Offer per size (AggregateOffer when there are several). */
export function productSchema(product, url) {
  if (!product) return null;
  const variants = (product.variants || []).filter((v) => v && v.effective_price !== null && v.effective_price !== undefined);
  const offer = (v) =>
    clean({
      '@type': 'Offer',
      sku: v.sku,
      name: v.size_label ? `${product.name} — ${v.size_label}` : product.name,
      price: Number(v.effective_price).toFixed(2),
      priceCurrency: 'INR',
      availability: availability(v.in_stock),
      itemCondition: 'https://schema.org/NewCondition',
      url,
      seller: { '@id': ORG_ID },
      shippingDetails: shippingDetails(),
      hasMerchantReturnPolicy: returnPolicy(),
    });
  let offers;
  if (variants.length === 1) offers = offer(variants[0]);
  else if (variants.length > 1) {
    const prices = variants.map((v) => Number(v.effective_price));
    offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: variants.length,
      availability: availability(variants.some((v) => v.in_stock)),
      offers: variants.map(offer),
    };
  } else if (product.price_inr !== null && product.price_inr !== undefined) {
    offers = clean({ '@type': 'Offer', price: Number(product.price_inr).toFixed(2), priceCurrency: 'INR', availability: availability(product.available), url, seller: { '@id': ORG_ID } });
  }
  const images = (product.images?.length ? product.images : product.image_url ? [product.image_url] : []).map(absoluteUrl);
  return clean({
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    description: product.description || undefined,
    url,
    image: images,
    sku: variants.length === 1 ? variants[0].sku : undefined,
    brand: { '@type': 'Brand', name: SITE.name },
    category: product.category,
    color: product.color,
    material: product.material,
    size: variants.length ? variants.map((v) => v.size_label).join(', ') : undefined,
    offers,
  });
}

export function itemListSchema(url, products) {
  if (!products?.length) return null;
  return {
    '@type': 'ItemList',
    '@id': `${url}#items`,
    itemListElement: products.slice(0, 48).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteUrl(`/product/${p.slug}`), name: p.name })),
  };
}

export function faqSchema(url, faqs) {
  if (!faqs?.length) return null;
  return { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

export function graph(nodes) {
  return { '@context': 'https://schema.org', '@graph': [organizationSchema(), websiteSchema(), ...nodes.filter(Boolean)] };
}

/** Safe for embedding inside <script type="application/ld+json">. */
export const jsonLdString = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
