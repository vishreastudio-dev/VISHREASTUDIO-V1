import { db } from '../lib/db.js';
import { POLICIES } from '../vishrea-react/src/content/policies.js';

export const access = 'public';
export const methods = ['GET'];

function fallback(slug) {
  const page = POLICIES[slug];
  if (!page) return null;
  return { slug, title: page.title, body: page.body, updated_at: null };
}

export default async function legal(req, res) {
  const slug = typeof req.query?.slug === 'string' ? req.query.slug.slice(0, 60) : '';
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (slug) {
    const r = await db.query('SELECT slug, title, body, updated_at FROM legal_pages WHERE slug = $1', [slug]);
    return res.json({ page: r.rows[0] || fallback(slug) });
  }
  const r = await db.query('SELECT slug, title, updated_at FROM legal_pages ORDER BY slug');
  const bySlug = new Map(Object.entries(POLICIES).map(([key, page]) => [key, { slug: key, title: page.title, updated_at: null }]));
  for (const row of r.rows) bySlug.set(row.slug, row);
  res.json({ pages: [...bySlug.values()] });
}
