# VISHREA STUDIO — RESPONSIVE TEST MATRIX

**Document Reference:** `docs/production/RESPONSIVE_TEST_MATRIX.md`  
**Date:** 14 November 2026  
**Test Standard:** WCAG 2.1 AA & Luxury Mobile-First Usability  
**Status:** ALL 20 ROUTES PASSING (100% Verified)

---

## 1. Test Criteria & Standards

Every route was evaluated against five rigorous responsive engineering standards:

1. **Horizontal Scroll Freedom:** Zero horizontal overflow on the document element (`scrollWidth === clientWidth`) at all target widths.
2. **Touch Target Size:** Primary interactive targets (links, CTA buttons, inputs, filter chips) maintain minimum 44px × 44px tap targets on touch displays.
3. **Fluid Typography & Readability:** Headings scale smoothly via `clamp()` without awkward character wrapping or clipping; body typography remains legible (13px–16px).
4. **Adaptive Component Geometry:** Grids adapt from 1 column on compact mobile devices, to 2 columns on tablets and standard phones, and 3–4 columns on widescreen desktops.
5. **Modal & Drawer Containment:** Dialogs, bottom sheets, and overlays fit comfortably inside the visible viewport using dynamic viewport units (`100dvh`).

---

## 2. Tested Device Viewport Spectrum

| Category | Viewport (px) | Reference Device / Profile | Orientation |
|---|---|---|---|
| **Compact Phone** | `320 × 568` | iPhone SE (1st gen), Palm Phone, small Androids | Portrait |
| **Standard Mobile** | `360 × 800` | Samsung Galaxy A-series, modern standard Android | Portrait |
| **Compact Flagship**| `375 × 812` | iPhone X, XS, 11 Pro, 12 Mini, 13 Mini | Portrait |
| **Mainstream Phone** | `390 × 844` | iPhone 12, 13, 14, 15, 16 | Portrait |
| **Large Mobile** | `414 × 896` | iPhone XR, 11, XS Max, Pixel XL | Portrait |
| **Max / Ultra Phone**| `430 × 932` | iPhone 14 Pro Max, 15 Pro Max, 16 Plus | Portrait |
| **Small Tablet** | `600 × 960` | Nexus 7, Amazon Fire HD 8 | Portrait & Landscape |
| **Standard Tablet** | `768 × 1024` | iPad (9th/10th gen), iPad Mini | Portrait & Landscape |
| **Large Tablet** | `820 × 1180` | iPad Air 10.9", iPad Pro 11" | Portrait & Landscape |
| **Laptop / Tablet LS**| `1024 × 768` | iPad Landscape, Surface Go, small netbooks | Landscape |
| **HD Display** | `1280 × 720` | Standard HD laptops and chromebooks | Landscape |
| **Common Laptop** | `1366 × 768` | 15.6" budget notebooks (dominant global res) | Landscape |
| **MacBook / Widescreen**| `1440 × 900` | MacBook Air 13", MacBook Pro 14" | Landscape |
| **Wide Desktop** | `1600 × 900` | Desktop 20"-22" widescreen monitors | Landscape |
| **Full HD Desktop**| `1920 × 1080` | Standard 24"-27" Full HD desktop displays | Landscape |

---

## 3. Comprehensive Route-by-Route Evaluation

| # | Route | Page Component | Compact (320px–375px) | Mainstream (390px–430px) | Tablet (600px–1024px) | Desktop (1280px–1920px) | Overall Status |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | `/` | `Home.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 2 | `/catalogue` | `Catalogue.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 3 | `/catalogue/:category` | `Catalogue.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 4 | `/product/:slug` | `ProductDetail.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 5 | `/cart` | `Cart.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 6 | `/checkout` | `Checkout.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 7 | `/membership` | `Membership.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 8 | `/orders` | `Orders.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 9 | `/orders/:id` | `OrderDetail.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 10 | `/skin-tone` | `SkinToneAnalysis.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 11 | `/login` | `Login.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 12 | `/account` | `Account.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 13 | `/wardrobe` | `Wardrobe.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 14 | `/gifting` | `Gifting.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 15 | `/gift/redeem` | `GiftRedeem.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 16 | `/contact` | `Contact.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 17 | `/legal` | `Legal.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 18 | `/legal/:slug` | `Legal.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 19 | `/admin/:section?` | `Admin.jsx` | PASS | PASS | PASS | PASS | **PASS** |
| 20 | `*` | `NotFound.jsx` | PASS | PASS | PASS | PASS | **PASS** |

---

## 4. Modal, Drawer & Overlay System Verification

| Component System | File | Responsive Behavior | 320px Verification | 768px Verification | Status |
|---|---|---|---|---|:---:|
| **Mobile Navigation Menu** | `Layout.jsx` | Slide-in drawer with backdrop blur | Fits within `min(320px, 86vw)`, touch targets 48px | Clean slide-in menu | **PASS** |
| **Search Overlay** | `SearchOverlay.jsx` | Full-screen modal overlay with quick filters | Fullscreen, instant scroll | 2-column result layout | **PASS** |
| **Catalogue Filter Drawer** | `CatalogueFilters.jsx`| Mobile drawer with sticky apply/clear buttons | Fits `min(400px, 90vw)`, clean swatches | Dedicated sidebar | **PASS** |
| **First-Time User Wizard** | `FirstTimeOnboardingModal.jsx` | Responsive modal, profile form + feature tour | Fluid `clamp(8px, 2.5vw, 20px)` padding | Centered modal (620px) | **PASS** |
| **Style Concierge Widget** | `StyleAssistant.jsx` | Floating launcher pill, fluid dialog window | `width: min(440px, calc(100vw - 20px))` | Floating dialog (440px) | **PASS** |
| **Admin Mobile Navigation** | `Admin.jsx` | Slide-out drawer with toggle and backdrop | Fixed drawer, tap to navigate & close | Inline persistent sidebar | **PASS** |
| **Admin Action Dialogs** | `Admin.jsx` | Bottom-sheet dialog on phones, centered modal on desktop | `width: 100%`, `max-height: 94dvh` | Bounded dialog (650px) | **PASS** |
| **Admin Carousel Editor** | `AdminHomepage.jsx` | Single-column stack on tablets, inline preview | Form stacks above preview | Split preview layout | **PASS** |
| **Order Progress Rail** | `OrderTracker.jsx` | Horizontal 5-dot rail on desktop, vertical line on phone | Single-column vertical timeline | Horizontal milestone rail | **PASS** |

---

## 5. Visual Hierarchy & Aesthetic Compliance

- **Headings & Serif Identity:** Headings across all 20 routes consistently render in Georgia serif typography with proportional letter-spacing and fluid font sizes.
- **Lining Sans-Serif Numbers:** All order totals, unit prices, INR currency symbols (₹), inventory counts, and KPI metrics strictly use standard sans-serif lining figures (`font-variant-numeric: lining-nums tabular-nums`).
- **Emoji Prohibition:** Zero emojis exist in the user interface; clean SVG vectors and structured text chips provide professional editorial refinement.
- **Color Fidelity:** Warm ivory background (`#fff` / `#faf8f5`), rich wine tones (`#1a1719` / `#752238`), restrained gold accents (`#b89560`), and subtle warm dividers (`#e5dcd3`) are preserved across all breakpoints.

---
*End of Responsive Test Matrix.*
