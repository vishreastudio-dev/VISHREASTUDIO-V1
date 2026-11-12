// Brand facts used by page metadata and structured data (client and server).
// Values set to null are not published anywhere until the business confirms them —
// see docs/CLIENT_DETAILS_REQUIRED.md.

export const SITE = {
  name: 'Vishrea Studio',
  legalName: null,
  url: 'https://vishreastudio.com',
  locale: 'en_IN',
  description:
    'Vishrea Studio is a womenswear studio in Bengaluru selling one-of-one pieces and small-run designs — tops, dresses, co-ord sets and layers — with studio pickup and delivery across India.',
  logo: '/apple-touch-icon.png',
  defaultImage: '/assets/hero-editorial.jpg',
  contact: {
    whatsapp: '+91 6364116567',
    phone: '+91 6364116567',
    // Set a monitored inbox before Razorpay live review. Null is omitted from the contact page.
    email: null,
  },
  address: {
    streetAddress: null,
    locality: 'Bengaluru',
    region: 'Karnataka',
    postalCode: null,
    country: 'IN',
  },
  openingHours: null,
  // Seller legal details and the grievance officer are entered by the owner in admin Settings
  // (Legal information) and published on the contact page only once marked verified.
  sameAs: ['https://www.instagram.com/vishreastudio'],
  shipping: { fee: 99, currency: 'INR', country: 'IN' },
  returns: { days: 7, damageHours: 24 },
};

export const absoluteUrl = (path) => (!path ? SITE.url : /^https?:\/\//.test(path) ? path : `${SITE.url}${path.startsWith('/') ? '' : '/'}${path}`);
