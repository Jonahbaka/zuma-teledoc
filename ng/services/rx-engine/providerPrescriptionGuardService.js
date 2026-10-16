'use strict';

const { z } = require('zod');
const { assertClinicalAccess } = require('../clinical/clinicalAccessService');

function fail(status, message) { return Object.assign(new Error(message), { status }); }
const text = (maximum, required = false) => z.string().trim().min(required ? 1 : 0).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Text contains unsupported characters.');
const reference = z.string().uuid();
const optionalReference = reference.nullish().transform((value) => value || null);
const quantity = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}, z.number().finite().int().positive().max(10000).optional());

const prescriptionSchema = z.object({
  patientUserId: reference,
  appointmentId: optionalReference,
  preferredPharmacyId: optionalReference,
  routedPharmacyId: optionalReference,
  diagnosis: text(255).optional(),
  notes: text(4000).optional(),
  fulfillmentPreference: z.enum(['pickup_or_delivery', 'pickup', 'delivery']).default('pickup_or_delivery'),
  items: z.array(z.object({
    drug_name: text(255, true),
    generic_name: text(255).optional(),
    dosage: text(255).optional(),
    frequency: text(255).optional(),
    duration: text(255).optional(),
    quantity,
    instructions: text(1000).optional(),
    notes: text(1000).optional(),
    isControlled: z.boolean().optional(),
    controlledOrSpecialHandling: z.boolean().optional(),
  }).strict()).min(1).max(20),
}).strict();

function validatePrescriptionInput(input) {
  const parsed = prescriptionSchema.safeParse(input);
  if (!parsed.success) throw fail(400, 'Check the selected patient and pharmacy, medication details, quantities, and field lengths.');
  return parsed.data;
}

async function assertProviderPrescriptionContext(client, req, input) {
  if (!req.user?.id) throw fail(401, 'Authentication required.');
  const { rows } = await client.query(
    `SELECT actor.id AS user_id, actor.role, provider.id AS provider_id
       FROM users actor
       JOIN ng_providers provider ON provider.user_id = actor.id
       JOIN users patient ON patient.id = $2
      WHERE actor.id = $1 AND actor.role = 'provider'
        AND actor.is_active = TRUE AND actor.market_scope = 'NG'
        AND actor.provider_status = 'approved' AND provider.status = 'verified'
        AND patient.role = 'patient' AND patient.market_scope = 'NG' AND patient.is_active = TRUE
      FOR SHARE OF actor, provider, patient`,
    [req.user.id, input.patientUserId]
  );
  const actor = rows[0];
  if (!actor) throw fail(403, 'Prescribing access denied for this patient.');
  const freshRequest = { ...req, user: { ...req.user, id: actor.user_id, role: actor.role } };

  if (input.appointmentId) {
    // This FK targets ng_appointments. A relationship with the patient alone
    // must never authorize attaching a different provider's or patient's visit.
    const appointment = await client.query(
      `SELECT id FROM ng_appointments
        WHERE id = $1 AND patient_user_id = $2 AND provider_id = $3
          AND status IN ('confirmed','in_progress','completed')
        FOR SHARE`,
      [input.appointmentId, input.patientUserId, actor.provider_id]
    );
    if (!appointment.rows.length) throw fail(403, 'The selected consultation is not available for this patient and clinician.');
    await assertClinicalAccess(freshRequest, { pool: client, patientUserId: input.patientUserId, appointmentId: input.appointmentId, mode: 'write' });
  } else {
    const relationship = await client.query(
      `SELECT id, 'native' AS source FROM ng_appointments
        WHERE patient_user_id = $1 AND provider_id = $2
          AND status IN ('confirmed','in_progress','completed')
       UNION ALL
       SELECT id, 'native' AS source FROM ng_clinical_encounters
        WHERE patient_user_id = $1 AND provider_user_id = $3
          AND status IN ('draft','in_progress','signed','amended')
       UNION ALL
       SELECT id, 'native' AS source FROM provider_patient_relationships
        WHERE patient_id = $1 AND provider_id = $3 AND is_active = TRUE
       UNION ALL
       SELECT id, 'shared' AS source FROM appointments
        WHERE patient_id = $1 AND provider_id = $3 AND status = 'completed'
       LIMIT 1`,
      [input.patientUserId, actor.provider_id, actor.user_id]
    );
    if (!relationship.rows.length) throw fail(403, 'An established care relationship is required before prescribing.');
    if (relationship.rows[0].source === 'native') {
      await assertClinicalAccess(freshRequest, { pool: client, patientUserId: input.patientUserId, mode: 'write' });
    }
    // Completed shared appointments are accepted only after the same fresh NG
    // provider and patient checks above; a cross-market appointment is denied.
  }

  const pharmacyIds = [...new Set([input.preferredPharmacyId, input.routedPharmacyId].filter(Boolean))];
  if (pharmacyIds.length) {
    const pharmacies = await client.query(
      `SELECT id, delivery_enabled FROM ng_pharmacies
        WHERE id = ANY($1::uuid[]) AND status = 'approved' AND account_status = 'active'
          AND pcn_license_expiry >= CURRENT_DATE
        FOR SHARE`,
      [pharmacyIds]
    );
    if (pharmacies.rows.length !== pharmacyIds.length) throw fail(409, 'Select an approved, active pharmacy with a current license.');
    const destination = input.routedPharmacyId || input.preferredPharmacyId;
    if (input.fulfillmentPreference === 'delivery' && !pharmacies.rows.find((row) => row.id === destination)?.delivery_enabled) {
      throw fail(409, 'The selected pharmacy has not enabled delivery. Choose pickup or another pharmacy.');
    }
  }
  return { providerId: actor.provider_id, providerUserId: actor.user_id };
}

module.exports = { validatePrescriptionInput, assertProviderPrescriptionContext };
