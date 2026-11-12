import { log } from './log.js';

/** Append an audit record. Uses the caller's transaction client when given. */
export async function audit(client, { actor, action, entityType, entityId, details }) {
  try {
    await client.query('INSERT INTO audit_logs (auth_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)', [
      actor || null,
      action,
      entityType || null,
      entityId ? String(entityId) : null,
      JSON.stringify(log.scrub(details || {})),
    ]);
  } catch (err) {
    log.error('audit.write_failed', { action, message: err.message });
    throw err;
  }
}
