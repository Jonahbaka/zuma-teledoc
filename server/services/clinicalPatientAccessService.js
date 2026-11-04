'use strict';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const denied = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
function references(...values) {
  if (!values.every(value => typeof value === 'string' && uuid.test(value))) throw denied(400, 'CLINICAL_REFERENCE_INVALID', 'Valid patient, actor and record references are required.');
}
async function assertClinicalPatientAccess(database, patientId, session, { providerOnly = false, lock = false, encounterId } = {}) {
  references(patientId, session?.id);
  if (!['patient', 'provider'].includes(session.role) || providerOnly && session.role !== 'provider') throw denied(403, 'CLINICAL_ACCESS_DENIED', 'Current clinical authority is required.');
  const market = String(session.marketScope || '').toUpperCase();
  if (!['US', 'NG'].includes(market)) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'The current clinical market is unavailable.');
  const actor = (await database.query(`SELECT actor.id,actor.role,actor.market_scope FROM users actor JOIN users patient ON patient.id=$1
    WHERE actor.id=$2 AND actor.role=$3 AND actor.market_scope=$4 AND actor.is_active=TRUE
      AND patient.role='patient' AND patient.is_active=TRUE AND patient.market_scope=actor.market_scope
      AND (actor.role='patient' AND actor.id=patient.id OR actor.role='provider' AND actor.provider_status='approved')
    ${lock ? 'FOR SHARE OF actor,patient' : ''}`, [patientId, session.id, session.role, market])).rows[0];
  if (!actor) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'The patient is unavailable in your current clinical context.');
  if (actor.role === 'provider') {
    if (market === 'NG' && !(await database.query(`SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' ${lock ? 'FOR SHARE' : ''}`, [actor.id])).rows.length) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'Current clinician verification is required.');
    const relationship = await database.query(`SELECT id FROM provider_patient_relationships WHERE provider_id=$1 AND patient_id=$2 AND is_active=TRUE ${lock ? 'FOR SHARE' : ''}`, [actor.id, patientId]);
    if (!relationship.rows.length) {
      const appointment = await database.query(`SELECT id FROM appointments WHERE provider_id=$1 AND patient_id=$2 AND status IN ('scheduled','confirmed','in_progress') ${lock ? 'FOR SHARE' : ''}`, [actor.id, patientId]);
      if (!appointment.rows.length) throw denied(403, 'CLINICAL_CARE_RELATIONSHIP_REQUIRED', 'An active care relationship or current owned consultation is required.');
    }
  }
  if (encounterId) {
    references(encounterId);
    if (actor.role !== 'provider' || !(await database.query(`SELECT id FROM clinical_encounters WHERE id=$1 AND patient_id=$2 AND provider_id=$3 AND status IN ('in_progress','completed') ${lock ? 'FOR SHARE' : ''}`, [encounterId, patientId, actor.id])).rows.length) throw denied(403, 'CLINICAL_ENCOUNTER_CONTEXT_DENIED', 'The clinical encounter does not belong to this patient and clinician.');
  }
  return actor;
}

module.exports = { assertClinicalPatientAccess, references, denied };
