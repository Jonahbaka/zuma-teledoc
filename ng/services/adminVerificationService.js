'use strict';

// Admin decisions and their audit entries use the same database transaction.
// JWT claims and caller-supplied market headers never determine this scope.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actionError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw actionError(400, 'A valid record ID is required.');
}

function validateReason(reason, required = false) {
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw actionError(400, 'Reason must be text.');
  }
  const value = typeof reason === 'string' ? reason.trim() : '';
  if (value.length > 1000 || (required && !value)) {
    throw actionError(400, required ? 'A reason of 1 to 1000 characters is required.' : 'Reason must be at most 1000 characters.');
  }
  return value || null;
}

function validateDecision(id, body, statusMap) {
  validateId(id);
  const action = body?.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(statusMap, action)) {
    throw actionError(400, 'Choose a supported verification action.');
  }
  return { action, status: statusMap[action], reason: validateReason(body.reason, ['reject', 'suspend'].includes(action)) };
}

async function requireCurrentNGActor(client, actorId, adminOnly = true) {
  const { rows } = await client.query(
    'SELECT id, role, market_scope, is_active FROM users WHERE id = $1 FOR SHARE', [actorId]
  );
  const actor = rows[0];
  if (!actor || !actor.is_active || actor.market_scope !== 'NG' ||
      (adminOnly && !['admin', 'super_admin'].includes(actor.role))) {
    throw actionError(403, adminOnly ? 'Current DoctaRx Nigeria administrator access is required.' : 'Current DoctaRx Nigeria account access is required.');
  }
  return actor;
}

async function requireNGRecordOwner(client, ownerId, resourceName) {
  if (!ownerId) return null; // Pending business registrations can have no signed-in owner.
  const { rows } = await client.query('SELECT id, role, market_scope FROM users WHERE id = $1 FOR SHARE', [ownerId]);
  if (!rows[0] || rows[0].market_scope !== 'NG') throw actionError(404, `${resourceName} not found in this market.`);
  return rows[0];
}

async function withActionTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function auditDecision(client, { actorId, resourceType, resourceId, action, reason, before, after }) {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id,
      phi_accessed, success, description, old_values, new_values)
     VALUES ($1, 'update', $2, $3, FALSE, TRUE, $4, $5::jsonb, $6::jsonb)`,
    [actorId, resourceType, resourceId, `DoctaRx ${resourceType}: ${action}`,
      JSON.stringify(before), JSON.stringify({ ...after, action, reason })]
  );
}

function sendActionError(res, error) {
  const known = [400, 403, 404, 409].includes(error.status);
  return res.status(known ? error.status : 500).json({
    success: false,
    error: known ? error.message : 'The decision could not be saved. No changes were committed. Please retry.',
  });
}

module.exports = { actionError, validateId, validateReason, validateDecision, requireCurrentNGActor, requireNGRecordOwner, withActionTransaction, auditDecision, sendActionError };
