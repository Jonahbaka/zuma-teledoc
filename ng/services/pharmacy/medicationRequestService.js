'use strict';

// Availability enquiries are not dispensing records. Completion, payment and
// handover remain exclusive to the verified medication-order workflow.
const { z } = require('zod');
const compliance = require('../compliance/complianceService');
const uuid = z.string().uuid();
const openStatuses = ['pending_pharmacy_confirmation', 'pharmacy_reviewing', 'available', 'unavailable', 'clarification_requested'];
const pharmacyStatuses = openStatuses.filter(status => status !== 'pending_pharmacy_confirmation');
const text = z.string().trim().max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).nullable().optional();
const price = z.preprocess(value => value === '' ? null : value, z.union([z.number().finite(), z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/)])
  .transform(value => Number(value)).refine(value => value >= 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001).nullable().optional());
const fields = { confirmedPriceNgn: price, pharmacyNotes: text, clarificationRequest: text };
const pharmacySchema = z.object({ status: z.enum(pharmacyStatuses), pharmacyResponseNotes: text, ...fields }).strict();
const adminSchema = z.object({ status: z.enum([...openStatuses, 'cancelled']).optional(), assignedPharmacyId: uuid.nullable().optional(), adminNotes: text, ...fields }).strict();
const pharmacyColumns = `r.id,r.medicine_catalog_id,r.medicine_name,r.generic_name,r.dosage_strength,r.quantity_requested,
  r.requires_prescription,r.prescription_attached,r.fulfillment_preference,r.preferred_pharmacy_id,r.assigned_pharmacy_id,
  r.contact_name,r.phone,r.whatsapp_number,r.email,r.state,r.city,r.lga,r.notes,r.status,r.pharmacy_response_notes,
  r.pharmacy_responded_at,r.confirmed_price_ngn,r.pharmacy_notes,r.clarification_request,r.created_at,r.updated_at`;
function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
function validate(input, admin = false) {
  if (['fulfilled', 'completed'].includes(input?.status)) throw fail(409, 'MEDICATION_REQUEST_FULFILLMENT_REQUIRED', 'Availability requests cannot confirm dispensing or handover. Use the verified medication order workflow.');
  const parsed = (admin ? adminSchema : pharmacySchema).safeParse(input);
  if (!parsed.success || !Object.keys(parsed.data).length) throw fail(400, 'MEDICATION_REQUEST_INVALID', 'Supply a supported availability status and valid price or notes.');
  if (parsed.data.status === 'clarification_requested' && !parsed.data.clarificationRequest?.trim()) throw fail(400, 'MEDICATION_REQUEST_INVALID', 'Describe the clarification required.');
  return parsed.data;
}
async function transaction(pool, operation) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function actorScope(client, actor, admin) {
  if (!uuid.safeParse(actor?.id).success || !(admin ? ['admin', 'super_admin'] : ['pharmacy']).includes(actor?.role)) throw fail(403, 'MEDICATION_REQUEST_FORBIDDEN', 'Current authorized workspace access is required.');
  const current = (await client.query(`SELECT id,role FROM users WHERE id=$1 AND role=$2 AND is_active=TRUE AND market_scope='NG' FOR SHARE`, [actor.id, actor.role])).rows[0];
  if (!current) throw fail(403, 'MEDICATION_REQUEST_FORBIDDEN', 'Current authorized workspace access is required.');
  return current;
}
async function pharmacyScope(client, pharmacyId, actorId = null) {
  if (!uuid.safeParse(pharmacyId).success) throw fail(400, 'MEDICATION_REQUEST_INVALID', 'A valid pharmacy identifier is required.');
  const row = (await client.query(`SELECT id FROM ng_pharmacies WHERE id=$1
    AND ($2::uuid IS NULL OR owner_user_id=$2) AND status='approved' AND account_status='active'
    AND verified_at IS NOT NULL AND pcn_license_expiry>=CURRENT_DATE FOR SHARE`, [pharmacyId, actorId])).rows[0];
  if (!row) throw fail(403, 'MEDICATION_REQUEST_FORBIDDEN', 'An active, approved pharmacy with a current licence is required.');
}
async function audit(client, actor, pharmacyId, requestId, action, details = {}) {
  await compliance.logAction({ actorUserId: actor.id, actorType: actor.role === 'pharmacy' ? 'pharmacist' : actor.role,
    action: `medication_request.${action}`, resourceType: 'medication_request', resourceId: requestId,
    pharmacyId, details }, client);
}
async function listPharmacyRequests(pool, actor, pharmacyId, status) {
  if (status !== undefined && ![...openStatuses, 'fulfilled', 'completed', 'cancelled'].includes(status)) throw fail(400, 'MEDICATION_REQUEST_INVALID', 'Choose a supported request status.');
  return transaction(pool, async client => {
    const current = await actorScope(client, actor, false);
    await pharmacyScope(client, pharmacyId, current.id);
    const result = await client.query(`SELECT ${pharmacyColumns},d.source_name,d.source_type,d.source_reference,d.source_quality_status
      FROM ng_medication_requests r LEFT JOIN ng_drug_catalog d ON d.id=r.medicine_catalog_id
      WHERE COALESCE(r.assigned_pharmacy_id,r.preferred_pharmacy_id)=$1 AND ($2::text IS NULL OR r.status=$2)
      ORDER BY CASE r.status
        WHEN 'pending_pharmacy_confirmation' THEN 1 WHEN 'pharmacy_reviewing' THEN 2
        WHEN 'clarification_requested' THEN 3 WHEN 'available' THEN 4 WHEN 'unavailable' THEN 5
        WHEN 'fulfilled' THEN 6 WHEN 'completed' THEN 7 WHEN 'cancelled' THEN 8 ELSE 9 END,
        r.created_at DESC,r.id LIMIT 100 FOR SHARE OF r`, [pharmacyId, status || null]);
    await audit(client, current, pharmacyId, null, 'viewed', { count: result.rows.length });
    return result.rows;
  });
}
async function updateRequest(pool, actor, requestId, input, pharmacyId = null) {
  if (!uuid.safeParse(requestId).success) throw fail(400, 'MEDICATION_REQUEST_INVALID', 'A valid request identifier is required.');
  const admin = pharmacyId === null;
  const data = validate(input, admin);
  return transaction(pool, async client => {
    const current = await actorScope(client, actor, admin);
    if (!admin) await pharmacyScope(client, pharmacyId, current.id);
    const existing = (await client.query(`SELECT r.* FROM ng_medication_requests r WHERE r.id=$1
      AND ($2::uuid IS NULL OR COALESCE(r.assigned_pharmacy_id,r.preferred_pharmacy_id)=$2) FOR UPDATE`, [requestId, pharmacyId])).rows[0];
    if (!existing) throw fail(404, 'MEDICATION_REQUEST_NOT_FOUND', 'Medication request not found for this workspace.');
    if (!openStatuses.includes(existing.status)) throw fail(409, 'MEDICATION_REQUEST_CLOSED', 'Closed medication requests cannot be changed or reopened.');
    const reassigned = admin && Object.prototype.hasOwnProperty.call(data, 'assignedPharmacyId') && data.assignedPharmacyId !== existing.assigned_pharmacy_id;
    if (reassigned) {
      const destination = data.assignedPharmacyId || existing.preferred_pharmacy_id;
      if (destination) await pharmacyScope(client, destination);
      // A different pharmacy must confirm its own price and availability.
      if (data.status && data.status !== 'pending_pharmacy_confirmation' || Object.keys(fields).some(field => data[field] != null)) throw fail(409, 'MEDICATION_REQUEST_REASSIGNMENT_CONFLICT', 'Reassign the request before recording a new pharmacy response.');
    }
    const columns = { status: 'status', assignedPharmacyId: 'assigned_pharmacy_id', adminNotes: 'admin_notes',
      confirmedPriceNgn: 'confirmed_price_ngn', pharmacyNotes: 'pharmacy_notes', clarificationRequest: 'clarification_request', pharmacyResponseNotes: 'pharmacy_response_notes' };
    const values = [requestId];
    const updates = [];
    const persisted = reassigned ? { ...data, status: 'pending_pharmacy_confirmation', pharmacyResponseNotes: null,
      confirmedPriceNgn: null, pharmacyNotes: null, clarificationRequest: null } : data;
    for (const [field, value] of Object.entries(persisted)) { values.push(value); updates.push(`${columns[field]}=$${values.length}`); }
    if (reassigned) updates.push('pharmacy_responded_at=NULL');
    else if (!admin) updates.push('pharmacy_responded_at=NOW()', 'assigned_pharmacy_id=COALESCE(assigned_pharmacy_id,preferred_pharmacy_id)');
    updates.push('updated_at=NOW()');
    const row = (await client.query(`UPDATE ng_medication_requests r SET ${updates.join(',')} WHERE r.id=$1 RETURNING ${admin ? 'r.*' : pharmacyColumns}`, values)).rows[0];
    if (!row) throw fail(409, 'MEDICATION_REQUEST_CONFLICT', 'The medication request changed. Reload before responding.');
    await audit(client, current, pharmacyId || row.assigned_pharmacy_id || row.preferred_pharmacy_id, requestId, reassigned ? 'reassigned' : 'updated', { fromStatus: existing.status, status: row.status });
    return row;
  });
}
function sendError(res, error) {
  const safe = String(error.code || '').startsWith('MEDICATION_REQUEST_') && [400, 403, 404, 409].includes(error.statusCode);
  return res.status(safe ? error.statusCode : 503).json({ code: safe ? error.code : 'MEDICATION_REQUEST_UNAVAILABLE', error: safe ? error.message : 'Medication requests are temporarily unavailable. Try again later.' });
}
module.exports = { listPharmacyRequests, updateRequest, validate, sendError };
