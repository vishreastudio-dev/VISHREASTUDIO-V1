import { audit } from './audit.js';
import { badRequest, conflict, notFound, unprocessable } from './http.js';
import { bool, int, phone, text, uuid } from './validate.js';

export const TRACKING_PLACEHOLDER = '{tracking}';
const AWB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._/-]{0,78}[A-Za-z0-9])?$/;

const COLUMNS = `c.id, c.name, c.contact_person, c.contact_phone, c.website, c.tracking_url_template, c.service_description,
  c.service_areas, c.requires_tracking, c.is_pickup, c.is_active, c.sort_order, c.created_at, c.updated_at`;

function httpsUrl(value, field) {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' && u.hostname) return u;
  } catch {}
  throw badRequest(`invalid_${field}`, `${field === 'website' ? 'Website' : 'Tracking URL template'} must be a full https:// address`);
}

/**
 * Customer tracking link for an AWB, or null. The AWB is URL-encoded into the template; the result
 * must be https, so a template can never produce a script or plain-http link.
 */
export function buildTrackingUrl(template, trackingNumber) {
  const t = String(template || '').trim();
  const number = String(trackingNumber || '').trim();
  if (!t || !number) return null;
  const url = t.split(TRACKING_PLACEHOLDER).join(encodeURIComponent(number));
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** AWB / tracking number: letters, digits and simple separators, as printed by couriers. */
export function trackingNumber(value) {
  const s = text(value, { max: 80, field: 'tracking_number' });
  if (s && !AWB_RE.test(s)) throw badRequest('invalid_tracking_number', 'Tracking number may contain letters, numbers, spaces, dots, slashes, dashes and underscores');
  return s;
}

function trackingTemplate(value) {
  const s = text(value, { max: 500, field: 'tracking_url_template' });
  if (!s) return null;
  // The courier's domain must be fixed: the AWB may only change the path or query string.
  const a = httpsUrl(s.split(TRACKING_PLACEHOLDER).join('AWB0001'), 'tracking_url_template');
  const b = httpsUrl(s.split(TRACKING_PLACEHOLDER).join('ZZ9'), 'tracking_url_template');
  if (a.host !== b.host || a.username || a.password) throw badRequest('invalid_tracking_url_template', 'The tracking number may only appear in the path or query of the tracking URL');
  return s;
}

function courierInput(b, current = {}) {
  const pick = (k, fn) => (b[k] !== undefined ? fn(b[k]) : current[k] ?? null);
  const name = pick('name', (v) => text(v, { max: 80, field: 'name', required: true }));
  if (!name || name.length < 2) throw badRequest('name_required', 'Courier company name must be at least 2 characters');
  return {
    name,
    contact_person: pick('contact_person', (v) => text(v, { max: 120, field: 'contact_person' })),
    contact_phone: pick('contact_phone', (v) => phone(v)),
    website: pick('website', (v) => {
      const s = text(v, { max: 300, field: 'website' });
      return s ? httpsUrl(s, 'website').toString() : null;
    }),
    tracking_url_template: pick('tracking_url_template', trackingTemplate),
    service_description: pick('service_description', (v) => text(v, { max: 1000, field: 'service_description' })),
    service_areas: pick('service_areas', (v) => text(v, { max: 500, field: 'service_areas' })),
    requires_tracking: b.requires_tracking !== undefined ? bool(b.requires_tracking) : current.requires_tracking ?? true,
    is_pickup: b.is_pickup !== undefined ? bool(b.is_pickup) : current.is_pickup ?? false,
    is_active: b.is_active !== undefined ? bool(b.is_active) : current.is_active ?? true,
    sort_order: b.sort_order !== undefined && b.sort_order !== '' ? int(b.sort_order, { min: 0, max: 10000, field: 'sort_order' }) : current.sort_order ?? 100,
  };
}

/** Courier list for the admin screen (with how many shipments use each) or the dispatch dropdown. */
export async function listCouriers(db, { q = '', activeOnly = false } = {}) {
  const search = String(q || '').trim().toLowerCase().slice(0, 80);
  const r = await db.query(
    `SELECT ${COLUMNS},
            (SELECT count(*)::int FROM orders o WHERE o.courier_id = c.id) AS shipment_count
       FROM couriers c
      WHERE ($1 = '' OR lower(c.name) LIKE '%' || $1 || '%' OR lower(COALESCE(c.service_areas, '')) LIKE '%' || $1 || '%' OR lower(COALESCE(c.contact_person, '')) LIKE '%' || $1 || '%')
        AND (NOT $2::boolean OR c.is_active)
      ORDER BY c.is_active DESC, c.sort_order, lower(c.name)`,
    [search.replace(/[\\%_]/g, (m) => `\\${m}`), Boolean(activeOnly)]
  );
  return r.rows;
}

const duplicateName = (err) => {
  if (err?.code === '23505') throw conflict('courier_exists', 'A courier with this name already exists');
  throw err;
};

export async function saveCourier(c, actor, b) {
  if (b.id) {
    const id = uuid(b.id, 'id');
    const current = (await c.query(`SELECT ${COLUMNS} FROM couriers c WHERE c.id = $1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw notFound('courier_not_found', 'Courier not found');
    const v = courierInput(b, current);
    const row = (
      await c
        .query(
          `UPDATE couriers SET name = $2, contact_person = $3, contact_phone = $4, website = $5, tracking_url_template = $6, service_description = $7,
                  service_areas = $8, requires_tracking = $9, is_pickup = $10, is_active = $11, sort_order = $12, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [id, v.name, v.contact_person, v.contact_phone, v.website, v.tracking_url_template, v.service_description, v.service_areas, v.requires_tracking, v.is_pickup, v.is_active, v.sort_order]
        )
        .catch(duplicateName)
    ).rows[0];
    await audit(c, { actor, action: 'update_courier', entityType: 'courier', entityId: id, details: { name: v.name, is_active: v.is_active } });
    return row;
  }
  const v = courierInput(b);
  const row = (
    await c
      .query(
        `INSERT INTO couriers (name, contact_person, contact_phone, website, tracking_url_template, service_description, service_areas, requires_tracking, is_pickup, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [v.name, v.contact_person, v.contact_phone, v.website, v.tracking_url_template, v.service_description, v.service_areas, v.requires_tracking, v.is_pickup, v.is_active, v.sort_order]
      )
      .catch(duplicateName)
  ).rows[0];
  await audit(c, { actor, action: 'create_courier', entityType: 'courier', entityId: row.id, details: { name: v.name } });
  return row;
}

export async function setCourierActive(c, actor, id, active) {
  const row = (await c.query('UPDATE couriers SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *', [uuid(id, 'id'), Boolean(active)])).rows[0];
  if (!row) throw notFound('courier_not_found', 'Courier not found');
  await audit(c, { actor, action: active ? 'activate_courier' : 'deactivate_courier', entityType: 'courier', entityId: row.id, details: { name: row.name } });
  return row;
}

/** Delete only a courier no shipment has ever used; otherwise it must be deactivated. */
export async function deleteCourier(c, actor, id) {
  const cid = uuid(id, 'id');
  const row = (await c.query('SELECT id, name FROM couriers WHERE id = $1 FOR UPDATE', [cid])).rows[0];
  if (!row) throw notFound('courier_not_found', 'Courier not found');
  const used = (
    await c.query(
      `SELECT (SELECT count(*)::int FROM orders WHERE courier_id = $1 OR lower(btrim(courier_partner)) = lower(btrim($2)))
            + (SELECT count(*)::int FROM order_shipment_events WHERE courier_id = $1) AS n`,
      [cid, row.name]
    )
  ).rows[0].n;
  if (used > 0) throw conflict('courier_in_use', `${row.name} is recorded on ${used} shipment${used === 1 ? '' : 's'}. Deactivate it instead so shipment history is kept.`);
  await c.query('DELETE FROM couriers WHERE id = $1', [cid]);
  await audit(c, { actor, action: 'delete_courier', entityType: 'courier', entityId: cid, details: { name: row.name } });
  return { deleted: true };
}

/**
 * The courier a dispatch refers to, by id or (older clients) by name. A newly chosen courier must be
 * active; the courier already on the order may stay even if it was deactivated since.
 */
export async function resolveCourier(c, { id, name, currentId = null }) {
  let row;
  if (id) row = (await c.query(`SELECT ${COLUMNS} FROM couriers c WHERE c.id = $1`, [uuid(id, 'courier_id')])).rows[0];
  else row = (await c.query(`SELECT ${COLUMNS} FROM couriers c WHERE lower(btrim(c.name)) = lower(btrim($1))`, [String(name).slice(0, 80)])).rows[0];
  if (!row) throw badRequest(id ? 'invalid_courier_id' : 'invalid_courier_partner', 'Choose a courier from the courier list');
  if (!row.is_active && row.id !== currentId) throw unprocessable('courier_inactive', `${row.name} is inactive. Activate it under Couriers or choose another courier.`);
  return row;
}

/** The courier currently on an order (by id, or by the stored name for orders dispatched before 021). */
export async function orderCourier(c, order) {
  if (order.courier_id) return (await c.query(`SELECT ${COLUMNS} FROM couriers c WHERE c.id = $1`, [order.courier_id])).rows[0] || null;
  if (!order.courier_partner) return null;
  return (await c.query(`SELECT ${COLUMNS} FROM couriers c WHERE lower(btrim(c.name)) = lower(btrim($1))`, [order.courier_partner])).rows[0] || null;
}
