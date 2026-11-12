// Matches a colour profile against Vishrea product colours. Products carry a colour name
// ("Mustard Yellow", "Wine", "Pearl"), which is turned into a reference colour and compared
// with the palette by CIEDE2000 colour difference (ΔE00).
import { hexToRgb, rgbToLab } from './colourEngine.js';

/** Reference colours for the colour names used on product listings (lower case). */
export const COLOUR_NAMES = {
  black: '#151515', 'jet black': '#0E0E0E', white: '#F7F7F5', 'optic white': '#FAFAFA', 'off white': '#F2EFE6', ivory: '#F6EEDC', cream: '#EDE3D3',
  pearl: '#EAE6DD', ecru: '#E8DFC8', oat: '#E3D7C3', beige: '#D8C3A5', nude: '#D9B8A0', sand: '#D2BC94', champagne: '#E9D7B8',
  stone: '#B8B0A2', ash: '#B2B0AA', smoke: '#8E8C88', fawn: '#C4A484', biscuit: '#D6B98C', latte: '#C5A887', rosewood: '#8C4A4F', mulberry: '#6E2E4F',
  sapphire: '#1C3F8C', peacock: '#1F6F78',
  camel: '#B58A5A', tan: '#C19A6B', caramel: '#A86B3C', mocha: '#7B5844', coffee: '#6F4E37', chocolate: '#4A3028', brown: '#6B4A33', espresso: '#3A2A22',
  taupe: '#A38F7C', mushroom: '#B5A898', khaki: '#A99A6E', grey: '#9A9A98', gray: '#9A9A98', 'light grey': '#D0D0CE', charcoal: '#34343A', silver: '#B9BCC4', slate: '#6C7F99',
  navy: '#1F2A44', 'ink navy': '#172A46', blue: '#2F5DA8', 'royal blue': '#2747B8', cobalt: '#1F4FB0', 'sky blue': '#87BCE6', 'powder blue': '#A7C4E0',
  'baby blue': '#B5D3EC', denim: '#4F6D8F', periwinkle: '#8E9BD1', teal: '#2F6E6A', turquoise: '#3BB7AE', aqua: '#5CC5B5', mint: '#AED8C8',
  green: '#3E7A4A', sage: '#8F9C7A', olive: '#68734A', emerald: '#176B5B', forest: '#2E4A35', 'bottle green': '#1F4A35', pine: '#1F4D3E', lime: '#A6D608',
  yellow: '#F2CC3D', lemon: '#F5E06A', butter: '#F3DC8B', mustard: '#C99A2E', 'mustard yellow': '#C99A2E', gold: '#C8A04A', 'muted gold': '#B8995A',
  orange: '#F26A21', 'burnt orange': '#B4532A', rust: '#9C4A2F', terracotta: '#B85C43', copper: '#B06A3B', bronze: '#8C6239', coral: '#EE7B6A', peach: '#F4A889', apricot: '#F2B27F',
  pink: '#EAA2B6', blush: '#E8C0BE', 'baby pink': '#F3C7D3', rose: '#D88A97', 'dusty rose': '#C08B80', 'dusty pink': '#D8A8AC', 'hot pink': '#E6398A', fuchsia: '#C1286D', magenta: '#B0307A',
  red: '#C0172A', 'true red': '#C0172A', cherry: '#A4152C', scarlet: '#C8102E', wine: '#5E1A2B', burgundy: '#5E1A2B', maroon: '#5A1F24', oxblood: '#4A1418', 'black cherry': '#5A1A2C',
  plum: '#5E2750', aubergine: '#4B2742', purple: '#5E3A87', violet: '#6A4C9C', lavender: '#B9A9D6', lilac: '#C8A8D8', mauve: '#A57F8F',
};

/**
 * Reference colour for a product colour name, or null. Multi-word names win ("Mustard Yellow"),
 * otherwise the first colour word, which is the shade in fashion naming ("Sage green" → sage,
 * "Black & White" → black).
 */
export function productColour(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (COLOUR_NAMES[s]) return { name: s, hex: COLOUR_NAMES[s] };
  const padded = ` ${s} `;
  const hits = Object.keys(COLOUR_NAMES)
    .map((k) => ({ k, at: padded.indexOf(` ${k} `), words: k.split(' ').length }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => b.words - a.words || a.at - b.at);
  return hits.length ? { name: hits[0].k, hex: COLOUR_NAMES[hits[0].k] } : null;
}

const labOf = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
};

/** CIEDE2000 colour difference between two CIELAB colours. */
export function deltaE2000(c1, c2) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(c1.a, c1.b), C2 = Math.hypot(c2.a, c2.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * c1.a, a2 = (1 + G) * c2.a;
  const C1p = Math.hypot(a1, c1.b), C2p = Math.hypot(a2, c2.b);
  const h = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = h(a1, c1.b), h2 = h(a2, c2.b);
  const dL = c2.L - c1.L, dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lm = (c1.L + c2.L) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (C1p * C2p) hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const MATCH_LIMIT = 15; // ΔE00 within which a product colour counts as "in the palette"
const AVOID_LIMIT = 10; // ΔE00 within which it is too close to a "try less" colour

/**
 * Rank products for a colour profile. Returns [{ product, match, deltaE, reason }] best first.
 * A product qualifies when its colour is within MATCH_LIMIT of a palette colour, or it is tagged
 * with the same season and is not close to one of the "try less" colours.
 */
export function matchProducts(products, profile, limit = 4) {
  if (!profile?.bestColors) return [];
  const palette = [...profile.bestColors, ...(profile.neutrals || [])].map(([name, hex]) => ({ name, lab: labOf(hex) }));
  const avoid = (profile.lessColors || []).map(([name, hex]) => ({ name, lab: labOf(hex) }));
  const season = String(profile.season || '').toLowerCase();
  return products
    .map((product) => {
      const colour = productColour(product.color);
      const seasonMatch = Boolean(season) && String(product.colour_season || '').toLowerCase() === season;
      if (!colour) return seasonMatch ? { product, match: null, deltaE: null, score: 12, reason: `Picked for ${profile.season}` } : null;
      const lab = labOf(colour.hex);
      const nearest = palette.reduce((best, c) => {
        const d = deltaE2000(lab, c.lab);
        return d < best.d ? { d, name: c.name } : best;
      }, { d: Infinity, name: null });
      const clash = avoid.some((c) => deltaE2000(lab, c.lab) < AVOID_LIMIT);
      if (clash || (nearest.d > MATCH_LIMIT && !seasonMatch)) return null;
      const score = Math.max(0, MATCH_LIMIT + 10 - nearest.d) + (seasonMatch ? 12 : 0);
      const reason = nearest.d <= MATCH_LIMIT ? `Close to your ${nearest.name}` : `Picked for ${profile.season}`;
      return { product, match: nearest.name, deltaE: Math.round(nearest.d * 10) / 10, score, reason };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
