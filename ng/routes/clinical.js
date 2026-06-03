/**
 * Nigeria Clinical Routes
 * Longitudinal EMR, structured SOAP notes, prescription lifecycle, and medication search.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const interoperabilityService = require('../services/monetization/interoperabilityService');

const NIGERIA_PENDING_MESSAGE =
  'This feature is not yet available in Nigeria. DoctaRx Nigeria is preparing this capability for future rollout.';

function getUserId(user = {}) {
  return user.id || user.userId || user.sub;
}

function isPrivilegedClinicalUser(user = {}) {
  return ['provider', 'admin', 'super_admin', 'hospital_admin', 'clinic_admin', 'facility_admin'].includes(user.role);
}

function isAdminClinicalUser(user = {}) {
  return ['admin', 'super_admin', 'hospital_admin', 'clinic_admin', 'facility_admin'].includes(user.role);
}

async function isClinicalTestSeedAllowed(user = {}) {
  if (process.env.NG_ENABLE_TEST_CLINICAL_SEED === 'true') return true;
  if (process.env.NG_ENABLE_TEST_CLINICAL_SEED === 'false') return false;
  const email = String(user.email || '').toLowerCase();
  if (!['provider', 'admin', 'super_admin'].includes(user.role)) return false;
  if (/(^|[+._-])(test|demo|qa|sandbox)([+._-]|@)/.test(email)) return true;

  try {
    const result = await getPool().query(
      `SELECT testing_bypass_active, testing_bypass_expires_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [getUserId(user)]
    );
    const row = result.rows[0];
    return Boolean(row?.testing_bypass_active && row.testing_bypass_expires_at && new Date(row.testing_bypass_expires_at) > new Date());
  } catch {
    return false;
  }
}

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (['42P01', '42703'].includes(error.code)) {
        return res.status(503).json({
          error: 'Nigeria clinical infrastructure tables are not migrated.',
          migrationStatus: 'pending',
        });
      }
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  };
}

async function userCanAccessPharmacyId(user, pharmacyId) {
  if (isAdminClinicalUser(user)) return true;
  const userId = getUserId(user);
  if (!userId || !pharmacyId) return false;

  const result = await getPool().query(
    `SELECT 1
     FROM ng_pharmacies p
     LEFT JOIN ng_pharmacy_staff s
       ON s.pharmacy_id = p.id
      AND s.user_id = $2
      AND s.status = 'active'
      AND s.role = ANY($3::text[])
     WHERE p.id = $1
       AND (p.owner_user_id = $2 OR s.id IS NOT NULL)
     LIMIT 1`,
    [pharmacyId, userId, ['owner', 'superintendent', 'pharmacist', 'admin_staff', 'billing_manager']]
  );

  return result.rows.length > 0;
}

async function userCanAccessPatientRecord(user, patientId) {
  const userId = getUserId(user);
  if (!patientId || !userId) return false;
  if (String(patientId) === String(userId)) return true;
  if (isAdminClinicalUser(user)) return true;
  if (user.role !== 'provider') return false;

  const result = await getPool().query(
    `SELECT 1
     FROM (
       SELECT patient_id AS patient_user_id, provider_id AS provider_user_id FROM appointments
       UNION ALL
       SELECT patient_id AS patient_user_id, provider_id AS provider_user_id FROM visits
       UNION ALL
       SELECT patient_id AS patient_user_id, provider_id AS provider_user_id FROM provider_patient_relationships
       UNION ALL
       SELECT patient_user_id, provider_user_id FROM ng_clinical_encounters
       UNION ALL
       SELECT patient_user_id, provider_user_id FROM ng_digital_prescriptions
     ) access_scope
     WHERE access_scope.patient_user_id = $1
       AND access_scope.provider_user_id = $2
     LIMIT 1`,
    [patientId, userId]
  );

  return result.rows.length > 0;
}

async function resolvePatientId(req) {
  const requested = req.params.patientId;
  const userId = getUserId(req.user);
  if (!requested || requested === 'me') return userId;
  if (String(requested) === String(userId)) return userId;
  if (isPrivilegedClinicalUser(req.user) && await userCanAccessPatientRecord(req.user, requested)) return requested;

  const error = new Error('Clinical record access denied');
  error.statusCode = 403;
  throw error;
}

function resolveWritePatientId(req) {
  const requested = req.params.patientId;
  if (!requested || requested === 'me') {
    const error = new Error('A patient id is required for provider clinical documentation.');
    error.statusCode = 400;
    throw error;
  }
  return requested;
}

async function queryMany(sql, params) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

async function assertClinicalWriteAccess(req, patientId) {
  if (isAdminClinicalUser(req.user)) return true;
  if (req.user.role !== 'provider') {
    const error = new Error('Provider access required to write Nigeria clinical records.');
    error.statusCode = 403;
    throw error;
  }

  if (await userCanAccessPatientRecord(req.user, patientId)) return true;

  if (req.body?.appointmentId) {
    const result = await getPool().query(
      `SELECT 1
       FROM appointments
       WHERE id = $1
         AND patient_id = $2
         AND provider_id = $3
       LIMIT 1`,
      [req.body.appointmentId, patientId, getUserId(req.user)]
    );
    if (result.rows.length) return true;
  }

  const error = new Error('Clinical record write access denied');
  error.statusCode = 403;
  throw error;
}

async function ensureEmrRecord(patientId) {
  const chartNumber = `NG-CHART-${String(patientId).slice(0, 8).toUpperCase()}`;
  const result = await getPool().query(
    `INSERT INTO ng_emr_records (patient_user_id, chart_number)
     VALUES ($1, $2)
     ON CONFLICT (patient_user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [patientId, chartNumber]
  );
  return result.rows[0];
}

async function addTimelineEvent({ patientId, encounterId, actorUserId, eventType, title, description, metadata = {} }) {
  await getPool().query(
    `INSERT INTO ng_visit_timeline_events (
       patient_user_id, encounter_id, actor_user_id, event_type, title, description, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [patientId, encounterId || null, actorUserId || null, eventType, title, description || null, metadata]
  );
}

async function persistClinicalFhirResource({
  resourceType,
  patientId,
  providerId,
  encounterId,
  localTable,
  localId,
  data,
  actorUserId,
}) {
  try {
    return await interoperabilityService.persistFhirResource({
      resourceType,
      patientId,
      providerId,
      encounterId,
      localTable,
      localId,
      data,
      actorUserId,
      direction: 'outbound',
      status: 'current',
    });
  } catch (error) {
    await interoperabilityService.recordExchangeMessage({
      patientId,
      encounterId,
      exchangeType: 'patient_record',
      direction: 'internal',
      status: 'failed',
      payload: {
        resourceType,
        localTable,
        localId,
        error: error.message,
      },
      createdBy: actorUserId,
    }).catch(() => {});
    throw error;
  }
}

function sectionsAreEmpty(sections = {}) {
  return [
    sections.encounterHistory,
    sections.soapNotes,
    sections.diagnoses,
    sections.medicationHistory,
    sections.labResults,
    sections.documents,
    sections.prescriptions,
  ].every((items) => !Array.isArray(items) || items.length === 0);
}

async function assertPrescriptionAccess(prescriptionId, user) {
  const result = await getPool().query(
    `SELECT id, patient_user_id, provider_user_id, pharmacy_id, lifecycle_status
     FROM ng_digital_prescriptions
     WHERE id = $1`,
    [prescriptionId]
  );
  const prescription = result.rows[0];
  if (!prescription) {
    const error = new Error('Prescription not found');
    error.statusCode = 404;
    throw error;
  }

  const userId = getUserId(user);
  if (String(prescription.patient_user_id) === String(userId) || String(prescription.provider_user_id) === String(userId) || isAdminClinicalUser(user)) {
    return prescription;
  }

  if (['pharmacy', 'pharmacist'].includes(user.role) && prescription.pharmacy_id && await userCanAccessPharmacyId(user, prescription.pharmacy_id)) {
    return prescription;
  }

  const error = new Error('Prescription access denied');
  error.statusCode = 403;
  throw error;
}

async function logPrescriptionAction({ prescriptionId, actorUserId, action, fromStatus, toStatus, message, metadata = {} }) {
  await getPool().query(
    `INSERT INTO ng_prescription_audit_logs (
       prescription_id, actor_user_id, action, from_status, to_status, message, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [prescriptionId, actorUserId || null, action, fromStatus || null, toStatus || null, message || null, metadata]
  );
}

async function assertReferralAccess(referralId, user) {
  const result = await getPool().query(
    `SELECT id, patient_user_id, provider_user_id, status
     FROM ng_referrals
     WHERE id = $1
     LIMIT 1`,
    [referralId]
  );
  const referral = result.rows[0];
  if (!referral) {
    const error = new Error('Referral not found');
    error.statusCode = 404;
    throw error;
  }

  const userId = getUserId(user);
  if (
    isAdminClinicalUser(user) ||
    String(referral.patient_user_id) === String(userId) ||
    String(referral.provider_user_id) === String(userId)
  ) {
    return referral;
  }

  const error = new Error('Referral access denied');
  error.statusCode = 403;
  throw error;
}

router.get('/patients/:patientId/longitudinal-record', asyncHandler(async (req, res) => {
  const patientId = await resolvePatientId(req);
  const pool = getPool();

  const [
    record,
    encounters,
    soapNotes,
    diagnoses,
    medications,
    labResults,
    documents,
    timeline,
    prescriptions,
    fhirResources,
    exchangeMessages,
  ] = await Promise.all([
    pool.query('SELECT * FROM ng_emr_records WHERE patient_user_id = $1 LIMIT 1', [patientId]),
    queryMany('SELECT * FROM ng_clinical_encounters WHERE patient_user_id = $1 ORDER BY created_at DESC LIMIT 25', [patientId]),
    queryMany('SELECT * FROM ng_soap_notes WHERE patient_user_id = $1 ORDER BY created_at DESC LIMIT 20', [patientId]),
    queryMany('SELECT * FROM ng_diagnoses WHERE patient_user_id = $1 ORDER BY created_at DESC LIMIT 50', [patientId]),
    queryMany('SELECT * FROM ng_medication_history WHERE patient_user_id = $1 ORDER BY created_at DESC LIMIT 50', [patientId]),
    queryMany('SELECT * FROM ng_lab_results WHERE patient_user_id = $1 ORDER BY COALESCE(resulted_at, collected_at, created_at) DESC LIMIT 50', [patientId]),
    queryMany('SELECT * FROM ng_clinical_documents WHERE patient_user_id = $1 ORDER BY created_at DESC LIMIT 50', [patientId]),
    queryMany('SELECT * FROM ng_visit_timeline_events WHERE patient_user_id = $1 ORDER BY event_at DESC LIMIT 75', [patientId]),
    queryMany(
      `SELECT p.*, COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM ng_digital_prescriptions p
       LEFT JOIN ng_digital_prescription_items i ON i.prescription_id = p.id
       WHERE p.patient_user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT 25`,
      [patientId]
    ),
    interoperabilityService.listFhirResources({
      patientId,
      actorUserId: getUserId(req.user),
      actorRole: req.user.role,
      limit: 50,
    }),
    interoperabilityService.listExchangeMessages({
      patientId,
      actorUserId: getUserId(req.user),
      actorRole: req.user.role,
      limit: 50,
    }),
  ]);

  const sections = {
    longitudinalRecord: record.rows[0] || null,
    encounterHistory: encounters,
    soapNotes,
    diagnoses,
    medicationHistory: medications,
    labResults,
    documents,
    visitTimeline: timeline,
    prescriptions,
    fhirResources,
    exchangeMessages,
  };

  const testSeedAvailable = await isClinicalTestSeedAllowed(req.user);

  res.json({
    patientId,
    record: record.rows[0] || null,
    sections,
    emptyState: 'No live clinical data has been recorded for this patient in Nigeria yet.',
    testSeedAvailable: testSeedAvailable && sectionsAreEmpty(sections),
  });
}));

router.get('/patients/:patientId/fhir-resources', asyncHandler(async (req, res) => {
  const patientId = await resolvePatientId(req);
  const resources = await interoperabilityService.listFhirResources({
    patientId,
    resourceType: req.query.resourceType,
    actorUserId: getUserId(req.user),
    actorRole: req.user.role,
    limit: req.query.limit,
  });
  res.json({ resources });
}));

router.get('/exchange', asyncHandler(async (req, res) => {
  let patientId = null;
  if (req.query.patientId) {
    req.params.patientId = req.query.patientId;
    patientId = await resolvePatientId(req);
  }
  const messages = await interoperabilityService.listExchangeMessages({
    patientId,
    actorUserId: getUserId(req.user),
    actorRole: req.user.role,
    limit: req.query.limit,
  });
  res.json({ messages });
}));

router.post('/patients/:patientId/exchange/care-summaries', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  await ensureEmrRecord(patientId);

  const message = await interoperabilityService.recordExchangeMessage({
    patientId,
    encounterId: req.body.encounterId || null,
    integrationId: req.body.integrationId || null,
    exchangeType: 'care_summary',
    direction: req.body.direction || 'inbound',
    status: req.body.status || 'received',
    payload: {
      summary: req.body.summary,
      sourceOrganization: req.body.sourceOrganization,
      medications: req.body.medications || [],
      diagnoses: req.body.diagnoses || [],
      followUp: req.body.followUp || null,
    },
    createdBy: getUserId(req.user),
  });

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'care_summary_received',
    title: 'Care summary recorded',
    description: req.body.summary || req.body.sourceOrganization || null,
  });

  res.status(201).json({ message });
}));

router.post('/patients/:patientId/exchange/encounter-summaries', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  await ensureEmrRecord(patientId);

  const fhirResource = await interoperabilityService.persistFhirResource({
    resourceType: 'Encounter',
    patientId,
    providerId: getUserId(req.user),
    encounterId: req.body.encounterId || null,
    localTable: req.body.encounterId ? 'ng_clinical_encounters' : null,
    localId: req.body.encounterId || null,
    data: {
      status: 'signed',
      reasonForVisit: req.body.summary || req.body.reasonForVisit,
      clinicalSummary: req.body.summary,
      startedAt: req.body.startedAt,
      endedAt: req.body.endedAt,
    },
    actorUserId: getUserId(req.user),
    direction: 'outbound',
  });

  const message = await interoperabilityService.recordExchangeMessage({
    patientId,
    encounterId: req.body.encounterId || null,
    exchangeType: 'encounter_summary',
    direction: 'internal',
    status: 'sent',
    payload: {
      summary: req.body.summary,
      fhirResourceId: fhirResource.id,
    },
    createdBy: getUserId(req.user),
  });

  res.status(201).json({ message, fhirResource });
}));

router.get('/referrals', asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  const params = [];
  const where = [];

  if (req.user.role === 'provider') {
    params.push(userId);
    where.push(`r.provider_user_id = $${params.length}`);
  } else if (req.user.role === 'patient') {
    params.push(userId);
    where.push(`r.patient_user_id = $${params.length}`);
  } else if (!isAdminClinicalUser(req.user)) {
    return res.status(403).json({ error: 'Referral access denied.' });
  }

  if (req.query.status) {
    params.push(String(req.query.status));
    where.push(`r.status = $${params.length}`);
  }

  if (req.query.patientUserId) {
    req.params.patientId = req.query.patientUserId;
    const patientId = await resolvePatientId(req);
    params.push(patientId);
    where.push(`r.patient_user_id = $${params.length}`);
  }

  params.push(Number(req.query.limit || 50));
  const result = await getPool().query(
    `SELECT r.*,
            patient.first_name AS patient_first_name,
            patient.last_name AS patient_last_name,
            provider.first_name AS provider_first_name,
            provider.last_name AS provider_last_name
     FROM ng_referrals r
     LEFT JOIN users patient ON patient.id = r.patient_user_id
     LEFT JOIN users provider ON provider.id = r.provider_user_id
     WHERE ${where.length ? where.join(' AND ') : '1=1'}
     ORDER BY r.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json({ referrals: result.rows });
}));

router.patch('/referrals/:id/status', asyncHandler(async (req, res) => {
  const referral = await assertReferralAccess(req.params.id, req.user);
  const nextStatus = String(req.body.status || '').trim();
  const allowedStatuses = new Set(['sent', 'accepted', 'declined', 'completed', 'cancelled']);
  if (!allowedStatuses.has(nextStatus)) {
    return res.status(400).json({ error: 'Unsupported referral status.' });
  }

  const canUpdate =
    isAdminClinicalUser(req.user) ||
    (req.user.role === 'provider' && String(referral.provider_user_id) === String(getUserId(req.user)));

  if (!canUpdate) {
    return res.status(403).json({ error: 'Provider or admin access required to update a referral.' });
  }

  const completedAtSql = nextStatus === 'completed' ? ', completed_at = NOW()' : '';
  const result = await getPool().query(
    `UPDATE ng_referrals
     SET status = $2,
         response_summary = COALESCE($3, response_summary),
         audit_metadata = COALESCE(audit_metadata, '{}'::JSONB) || $4::JSONB,
         updated_at = NOW()
         ${completedAtSql}
     WHERE id = $1
     RETURNING *`,
    [
      req.params.id,
      nextStatus,
      req.body.responseSummary || req.body.response_summary || null,
      JSON.stringify({
        lastStatusChange: {
          fromStatus: referral.status,
          toStatus: nextStatus,
          actorUserId: getUserId(req.user),
          changedAt: new Date().toISOString(),
        },
      }),
    ]
  );

  await addTimelineEvent({
    patientId: referral.patient_user_id,
    encounterId: result.rows[0].encounter_id || null,
    actorUserId: getUserId(req.user),
    eventType: 'referral_status_updated',
    title: 'Referral status updated',
    description: `${referral.status || 'unknown'} -> ${nextStatus}`,
    metadata: { referralId: req.params.id },
  });

  res.json({ referral: result.rows[0] });
}));

router.post('/referrals', asyncHandler(async (req, res) => {
  if (req.user.role !== 'provider' && !isAdminClinicalUser(req.user)) {
    return res.status(403).json({ error: 'Provider access required to send a Nigeria referral.' });
  }

  if (!req.body.patientUserId || !req.body.reason) {
    return res.status(400).json({ error: 'patientUserId and reason are required.' });
  }

  const patientId = req.body.patientUserId;
  await assertClinicalWriteAccess({ ...req, params: { patientId }, body: req.body }, patientId);
  await ensureEmrRecord(patientId);

  const referralResult = await getPool().query(
    `INSERT INTO ng_referrals (
       patient_user_id, provider_user_id, encounter_id, target_organization_id,
       target_hospital_id, target_name, destination_type, referral_type, priority,
       status, reason, clinical_notes, audit_metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sent',$10,$11,$12)
     RETURNING *`,
    [
      patientId,
      getUserId(req.user),
      req.body.encounterId || null,
      req.body.targetOrganizationId || null,
      req.body.targetHospitalId || null,
      req.body.targetName || null,
      req.body.destinationType || 'internal',
      req.body.referralType || 'specialist',
      req.body.priority || 'routine',
      req.body.reason,
      req.body.clinicalNotes || null,
      {
        createdFrom: 'doctarx_ng_provider',
        externalDispatchClaimed: false,
        attachments: {
          soapNoteIds: Array.isArray(req.body.soapNoteIds) ? req.body.soapNoteIds : [],
          prescriptionIds: Array.isArray(req.body.prescriptionIds) ? req.body.prescriptionIds : [],
          documentIds: Array.isArray(req.body.documentIds) ? req.body.documentIds : [],
        },
      },
    ]
  );

  const referral = referralResult.rows[0];
  const fhirResource = await interoperabilityService.persistFhirResource({
    resourceType: 'ReferralRequest',
    patientId,
    providerId: getUserId(req.user),
    encounterId: req.body.encounterId || null,
    localTable: 'ng_referrals',
    localId: referral.id,
    data: {
      ...req.body,
      ...referral,
      reasonForReferral: req.body.reason,
      clinicalNotes: req.body.clinicalNotes,
    },
    actorUserId: getUserId(req.user),
    direction: 'outbound',
  });

  const exchangeMessage = await interoperabilityService.recordExchangeMessage({
    patientId,
    encounterId: req.body.encounterId || null,
    referralId: referral.id,
    integrationId: req.body.integrationId || null,
    exchangeType: 'referral',
    direction: 'internal',
    status: 'sent',
    payload: {
      referralId: referral.id,
      fhirResourceId: fhirResource.id,
      targetName: req.body.targetName || null,
      reason: req.body.reason,
      priority: req.body.priority || 'routine',
    },
    createdBy: getUserId(req.user),
  });

  await getPool().query(
    `UPDATE ng_referrals
     SET fhir_resource_id = $2, exchange_message_id = $3, updated_at = NOW()
     WHERE id = $1`,
    [referral.id, fhirResource.id, exchangeMessage.id]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'referral_sent',
    title: 'Referral sent',
    description: req.body.reason,
    metadata: { referralId: referral.id, fhirResourceId: fhirResource.id },
  });

  res.status(201).json({ referral: { ...referral, fhir_resource_id: fhirResource.id, exchange_message_id: exchangeMessage.id }, fhirResource, exchangeMessage });
}));

router.post('/patients/:patientId/test-seed', asyncHandler(async (req, res) => {
  if (!await isClinicalTestSeedAllowed(req.user)) {
    return res.status(403).json({ error: 'Clinical test seeding is limited to configured Nigeria test provider accounts.' });
  }

  const patientId = resolveWritePatientId(req);
  const actorUserId = getUserId(req.user);
  await ensureEmrRecord(patientId);

  const existing = await getPool().query(
    `SELECT id
     FROM ng_clinical_encounters
     WHERE patient_user_id = $1
       AND provider_user_id = $2
       AND metadata->>'testSeed' = 'true'
     ORDER BY created_at DESC
     LIMIT 1`,
    [patientId, actorUserId]
  );

  if (existing.rows.length) {
    return res.json({
      seeded: false,
      message: 'Nigeria test EMR data already exists for this patient and provider.',
      encounterId: existing.rows[0].id,
    });
  }

  const pool = getPool();
  const encounter = await pool.query(
    `INSERT INTO ng_clinical_encounters (
       patient_user_id, provider_user_id, encounter_type, status, reason_for_visit,
       chief_complaint, clinical_summary, started_at, metadata
     ) VALUES ($1,$2,'telehealth','signed',$3,$4,$5,NOW() - INTERVAL '2 days',$6)
     RETURNING *`,
    [
      patientId,
      actorUserId,
      'Follow-up for fever and medication review',
      'Intermittent fever, headache, and fatigue',
      'Patient assessed by video consultation. No emergency red flags documented in this test chart.',
      { testSeed: true, source: 'ng_provider_test_account' },
    ]
  );
  const encounterRow = encounter.rows[0];

  await pool.query(
    `INSERT INTO ng_soap_notes (
       encounter_id, patient_user_id, provider_user_id, subjective, objective, assessment, plan,
       ai_assist_status, provider_attestation, signed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'not_requested','Test provider attested for training workflow only.',NOW())`,
    [
      encounterRow.id,
      patientId,
      actorUserId,
      'Reports fever for two days, mild headache, and reduced appetite.',
      'Video assessment: alert, speaking comfortably, no visible respiratory distress.',
      'Likely uncomplicated acute febrile illness. Malaria testing advised before antimalarial use.',
      'Hydration, paracetamol as needed, malaria RDT/CBC referral, return precautions, follow-up in 48 hours.',
    ]
  );

  await pool.query(
    `INSERT INTO ng_diagnoses (
       patient_user_id, encounter_id, provider_user_id, code_system, diagnosis_code,
       description, diagnosis_type, clinical_status, metadata
     ) VALUES ($1,$2,$3,'ICD-10','R50.9','Fever, unspecified','working','active',$4)`,
    [patientId, encounterRow.id, actorUserId, { testSeed: true }]
  );

  await pool.query(
    `INSERT INTO ng_medication_history (
       patient_user_id, encounter_id, medication_name, generic_name, dosage, frequency,
       route, duration, status, source, metadata
     ) VALUES ($1,$2,'Paracetamol','Acetaminophen','500 mg','Every 6-8 hours as needed','oral','3 days','active','provider_entered',$3)`,
    [patientId, encounterRow.id, { testSeed: true }]
  );

  const lab = await pool.query(
    `INSERT INTO ng_lab_results (
       patient_user_id, encounter_id, ordering_provider_user_id, test_name, result_value,
       status, collected_at, resulted_at, metadata
     ) VALUES ($1,$2,$3,'Malaria rapid diagnostic test','Negative','final',NOW() - INTERVAL '1 day',NOW() - INTERVAL '1 day',$4)
     RETURNING *`,
    [patientId, encounterRow.id, actorUserId, { testSeed: true }]
  );

  await pool.query(
    `INSERT INTO ng_clinical_documents (
       patient_user_id, encounter_id, uploaded_by, document_type, title, confidentiality, status, metadata
     ) VALUES ($1,$2,$3,'lab_report','Malaria RDT result summary','restricted','current',$4)`,
    [patientId, encounterRow.id, actorUserId, { testSeed: true }]
  );

  const prescription = await pool.query(
    `INSERT INTO ng_digital_prescriptions (
       patient_user_id, provider_user_id, encounter_id, prescription_number, lifecycle_status,
       route_status, refill_allowed, refill_limit, patient_instructions, pharmacy_notes, audit_metadata
     ) VALUES ($1,$2,$3,$4,'created','not_routed',false,0,$5,$6,$7)
     RETURNING *`,
    [
      patientId,
      actorUserId,
      encounterRow.id,
      `NG-RX-TEST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      'Take only as directed. Return if fever persists or danger signs occur.',
      'Test prescription for Nigeria provider training account.',
      { testSeed: true },
    ]
  );
  const prescriptionRow = prescription.rows[0];
  await pool.query(
    `INSERT INTO ng_digital_prescription_items (
       prescription_id, medication_name, generic_name, dosage, frequency, duration, quantity, route, substitution_allowed, metadata
     ) VALUES ($1,'Paracetamol','Acetaminophen','500 mg','Every 6-8 hours as needed','3 days','12 tablets','oral',true,$2)`,
    [prescriptionRow.id, { testSeed: true }]
  );

  const encounterFhir = await persistClinicalFhirResource({
    resourceType: 'Encounter',
    patientId,
    providerId: actorUserId,
    encounterId: encounterRow.id,
    localTable: 'ng_clinical_encounters',
    localId: encounterRow.id,
    data: { ...encounterRow, reasonForVisit: encounterRow.reason_for_visit, chiefComplaint: encounterRow.chief_complaint },
    actorUserId,
  });
  const labFhir = await persistClinicalFhirResource({
    resourceType: 'DiagnosticReport',
    patientId,
    providerId: actorUserId,
    encounterId: encounterRow.id,
    localTable: 'ng_lab_results',
    localId: lab.rows[0].id,
    data: { ...lab.rows[0], testName: lab.rows[0].test_name, resultValue: lab.rows[0].result_value },
    actorUserId,
  });
  const prescriptionFhir = await persistClinicalFhirResource({
    resourceType: 'MedicationRequest',
    patientId,
    providerId: actorUserId,
    encounterId: encounterRow.id,
    localTable: 'ng_digital_prescriptions',
    localId: prescriptionRow.id,
    data: {
      ...prescriptionRow,
      medicationName: 'Paracetamol',
      dosage: '500 mg',
      frequency: 'Every 6-8 hours as needed',
      duration: '3 days',
    },
    actorUserId,
  });

  await addTimelineEvent({
    patientId,
    encounterId: encounterRow.id,
    actorUserId,
    eventType: 'test_clinical_seed_created',
    title: 'Provider test chart populated',
    description: 'Sample Nigeria EMR, FHIR, prescription, lab, and encounter records created for training.',
    metadata: { testSeed: true },
  });

  res.status(201).json({
    seeded: true,
    encounter: encounterRow,
    fhirResources: [encounterFhir, labFhir, prescriptionFhir],
  });
}));

router.post('/patients/:patientId/encounters', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_clinical_encounters (
       patient_user_id, provider_user_id, hospital_id, appointment_id, encounter_type,
       status, reason_for_visit, chief_complaint, clinical_summary, started_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,NOW()),$11)
     RETURNING *`,
    [
      patientId,
      getUserId(req.user),
      req.body.hospitalId || null,
      req.body.appointmentId || null,
      req.body.encounterType || 'telehealth',
      req.body.status || 'draft',
      req.body.reasonForVisit || null,
      req.body.chiefComplaint || null,
      req.body.clinicalSummary || null,
      req.body.startedAt || null,
      req.body.metadata || {},
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: result.rows[0].id,
    actorUserId: getUserId(req.user),
    eventType: 'encounter_created',
    title: 'Clinical encounter created',
    description: req.body.reasonForVisit || req.body.chiefComplaint || null,
  });

  const patientFhirResource = await persistClinicalFhirResource({
    resourceType: 'Patient',
    patientId,
    localTable: 'users',
    localId: patientId,
    data: { patientUserId: patientId },
    actorUserId: getUserId(req.user),
  });

  const practitionerFhirResource = await persistClinicalFhirResource({
    resourceType: 'Practitioner',
    patientId,
    providerId: getUserId(req.user),
    localTable: 'users',
    localId: getUserId(req.user),
    data: { providerUserId: getUserId(req.user), providerName: req.user?.name || req.user?.email },
    actorUserId: getUserId(req.user),
  });

  const fhirResource = await persistClinicalFhirResource({
    resourceType: 'Encounter',
    patientId,
    providerId: getUserId(req.user),
    encounterId: result.rows[0].id,
    localTable: 'ng_clinical_encounters',
    localId: result.rows[0].id,
    data: {
      ...req.body,
      ...result.rows[0],
      encounterType: req.body.encounterType || result.rows[0].encounter_type,
      startedAt: result.rows[0].started_at,
    },
    actorUserId: getUserId(req.user),
  });

  res.status(201).json({ encounter: result.rows[0], fhirResource, fhirResources: [patientFhirResource, practitionerFhirResource, fhirResource] });
}));

router.post('/patients/:patientId/soap-notes', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_soap_notes (
       encounter_id, patient_user_id, provider_user_id, subjective, objective,
       assessment, plan, ai_assist_status, provider_attestation, signed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.body.encounterId || null,
      patientId,
      getUserId(req.user),
      req.body.subjective || null,
      req.body.objective || null,
      req.body.assessment || null,
      req.body.plan || null,
      req.body.aiAssistStatus || 'not_requested',
      req.body.providerAttestation || null,
      req.body.signedAt || null,
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'soap_note_created',
    title: 'SOAP note documented',
    description: req.body.assessment || null,
  });

  res.status(201).json({ soapNote: result.rows[0] });
}));

router.post('/patients/:patientId/diagnoses', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  if (!req.body.description) return res.status(400).json({ error: 'description is required.' });
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_diagnoses (
       patient_user_id, encounter_id, provider_user_id, code_system, diagnosis_code,
       description, diagnosis_type, clinical_status, onset_date, resolved_date, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      patientId,
      req.body.encounterId || null,
      getUserId(req.user),
      req.body.codeSystem || 'ICD-10',
      req.body.diagnosisCode || null,
      req.body.description,
      req.body.diagnosisType || 'working',
      req.body.clinicalStatus || 'active',
      req.body.onsetDate || null,
      req.body.resolvedDate || null,
      req.body.metadata || {},
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'diagnosis_recorded',
    title: 'Diagnosis recorded',
    description: req.body.description,
  });

  res.status(201).json({ diagnosis: result.rows[0] });
}));

router.post('/patients/:patientId/medication-history', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  if (!req.body.medicationName) return res.status(400).json({ error: 'medicationName is required.' });
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_medication_history (
       patient_user_id, encounter_id, prescription_id, medication_name, generic_name,
       dosage, frequency, route, duration, start_date, end_date, status, source, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      patientId,
      req.body.encounterId || null,
      req.body.prescriptionId || null,
      req.body.medicationName,
      req.body.genericName || null,
      req.body.dosage || null,
      req.body.frequency || null,
      req.body.route || null,
      req.body.duration || null,
      req.body.startDate || null,
      req.body.endDate || null,
      req.body.status || 'active',
      req.body.source || 'provider_entered',
      req.body.metadata || {},
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'medication_history_recorded',
    title: 'Medication history updated',
    description: req.body.medicationName,
  });

  res.status(201).json({ medication: result.rows[0] });
}));

router.post('/patients/:patientId/lab-results', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  if (!req.body.testName) return res.status(400).json({ error: 'testName is required.' });
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_lab_results (
       patient_user_id, encounter_id, ordering_provider_user_id, lab_organization_id,
       test_name, loinc_code, result_value, unit, reference_range, abnormal_flag,
       status, collected_at, resulted_at, report_url, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      patientId,
      req.body.encounterId || null,
      getUserId(req.user),
      req.body.labOrganizationId || null,
      req.body.testName,
      req.body.loincCode || null,
      req.body.resultValue || null,
      req.body.unit || null,
      req.body.referenceRange || null,
      req.body.abnormalFlag || null,
      req.body.status || 'registered',
      req.body.collectedAt || null,
      req.body.resultedAt || null,
      req.body.reportUrl || null,
      req.body.metadata || {},
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'lab_result_recorded',
    title: 'Lab result recorded',
    description: req.body.testName,
  });

  const observationResource = await persistClinicalFhirResource({
    resourceType: 'Observation',
    patientId,
    providerId: getUserId(req.user),
    encounterId: req.body.encounterId || null,
    localTable: 'ng_lab_results',
    localId: result.rows[0].id,
    data: { ...req.body, ...result.rows[0], testName: req.body.testName, resultValue: req.body.resultValue },
    actorUserId: getUserId(req.user),
  });

  const diagnosticReportResource = await persistClinicalFhirResource({
    resourceType: 'DiagnosticReport',
    patientId,
    providerId: getUserId(req.user),
    encounterId: req.body.encounterId || null,
    localTable: 'ng_lab_results',
    localId: result.rows[0].id,
    data: { ...req.body, ...result.rows[0], testName: req.body.testName, resultValue: req.body.resultValue },
    actorUserId: getUserId(req.user),
  });

  await interoperabilityService.recordExchangeMessage({
    patientId,
    encounterId: req.body.encounterId || null,
    exchangeType: 'lab_result',
    direction: 'internal',
    status: 'received',
    payload: {
      observationResourceId: observationResource.id,
      diagnosticReportResourceId: diagnosticReportResource.id,
      testName: req.body.testName,
      status: result.rows[0].status,
    },
    createdBy: getUserId(req.user),
  });

  res.status(201).json({ labResult: result.rows[0], fhirResources: [observationResource, diagnosticReportResource] });
}));

router.post('/patients/:patientId/documents', asyncHandler(async (req, res) => {
  const patientId = resolveWritePatientId(req);
  await assertClinicalWriteAccess(req, patientId);
  if (!req.body.documentType || !req.body.title) return res.status(400).json({ error: 'documentType and title are required.' });
  await ensureEmrRecord(patientId);

  const result = await getPool().query(
    `INSERT INTO ng_clinical_documents (
       patient_user_id, encounter_id, uploaded_by, document_type, title,
       storage_ref, mime_type, confidentiality, status, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      patientId,
      req.body.encounterId || null,
      getUserId(req.user),
      req.body.documentType,
      req.body.title,
      req.body.storageRef || null,
      req.body.mimeType || null,
      req.body.confidentiality || 'restricted',
      req.body.status || 'current',
      req.body.metadata || {},
    ]
  );

  await addTimelineEvent({
    patientId,
    encounterId: req.body.encounterId || null,
    actorUserId: getUserId(req.user),
    eventType: 'document_attached',
    title: 'Clinical document attached',
    description: req.body.title,
  });

  res.status(201).json({ document: result.rows[0] });
}));

router.get('/medications/search', asyncHandler(async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ results: [] });

  const result = await getPool().query(
    `SELECT id, generic_name, brand_name, dosage_form, strength, route, nafdac_number, category
     FROM ng_drug_catalog
     WHERE is_active = true
       AND disabled_at IS NULL
       AND COALESCE(is_supported, false) = true
       AND COALESCE(source_quality_status, 'needs_admin_review') IN ('approved', 'reference_only')
       AND (
        LOWER(COALESCE(generic_name, '')) LIKE LOWER($1)
        OR LOWER(COALESCE(brand_name, '')) LIKE LOWER($1)
        OR LOWER(COALESCE(name, '')) LIKE LOWER($1)
       )
     ORDER BY generic_name ASC, brand_name ASC
     LIMIT 20`,
    [`%${query}%`]
  );

  res.json({ results: result.rows });
}));

router.get('/prescriptions', asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  const params = [];
  let where = '1=1';

  if (req.user.role === 'patient') {
    params.push(userId);
    where += ` AND p.patient_user_id = $${params.length}`;
  } else if (req.user.role === 'provider') {
    params.push(userId);
    where += ` AND p.provider_user_id = $${params.length}`;
  } else if (['pharmacy', 'pharmacist'].includes(req.user.role)) {
    if (req.query.pharmacyId) {
      if (!await userCanAccessPharmacyId(req.user, req.query.pharmacyId)) {
        return res.status(403).json({ error: 'Pharmacy prescription access denied.' });
      }
      params.push(req.query.pharmacyId);
      where += ` AND p.pharmacy_id = $${params.length}`;
    } else {
      params.push(userId);
      where += ` AND p.pharmacy_id IN (
        SELECT p2.id
        FROM ng_pharmacies p2
        LEFT JOIN ng_pharmacy_staff s
          ON s.pharmacy_id = p2.id
         AND s.user_id = $${params.length}
         AND s.status = 'active'
        WHERE p2.owner_user_id = $${params.length} OR s.id IS NOT NULL
      )`;
    }
  }

  params.push(Number(req.query.limit || 50));

  const result = await getPool().query(
    `SELECT p.*, COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
     FROM ng_digital_prescriptions p
     LEFT JOIN ng_digital_prescription_items i ON i.prescription_id = p.id
     WHERE ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json({ prescriptions: result.rows, nigeriaPendingMessage: NIGERIA_PENDING_MESSAGE });
}));

router.post('/prescriptions', asyncHandler(async (req, res) => {
  if (req.user.role !== 'provider' && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Provider access required to create a prescription.' });
  }

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!req.body.patientUserId || items.length === 0) {
    return res.status(400).json({ error: 'patientUserId and at least one medication item are required.' });
  }

  for (const item of items) {
    if (!item.medicationName || !item.dosage || !item.frequency || !item.duration) {
      return res.status(400).json({ error: 'Each medication requires medicationName, dosage, frequency, and duration.' });
    }
  }

  await assertClinicalWriteAccess(req, req.body.patientUserId);

  const pool = getPool();
  const prescriptionNumber = `NG-RX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const result = await pool.query(
    `INSERT INTO ng_digital_prescriptions (
       patient_user_id, provider_user_id, encounter_id, pharmacy_id, prescription_number,
       lifecycle_status, route_status, refill_allowed, refill_limit, patient_instructions, pharmacy_notes
     ) VALUES ($1,$2,$3,$4,$5,'created','not_routed',$6,$7,$8,$9)
     RETURNING *`,
    [
      req.body.patientUserId,
      getUserId(req.user),
      req.body.encounterId || null,
      req.body.pharmacyId || null,
      prescriptionNumber,
      Boolean(req.body.refillAllowed),
      Number(req.body.refillLimit || 0),
      req.body.patientInstructions || null,
      req.body.pharmacyNotes || null,
    ]
  );

  const prescription = result.rows[0];
  for (const item of items) {
    await pool.query(
      `INSERT INTO ng_digital_prescription_items (
         prescription_id, drug_catalog_id, medication_name, generic_name, dosage,
         frequency, duration, quantity, route, substitution_allowed, nafdac_number, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        prescription.id,
        item.drugCatalogId || null,
        item.medicationName,
        item.genericName || null,
        item.dosage,
        item.frequency,
        item.duration,
        item.quantity || null,
        item.route || null,
        item.substitutionAllowed !== false,
        item.nafdacNumber || null,
        item.metadata || {},
      ]
    );
  }

  await logPrescriptionAction({
    prescriptionId: prescription.id,
    actorUserId: getUserId(req.user),
    action: 'created',
    toStatus: 'created',
    message: 'Provider created Nigeria digital prescription.',
  });

  const fhirResource = await persistClinicalFhirResource({
    resourceType: 'MedicationRequest',
    patientId: req.body.patientUserId,
    providerId: getUserId(req.user),
    encounterId: req.body.encounterId || null,
    localTable: 'ng_digital_prescriptions',
    localId: prescription.id,
    data: {
      ...req.body,
      ...prescription,
      items,
      medications: items.map((item) => item.medicationName).filter(Boolean).join(', '),
      medicationName: items[0]?.medicationName,
      dosage: items[0]?.dosage,
      frequency: items[0]?.frequency,
      duration: items[0]?.duration,
      lifecycleStatus: prescription.lifecycle_status,
    },
    actorUserId: getUserId(req.user),
  });

  await interoperabilityService.recordExchangeMessage({
    patientId: req.body.patientUserId,
    encounterId: req.body.encounterId || null,
    exchangeType: 'medication_update',
    direction: 'internal',
    status: 'created',
    payload: {
      prescriptionId: prescription.id,
      fhirResourceId: fhirResource.id,
      lifecycleStatus: prescription.lifecycle_status,
      medicationCount: items.length,
    },
    createdBy: getUserId(req.user),
  });

  res.status(201).json({ prescription, fhirResource, externalIntegrationStatus: 'not_configured' });
}));

router.post('/prescriptions/:id/route', asyncHandler(async (req, res) => {
  const prescription = await assertPrescriptionAccess(req.params.id, req.user);
  if (req.user.role !== 'provider' && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Provider access required to route a prescription.' });
  }
  if (!req.body.pharmacyId) return res.status(400).json({ error: 'pharmacyId is required.' });

  const result = await getPool().query(
    `UPDATE ng_digital_prescriptions
     SET pharmacy_id = $2, lifecycle_status = 'sent', route_status = 'sent_to_pharmacy',
         sent_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id, req.body.pharmacyId]
  );

  await logPrescriptionAction({
    prescriptionId: req.params.id,
    actorUserId: getUserId(req.user),
    action: 'routed_to_pharmacy',
    fromStatus: prescription.lifecycle_status,
    toStatus: 'sent',
    message: 'Prescription routed to selected pharmacy.',
    metadata: { pharmacyId: req.body.pharmacyId },
  });

  await interoperabilityService.recordExchangeMessage({
    patientId: prescription.patient_user_id,
    encounterId: result.rows[0].encounter_id || null,
    exchangeType: 'medication_update',
    direction: 'internal',
    status: 'sent',
    payload: {
      prescriptionId: req.params.id,
      pharmacyId: req.body.pharmacyId,
      lifecycleStatus: 'sent',
    },
    createdBy: getUserId(req.user),
  });

  res.json({ prescription: result.rows[0] });
}));

router.post('/prescriptions/:id/status', asyncHandler(async (req, res) => {
  const prescription = await assertPrescriptionAccess(req.params.id, req.user);
  const allowed = {
    accepted_by_pharmacy: ['pharmacy', 'pharmacist', 'admin', 'super_admin'],
    declined_by_pharmacy: ['pharmacy', 'pharmacist', 'admin', 'super_admin'],
    dispensed: ['pharmacy', 'pharmacist', 'admin', 'super_admin'],
    cancelled: ['provider', 'admin', 'super_admin'],
  };
  const nextStatus = req.body.status;
  if (!allowed[nextStatus]?.includes(req.user.role)) {
    return res.status(403).json({ error: 'Role cannot set requested prescription status.' });
  }

  const timestampColumn = nextStatus === 'accepted_by_pharmacy'
    ? ', accepted_at = NOW()'
    : nextStatus === 'dispensed'
      ? ', dispensed_at = NOW()'
      : '';

  const result = await getPool().query(
    `UPDATE ng_digital_prescriptions
     SET lifecycle_status = $2, updated_at = NOW() ${timestampColumn}
     WHERE id = $1
     RETURNING *`,
    [req.params.id, nextStatus]
  );

  await logPrescriptionAction({
    prescriptionId: req.params.id,
    actorUserId: getUserId(req.user),
    action: `status_${nextStatus}`,
    fromStatus: prescription.lifecycle_status,
    toStatus: nextStatus,
    message: req.body.message || null,
  });

  await interoperabilityService.recordExchangeMessage({
    patientId: prescription.patient_user_id,
    encounterId: result.rows[0].encounter_id || null,
    exchangeType: 'medication_update',
    direction: 'internal',
    status: nextStatus === 'dispensed' ? 'received' : nextStatus === 'declined_by_pharmacy' ? 'failed' : 'accepted',
    payload: {
      prescriptionId: req.params.id,
      fromStatus: prescription.lifecycle_status,
      toStatus: nextStatus,
      message: req.body.message || null,
    },
    createdBy: getUserId(req.user),
  });

  res.json({ prescription: result.rows[0] });
}));

router.get('/prescriptions/:id/audit-logs', asyncHandler(async (req, res) => {
  await assertPrescriptionAccess(req.params.id, req.user);
  const result = await getPool().query(
    `SELECT id, prescription_id, actor_user_id, action, from_status, to_status, message, metadata, created_at
     FROM ng_prescription_audit_logs
     WHERE prescription_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json({ auditLogs: result.rows });
}));

router.post('/prescriptions/:id/refill', asyncHandler(async (req, res) => {
  const prescription = await assertPrescriptionAccess(req.params.id, req.user);
  if (!prescription.refill_allowed) {
    return res.status(400).json({ error: 'Refills are not allowed for this prescription.' });
  }

  const result = await getPool().query(
    `UPDATE ng_digital_prescriptions
     SET refill_count = refill_count + 1, lifecycle_status = 'created', updated_at = NOW()
     WHERE id = $1 AND refill_count < refill_limit
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(400).json({ error: 'Refill limit has been reached.' });

  await logPrescriptionAction({
    prescriptionId: req.params.id,
    actorUserId: getUserId(req.user),
    action: 'refill_requested',
    fromStatus: prescription.lifecycle_status,
    toStatus: 'created',
  });

  res.json({ prescription: result.rows[0] });
}));

module.exports = router;
