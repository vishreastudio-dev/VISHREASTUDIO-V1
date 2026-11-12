# Vishrea Studio — Master Platform Architecture, User Flows & Implementation Verification

> **Superseded (7 Nov 2026):** use `docs/technical/TECHNICAL_ARCHITECTURE.md` (VS-ARC-001) and `docs/client/REQUIREMENTS_TRACEABILITY_MATRIX.md` (VS-REQ-001). Since 7 Nov, membership is billed as 2 months upfront plus a monthly UPI Autopay mandate (not prepaid only). This file is kept for history.
>
> **Accuracy note (5 Nov 2026 remediation):** parts of this document describe intended rather than implemented behaviour. In particular: the colour engine is Canvas + CIELAB with fixed face-area sampling (no MediaPipe); membership is prepaid (2 or 6 months) with no subscription autopay; customer videos are capped at 10 seconds; credits are granted at the start of each paid month. The current, verified behaviour is documented in `docs/archive/2026-11-05-remediation-audit/VISHREA_AUDIT_REMEDIATION_REPORT.md` and `docs/archive/2026-11-05-remediation-audit/verification-checklist.md`, which take precedence.

> **Comprehensive Status, Architecture & Technical Specification Document**
> **Workspace**: `Vishrea Studio (VDEV / Karnataka)`
> **Last Verified**: Current Release (V1.0 Production Architecture)
> **Primary Technology Stack**: React 19 (Vite SPA) + Node.js/Express REST API + PostgreSQL (`pg`) + MediaPipe / Canvas Colour Engine + Razorpay + OpenAI/Ollama Fashion Studio.

---

## Table of Contents

1. [Executive Summary &amp; High-Level System Architecture](#1-executive-summary--high-level-system-architecture)
2. [Master User Flows &amp; Journey Maps](#2-master-user-flows--journey-maps)
3. [UI &amp; UX Design Systems &amp; Micro-Interactions](#3-ui--ux-design-systems--micro-interactions)
4. [Backend Services &amp; API Architecture](#4-backend-services--api-architecture)
5. [Database Schema &amp; State Engineering](#5-database-schema--state-engineering)
6. [Comprehensive Implementation Checklist (Done vs. In Progress)](#6-comprehensive-implementation-checklist-done-vs-in-progress)
7. [Security, Performance &amp; Privacy Guarantees](#7-security-performance--privacy-guarantees)
8. [Runbook &amp; Deployment Guide](#8-runbook--deployment-guide)

---

## 1. Executive Summary & High-Level System Architecture

Vishrea Studio is a luxury, bespoke women's fashion commerce ecosystem engineered around **one-of-one garment exclusivity**, an **on-device biometric colour harmony analysis engine**, and an **exclusive monthly Walkin Wardrobe rental/membership subscription model**.

```mermaid
graph TD
    subgraph Client ["Client Layer (Browser / SPA)"]
        ReactSPA["React 19 SPA (Vite + React Router v7)"]
        StoreCtx["Global StoreContext (Cart, Wardrobe, Auth, Toast)"]
        OnDeviceML["MediaPipe + Canvas (Local Colour Harmony Engine)"]
        ReactSPA <--> StoreCtx
        ReactSPA <--> OnDeviceML
    end

    subgraph Edge ["Server / Gateway Layer (Node.js / Express)"]
        ExpressApp["Express Application (Port 3000)"]
        AuthMid["Cookie Auth & Role Guard Middleware"]
        UploadEnd["Native Media / Base64 Upload Engine (/api/upload)"]
        StaticRoute["Vite Dist Static Hosting & SPA Fallback Route"]
        RobotsSitemap["SEO Engine (/robots.txt, /sitemap.xml)"]
      
        ExpressApp --> AuthMid
        ExpressApp --> UploadEnd
        ExpressApp --> StaticRoute
        ExpressApp --> RobotsSitemap
    end

    subgraph API ["REST API Layer (/api/*)"]
        PublicAPI["Public Commerce: /catalogue, /product, /cart, /checkout, /piece-requests"]
        UserAPI["Customer Realm: /account, /orders, /membership, /wardrobe, /exchange"]
        AdminAPI["Admin Ops: /api/admin/ops (16 Modules), /dashboard, /listing-studio"]
        PaymentAPI["Razorpay Webhook & Signature Verification (/payment-verify)"]
    end

    subgraph DataServices ["Persistence & External Services"]
        PG[(PostgreSQL Database Pool)]
        RazorpayGateway["Razorpay Payments & Subscriptions"]
        AIEngine["OpenAI / Ollama Fashion Copywriter"]
        DiskUploads["Local Static Media Storage (/public/uploads)"]
    end

    Client <==>|JSON / REST & Credentials Cookie| ExpressApp
    ExpressApp --> API
    API --> PG
    PaymentAPI --> RazorpayGateway
    AdminAPI --> AIEngine
    UploadEnd --> DiskUploads
```

### Component Breakdown

| Layer                      | Tech Stack                                       | Role / Responsibility                                                                                                   |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Frontend**         | React 19, React Router v7, Vanilla CSS Tokens    | Zero heavy UI framework overhead; bespoke luxury design tokens, smooth transitions, mobile-first responsive interfaces. |
| **State Management** | React Context (`StoreContext`)                 | Unified local persistence, cart state, credit balance, auth token sync, toast dispatchers.                              |
| **On-Device ML**     | HTML5 Canvas, MediaPipe FaceMesh / RGB-to-CIELAB | Client-side only skin undertone and harmony analysis. Zero biometric photos ever hit the server.                        |
| **Backend API**      | Node.js (ESM), Express 4.x                       | Modular route controllers (`/api/*`), dynamic route loader, session authentication, multipart/base64 media pipeline.  |
| **Database**         | PostgreSQL (`pg` native pool)                  | Relational multi-table schema with migrations `001_initial.sql` through `012_piece_requests.sql`.                   |
| **Payment Gateway**  | Razorpay SDK & HMAC SHA-256                      | Orders, customer cards/UPI, monthly recurring subscriptions, automated webhook signature verification.                  |
| **AI Studio**        | OpenAI `gpt-4o-mini` / Ollama fallback         | Automated editorial descriptions, fabric care guides, SEO titles, and luxury tone formatting.                           |

---

## 2. Master User Flows & Journey Maps

### Flow 1: Visitor to Customer Checkout (E-Commerce Journey)

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Shopper
    participant Web as Storefront SPA
    participant Server as Express Server
    participant DB as PostgreSQL
    participant RZP as Razorpay

    Customer->>Web: Land on Homepage (Hero, The Edit, Customer Reels)
    Customer->>Web: Browse /catalogue (Filter by category, price, colour palette)
    Customer->>Web: View Product Detail (/product/:slug)
    Customer->>Web: Select Size & Click "Add to Cart"
    Web->>Customer: Toast alert + Shopping Bag updated
    Customer->>Web: Navigate to /checkout
    Customer->>Web: Enter shipping info + Optional GSTIN + Studio pickup option
    Web->>Server: POST /api/checkout (Validate stock & calculate total/taxes)
    Server->>RZP: Create Order (Razorpay Order ID)
    Server-->>Web: Return order token & Razorpay checkout payload
    Web->>RZP: Open Razorpay modal (UPI, Card, NetBanking)
    Customer->>RZP: Complete transaction
    RZP-->>Web: Payment confirmation (razorpay_payment_id, signature)
    Web->>Server: POST /api/payment-verify (Validate HMAC SHA-256)
    Server->>DB: Record order, mark 1-of-1 inventory as SOLD, save GST invoice
    Server-->>Web: Order confirmation + Order ID
    Web->>Customer: Redirect to /orders with download receipt option
```

### Flow 2: Zero-Retention On-Device Skin Tone & Colour Analysis

```mermaid
sequenceDiagram
    autonumber
    actor Customer as User
    participant Cam as Browser Media Stream
    participant Canvas as Client Canvas Engine
    participant Web as Skin Tone Analysis View
    participant DB as Backend Database

    Customer->>Web: Navigate to /skin-tone
    Web->>Customer: Display privacy guarantee ("No photos leave this device")
    Customer->>Cam: Grant camera permission OR select local selfie
    Cam-->>Canvas: Extract face oval region
    Canvas->>Canvas: Sample dominant skin luminance & CIELAB values (L*, a*, b*)
    Canvas->>Canvas: Compute undertone (Warm, Cool, Neutral, Olive)
    Canvas->>Canvas: Match 1 of 4 Seasonal Palettes (Deep Autumn, Warm Spring, Cool Summer, etc.)
    Canvas-->>Web: Render seasonal color swatches, lipstick shades, jewelry metal harmony
    Customer->>Web: Click "Save to Profile"
    Web->>DB: POST /api/colour-review (Send only calculated palette name & hex swatches)
    Web->>Customer: Dynamically filter catalogue to show 100% flattering garments
```

### Flow 3: Walkin Wardrobe Membership & Credit Redemption

```mermaid
sequenceDiagram
    autonumber
    actor Member as Subscriber
    participant Web as Membership Portal
    participant API as /api/membership
    participant RZP as Razorpay Subscription
    participant Cart as Store Cart Context

    Member->>Web: View /membership (₹1,799 / month - 4 credits/month)
    Member->>API: Initiate subscription checkout
    API->>RZP: Create subscription plan
    Member->>RZP: Authorize recurring monthly payment
    RZP-->>API: Subscription active webhook
    API-->>Web: Allocate 4 monthly credits to Member profile
    Member->>Web: Browse catalogue for eligible "Wardrobe" pieces
    Member->>Cart: Click "Claim with 1 Credit"
    Cart->>Web: Deduct 1 credit from balance, mark order for delivery
    Web->>Member: Free delivery dispatched with 30-day wear & return package
```

### Flow 4: Bespoke "Request This Piece" (One-of-One Sourcing)

```mermaid
sequenceDiagram
    autonumber
    actor Shopper as Customer
    participant Modal as RequestPieceModal
    participant API as /api/piece-requests
    participant Admin as Admin Ops (/admin)

    Shopper->>Modal: Open modal on sold-out or custom garment
    Shopper->>Modal: Submit desired measurements, custom fabric preference, date required
    Modal->>API: POST /api/piece-requests (Store request + customer contact)
    API-->>Modal: Success confirmation + Tracking reference
    Admin->>Admin: Review in "Piece Requests" Admin Tab (Filter: ALL, NEW, SOURCING, FULFILLED)
    Admin->>Shopper: Direct WhatsApp / Call consultation & custom quote
```

### Flow 5: 16-Module Administrative Operation Control

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Store Administrator
    participant SPA as Admin SPA (/admin)
    participant Ops as /api/admin/ops
    participant AI as OpenAI / Ollama Studio
    participant FS as Local Storage

    Admin->>SPA: Authenticate via OTP / Admin claim
    SPA->>Ops: GET /api/admin/ops?section=dashboard
    Ops-->>SPA: Return Live Revenue, Order volume, Sourcing alerts, Active members
    Admin->>SPA: Open "AI Listing Studio" (/admin)
    Admin->>AI: Input Category, Occasion, Tone ("Bespoke Velvet Blazer")
    AI-->>SPA: Generated luxury description, tags, care instructions
    Admin->>SPA: Video Reels Management: Upload customer reel
    SPA->>SPA: Validate video constraint (duration <= 30s, max 3 published reels)
    SPA->>FS: POST /api/upload (Stream to /public/uploads)
    Admin->>Ops: Save published reel to homepage feed
```

---

## 3. UI & UX Design Systems & Micro-Interactions

The storefront aesthetic follows an **editorial, high-fashion minimalism** (luxury beige/champagne, deep noir, gold accents, crisp serif titles, and subtle micro-interactions):

### Visual Identity Tokens

- **Typography**: Editorial display serif titles paired with high-legibility sans-serif bodies (Inter / Playfair Display / Cormorant Garamond).
- **Color Palette**:
  - Background Base: `#FBF9F5` (Warm Alabaster / Ivory)
  - Card & Container Surface: `#FFFFFF` / `rgba(255,255,255,0.85)` Glassmorphism
  - Luxury Noir Accent: `#1A1A1A`
  - Atelier Gold / Muted Brass: `#C29D59` / `#9E7D3B`
  - Subtle Borders: `rgba(0,0,0,0.06)`

### UX Micro-Interactions & Transitions

1. **Interactive Face Guide**: During webcam skin tone analysis, a dynamic oval silhouette tracks positioning and prompts lighting adjustments in real-time.
2. **Instant Toast System**: Custom floating feedback toast for bag additions, copy events, and error notifications without intrusive alert modals.
3. **Cart Drawer & Floating Badges**: Real-time counter on cart icon with smooth slide-in review drawer.
4. **Interactive Video Reels Carousel**: Native mobile-optimized short-form video player with audio toggles, duration restrictions, and product tagging.
5. **Dynamic Search & Filtering**: Instant faceted search on the catalogue without page reloads (Sort by Price, Category, One-of-One exclusivity filter, Seasonal Palette match).

---

## 4. Backend Services & API Architecture

The backend operates as an Express service featuring a custom dynamic module loader:

### Endpoint Mapping Reference

| Path                          | Methods                       | Access Level   | Description                                                                     |
| ----------------------------- | ----------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `/api/auth/start-login`     | `POST`                      | Public         | Passwordless OTP dispatch to customer email.                                    |
| `/api/auth/verify-code`     | `POST`                      | Public         | Validates OTP, issues signed JWT in HTTP-only cookie.                           |
| `/api/auth/session`         | `GET`                       | Public         | Returns current authenticated user state or null.                               |
| `/api/auth/signout`         | `POST`                      | Public         | Clears session cookie.                                                          |
| `/api/upload`               | `POST`                      | Public / Admin | Base64 and binary media upload saving to `/public/uploads`.                   |
| `/api/catalogue`            | `GET`                       | Public         | Paginated list of products, categories, and inventory tags.                     |
| `/api/product`              | `GET`                       | Public         | Returns individual product by slug with high-res gallery.                       |
| `/api/cart`                 | `GET`, `POST`             | User           | Syncs user cart contents across devices.                                        |
| `/api/checkout`             | `POST`                      | Public / User  | Verifies inventory, applies discounts, generates Razorpay order.                |
| `/api/payment-config`       | `GET`                       | Public         | Returns Razorpay merchant key ID to client.                                     |
| `/api/payment-verify`       | `POST`                      | Public / User  | HMAC SHA-256 signature verification and order commitment.                       |
| `/api/orders`               | `GET`, `POST`             | User           | Order history tracking, status checks, and PDF invoice records.                 |
| `/api/piece-requests`       | `GET`, `POST`             | Public / Admin | Custom garment creation and bespoke sourcing requests.                          |
| `/api/membership`           | `GET`, `POST`             | User           | Walkin Wardrobe subscription status, credit tier management.                    |
| `/api/colour-review`        | `POST`                      | User           | Persists user-selected seasonal palette to profile.                             |
| `/api/exchange`             | `POST`                      | User           | 7-day exchange or damage claim submission with photo evidence.                  |
| `/api/admin/dashboard`      | `GET`                       | Admin          | High-level metrics: revenue, orders, inventory depletion.                       |
| `/api/admin/ops`            | `GET`, `POST`, `DELETE` | Admin          | 16-module monolithic admin controller (drops, loyalty, sourcing, orders).       |
| `/api/admin/listing-studio` | `POST`                      | Admin          | AI copy generation endpoint calling OpenAI / local LLM.                         |
| `/sitemap.xml`              | `GET`                       | Public         | Dynamically generated SEO XML sitemap including all active products.            |
| `/robots.txt`               | `GET`                       | Public         | Environment-aware robots policy (Disallow all on dev/staging; indexed on prod). |

---

## 5. Database Schema & State Engineering

The application schema is version-controlled via SQL migrations (`001_initial.sql` through `012_piece_requests.sql`):

```mermaid
erDiagram
    PROFILES ||--o{ ORDERS : places
    PROFILES ||--o| MEMBERSHIPS : subscribes
    PROFILES ||--o{ PIECE_REQUESTS : submits
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : references
    CATEGORIES ||--o{ PRODUCTS : categorizes
    PRODUCTS ||--o{ INVENTORY_ITEMS : tracks
    ORDERS ||--o{ EXCHANGES : logs

    PROFILES {
        string auth_user_id PK
        string email
        string full_name
        boolean is_admin
        int wardrobe_credits
        string skin_undertone
        string seasonal_palette
    }

    PRODUCTS {
        uuid id PK
        string title
        string slug
        numeric price
        numeric compare_at_price
        boolean is_one_of_one
        boolean is_active
        string category_id FK
        jsonb images
        jsonb colour_tags
    }

    ORDERS {
        uuid id PK
        string profile_id FK
        numeric subtotal
        numeric tax_gst
        numeric shipping_fee
        numeric total_amount
        string payment_status
        string fulfillment_status
        string razorpay_payment_id
        jsonb shipping_address
    }

    PIECE_REQUESTS {
        uuid id PK
        string customer_name
        string customer_email
        string customer_phone
        string product_title
        string preferred_size
        string notes
        string status
        timestamp created_at
    }

    MEMBERSHIPS {
        uuid id PK
        string profile_id FK
        string status
        int monthly_credits
        timestamp renewal_date
        string razorpay_sub_id
    }
```

---

## 6. Comprehensive Implementation Checklist (Done vs. In Progress)

### A. Storefront & Customer Experience (UI/UX)

- [X] **Responsive Luxury Landing Page** (`/`):
  - [X] Hero carousel with brand statement and editorial photography.
  - [X] Curated "The Edit" section highlighting one-of-one pieces.
  - [X] Customer Video Reels carousel with duration checks.
  - [X] Brand story & Bangalore atelier craftsmanship section.
- [X] **Product Catalogue** (`/catalogue`):
  - [X] Multi-criteria filtering (Category, Price range, In-stock exclusivity).
  - [X] Colour Harmony filter (syncs with user's skin tone analysis).
  - [X] Instant responsive product card hover states and badges.
- [X] **Product Detail Experience** (`/product/:slug`):
  - [X] Interactive high-res photo gallery with thumbnail selector.
  - [X] One-of-one rarity notification badge (Prevents duplicate additions).
  - [X] Size selection matrix with bespoke measurement guide.
  - [X] "Bespoke Request" trigger modal when size/item is claimed.
- [X] **Shopping Bag** (`/cart`):
  - [X] Item quantity management & instant total calculations.
  - [X] Complimentary Bangalore studio pickup vs. ₹99 standard shipping rules.
  - [X] Credit redemption toggle for Walkin Wardrobe members.
- [X] **Checkout & Invoicing** (`/checkout`):
  - [X] Complete address capture form with pin-code detection.
  - [X] Optional GSTIN field for business invoicing compliance.
  - [X] Real-time subtotal, GST (12% / 18% fashion tax), and shipping compute.
- [X] **Customer Account Portal** (`/account` & `/orders`):
  - [X] Passwordless OTP login/signup workflow.
  - [X] Order history listing with status chips (`Paid`, `Processing`, `Dispatched`, `Delivered`).
  - [X] Self-service 7-day exchange and damage claim submission modal.
  - [X] Saved skin tone palette review and re-analysis shortcut.

---

### B. Proprietary Fashion Features

- [X] **On-Device Skin Tone Analysis Engine** (`/skin-tone`):
  - [X] Webcam live stream with facial oval positioning guide.
  - [X] Client-side photo upload alternative.
  - [X] Zero raw image transmission (Local Canvas RGB/CIELAB sampling).
  - [X] Identification of undertone (Warm, Cool, Neutral, Olive).
  - [X] 4-Season colour harmony classification with curated garment suggestions.
  - [X] One-click "Save to My Profile" sync.
- [X] **Walkin Wardrobe Membership** (`/membership`):
  - [X] Membership tier presentation (₹1,799 / month - 4 wardrobe rotation credits).
  - [X] Roll-over policy documentation & FAQ accordion.
  - [X] Subscription order creation via Razorpay.
- [X] **Bespoke Piece Requests** (`/api/piece-requests` & Modal):
  - [X] Customer measurement and fabric preference modal.
  - [X] Admin triage board with status management (`NEW`, `CONTACTED`, `SOURCING`, `FULFILLED`).

---

### C. Backend Architecture & Operations

- [X] **Authentication Engine**:
  - [X] Passwordless 6-digit OTP generation and validation.
  - [X] JWT token generation stored in secure `HTTP-only` cookies.
  - [X] Role-Based Access Control (`public`, `user`, `admin`).
- [X] **Payment Processing Engine**:
  - [X] Razorpay Order Creation endpoint (`/api/checkout`).
  - [X] Server-side HMAC SHA-256 signature verification (`/api/payment-verify`).
  - [X] Automated order persistence upon successful payment.
- [X] **16-Module Admin Operations Center** (`/admin`):
  - [X] Module 1: Executive Dashboard (Real-time revenue, order stats, sourcing alerts).
  - [X] Module 2: Products Manager (Full CRUD, one-of-one toggles, price updates).
  - [X] Module 3: Category Management.
  - [X] Module 4: AI Listing Studio (OpenAI / Ollama fashion description generator).
  - [X] Module 5: Order Dispatch & Fulfillment Management.
  - [X] Module 6: Piece Requests Board.
  - [X] Module 7: Customer Directory.
  - [X] Module 8: Walkin Wardrobe Membership Monitor.
  - [X] Module 9: Credit Balances & Adjustments.
  - [X] Module 10: Exchanges & Return Inspections.
  - [X] Module 11: Offers & Loyalty Codes.
  - [X] Module 12: Timed Product Drops.
  - [X] Module 13: Vintage Sourcing Pipeline.
  - [X] Module 14: In-Store POS & Studio Pickup Mode.
  - [X] Module 15: Content & Video Reels Manager (Enforcing $\le 30$s duration and max 3 active reels).
  - [X] Module 16: Audit Logs & Tax Invoices.
- [X] **SEO & Indexing Infrastructure**:
  - [X] Environment-aware `/robots.txt`.
  - [X] Dynamic `/sitemap.xml` with active catalogue slug crawling.
  - [X] Head metadata and structured schema support across pages.

---

### D. Ongoing Enhancements & Roadmap (Planned / Next Iteration)

- [ ] **Automated WhatsApp Business Notification API**: Webhook notification to customers upon order dispatch and tracking updates.
- [ ] **Automated PDF Invoice Generator**: Native server-side PDF invoice download attachment generation in customer `/orders`.
- [ ] **High-Resolution Multi-Angle 3D Virtual Try-On**: Integration of WebGL / Three.js 3D draping preview for custom garments.

---

## 7. Security, Performance & Privacy Guarantees

1. **Biometric Privacy Guarantee**:
   The camera video stream and image files used in `/skin-tone` are processed purely inside browser memory via Canvas API. No biometric or photographic data is ever serialized or transmitted across the network.
2. **Session Security**:
   Tokens are stored in `vishrea_auth` cookies with `HttpOnly`, `SameSite=Lax`, and `Secure` (in production), preventing XSS token exfiltration.
3. **Payment Integrity**:
   Direct order capture and inventory decrementing are protected by HMAC SHA-256 cryptographic signature verification. Spoofed or aborted client-side events cannot mark orders as paid.
4. **Asset Optimization**:
   Production builds use Vite tree-shaking with split chunks for vendor and application code, guaranteeing fast initial loads.

---

## 8. Runbook & Deployment Guide

### Environment Variables (`.env`)

```bash
PORT=3000
NODE_ENV=production
JWT_SECRET=your_super_secret_jwt_key_at_least_32_chars
DATABASE_URL=postgresql://user:password@localhost:5432/vishrea
DATABASE_SSL=false
DEFAULT_ADMIN_EMAIL=admin@vishrea.com
RAZORPAY_KEY_ID=rzp_live_xxxxxx
RAZORPAY_KEY_SECRET=xxxxxx
RAZORPAY_MEMBERSHIP_PLAN_ID=plan_xxxxxx
OPENAI_API_KEY=sk-xxxxxx
AI_MODEL=gpt-4o-mini
```

### Quick Commands

#### Start Full Stack in Production Mode:

```bash
# Windows
.\start.ps1

# Linux / macOS
chmod +x start.sh && ./start.sh
```

#### Manual Compilation & Migration:

```bash
# 1. Install root dependencies
npm install

# 2. Run migrations
npm run migrate

# 3. Build React production bundle
npm run build

# 4. Start Server
npm run start
```
