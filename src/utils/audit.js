import { query } from '../config/db.js';

export const logAudit = async ({
  userId = null,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  client = null
}) => {
  try {
    const sql = `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
      VALUES ($1, $2, $3, $4, $5, $6);
    `;
    const params = [
      userId,
      action,
      entityType,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ];

    if (client) {
      await client.query(sql, params);
    } else {
      await query(sql, params);
    }
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
};
