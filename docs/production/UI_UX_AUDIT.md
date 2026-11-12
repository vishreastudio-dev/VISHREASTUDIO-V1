# Vishrea Studio — browser UI/UX audit

Date: 2026-11-11. Browser: Cursor IDE browser. Server: `http://127.0.0.1:3100` (isolated QA). Health immediately before the walk: HTTP 200, `{"ok":true,"db":"up"}`. Razorpay stand-in listening on `127.0.0.1:3190`. No production database, storage, or Resend traffic. The payment sheet still loads Razorpay’s public checkout script (see Checkout). No card was entered.

Viewports: desktop (default tab) and a 390×844 mobile emulation on the homepage. No application code was changed from this audit.

## Routes inspected

| Route | What was confirmed in the browser |
|---|---|
| `/` | Title, description, canonical `https://vishreastudio.com/`, one H1, OG tags, JSON-LD graph, nav and footer |
| `/catalogue` | Listing, sort, in-stock control, category toggle, prices |
| `/catalogue/dresses` | Unique title and description, canonical, H1 “Dresses”, 39 pieces |
| `/catalogue?q=silk` | H1 “Results for silk”, 1 piece, `noindex, follow` |
| `/product/premium-silk-column-dress` | Gallery alt text, sizes, add to bag, delivery copy, FAQ buttons, Product/Offer/FAQ JSON-LD |
| `/cart` | Guest bag with the silk dress, Small, ₹5,200, “Sign in to check out” |
| `/login` | Email then 6-digit code; QA echo only (`qa-user-1@qa.test`, then `qa-admin@qa.test`) |
| `/account` | Profile, referral link, sign out, delete-account control. `/admin` as a customer redirected here |
| `/checkout` | Pickup vs delivery, GST and gift options, totals, then “Waiting for payment” |
| `/orders` and `/orders/015471bd-…` | Awaiting-payment order with GST breakdown; earlier QA orders show “Preparing” and invoice numbers |
| `/membership` | Price, credits, pause/cancel, FAQ |
| `/contact` | WhatsApp and phone `+91 6364116567`, “Bengaluru, Karnataka, India”, FAQ |
| `/admin` | QA admin: overview, revenue, orders, products, customers |
| `/legal/*` | Linked from contact and footer (returns, shipping, damage, privacy, terms). Page bodies were not re-read line by line |
| `/robots.txt`, `/sitemap.xml` | Fetched over HTTP. QA robots is `Disallow: /`. Sitemap lists `https://vishreastudio.com/` URLs |

`/shop` returns the designed 404 (“This page has moved on”). The real shop URL is `/catalogue`.

## Journeys

| Journey | Result |
|---|---|
| Homepage and navigation | Pass. Skip link, collapsed menu button, wordmark, bag count |
| Category listing | Pass |
| Product detail, sizes, gallery | Pass. Main image alt “Premium Silk Column Dress in ink”, `naturalWidth` 1200, served from `/assets/dress.jpg` |
| Search | Pass when the query is in the URL (`?q=silk`). The box updates the URL on form submit |
| Guest bag | Pass. Count went from 0 to 1 after Add to bag |
| Sign-in OTP | Pass on QA fixtures. Development code was shown on the page. No real email |
| Account and sign-out | Pass. Sign out returned to `/login`. Colour-analysis line: “your photo never leaves your device” |
| Membership | Pass (content and FAQ). Join was not purchased |
| Checkout | Partial. Address step and totals worked (pickup ₹0 shipping, total ₹5,200, CGST/SGST shown). Hosted Razorpay sheet opened; payment was not completed |
| Orders | Pass for list and unpaid order detail. Courier tracking was not on screen because the new order is unpaid. Older QA orders are “Preparing” with invoice numbers |
| Contact and policies | Pass for contact content and policy links |
| Admin | Pass for the designated QA admin. A customer session cannot open `/admin` |
| Mobile 390px | Pass for overflow (`scrollWidth` 390). Menu opens (Shop, Dresses, Membership, Account, Admin studio, Contact). Search is not in the mobile header or menu |

## SEO observed in the browser

- Home title: `Vishrea Studio — One-of-One Womenswear, Bengaluru`. Description mentions one-of-one womenswear, free studio pickup, ₹99 delivery. Canonical and `og:url` are `https://vishreastudio.com/`. Robots: `index, follow, max-image-preview:large`. JSON-LD types: ClothingStore, WebSite, WebPage, ItemList. One H1.
- Dresses: title `Dresses | Vishrea Studio`, its own description, canonical `https://vishreastudio.com/catalogue/dresses`, H1 “Dresses”.
- Product: title `Premium Silk Column Dress — Dresses | Vishrea Studio`, description includes “from ₹5,200”. JSON-LD parsed: ClothingStore, WebSite, ItemPage, BreadcrumbList, Product (Offer present), FAQPage.
- Search: `noindex, follow`. Title stayed `Shop All Pieces | Vishrea Studio` (low; the page is not indexed).
- Login, account, admin, checkout, and cart responses included `X-Robots-Tag: noindex, nofollow`.
- Contact uses the same phone twice (WhatsApp and phone). Studio line is city-level only, which matches the owner action to fill legal address and grievance officer in Admin → Settings.
- QA `robots.txt` blocks the whole site. Production does not; that is tested in `test/production.test.js`.

## Findings

| Sev. | Finding | Remediation |
|---|---|---|
| — | No critical or high defect in the journeys above | — |
| Medium | On a 390px width, Search is `hide-sm` and missing from the mobile menu. Shop and categories remain available | Add a Search link in the mobile menu after launch. Not a checkout blocker |
| Low | Search results keep the catalogue title while noindexed | Optional unique title |
| Low | Two homepage Unsplash URLs reported `naturalWidth` 0 on first read | Confirm they are intentional editorial images and that they load off-VPN; product images from `/assets/` did load |
| Info | Checkout UI loads `https://checkout.razorpay.com/v1/checkout.js` and an `api.razorpay.com` iframe even when the API uses the local stand-in | Expected for production. Do not treat a QA browser checkout as fully offline. This pass stopped before capture |
| Info | “In stock — only a few left” is `stock_state` `low`, which the API sets at 1–2 units and not for one-of-one pieces (`lib/catalogue.js`) | Matches real low stock. Not fake urgency |

Competitor notes that are already present: delivery and exchange copy beside the product, membership FAQ, visible phone, on-device colour privacy line, no countdown timer. Not copied from other sites. Occasion pages, review schema, and a trust centre stay post-launch (`COMPETITOR_UX_RESEARCH.md`).
