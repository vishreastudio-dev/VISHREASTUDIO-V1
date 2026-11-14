// Homepage hero carousel: the one definition of what a slide may contain. Shared by the server
// (validation in lib/carousel.js), the public carousel and the admin editor, so the editor's
// controls, the preview and the stored data always agree. Plain data only: no HTML, no CSS strings.

export const HERO_BREAKPOINTS = { mobile: 640, tablet: 1024 };

/** Approved typefaces. Only these keys are stored; the CSS stacks are fixed here. */
export const HERO_FONTS = {
  editorial: { label: 'Editorial serif (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
  didone: { label: 'High-contrast serif (Didot / Bodoni)', stack: "Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, serif" },
  book: { label: 'Book serif (Palatino)', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  sans: { label: 'Clean sans (Inter / system)', stack: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  humanist: { label: 'Humanist sans (Gill Sans / Optima)', stack: "'Gill Sans', 'Gill Sans MT', Optima, Candara, 'Segoe UI', sans-serif" },
};

export const TEXT_LIMITS = { heading: 80, subtitle: 120, description: 220, image_alt: 200, cta_label: 30, cta_url: 500 };
export const MAX_SLIDES = 12;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Minimum size and accepted shape (width ÷ height) of each banner. */
export const IMAGE_RULES = {
  full: { minWidth: 1200, minHeight: 480, minRatio: 1.2, maxRatio: 4, shape: 'landscape' },
  split: { minWidth: 600, minHeight: 700, minRatio: 0.5, maxRatio: 1.4, shape: 'portrait or square' },
  mobile: { minWidth: 600, minHeight: 700, minRatio: 0.45, maxRatio: 1, shape: 'portrait or square' },
};
const MAX_DIMENSION = 10000;

const ALIGN = ['left', 'center', 'right'];
const WEIGHTS = [300, 400, 500, 600, 700];

// ---- Specification ---------------------------------------------------------------------
const num = (min, max) => ({ type: 'num', min, max });
const pick = (...opts) => ({ type: 'enum', opts });
const color = (transparent = false) => ({ type: 'color', transparent });
const flag = { type: 'bool' };

const textStyle = ({ size, mobile, lh, ls }) => ({
  font: pick(...Object.keys(HERO_FONTS)),
  size: num(...size),
  mobile_size: num(...mobile),
  weight: pick(...WEIGHTS),
  italic: flag,
  color: color(),
  align: pick(...ALIGN),
  line_height: num(...lh),
  letter_spacing: num(...ls),
  uppercase: flag,
});

const ctaStyle = {
  visible: flag,
  new_tab: flag,
  bg: color(true),
  color: color(),
  border: color(true),
  border_width: num(0, 3),
  radius: num(0, 32),
  size: pick('sm', 'md', 'lg'),
  uppercase: flag,
  offset_x: num(-250, 250),
  offset_y: num(-250, 250),
};

const position = (maxWidth, insetX, insetY) => ({
  x: pick(...ALIGN),
  y: pick('top', 'middle', 'bottom'),
  max_width: num(...maxWidth),
  inset_x: num(...insetX),
  inset_y: num(...insetY),
});

export const SLIDE_SPEC = {
  heading_style: textStyle({ size: [28, 110], mobile: [22, 56], lh: [0.85, 1.6], ls: [-0.06, 0.3] }),
  subtitle_style: textStyle({ size: [12, 36], mobile: [11, 24], lh: [1, 2], ls: [-0.02, 0.4] }),
  description_style: textStyle({ size: [12, 24], mobile: [12, 18], lh: [1.2, 2.2], ls: [-0.02, 0.2] }),
  image_settings: {
    // natural: the slide takes the banner's own proportions (never crops); cover: fills the set
    // height and crops around the focal point; contain: fills the set height, whole image visible.
    fit: pick('natural', 'cover', 'contain'),
    focal_x: num(0, 100),
    focal_y: num(0, 100),
    mobile_focal_x: num(0, 100),
    mobile_focal_y: num(0, 100),
    background: color(),
  },
  overlay: {
    desktop: position([20, 90], [2, 15], [4, 20]),
    mobile: position([60, 100], [4, 12], [4, 16]),
    gap: num(6, 48),
    panel: pick('none', 'gradient', 'card'),
    panel_color: color(),
    panel_opacity: num(0, 85),
  },
  visibility: { heading: flag, subtitle: flag, description: flag },
  primary_cta: ctaStyle,
  secondary_cta: ctaStyle,
};

export const SETTINGS_SPEC = {
  is_enabled: flag,
  autoplay_enabled: flag,
  autoplay_interval: num(3000, 15000),
  transition_duration: num(200, 1500),
  transition_type: pick('slide', 'fade'),
  show_navigation: flag,
  show_pagination: flag,
  pause_on_hover: flag,
  desktop_height: num(420, 900),
  mobile_height: num(380, 820),
};

// ---- Defaults ----------------------------------------------------------------------------
const INK = '#1a1719';

export const DEFAULT_SLIDE = {
  heading: '',
  subtitle: '',
  description: '',
  desktop_image: null,
  mobile_image: null,
  image_alt: '',
  display_mode: 'overlay',
  layout_type: 'full',
  heading_style: { font: 'editorial', size: 60, mobile_size: 36, weight: 400, italic: false, color: INK, align: 'left', line_height: 0.98, letter_spacing: -0.03, uppercase: false },
  subtitle_style: { font: 'sans', size: 16, mobile_size: 15, weight: 400, italic: false, color: '#32292f', align: 'left', line_height: 1.5, letter_spacing: 0, uppercase: false },
  description_style: { font: 'sans', size: 15, mobile_size: 14, weight: 400, italic: false, color: '#666165', align: 'left', line_height: 1.75, letter_spacing: 0, uppercase: false },
  image_settings: { fit: 'natural', focal_x: 50, focal_y: 50, mobile_focal_x: 50, mobile_focal_y: 50, background: '#f4efe9' },
  overlay: {
    // Banners usually leave the left third free for text; wider text runs onto the product.
    desktop: { x: 'left', y: 'middle', max_width: 32, inset_x: 6, inset_y: 8 },
    mobile: { x: 'center', y: 'bottom', max_width: 92, inset_x: 6, inset_y: 8 },
    gap: 18,
    panel: 'none',
    panel_color: '#ffffff',
    panel_opacity: 55,
  },
  visibility: { heading: true, subtitle: true, description: true },
  primary_cta: { label: '', url: '', visible: true, new_tab: false, bg: INK, color: '#ffffff', border: INK, border_width: 1, radius: 0, size: 'md', uppercase: true, offset_x: 0, offset_y: 0 },
  secondary_cta: { label: '', url: '', visible: false, new_tab: false, bg: 'transparent', color: INK, border: INK, border_width: 1, radius: 0, size: 'md', uppercase: true, offset_x: 0, offset_y: 0 },
  starts_at: null,
  ends_at: null,
};

export const DEFAULT_SETTINGS = {
  is_enabled: true,
  autoplay_enabled: true,
  autoplay_interval: 6000,
  transition_duration: 600,
  transition_type: 'fade',
  show_navigation: true,
  show_pagination: true,
  pause_on_hover: true,
  desktop_height: 690,
  mobile_height: 600,
};

// ---- Validation --------------------------------------------------------------------------
const LABELS = {
  heading_style: 'Heading', subtitle_style: 'Subtitle', description_style: 'Description', image_settings: 'Image', overlay: 'Text position',
  visibility: 'Visibility', primary_cta: 'Primary button', secondary_cta: 'Secondary button', desktop: 'desktop', mobile: 'mobile',
  size: 'size', mobile_size: 'mobile size', line_height: 'line height', letter_spacing: 'letter spacing', max_width: 'width', inset_x: 'side margin',
  inset_y: 'top/bottom margin', focal_x: 'focal point (horizontal)', focal_y: 'focal point (vertical)', mobile_focal_x: 'mobile focal point (horizontal)',
  mobile_focal_y: 'mobile focal point (vertical)', panel_opacity: 'backdrop opacity', panel_color: 'backdrop colour', border_width: 'border width',
  radius: 'corner radius', bg: 'background colour', border: 'border colour', new_tab: 'new tab', autoplay_interval: 'Autoplay interval',
  transition_duration: 'Transition duration', desktop_height: 'Desktop height', mobile_height: 'Mobile height',
};
const describe = (path) => path.map((p) => LABELS[p] || String(p).replace(/_/g, ' ')).join(' ').replace(/^./, (c) => c.toUpperCase());

const HEX = /^#[0-9a-f]{6}$/i;
const round = (n) => Math.round(n * 1000) / 1000;

function checkValue(rule, v) {
  switch (rule.type) {
    case 'num': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      return Number.isFinite(n) && n >= rule.min && n <= rule.max ? { ok: true, value: round(n) } : { ok: false, message: `must be between ${rule.min} and ${rule.max}` };
    }
    case 'enum': {
      const hit = rule.opts.find((o) => o === v || (typeof o === 'number' && Number(v) === o));
      return hit !== undefined ? { ok: true, value: hit } : { ok: false, message: `must be one of ${rule.opts.join(', ')}` };
    }
    case 'color':
      if (typeof v === 'string' && (HEX.test(v) || (rule.transparent && v === 'transparent'))) return { ok: true, value: v.toLowerCase() };
      return { ok: false, message: 'must be a colour like #1a1719' };
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, message: 'must be on or off' };
    default:
      return { ok: false, message: 'is not supported' };
  }
}

/** Merge `input` over `defaults` following `spec`. Invalid values are reported (strict) and replaced by the default. */
function walk(spec, input, defaults, path, errors, strict) {
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    const v = input && typeof input === 'object' ? input[key] : undefined;
    if (!rule.type) {
      out[key] = walk(rule, v, defaults[key], [...path, key], errors, strict);
      continue;
    }
    if (v === undefined || v === null) {
      out[key] = defaults[key];
      continue;
    }
    const r = checkValue(rule, v);
    if (r.ok) out[key] = r.value;
    else {
      if (strict) errors[[...path, key].join('.')] = `${describe([...path, key])} ${r.message}`;
      out[key] = defaults[key];
    }
  }
  return out;
}

// Plain text only: control characters become spaces; React renders the rest as text, never HTML.
const cleanText = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = Array.from(String(v), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
  return s.replace(/\s+/g, ' ').trim();
};

function textField(input, key, max, errors, strict, label) {
  const v = input?.[key];
  if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') {
    if (strict) errors[key] = `${label} must be text`;
    return '';
  }
  const s = cleanText(v);
  if (s.length > max) {
    if (strict) errors[key] = `${label} must be at most ${max} characters`;
    return s.slice(0, max);
  }
  return s;
}

// A banner must be an uploaded file: the local store's /uploads/… path or a public Supabase Storage
// URL. The server additionally checks the file is registered in media_objects.
const UPLOADED_IMAGE = /^(\/uploads\/[a-z0-9_.-]{1,120}|https?:\/\/[^\s"'<>?#]+\/storage\/v1\/object\/public\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/[A-Za-z0-9%/_.-]{1,400})$/i;

function imageField(v, key, errors, strict) {
  if (v === undefined || v === null || v === '') return null;
  const url = typeof v === 'string' ? v : v?.url;
  if (typeof url !== 'string' || !UPLOADED_IMAGE.test(url) || url.includes('..')) {
    if (strict) errors[key] = 'Upload the banner through the image uploader';
    return null;
  }
  const w = Number(v?.width);
  const h = Number(v?.height);
  return { url, width: Number.isInteger(w) && w > 0 && w <= MAX_DIMENSION ? w : null, height: Number.isInteger(h) && h > 0 && h <= MAX_DIMENSION ? h : null };
}

function dateField(v, key, errors, strict) {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) {
    if (strict) errors[key] = `${key === 'starts_at' ? 'Start' : 'End'} date is not a valid date`;
    return null;
  }
  return new Date(t).toISOString();
}

/** A safe CTA destination: a same-site path or an http(s) address. Anything else is null. */
export function ctaLink(url) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s || s.length > TEXT_LIMITS.cta_url) return null;
  if (s.startsWith('/')) {
    if (s.startsWith('//') || /[\s<>"'`\\]/.test(s)) return null;
    return { internal: true, href: s };
  }
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return { internal: false, href: u.toString() };
  } catch {
    /* not a URL */
  }
  return null;
}

function ctaField(input, key, errors, strict, label) {
  const raw = input?.[key] && typeof input[key] === 'object' ? input[key] : {};
  const style = walk(SLIDE_SPEC[key], raw, DEFAULT_SLIDE[key], [key], errors, strict);
  const labelText = textField(raw, 'label', TEXT_LIMITS.cta_label, {}, false, label);
  if (strict && cleanText(raw.label).length > TEXT_LIMITS.cta_label) errors[`${key}.label`] = `${label} label must be at most ${TEXT_LIMITS.cta_label} characters`;
  const url = cleanText(raw.url);
  if (url && !ctaLink(url) && strict) errors[`${key}.url`] = `${label} destination must be a page on this site (starting with /) or an http(s):// address`;
  return { ...style, label: labelText, url: ctaLink(url) ? url : strict ? url : '' };
}

/**
 * Turn any input into a complete slide. `strict` collects every problem in `errors` (field → message);
 * otherwise invalid values quietly fall back to defaults (used when rendering stored data).
 */
export function normalizeSlide(input, { strict = false } = {}) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  const slide = {
    heading: textField(src, 'heading', TEXT_LIMITS.heading, errors, strict, 'Heading'),
    subtitle: textField(src, 'subtitle', TEXT_LIMITS.subtitle, errors, strict, 'Subtitle'),
    description: textField(src, 'description', TEXT_LIMITS.description, errors, strict, 'Description'),
    desktop_image: imageField(src.desktop_image, 'desktop_image', errors, strict),
    mobile_image: imageField(src.mobile_image, 'mobile_image', errors, strict),
    image_alt: textField(src, 'image_alt', TEXT_LIMITS.image_alt, errors, strict, 'Image description'),
    display_mode: ['overlay', 'image_only'].includes(src.display_mode) ? src.display_mode : DEFAULT_SLIDE.display_mode,
    layout_type: ['full', 'split_image_right', 'split_image_left'].includes(src.layout_type) ? src.layout_type : DEFAULT_SLIDE.layout_type,
    ...walk({ heading_style: SLIDE_SPEC.heading_style, subtitle_style: SLIDE_SPEC.subtitle_style, description_style: SLIDE_SPEC.description_style, image_settings: SLIDE_SPEC.image_settings, overlay: SLIDE_SPEC.overlay, visibility: SLIDE_SPEC.visibility }, src, DEFAULT_SLIDE, [], errors, strict),
    primary_cta: ctaField(src, 'primary_cta', errors, strict, 'Primary button'),
    secondary_cta: ctaField(src, 'secondary_cta', errors, strict, 'Secondary button'),
    starts_at: dateField(src.starts_at, 'starts_at', errors, strict),
    ends_at: dateField(src.ends_at, 'ends_at', errors, strict),
  };
  if (strict && src.display_mode !== undefined && src.display_mode !== slide.display_mode) errors.display_mode = 'Display mode must be overlay or image only';
  if (strict && src.layout_type !== undefined && src.layout_type !== slide.layout_type) errors.layout_type = 'Layout must be full width or split';
  if (slide.starts_at && slide.ends_at && Date.parse(slide.ends_at) <= Date.parse(slide.starts_at)) {
    if (strict) errors.ends_at = 'The end date must be after the start date';
  }
  return { slide, errors };
}

export function normalizeSettings(input, { strict = false } = {}) {
  const errors = {};
  const settings = walk(SETTINGS_SPEC, input, DEFAULT_SETTINGS, [], errors, strict);
  return { settings, errors };
}

/** Why an image of `width`×`height` cannot be used as the `kind` banner for `layout`, or null. */
export function imageProblem(kind, layout, width, height) {
  if (!width || !height) return 'The image size could not be read. Upload it again as JPG, PNG or WEBP.';
  const rule = kind === 'mobile' ? IMAGE_RULES.mobile : layout === 'full' ? IMAGE_RULES.full : IMAGE_RULES.split;
  const where = kind === 'mobile' ? 'The mobile banner' : layout === 'full' ? 'The desktop banner for a full-width slide' : 'The desktop banner for a split slide';
  const ratio = width / height;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return `${where} is larger than ${MAX_DIMENSION} px on one side. Resize it and upload again.`;
  if (width < rule.minWidth || height < rule.minHeight) return `${where} must be at least ${rule.minWidth} × ${rule.minHeight} px. This image is ${width} × ${height} px.`;
  if (ratio < rule.minRatio || ratio > rule.maxRatio) {
    return `${where} must be ${rule.shape} (width ÷ height between ${rule.minRatio} and ${rule.maxRatio}). This image is ${width} × ${height} px (${ratio.toFixed(2)}).`;
  }
  return null;
}

/** Everything that must be fixed before a slide can go live (field → message). */
export function publishProblems(slide, now = Date.now()) {
  const p = {};
  if (!slide.desktop_image?.url) p.desktop_image = 'Upload a desktop banner before publishing';
  else {
    const bad = imageProblem('desktop', slide.layout_type, slide.desktop_image.width, slide.desktop_image.height);
    if (bad) p.desktop_image = bad;
  }
  if (slide.mobile_image?.url) {
    const bad = imageProblem('mobile', slide.layout_type, slide.mobile_image.width, slide.mobile_image.height);
    if (bad) p.mobile_image = bad;
  }
  if (!slide.image_alt) p.image_alt = 'Describe the banner image for screen readers';
  for (const [key, label] of [['primary_cta', 'Primary button'], ['secondary_cta', 'Secondary button']]) {
    const c = slide[key];
    // A button left completely empty is simply not shown; only a half-filled one blocks publishing.
    if (!c.visible || slide.display_mode === 'image_only' || (!c.label && !c.url)) continue;
    if (!c.label) p[`${key}.label`] = `${label} needs a label, or hide the button`;
    if (!ctaLink(c.url)) p[`${key}.url`] = `${label} needs a valid destination, or hide the button`;
  }
  if (slide.ends_at && Date.parse(slide.ends_at) <= now) p.ends_at = 'The end date has already passed';
  return p;
}

/** Is a published slide inside its schedule at `now`? */
export const withinSchedule = (slide, now = Date.now()) =>
  (!slide.starts_at || Date.parse(slide.starts_at) <= now) && (!slide.ends_at || Date.parse(slide.ends_at) > now);

/** Share of the slide width given to the image in the split layouts (see index.css). */
export const SPLIT_IMAGE_SHARE = 0.58;

/**
 * Proportions used by the "natural" fit: the slide's width ÷ height on desktop/tablet (so the
 * whole banner fits its image area exactly) and the image's own width ÷ height on phones.
 */
export function naturalRatios(slide) {
  const d = slide.desktop_image;
  const m = slide.mobile_image;
  const img = d?.width && d?.height ? d.width / d.height : null;
  const mobile = m?.width && m?.height ? m.width / m.height : img;
  if (!img) return null;
  return { slide: slide.layout_type === 'full' ? img : img / SPLIT_IMAGE_SHARE, image: img, mobile };
}

/** Tablet font size: halfway between the desktop and mobile sizes. */
export const tabletSize = (style) => Math.round((style.size + style.mobile_size) / 2);

/** Embla's `duration` is an abstract speed (roughly 20-60), not milliseconds. */
export const emblaDuration = (ms) => Math.max(15, Math.min(75, Math.round(ms / 20)));
