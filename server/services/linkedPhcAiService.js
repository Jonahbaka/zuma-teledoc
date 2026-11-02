'use strict';

// Canonical provider charts reuse the programme-scoped Clinical Copilot only
// when the record has an established PHC link. Never infer the link by patient
// identity and never accept a patient, programme, or facility from client input.
const database = require('../db');
const chart = require('./clinicalEncounterService');

function linkedError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

async function resolveLinkedPhcEncounter(canonicalEncounterId, clinicianId, pool = database.getPool()) {
  chart._references(canonicalEncounterId, clinicianId);
  const client = await pool.connect();
  let source;
  let context;
  try {
    await client.query('BEGIN');
    await chart._lockEncounter(client, canonicalEncounterId, clinicianId);
    const sql = [
      'SELECT e.id AS source_encounter_id, e.patient_user_id, e.programme_id, e.facility_id',
      'FROM clinical_encounters ce',
      "JOIN ng_clinical_record_links l ON l.canonical_table='clinical_encounters'",
      " AND l.canonical_id=ce.id AND l.source_table='ng_clinical_encounters'",
      " AND l.migration_status IN ('linked','verified')",
      'JOIN ng_clinical_encounters e ON e.id=l.source_id',
      ' AND e.patient_user_id=ce.patient_id AND e.programme_id=ce.programme_id',
      ' AND e.facility_id=ce.facility_id',
      "WHERE ce.id=$1 AND ce.provider_id=$2 AND ce.status='in_progress' LIMIT 1",
    ].join(' ');
    const match = await client.query(sql, [canonicalEncounterId, clinicianId]);
    source = match.rows[0];
    if (!source) {
      throw linkedError(404, 'CLINICAL_AI_CONTEXT_UNAVAILABLE', 'This clinician encounter has no eligible PHC AI context.');
    }

    const { assertProgrammeScope } = require('../../ng/services/phc/programmeScopeService');
    context = await assertProgrammeScope(client, { id: clinicianId }, {
      programmeId: source.programme_id,
      facilityId: source.facility_id,
      patientUserId: source.patient_user_id,
      requireEnrollment: true,
      allowedRoles: ['remote_clinician'],
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { sourceEncounterId: source.source_encounter_id, context };
}

async function createLinkedDraft(req, canonicalEncounterId, clinicianId, suggestionType, pool = database.getPool()) {
  const { sourceEncounterId, context } = await resolveLinkedPhcEncounter(canonicalEncounterId, clinicianId, pool);
  const ai = require('../../ng/services/phc/clinicalAiService');
  // Source service independently checks feature flag, current clinician
  // assignment, input lineage, output encryption and audit logging.
  return ai.createSuggestion(pool, req, context, { encounterId: sourceEncounterId, suggestionType });
}

async function reviewLinkedDraft(req, canonicalEncounterId, clinicianId, suggestionId, decision, pool = database.getPool()) {
  chart._references(suggestionId);
  const { sourceEncounterId, context } = await resolveLinkedPhcEncounter(canonicalEncounterId, clinicianId, pool);
  const sql = [
    'SELECT id FROM ng_clinical_ai_suggestions',
    'WHERE id=$1 AND encounter_id=$2 AND programme_id=$3 AND facility_id=$4',
    'AND patient_user_id IN (SELECT patient_user_id FROM ng_clinical_encounters',
    'WHERE id=$2 AND programme_id=$3 AND facility_id=$4)',
  ].join(' ');
  const found = await pool.query(sql, [suggestionId, sourceEncounterId, context.programme_id, context.facility_id]);
  if (!found.rows.length) {
    throw linkedError(404, 'CLINICAL_AI_CONTEXT_UNAVAILABLE', 'This draft does not belong to the selected clinician encounter.');
  }
  const ai = require('../../ng/services/phc/clinicalAiService');
  return ai.reviewSuggestion(pool, req, context, suggestionId, { ...decision, expectedEncounterId: sourceEncounterId });
}

module.exports = { resolveLinkedPhcEncounter, createLinkedDraft, reviewLinkedDraft };
