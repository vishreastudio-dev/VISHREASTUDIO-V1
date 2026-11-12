# Product SEO, AEO and GEO guide

Date: 2026-11-11. This guide covers how product pages are built today, what admins must enter, and what is deliberately not automated.

## 1. What every product page shows (generated from stored data)

| Element | Source | Rule |
|---|---|---|
| H1 | `products.name` | One per page |
| Title | `{name} — {category} | Vishrea Studio` | Unique per product. Long names can exceed 60 characters; keep names concise |
| Meta description | `productMetaDescription()`: name, real price, factual sentence, delivery or sold-out | Capped at 155 characters |
| Description | `products.description`; if missing, a factual sentence from category, colour, material and sizes | **Never invented.** Write about 130 words yourself (see §3) |
| Facts panel | category, colour, material, sizes (sold-out marked), SKU, measurements in cm and inches, one-of-one flag, custom `attributes` | Only filled fields are shown |
| Care | `care_instructions` | Hidden when empty |
| Delivery and exchanges | Published policy: ₹99 India-wide, free Bengaluru pickup, 7-day size exchange, 24 h damage report | Same text everywhere |
| Questions (AEO) | `productFaqs()`: material, in-stock sizes, washing, exchange, delivery (max 4) | Visible on the page; same text in server HTML and `FAQPage` JSON-LD |
| Related products | "You may also like" plus the category link | From the catalogue API |
| Structured data | `Product` + per-size `Offer`s | See `STRUCTURED_DATA_AUDIT.md` |
| Image alt | "{name} in {colour}, view n of m" | Generated from data |

## 2. Missing-information state

The admin product editor now shows "Listing still missing: …" for description (under 80 characters), material, care, colour,
measurements and photos. A missing fact is never filled in automatically. The page simply leaves that line or FAQ out.

**Not stored today:** lining, transparency, sleeve, fit type, garment length type, and size-chart tables. Add them as named keys
in the existing per-product **attributes** field. Those keys appear in the facts panel as written (for example `Lining: Fully lined`,
`Fit: Relaxed`). A dedicated column or FAQ for these should wait until admins actually fill them, which avoids empty fields at launch.

## 3. Writing a product description (template for admins)

About 130 words, factual, no superlatives that cannot be shown:
1. What it is, and the occasion it genuinely suits (one sentence).
2. Fabric: composition from the label, how it feels, and its weight.
3. Construction: lining, transparency, neckline, sleeve, closure.
4. Fit and length, plus the model's size if a model is pictured.
5. How to style it, naming 1–2 real pieces from the catalogue (internal links).
6. Care, matching the label.

Do not copy competitor text. Do not claim stock, delivery dates or reviews that the system does not show.

## 4. AEO: questions answered on the site

| Shopper question | Where it is answered |
|---|---|
| What is it made of? | PDP facts and FAQ (when material is entered) |
| Which sizes are available? | PDP sizes and FAQ (live stock) |
| How should it be washed? | PDP care and FAQ (when entered) |
| Can I exchange it? | PDP, FAQ, `/legal` exchange policy, `/contact` FAQ |
| Do you deliver to my PIN code? | "Delivery anywhere in India is ₹99", plus checkout address validation. **Owner:** confirm the courier covers all PIN codes, otherwise change this wording |
| Is it suitable for everyday wear? | Only through the admin-written description and the `occasion` field. Not auto-answered |
| Is it lined? | `attributes.Lining`, when entered |
| Where is the store? | Not published until the address is verified (`LOCAL_SEO_AUDIT.md`) |

## 5. GEO: being understood by search and AI shopping systems

Already in place:
- stable slug URLs with canonicals;
- one brand name everywhere;
- full product facts and offers in JSON-LD in the first HTML response;
- an image sitemap;
- consistent price and availability between the page and the markup;
- category intros and links;
- clear policies at `/legal/*`.

Recommended after launch (no code needed):
- **Google Merchant Center:** free listings via a product feed. The sitemap and `Product` markup are already compatible; a CSV/XML feed endpoint can be added later if Merchant Center needs it.
- **Guides:** one fabric guide and one sizing guide based on real inventory, linked from category pages.
- **Consistency:** keep store NAP and policies identical everywhere.

Nothing on the site promises AI inclusion or rankings, and there is no hidden or AI-only content.
