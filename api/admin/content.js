import { db } from '../../lib/db.js';

export const access = 'admin';
// Read-only. Content writes go through /api/admin/ops?section=content, which validates media
// and enforces the published-video limit.
export const methods = ['GET'];

export default async function adminContent(req, res) {
  const [i, v, s] = await Promise.all([
    db.query('SELECT * FROM instagram_content ORDER BY sort_order, created_at DESC LIMIT 200'),
    db.query('SELECT * FROM feedback_videos ORDER BY sort_order, created_at DESC LIMIT 200'),
    db.query('SELECT * FROM store_settings ORDER BY updated_at DESC'),
  ]);
  res.json({ instagram: i.rows, feedback_videos: v.rows, store_settings: s.rows });
}
