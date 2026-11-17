// Page registry: metadata for every route. Used by the client (usePageSeo) and the server
// (initial HTML, sitemap, robots), so titles and descriptions are identical for users and crawlers.
import { SITE } from '../site.config.js';
import { POLICIES } from '../content/policies.js';

export const SITE_URL = SITE.url;
export const BRAND_NAME = SITE.name;

export const PAGES = {
  home: {
    path: '/',
    title: 'Vishrea Studio — One-of-One Womenswear, Bengaluru',
    description: 'One-of-one and small-run womenswear from a Bengaluru studio: tops, dresses, co-ords and layers. Free studio pickup in Bengaluru, ₹99 delivery across India.',
    indexable: true,
    ogImage: '/assets/hero-editorial.jpg',
  },
  catalogue: {
    path: '/catalogue',
    title: 'Shop All Pieces | Vishrea Studio',
    description: 'Every piece currently in the Vishrea edit — tops, dresses, co-ord sets, trousers and layers. Most are one-of-one, priced in INR including GST.',
    indexable: true,
    ogImage: '/assets/editorial.jpg',
  },
  membership: {
    path: '/membership',
    title: 'Walkin Wardrobe Membership — ₹1,799 a month | Vishrea Studio',
    description: 'Four wardrobe credits each paid month and free studio pickup. ₹1,799 a month, paid for 2 or 6 months — 1 free piece in the 6th month.',
    indexable: true,
    ogImage: '/assets/editorial.jpg',
  },
  skinTone: {
    path: '/skin-tone',
    title: 'Find Your Colours — Private Colour Analysis | Vishrea Studio',
    description: 'A colour guide that runs in your browser: undertone, depth and a palette to shop by. Your photo is never uploaded.',
    indexable: true,
    ogImage: '/assets/editorial.jpg',
  },
  contact: {
    path: '/contact',
    title: 'Help & Contact | Vishrea Studio',
    description: 'Delivery, studio pickup, exchanges, payments and sizing — answers to common questions, and how to reach the Vishrea Studio team on WhatsApp.',
    indexable: true,
    ogImage: '/assets/editorial.jpg',
  },
  gifting: {
    path: '/gifting',
    title: 'Gift a Walkin Wardrobe Membership | Vishrea Studio',
    description: 'Send a gift membership enquiry for someone special or your team. The studio confirms the details, invoices you and sends a private redemption link.',
    indexable: true,
    ogImage: '/assets/editorial.jpg',
  },
  legal: { path: '/legal', title: 'Policies | Vishrea Studio', description: 'Vishrea Studio policies.', indexable: true },
  cart: { path: '/cart', title: 'Your Bag | Vishrea Studio', description: 'Your bag.', indexable: false },
  checkout: { path: '/checkout', title: 'Checkout | Vishrea Studio', description: 'Checkout.', indexable: false },
  orders: { path: '/orders', title: 'Your Orders | Vishrea Studio', description: 'Your orders.', indexable: false },
  account: { path: '/account', title: 'Your Account | Vishrea Studio', description: 'Your account.', indexable: false },
  wardrobe: { path: '/wardrobe', title: 'Your Wardrobe Bag | Vishrea Studio', description: 'Pieces saved for credits and rewards.', indexable: false },
  giftRedeem: { path: '/gift/redeem', title: 'Redeem a Gift | Vishrea Studio', description: 'Redeem a gift membership.', indexable: false },
  login: { path: '/login', title: 'Sign In | Vishrea Studio', description: 'Sign in to Vishrea Studio.', indexable: false },
  admin: { path: '/admin', title: 'Studio Admin | Vishrea Studio', description: 'Internal.', indexable: false },
};

export const LEGAL_PAGES = POLICIES;

/** Path prefixes that must never be indexed. */
export const PRIVATE_PATHS = ['/cart', '/checkout', '/orders', '/account', '/login', '/admin', '/wardrobe', '/gift/redeem'];
