// On-device colour analysis. Pixels never leave the browser: the image is drawn to an
// in-memory canvas, sampled, and only derived colour attributes are returned.

const PALETTES = {
  'Light Spring': {
    lead: ['Peach', '#F4A889'],
    best: [['Peach', '#F4A889'], ['Warm Aqua', '#5CC5B5'], ['Butter', '#F3DC8B'], ['Coral', '#EE7B6A'], ['Camel', '#C9A27A']],
    neutrals: [['Ivory', '#F6EEDC'], ['Light Camel', '#D2B48C'], ['Warm Grey', '#B7ADA0']],
    less: [['Black', '#151515'], ['Icy Grey', '#C9CED6'], ['Burgundy', '#5E1A2B']],
  },
  'True Autumn': {
    lead: ['Terracotta', '#B85C43'],
    best: [['Terracotta', '#B85C43'], ['Olive', '#68734A'], ['Mustard', '#C99A2E'], ['Rust', '#9C4A2F'], ['Teal', '#2F6E6A']],
    neutrals: [['Camel', '#B58A5A'], ['Chocolate', '#4A3028'], ['Cream', '#EDE3D3']],
    less: [['Icy Blue', '#B9D4E8'], ['Fuchsia', '#D1287A'], ['Cool Silver', '#B9BCC4']],
  },
  'Soft Autumn': {
    lead: ['Sage', '#8F9C7A'],
    best: [['Sage', '#8F9C7A'], ['Dusty Rose', '#C08B80'], ['Soft Teal', '#5E8C88'], ['Warm Taupe', '#A38F7C'], ['Muted Gold', '#B8995A']],
    neutrals: [['Mushroom', '#B5A898'], ['Soft Olive', '#7A8060'], ['Oat', '#E3D7C3']],
    less: [['Neon Pink', '#F20A7A'], ['Pure White', '#FFFFFF'], ['Royal Blue', '#2747B8']],
  },
  'Deep Autumn': {
    lead: ['Mahogany', '#6E2F24'],
    best: [['Mahogany', '#6E2F24'], ['Forest', '#2E4A35'], ['Burnt Orange', '#B4532A'], ['Aubergine', '#4B2742'], ['Bronze', '#8C6239']],
    neutrals: [['Espresso', '#3A2A22'], ['Charcoal Brown', '#3D3430'], ['Warm Ivory', '#F2E7D5']],
    less: [['Pastel Pink', '#F3C7D3'], ['Icy Lilac', '#D9D2EC'], ['Light Grey', '#D8D8D8']],
  },
  'Light Summer': {
    lead: ['Powder Blue', '#A7C4E0'],
    best: [['Powder Blue', '#A7C4E0'], ['Rose Pink', '#E4A6B5'], ['Lavender', '#B9A9D6'], ['Soft Mint', '#AED8C8'], ['Periwinkle', '#8E9BD1']],
    neutrals: [['Soft White', '#F4F2EE'], ['Dove Grey', '#BDBBB8'], ['Light Navy', '#4E5E7E']],
    less: [['Orange', '#F26A21'], ['Mustard', '#C99A2E'], ['Black', '#151515']],
  },
  'Soft Summer': {
    lead: ['Dusty Mauve', '#A57F8F'],
    best: [['Dusty Mauve', '#A57F8F'], ['Slate Blue', '#6C7F99'], ['Rose Taupe', '#A88C8A'], ['Sea Green', '#7A9E93'], ['Soft Plum', '#7D5A73']],
    neutrals: [['Grey Taupe', '#9D958E'], ['Pewter', '#7E7F83'], ['Soft Navy', '#3E4A61']],
    less: [['Bright Orange', '#F26A21'], ['Lime', '#A6D608'], ['Golden Yellow', '#E8B90E']],
  },
  'True Winter': {
    lead: ['Berry Burgundy', '#8C294F'],
    best: [['Berry Burgundy', '#8C294F'], ['Emerald', '#176B5B'], ['Ink Navy', '#172A46'], ['Fuchsia', '#C1286D'], ['Royal Blue', '#2747B8']],
    neutrals: [['Charcoal', '#34343A'], ['Ink Navy', '#172A46'], ['Cool White', '#F4F5F2']],
    less: [['Bright Orange', '#F26A21'], ['Golden Mustard', '#D9A51A'], ['Warm Camel', '#B58A5A']],
  },
  'Deep Winter': {
    lead: ['Black Cherry', '#5A1A2C'],
    best: [['Black Cherry', '#5A1A2C'], ['Pine', '#1F4D3E'], ['Sapphire', '#1C3F8C'], ['Deep Plum', '#4C2149'], ['True Red', '#C0172A']],
    neutrals: [['Black', '#151515'], ['Charcoal', '#34343A'], ['Optic White', '#FAFAFA']],
    less: [['Peach', '#F4A889'], ['Beige', '#D8C3A5'], ['Dusty Pink', '#D8A8AC']],
  },
};

export const SEASONS = Object.keys(PALETTES);

// ---- Colour spaces ---------------------------------------------------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0-255) → CIELAB (D65). */
export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** sRGB (0-255) → HSV with H in degrees and S, V in 0-1. */
export function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  return { h: h < 0 ? h + 360 : h, s: max ? d / max : 0, v: max };
}

export const hexToRgb = (hex) => {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const median = (arr) => {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  return s[Math.floor(s.length / 2)];
};
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const norm = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

// ---- 1. Skin-region extraction (OpenCV-style, on device) -------------------------------

/** Classic combined skin rule: YCrCb chrominance box AND an HSV hue/saturation/value window. */
function isSkin(r, g, b) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  if (Y < 35 || Y > 250 || Cr < 133 || Cr > 173 || Cb < 77 || Cb > 127) return false;
  const { h, s, v } = rgbToHsv(r, g, b);
  return (h <= 50 || h >= 340) && s >= 0.08 && s <= 0.8 && v >= 0.15;
}

/** 3×3 erosion or dilation of a binary mask (Uint8Array, row-major). */
function morph(mask, w, h, erode) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let hit = erode ? 1 : 0;
      for (let dy = -1; dy <= 1 && (erode ? hit : !hit); dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          const on = nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx] === 1;
          if (erode && !on) { hit = 0; break; }
          if (!erode && on) { hit = 1; break; }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

/** Keep the largest 4-connected component of a mask; returns its pixel indices. */
function largestComponent(mask, w, h) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const comp = [];
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      comp.push(i);
      const x = i % w, y = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of next) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/**
 * Skin pixels of the face: YCrCb ∩ HSV mask inside the face box, with eyes, mouth and nose tip
 * masked out, cleaned by a morphological opening, keeping the largest connected region.
 * Returns pixel indices into the full canvas and the region-of-interest size.
 */
function extractSkin(data, w, h, face, s) {
  const b = { x: face.box.x * s, y: face.box.y * s, w: face.box.width * s, h: face.box.height * s };
  const x0 = Math.max(0, Math.floor(b.x)), x1 = Math.min(w - 1, Math.ceil(b.x + b.w));
  const y0 = Math.max(0, Math.floor(b.y - b.h * 0.08)), y1 = Math.min(h - 1, Math.ceil(b.y + b.h));
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  const k = face.keypoints.map((p) => ({ x: p.x * s, y: p.y * s }));
  const holes = k.length >= 4
    ? [
        { cx: k[0].x, cy: k[0].y, rx: b.w * 0.14, ry: b.h * 0.08 },
        { cx: k[1].x, cy: k[1].y, rx: b.w * 0.14, ry: b.h * 0.08 },
        { cx: k[2].x, cy: k[2].y, rx: b.w * 0.08, ry: b.h * 0.07 },
        { cx: k[3].x, cy: k[3].y, rx: b.w * 0.2, ry: b.h * 0.1 },
      ]
    : [];
  let mask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y += 1) {
    for (let x = 0; x < rw; x += 1) {
      const gx = x + x0, gy = y + y0;
      if (holes.some((o) => ((gx - o.cx) / o.rx) ** 2 + ((gy - o.cy) / o.ry) ** 2 <= 1)) continue;
      const i = (gy * w + gx) * 4;
      if (isSkin(data[i], data[i + 1], data[i + 2])) mask[y * rw + x] = 1;
    }
  }
  mask = morph(morph(mask, rw, rh, true), rw, rh, false); // opening: removes speckles and thin edges
  const comp = largestComponent(mask, rw, rh);
  return { pixels: comp.map((i) => ((i / rw | 0) + y0) * w + (i % rw) + x0), roiArea: rw * rh, box: b };
}

// ---- 2. Colour measurement (CIELAB + HSV) and 3. calibration -----------------------------

// Healthy sclera is not pure white: it reads slightly warm. Only the excess over this is light cast.
const SCLERA_NATURAL = { a: 1, b: 4 };

/**
 * Light-cast estimate from the whites of the eyes (lit by the same light as the skin, unlike the
 * background): the brightest, least saturated pixels around each eye keypoint. Returns the a* and
 * b* cast, or null when the eyes are not visible enough to use as a reference.
 */
function illuminantCast(data, w, h, face, s) {
  const k = face.keypoints.map((p) => ({ x: p.x * s, y: p.y * s }));
  if (k.length < 2) return null;
  const bw = face.box.width * s, bh = face.box.height * s;
  const candidates = [];
  for (const eye of k.slice(0, 2)) {
    const rx = bw * 0.12, ry = bh * 0.06;
    for (let y = Math.max(0, Math.floor(eye.y - ry)); y <= Math.min(h - 1, eye.y + ry); y += 1) {
      for (let x = Math.max(0, Math.floor(eye.x - rx)); x <= Math.min(w - 1, eye.x + rx); x += 1) {
        if (((x - eye.x) / rx) ** 2 + ((y - eye.y) / ry) ** 2 > 1) continue;
        const i = (y * w + x) * 4;
        const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
        // Sclera is bright and close to neutral; eyelid skin around it is not.
        if (lab.L > 55 && Math.hypot(lab.a, lab.b) < 20) candidates.push(lab);
      }
    }
  }
  candidates.sort((a, b) => b.L - a.L);
  const refs = candidates.slice(0, Math.max(0, Math.ceil(candidates.length * 0.3)));
  if (refs.length < 8) return null;
  return { a: median(refs.map((c) => c.a)) - SCLERA_NATURAL.a, b: median(refs.map((c) => c.b)) - SCLERA_NATURAL.b, samples: refs.length };
}

function measureSkin(data, pixels) {
  const lab = pixels.map((p) => rgbToLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]));
  // Trim the darkest and brightest 10% (shadows, shine) before taking medians.
  const Ls = Float64Array.from(lab, (c) => c.L).sort();
  const lo = quantile(Ls, 0.1), hi = quantile(Ls, 0.9);
  const keep = pixels.filter((_, j) => lab[j].L >= lo && lab[j].L <= hi);
  const kept = lab.filter((c) => c.L >= lo && c.L <= hi);
  const hsv = keep.map((p) => rgbToHsv(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]));
  return {
    L: median(kept.map((c) => c.L)),
    a: median(kept.map((c) => c.a)),
    b: median(kept.map((c) => c.b)),
    H: median(hsv.map((c) => (c.h > 180 ? c.h - 360 : c.h))),
    S: median(hsv.map((c) => c.s)),
    V: median(hsv.map((c) => c.v)),
    samples: kept.length,
  };
}

// ---- 4. Undertone (rule-based on calibrated features) -----------------------------------

/**
 * Warmth in [-1, 1] from three calibrated features: CIELAB hue angle (yellow vs pink), the ratio
 * of b* to a*, and HSV hue. Thresholds sit at typical neutral skin (h° ≈ 52.5, b:a ≈ 1.3, HSV ≈ 20°).
 */
function undertoneOf(skin) {
  const hue = (Math.atan2(skin.b, skin.a) * 180) / Math.PI;
  const ratio = skin.a > 0.5 ? skin.b / skin.a : 3;
  const parts = {
    hue: clamp((hue - 52.5) / 8, -1, 1),
    ratio: clamp((ratio - 1.3) / 0.45, -1, 1),
    hsv: clamp((skin.H - 20) / 8, -1, 1),
  };
  const warmth = 0.5 * parts.hue + 0.25 * parts.ratio + 0.25 * parts.hsv;
  const label = warmth >= 0.3 ? 'Warm' : warmth >= 0 ? 'Warm Neutral' : warmth > -0.3 ? 'Cool Neutral' : 'Cool';
  // Agreement between the three features raises confidence in the call.
  const agree = 1 - (Math.max(...Object.values(parts)) - Math.min(...Object.values(parts))) / 2;
  return { warmth, label, hue, ratio, agree };
}

// ---- 5. Seasonal colour analysis ---------------------------------------------------------

// Season prototypes on four axes, each in [-1, 1]: warmth (cool→warm), value (deep→light),
// clarity (soft→bright) and contrast (low→high between skin and hair).
const SEASON_PROTOTYPES = {
  'Light Spring': { warmth: 0.6, value: 0.8, clarity: 0.4, contrast: -0.3 },
  'True Autumn': { warmth: 1, value: 0, clarity: 0, contrast: 0 },
  'Soft Autumn': { warmth: 0.5, value: 0, clarity: -0.8, contrast: -0.5 },
  'Deep Autumn': { warmth: 0.6, value: -0.9, clarity: 0, contrast: 0.4 },
  'Light Summer': { warmth: -0.6, value: 0.8, clarity: 0, contrast: -0.4 },
  'Soft Summer': { warmth: -0.5, value: 0, clarity: -0.8, contrast: -0.4 },
  'True Winter': { warmth: -1, value: 0, clarity: 0.7, contrast: 0.7 },
  'Deep Winter': { warmth: -0.6, value: -0.9, clarity: 0.5, contrast: 0.8 },
};
const AXIS_WEIGHTS = { warmth: 1.4, value: 1, clarity: 0.8, contrast: 0.5 };

function rankSeasons(features) {
  return Object.entries(SEASON_PROTOTYPES)
    .map(([season, p]) => ({
      season,
      distance: Math.sqrt(Object.entries(AXIS_WEIGHTS).reduce((sum, [axis, wgt]) => sum + wgt * (features[axis] - p[axis]) ** 2, 0)),
    }))
    .sort((a, b) => a.distance - b.distance);
}

// ---- Analysis ----------------------------------------------------------------------------

/**
 * Analyse the face found by `detectFace` in an <img>/<video>/<canvas>. Throws with a
 * visitor-facing message when the skin cannot be read reliably.
 */
export function analyseImage(source, face) {
  if (!face?.box) throw new Error('We couldn’t find a face in this photo. Use a clear, front-facing photo of your face.');
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  if (!sw || !sh) throw new Error('The photo could not be read. Please try another image.');
  const scale = Math.min(1, 640 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  // Release the pixel buffer as soon as sampling is done.
  canvas.width = 0;
  canvas.height = 0;

  // 1. Skin region
  const { pixels, roiArea, box } = extractSkin(data, w, h, face, scale);
  const coverage = pixels.length / roiArea;
  if (pixels.length < 150 || coverage < 0.15) {
    throw new Error('We found your face, but the light makes your skin colour hard to read. Try soft daylight, facing a window, without filters or heavy make-up.');
  }

  // 2. Measurement, 3. calibration against the photo's white point (partial, capped correction)
  const raw = measureSkin(data, pixels);
  const cast = illuminantCast(data, w, h, face, scale);
  // Partial, capped correction: the eye-white reference is small, so it nudges rather than overrides.
  const corr = cast ? { a: clamp(cast.a * 0.5, -4, 4), b: clamp(cast.b * 0.5, -4, 4) } : { a: 0, b: 0 };
  const skin = { ...raw, a: raw.a - corr.a, b: raw.b - corr.b };

  // Lighting, judged on the face itself
  let sumY = 0, sumY2 = 0;
  for (const p of pixels) {
    const Y = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
    sumY += Y;
    sumY2 += Y * Y;
  }
  const meanY = sumY / pixels.length;
  const stdY = Math.sqrt(Math.max(0, sumY2 / pixels.length - meanY * meanY));
  const castStrength = Math.hypot(cast?.a || 0, cast?.b || 0);
  // The eye-white reference is small and noisy (pink inner corners), so only a strong cast is named.
  const lighting = meanY < 70 ? 'Low light' : meanY > 215 ? 'Very bright' : castStrength > 13 ? (cast.b > 0 ? 'Warm-tinted light' : 'Cool-tinted light') : stdY < 8 ? 'Flat light' : 'Balanced light';

  // Contrast: skin lightness against the darkest features around the upper face (hair at the
  // hairline and temples, brows), which every face has even when the hair is pulled back.
  const hairY = [];
  for (let y = Math.max(0, Math.floor(box.y - box.h * 0.25)); y <= Math.min(h - 1, box.y + box.h * 0.3); y += 1) {
    for (let x = Math.max(0, Math.floor(box.x - box.w * 0.1)); x <= Math.min(w - 1, box.x + box.w * 1.1); x += 1) {
      const i = (y * w + x) * 4;
      hairY.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  const darkHair = Float64Array.from(hairY).sort().slice(0, Math.max(1, Math.floor(hairY.length * 0.1)));
  const hairMean = darkHair.length ? darkHair.reduce((a, v) => a + v, 0) / darkHair.length : meanY;
  const contrastValue = meanY - hairMean;

  // 4. Undertone
  const tone = undertoneOf(skin);
  const chroma = Math.hypot(skin.a, skin.b);

  // 5. Season
  const clarity = 0.6 * norm(chroma, 10, 30) + 0.4 * norm(skin.S, 0.2, 0.55);
  const features = {
    warmth: tone.warmth,
    value: clamp((skin.L - 57) / 15, -1, 1),
    clarity: clarity * 2 - 1,
    contrast: clamp((contrastValue - 80) / 50, -1, 1),
  };
  const ranked = rankSeasons(features);
  const season = ranked[0].season;
  const depth = skin.L >= 72 ? 'Light' : skin.L >= 62 ? 'Light Medium' : skin.L >= 52 ? 'Medium' : skin.L >= 42 ? 'Medium Deep' : 'Deep';
  const contrast = contrastValue > 110 ? 'High' : contrastValue > 70 ? 'Medium' : 'Soft';

  const lightPenalty = lighting === 'Balanced light' ? 0 : lighting === 'Flat light' ? 0.05 : 0.12;
  const margin = clamp((ranked[1].distance - ranked[0].distance) / 0.6, 0, 1);
  const confidence = Math.round(clamp(
    (0.42 + 0.18 * Math.abs(tone.warmth) + 0.12 * tone.agree + 0.12 * margin + 0.1 * norm(pixels.length, 300, 3000) - lightPenalty) * (0.85 + 0.15 * clamp(face.score ?? 1, 0, 1)),
    0.3, 0.93
  ) * 100) / 100;
  const quality = Math.round(clamp(100 - Math.abs(meanY - 150) * 0.4 - (coverage < 0.3 ? 12 : 0) - (stdY < 8 ? 8 : 0) - (castStrength > 13 ? 8 : 0), 20, 98));

  const p = PALETTES[season];
  return {
    season,
    alternative: ranked[1].season,
    undertone: tone.label,
    tone: depth,
    confidence,
    quality,
    lighting,
    method: 'On-device face detection, YCrCb/HSV skin mask, CIELAB + HSV measurement',
    leadColor: p.lead,
    palette: p.best.map((x) => x[1]),
    bestColors: p.best,
    neutrals: p.neutrals,
    lessColors: p.less,
    evidence: [
      { label: 'Undertone', value: tone.label, score: Math.round(50 + Math.abs(tone.warmth) * 30 + tone.agree * 15) },
      { label: 'Depth', value: depth, score: Math.round(clamp(62 + coverage * 40, 62, 95)) },
      { label: 'Clarity', value: clarity > 0.62 ? 'Clear' : clarity < 0.38 ? 'Soft' : 'Balanced', score: Math.round(55 + Math.abs(clarity - 0.5) * 70) },
      { label: 'Contrast', value: contrast, score: Math.round(clamp(55 + Math.abs(contrastValue - 90) / 3, 55, 92)) },
    ],
    features: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    measurements: {
      L: Math.round(skin.L), a: Math.round(skin.a * 10) / 10, b: Math.round(skin.b * 10) / 10, hue: Math.round(tone.hue), chroma: Math.round(chroma),
      hsv_hue: Math.round(skin.H), hsv_saturation: Math.round(skin.S * 100), skin_pixels: pixels.length, skin_coverage: Math.round(coverage * 100),
      light_cast: cast ? { a: Math.round(cast.a * 10) / 10, b: Math.round(cast.b * 10) / 10 } : null, face_score: Math.round((face.score ?? 0) * 100),
    },
    // Where the face is, as percentages of the photo, so the result can frame it.
    faceCentre: { x: Math.round(((box.x + box.w / 2) / w) * 100), y: Math.round(((box.y + box.h / 2) / h) * 100) },
  };
}

