// Brand facts used by page metadata and structured data (client and server).
// Values set to null are not published anywhere until the business confirms them —
// see docs/CLIENT_DETAILS_REQUIRED.md.

export const SITE = {
  name: 'Vishrea Studio',
  legalName: null,
  url: 'https://vishreastudio.com',
  locale: 'en_IN',
  description:
    'Vishrea Studio is an independent womenswear studio in Bengaluru selling one-of-one pieces and timeless designs — tops, dresses, co-ord sets, and layers — with studio pickup and delivery across India.',
  logo: '/apple-touch-icon.png',
  defaultImage: '/assets/hero-editorial.jpg',
  contact: {
    whatsapp: '+91 6364116567',
    phone: '+91 6364116567',
    // Set a monitored inbox before Razorpay live review. Null is omitted from the contact page.
    email: null,
  },
  address: {
    streetAddress: '16, 4th Cross, Kammasandra Rd, Hebbagodi, Electronic City Phase 2',
    locality: 'Bengaluru',
    region: 'Karnataka',
    postalCode: '560100',
    country: 'IN',
  },
  formattedAddress: '16, 4th Cross, Kammasandra Rd, Hebbagodi, Electronic City Phase 2, Bengaluru, Karnataka 560100',
  geo: {
    latitude: 12.8368,
    longitude: 77.6833,
    region: 'IN-KA',
    placename: 'Bengaluru, Hebbagodi, Electronic City Phase 2',
    position: '12.8368;77.6833',
  },
  hasMap: 'https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5',
  openingHours: 'Mo-Su 10:30-20:30',
  displayOpeningHours: '10:30 AM – 8:30 PM (Monday–Sunday)',
  priceRange: '₹₹',
  rating: {
    ratingValue: '5.0',
    reviewCount: '47',
  },
  // Verified business profiles & social channels
  sameAs: [
    'https://www.instagram.com/vishrea_studio/',
    'https://www.google.com/search?kgmid=%2Fg%2F11mlpxsxf5',
  ],
  shipping: { fee: 99, currency: 'INR', country: 'IN' },
  returns: { days: 7, damageHours: 24 },
};

export const absoluteUrl = (path) => (!path ? SITE.url : /^https?:\/\//.test(path) ? path : `${SITE.url}${path.startsWith('/') ? '' : '/'}${path}`);
