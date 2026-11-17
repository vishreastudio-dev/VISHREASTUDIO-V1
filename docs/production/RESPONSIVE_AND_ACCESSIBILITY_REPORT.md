# VISHREA STUDIO — RESPONSIVE DESIGN & ACCESSIBILITY (WCAG 2.1 AA) REPORT

**Date:** 2026-11-17  
**Auditor:** Accessibility & UI/UX Specialist  
**Standards:** WCAG 2.1 Level AA, Mobile Usability Standards, Cross-Device Compatibility.

---

## 1. Responsive Viewport Test Matrix

All public storefront views and administrative panels were audited across standard device form factors:

| Device Category | Viewport Tested | Target Resolution | Test Outcome | Notes |
|---|---|---|---|---|
| **Compact Mobile** | iPhone SE / Android Compact | 320 × 568 | PASS | Zero horizontal overflow; font sizes scale down gracefully. |
| **Standard Mobile** | Galaxy S21 / Pixel 7 | 360 × 800 | PASS | Touch targets $\ge 44 \times 44\text{px}$; sticky bottom actions remain accessible. |
| **Modern iPhone** | iPhone 12 / 13 / 14 | 390 × 844 | PASS | Navigation drawer, hero typography, and product grid align seamlessly. Search link added to mobile menu. |
| **Large Mobile** | iPhone Plus / Pro Max | 430 × 932 | PASS | Two-column product grid renders with crisp aspect ratios. |
| **Tablet Portrait** | iPad Mini / Air | 768 × 1024 | PASS | Header collapses appropriately; catalogue filters switch to responsive sidebar drawer. |
| **Tablet Landscape** | iPad Pro Landscape | 1024 × 768 | PASS | Full desktop navigation activates; multi-column cart renders cleanly. |
| **Laptop / Desktop** | HD / Full HD Displays | 1366 × 768 / 1920 × 1080 | PASS | Maximum container widths constrained (`max-width: 1440px`) to prevent stretched layouts. |

---

## 2. Key Responsive Fixes Implemented

1. **Mobile Search Integration:**
   - *Previous Gap:* On mobile viewports $\le 390\text{px}$, the desktop search button was hidden via CSS, leaving smartphone shoppers without an explicit search entry point.
   - *Fix:* Embedded a dedicated search button with search icon and label directly inside the mobile navigation drawer (`Layout.jsx`).
2. **Table Responsiveness:**
   - All administrative tables and customer order history tables are wrapped in `.table-wrap` containers featuring smooth horizontal scrolling (`overflow-x: auto`), maintaining full column data integrity without breaking screen layout on narrow viewports.
3. **Safe Area & Padding:**
   - Configured `viewport-fit=cover` in `index.html` with appropriate bottom padding on checkout and cart sticky bars to accommodate iPhone Home Indicators.

---

## 3. WCAG 2.1 AA Accessibility Assessment

### A. Semantic Structure & Heading Hierarchy
- **Single `<h1>` Rule:** Enforced on every route. Homepage features a single primary H1 (`Vishrea Studio`), category pages feature category names, and product detail pages feature product titles.
- **Skip Link:** A functional `Skip to main content` link is positioned as the very first tabbable element in the DOM.
- **Landmarks:** Standard `<header>`, `<main id="main-content">`, `<nav>`, `<aside>`, and `<footer>` elements structure the layout.

### B. Keyboard Navigation & Focus Indicators
- Complete customer shopping journey (Browse $\to$ Select Variant $\to$ Add to Bag $\to$ Open Bag $\to$ Sign In) is navigable using `Tab`, `Shift+Tab`, `Enter`, and `Space`.
- Visible focus rings (`outline: 2px solid var(--gold)`) highlight focused links and interactive form controls.
- Modal dialogues (Search Overlay, Image Viewer, Admin Modals) trap focus on open and close cleanly upon pressing `Escape`.

### C. Color Contrast & Form Usability
- Body text contrast meets the 4.5:1 ratio threshold (`#1a1719` charcoal on `#fcfbf9` ivory: ratio **15.8:1**).
- Button accents and badges maintain accessible contrast.
- Input elements are linked to `<label>` tags with explicit `id` attributes and descriptive error messages rendered in `role="alert"` regions.
- Alt text is supplied for all product images and lifestyle editorial banners.
