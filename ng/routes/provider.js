/**
 * Nigeria Provider Routes
 * Registration, verification, appointments, earnings
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');

// --- PROVIDER REGISTRATION ---

router.post('/register', async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const {
      user_id, full_name, email, phone, gender, mdcn_number,
      specialty, sub_specialty, years_experience, qualifications,
      practice_name, practice_address, practice_city, practice_state,
      consult_fee_general, consult_fee_specialist, bio, languages,
    } = req.body;

    if (!full_name || !email || !phone || !mdcn_number || !specialty) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM ng_providers WHERE mdcn_number = $1 OR email = $2',
      [mdcn_number, email]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Provider already registered with this MDCN number or email' });
    }

    const result = await client.query(`
      INSERT INTO ng_providers (
        user_id, full_name, email, phone, gender, mdcn_number,
        specialty, sub_specialty, years_experience, qualifications,
        practice_name, practice_address, practice_city, practice_state,
        consult_fee_general, consult_fee_specialist, bio, languages,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending')
      RETURNING id, status
    `, [
      user_id, full_name, email, phone, gender, mdcn_number,
      specialty, sub_specialty || null, years_experience || 0,
      JSON.stringify(qualifications || []),
      practice_name, practice_address, practice_city, practice_state,
      consult_fee_general || 3000, consult_fee_specialist || 8000,
      bio || null, languages || [],
    ]);

    await client.query('COMMIT');
    res.status(201).json({ provider: result.rows[0], message: 'Registration submitted. Verification pending.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- PROVIDER PROFILE ---

router.get('/profile/:providerId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_providers WHERE id = $1',
      [req.params.providerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Provider not found' });
    res.json({ provider: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/profile/:providerId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const allowed = [
      'bio', 'languages', 'consult_fee_general', 'consult_fee_specialist',
      'availability_schedule', 'is_available', 'bank_name',
      'bank_account_number', 'bank_account_name', 'bank_code',
      'practice_name', 'practice_address', 'practice_city', 'practice_state',
    ];
    const updates = Object.keys(req.body)
      .filter(k => allowed.includes(k))
      .map((k, i) => `${k} = $${i + 2}`);
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    const values = allowed.filter(k => req.body[k] !== undefined).map(k => req.body[k]);
    await pool.query(
      `UPDATE ng_providers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [req.params.providerId, ...values]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER EARNINGS ---

router.get('/:providerId/earnings', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const summary = await pool.query(
      'SELECT total_earned, total_paid_out, pending_payout, total_consultations FROM ng_providers WHERE id = $1',
      [req.params.providerId]
    );
    const ledger = await pool.query(
      'SELECT * FROM ng_provider_earnings WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.providerId]
    );
    res.json({ summary: summary.rows[0] || {}, ledger: ledger.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER APPOINTMENTS ---

router.get('/:providerId/appointments', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    const where = ['a.provider_id = $1'];
    const params = [req.params.providerId];
    if (status) { where.push(`a.status = $${params.length + 1}`); params.push(status); }

    const result = await pool.query(`
      SELECT a.*, u.email as patient_email,
        COALESCE(u.full_name, u.email) as patient_name
      FROM ng_appointments a
      JOIN users u ON a.patient_user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.scheduled_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ appointments: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER PATIENTS ---

router.get('/:providerId/patients', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT DISTINCT u.id, u.email,
        COALESCE(u.full_name, u.email) as full_name,
        u.phone_number,
        COUNT(a.id) as total_visits,
        MAX(a.scheduled_at) as last_visit
      FROM ng_appointments a
      JOIN users u ON a.patient_user_id = u.id
      WHERE a.provider_id = $1 AND a.status = 'completed'
      GROUP BY u.id, u.email, u.phone_number
      ORDER BY last_visit DESC
      LIMIT 100
    `, [req.params.providerId]);
    res.json({ patients: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN: LIST & VERIFY PROVIDERS ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { status, specialty, limit = 50, offset = 0 } = req.query;
    const where = ['1=1'];
    const params = [];
    if (status) { where.push(`p.status = $${params.length + 1}`); params.push(status); }
    if (specialty) { where.push(`p.specialty = $${params.length + 1}`); params.push(specialty); }

    const result = await pool.query(`
      SELECT p.*, u.email as user_email
      FROM ng_providers p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_providers p WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ providers: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:providerId/verify', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { action, reason } = req.body;
    if (!['approve', 'reject', 'suspend'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const statusMap = { approve: 'verified', reject: 'rejected', suspend: 'suspended' };
    await pool.query(`
      UPDATE ng_providers SET
        status = $1,
        rejection_reason = $2,
        verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
        verified_by = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [statusMap[action], reason || null, req.user.id, req.params.providerId]);
    res.json({ success: true, status: statusMap[action] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FEATURED PROVIDERS ---

router.get('/featured', async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT p.id, p.full_name, p.specialty, p.photo_url,
        p.practice_city, p.practice_state,
        p.consult_fee_general, p.consult_fee_specialist,
        p.years_experience, p.total_consultations, p.bio
      FROM ng_providers p
      WHERE p.status = 'verified' AND p.is_available = true
        AND (p.is_featured = true OR p.featured_expires_at > NOW())
      ORDER BY p.is_featured DESC, p.total_consultations DESC
      LIMIT 12
    `);
    res.json({ providers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
