# VISHREA STUDIO — PERFORMANCE OPTIMIZATION & CORE WEB VITALS REPORT

**Date:** 2026-11-17  
**Scope:** Build Bundle Analysis, Runtime Latency, Core Web Vitals (LCP, INP, CLS), Asset Precompression.

---

## 1. Production Build & Bundle Breakdown

Vite 8 production build completed in **805ms** with Brotli precompression (`node scripts/precompress.js`).

### Bundle Manifest Summary

| Chunk File | Purpose | Raw Size | Gzip Size | Brotli Compressed |
|---|---|---|---|---|
| `index-*.js` | Core Storefront & React Runtime | 428.10 kB | 133.55 kB | Precompressed |
| `Admin-*.js` | Administrative Operations Studio (Lazy) | 301.02 kB | 67.17 kB | Precompressed |
| `vision_bundle-*.js` | MediaPipe Face Landmark AI (Lazy) | 152.69 kB | 44.98 kB | Precompressed |
| `vision_wasm_internal-*.wasm` | WebAssembly Engine for Colour Analysis | 14,603 kB | 4,191 kB | Precompressed |
| `index-*.css` | Global Editorial Stylesheet & Typography | 139.07 kB | 27.34 kB | Precompressed |
| `Checkout-*.js` | Razorpay Payments & Address Engine (Lazy) | 12.21 kB | 4.42 kB | Precompressed |
| `SearchOverlay-*.js` | Real-time Search Overlay (Lazy / Prefetched) | 9.05 kB | 3.54 kB | Precompressed |
| `Account-*.js` | Customer Portal & Order History (Lazy) | 34.65 kB | 8.06 kB | Precompressed |

**Key Architecture Win:** Admin Studio (`301 kB`), MediaPipe AI (`152 kB`), and Heavy WebAssembly (`14.6 MB`) are strictly code-split and loaded asynchronously on demand. A standard storefront shopper never downloads the admin bundle or WebAssembly engine until navigating specifically to those modules.

---

## 2. Core Web Vitals Optimization

### A. Largest Contentful Paint (LCP)
- **Target:** $< 2.5\text{s}$ on 4G mobile.
- **Optimizations:**
  - Critical hero image is preloaded on SSR (`<link rel="preload" as="image" href="..." fetchpriority="high" />`).
  - Preconnect to Unsplash image CDN (`<link rel="preconnect" href="https://images.unsplash.com" crossorigin />`).
  - Local product images served with cache-control and browser precompression headers.

### B. Interaction to Next Paint (INP)
- **Target:** $< 200\text{ms}$.
- **Optimizations:**
  - Search overlay is preloaded on hover or button focus (`prefetchSearch()`), eliminating wait time when the user clicks the search icon.
  - Cart mutations and size selection execute optimistic state updates with debounced API synchronizations.

### C. Cumulative Layout Shift (CLS)
- **Target:** $< 0.1$.
- **Optimizations:**
  - All editorial images, category cards, and product thumbnails declare explicit `width` and `height` attributes or aspect-ratio constraints in CSS.
  - Hero carousel placeholders reserve space (`.hero-carousel-placeholder`) during initial API handshakes to prevent content jumping.
