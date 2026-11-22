# VISHREA STUDIO — End-to-End User Journey Report

**Auditor:** Senior E2E Test Architect & Functional QA Engineer  
**Date:** November 22, 2026  
**Scope:** Real Business Workflows across Customer, Member, Gifting, and Admin Portals.

---

## 1. Journey 1: Customer Retail Purchase Flow

```
[ Homepage ] ──> [ Category / Catalogue ] ──> [ Product Detail ] ──> [ Size Selection ]
      │
      ▼
[ Add to Bag ] ──> [ Bag Review ] ──> [ Authentication / Login ] ──> [ Checkout ]
      │
      ▼
[ Razorpay Sandbox ] ──> [ Signature Verification ] ──> [ Order Confirmation ] ──> [ Order History ]
```

### Steps Verified
1. **Discovery & Browsing**: User visits `/` or `/catalogue/dresses`. High-resolution product cards render with price and stock availability.
2. **Product Detail Page**: User selects size `M`. Stock status is confirmed available. Price displays inclusive of GST ($₹1,850$).
3. **Cart Assembly**: User clicks "Add to Bag". Guest cart updates locally (`cartCount = 1`). Toast notification confirms addition.
4. **Authentication Gate**: User navigates to `/cart` and clicks "Proceed to Checkout". Unauthenticated user is smoothly redirected to `/login?next=/checkout`.
5. **OTP Authentication**: User enters email, receives 6-digit code, verifies, and is redirected back to `/checkout` with active session.
6. **Delivery Details**: User enters recipient name, phone, line1, city, state, and pincode.
7. **Order Creation**: Client calls `POST /api/checkout`. Server reserves inventory in `inventory_reservations`, calculates GST breakdown (CGST + SGST for Karnataka, IGST for interstate), and creates order in state `pending`.
8. **Payment Gateway**: Razorpay order generated with amount in paise.
9. **Payment Verification**: Client submits `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to `POST /api/payment-verify`. Server verifies HMAC-SHA256 signature, updates order to `paid`, captures payment, and transitions stock.
10. **Order History**: User views `/orders` and `/orders/:id`. The order renders with order number (`ORD-YYYY-XXX`), payment status `paid`, and active delivery tracker stepper.

---

## 2. Journey 2: Walkin Wardrobe Membership Flow

```
[ /membership ] ──> [ Select Plan: ₹1,799/mo ] ──> [ Mandate / Upfront Checkout ]
      │
      ▼
[ Razorpay Gateway ] ──> [ Payment Verification ] ──> [ Membership Activation ]
      │
      ▼
[ Initial 2 Credits Issued ] ──> [ Account Membership Hub ] ──> [ 48hr Early Access Enabled ]
```

### Steps Verified
1. **Plan Selection**: Customer selects the Walkin Wardrobe 2-piece membership plan ($₹1,799/\text{month}$).
2. **Billing Terms**: Customer reviews transparent upfront terms ($₹3,598$ upfront covering months 1 & 2, followed by recurring billing from month 3).
3. **Payment & Activation**: Order processed via Razorpay. Backend atomically creates a row in `memberships` with status `active` and generates unique `membership_code`.
4. **Credit Allocation**: Initial 2 wardrobe credits are inserted into `credit_ledger` with `expires_at = now() + interval '60 days'`.
5. **Storefront Entitlements**: Customer gains immediate 48-hour early access to new studio drops (`hasEarlyAccess` returns true in catalogue and search).

---

## 3. Journey 3: Wardrobe Bag Credit Redemption Flow

```
[ Eligible Wardrobe Piece ] ──> [ Select Active Size Profile ] ──> [ Redeem Credit ]
      │
      ▼
[ Bag Shipment Created ] ──> [ Shipping Fee Payment (₹99 or Free at 4+ pieces) ]
      │
      ▼
[ FIFO Credit Deducted ] ──> [ Courier Partner Assigned ] ──> [ Tracked Dispatch ]
```

### Steps Verified
1. **Piece Eligibility Check**: Customer selects an eligible piece from `/catalogue` or `/wardrobe`. System checks `isCreditEligible()` and verifies piece is not in the excluded `Premium` collection.
2. **Profile Attachment**: Customer attaches recipient size profile to the piece.
3. **Credit Deduction**: FIFO credit deduction occurs: `INSERT INTO credit_ledger (delta: -1, reason: 'redemption')`.
4. **Shipment Assembly**: Order created in `bag_shipments`. If 4 or more pieces are claimed, shipping fee is waived (₹0); otherwise ₹99 delivery fee applies.
5. **Order Tracking**: Order tracker visualizes courier assignment and tracking link.

---

## 4. Journey 4: Admin Product & Catalogue Flow

```
[ Admin Login ] ──> [ Admin Products Section ] ──> [ "Create Product" Modal ]
      │
      ▼
[ Enter Name, Slug, Category, Price ] ──> [ Configure Variants (XS–XXL, Stock) ]
      │
      ▼
[ Upload High-Res Media ] ──> [ Publish Piece ] ──> [ Storefront Verification ]
```

### Steps Verified
1. **Admin Authorization**: Administrator signs in; backend verifies role and allowlist, opening `/admin`.
2. **Product Creation**: Admin opens Create Product modal drawer, enters name, description, retail price, and category.
3. **Variant Matrix**: Admin configures sizes (XS, S, M, L, XL, XXL) with initial inventory counts.
4. **Media Upload**: Images uploaded via `POST /api/upload`. Server sniffs binary headers, verifies PNG/JPEG/WEBP formats, and stores reference.
5. **Publish**: Admin sets `is_active = true`. Piece appears immediately on storefront `/catalogue` and in search suggestions.

---

## 5. Journey 5: Inventory & Restock Reconciliation Flow

```
[ Sourcing Batch Created ] ──> [ PO Line Items Added ] ──> [ Freight Allocation ]
      │
      ▼
[ Landed Cost Calculated ] ──> [ Stock Inwarded to Inventory ]
      │
      ▼
[ Customer Order Placed ] ──> [ Stock Reserved ] ──> [ Payment Success -> Stock Deducted ]
      │
      ▼
[ (If Cancelled / Expired) -> Stock Restored Automatically ]
```

### Steps Verified
1. **Batch & PO Creation**: Admin records purchase order with line costs and courier freight. System calculates landed unit cost.
2. **Stock Inwarding**: Inventory count increments atomically.
3. **Checkout Reservation**: Customer cart checkout creates `inventory_reservations` row with 15-minute TTL.
4. **Expiry Sweeper**: If customer abandons payment, `sweepExpiredOrders()` runs, releases reservation, and restores available stock.
5. **Sold-Out Handling**: When last unit is bought, product card instantly displays "SOLD OUT" badge and disables Add to Bag on PDP.

---

## 6. End-to-End Audit Conclusion

All 5 core real-world business workflows were executed against actual application endpoints and database models. Data consistency, transaction atomicity, inventory locking, and status transitions passed without discrepancies.
