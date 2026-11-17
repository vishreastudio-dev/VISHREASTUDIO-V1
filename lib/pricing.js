// Single source of truth for every amount the platform charges.
// Catalogue prices are GST-inclusive (Indian B2C retail); tax is extracted, never added.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const toPaise = (inr) => Math.round(round2(inr) * 100);

const norm = (s) => String(s || '').trim().toLowerCase();

/** Effective selling price of one variant unit. */
export function calculateProductPrice(variant) {
  const base = Number(variant?.price_inr);
  if (!Number.isFinite(base) || base < 0) return null;
  const sale = variant?.sale_price_inr;
  if (sale !== null && sale !== undefined && Number.isFinite(Number(sale)) && Number(sale) >= 0 && Number(sale) < base) {
    return round2(Number(sale));
  }
  return round2(base);
}

/** GST slab for apparel by per-piece transaction value. */
export function gstRateFor(unitPrice, settings) {
  return Number(unitPrice) <= Number(settings.gst_threshold) ? Number(settings.gst_rate_low) : Number(settings.gst_rate_high);
}

/** Split a GST-inclusive amount into taxable value and tax. */
export function extractTax(inclusiveAmount, ratePercent) {
  const gross = round2(inclusiveAmount);
  if (!gross || !ratePercent) return { taxable: gross, tax: 0 };
  const taxable = round2(gross / (1 + ratePercent / 100));
  return { taxable, tax: round2(gross - taxable) };
}

/** Credit and free-piece eligibility: Premium pieces are always excluded; the product flag can exclude more. */
export function isCreditEligible(line) {
  if (line.credit_eligible === false) return false;
  return !norm(line.badge).includes('premium');
}

/**
 * Shipping charge. Studio pickup is free; members redeeming enough credits ship free.
 */
export function calculateShipping({ method, creditCount = 0, membershipActive = false, hasPhysicalItems = true, settings }) {
  // 'bag' holds credit picks in the Wardrobe Bag; shipping is charged when the bag ships (bagShipmentFee).
  if (!hasPhysicalItems || method === 'pickup' || method === 'bag') return 0;
  if (membershipActive && creditCount >= Number(settings.free_member_credits_to_ship)) return 0;
  return round2(settings.shipping_fee);
}

/**
 * MEM-06 "Ship my bag": a shipment of `free_member_credits_to_ship` (4) or more credit picks is free,
 * a smaller one costs the flat shipping fee; studio pickup is free. GST is included in the fee.
 */
export function bagShipmentFee({ pieces, method, settings }) {
  const fee = method === 'pickup' || Number(pieces) >= Number(settings.free_member_credits_to_ship) ? 0 : round2(settings.shipping_fee);
  const { taxable, tax } = extractTax(fee, fee > 0 ? Number(settings.gst_rate_low) : 0);
  return { fee, taxable, tax, amount_paise: toPaise(fee) };
}

/**
 * Full order calculation from database rows. `lines` must come from the database:
 * [{ variant_id, product_id, name, sku, size_label, price_inr, sale_price_inr, quantity, use_credit, badge, hsn_code }]
 */
export function calculateCartPrice({ lines, method = 'delivery', gift = false, placeOfSupply, membership, settings, orderCount = 0 }) {
  const sellerState = settings.seller_state;
  const pos = placeOfSupply || sellerState;
  const intraState = norm(pos) === norm(sellerState);
  const membershipActive = membership?.status === 'active';

  let subtotal = 0;
  let creditDiscount = 0;
  let rewardDiscount = 0;
  let creditsUsed = 0;
  let rewardsUsed = 0;
  let maxRate = 0;
  const priced = lines.map((l) => {
    const unit = calculateProductPrice(l);
    if (unit === null) throw Object.assign(new Error('invalid_price'), { code: 'invalid_price', line: l });
    const qty = Number(l.quantity);
    const lineTotal = round2(unit * qty);
    const useReward = Boolean(l.reward_entitlement_id);
    const useCredit = !useReward && Boolean(l.use_credit);
    const payable = useCredit || useReward ? 0 : lineTotal;
    const rate = gstRateFor(unit, settings);
    const { taxable, tax } = extractTax(payable, rate);
    subtotal += lineTotal;
    if (useReward) {
      rewardDiscount += lineTotal;
      rewardsUsed += 1;
    } else if (useCredit) {
      creditDiscount += lineTotal;
      creditsUsed += qty;
    } else if (rate > maxRate) {
      maxRate = rate;
    }
    return { ...l, use_credit: useCredit, unit_price: unit, quantity: qty, line_total: lineTotal, payable_total: payable, gst_rate: rate, taxable_value: taxable, gst_amount: tax };
  });

  // 6th Order 50% Loyalty Reward for Non-Members (LOY-P1):
  // After 5 paid orders, the 6th order is 50% off regular pieces if qualifying regular subtotal >= 4000.
  const isNonMember = !membershipActive;
  const isSixthOrder = isNonMember && orderCount > 0 && ((Number(orderCount) + 1) % 6 === 0);
  const regularPriced = priced.filter((l) => !l.use_credit && !l.reward_entitlement_id && String(l.badge || '').trim().toUpperCase() !== 'PREMIUM');
  const regularSubtotal = regularPriced.reduce((s, l) => s + l.line_total, 0);

  let loyaltyDiscount = 0;
  if (isSixthOrder && regularSubtotal >= 4000) {
    loyaltyDiscount = round2(regularSubtotal * 0.5);
  }

  const shipping = calculateShipping({ method, creditCount: creditsUsed, membershipActive, hasPhysicalItems: priced.length > 0, settings });
  const giftFee = gift ? round2(settings.gift_packing_fee) : 0;
  // Shipping and packing follow the principal supply's highest rate (composite supply).
  const chargesRate = maxRate || Number(settings.gst_rate_low);
  const chargesTax = extractTax(shipping + giftFee, shipping + giftFee > 0 ? chargesRate : 0);

  const lineTaxable = priced.reduce((s, l) => s + l.taxable_value, 0);
  const lineTax = priced.reduce((s, l) => s + l.gst_amount, 0);
  const taxableAmount = round2(lineTaxable + chargesTax.taxable);
  const taxAmount = round2(lineTax + chargesTax.tax);
  const total = round2(Math.max(0, subtotal - creditDiscount - rewardDiscount - loyaltyDiscount + shipping + giftFee));

  const cgst = intraState ? round2(taxAmount / 2) : 0;
  const sgst = intraState ? round2(taxAmount - cgst) : 0;
  const igst = intraState ? 0 : taxAmount;

  return {
    lines: priced,
    subtotal: round2(subtotal),
    credit_discount: round2(creditDiscount),
    credits_used: creditsUsed,
    reward_discount: round2(rewardDiscount),
    rewards_used: rewardsUsed,
    loyalty_discount: loyaltyDiscount,
    is_sixth_order: isSixthOrder,
    shipping,
    gift_fee: giftFee,
    taxable_amount: taxableAmount,
    tax_amount: taxAmount,
    cgst,
    sgst,
    igst,
    place_of_supply: pos,
    intra_state: intraState,
    total,
    amount_paise: toPaise(total),
  };
}

/**
 * Membership checkout amount: monthly price × months, less any server-validated discount,
 * GST-inclusive. `months` defaults to the configured upfront block.
 */
export function calculateMembershipPrice(settings, { months: requested, discount = 0 } = {}) {
  const months = Math.max(1, Number(requested ?? settings.membership_upfront_months) || 1);
  const list = round2(Number(settings.membership_price) * months);
  const off = Math.min(list, round2(Math.max(0, Number(discount) || 0)));
  const total = round2(list - off);
  const rate = Number(settings.membership_gst_rate ?? 18);
  const { taxable, tax } = extractTax(total, rate);
  return { months, list_total: list, discount: off, total, amount_paise: toPaise(total), gst_rate: rate, taxable_amount: taxable, tax_amount: tax };
}
