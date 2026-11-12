// Plain, factual product copy derived from catalogue data. Used on the page, in meta
// descriptions and in structured data so all three say the same thing.
import { SITE } from '../site.config.js';

const SINGULAR = { tops: 'top', dresses: 'dress', skirts: 'skirt', pants: 'trouser', 'crop tops': 'crop top', 'party dresses': 'party dress', 'coord sets': 'co-ord set', sweaters: 'sweater', 'long coats & shrugs': 'layer', 'sweatshirts & hoodies': 'sweatshirt', cardigans: 'cardigan' };

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function priceText(product) {
  if (product?.price_inr === null || product?.price_inr === undefined) return null;
  return product.price_max_inr && product.price_max_inr > product.price_inr ? `from ${inr(product.price_inr)}` : inr(product.price_inr);
}

/** The product's own description, or a factual sentence built from its attributes. */
export function describeProduct(p) {
  if (!p) return '';
  if (p.description && p.description.trim().length >= 20) return p.description.trim();
  const kind = SINGULAR[String(p.category || '').toLowerCase()] || 'piece';
  const colour = p.color ? `${p.color.toLowerCase()} ` : '';
  const lead = p.is_one_of_one ? `A one-of-one ${colour}${kind}` : `A ${colour}${kind}`;
  const material = p.material ? ` in ${p.material.toLowerCase()}` : '';
  const sizes = p.sizes?.length ? ` Available in ${p.sizes.join(', ')}.` : '';
  return `${lead}${material} from Vishrea Studio.${sizes}`;
}

const MEASURES = [['bust_cm', 'Bust'], ['waist_cm', 'Waist'], ['hip_cm', 'Hip'], ['length_cm', 'Length']];
const measureOf = (p, key) => {
  const v = p?.measurements ? p.measurements[key] : p?.[key];
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/** "Bust 86 cm (33.9 in) · Waist 70 cm (27.6 in)", or null when nothing was measured. */
export function measurementText(p) {
  const parts = MEASURES.map(([key, name]) => {
    const cm = measureOf(p, key);
    return cm === null ? null : `${name} ${cm} cm (${(cm / 2.54).toFixed(1)} in)`;
  }).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Up to four shopper questions answered only from stored product data and published policy.
 * A question is left out when the answer is not known, so nothing is guessed.
 */
export function productFaqs(p) {
  if (!p) return [];
  const faqs = [];
  if (p.material) faqs.push({ q: `What is the ${p.name} made of?`, a: `${p.material}.` });
  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length) {
    const inStock = variants.filter((v) => v.in_stock).map((v) => v.size_label).filter(Boolean);
    faqs.push({ q: 'Which sizes are available?', a: inStock.length ? `In stock now: ${inStock.join(', ')}.` : 'This piece is currently sold out in every size.' });
  }
  if (p.care_instructions) faqs.push({ q: 'How should I wash it?', a: p.care_instructions.trim() });
  faqs.push({
    q: 'Can I exchange it?',
    a: `Size exchanges can be requested from your order page within ${SITE.returns.days} days of delivery. Report any damage within ${SITE.returns.damageHours} hours.`,
  });
  faqs.push({ q: 'How is it delivered?', a: `Delivery anywhere in India is ₹${SITE.shipping.fee}. Studio pickup in Bengaluru is free.` });
  return faqs.slice(0, 4);
}

/** Listing facts an administrator still has to add before the page is complete. */
export function productContentGaps(p) {
  if (!p) return [];
  const gaps = [];
  if (!p.description || p.description.trim().length < 80) gaps.push('description (at least 80 characters)');
  if (!p.material) gaps.push('material / fabric');
  if (!p.care_instructions) gaps.push('care instructions');
  if (!p.color) gaps.push('colour');
  if (!MEASURES.some(([key]) => measureOf(p, key) !== null)) gaps.push('measurements');
  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  if (!images.length && !p.image_url) gaps.push('photos');
  return gaps;
}

export function productMetaDescription(p) {
  const parts = [`${p.name}${priceText(p) ? `, ${priceText(p)}` : ''}.`, describeProduct(p)];
  parts.push(p.available === false ? 'Currently sold out.' : 'Free studio pickup in Bengaluru or ₹99 delivery across India.');
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 158 ? `${text.slice(0, 155).replace(/\s+\S*$/, '')}…` : text;
}
