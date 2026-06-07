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
  const [enc, soap, dx] = await Promise.all([
    pool.query('SELECT * FROM ng_clinical_encounters WHERE id = $1', [req.params.id]),
    pool.query('SELECT * FROM ng_soap_notes WHERE encounter_id = $1 ORDER BY created_at DESC', [req.params.id]),
    pool.query('SELECT * FROM ng_diagnoses WHERE encounter_id = $1 ORDER BY created_at DESC', [req.params.id]),
  ]);
  if (!enc.rows.length) return res.status(404).json({ error: 'Encounter not found' });
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

  if (patient_user_id) { params.push(patient_user_id); conditions.push(`patient_user_id = $${params.length}`); }
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

  if (patient_user_id) { params.push(patient_user_id); conditions.push(`patient_user_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (priority) { params.push(priority); conditions.push(`priority = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM ng_referrals ${where} ORDER BY created_at DESC LIMIT 100`,
    params
  );
  res.json({ ok: true, referrals: rows, count: rows.length });
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
