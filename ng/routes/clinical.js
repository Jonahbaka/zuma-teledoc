/**
 * ng/routes/clinical.js
 * Clinical EMR API. Mounted at /api/ng/clinical (authenticated).
 *
 *   GET  /prescriptions           — prescriptions enriched with encounter context
 *   GET  /encounters              — clinical encounters for the authenticated user
 *   POST /encounters              — create encounter
 *   GET  /encounters/:id          — encounter detail with SOAP notes + diagnoses
 *   POST /encounters/:id/soap     — upsert SOAP note for encounter
 *   GET  /diagnoses               — diagnoses list (?patient_id|encounter_id|status)
 *   GET  /medication-history      — medication history (?patient_id|status)
 *   GET  /referrals               — referrals (?patient_id|status|urgency)
 *   POST /referrals               — create referral
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');

// GET /clinical/prescriptions — prescriptions with encounter linkage
router.get('/prescriptions', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user.id;
    const role = req.user.role;

    let query, params;

    if (role === 'patient') {
      query = `
        SELECT p.*, e.encounter_type, e.encounter_date, e.chief_complaint
        FROM ng_prescriptions p
        LEFT JOIN ng_clinical_encounters e ON e.patient_id = p.patient_user_id
          AND e.id = (
            SELECT enc.id FROM ng_clinical_encounters enc
            WHERE enc.patient_id = p.patient_user_id
            ORDER BY enc.encounter_date DESC LIMIT 1
          )
        WHERE p.patient_user_id = $1
        ORDER BY p.created_at DESC
        LIMIT 50
      `;
      params = [userId];
    } else {
      query = `
        SELECT p.*, e.encounter_type, e.encounter_date, e.chief_complaint
        FROM ng_prescriptions p
        LEFT JOIN ng_clinical_encounters e ON e.patient_id = p.patient_user_id
          AND e.id = (
            SELECT enc.id FROM ng_clinical_encounters enc
            WHERE enc.patient_id = p.patient_user_id
            ORDER BY enc.encounter_date DESC LIMIT 1
          )
        WHERE p.prescriber_user_id = $1
        ORDER BY p.created_at DESC
        LIMIT 100
      `;
      params = [userId];
    }

    const { rows } = await pool.query(query, params);
    res.json({ ok: true, prescriptions: rows, count: rows.length });
  } catch (err) {
    console.error('[clinical] /prescriptions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch clinical prescriptions' });
  }
});

// GET /clinical/encounters
router.get('/encounters', async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user.id;
    const role = req.user.role;
    const { status, limit = 20 } = req.query;

    const conditions = [];
    const params = [];

    if (role === 'patient') {
      params.push(userId);
      conditions.push(`patient_id = $${params.length}`);
    } else {
      params.push(userId);
      conditions.push(`provider_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 20, 100));

    const { rows } = await pool.query(
      `SELECT * FROM ng_clinical_encounters ${where}
       ORDER BY encounter_date DESC LIMIT $${params.length}`,
      params
    );
    res.json({ ok: true, encounters: rows, count: rows.length });
  } catch (err) {
    console.error('[clinical] /encounters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch encounters' });
  }
});

// POST /clinical/encounters
router.post('/encounters', async (req, res) => {
  try {
    const pool = getPool();
    const { patient_id, facility_id, encounter_type = 'outpatient', chief_complaint, notes } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

    const { rows } = await pool.query(
      `INSERT INTO ng_clinical_encounters
         (patient_id, provider_id, facility_id, encounter_type, chief_complaint, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [patient_id, req.user.id, facility_id || null, encounter_type, chief_complaint || null, notes || null]
    );
    res.status(201).json({ ok: true, encounter: rows[0] });
  } catch (err) {
    console.error('[clinical] POST /encounters error:', err.message);
    res.status(500).json({ error: 'Failed to create encounter' });
  }
});

// GET /clinical/encounters/:id
router.get('/encounters/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [enc, soap, dx] = await Promise.all([
      pool.query('SELECT * FROM ng_clinical_encounters WHERE id = $1', [req.params.id]),
      pool.query('SELECT * FROM ng_soap_notes WHERE encounter_id = $1 ORDER BY created_at DESC', [req.params.id]),
      pool.query('SELECT * FROM ng_diagnoses WHERE encounter_id = $1 ORDER BY diagnosed_at DESC', [req.params.id]),
    ]);

    if (!enc.rows.length) return res.status(404).json({ error: 'Encounter not found' });
    res.json({ ok: true, encounter: enc.rows[0], soap_notes: soap.rows, diagnoses: dx.rows });
  } catch (err) {
    console.error('[clinical] /encounters/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch encounter detail' });
  }
});

// POST /clinical/encounters/:id/soap
router.post('/encounters/:id/soap', async (req, res) => {
  try {
    const pool = getPool();
    const { template_key, subjective, objective, assessment, plan, status = 'draft' } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO ng_soap_notes
         (encounter_id, author_id, template_key, subjective, objective, assessment, plan, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, req.user.id, template_key || null, subjective, objective, assessment, plan, status]
    );
    res.status(201).json({ ok: true, soap_note: rows[0] });
  } catch (err) {
    console.error('[clinical] POST /encounters/:id/soap error:', err.message);
    res.status(500).json({ error: 'Failed to save SOAP note' });
  }
});

// GET /clinical/diagnoses
router.get('/diagnoses', async (req, res) => {
  try {
    const pool = getPool();
    const { patient_id, encounter_id, status } = req.query;
    const conditions = [];
    const params = [];

    if (patient_id) { params.push(patient_id); conditions.push(`patient_id = $${params.length}`); }
    if (encounter_id) { params.push(encounter_id); conditions.push(`encounter_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM ng_diagnoses ${where} ORDER BY diagnosed_at DESC LIMIT 100`,
      params
    );
    res.json({ ok: true, diagnoses: rows, count: rows.length });
  } catch (err) {
    console.error('[clinical] /diagnoses error:', err.message);
    res.status(500).json({ error: 'Failed to fetch diagnoses' });
  }
});

// GET /clinical/medication-history
router.get('/medication-history', async (req, res) => {
  try {
    const pool = getPool();
    const { patient_id, status } = req.query;
    const targetPatient = patient_id || (req.user.role === 'patient' ? req.user.id : null);
    if (!targetPatient) return res.status(400).json({ error: 'patient_id required' });

    const params = [targetPatient];
    let where = 'WHERE patient_id = $1';
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT * FROM ng_medication_history ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ ok: true, medication_history: rows, count: rows.length });
  } catch (err) {
    console.error('[clinical] /medication-history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch medication history' });
  }
});

// GET /clinical/referrals
router.get('/referrals', async (req, res) => {
  try {
    const pool = getPool();
    const { patient_id, status, urgency } = req.query;
    const conditions = [];
    const params = [];

    if (patient_id) { params.push(patient_id); conditions.push(`patient_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (urgency) { params.push(urgency); conditions.push(`urgency = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM ng_referrals ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    res.json({ ok: true, referrals: rows, count: rows.length });
  } catch (err) {
    console.error('[clinical] /referrals error:', err.message);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

// POST /clinical/referrals
router.post('/referrals', async (req, res) => {
  try {
    const pool = getPool();
    const {
      encounter_id, patient_id, receiving_provider_id, referring_facility_id,
      receiving_facility_id, referral_type = 'specialist', urgency = 'routine',
      reason, clinical_notes, diagnosis_summary,
    } = req.body;

    if (!patient_id || !reason) {
      return res.status(400).json({ error: 'patient_id and reason required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ng_referrals
         (encounter_id, patient_id, referring_provider_id, receiving_provider_id,
          referring_facility_id, receiving_facility_id, referral_type, urgency,
          reason, clinical_notes, diagnosis_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        encounter_id || null, patient_id, req.user.id, receiving_provider_id || null,
        referring_facility_id || null, receiving_facility_id || null,
        referral_type, urgency, reason, clinical_notes || null, diagnosis_summary || null,
      ]
    );
    res.status(201).json({ ok: true, referral: rows[0] });
  } catch (err) {
    console.error('[clinical] POST /referrals error:', err.message);
    res.status(500).json({ error: 'Failed to create referral' });
  }
});

module.exports = router;
