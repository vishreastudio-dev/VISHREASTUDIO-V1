import { db } from '../lib/db.js';
import { badRequest, h } from '../lib/http.js';
import {
  createSizeProfile,
  deleteSizeProfile,
  fetchCustomerSizeProfiles,
  setActiveProfile,
  updateSizeProfile,
} from '../lib/size-profiles.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];

export default async function sizeProfilesHandler(req, res) {
  const uid = req.user?.id;
  if (!uid) throw badRequest('auth_required', 'Please sign in to manage size profiles');

  if (req.method === 'GET') {
    const data = await fetchCustomerSizeProfiles(db, uid);
    return res.json(data);
  }

  if (req.method === 'POST') {
    const profile = await createSizeProfile(db, uid, req.body || {});
    return res.status(201).json({ ok: true, profile });
  }

  if (req.method === 'PUT') {
    const b = req.body || {};
    if (b.action === 'set_active') {
      const result = await setActiveProfile(db, uid, b.id || b.profile_id);
      return res.json(result);
    }
    const profile = await updateSizeProfile(db, uid, b.id || b.profile_id, b);
    return res.json({ ok: true, profile });
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    const result = await deleteSizeProfile(db, uid, id);
    return res.json(result);
  }
}
