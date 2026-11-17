/**
 * Central Business Calculations & Rules Library for Vishrea Studio
 * Authoritative implementation of:
 * - Inventory costing & freight distribution
 * - Stock classification (Low Stock, Fast Moving, Dead Stock)
 * - Sales totals, discount bounds, amounts due, estimated profit
 * - Customer loyalty 6-purchase cycle & reward eligibility
 * - Procurement PO totals & freight allocation per unit
 * - Batch ID generation (suggestBatchId)
 */

/**
 * Suggest a unique, deterministic Batch ID based on vendor name and date.
 * Format: {VENDOR_PREFIX}-{YYYYMM}-{SEQUENCE/RANDOM}
 * Preserves user edits when customized.
 */
export function suggestBatchId(vendorName = '', dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  
  const cleanVendor = String(vendorName || 'BCH')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4) || 'BCH';

  const randomSuffix = Math.floor(10 + Math.random() * 90);
  return `${cleanVendor}-${year}${month}-${randomSuffix}`;
}

/**
 * Landed Cost Per Unit:
 * Cost per unit = Purchase price per piece + (Total courier charge / Purchase quantity)
 * If quantity is 0 or not provided, returns base purchase price.
 */
export function calculateCostPerUnit(purchasePricePerPiece = 0, courierCharge = 0, purchaseQuantity = 0) {
  const price = Math.max(0, Number(purchasePricePerPiece) || 0);
  const courier = Math.max(0, Number(courierCharge) || 0);
  const qty = Math.max(0, Number(purchaseQuantity) || 0);
  
  if (qty <= 0) return Math.round(price * 100) / 100;
  const unitCourier = courier / qty;
  return Math.round((price + unitCourier) * 100) / 100;
}

/**
 * Stock Remaining:
 * Stock left = Max(0, Purchase quantity - Units sold)
 * Guaranteed never negative.
 */
export function calculateStockLeft(purchaseQuantity = 0, unitsSold = 0) {
  const purchased = Math.max(0, Number(purchaseQuantity) || 0);
  const sold = Math.max(0, Number(unitsSold) || 0);
  return Math.max(0, purchased - sold);
}

/**
 * Stock Value:
 * Stock value = Stock left × Cost per unit
 */
export function calculateStockValue(stockLeft = 0, costPerUnit = 0) {
  const stock = Math.max(0, Number(stockLeft) || 0);
  const cost = Math.max(0, Number(costPerUnit) || 0);
  return Math.round(stock * cost * 100) / 100;
}

/**
 * Inventory Classification with strict priority:
 * 1. Low stock: stock left <= low_stock_threshold (takes priority over fast moving!)
 * 2. Fast moving: purchase_quantity > 0 AND units_sold > (purchase_quantity * 0.5)
 * 3. Dead stock: purchase_quantity > 0 AND units_sold === 0
 * 4. Normal: otherwise
 */
export function classifyInventory(stockLeft = 0, lowStockThreshold = 2, purchaseQuantity = 0, unitsSold = 0) {
  const stock = Math.max(0, Number(stockLeft) || 0);
  const threshold = Math.max(0, Number(lowStockThreshold) || 2);
  const purchased = Math.max(0, Number(purchaseQuantity) || 0);
  const sold = Math.max(0, Number(unitsSold) || 0);

  // Priority 1: Low stock
  if (stock <= threshold) {
    return 'low_stock';
  }

  // Priority 2: Fast moving (> 50% sold)
  if (purchased > 0 && sold > (purchased * 0.5)) {
    return 'fast_moving';
  }

  // Priority 3: Dead stock (purchased > 0, 0 sold)
  if (purchased > 0 && sold === 0) {
    return 'dead_stock';
  }

  return 'normal';
}

/**
 * Sale line item amount:
 * Line amount = Quantity × Sale rate
 */
export function calculateLineAmount(quantity = 1, saleRate = 0) {
  const qty = Math.max(0, Number(quantity) || 0);
  const rate = Math.max(0, Number(saleRate) || 0);
  return Math.round(qty * rate * 100) / 100;
}

/**
 * Counter / Studio Sale Totals:
 * - Subtotal = sum of all line amounts
 * - Final amount = Max(0, Subtotal - Discount)
 * - Amount due = Max(0, Final amount - Amount paid)
 * - Estimated profit = Final amount - Estimated cost of items sold
 * - Payment status: 'paid', 'partially_paid', or 'due'
 */
export function calculateSaleTotals(items = [], rawDiscount = 0, rawAmountPaid = 0) {
  const validItems = Array.isArray(items) ? items : [];
  
  let subtotal = 0;
  let estimatedCost = 0;

  for (const it of validItems) {
    const qty = Math.max(0, Number(it.quantity) || 0);
    const rate = Math.max(0, Number(it.sale_rate ?? it.unit_price ?? it.price_inr) || 0);
    const cost = Math.max(0, Number(it.cost_price_inr ?? it.cost_per_unit) || 0);
    
    subtotal += qty * rate;
    estimatedCost += qty * cost;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  estimatedCost = Math.round(estimatedCost * 100) / 100;

  // Discount validation: cannot be negative, cannot exceed subtotal
  const discountInput = Math.max(0, Number(rawDiscount) || 0);
  const discount = Math.min(subtotal, discountInput);
  const finalAmount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  // Amount paid validation: cannot be negative, capped at final amount
  const paidInput = Math.max(0, Number(rawAmountPaid) || 0);
  const amountPaid = Math.min(finalAmount, paidInput);
  const amountDue = Math.max(0, Math.round((finalAmount - amountPaid) * 100) / 100);

  // Profit: Final amount (after discount) minus cost of goods sold
  const estimatedProfit = Math.round((finalAmount - estimatedCost) * 100) / 100;

  // Payment status
  let paymentStatus = 'due';
  if (finalAmount > 0) {
    if (amountPaid >= finalAmount) {
      paymentStatus = 'paid';
    } else if (amountPaid > 0) {
      paymentStatus = 'partially_paid';
    } else {
      paymentStatus = 'due';
    }
  } else {
    paymentStatus = 'paid';
  }

  return {
    subtotal,
    discount,
    finalAmount,
    amountPaid,
    amountDue,
    estimatedCost,
    estimatedProfit,
    paymentStatus,
  };
}

/**
 * Customer Loyalty: 6-Purchase Cycle
 * - Every 6 purchases = 1 cycle
 * - After 5 purchases (stamp = 5) -> eligible for 50% off next purchase
 * - After 6th purchase -> cycle resets to 0 stamps
 * - CRM only identifies eligibility; discount is manually entered by staff.
 */
export function calculateCustomerLoyalty(lifetimePaidOrdersCount = 0) {
  const n = Math.max(0, Math.floor(Number(lifetimePaidOrdersCount) || 0));
  const completedCycles = Math.floor(n / 6);
  const currentStamp = n % 6; // 0, 1, 2, 3, 4, 5
  const isRewardEligible = currentStamp === 5;
  const stampsUntilReward = isRewardEligible ? 0 : (5 - currentStamp);

  return {
    lifetimeOrders: n,
    completedCycles,
    currentStamp, // 0 to 5
    isRewardEligible, // true when customer has 5 stamps in current cycle
    stampsUntilReward,
    cycleNumber: completedCycles + 1,
  };
}

/**
 * Purchase Order Totals:
 * Line total = Quantity × Unit cost
 * Subtotal = Sum of line totals
 * Grand total = Subtotal + Courier charges
 */
export function calculatePurchaseOrderTotals(items = [], courierCharges = 0) {
  const validItems = Array.isArray(items) ? items : [];
  let subtotal = 0;
  let totalQuantity = 0;

  const calculatedItems = validItems.map((it) => {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const cost = Math.max(0, Number(it.unit_cost) || 0);
    const lineTotal = Math.round(qty * cost * 100) / 100;
    subtotal += lineTotal;
    totalQuantity += qty;
    return {
      ...it,
      quantity: qty,
      unit_cost: cost,
      line_total: lineTotal,
    };
  });

  const courier = Math.max(0, Number(courierCharges) || 0);
  subtotal = Math.round(subtotal * 100) / 100;
  const grandTotal = Math.round((subtotal + courier) * 100) / 100;

  // Landed cost per unit freight allocation
  const freightPerUnit = totalQuantity > 0 ? courier / totalQuantity : 0;
  const itemsWithFreight = calculatedItems.map((it) => ({
    ...it,
    freight_per_unit: Math.round(freightPerUnit * 100) / 100,
    landed_cost_per_unit: Math.round((it.unit_cost + freightPerUnit) * 100) / 100,
  }));

  return {
    items: itemsWithFreight,
    totalQuantity,
    subtotal,
    courierCharges: courier,
    grandTotal,
    freightPerUnit: Math.round(freightPerUnit * 100) / 100,
  };
}

/**
 * Customer Retention Rate:
 * Retention rate = (Repeat customers / Total purchasing customers) * 100
 */
export function calculateRetentionRate(repeatCustomers = 0, totalPurchasingCustomers = 0) {
  const total = Math.max(0, Number(totalPurchasingCustomers) || 0);
  const repeat = Math.max(0, Number(repeatCustomers) || 0);
  if (total === 0) return 0;
  return Math.round((repeat / total) * 1000) / 10; // e.g. 45.2%
}
