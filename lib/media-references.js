/**
 * Every database column that can point at a stored media file. Deletion, the orphan scanner and
 * the migration all use this one list, so they always agree on whether a file is still in use.
 * `json` columns hold arrays or objects whose string values may be media references.
 */
export const MEDIA_COLUMNS = [
  { table: 'products', column: 'image_url' },
  { table: 'products', column: 'catalogue_image_url' },
  { table: 'products', column: 'images', json: true },
  { table: 'product_photos', column: 'image_url' },
  { table: 'homepage_carousel_slides', column: 'desktop_image_url' },
  { table: 'homepage_carousel_slides', column: 'mobile_image_url' },
  { table: 'homepage_carousel_slides', column: 'published_content', json: true },
  { table: 'feedback_videos', column: 'video_url' },
  { table: 'instagram_content', column: 'image_url' },
  { table: 'instagram_content', column: 'post_url' },
  { table: 'exchanges', column: 'evidence_urls', json: true },
  { table: 'story_consents', column: 'content_url' },
  // Retired "Request a Piece" feature: its rows are kept, so their attachments stay protected.
  { table: 'piece_requests', column: 'attachment_url' },
];

const present = new Map();

/** The MEDIA_COLUMNS that exist in this database (optional tables may be absent). */
export async function existingMediaColumns(c) {
  const key = 'columns';
  if (!present.has(key)) {
    const r = await c.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND (table_name, column_name) IN (${MEDIA_COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
      MEDIA_COLUMNS.flatMap((m) => [m.table, m.column])
    );
    const found = new Set(r.rows.map((x) => `${x.table_name}.${x.column_name}`));
    present.set(key, MEDIA_COLUMNS.filter((m) => found.has(`${m.table}.${m.column}`)));
  }
  return present.get(key);
}

/** For tests that create or drop tables. */
export const resetMediaColumnCache = () => present.clear();

/** How many rows reference `ref`, per column. A reference inside JSON must be a whole string value. */
export async function countReferences(c, ref) {
  const cols = await existingMediaColumns(c);
  const needle = JSON.stringify(ref);
  const parts = await Promise.all(
    cols.map(async (m) => {
      const sql = m.json
        ? `SELECT count(*)::int AS n FROM ${m.table} WHERE ${m.column} IS NOT NULL AND position($1 IN ${m.column}::text) > 0`
        : `SELECT count(*)::int AS n FROM ${m.table} WHERE ${m.column} = $1`;
      const n = (await c.query(sql, [m.json ? needle : ref])).rows[0].n;
      return [`${m.table}.${m.column}`, n];
    })
  );
  const by = Object.fromEntries(parts.filter(([, n]) => n > 0));
  return { total: Object.values(by).reduce((a, n) => a + n, 0), by };
}

/** Every distinct string value stored in the media columns (used by the orphan scanner). */
export async function allReferencedValues(c) {
  const cols = await existingMediaColumns(c);
  const values = new Set();
  for (const m of cols) {
    const sql = m.json
      ? `SELECT DISTINCT v FROM ${m.table}, LATERAL jsonb_path_query(${m.column}, 'strict $.**') AS j(x), LATERAL (SELECT x #>> '{}' AS v) s
          WHERE ${m.column} IS NOT NULL AND jsonb_typeof(x) = 'string'`
      : `SELECT DISTINCT ${m.column} AS v FROM ${m.table} WHERE ${m.column} IS NOT NULL AND ${m.column} <> ''`;
    for (const r of (await c.query(sql)).rows) values.add(r.v);
  }
  return values;
}
