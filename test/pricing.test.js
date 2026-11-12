import { test } from 'node:test';
import assert from 'node:assert/strict';

// Unit tests never read a developer .env (which may point at a remote database).
process.env.NODE_ENV = 'test';
const { calculateCartPrice, calculateMembershipPrice, calculateProductPrice, extractTax, gstRateFor, toPaise } = await import('../lib/pricing.js');
const { spendableFromLedger } = await import('../lib/credits.js');
const { customerVideoLimits, SETTING_DEFAULTS } = await import('../lib/settings.js');
const { mp4DurationSeconds, sniff } = await import('../lib/uploads.js');
const { fakeMp4 } = await import('./helpers.js');

const s = { ...SETTING_DEFAULTS };

test('sale price applies only when lower than list price', () => {
  assert.equal(calculateProductPrice({ price_inr: 1000, sale_price_inr: 800 }), 800);
  assert.equal(calculateProductPrice({ price_inr: 1000, sale_price_inr: 1200 }), 1000);
  assert.equal(calculateProductPrice({ price_inr: 1000, sale_price_inr: null }), 1000);
  assert.equal(calculateProductPrice({ price_inr: 'abc' }), null);
  assert.equal(calculateProductPrice({ price_inr: -5 }), null);
});

test('GST slab by per-piece value and inclusive extraction', () => {
  assert.equal(gstRateFor(2500, s), 5);
  assert.equal(gstRateFor(2500.01, s), 18);
  const { taxable, tax } = extractTax(1050, 5);
  assert.equal(taxable, 1000);
  assert.equal(tax, 50);
});

test('cart totals: shipping, gift, credits, intra vs inter state', () => {
  const lines = [
    { variant_id: 'a', price_inr: 1890, quantity: 1 },
    { variant_id: 'b', price_inr: 3490, quantity: 1, use_credit: true },
  ];
  const intra = calculateCartPrice({ lines, method: 'delivery', gift: true, placeOfSupply: 'Karnataka', membership: { status: 'active' }, settings: s });
  assert.equal(intra.subtotal, 5380);
  assert.equal(intra.credit_discount, 3490);
  assert.equal(intra.shipping, 99);
  assert.equal(intra.gift_fee, 50);
  assert.equal(intra.total, 1890 + 99 + 50);
  assert.equal(intra.amount_paise, (1890 + 99 + 50) * 100);
  assert.equal(intra.igst, 0);
  assert.ok(Math.abs(intra.cgst + intra.sgst - intra.tax_amount) < 0.011);

  const inter = calculateCartPrice({ lines, method: 'delivery', placeOfSupply: 'Tamil Nadu', settings: s });
  assert.equal(inter.cgst, 0);
  assert.equal(inter.igst, inter.tax_amount);

  const pickup = calculateCartPrice({ lines: [lines[0]], method: 'pickup', settings: s });
  assert.equal(pickup.shipping, 0);
  assert.equal(pickup.total, 1890);
});

test('INR to paise rounds half-up on the paisa and is not tripped by binary fractions', () => {
  assert.equal(toPaise(0.1 + 0.2), 30);
  assert.equal(toPaise(19.99), 1999);
  assert.equal(toPaise(10.1), 1010);
  assert.equal(toPaise(1890), 189000);
});

test('membership checkout is monthly price × upfront months', () => {
  const m = calculateMembershipPrice(s);
  assert.equal(m.total, 3598);
  assert.equal(m.amount_paise, 359800);
  assert.equal(calculateMembershipPrice(s, { months: 6 }).total, 10794);
  const ref = calculateMembershipPrice(s, { months: 2, discount: 150 });
  assert.equal(ref.list_total, 3598);
  assert.equal(ref.total, 3448);
  assert.equal(ref.amount_paise, 344800);
  assert.equal(calculateMembershipPrice(s, { months: 2, discount: 99999 }).total, 0, 'a discount never makes the price negative');
});

test('reward eligibility comes only from the configured pieces, categories and optional price limit', async () => {
  const { isRewardEligible } = await import('../lib/rewards.js');
  const line = { product_id: 'p1', category_id: 'c1', price_inr: 2200, sale_price_inr: null };
  assert.equal(isRewardEligible(line, s), false, 'nothing eligible by default');
  assert.equal(isRewardEligible(line, { ...s, reward_eligible_product_ids: ['p1'] }), true);
  assert.equal(isRewardEligible(line, { ...s, reward_eligible_category_ids: ['c1'] }), true);
  assert.equal(isRewardEligible({ ...line, category_id: null }, { ...s, reward_eligible_category_ids: ['c1'] }), false);
  assert.equal(isRewardEligible(line, { ...s, reward_eligible_product_ids: ['p1'], reward_max_price_inr: 2000 }), false, 'above the price limit');
  assert.equal(isRewardEligible({ ...line, sale_price_inr: 1900 }, { ...s, reward_eligible_product_ids: ['p1'], reward_max_price_inr: 2000 }), true, 'sale price counts');
  assert.ok(!('max_credit_balance' in s) && !('pause_credit_policy' in s), 'no invented credit cap or pause rule');
});

test('a free-piece reward line is free but shipping still applies; Premium is never credit-eligible', async () => {
  const { isCreditEligible } = await import('../lib/pricing.js');
  const line = { variant_id: 'v1', product_id: 'p1', name: 'R', sku: 'R', size_label: 'M', price_inr: 2200, sale_price_inr: null, quantity: 1, reward_entitlement_id: 'r1', badge: '' };
  const p = calculateCartPrice({ lines: [line], method: 'delivery', membership: null, settings: s });
  assert.equal(p.subtotal, 2200);
  assert.equal(p.reward_discount, 2200);
  assert.equal(p.rewards_used, 1);
  assert.equal(p.credits_used, 0);
  assert.equal(p.total, 99);
  assert.equal(isCreditEligible({ badge: 'Premium', credit_eligible: true }), false);
  assert.equal(isCreditEligible({ badge: 'New', credit_eligible: false }), false);
  assert.equal(isCreditEligible({ badge: 'New', credit_eligible: true }), true);
});

test('credit expiry is FIFO and ignores the expiry adjustment row', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const soon = new Date('2026-02-01T00:00:00Z');
  const later = new Date('2026-04-01T00:00:00Z');
  const rows = [
    { delta: 2, reason: 'membership_payment', expires_at: soon, created_at: t0 },
    { delta: 2, reason: 'membership_payment', expires_at: later, created_at: t0 },
    { delta: -1, reason: 'redemption', created_at: new Date('2026-01-15T00:00:00Z') },
    { delta: -3, reason: 'expiry', created_at: new Date('2026-02-02T00:00:00Z') },
  ];
  assert.equal(spendableFromLedger(rows, new Date('2026-01-20T00:00:00Z')).spendable, 3);
  assert.equal(spendableFromLedger(rows, new Date('2026-02-02T00:00:00Z')).spendable, 2);
  assert.equal(spendableFromLedger(rows, new Date('2026-05-01T00:00:00Z')).spendable, 0);
  assert.equal(spendableFromLedger([{ delta: 4, reason: 'admin: grant', expires_at: null, created_at: t0 }], later).spendable, 4);
});

test('customer video limits cannot be raised past 3 videos or 10 seconds', () => {
  assert.deepEqual(customerVideoLimits({ max_published_videos: 30, max_video_seconds: 60 }), { max_published_videos: 3, max_video_seconds: 10 });
  assert.deepEqual(customerVideoLimits({ max_published_videos: 2, max_video_seconds: 8 }), { max_published_videos: 2, max_video_seconds: 8 });
});

test('upload sniffing and MP4 duration parsing', () => {
  assert.equal(sniff(Buffer.from('<svg></svg>          ')), null);
  assert.equal(sniff(fakeMp4(3)).kind, 'video');
  assert.equal(mp4DurationSeconds(fakeMp4(29.5)), 29.5);
  assert.equal(mp4DurationSeconds(Buffer.alloc(40)), null);
});
