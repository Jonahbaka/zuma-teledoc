'use strict';

// External patient/administrative read boundary. Professional gateways and
// trusted workflow callers retain their own authorization paths.
const workflow = require('./prescriptionWorkflowService');
const administrativeRoles = new Set(['admin', 'administrator', 'super_admin', 'superadmin', 'platform_admin']);
const normalizeRouteRole = role => String(role || '').toLowerCase().trim().replace(/\s+/g, '_');
function category(role, current = false) {
  let normalized = normalizeRouteRole(role);
  // The mounted authentication middleware already canonicalizes this alias.
  if (current && normalized === 'super-admin') normalized = 'super_admin';
  return normalized === 'patient' ? 'patient' : administrativeRoles.has(normalized) ? 'admin' : null;
}
function fail(code, message) { return Object.assign(new Error(message), { code }); }
async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function authority(client, actor, expected) {
  const current = (await client.query('SELECT id,role FROM users WHERE id=$1 AND is_active=TRUE FOR SHARE', [actor.id])).rows[0];
  if (!current || category(current.role, true) !== expected) throw fail('FORBIDDEN', 'Prescription access denied');
  return { id: current.id, category: expected };
}
function expectedCategory(actor) {
  const expected = category(actor?.role);
  if (!actor?.id || !expected) throw fail('FORBIDDEN', 'Prescription access denied');
  return expected;
}
async function audit(client, actor, action, prescription = null, rows = null) {
  // Identify returned records without copying medication names or narratives.
  const metadata = rows && { recordCount: rows.length, records: rows.map(row => ({ id: row.id, patientId: row.patient_user_id || null })) };
  await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description,new_values)
    VALUES($1,'read','digital_prescription',$2,$3,true,true,$4,$5::jsonb)`,
  [actor.id, prescription?.id || null, prescription?.patient_user_id || null, `${actor.category === 'patient' ? 'Patient' : 'Administrative'} prescription ${action}`, metadata ? JSON.stringify(metadata) : null]);
}
async function list(pool, actor, query = {}) {
  const expected = expectedCategory(actor);
  return transaction(pool, async client => {
    const current = await authority(client, actor, expected);
    // Preserve the existing patient scope and administrative filter contract.
    const rows = await workflow.listPrescriptions({
      provider_id: expected === 'admin' ? query.provider_id : undefined,
      patient_user_id: expected === 'admin' ? query.patient_user_id : current.id,
      pharmacy_id: expected === 'admin' ? query.pharmacy_id : undefined,
      status: query.status, since: query.since,
      limit: query.limit ? Number(query.limit) : undefined,
    }, client, true);
    await audit(client, current, 'list', null, rows);
    return rows;
  });
}
async function read(pool, actor, prescriptionId, events = false) {
  const expected = expectedCategory(actor);
  return transaction(pool, async client => {
    const current = await authority(client, actor, expected);
    const prescription = (await client.query('SELECT id,patient_user_id FROM ng_digital_prescriptions WHERE id=$1 FOR SHARE', [prescriptionId])).rows[0];
    if (!prescription) throw fail('NOT_FOUND', 'Prescription not found');
    if (expected === 'patient' && prescription.patient_user_id !== current.id) throw fail('FORBIDDEN', 'Prescription access denied');
    const result = events ? await workflow.listEvents(prescription.id, client) : await workflow.getPrescription(prescription.id, client);
    if (!events && !result) throw fail('NOT_FOUND', 'Prescription not found');
    await audit(client, current, events ? 'events' : 'read', prescription);
    return result;
  });
}
function sendError(res, error) {
  if (error.code === 'FORBIDDEN') return res.status(403).json({ ok: false, error: 'Prescription access denied' });
  if (error.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'Prescription not found' });
  return res.status(503).json({ ok: false, error: 'Prescription access is temporarily unavailable.' });
}

module.exports = { list, read, sendError };
