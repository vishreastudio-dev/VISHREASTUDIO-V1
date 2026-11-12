import { db } from '../../lib/db.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){const r=await db.query("SELECT cp.id,cp.auth_user_id,cp.full_name,cp.phone,cp.email,cp.created_at,COALESCE(m.status,'inactive') AS membership_status,COALESCE(m.credits_balance,0) AS credits FROM customer_profiles cp LEFT JOIN memberships m ON m.auth_user_id=cp.auth_user_id ORDER BY cp.created_at DESC LIMIT 200");res.json({customers:r.rows});}