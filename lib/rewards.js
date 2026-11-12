/**
 * Free-piece reward eligibility (BD-4). A reward is an entitlement to one piece, never money or
 * membership credits. Nothing is eligible until the owner lists pieces or categories in Settings.
 */
import { calculateProductPrice } from './pricing.js';

export function isRewardEligible(line, settings) {
  const products = settings.reward_eligible_product_ids || [];
  const categories = settings.reward_eligible_category_ids || [];
  const listed = products.includes(line.product_id) || (line.category_id && categories.includes(line.category_id));
  if (!listed) return false;
  const cap = Number(settings.reward_max_price_inr) || 0;
  if (cap > 0) {
    const price = calculateProductPrice(line);
    if (price === null || price > cap) return false;
  }
  return true;
}

export const rewardIneligibleMessage = 'This piece is not eligible for a free-piece reward';
