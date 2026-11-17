/**
 * Frontend Business Calculations & Rules Library for Vishrea Studio
 * Mirrors backend calculation logic with 100% precision.
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

export function calculateCostPerUnit(purchasePricePerPiece = 0, courierCharge = 0, purchaseQuantity = 0) {
  const price = Math.max(0, Number(purchasePricePerPiece) || 0);
  const courier = Math.max(0, Number(courierCharge) || 0);
  const qty = Math.max(0, Number(purchaseQuantity) || 0);
  
  if (qty <= 0) return Math.round(price * 100) / 100;
  const unitCourier = courier / qty;
  return Math.round((price + unitCourier) * 100) / 100;
}

export function calculateStockLeft(purchaseQuantity = 0, unitsSold = 0) {
  const purchased = Math.max(0, Number(purchaseQuantity) || 0);
  const sold = Math.max(0, Number(unitsSold) || 0);
  return Math.max(0, purchased - sold);
}

export function calculateStockValue(stockLeft = 0, costPerUnit = 0) {
  const stock = Math.max(0, Number(stockLeft) || 0);
  const cost = Math.max(0, Number(costPerUnit) || 0);
  return Math.round(stock * cost * 100) / 100;
}

export function classifyInventory(stockLeft = 0, lowStockThreshold = 2, purchaseQuantity = 0, unitsSold = 0) {
  const stock = Math.max(0, Number(stockLeft) || 0);
  const threshold = Math.max(0, Number(lowStockThreshold) || 2);
  const purchased = Math.max(0, Number(purchaseQuantity) || 0);
  const sold = Math.max(0, Number(unitsSold) || 0);

  if (stock <= threshold) {
    return 'low_stock';
  }
  if (purchased > 0 && sold > (purchased * 0.5)) {
    return 'fast_moving';
  }
  if (purchased > 0 && sold === 0) {
    return 'dead_stock';
  }
  return 'normal';
}

export function calculateLineAmount(quantity = 1, saleRate = 0) {
  const qty = Math.max(0, Number(quantity) || 0);
  const rate = Math.max(0, Number(saleRate) || 0);
  return Math.round(qty * rate * 100) / 100;
}

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

  const discountInput = Math.max(0, Number(rawDiscount) || 0);
  const discount = Math.min(subtotal, discountInput);
  const finalAmount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  const paidInput = Math.max(0, Number(rawAmountPaid) || 0);
  const amountPaid = Math.min(finalAmount, paidInput);
  const amountDue = Math.max(0, Math.round((finalAmount - amountPaid) * 100) / 100);

  const estimatedProfit = Math.round((finalAmount - estimatedCost) * 100) / 100;

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

export function calculateCustomerLoyalty(lifetimePaidOrdersCount = 0) {
  const n = Math.max(0, Math.floor(Number(lifetimePaidOrdersCount) || 0));
  const completedCycles = Math.floor(n / 6);
  const currentStamp = n % 6; // 0 to 5
  const isRewardEligible = currentStamp === 5;
  const stampsUntilReward = isRewardEligible ? 0 : (5 - currentStamp);

  return {
    lifetimeOrders: n,
    completedCycles,
    currentStamp,
    isRewardEligible,
    stampsUntilReward,
    cycleNumber: completedCycles + 1,
  };
}

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
