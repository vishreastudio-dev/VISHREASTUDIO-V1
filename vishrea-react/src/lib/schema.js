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
    '@type': ['ClothingStore', 'LocalBusiness'],
    '@id': ORG_ID,
    name: SITE.name,
    legalName: SITE.legalName,
    url: 'https://vishreastudio.com',
    logo: absoluteUrl(SITE.logo),
    image: absoluteUrl(SITE.defaultImage),
    description: SITE.description,
    telephone: '+91-6364116567',
    email: SITE.contact.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '16, 4th Cross, Kammasandra Rd, Hebbagodi, Electronic City Phase 2',
      addressLocality: 'Bengaluru',
      addressRegion: 'Karnataka',
      postalCode: '560100',
      addressCountry: 'IN',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 12.8368,
      longitude: 77.6833,
    },
    hasMap: SITE.hasMap || undefined,
    openingHours: 'Mo-Su 10:30-20:30',
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        opens: '10:30',
        closes: '20:30',
      },
    ],
    priceRange: '₹₹',
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
    paymentAccepted: 'UPI, Credit Card, Debit Card, Net Banking, Cash',
    areaServed: [
      {
        '@type': 'City',
        name: 'Bengaluru',
      },
      {
        '@type': 'Country',
        name: 'India',
      },
    ],
    knowsAbout: [
      'Womenswear',
      'Independent womenswear boutique Electronic City Bengaluru',
      'Professional personal colour & style analysis at an independent womenswear boutique in Electronic City Bengaluru',
      'Best boutique clothing brands in Bangalore for curated soft structure co-ords and tailored wide leg pants',
      'Personal styling consultations Bangalore',
      'Tailored wide leg pants and trousers',
      'Soft structure co-ord sets',
      'Sculpted Everyday Top and Everyday Crop Top',
      'Relaxed Knit Cardigan',
      'Fluffy Bunny Applique Knit',
      'One-of-one silhouettes',
      'Bespoke fashion tailoring Hebbagodi',
      'Walkin Wardrobe membership',
      'Personal styling & colour analysis',
      'Curated fashion studio Bengaluru',
    ],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Curated Boutique Womenswear Silhouettes',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Soft Structure Coord',
            description: 'Curated soft structure co-ord set tailored in textured crepe for effortless styling.',
          },
          price: '4290',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Tailored Wide-Leg Pant',
            description: 'High-waisted tailored wide leg trousers in twill with pleated drape and deep pockets.',
          },
          price: '2790',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Everyday Crop Top',
            description: 'Contoured everyday crop top in premium stretch cotton knit.',
          },
          price: '1590',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Sculpted Everyday Top',
            description: 'Sculpted contour top crafted in soft structured fabric for day-to-evening versatility.',
          },
          price: '2190',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Relaxed Knit Cardigan',
            description: 'Lightweight fine knit cardigan with refined contemporary silhouette drape.',
          },
          price: '2490',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Fluffy Bunny Appliqué Knit',
            description: 'Artisanal applique knitwear sweater with soft textured finish.',
          },
          price: '2990',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'The Wine Slip Dress',
            description: 'Fluid evening silhouette in Vishrea wine satin blend.',
          },
          price: '3490',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'After Hours Dress',
            description: 'Refined party silhouette in burgundy satin blend for after-dark plans.',
          },
          price: '3990',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Product',
            name: 'Longline Shrug',
            description: 'Fluid lightweight weave long layer for finishing a look.',
          },
          price: '3290',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Professional Personal Colour & Style Analysis',
            description: '1-on-1 private seasonal colour and styling consultation at Electronic City atelier.',
          },
          price: '0',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
      ],
    },
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

const availability = (inStock) => (inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock');

const shippingDetails = () => ({
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: SITE.shipping.fee, currency: SITE.shipping.currency },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: SITE.shipping.country },
  deliveryTime: {
    '@type': 'ShippingDeliveryTime',
    handlingTime: {
      '@type': 'QuantitativeValue',
      minValue: 1,
      maxValue: 2,
      unitCode: 'DAY',
    },
    transitTime: {
      '@type': 'QuantitativeValue',
      minValue: 2,
      maxValue: 5,
      unitCode: 'DAY',
    },
  },
});

const returnPolicy = () => ({
  '@type': 'MerchantReturnPolicy',
  applicableCountry: SITE.shipping.country,
  returnPolicyCountry: SITE.shipping.country,
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: SITE.returns.days,
  returnMethod: 'https://schema.org/ReturnByMail',
  returnFees: 'https://schema.org/FreeReturn',
  refundType: 'https://schema.org/ExchangeRefund',
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
      priceValidUntil: '2027-12-31',
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
      priceValidUntil: '2027-12-31',
      availability: availability(variants.some((v) => v.in_stock)),
      offers: variants.map(offer),
    };
  } else if (product.price_inr !== null && product.price_inr !== undefined) {
    offers = clean({
      '@type': 'Offer',
      price: Number(product.price_inr).toFixed(2),
      priceCurrency: 'INR',
      priceValidUntil: '2027-12-31',
      availability: availability(product.available),
      itemCondition: 'https://schema.org/NewCondition',
      url,
      seller: { '@id': ORG_ID },
      shippingDetails: shippingDetails(),
      hasMerchantReturnPolicy: returnPolicy(),
    });
  }
  const images = (product.images?.length ? product.images : product.image_url ? [product.image_url] : [SITE.defaultImage]).map(absoluteUrl);
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
    itemListElement: products.slice(0, 48).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: absoluteUrl(`/product/${p.slug}`),
      name: p.name,
      item: {
        '@type': 'Product',
        name: p.name,
        url: absoluteUrl(`/product/${p.slug}`),
        image: absoluteUrl(p.image_url || '/assets/editorial.jpg'),
        offers: {
          '@type': 'Offer',
          price: Number(p.price_inr || p.price || 0).toFixed(2),
          priceCurrency: 'INR',
          availability: p.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        },
      },
    })),
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
