# Local SEO audit — Electronic City / Hebbagodi, Bengaluru

Date: 2026-11-11.

## Current state on the website

`vishrea-react/src/site.config.js` publishes:
- name: Vishrea Studio;
- locality: Bengaluru, Karnataka, IN;
- phone and WhatsApp: **+91 63641 16567** (matches the number in the brief);
- Instagram.

`streetAddress`, `postalCode`, `openingHours` and `email` are deliberately `null`. Null fields are omitted from the
`ClothingStore` markup and the contact page, so no unverified business fact is published.

## Address in the brief, not yet published

> VISHREA STUDIO, 16, 4th Cross, Kammasandra Road, Hebbagodi, Bengaluru, Karnataka 560100 · +91 63641 16567

The brief says to confirm this before publishing it. It has **not** been confirmed, and conflicting third-party listings
have not been checked (that needs the owner's Google Business Profile access). So it was not added to the site.

### To publish (about 5 minutes once confirmed)

1. Set the address fields in `site.config.js`: `streetAddress: '16, 4th Cross, Kammasandra Road, Hebbagodi'`, `postalCode: '560100'`, `locality: 'Bengaluru'`. Add `openingHours` in schema.org format, e.g. `['Mo-Sa 11:00-20:00']`, and only real hours.
2. The `ClothingStore` JSON-LD and the contact page then publish the same NAP on every page.
3. Use exactly the same name, address and phone on Google Business Profile, Instagram, Razorpay and any directory listing.

## Store-location page (recommended; content needed from the owner)

The contact page already carries the phone, WhatsApp and help FAQs. A dedicated store section, or a `/visit` page, should be
added **after** the owner supplies:
- verified hours;
- 3–6 genuine store photographs;
- the categories actually stocked in store;
- whether walk-in shopping is open to non-members;
- directions or a landmark;
- the Google Maps link.

Without those, the page would be thin or invented, so it was not created. Do not claim branches or service areas beyond
what is true: Bengaluru studio pickup and India-wide delivery.

## Google Business Profile checklist (owner)

| Item | Action |
|---|---|
| Name | Use "Vishrea Studio" exactly, with no keywords added |
| Primary category | Women's clothing store; secondary: Clothing store or Boutique (only if accurate) |
| Address and pin | Matches the confirmed address; move the map pin to the entrance |
| Hours | Real hours, including holiday hours |
| Phone and website | +91 63641 16567 and the production domain |
| Photos | Genuine storefront, interior and products; no stock photos |
| Products | A few real pieces with real prices, linking to the product pages |
| Reviews | Ask every customer the same neutral way; reply to all reviews; never buy reviews or offer incentives for positive ones |
| Duplicates | Search Maps for other or older listings of the business and request merge or removal |

## Readiness

**Not ready to publish the address.** Everything else is in place. Local SEO starts once the NAP is confirmed and GBP is aligned.
