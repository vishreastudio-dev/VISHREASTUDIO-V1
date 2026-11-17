# VISHREA STUDIO — WEBSITE STRUCTURE, CONTENT & BRAND INTEGRITY AUDIT

**Date:** 2026-11-17  
**Scope:** Customer-Facing Navigation, Brand Hierarchy, Page Content, Trust Disclosures, and Typography.

---

## 1. Brand Identity & Aesthetic Alignment

Vishrea Studio operates with a defined, high-fashion aesthetic:
- **Visual Direction:** Warm ivory/cream canvases (`#fcfbf9`), deep charcoal typography (`#1a1719`), muted bronze/champagne accents (`#b89560`), and wine highlights (`#5b2333`).
- **Typography:** Display serif headings for editorial prestige paired with crisp sans-serif body fonts for effortless readability.
- **Copywriting:** Restrained, authentic, and factual. Zero exaggerated marketing hype, countdown pressure tactics, or fabricated testimonials.
- **Zero-Emoji Policy:** Strictly enforced across all storefront pages, badges, product titles, and administrative interfaces.

---

## 2. Complete Route & Navigation Sitemap

| Route | Content & Function | Primary CTA | Status |
|---|---|---|---|
| `/` | Homepage: Editorial hero, curated categories mosaic, new arrivals ticker, Walkin Wardrobe preview, atelier story | Explore Categories / Shop New Arrivals | PASS |
| `/catalogue` | Complete collection listing with real-time category, size, price, and colour filtering | Filter & Select Size | PASS |
| `/catalogue/:category` | Category-specific edits (Dresses, Co-ord Sets, Tops, Trousers, Party Dresses) | Select Piece | PASS |
| `/shop` | Legacy/shorthand route | 301 Redirect to `/catalogue` | FIXED |
| `/product/:slug` | Product detail page: High-res gallery, size selector, measurement table, fabric & care, delivery policy | Add to Bag | PASS |
| `/cart` | Shopping bag: Item breakdown, size verification, delivery/pickup toggle, GST calculation | Sign In / Continue to Checkout | PASS |
| `/checkout` | Order finalisation: Address entry, billing details, Razorpay gateway integration | Pay Now | PASS |
| `/membership` | Walkin Wardrobe club details: 4 credits/mo, ₹1,799/mo, 6th month free piece, member benefits | Join Walkin Wardrobe | PASS |
| `/skin-tone` | Interactive on-device colour analysis tool: Undertone detector, 12 seasonal palettes | Start Colour Analysis | PASS |
| `/gifting` | Gift membership enquiry form and token redemption gateway | Send Gift Enquiry | PASS |
| `/contact` | Atelier location (Bengaluru), WhatsApp care line (`+91 6364116567`), phone support, studio visiting hours | Chat on WhatsApp | PASS |
| `/legal/returns` | Exchange and return policies: 7-day exchange window, unworn condition requirement | View Policies | PASS |
| `/legal/shipping` | Shipping disclosures: Free studio pickup, ₹99 pan-India delivery, estimated timelines | View Shipping Terms | PASS |
| `/legal/exchange-damage` | Immediate damage notification protocol (24-hour reporting requirement) | Submit Claim | PASS |
| `/legal/privacy` | Privacy policy: Explicit on-device photo privacy disclosure, cookie and data handling | Read Privacy Policy | PASS |
| `/legal/terms` | Terms of service: Membership cancellation rules, intellectual property, governing laws | Read Terms | PASS |
| `/*` (404) | Custom editorial 404 page with direct link back to catalogue | Return to Store | PASS |

---

## 3. Trust & Consumer Protection Disclosures

1. **Physical Studio & Verification:**
   - Publicly states atelier presence in Bengaluru, Karnataka, India.
   - Provides functional WhatsApp and phone contact (`+91 6364116567`).
   - Seller corporate legal details (CIN, GSTIN, registered office address) and Grievance Officer placeholders are wired to Admin Settings.
2. **True Inventory Truthfulness:**
   - One-of-one pieces are strictly labeled as single-size pieces.
   - Low-stock badges (`In stock — only a few left`) trigger purely on actual unit counts ($\le 2$), never on timed or artificial triggers.
3. **No-Fabrication Policy:**
   - Zero fake star reviews or manufactured 5-star badges.
   - User video and Instagram embeds render actual verified customer submissions.
4. **On-Device Privacy Guarantee:**
   - Skin-tone and colour analysis code processes facial landmarks entirely in WebAssembly/Canvas inside the user's browser; no customer face photos are ever uploaded or transmitted to any server.
