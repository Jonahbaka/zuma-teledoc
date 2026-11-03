'use strict';

const { z } = require('zod');
const { hasCompleteDispensingEvidence, isQuantityReviewHeld } = require('../rx-engine/dispenseQuantityPolicy');
const compliance = require('../compliance/complianceService');
const { assertClinicalPharmacyActive } = require('./clinicalPharmacyAuthorization');
const uuid = z.string().uuid();
const states = {
  pharmacy_reviewing: ['routed', 'pending'], accepted: ['dispensing', 'accepted'],
  ready_for_pickup: ['dispensing', 'ready_for_pickup'], out_for_delivery: ['dispensing', 'out_for_delivery'],
  fulfilled: ['dispensed', 'dispensed'], unavailable: ['routed', 'unavailable'],
  clarification_requested: ['routed', 'pending_clarification'], cancelled: ['canceled', 'cancelled'],
};
const note = z.string().trim().max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).nullable().optional();
const price = z.preprocess(value => value === '' ? null : value, z.union([z.number().finite(), z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/)])
  .transform(Number).refine(value => value >= 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001).nullable().optional());
const schema = z.object({ status: z.enum(Object.keys(states)), confirmedPriceNgn: price, pharmacyNotes: note, clarificationRequest: note }).strict();
function fail(status, message) { return Object.assign(new Error(message), { status, code: 'PHARMACY_CLINICAL_INBOX_REJECTED' }); }
function validId(value) { if (!uuid.safeParse(value).success) throw fail(400, 'A valid clinical record identifier is required.'); return value; }
function validate(input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fail(400, 'Supply a supported pharmacy response and valid price or notes.');
  if (parsed.data.status === 'clarification_requested' && !parsed.data.clarificationRequest?.trim()) throw fail(400, 'Describe the clarification required.');
  return parsed.data;
}
async function transaction(pool, operation) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function assertCurrentClinicalPharmacyAccess(client, actor, pharmacyId) {
  if (!uuid.safeParse(actor?.id).success || actor?.role !== 'pharmacy') throw fail(403, 'Current pharmacy professional access is required.');
  const user = (await client.query("SELECT id,role FROM users WHERE id=$1 AND role='pharmacy' AND is_active=TRUE AND account_status='active' AND market_scope='NG' FOR SHARE", [actor.id])).rows[0];
  if (!user) throw fail(403, 'Current pharmacy professional access is required.');
  const p = (await client.query('SELECT * FROM ng_pharmacies WHERE id=$1 AND owner_user_id=$2 FOR SHARE', [validId(pharmacyId), user.id])).rows[0];
  assertClinicalPharmacyActive(p);
  return user;
}
async function audit(client, actor, pharmacyId, action, resourceId, details) {
  await compliance.logAction({ actorUserId: actor.id, actorType: 'pharmacist', action, resourceType: 'digital_prescription', resourceId, pharmacyId, details }, client);
}
async function listPrescriptions(pool, actor, pharmacyId) {
  return transaction(pool, async client => {
    const current = await assertCurrentClinicalPharmacyAccess(client, actor, pharmacyId);
    const result = await client.query(`SELECT rx.*,
      patient.first_name AS patient_first_name,patient.last_name AS patient_last_name,
      patient.email AS patient_email,patient.phone AS patient_phone,
      provider.full_name AS provider_name,provider.email AS provider_email,provider.phone AS provider_phone,provider.mdcn_number,
      pharmacy.name AS pharmacy_name,pharmacy.preferred_prescription_receiving_method
      FROM ng_digital_prescriptions rx JOIN users patient ON patient.id=rx.patient_user_id
      LEFT JOIN ng_providers provider ON provider.id=rx.provider_id
      JOIN ng_pharmacies pharmacy ON pharmacy.id=rx.routed_pharmacy_id
      WHERE rx.routed_pharmacy_id=$1 AND rx.signed_at IS NOT NULL
        AND rx.lifecycle_status IN ('sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed')
      ORDER BY CASE rx.pharmacy_response_status
        WHEN 'pending_pharmacy_confirmation' THEN 1 WHEN 'pharmacy_reviewing' THEN 2 WHEN 'clarification_requested' THEN 3
        WHEN 'accepted' THEN 4 WHEN 'ready_for_pickup' THEN 5 WHEN 'out_for_delivery' THEN 6
        WHEN 'fulfilled' THEN 7 WHEN 'unavailable' THEN 8 WHEN 'cancelled' THEN 9 ELSE 10 END,
        rx.created_at DESC,rx.id LIMIT 100 FOR SHARE OF rx`, [pharmacyId]);
    await audit(client, current, pharmacyId, 'pharmacy.prescription_inbox_viewed', null, { count: result.rows.length });
    return result.rows;
  });
}
async function listNotifications(pool, actor, pharmacyId) {
  return transaction(pool, async client => {
    const current = await assertCurrentClinicalPharmacyAccess(client, actor, pharmacyId);
    // A historical message is not ongoing authority after prescription rerouting.
    const result = await client.query(`SELECT n.id,n.notification_type,n.prescription_id,n.recipient_phone,n.status,
      n.message_preview,n.secure_action_url,n.sent_at,n.created_at,n.updated_at
      FROM ng_whatsapp_notification_log n JOIN ng_digital_prescriptions rx ON rx.id=n.prescription_id
      WHERE n.pharmacy_id=$1 AND rx.routed_pharmacy_id=$1 AND rx.signed_at IS NOT NULL
        AND rx.lifecycle_status IN ('sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed')
      ORDER BY n.created_at DESC,n.id LIMIT 25 FOR SHARE OF n,rx`, [pharmacyId]);
    await audit(client, current, pharmacyId, 'pharmacy.prescription_notifications_viewed', null, { count: result.rows.length });
    return result.rows;
  });
}
async function updateStatus(pool, actor, pharmacyId, prescriptionId, input) {
  const data = validate(input); validId(prescriptionId);
  return transaction(pool, async client => {
    const current = await assertCurrentClinicalPharmacyAccess(client, actor, pharmacyId);
    const existing = (await client.query(`SELECT * FROM ng_digital_prescriptions WHERE id=$1 AND routed_pharmacy_id=$2
      AND signed_at IS NOT NULL AND lifecycle_status IN ('sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed') FOR UPDATE`, [prescriptionId, pharmacyId])).rows[0];
    if (!existing) throw fail(404, 'Prescription not found for this pharmacy.');
    const complete = ['fully_dispensed', 'completed'].includes(existing.lifecycle_status);
    if (['fulfilled', 'cancelled'].includes(existing.pharmacy_response_status)) throw fail(409, 'This pharmacy response is closed. Use the clinical workflow for further review.');
    if ((data.status === 'fulfilled' && !complete) || (complete && data.status !== 'fulfilled') || (data.status === 'cancelled' && existing.lifecycle_status !== 'sent_to_pharmacy')) throw fail(409, 'The prescription lifecycle does not permit that response.');
    if (data.status === 'fulfilled') {
      const items = (await client.query('SELECT * FROM ng_rx_items WHERE prescription_id=$1 FOR SHARE', [prescriptionId])).rows;
      if (!hasCompleteDispensingEvidence(items) || await isQuantityReviewHeld(client, prescriptionId)) throw fail(409, 'Recorded dispensing quantities require clinical review before fulfillment can be confirmed.');
    }
    const values = [prescriptionId, pharmacyId, data.status, ...states[data.status]];
    const updates = ['pharmacy_response_status=$3::text', 'status=$4', 'dispense_status=$5'];
    for (const [key, column] of Object.entries({ confirmedPriceNgn: 'confirmed_price_ngn', pharmacyNotes: 'pharmacy_notes', clarificationRequest: 'clarification_request' })) {
      if (Object.prototype.hasOwnProperty.call(data, key)) { values.push(data[key]); updates.push(`${column}=$${values.length}`); }
    }
    updates.push("dispensed_by_pharmacy_id=CASE WHEN $3::text='fulfilled' THEN $2 ELSE dispensed_by_pharmacy_id END",
      'pharmacy_responded_at=NOW()', "ready_at=CASE WHEN $3::text='ready_for_pickup' THEN NOW() ELSE ready_at END",
      "fulfilled_at=CASE WHEN $3::text='fulfilled' THEN NOW() ELSE fulfilled_at END", "dispensed_at=CASE WHEN $3::text='fulfilled' THEN NOW() ELSE dispensed_at END",
      "cancelled_at=CASE WHEN $3::text='cancelled' THEN NOW() ELSE cancelled_at END", 'updated_at=NOW()');
    const result = await client.query(`UPDATE ng_digital_prescriptions SET ${updates.join(',')} WHERE id=$1 AND routed_pharmacy_id=$2 RETURNING *`, values);
    if (!result.rows[0]) throw fail(409, 'The prescription changed. Reload before responding.');
    await audit(client, current, pharmacyId, 'pharmacy.prescription_status_updated', prescriptionId, { fromStatus: existing.pharmacy_response_status, status: data.status });
    return { prescription: result.rows[0] };
  });
}
function sendError(res, error) {
  const safe = String(error.code || '').startsWith('PHARMACY_CLINICAL_') && [400, 403, 404, 409].includes(error.status);
  return res.status(safe ? error.status : 503).json({ error: safe ? error.message : 'The clinical pharmacy inbox is temporarily unavailable. No update was confirmed.' });
}
module.exports = { validate, listPrescriptions, listNotifications, updateStatus, sendError };
