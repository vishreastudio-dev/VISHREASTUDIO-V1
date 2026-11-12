// Short, factual introductions for category pages. Shown on the page and used as the
// meta description, so they must describe what is actually sold.

export const CATEGORY_COPY = {
  tops: { intro: 'Everyday and occasion tops — structured shirts, soft blouses and knits that work as hard with denim as they do with tailoring.' },
  dresses: { intro: 'Day dresses, slip dresses and evening silhouettes. Most are one-of-one, so the size you see is the size we have.' },
  skirts: { intro: 'Midi, maxi and A-line skirts in fabrics that move well — easy to pair with the tops and knits in the edit.' },
  pants: { intro: 'Wide-leg trousers, tailored pants and relaxed fits, cut to sit well from desk to dinner.' },
  'crop-tops': { intro: 'Cropped layers and fitted tops, designed to sit neatly over high-waisted skirts and trousers.' },
  'party-dresses': { intro: 'Dresses for evenings out — satin, sequin and fluid fabrics in deeper colours.' },
  'coord-sets': { intro: 'Matching sets you can wear together or split — a top and bottom chosen to work on their own too.' },
  sweaters: { intro: 'Knitwear for cooler days and air-conditioned offices, from fine-gauge pullovers to chunkier knits.' },
  'long-coats-shrugs': { intro: 'Long layers, shrugs and light coats to finish an outfit without adding bulk.' },
  'sweatshirts-hoodies': { intro: 'Relaxed sweatshirts and hoodies in soft, heavier jersey for off-duty days.' },
  cardigans: { intro: 'Cardigans in soft knits — easy layers for travel, offices and evenings.' },
};

export const categoryIntro = (slug, name) =>
  CATEGORY_COPY[slug]?.intro || (name ? `${name} from Vishrea Studio — one-of-one and small-run pieces, with studio pickup in Bengaluru and delivery across India.` : null);
