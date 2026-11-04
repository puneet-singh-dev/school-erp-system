const db = require('../config/db');

/**
 * Log an activity to activity_log table safely.
 * @param {Object} opts
 * @param {string} opts.actionType - 'CREATE'|'UPDATE'|'DELETE'|'FEE_COLLECTED'|'ATTENDANCE_MARKED'|'LOGIN'|'PROMOTION'|'OTHER'
 * @param {string} opts.entityType - 'student'|'teacher'|'fee_payment'|'attendance'|'notice'|'exam'|'class'|'other'
 * @param {number} [opts.entityId]
 * @param {string} [opts.entityName]
 * @param {string} [opts.description]
 * @param {Object} [opts.oldData] - full record snapshot before change (for restore)
 * @param {Object} [opts.newData] - record snapshot after change
 * @param {number} [opts.userId]
 * @param {string} [opts.userName]
 * @param {string} [opts.ip]
 */
async function logActivity(opts) {
  try {
    const {
      actionType = 'OTHER',
      entityType = 'other',
      entityId = null,
      entityName = null,
      description = null,
      oldData = null,
      newData = null,
      userId = null,
      userName = null,
      ip = null
    } = opts;

    await db.query(
      `INSERT INTO activity_log 
        (action_type, entity_type, entity_id, entity_name, description, old_data, new_data, performed_by, performed_by_name, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actionType,
        entityType,
        entityId,
        entityName,
        description,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        userId,
        userName,
        ip
      ]
    );
  } catch (e) {
    // Non-blocking: never crash an application route if logging fails
    console.error('[ActivityLogger] Error logging activity:', e.message);
  }
}

module.exports = { logActivity };
