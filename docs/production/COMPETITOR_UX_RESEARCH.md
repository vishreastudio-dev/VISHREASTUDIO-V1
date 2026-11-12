# Competitor UX and SEO Research

Date: 2026-11-11
Prepared for: Vishrea Studio (curated Indian women's fashion, Bengaluru)

## Method and limits

- Only public pages were read. No accounts were created, no forms were submitted, nothing was added to a cart, and no login was attempted.
- Each site was read with a page-to-text fetcher. Because that fetcher strips HTML, the raw HTML of the same public pages was also downloaded once to read SEO signals (page title, meta description, canonical link and JSON-LD structured data types). About four page reads were made per site.
- "VERIFIED" means the fact appeared in fetched content from the cited URL. "NOT VERIFIED" means the page was not fetched, was rendered only by JavaScript, or was blocked.
- Text fetchers do not run JavaScript, so interactive features (filters, sort menus, size-chart pop-ups, login forms, quizzes) are often invisible. Absence in this report does not mean absence on the site.
- No code, copy or images were reused. Phrases below are short paraphrases for analysis only.

## 1. Aza Fashions (azafashions.com)

Large luxury designer marketplace (Next.js). The text fetcher timed out on the home and loyalty pages, but raw HTML and the category and product pages were readable.

- VERIFIED (home, raw HTML, https://www.azafashions.com/): title and meta description target "designer wear" and "wedding couture"; canonical set; JSON-LD types Organization, WebSite with SearchAction, SiteNavigationElement, OfferCatalog, PostalAddress, ContactPoint. Navigation covers Women, Men, Kids, Jewellery, Accessories, designers, occasions, colour landing pages (for example "red lehengas for women"), celebrity style and editorial curations. An "Image Search" control is in the header.
- VERIFIED (sign-in strings embedded in home HTML): "Sign in with Mobile/Email", "Sign in with Google", and a six-digit OTP sent by email or WhatsApp. No password step was seen.
- VERIFIED (footer links): Aza Advantage loyalty programme, loyalty and referral terms, Aza Cash, Aza Wallet, gift cards, payment options, returns and exchanges, shipping, order customisation, store locator, toll-free number with hours, WhatsApp styling help, Trustpilot link.
- VERIFIED (category, https://www.azafashions.com/collection/women/kurta-sets): sub-edits (Festive Anarkali, Sharara, Ready-to-Ship and more); product badges such as "New Arrivals", "Aza Exclusive", "Ready to ship", "Ships in 10 days", "Top Rated" and social proof "Wishlisted by 200+"; long SEO copy and a price-list table at the foot of the page.
- VERIFIED (product, https://www.azafashions.com/products/arpita-mehta-star-hand-embroidered-kurta-set/737301): components listed, occasion, pattern, neckline, sleeve, a "not included in sale" note for styling accessories, a made-to-order colour-variance disclaimer, EMI offer, "import duties included", and Shipping & Returns plus support contacts.
- NOT VERIFIED: loyalty page content (JavaScript only), filters and sort UI, size guide, fabric/care on this product, reviews on the product page, product-page JSON-LD (raw request hit a bot challenge), checkout.

## 2. The Chic Indian (thechicindian.com)

Curated multi-designer store for men and women (Shopify). Server-rendered HTML, so most content was readable.

- VERIFIED (home, https://thechicindian.com/): title "Curated Designer Fashion"; meta description mentions independent designers and a pre-loved/unworn resale line; JSON-LD Organization and WebSite with SearchAction. Sections include a seasonal edit, curations by category, new arrivals with MRP, bestsellers, "From the Curator", and a five-star testimonial strip (one testimonial mentions an AI search feature). Links include an account page, cart, wishlist page, shop-by-designer, FAQs, shipping, returns and privacy pages, WhatsApp contact.
- VERIFIED (raw HTML): an OTP sign-in pop-up widget is present (OTP consent placeholders and an OTP pop-up class). The exact flow was not exercised.
- VERIFIED (listing, https://thechicindian.com/collections/womens-dresses): product grid with brand, MRP and "20% OFF" style sale pricing.
- VERIFIED (product, https://thechicindian.com/products/cleo-dress): "Size Chart" link next to size, "Free delivery across India", "Partial cash on delivery available", fit, model height and size worn, material, colour, what is included, "Dry Clean Only" care. JSON-LD Product with Offer, Brand and AggregateRating.
- VERIFIED (returns, https://thechicindian.com/pages/cancellation-returns-policy): no returns except faulty or damaged items reported within 48 hours with photos; size-exchange rules vary by label; no customer cancellation once placed; made-to-measure is final; international orders are final.
- NOT VERIFIED: filter and sort controls, search behaviour, loyalty or membership (none seen), checkout and payment provider.

## 3. Wardro8e (wardro8e.com)

Personalised fashion discovery app in Android beta with a waitlist. Only the landing page exists publicly; it links to no internal pages.

- VERIFIED (https://www.wardro8e.com/): title and meta description target "personalised fashion discovery app India"; JSON-LD Organization and WebSite with SearchAction. The page explains an optional style quiz at sign-up (pick aesthetics, or skip), a feed that learns from saves, skips and purchases, visual similarity ("More Like This"), shareable public collections, and an FAQ. It states it is free, earns via affiliate commission, and sends buyers to the brand's own checkout.
- NOT VERIFIED: everything inside the app (product pages, login method, wishlist, any match score). There is no catalogue, returns or checkout on the site.

## 4. Ainaa (ainaa.ai)

Conversational AI stylist for Indian fashion that links out to brand stores (Next.js).

- VERIFIED (home, https://www.ainaa.ai/): title "AI Stylist for Indian Fashion"; JSON-LD WebSite and FAQPage. Copy describes chat-based styling by occasion and budget, photo search ranked by visual similarity, a taste profile across fourteen dimensions, "complete the look" add-ons, and saved look-books. It states each pick comes with the reasoning behind it.
- VERIFIED (trust page, https://www.ainaa.ai/trust): guest use with no account; sign-in only to keep taste, saved looks and a bag; no data sale or ad sharing; session replay only for signed-in users with typed text masked; payment happens on the brand's site; self-service delete account; "Not for me" feedback to tune suggestions; and an honest statement that it holds no security certifications or external audit yet.
- NOT VERIFIED: login page (JavaScript only, returned just the logo), any match percentage, product pages, returns (handled by brands).

## 5. Stylein (stylein.fashion)

Outfit-curation site that builds complete looks and links to marketplaces (Astro, fully server-rendered).

- VERIFIED (home, https://stylein.fashion/): title and meta description about complete looks with an all-in price. The hero says a selfie is read on the phone to suggest suitable colours (example: cool undertone, navy, berry, emerald), then looks are built for an occasion and budget. Navigation: occasions, capsules, all looks, shop categories, price bands ("under 1000/2000/3000/5000"), stylist, creators. Trust claims: prices checked by hand with dates, no countdown timers or "only 2 left", same price as the store. No JSON-LD on the home page.
- VERIFIED (look page, https://stylein.fashion/looks/wedding-guest-women-blue-anarkali-mojaris-202610/): a "bill" with each item, store, price, total, the date prices were checked, a staleness warning ("checked over 3 weeks ago"), and a short "Why it works" explanation. JSON-LD Article, BreadcrumbList and Organization.
- VERIFIED (https://stylein.fashion/disclosure/): plain-English affiliate disclosure, labelling rules for paid and gifted looks, and a takedown process with response times.
- NOT VERIFIED: login, wishlist, the selfie colour tool itself (on the stylist page, not fetched), returns (handled by stores).

## 6. Outfevibe (outfevibe.com)

AI stylist web app for Gen Z and millennials (Next.js).

- VERIFIED (home, https://www.outfevibe.com/): title "India's First AI Stylist"; meta description mentions body type, skin tone and a free style quiz; JSON-LD Organization, WebSite, SoftwareApplication with AggregateRating and Offer, and FAQPage. Copy promises no sign-up, a private photo and free use, and shows ratings ("4.2 user rating" and "4.8 avg rating"). A persona card shows percentages (for example "Minimalist Maven 82%", "Streetwear Icon 54%"); no explanation of how the percentages are calculated was found. A virtual wardrobe feature for uploading your own clothes is described.
- VERIFIED (quiz, https://www.outfevibe.com/quiz): meta description says a free six-question quiz assigns a fashion persona in about two minutes. Quiz content itself is JavaScript only.
- VERIFIED (login, https://www.outfevibe.com/login): a "Welcome Back" sign-in page exists; the method (email, Google, OTP) was not visible.
- NOT VERIFIED: login method, product pages, wishlist, returns, privacy policy content.

## Comparison table

| Area | Aza | Chic Indian | Wardro8e | Ainaa | Stylein | Outfevibe |
| --- | --- | --- | --- | --- | --- | --- |
| Landing page | Occasion, designer and celeb edits | Seasonal edit, curator picks, reviews | App waitlist landing | Chat-stylist demo | Selfie, occasion, budget hero | Quiz and photo styling hero |
| Navigation | Deep: category, designer, occasion, colour | Category, designer, style edits, price bands | None (single page) | Minimal | Occasion, capsule, price band | Discover, quiz, outfit |
| Search / filters / sort | Image search seen; filters not verified | Not verified | Not verified | Chat and photo search (claimed) | Price-band pages | Not verified |
| Product page | Components, occasion, EMI, disclaimer | Size chart, fit, model size, care | Not verified | Not verified | Look "bill" with dated prices | Not verified |
| Size guide | Not verified | Size Chart link | Not verified | Not verified | Not applicable | Not verified |
| Fabric / care | Not verified on PDP | Material and dry-clean care | Not verified | Not verified | Not verified | Not verified |
| Delivery info | Shipping link, ship-time badges | Free India delivery, partial COD | Not applicable | Brand handles | Store handles | Not verified |
| Reviews | Trustpilot link, "Top Rated" badge | Testimonials, Product rating schema | Not verified | Not verified | Not verified | Testimonial and rating claims |
| Login method | Mobile/email OTP (email or WhatsApp), Google | OTP pop-up markup | Not verified | Guest use; method not verified | Not verified | Page exists; method not verified |
| Style quiz | Not verified | Not verified | Optional, skippable | Conversation instead | Selfie + occasion + budget | Six-question persona quiz |
| Personalisation / match % | Not verified | Not verified | Learns from saves/skips; no % seen | Reasons per pick; no % seen | Colour read on phone; "Why it works" | Persona % shown, not explained |
| Wishlist / bag | "Wishlisted by" counts | Wishlist page, cart | Collections | Saved looks and bag | Not verified | Virtual wardrobe |
| Membership / loyalty | Aza Advantage, Aza Cash, referral, gift card | Not seen | Free, none | None seen | None | None seen |
| Checkout / payment | EMI, payment-options page | Partial COD | Brand site | Brand site | Store site | Not verified |
| Trust / returns / support | Returns page, toll-free, WhatsApp, stores | Strict 48-hour faulty-only policy, WhatsApp | FAQ only | Detailed trust page, delete account | Affiliate disclosure, takedown policy | Privacy claims |
| SEO: JSON-LD (home) | Organization, WebSite, SiteNavigationElement | Organization, WebSite | Organization, WebSite | WebSite, FAQPage | None | Organization, SoftwareApplication, FAQPage |
| SEO: inner pages | PDP not verified | Product, Offer, AggregateRating | Not applicable | Not verified | Article, BreadcrumbList | Quiz has FAQPage |

## Recommendations for Vishrea Studio

Nothing below suggests copying any competitor's branding, wording or claims. Each idea is a general pattern seen across several sites.

### (a) Launch-safe small improvements (no new architecture)

1. Add structured data to existing pages: Organization and WebSite on the home page, Product with Offer (price in INR, availability) on product pages, and BreadcrumbList on category and product pages. Only add AggregateRating once real reviews exist. Most competitors have at least Organization; only The Chic Indian had Product markup.
2. Give every category and product page a unique title, meta description and canonical link. Aza and Stylein do this consistently.
3. Put fit facts on every product page in a fixed order: size guide link, fit type, model height and size worn, fabric, care, and what is included. The Chic Indian does this well and it reduces size-exchange requests.
4. Show delivery and exchange terms next to the Add to Wardrobe Bag button (delivery estimate, size-exchange window, who pays return shipping). State the size-exchange policy in plain words, since some competitors offer only faulty-item returns and customers will compare.
5. When the colour analysis suggests pieces, show a one-line reason ("suits your warm undertone because of the rust and olive tones") rather than an unexplained score. If a match percentage is shown, add a short "How this is worked out" note. Outfevibe shows unexplained percentages; Ainaa and Stylein explain picks in words.
6. State the privacy position of the on-device colour analysis clearly on the page: the photo stays on the phone and is not uploaded. Competitors lead with privacy promises for photo features.
7. Publish a short, honest "How membership works" page: what one credit buys, roll-over rules, pausing and cancelling, gift membership redemption, and referral terms. Aza separates loyalty, wallet and referral terms into clear linked pages.
8. Make support easy to find in the footer: an email address, support hours, and (if staffed) a WhatsApp number. Every retail competitor shows these.
9. Add an FAQ page with FAQPage markup covering OTP sign-in, membership credits, exchanges and delivery.
10. Avoid fake urgency. Do not use countdown timers or "only 2 left" unless stock is real; this suits the editorial brand and is now a stated trust point for at least one competitor.

### (b) Post-launch ideas

1. Occasion and price-band landing pages (for example "festive under ₹10,000") for SEO and discovery, written in the Vishrea voice.
2. Optional, skippable style questionnaire at onboarding that seeds recommendations, combined with the colour analysis.
3. "Not for me" feedback on suggestions so members can tune what they see.
4. "Complete the look" suggestions on product pages, using pieces already in the catalogue.
5. Shareable Wardrobe Bag or saved-edit links that members can send to friends, tied to the referral programme.
6. Customer reviews with photos on product pages, then AggregateRating markup.
7. A public trust page (data handled, what is not collected, how to delete an account), modelled on the idea, not the wording, of Ainaa's trust centre.
8. Image search or "more like this" visual similarity once the catalogue is large enough to benefit.
