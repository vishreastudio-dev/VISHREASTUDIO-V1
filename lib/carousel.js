/**
 * Homepage hero carousel: slides, their publication, and the carousel settings.
 *
 * A slide's columns are its working draft. Publishing validates the draft and freezes it in
 * `published_content`; the public homepage reads only that snapshot, so saving a draft never
 * changes the live site. Order, active/inactive and the settings row apply immediately.
 * Banner files live in the existing upload storage; their real pixel size is read from the file.
 */
import { audit } from './audit.js';
import { AppError, badRequest, conflict, notFound } from './http.js';
import { cachedPublic } from './public-cache.js';
import { mediaInfo, objectExists } from './storage.js';
import { bool, uuid } from './validate.js';
import { DEFAULT_SETTINGS, MAX_SLIDES, TEXT_LIMITS, normalizeSettings, normalizeSlide, publishProblems, withinSchedule } from '../vishrea-react/src/lib/heroCarousel.js';

const unprocessable = (code, message, details) => new AppError(422, code, message, details);
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** JSON with sorted keys: jsonb reorders keys, so plain stringify cannot compare a draft with its snapshot. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

const image = (url, width, height) => (url ? { url, width, height } : null);

/** The draft stored in a row, as a complete slide. */
export function rowToSlide(r) {
  return normalizeSlide({
    heading: r.title,
    subtitle: r.subtitle,
    description: r.description,
    desktop_image: image(r.desktop_image_url, r.desktop_image_width, r.desktop_image_height),
    mobile_image: image(r.mobile_image_url, r.mobile_image_width, r.mobile_image_height),
    image_alt: r.image_alt,
    display_mode: r.display_mode,
    layout_type: r.layout_type,
    heading_style: r.heading_style,
    subtitle_style: r.subtitle_style,
    description_style: r.description_style,
    image_settings: r.image_settings,
    overlay: r.overlay_position,
    visibility: r.overlay_visibility,
    primary_cta: { ...r.primary_cta_style, label: r.primary_cta_label, url: r.primary_cta_url },
    secondary_cta: { ...r.secondary_cta_style, label: r.secondary_cta_label, url: r.secondary_cta_url },
    starts_at: iso(r.starts_at),
    ends_at: iso(r.ends_at),
  }).slide;
}

const ctaStyle = ({ label, url, ...style }) => JSON.stringify(style);

const COLUMNS = `title, subtitle, description, desktop_image_url, desktop_image_width, desktop_image_height, mobile_image_url, mobile_image_width,
  mobile_image_height, image_alt, display_mode, layout_type, image_settings, heading_style, subtitle_style, description_style, overlay_position,
  overlay_visibility, primary_cta_label, primary_cta_url, primary_cta_style, secondary_cta_label, secondary_cta_url, secondary_cta_style, starts_at, ends_at`;

function columnValues(s) {
  return [
    s.heading, s.subtitle, s.description,
    s.desktop_image?.url || null, s.desktop_image?.width || null, s.desktop_image?.height || null,
    s.mobile_image?.url || null, s.mobile_image?.width || null, s.mobile_image?.height || null,
    s.image_alt, s.display_mode, s.layout_type,
    JSON.stringify(s.image_settings), JSON.stringify(s.heading_style), JSON.stringify(s.subtitle_style), JSON.stringify(s.description_style),
    JSON.stringify(s.overlay), JSON.stringify(s.visibility),
    s.primary_cta.label, s.primary_cta.url, ctaStyle(s.primary_cta),
    s.secondary_cta.label, s.secondary_cta.url, ctaStyle(s.secondary_cta),
    s.starts_at, s.ends_at,
  ];
}

/** Validate submitted slide content and replace image sizes with the ones recorded when the file was stored. */
async function validatedSlide(c, input) {
  const { slide, errors } = normalizeSlide(input, { strict: true });
  const fields = Object.keys(errors);
  if (fields.length) throw badRequest('invalid_slide', errors[fields[0]], { fields: errors });
  for (const key of ['desktop_image', 'mobile_image']) {
    if (!slide[key]) continue;
    const media = await mediaInfo(slide[key].url, c);
    if (!media || media.kind !== 'image' || media.visibility !== 'public' || !media.width || !media.height) {
      throw badRequest(`${key}_missing`, 'The uploaded banner could not be found or is not an image. Upload it again.', { fields: { [key]: 'Upload the banner again' } });
    }
    slide[key] = { url: slide[key].url, width: media.width, height: media.height };
  }
  return slide;
}

function adminView(r) {
  const slide = rowToSlide(r);
  const published = r.publication_status === 'published';
  return {
    id: r.id,
    display_order: r.display_order,
    is_active: r.is_active,
    publication_status: r.publication_status,
    published_at: r.published_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    version: iso(r.updated_at),
    slide,
    published: published ? normalizeSlide(r.published_content).slide : null,
    has_unpublished_changes: published && stable(slide) !== stable(normalizeSlide(r.published_content).slide),
    live: published && r.is_active && withinSchedule(normalizeSlide(r.published_content).slide),
    problems: publishProblems(slide),
  };
}

async function lockSlide(c, id) {
  const r = (await c.query('SELECT * FROM homepage_carousel_slides WHERE id = $1 FOR UPDATE', [uuid(id, 'id')])).rows[0];
  if (!r) throw notFound('slide_not_found', 'This slide no longer exists. Reload the list.');
  return r;
}

function checkVersion(row, version) {
  if (version && version !== iso(row.updated_at)) {
    throw conflict('slide_changed', 'This slide was changed in another window or by another administrator. Reload it before saving.');
  }
}

async function settingsRow(c) {
  const r = (await c.query('SELECT * FROM homepage_carousel_settings WHERE id = 1')).rows[0];
  return normalizeSettings(r || DEFAULT_SETTINGS).settings;
}

// ---- Admin -------------------------------------------------------------------------------

export async function adminCarousel(c) {
  const [rows, settings, categories] = await Promise.all([
    c.query('SELECT * FROM homepage_carousel_slides ORDER BY display_order, created_at').then((r) => r.rows),
    settingsRow(c),
    c.query('SELECT name, slug FROM categories WHERE is_active = true ORDER BY sort_order, name').then((r) => r.rows),
  ]);
  return { settings, slides: rows.map(adminView), limits: { max_slides: MAX_SLIDES, text: TEXT_LIMITS }, categories };
}

export async function createSlide(c, actor, input) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('homepage_carousel_order'))");
  const { n, top } = (await c.query('SELECT count(*)::int AS n, COALESCE(max(display_order), 0) AS top FROM homepage_carousel_slides')).rows[0];
  if (n >= MAX_SLIDES) throw conflict('too_many_slides', `The carousel holds at most ${MAX_SLIDES} slides. Delete one first.`);
  const slide = await validatedSlide(c, input);
  const r = (
    await c.query(
      `INSERT INTO homepage_carousel_slides (${COLUMNS}, display_order, created_by, updated_by)
       VALUES (${Array.from({ length: 26 }, (_, i) => `$${i + 1}`).join(', ')}, $27, $28, $28) RETURNING *`,
      [...columnValues(slide), top + 10, actor]
    )
  ).rows[0];
  await audit(c, { actor, action: 'carousel_slide_created', entityType: 'carousel_slide', entityId: r.id, details: { heading: slide.heading } });
  return adminView(r);
}

export async function updateSlide(c, actor, id, input, { version, publish = false } = {}) {
  const row = await lockSlide(c, id);
  checkVersion(row, version);
  const slide = await validatedSlide(c, input);
  const sets = COLUMNS.split(',').map((col, i) => `${col.trim()} = $${i + 2}`).join(', ');
  let r = (await c.query(`UPDATE homepage_carousel_slides SET ${sets}, updated_by = $28, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, ...columnValues(slide), actor])).rows[0];
  await audit(c, { actor, action: 'carousel_slide_updated', entityType: 'carousel_slide', entityId: r.id, details: { heading: slide.heading } });
  if (publish) r = await publishRow(c, actor, r);
  return adminView(r);
}

async function publishRow(c, actor, row) {
  const slide = rowToSlide(row);
  const problems = publishProblems(slide);
  const fields = Object.keys(problems);
  if (fields.length) throw unprocessable('slide_not_ready', problems[fields[0]], { fields: problems });
  for (const key of ['desktop_image', 'mobile_image']) {
    if (slide[key] && !(await objectExists(slide[key].url, c))) throw unprocessable(`${key}_missing`, 'A banner file for this slide is missing. Upload it again before publishing.', { fields: { [key]: 'Upload the banner again' } });
  }
  const r = (
    await c.query(
      `UPDATE homepage_carousel_slides SET publication_status = 'published', published_content = $2, published_at = now(), published_by = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [row.id, JSON.stringify(slide), actor]
    )
  ).rows[0];
  await audit(c, { actor, action: 'carousel_slide_published', entityType: 'carousel_slide', entityId: r.id, details: { heading: slide.heading, starts_at: slide.starts_at, ends_at: slide.ends_at } });
  return r;
}

export async function publishSlide(c, actor, id, { version } = {}) {
  const row = await lockSlide(c, id);
  checkVersion(row, version);
  return adminView(await publishRow(c, actor, row));
}

export async function unpublishSlide(c, actor, id) {
  const row = await lockSlide(c, id);
  if (row.publication_status !== 'published') return adminView(row);
  const r = (
    await c.query("UPDATE homepage_carousel_slides SET publication_status = 'draft', published_content = NULL, updated_at = now() WHERE id = $1 RETURNING *", [row.id])
  ).rows[0];
  await audit(c, { actor, action: 'carousel_slide_unpublished', entityType: 'carousel_slide', entityId: r.id, details: { heading: row.title } });
  return adminView(r);
}

export async function setSlideActive(c, actor, id, active) {
  const row = await lockSlide(c, id);
  const r = (await c.query('UPDATE homepage_carousel_slides SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *', [row.id, bool(active)])).rows[0];
  if (row.is_active !== r.is_active) {
    await audit(c, { actor, action: r.is_active ? 'carousel_slide_activated' : 'carousel_slide_deactivated', entityType: 'carousel_slide', entityId: r.id, details: { heading: row.title } });
  }
  return adminView(r);
}

export async function duplicateSlide(c, actor, id) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('homepage_carousel_order'))");
  const row = await lockSlide(c, id);
  const { n, top } = (await c.query('SELECT count(*)::int AS n, COALESCE(max(display_order), 0) AS top FROM homepage_carousel_slides')).rows[0];
  if (n >= MAX_SLIDES) throw conflict('too_many_slides', `The carousel holds at most ${MAX_SLIDES} slides. Delete one first.`);
  const slide = rowToSlide(row);
  const copyTitle = `${slide.heading} (copy)`;
  if (slide.heading && copyTitle.length <= TEXT_LIMITS.heading) slide.heading = copyTitle;
  const r = (
    await c.query(
      `INSERT INTO homepage_carousel_slides (${COLUMNS}, display_order, is_active, created_by, updated_by)
       VALUES (${Array.from({ length: 26 }, (_, i) => `$${i + 1}`).join(', ')}, $27, $28, $29, $29) RETURNING *`,
      [...columnValues(slide), top + 10, row.is_active, actor]
    )
  ).rows[0];
  await audit(c, { actor, action: 'carousel_slide_duplicated', entityType: 'carousel_slide', entityId: r.id, details: { heading: row.title, source_id: row.id } });
  return adminView(r);
}

/** Set the order from a complete list of slide ids (first = shown first). */
export async function reorderSlides(c, actor, ids) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('homepage_carousel_order'))");
  if (!Array.isArray(ids) || ids.length > MAX_SLIDES * 2) throw badRequest('invalid_order', 'Send the slide ids in their new order');
  const wanted = ids.map((id) => uuid(id, 'id'));
  const existing = (await c.query('SELECT id FROM homepage_carousel_slides FOR UPDATE')).rows.map((r) => r.id);
  if (new Set(wanted).size !== wanted.length || wanted.length !== existing.length || !existing.every((id) => wanted.includes(id))) {
    throw conflict('order_out_of_date', 'The slide list changed while you were reordering. Reload and try again.');
  }
  for (const [i, id] of wanted.entries()) await c.query('UPDATE homepage_carousel_slides SET display_order = $2 WHERE id = $1', [id, (i + 1) * 10]);
  await audit(c, { actor, action: 'carousel_slides_reordered', entityType: 'carousel', entityId: 'homepage', details: { order: wanted } });
  return { ok: true };
}

export async function deleteSlide(c, actor, id, { confirmed = false } = {}) {
  const row = await lockSlide(c, id);
  if (row.publication_status === 'published' && !confirmed) {
    throw conflict('confirm_required', 'This slide is published. Confirm that it should be removed from the homepage and deleted.');
  }
  await c.query('DELETE FROM homepage_carousel_slides WHERE id = $1', [row.id]);
  await audit(c, { actor, action: 'carousel_slide_deleted', entityType: 'carousel_slide', entityId: row.id, details: { heading: row.title, was_published: row.publication_status === 'published' } });
  return { deleted: true };
}

export async function saveCarouselSettings(c, actor, input) {
  const { settings, errors } = normalizeSettings({ ...(await settingsRow(c)), ...(input && typeof input === 'object' ? input : {}) }, { strict: true });
  const fields = Object.keys(errors);
  if (fields.length) throw badRequest('invalid_settings', errors[fields[0]], { fields: errors });
  const before = await settingsRow(c);
  const keys = Object.keys(DEFAULT_SETTINGS);
  await c.query(
    `INSERT INTO homepage_carousel_settings (id, ${keys.join(', ')}, updated_by, updated_at) VALUES (1, ${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}, now())
     ON CONFLICT (id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = now()`,
    [...keys.map((k) => settings[k]), actor]
  );
  const changes = Object.fromEntries(keys.filter((k) => before[k] !== settings[k]).map((k) => [k, { before: before[k], after: settings[k] }]));
  if (Object.keys(changes).length) await audit(c, { actor, action: 'carousel_settings_updated', entityType: 'carousel', entityId: 'homepage', details: changes });
  return settings;
}

// ---- Public ------------------------------------------------------------------------------

const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);

/** Published, active, in-schedule slides and the carousel settings. Never includes drafts. */
export async function publicCarousel(c) {
  const settings = await settingsRow(c);
  const rows = settings.is_enabled
    ? (await c.query(
        `SELECT id, published_content FROM homepage_carousel_slides
          WHERE publication_status = 'published' AND is_active AND published_content IS NOT NULL
          ORDER BY display_order, created_at LIMIT $1`,
        [MAX_SLIDES]
      )).rows
    : [];
  const now = Date.now();
  const slides = rows
    .map((r) => ({ id: r.id, ...normalizeSlide(r.published_content).slide }))
    .filter((s) => s.desktop_image?.url && withinSchedule(s, now))
    .map(({ starts_at, ends_at, ...s }) => s);
  return { settings: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, settings[k]])), slides };
}

/** Shared by the public API and the homepage <head> preload; cleared by every admin write. */
export const cachedPublicCarousel = (c) => cachedPublic('homepage-carousel', 30_000, () => publicCarousel(c));
