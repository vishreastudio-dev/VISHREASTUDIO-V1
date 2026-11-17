import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestBatchId,
  calculateCostPerUnit,
  calculateStockLeft,
  calculateStockValue,
  classifyInventory,
  calculateLineAmount,
  calculateSaleTotals,
  calculateCustomerLoyalty,
  calculatePurchaseOrderTotals,
  calculateRetentionRate,
} from '../lib/business-calculations.js';

test('suggestBatchId generates consistent prefix, yearmonth and format', () => {
  const batch1 = suggestBatchId('Silk Heritage', '2026-11-17');
  assert.match(batch1, /^SILK-202611-\d{2}$/);

  const batchFallback = suggestBatchId('', '2026-05-10');
  assert.match(batchFallback, /^BCH-202605-\d{2}$/);
});

test('calculateCostPerUnit distributes courier charge across purchased pieces', () => {
  // 10 pieces at 500 purchase price + 200 courier = 500 + 20 = 520
  const cost = calculateCostPerUnit(500, 200, 10);
  assert.equal(cost, 520);

  // Edge case: 0 pieces falls back to purchase price without dividing by zero
  const costZero = calculateCostPerUnit(750, 100, 0);
  assert.equal(costZero, 750);
});

test('calculateStockLeft never displays negative stock', () => {
  assert.equal(calculateStockLeft(10, 3), 7);
  assert.equal(calculateStockLeft(5, 5), 0);
  assert.equal(calculateStockLeft(5, 8), 0); // never negative
});

test('calculateStockValue is stock remaining multiplied by landed unit cost', () => {
  assert.equal(calculateStockValue(7, 520), 3640);
  assert.equal(calculateStockValue(0, 520), 0);
});

test('classifyInventory respects strict priority: Low stock > Fast moving > Dead stock', () => {
  // 1. Low stock priority over fast moving:
  // Purchased 10, sold 9 (> 50% sold). Stock left = 1 <= threshold 2. Must be low_stock!
  assert.equal(classifyInventory(1, 2, 10, 9), 'low_stock');

  // 2. Fast moving: purchased 10, sold 6 (> 50% sold), stock left = 4 > threshold 2
  assert.equal(classifyInventory(4, 2, 10, 6), 'fast_moving');

  // 3. Dead stock: purchased 10, sold 0, stock left = 10 > threshold 2
  assert.equal(classifyInventory(10, 2, 10, 0), 'dead_stock');

  // 4. Normal stock: purchased 10, sold 3 (<= 50% sold), stock left = 7 > threshold 2
  assert.equal(classifyInventory(7, 2, 10, 3), 'normal');
});

test('calculateSaleTotals computes subtotal, bounds discount, checks amounts due and profit', () => {
  const items = [
    { quantity: 2, unit_price: 1000, cost_price_inr: 400 }, // subtotal 2000, cost 800
    { quantity: 1, unit_price: 500, cost_price_inr: 200 },  // subtotal 500, cost 200
  ];

  // Total subtotal: 2500, Total cost: 1000
  // Discount: 500 -> Final: 2000. Amount paid: 2000 -> Due: 0, Status: paid
  // Estimated Profit: 2000 - 1000 = 1000
  const salePaid = calculateSaleTotals(items, 500, 2000);
  assert.equal(salePaid.subtotal, 2500);
  assert.equal(salePaid.discount, 500);
  assert.equal(salePaid.finalAmount, 2000);
  assert.equal(salePaid.amountPaid, 2000);
  assert.equal(salePaid.amountDue, 0);
  assert.equal(salePaid.estimatedCost, 1000);
  assert.equal(salePaid.estimatedProfit, 1000);
  assert.equal(salePaid.paymentStatus, 'paid');

  // Partial payment: paid 1200 -> Due: 800, Status: partially_paid
  const salePartial = calculateSaleTotals(items, 500, 1200);
  assert.equal(salePartial.amountPaid, 1200);
  assert.equal(salePartial.amountDue, 800);
  assert.equal(salePartial.paymentStatus, 'partially_paid');

  // No payment: paid 0 -> Due: 2000, Status: due
  const saleDue = calculateSaleTotals(items, 500, 0);
  assert.equal(saleDue.amountPaid, 0);
  assert.equal(saleDue.amountDue, 2000);
  assert.equal(saleDue.paymentStatus, 'due');

  // Boundary condition: Discount > subtotal is capped at subtotal
  const saleDiscountCapped = calculateSaleTotals(items, 3000, 0);
  assert.equal(saleDiscountCapped.discount, 2500);
  assert.equal(saleDiscountCapped.finalAmount, 0);
  assert.equal(saleDiscountCapped.paymentStatus, 'paid');

  // Boundary condition: Negative discount or paid sanitized
  const saleNegative = calculateSaleTotals(items, -100, -50);
  assert.equal(saleNegative.discount, 0);
  assert.equal(saleNegative.amountPaid, 0);
});

test('calculateCustomerLoyalty tracks 6-purchase cycle and reward eligibility at stamp 5', () => {
  // 0 purchases
  const l0 = calculateCustomerLoyalty(0);
  assert.equal(l0.currentStamp, 0);
  assert.equal(l0.completedCycles, 0);
  assert.equal(l0.isRewardEligible, false);
  assert.equal(l0.stampsUntilReward, 5);

  // 4 purchases: stamp 4, not eligible
  const l4 = calculateCustomerLoyalty(4);
  assert.equal(l4.currentStamp, 4);
  assert.equal(l4.isRewardEligible, false);
  assert.equal(l4.stampsUntilReward, 1);

  // 5 purchases: stamp 5 -> ELIGIBLE FOR 50% REWARD!
  const l5 = calculateCustomerLoyalty(5);
  assert.equal(l5.currentStamp, 5);
  assert.equal(l5.isRewardEligible, true);
  assert.equal(l5.stampsUntilReward, 0);

  // 6 purchases: 6th purchase completed -> resets cycle!
  const l6 = calculateCustomerLoyalty(6);
  assert.equal(l6.currentStamp, 0);
  assert.equal(l6.completedCycles, 1);
  assert.equal(l6.isRewardEligible, false);
  assert.equal(l6.stampsUntilReward, 5);

  // 11 purchases: 2nd cycle stamp 5 -> ELIGIBLE AGAIN!
  const l11 = calculateCustomerLoyalty(11);
  assert.equal(l11.currentStamp, 5);
  assert.equal(l11.completedCycles, 1);
  assert.equal(l11.isRewardEligible, true);
});

test('calculatePurchaseOrderTotals calculates lines, subtotal, and freight allocation', () => {
  const items = [
    { item_name: 'Silk Saree', quantity: 10, unit_cost: 1500 }, // 15000
    { item_name: 'Cotton Kurta', quantity: 20, unit_cost: 500 }, // 10000
  ];
  // Total qty: 30. Subtotal: 25000. Courier: 300 (10/unit). Grand total: 25300.
  const po = calculatePurchaseOrderTotals(items, 300);
  assert.equal(po.totalQuantity, 30);
  assert.equal(po.subtotal, 25000);
  assert.equal(po.courierCharges, 300);
  assert.equal(po.grandTotal, 25300);
  assert.equal(po.freightPerUnit, 10);
  assert.equal(po.items[0].landed_cost_per_unit, 1510);
  assert.equal(po.items[1].landed_cost_per_unit, 510);
});

test('calculateRetentionRate calculates repeat customer percentage', () => {
  assert.equal(calculateRetentionRate(25, 100), 25.0);
  assert.equal(calculateRetentionRate(1, 3), 33.3);
  assert.equal(calculateRetentionRate(0, 0), 0);
});
