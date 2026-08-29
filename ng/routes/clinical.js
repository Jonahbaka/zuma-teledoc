/**
 * ng/routes/clinical.js
 * Clinical EMR API. Mounted at /api/ng/clinical (authenticated).
 *
 *   GET  /prescriptions               — prescriptions with encounter context
 *   GET  /encounters                  — encounters for authenticated user
 *   POST /encounters                  — create encounter
 *   GET  /encounters/:id              — encounter + SOAP notes + diagnoses
 *   POST /encounters/:id/soap         — create SOAP note for encounter
 *   GET  /diagnoses                   — diagnoses (?patient_user_id|encounter_id|clinical_status)
 *   GET  /medication-history          — medication history (?patient_user_id|status)
 *   GET  /referrals                   — referrals (?patient_user_id|status|priority)
 *   POST /referrals                   — create referral
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const {
  assertClinicalAccess,
  canonicalRole,
  userIdOf,
} = require('../services/clinical/clinicalAccessService');

function requestUserId(req) {
  return userIdOf(req.user);
}

function requestRole(req) {
  return canonicalRole(req.user?.role || req.user?.ng_role);
}

function buildPrescriptionNumber() {
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(2, 14);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `NGRX-${ts}-${rand}`;
}

async function assertClinicalWriteAccess(req, patientUserId) {
  const pool = getPool();
  req.clinicalWriteAccess = await assertClinicalAccess(req, {
    pool,
    patientUserId,
    encounterId: req.body?.encounterId || req.body?.encounter_id || null,
    appointmentId: req.body?.appointmentId || req.body?.appointment_id || null,
    mode: 'write',
  });
  return req.clinicalWriteAccess;
}

function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      // Table does not exist → migration hasn't run yet
      if (['42P01', '42703'].includes(err.code)) {
        return res.status(503).json({
          error: 'Nigeria clinical tables are not migrated.',
          migrationStatus: 'pending',
        });
      }
      console.error('[clinical]', err.message);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  };
}

// GET /clinical/prescriptions
router.get('/prescriptions', asyncHandler(async (req, res) => {
  const pool = getPool();
  const userId = req.user.id || req.user.userId || req.user.sub;
  const role = req.user.role;

  let query, params;
  if (role === 'patient') {
    query = `
      SELECT p.*, e.encounter_type, e.started_at AS encounter_date, e.chief_complaint
      FROM ng_prescriptions p
      LEFT JOIN ng_clinical_encounters e
        ON e.patient_user_id = p.patient_user_id
        AND e.id = (
          SELECT enc.id FROM ng_clinical_encounters enc
          WHERE enc.patient_user_id = p.patient_user_id
          ORDER BY enc.created_at DESC LIMIT 1
        )
      WHERE p.patient_user_id = $1
      ORDER BY p.created_at DESC
      LIMIT 50
    `;
    params = [userId];
  } else {
    query = `
      SELECT p.*, e.encounter_type, e.started_at AS encounter_date, e.chief_complaint
      FROM ng_prescriptions p
      LEFT JOIN ng_clinical_encounters e
        ON e.patient_user_id = p.patient_user_id
        AND e.id = (
          SELECT enc.id FROM ng_clinical_encounters enc
          WHERE enc.patient_user_id = p.patient_user_id
          ORDER BY enc.created_at DESC LIMIT 1
        )
      WHERE p.prescriber_user_id = $1
      ORDER BY p.created_at DESC
      LIMIT 100
    `;
    params = [userId];
  }

  const { rows } = await pool.query(query, params);
  res.json({ ok: true, prescriptions: rows, count: rows.length });
}));

// POST /clinical/prescriptions
router.post('/prescriptions', express.json(), asyncHandler(async (req, res) => {
  req.body = req.body || {};
  req.body.patientUserId = req.body.patientUserId || req.body.patient_user_id;
  await assertClinicalWriteAccess(req, req.body.patientUserId);

  const pool = getPool();
  const access = req.clinicalWriteAccess || {};
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const pharmacyId = req.body.pharmacyId || req.body.pharmacy_id || null;
  const prescriptionNumber = req.body.prescriptionNumber || req.body.prescription_number || buildPrescriptionNumber();
  const encounterId = req.body.encounterId || req.body.encounter_id || null;
  const appointmentId = req.body.appointmentId || req.body.appointment_id || null;
  const isControlled = items.some((item) => item?.isControlled === true || item?.controlledOrSpecialHandling === true);

  if (!items.length) {
    return res.status(400).json({ error: 'At least one medication item is required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO ng_digital_prescriptions
       (provider_id, patient_user_id, appointment_id, prescription_number,
        items, preferred_pharmacy_id, routed_pharmacy_id, routed_at,
        status, dispense_status, pharmacy_response_status,
        diagnosis, notes, fulfillment_preference, is_controlled,
        provider_user_id, encounter_id, pharmacy_id,
        patient_instructions, pharmacy_notes, audit_metadata)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 IS NOT NULL THEN NOW() ELSE NULL END,
        $8,'pending','pending_pharmacy_confirmation',
        $9,$10,$11,$12,
        $13,$14,$15,
        $16,$17,$18)
     RETURNING *`,
    [
      access.providerId,
      req.body.patientUserId,
      appointmentId,
      prescriptionNumber,
      JSON.stringify(items),
      req.body.preferredPharmacyId || req.body.preferred_pharmacy_id || pharmacyId,
      req.body.routedPharmacyId || req.body.routed_pharmacy_id || pharmacyId,
      pharmacyId ? 'routed' : 'active',
      req.body.diagnosis || null,
      req.body.notes || null,
      req.body.fulfillmentPreference || req.body.fulfillment_preference || 'pickup_or_delivery',
      isControlled,
      access.providerUserId,
      encounterId,
      pharmacyId,
      req.body.patientInstructions || req.body.patient_instructions || null,
      req.body.pharmacyNotes || req.body.pharmacy_notes || null,
      {
        source: 'clinical_route',
        actorUserId: requestUserId(req),
        soapNoteIds: req.body.soapNoteIds || req.body.soap_note_ids || [],
        prescriptionIds: req.body.prescriptionIds || req.body.prescription_ids || [],
      },
    ]
  );

  res.status(201).json({ ok: true, prescription: rows[0] });
}));

// GET /clinical/encounters
router.get('/encounters', asyncHandler(async (req, res) => {
  const pool = getPool();
  const userId = req.user.id || req.user.userId || req.user.sub;
  const role = req.user.role;
  const { status, limit = 20 } = req.query;

  const conditions = [];
  const params = [];

  if (role === 'patient') {
    params.push(userId);
    conditions.push(`patient_user_id = $${params.length}`);
  } else {
    params.push(userId);
    conditions.push(`provider_user_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 20, 100));

  const { rows } = await pool.query(
    `SELECT * FROM ng_clinical_encounters ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({ ok: true, encounters: rows, count: rows.length });
}));

// POST /clinical/encounters
router.post('/encounters', asyncHandler(async (req, res) => {
  const pool = getPool();
  const { patient_user_id, hospital_id, appointment_id, encounter_type = 'telehealth', chief_complaint, reason_for_visit } = req.body;
  const providerId = req.user.id || req.user.userId || req.user.sub;

  if (!patient_user_id) return res.status(400).json({ error: 'patient_user_id required' });
  req.body.patientUserId = patient_user_id;
  req.body.appointmentId = appointment_id || null;
  await assertClinicalWriteAccess(req, patient_user_id);

  const { rows } = await pool.query(
    `INSERT INTO ng_clinical_encounters
       (patient_user_id, provider_user_id, hospital_id, appointment_id,
        encounter_type, chief_complaint, reason_for_visit, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING *`,
    [patient_user_id, providerId, hospital_id || null, appointment_id || null,
     encounter_type, chief_complaint || null, reason_for_visit || null]
  );
  res.status(201).json({ ok: true, encounter: rows[0] });
}));

// GET /clinical/encounters/:id
router.get('/encounters/:id', asyncHandler(async (req, res) => {
  const pool = getPool();
  const enc = await pool.query('SELECT * FROM ng_clinical_encounters WHERE id = $1', [req.params.id]);
  if (!enc.rows.length) return res.status(404).json({ error: 'Encounter not found' });
  await assertClinicalAccess(req, {
    pool,
    patientUserId: enc.rows[0].patient_user_id,
    encounterId: req.params.id,
    mode: 'read',
  });
  const [soap, dx] = await Promise.all([
    pool.query('SELECT * FROM ng_soap_notes WHERE encounter_id = $1 ORDER BY created_at DESC', [req.params.id]),
    pool.query('SELECT * FROM ng_diagnoses WHERE encounter_id = $1 ORDER BY created_at DESC', [req.params.id]),
  ]);
  res.json({ ok: true, encounter: enc.rows[0], soap_notes: soap.rows, diagnoses: dx.rows });
}));

// POST /clinical/encounters/:id/soap
router.post('/encounters/:id/soap', asyncHandler(async (req, res) => {
  const pool = getPool();
  const userId = req.user.id || req.user.userId || req.user.sub;
  const { subjective, objective, assessment, plan, provider_attestation } = req.body;

  const enc = await pool.query(
    'SELECT patient_user_id FROM ng_clinical_encounters WHERE id = $1', [req.params.id]
  );
  if (!enc.rows.length) return res.status(404).json({ error: 'Encounter not found' });
  req.body.patientUserId = enc.rows[0].patient_user_id;
  req.body.encounterId = req.params.id;
  await assertClinicalWriteAccess(req, req.body.patientUserId);

  const { rows } = await pool.query(
    `INSERT INTO ng_soap_notes
       (encounter_id, patient_user_id, provider_user_id, subjective, objective, assessment, plan, provider_attestation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.params.id, enc.rows[0].patient_user_id, userId,
     subjective || null, objective || null, assessment || null, plan || null, provider_attestation || null]
  );
  res.status(201).json({ ok: true, soap_note: rows[0] });
}));

// GET /clinical/diagnoses
router.get('/diagnoses', asyncHandler(async (req, res) => {
  const pool = getPool();
  const { patient_user_id, encounter_id, clinical_status } = req.query;
  const conditions = [];
  const params = [];

  let targetPatientId = patient_user_id || null;
  if (!targetPatientId && encounter_id) {
    const encounter = await pool.query(
      'SELECT patient_user_id FROM ng_clinical_encounters WHERE id = $1',
      [encounter_id]
    );
    if (!encounter.rows.length) return res.status(404).json({ error: 'Encounter not found' });
    targetPatientId = encounter.rows[0].patient_user_id;
  }

  if (targetPatientId) {
    await assertClinicalAccess(req, {
      pool,
      patientUserId: targetPatientId,
      encounterId: encounter_id || null,
      mode: 'read',
    });
  } else {
    const role = requestRole(req);
    const userId = requestUserId(req);
    if (role === 'patient') {
      targetPatientId = userId;
    } else if (['provider', 'doctor', 'consultant', 'physician', 'specialist'].includes(role)) {
      params.push(userId);
      conditions.push(`provider_user_id = $${params.length}`);
    } else {
      return res.status(400).json({ error: 'patient_user_id or encounter_id required' });
    }
  }

  if (targetPatientId) { params.push(targetPatientId); conditions.push(`patient_user_id = $${params.length}`); }
  if (encounter_id) { params.push(encounter_id); conditions.push(`encounter_id = $${params.length}`); }
  if (clinical_status) { params.push(clinical_status); conditions.push(`clinical_status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM ng_diagnoses ${where} ORDER BY created_at DESC LIMIT 100`,
    params
  );
  res.json({ ok: true, diagnoses: rows, count: rows.length });
}));

// GET /clinical/medication-history
router.get('/medication-history', asyncHandler(async (req, res) => {
  const pool = getPool();
  const userId = req.user.id || req.user.userId || req.user.sub;
  const { patient_user_id, status } = req.query;
  const target = patient_user_id || (req.user.role === 'patient' ? userId : null);
  if (!target) return res.status(400).json({ error: 'patient_user_id required' });
  await assertClinicalAccess(req, { pool, patientUserId: target, mode: 'read' });

  const params = [target];
  let where = 'WHERE patient_user_id = $1';
  if (status) { params.push(status); where += ` AND status = $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT * FROM ng_medication_history ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  res.json({ ok: true, medication_history: rows, count: rows.length });
}));

// GET /clinical/referrals
router.get('/referrals', asyncHandler(async (req, res) => {
  const pool = getPool();
  const { patient_user_id, status, priority } = req.query;
  const conditions = [];
  const params = [];

  const role = requestRole(req);
  const userId = requestUserId(req);
  if (patient_user_id) {
    await assertClinicalAccess(req, { pool, patientUserId: patient_user_id, mode: 'read' });
    params.push(patient_user_id);
    conditions.push(`patient_user_id = $${params.length}`);
  } else if (role === 'patient') {
    params.push(userId);
    conditions.push(`patient_user_id = $${params.length}`);
  } else if (['provider', 'doctor', 'consultant', 'physician', 'specialist'].includes(role)) {
    params.push(userId);
    conditions.push(`provider_user_id = $${params.length}`);
  } else {
    return res.status(400).json({ error: 'patient_user_id required' });
  }

  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (priority) { params.push(priority); conditions.push(`priority = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM ng_referrals ${where} ORDER BY created_at DESC LIMIT 100`,
    params
  );
  res.json({ ok: true, referrals: rows, count: rows.length });
}));

// PATCH /clinical/referrals/:id/status
router.patch('/referrals/:id/status', express.json(), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { status, response_summary } = req.body || {};
  const soapNoteIds = req.body?.soapNoteIds || req.body?.soap_note_ids || [];
  const prescriptionIds = req.body?.prescriptionIds || req.body?.prescription_ids || [];

  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const referral = await pool.query('SELECT * FROM ng_referrals WHERE id = $1', [req.params.id]);
  if (!referral.rows.length) {
    return res.status(404).json({ error: 'Referral not found' });
  }

  req.body.patientUserId = referral.rows[0].patient_user_id;
  await assertClinicalWriteAccess(req, req.body.patientUserId);

  const auditMetadata = {
    ...(referral.rows[0].audit_metadata || {}),
    lastStatusUpdate: {
      status,
      actorUserId: requestUserId(req),
      soapNoteIds,
      prescriptionIds,
      updatedAt: new Date().toISOString(),
    },
  };

  const { rows } = await pool.query(
    `UPDATE ng_referrals
        SET status = $1,
            response_summary = COALESCE($2, response_summary),
            audit_metadata = $3,
            completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [status, response_summary || null, auditMetadata, req.params.id]
  );

  res.json({ ok: true, referral: rows[0], soapNoteIds, prescriptionIds });
}));

// POST /clinical/referrals
router.post('/referrals', asyncHandler(async (req, res) => {
  const pool = getPool();
  const userId = req.user.id || req.user.userId || req.user.sub;
  const {
    encounter_id, patient_user_id, target_organization_id, target_hospital_id,
    referral_type = 'specialist', priority = 'routine',
    reason, clinical_notes, target_name, destination_type = 'internal',
  } = req.body;

  if (!patient_user_id || !reason) {
    return res.status(400).json({ error: 'patient_user_id and reason required' });
  }
  req.body.patientUserId = patient_user_id;
  req.body.encounterId = encounter_id || null;
  await assertClinicalWriteAccess(req, patient_user_id);

  const { rows } = await pool.query(
    `INSERT INTO ng_referrals
       (encounter_id, patient_user_id, provider_user_id,
        target_organization_id, target_hospital_id,
        referral_type, priority, destination_type,
        reason, clinical_notes, target_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
     RETURNING *`,
    [
      encounter_id || null, patient_user_id, userId,
      target_organization_id || null, target_hospital_id || null,
      referral_type, priority, destination_type,
      reason, clinical_notes || null, target_name || null,
    ]
  );
  res.status(201).json({ ok: true, referral: rows[0] });
}));

module.exports = router;
module.exports._test = { assertClinicalWriteAccess };
