'use strict';

const crypto = require('crypto');
const { decrypt, encrypt } = require('../../../lib/encryption');
const { recordProgrammeAudit } = require('./programmeScopeService');

const QUEUE_TRANSITIONS = {
  draft: new Set(['waiting', 'cancelled']),
  waiting: new Set(['claimed', 'called', 'on_hold', 'cancelled', 'no_show', 'left_without_being_seen']),
  claimed: new Set(['called', 'in_consultation', 'on_hold', 'waiting', 'cancelled']),
  called: new Set(['in_consultation', 'on_hold', 'no_show', 'waiting']),
  in_consultation: new Set(['on_hold', 'completed']),
  on_hold: new Set(['waiting', 'claimed', 'in_consultation', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
  no_show: new Set(),
  left_without_being_seen: new Set(),
};

const REFERRAL_TRANSITIONS = {
  draft: new Set(['sent', 'cancelled']),
  sent: new Set(['accepted', 'declined', 'cancelled']),
  accepted: new Set(['completed', 'cancelled']),
  declined: new Set(),
  completed: new Set(),
  cancelled: new Set(),
};

function workflowError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function hashNormalized(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function formatEncounterRecord(row) {
  if (!row) return row;
  const {
    chief_complaint_encrypted: chiefComplaintEncrypted,
    chief_complaint_iv: chiefComplaintIv,
    chief_complaint_tag: chiefComplaintTag,
    reason_for_visit_encrypted: reasonForVisitEncrypted,
    reason_for_visit_iv: reasonForVisitIv,
    reason_for_visit_tag: reasonForVisitTag,
    ...safe
  } = row;
  return {
    ...safe,
    chief_complaint: chiefComplaintEncrypted
      ? decrypt(chiefComplaintEncrypted, chiefComplaintIv, chiefComplaintTag)
      : (row.chief_complaint || null),
    reason_for_visit: reasonForVisitEncrypted
      ? decrypt(reasonForVisitEncrypted, reasonForVisitIv, reasonForVisitTag)
      : (row.reason_for_visit || null),
  };
}

function formatProtectedRecord(row, fields) {
  if (!row) return row;
  const safe = { ...row };
  for (const field of fields) {
    const encrypted = row[`${field}_encrypted`];
    const iv = row[`${field}_iv`];
    const tag = row[`${field}_tag`];
    safe[field] = encrypted ? decrypt(encrypted, iv, tag) : (row[field] || null);
    delete safe[`${field}_encrypted`];
    delete safe[`${field}_iv`];
    delete safe[`${field}_tag`];
  }
  return safe;
}

async function ensurePatientClassification(client, context, patientUserId) {
  const result = await client.query(
    `SELECT id, COALESCE(is_test_account, FALSE) AS is_test_account, is_active
       FROM users WHERE id = $1 AND role = 'patient' LIMIT 1`,
    [patientUserId]
  );
  const patient = result.rows[0];
  if (!patient?.is_active) throw workflowError(404, 'Active patient not found.', 'PATIENT_NOT_FOUND');
  if (Boolean(patient.is_test_account) !== Boolean(context.demo_only)) {
    throw workflowError(403, 'Patient classification does not match the programme.', 'DEMO_PROGRAMME_ISOLATION');
  }
  return patient;
}

async function requireEnrollment(client, context, patientUserId, { requireConsent = true } = {}) {
  const result = await client.query(
    `SELECT * FROM ng_programme_patient_enrollments
      WHERE programme_id = $1 AND facility_id = $2 AND patient_user_id = $3
        AND status IN ('active','paused','transferred')
      LIMIT 1`,
    [context.programme_id, context.facility_id, patientUserId]
  );
  const enrollment = result.rows[0];
  if (!enrollment) throw workflowError(403, 'Active programme enrollment required.', 'PROGRAMME_ENROLLMENT_REQUIRED');
  if (requireConsent && enrollment.consent_status !== 'granted') {
    throw workflowError(409, 'Current patient consent is required.', 'PATIENT_CONSENT_REQUIRED');
  }
  return enrollment;
}

async function searchPatients(pool, context, query, limit = 20) {
  const normalized = String(query || '').trim();
  if (normalized.length < 2) throw workflowError(400, 'Search requires at least two characters.', 'SEARCH_QUERY_TOO_SHORT');
  const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const result = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.date_of_birth,
            CASE WHEN u.phone IS NULL THEN NULL ELSE RIGHT(u.phone, 4) END AS phone_suffix,
            e.id AS enrollment_id, e.local_patient_number, e.status AS enrollment_status,
            e.consent_status
       FROM ng_programme_patient_enrollments e
       JOIN users u ON u.id = e.patient_user_id
      WHERE e.programme_id = $1 AND e.facility_id = $2
        AND e.status IN ('active','paused','transferred')
        AND (
          e.local_patient_number ILIKE $3 OR
          u.first_name ILIKE $3 OR u.last_name ILIKE $3 OR
          (u.first_name || ' ' || u.last_name) ILIKE $3 OR
          u.email ILIKE $3 OR u.phone ILIKE $3
        )
      ORDER BY u.last_name, u.first_name
      LIMIT $4`,
    [context.programme_id, context.facility_id, `%${normalized}%`, cappedLimit]
  );
  return result.rows;
}

async function enrollPatient(pool, req, context, {
  patientUserId,
  localPatientNumber,
  consentStatus,
  consentVersion,
  signatureEvidence = {},
}) {
  return withTransaction(pool, async (client) => {
    await ensurePatientClassification(client, context, patientUserId);
    const existing = await client.query(
      `SELECT * FROM ng_programme_patient_enrollments
        WHERE programme_id = $1 AND patient_user_id = $2
          AND status IN ('pending','active','paused','transferred')
        FOR UPDATE`,
      [context.programme_id, patientUserId]
    );

    let enrollment;
    if (existing.rows.length) {
      const updated = await client.query(
        `UPDATE ng_programme_patient_enrollments
            SET facility_id = $1,
                local_patient_number = COALESCE($2, local_patient_number),
                status = 'active',
                consent_status = $3,
                consent_version = $4,
                consented_at = CASE WHEN $3 = 'granted' THEN NOW() ELSE consented_at END,
                consented_by = CASE WHEN $3 = 'granted' THEN $5 ELSE consented_by END,
                metadata_json = metadata_json || $6::JSONB,
                updated_at = NOW()
          WHERE id = $7
          RETURNING *`,
        [
          context.facility_id,
          localPatientNumber || null,
          consentStatus,
          consentVersion,
          context.userId,
          JSON.stringify({ signatureEvidence }),
          existing.rows[0].id,
        ]
      );
      enrollment = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO ng_programme_patient_enrollments
           (programme_id, patient_user_id, facility_id, local_patient_number,
            status, consent_status, consent_version, consented_at, consented_by,
            enrolled_by, metadata_json)
         VALUES ($1,$2,$3,$4,'active',$5,$6,
                 CASE WHEN $5 = 'granted' THEN NOW() ELSE NULL END,
                 CASE WHEN $5 = 'granted' THEN $7 ELSE NULL END,
                 $7,$8::JSONB)
         RETURNING *`,
        [
          context.programme_id,
          patientUserId,
          context.facility_id,
          localPatientNumber || null,
          consentStatus,
          consentVersion,
          context.userId,
          JSON.stringify({ signatureEvidence }),
        ]
      );
      enrollment = inserted.rows[0];
    }

    await recordProgrammeAudit(client, req, context, {
      action: existing.rows.length ? 'enrollment_updated' : 'patient_enrolled',
      resourceType: 'programme_patient_enrollment',
      resourceId: enrollment.id,
      patientUserId,
      purpose: 'PHC programme enrollment',
      dataClass: 'sensitive',
      metadata: { consentStatus, consentVersion },
    });
    return enrollment;
  });
}

async function createEncounter(pool, req, context, {
  clientEncounterId = null,
  patientUserId,
  encounterType = 'phc_assisted_telehealth',
  chiefComplaint,
  reasonForVisit,
  identityVerified = false,
  identityVerificationMethod = null,
  idempotencyKey,
}) {
  return withTransaction(pool, async (client) => {
    const existing = await client.query(
      `SELECT e.*, l.canonical_id
         FROM ng_clinical_encounters e
         LEFT JOIN ng_clinical_record_links l
           ON l.source_table = 'ng_clinical_encounters' AND l.source_id = e.id
        WHERE e.programme_id = $1 AND e.idempotency_key = $2
        LIMIT 1`,
      [context.programme_id, idempotencyKey]
    );
    if (existing.rows.length) return formatEncounterRecord(existing.rows[0]);

    const enrollment = await requireEnrollment(client, context, patientUserId);
    const encryptedChiefComplaint = encrypt(chiefComplaint || null);
    const encryptedReasonForVisit = encrypt(reasonForVisit || null);
    const ngEncounter = await client.query(
      `INSERT INTO ng_clinical_encounters
         (id, patient_user_id, provider_user_id, hospital_id, encounter_type,
          status, reason_for_visit, chief_complaint, started_at,
          reason_for_visit_encrypted, reason_for_visit_iv, reason_for_visit_tag,
          chief_complaint_encrypted, chief_complaint_iv, chief_complaint_tag,
          programme_id, facility_id, programme_facility_id, enrollment_id,
          opened_by_user_id, idempotency_key, metadata)
       VALUES (COALESCE($1,gen_random_uuid()),$2,NULL,$3,$4,'draft',NULL,NULL,NOW(),
               $5,$6,$7,$8,$9,$10,$11,$3,$12,$13,$14,$15,$16::JSONB)
       RETURNING *`,
      [
        clientEncounterId,
        patientUserId,
        context.facility_id,
        encounterType,
        encryptedReasonForVisit.encrypted,
        encryptedReasonForVisit.iv,
        encryptedReasonForVisit.tag,
        encryptedChiefComplaint.encrypted,
        encryptedChiefComplaint.iv,
        encryptedChiefComplaint.tag,
        context.programme_id,
        context.programme_facility_id,
        enrollment.id,
        context.userId,
        idempotencyKey,
        JSON.stringify({ identityVerified, identityVerificationMethod }),
      ]
    );

    const coreEncounter = await client.query(
      `INSERT INTO clinical_encounters
         (patient_id, provider_id, encounter_type, encounter_start_time,
          patient_location_state, identity_verified, identity_verification_method,
          chief_complaint, chief_complaint_encrypted, chief_complaint_iv,
          chief_complaint_tag, status, programme_id, facility_id,
          programme_facility_id, source_system, source_record_id,
          idempotency_key, record_version)
       VALUES ($1,NULL,$2,NOW(),NULL,$3,$4,NULL,$5,$6,$7,'in_progress',$8,$9,$10,
               'doctarx_ng',$11,$12,1)
       RETURNING *`,
      [
        patientUserId,
        encounterType,
        identityVerified,
        identityVerificationMethod,
        encryptedChiefComplaint.encrypted,
        encryptedChiefComplaint.iv,
        encryptedChiefComplaint.tag,
        context.programme_id,
        context.facility_id,
        context.programme_facility_id,
        ngEncounter.rows[0].id,
        idempotencyKey,
      ]
    );

    await client.query(
      `INSERT INTO ng_clinical_record_links
         (source_table, source_id, canonical_table, canonical_id,
          migration_status, metadata_json)
       VALUES ('ng_clinical_encounters',$1,'clinical_encounters',$2,'verified',$3::JSONB)`,
      [ngEncounter.rows[0].id, coreEncounter.rows[0].id, JSON.stringify({ createdTogether: true })]
    );

    await recordProgrammeAudit(client, req, context, {
      action: 'encounter_created',
      resourceType: 'clinical_encounter',
      resourceId: ngEncounter.rows[0].id,
      patientUserId,
      purpose: 'PHC care delivery',
      dataClass: 'sensitive',
      metadata: { canonicalEncounterId: coreEncounter.rows[0].id },
    });

    return formatEncounterRecord({ ...ngEncounter.rows[0], canonical_id: coreEncounter.rows[0].id });
  });
}

async function getEncounter(pool, context, encounterId) {
  const result = await pool.query(
    `SELECT e.*, l.canonical_id, u.first_name AS patient_first_name,
            u.last_name AS patient_last_name, pe.local_patient_number,
            q.id AS queue_entry_id, q.status AS queue_status,
            q.assigned_provider_user_id
       FROM ng_clinical_encounters e
       JOIN users u ON u.id = e.patient_user_id
       JOIN ng_programme_patient_enrollments pe ON pe.id = e.enrollment_id
       LEFT JOIN ng_clinical_record_links l
         ON l.source_table = 'ng_clinical_encounters' AND l.source_id = e.id
       LEFT JOIN ng_phc_queue_entries q ON q.encounter_id = e.id
      WHERE e.id = $1 AND e.programme_id = $2 AND e.facility_id = $3
      LIMIT 1`,
    [encounterId, context.programme_id, context.facility_id]
  );
  if (!result.rows.length) throw workflowError(404, 'Encounter not found.', 'ENCOUNTER_NOT_FOUND');
  return formatEncounterRecord(result.rows[0]);
}

async function createObservation(pool, req, context, {
  encounterId,
  observationCode,
  displayName,
  valueType,
  valueNumeric = null,
  valueNumericSecondary = null,
  valueText = null,
  valueCode = null,
  unit = null,
  method = 'manual',
  deviceId = null,
  ingestionEventId = null,
  observedAt,
  idempotencyKey,
  provenance = {},
}) {
  return withTransaction(pool, async (client) => {
    const encounter = await getEncounter(client, context, encounterId);
    const existing = await client.query(
      `SELECT * FROM ng_clinical_observations
        WHERE programme_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [context.programme_id, idempotencyKey]
    );
    if (existing.rows.length) return existing.rows[0];

    if (method === 'device') {
      if (!deviceId) throw workflowError(400, 'deviceId is required for device observations.', 'DEVICE_ID_REQUIRED');
      const device = await client.query(
        `SELECT id FROM ng_clinical_devices
          WHERE id = $1 AND programme_id = $2 AND facility_id = $3
            AND status = 'active' AND calibration_status IN ('current','not_required')`,
        [deviceId, context.programme_id, context.facility_id]
      );
      if (!device.rows.length) throw workflowError(409, 'Device is not ready for clinical use.', 'DEVICE_NOT_READY');
    }

    const protectedValueText = encrypt(valueText || null);
    const result = await client.query(
      `INSERT INTO ng_clinical_observations
         (programme_id, facility_id, patient_user_id, encounter_id,
          observation_code, display_name, value_type, value_numeric,
          value_numeric_secondary, value_text, value_text_encrypted,
          value_text_iv, value_text_tag, value_code, unit,
          method, device_id, ingestion_event_id, status, observed_at, entered_by,
          provenance_json, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,
               'preliminary',$18,$19,$20::JSONB,$21)
       RETURNING *`,
      [
        context.programme_id,
        context.facility_id,
        encounter.patient_user_id,
        encounterId,
        observationCode,
        displayName,
        valueType,
        valueNumeric,
        valueNumericSecondary,
        protectedValueText.encrypted,
        protectedValueText.iv,
        protectedValueText.tag,
        valueCode,
        unit,
        method,
        deviceId,
        ingestionEventId,
        observedAt,
        context.userId,
        JSON.stringify(provenance),
        idempotencyKey,
      ]
    );

    await recordProgrammeAudit(client, req, context, {
      action: 'observation_recorded',
      resourceType: 'clinical_observation',
      resourceId: result.rows[0].id,
      patientUserId: encounter.patient_user_id,
      purpose: 'PHC clinical intake',
      dataClass: 'sensitive',
      metadata: { observationCode, method },
    });
    return formatProtectedRecord(result.rows[0], ['value_text']);
  });
}

async function listObservations(pool, context, encounterId) {
  const encounter = await getEncounter(pool, context, encounterId);
  const result = await pool.query(
    `SELECT * FROM ng_clinical_observations
      WHERE encounter_id = $1 AND programme_id = $2 AND facility_id = $3
      ORDER BY observed_at, created_at`,
    [encounterId, context.programme_id, context.facility_id]
  );
  return {
    encounter,
    observations: result.rows.map((row) => formatProtectedRecord(row, ['value_text'])),
  };
}

async function enqueueEncounter(pool, req, context, {
  encounterId,
  requestedSpecialty = null,
  priority = 'routine',
  priorityScore = 50,
  dueAt = null,
  idempotencyKey,
}) {
  return withTransaction(pool, async (client) => {
    const encounter = await getEncounter(client, context, encounterId);
    const existing = await client.query(
      `SELECT * FROM ng_phc_queue_entries
        WHERE encounter_id = $1 OR (programme_id = $2 AND idempotency_key = $3)
        LIMIT 1`,
      [encounterId, context.programme_id, idempotencyKey]
    );
    if (existing.rows.length) return existing.rows[0];

    const result = await client.query(
      `INSERT INTO ng_phc_queue_entries
         (programme_id, facility_id, programme_facility_id, enrollment_id,
          patient_user_id, encounter_id, requested_specialty, priority,
          priority_score, status, due_at, idempotency_key, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting',$10,$11,'{}'::JSONB)
       RETURNING *`,
      [
        context.programme_id,
        context.facility_id,
        context.programme_facility_id,
        encounter.enrollment_id,
        encounter.patient_user_id,
        encounterId,
        requestedSpecialty,
        priority,
        priorityScore,
        dueAt,
        idempotencyKey,
      ]
    );
    await client.query(
      `INSERT INTO ng_phc_queue_events
         (queue_entry_id, actor_user_id, from_status, to_status, reason)
       VALUES ($1,$2,'draft','waiting','PHC intake submitted')`,
      [result.rows[0].id, context.userId]
    );
    await client.query(
      `UPDATE ng_clinical_encounters SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1`,
      [encounterId]
    );
    await recordProgrammeAudit(client, req, context, {
      action: 'queue_entered',
      resourceType: 'phc_queue_entry',
      resourceId: result.rows[0].id,
      patientUserId: encounter.patient_user_id,
      purpose: 'Remote clinician dispatch',
      dataClass: 'sensitive',
      metadata: { priority, requestedSpecialty },
    });
    return result.rows[0];
  });
}

async function listQueue(pool, context, { status = null, limit = 100 } = {}) {
  const params = [context.programme_id, context.facility_id];
  let statusSql = '';
  if (status) {
    params.push(status);
    statusSql = `AND q.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const result = await pool.query(
    `SELECT q.*, u.first_name AS patient_first_name, u.last_name AS patient_last_name,
            pe.local_patient_number, e.chief_complaint,
            e.chief_complaint_encrypted, e.chief_complaint_iv, e.chief_complaint_tag,
            l.canonical_id AS canonical_encounter_id
       FROM ng_phc_queue_entries q
       JOIN users u ON u.id = q.patient_user_id
       JOIN ng_programme_patient_enrollments pe ON pe.id = q.enrollment_id
       JOIN ng_clinical_encounters e ON e.id = q.encounter_id
       LEFT JOIN ng_clinical_record_links l
         ON l.source_table='ng_clinical_encounters' AND l.source_id=e.id
      WHERE q.programme_id = $1 AND q.facility_id = $2 ${statusSql}
      ORDER BY CASE q.priority
                 WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1
                 WHEN 'priority' THEN 2 ELSE 3 END,
               q.priority_score DESC, q.entered_at
      LIMIT $${params.length}`,
    params
  );
  return result.rows.map(formatEncounterRecord);
}

async function assertClinicianEligible(client, context) {
  const result = await client.query(
    `SELECT a.id AS assignment_id, a.provider_id, a.capacity, a.specialty
       FROM ng_clinician_programme_assignments a
       JOIN ng_providers p ON p.id = a.provider_id
      WHERE a.provider_user_id = $1
        AND a.programme_id = $2
        AND (a.facility_id IS NULL OR a.facility_id = $3)
        AND a.status = 'active'
        AND (a.effective_at IS NULL OR a.effective_at <= NOW())
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
        AND p.status = 'verified' AND p.is_available = TRUE
        AND EXISTS (
          SELECT 1 FROM ng_provider_credentials c
           WHERE c.provider_user_id = a.provider_user_id
             AND c.status = 'verified'
             AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE)
             AND (c.expires_on IS NULL OR c.expires_on >= CURRENT_DATE)
        )
        AND NOT EXISTS (
          SELECT 1 FROM provider_time_off t
           WHERE t.provider_id = a.provider_user_id
             AND NOW() BETWEEN t.start_datetime AND t.end_datetime
        )
      ORDER BY CASE WHEN a.facility_id = $3 THEN 0 ELSE 1 END
      LIMIT 1`,
    [context.userId, context.programme_id, context.facility_id]
  );
  if (!result.rows.length) {
    throw workflowError(403, 'Clinician is not currently eligible for this programme queue.', 'CLINICIAN_NOT_ELIGIBLE');
  }
  return result.rows[0];
}

async function claimQueueEntry(pool, req, context, { queueEntryId = null } = {}) {
  return withTransaction(pool, async (client) => {
    const eligibility = await assertClinicianEligible(client, context);
    const params = [context.programme_id, context.facility_id];
    let targetSql = '';
    if (queueEntryId) {
      params.push(queueEntryId);
      targetSql = `AND id = $${params.length}`;
    }
    const selected = await client.query(
      `SELECT * FROM ng_phc_queue_entries
        WHERE programme_id = $1 AND facility_id = $2
          AND status = 'waiting' ${targetSql}
          AND (requested_specialty IS NULL OR requested_specialty = $${params.push(eligibility.specialty)})
        ORDER BY priority_score DESC, entered_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      params
    );
    if (!selected.rows.length) throw workflowError(404, 'No eligible waiting encounter found.', 'QUEUE_ENTRY_NOT_FOUND');

    const updated = await client.query(
      `UPDATE ng_phc_queue_entries
          SET status = 'claimed', assigned_provider_user_id = $1,
              claimed_by = $1, claimed_at = NOW(), record_version = record_version + 1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [context.userId, selected.rows[0].id]
    );
    await client.query(
      `UPDATE ng_clinical_encounters SET provider_user_id = $1, updated_at = NOW()
        WHERE id = $2`,
      [context.userId, selected.rows[0].encounter_id]
    );
    await client.query(
      `UPDATE clinical_encounters SET provider_id = $1, updated_at = NOW()
        WHERE source_system = 'doctarx_ng' AND source_record_id = $2`,
      [context.userId, selected.rows[0].encounter_id]
    );
    await client.query(
      `INSERT INTO provider_patient_relationships
         (provider_id, patient_id, relationship_type, established_encounter_id)
       SELECT $1, q.patient_user_id, 'treating', l.canonical_id
         FROM ng_phc_queue_entries q
         JOIN ng_clinical_record_links l
           ON l.source_table='ng_clinical_encounters' AND l.source_id=q.encounter_id
        WHERE q.id=$2
       ON CONFLICT (provider_id, patient_id, relationship_type) DO UPDATE SET
         is_active=TRUE,
         established_encounter_id=COALESCE(
           provider_patient_relationships.established_encounter_id,
           EXCLUDED.established_encounter_id
         )`,
      [context.userId, selected.rows[0].id]
    );
    await client.query(
      `INSERT INTO ng_phc_queue_events
         (queue_entry_id, actor_user_id, from_status, to_status, reason, metadata_json)
       VALUES ($1,$2,'waiting','claimed','Clinician accepted encounter',$3::JSONB)`,
      [updated.rows[0].id, context.userId, JSON.stringify({ assignmentId: eligibility.assignment_id })]
    );
    await recordProgrammeAudit(client, req, context, {
      action: 'queue_claimed',
      resourceType: 'phc_queue_entry',
      resourceId: updated.rows[0].id,
      patientUserId: updated.rows[0].patient_user_id,
      purpose: 'Remote clinician assignment',
      dataClass: 'sensitive',
    });
    return updated.rows[0];
  });
}

async function transitionQueueEntry(pool, req, context, {
  queueEntryId,
  toStatus,
  reason = null,
  expectedVersion,
}) {
  return withTransaction(pool, async (client) => {
    const currentResult = await client.query(
      `SELECT * FROM ng_phc_queue_entries
        WHERE id = $1 AND programme_id = $2 AND facility_id = $3
        FOR UPDATE`,
      [queueEntryId, context.programme_id, context.facility_id]
    );
    const current = currentResult.rows[0];
    if (!current) throw workflowError(404, 'Queue entry not found.', 'QUEUE_ENTRY_NOT_FOUND');
    if (expectedVersion != null && Number(current.record_version) !== Number(expectedVersion)) {
      throw workflowError(409, 'Queue entry has changed. Refresh before retrying.', 'RECORD_VERSION_CONFLICT');
    }
    if (!QUEUE_TRANSITIONS[current.status]?.has(toStatus)) {
      throw workflowError(409, `Queue transition ${current.status} -> ${toStatus} is not allowed.`, 'INVALID_QUEUE_TRANSITION');
    }
    if (current.assigned_provider_user_id
      && ['called', 'in_consultation', 'completed'].includes(toStatus)
      && String(current.assigned_provider_user_id) !== String(context.userId)) {
      throw workflowError(403, 'Only the assigned clinician may advance this encounter.', 'ASSIGNED_CLINICIAN_REQUIRED');
    }
    if (toStatus === 'claimed') {
      throw workflowError(409, 'Use the clinician claim operation to claim a queue entry.', 'QUEUE_CLAIM_OPERATION_REQUIRED');
    }
    if (['called', 'in_consultation', 'completed'].includes(toStatus)
      && (!current.assigned_provider_user_id
        || String(current.assigned_provider_user_id) !== String(context.userId)
        || context.programmeRole !== 'remote_clinician')) {
      throw workflowError(403, 'Only the assigned remote clinician may advance this encounter.', 'ASSIGNED_CLINICIAN_REQUIRED');
    }

    let canonicalEncounterId = null;
    if (toStatus === 'completed') {
      const signoffResult = await client.query(
        `SELECT l.canonical_id
           FROM ng_clinical_record_links l
           JOIN clinical_notes n ON n.encounter_id=l.canonical_id
          WHERE l.source_table='ng_clinical_encounters'
            AND l.source_id=$1
            AND n.provider_id=$2
            AND n.is_signed=TRUE
          ORDER BY n.signed_at DESC
          LIMIT 1`,
        [current.encounter_id, context.userId]
      );
      canonicalEncounterId = signoffResult.rows[0]?.canonical_id || null;
      if (!canonicalEncounterId) {
        throw workflowError(409, 'A signed clinician note is required before completing the consultation.', 'CLINICAL_SIGNOFF_REQUIRED');
      }
    }

    const result = await client.query(
      `UPDATE ng_phc_queue_entries
          SET status = $1,
              hold_reason = CASE WHEN $1 = 'on_hold' THEN $2 ELSE hold_reason END,
              consultation_started_at = CASE WHEN $1 = 'in_consultation' THEN NOW() ELSE consultation_started_at END,
              completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
              record_version = record_version + 1,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [toStatus, reason, queueEntryId]
    );
    await client.query(
      `INSERT INTO ng_phc_queue_events
         (queue_entry_id, actor_user_id, from_status, to_status, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [queueEntryId, context.userId, current.status, toStatus, reason]
    );
    if (toStatus === 'on_hold') {
      await client.query(
        `UPDATE ng_clinical_encounters
            SET suspended_at = NOW(), suspension_reason = $1, updated_at = NOW()
          WHERE id = $2`,
        [reason, current.encounter_id]
      );
    } else if (current.status === 'on_hold') {
      await client.query(
        `UPDATE ng_clinical_encounters
            SET resumed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [current.encounter_id]
      );
    }
    if (toStatus === 'completed') {
      await client.query(
        `UPDATE ng_clinical_encounters
            SET status='signed', signed_at=NOW(), ended_at=NOW(), updated_at=NOW()
          WHERE id=$1`,
        [current.encounter_id]
      );
      await client.query(
        `UPDATE clinical_encounters
            SET status='completed', encounter_end=NOW(), encounter_end_time=NOW(), updated_at=NOW()
          WHERE id=$1 AND provider_id=$2`,
        [canonicalEncounterId, context.userId]
      );
    }

    await recordProgrammeAudit(client, req, context, {
      action: 'queue_transition',
      resourceType: 'phc_queue_entry',
      resourceId: queueEntryId,
      patientUserId: current.patient_user_id,
      purpose: 'PHC queue management',
      dataClass: 'sensitive',
      metadata: { fromStatus: current.status, toStatus, reason },
    });
    return result.rows[0];
  });
}

async function createFollowUp(pool, req, context, {
  patientUserId,
  encounterId = null,
  referralId = null,
  taskType,
  title,
  instructions = null,
  priority = 'routine',
  assignedRole = null,
  assignedUserId = null,
  dueAt = null,
  idempotencyKey,
}) {
  return withTransaction(pool, async (client) => {
    await requireEnrollment(client, context, patientUserId, { requireConsent: false });
    const existing = await client.query(
      `SELECT * FROM ng_follow_up_tasks
        WHERE programme_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [context.programme_id, idempotencyKey]
    );
    if (existing.rows.length) return formatProtectedRecord(existing.rows[0], ['title', 'instructions']);
    const protectedTitle = encrypt(title);
    const protectedInstructions = encrypt(instructions || null);
    const result = await client.query(
      `INSERT INTO ng_follow_up_tasks
         (programme_id, facility_id, patient_user_id, encounter_id, referral_id,
          task_type, title, title_encrypted, title_iv, title_tag,
          instructions, instructions_encrypted,
          instructions_iv, instructions_tag, priority, assigned_role,
          assigned_user_id, due_at, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        context.programme_id, context.facility_id, patientUserId, encounterId,
        referralId, taskType, protectedTitle.encrypted, protectedTitle.iv, protectedTitle.tag,
        protectedInstructions.encrypted,
        protectedInstructions.iv, protectedInstructions.tag, priority, assignedRole,
        assignedUserId, dueAt, idempotencyKey, context.userId,
      ]
    );
    await recordProgrammeAudit(client, req, context, {
      action: 'follow_up_created',
      resourceType: 'follow_up_task',
      resourceId: result.rows[0].id,
      patientUserId,
      purpose: 'Care continuity',
      dataClass: 'sensitive',
    });
    return formatProtectedRecord(result.rows[0], ['title', 'instructions']);
  });
}

async function listFollowUps(pool, context, { status = null, patientUserId = null, limit = 100 } = {}) {
  const params = [context.programme_id, context.facility_id];
  const filters = [];
  if (status) { params.push(status); filters.push(`t.status = $${params.length}`); }
  if (patientUserId) { params.push(patientUserId); filters.push(`t.patient_user_id = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const result = await pool.query(
    `SELECT t.*, u.first_name AS patient_first_name, u.last_name AS patient_last_name,
            e.local_patient_number
       FROM ng_follow_up_tasks t
       JOIN users u ON u.id = t.patient_user_id
       LEFT JOIN ng_programme_patient_enrollments e
         ON e.programme_id = t.programme_id AND e.patient_user_id = t.patient_user_id
      WHERE t.programme_id = $1 AND t.facility_id = $2
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY t.due_at NULLS LAST, t.created_at
      LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => formatProtectedRecord(row, ['title', 'instructions']));
}

async function createReferral(pool, req, context, {
  patientUserId,
  encounterId,
  targetOrganizationId = null,
  targetHospitalId = null,
  targetName = null,
  destinationType = 'internal',
  referralType = 'specialist',
  priority = 'routine',
  reason,
  clinicalNotes = null,
  dueAt = null,
  idempotencyKey,
}) {
  return withTransaction(pool, async (client) => {
    await requireEnrollment(client, context, patientUserId);
    const encounter = await getEncounter(client, context, encounterId);
    if (String(encounter.patient_user_id) !== String(patientUserId)) {
      throw workflowError(409, 'Encounter patient does not match referral patient.', 'PATIENT_ENCOUNTER_MISMATCH');
    }
    const existing = await client.query(
      `SELECT * FROM ng_referrals WHERE programme_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [context.programme_id, idempotencyKey]
    );
    if (existing.rows.length) return formatProtectedRecord(existing.rows[0], ['reason', 'clinical_notes', 'response_summary']);
    const protectedReason = encrypt(reason || null);
    const protectedClinicalNotes = encrypt(clinicalNotes || null);
    const result = await client.query(
      `INSERT INTO ng_referrals
         (patient_user_id, provider_user_id, target_organization_id,
          target_hospital_id, encounter_id, target_name, destination_type,
          referral_type, priority, status, reason, clinical_notes,
          reason_encrypted, reason_iv, reason_tag,
          clinical_notes_encrypted, clinical_notes_iv, clinical_notes_tag,
          programme_id, facility_id, programme_facility_id, due_at,
          idempotency_key, audit_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',NULL,NULL,
               $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::JSONB)
       RETURNING *`,
      [
        patientUserId, context.userId, targetOrganizationId, targetHospitalId,
        encounterId, targetName, destinationType, referralType, priority,
        protectedReason.encrypted, protectedReason.iv, protectedReason.tag,
        protectedClinicalNotes.encrypted, protectedClinicalNotes.iv, protectedClinicalNotes.tag,
        context.programme_id, context.facility_id,
        context.programme_facility_id, dueAt, idempotencyKey,
        JSON.stringify({ createdByProgrammeRole: context.programmeRole }),
      ]
    );
    const protectedEventNotes = encrypt(reason || null);
    await client.query(
      `INSERT INTO ng_referral_events
         (referral_id, actor_user_id, from_status, to_status, event_type,
          notes, notes_encrypted, notes_iv, notes_tag)
       VALUES ($1,$2,NULL,'draft','created',NULL,$3,$4,$5)`,
      [result.rows[0].id, context.userId,
        protectedEventNotes.encrypted, protectedEventNotes.iv, protectedEventNotes.tag]
    );
    await recordProgrammeAudit(client, req, context, {
      action: 'referral_created',
      resourceType: 'referral',
      resourceId: result.rows[0].id,
      patientUserId,
      purpose: 'Care coordination',
      dataClass: 'sensitive',
    });
    return formatProtectedRecord(result.rows[0], ['reason', 'clinical_notes', 'response_summary']);
  });
}

async function listReferrals(pool, context, { status = null, limit = 100 } = {}) {
  const params = [context.programme_id, context.facility_id];
  let statusSql = '';
  if (status) {
    params.push(status);
    statusSql = `AND r.status=$${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const result = await pool.query(
    `SELECT r.id, r.patient_user_id, r.provider_user_id, r.encounter_id,
            r.target_name, r.destination_type, r.referral_type, r.priority,
            r.status, r.reason, r.response_summary, r.due_at,
            r.reason_encrypted, r.reason_iv, r.reason_tag,
            r.response_summary_encrypted, r.response_summary_iv, r.response_summary_tag,
            r.completed_at, r.created_at, r.updated_at,
            u.first_name AS patient_first_name, u.last_name AS patient_last_name,
            e.local_patient_number
       FROM ng_referrals r
       JOIN users u ON u.id=r.patient_user_id
       LEFT JOIN ng_programme_patient_enrollments e
         ON e.programme_id=r.programme_id AND e.facility_id=r.facility_id
        AND e.patient_user_id=r.patient_user_id
      WHERE r.programme_id=$1 AND r.facility_id=$2 ${statusSql}
      ORDER BY CASE r.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
               r.due_at NULLS LAST, r.created_at
      LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => formatProtectedRecord(row, ['reason', 'response_summary']));
}

async function transitionReferral(pool, req, context, {
  referralId,
  toStatus,
  responseSummary = null,
}) {
  return withTransaction(pool, async (client) => {
    const currentResult = await client.query(
      `SELECT * FROM ng_referrals
        WHERE id=$1 AND programme_id=$2 AND facility_id=$3
        FOR UPDATE`,
      [referralId, context.programme_id, context.facility_id]
    );
    const current = currentResult.rows[0];
    if (!current) throw workflowError(404, 'Referral not found.', 'REFERRAL_NOT_FOUND');
    if (!REFERRAL_TRANSITIONS[current.status]?.has(toStatus)) {
      throw workflowError(409, `Referral transition ${current.status} -> ${toStatus} is not allowed.`, 'INVALID_REFERRAL_TRANSITION');
    }
    if (context.programmeRole === 'remote_clinician'
      && String(current.provider_user_id) !== String(context.userId)) {
      throw workflowError(403, 'Only the referring clinician may change this referral.', 'REFERRING_CLINICIAN_REQUIRED');
    }
    if (['declined', 'cancelled', 'completed'].includes(toStatus)
      && (!responseSummary || responseSummary.trim().length < 3)) {
      throw workflowError(400, 'An outcome or reason is required for this referral status.', 'REFERRAL_OUTCOME_REQUIRED');
    }
    const protectedResponse = encrypt(responseSummary || null);
    const result = await client.query(
      `UPDATE ng_referrals
          SET status=$2,
              response_summary=NULL,
              response_summary_encrypted=COALESCE($3,response_summary_encrypted),
              response_summary_iv=COALESCE($4,response_summary_iv),
              response_summary_tag=COALESCE($5,response_summary_tag),
              completed_at=CASE WHEN $2='completed' THEN NOW() ELSE completed_at END,
              updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [referralId, toStatus, protectedResponse.encrypted, protectedResponse.iv, protectedResponse.tag]
    );
    await client.query(
      `INSERT INTO ng_referral_events
         (referral_id, actor_user_id, from_status, to_status, event_type,
          notes, notes_encrypted, notes_iv, notes_tag)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8)`,
      [referralId, context.userId, current.status, toStatus, 'status_changed',
        protectedResponse.encrypted, protectedResponse.iv, protectedResponse.tag]
    );
    await recordProgrammeAudit(client, req, context, {
      action: 'referral_transition',
      resourceType: 'referral',
      resourceId: referralId,
      patientUserId: current.patient_user_id,
      purpose: 'Referral coordination and closure',
      dataClass: 'sensitive',
      metadata: { fromStatus: current.status, toStatus, outcomeRecorded: Boolean(responseSummary) },
    });
    return formatProtectedRecord(result.rows[0], ['reason', 'clinical_notes', 'response_summary']);
  });
}

module.exports = {
  QUEUE_TRANSITIONS,
  REFERRAL_TRANSITIONS,
  assertClinicianEligible,
  claimQueueEntry,
  createEncounter,
  createFollowUp,
  createObservation,
  createReferral,
  enrollPatient,
  enqueueEncounter,
  getEncounter,
  hashNormalized,
  listFollowUps,
  listObservations,
  listQueue,
  listReferrals,
  requireEnrollment,
  searchPatients,
  transitionQueueEntry,
  transitionReferral,
  withTransaction,
  workflowError,
};
