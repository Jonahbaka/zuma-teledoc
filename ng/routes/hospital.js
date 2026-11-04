/**
 * Nigeria Hospital / Clinic Routes
 * Registration, staff management, departments, integration status
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const { v4: uuidv4 } = require('uuid');
const adminDecisions = require('../services/adminVerificationService');

// --- HOSPITAL REGISTRATION ---

router.post('/register', async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const {
      name, facility_type, contact_name, contact_email, contact_phone, contact_title,
      address_line1, address_line2, city, state, lga,
      phone, email, website,
      nhis_code, cac_number, facility_license_number, license_expiry,
      departments, bed_count, has_pharmacy, has_lab,
      description, user_id,
    } = req.body;

    if (!name || !facility_type || !contact_name || !contact_email || !contact_phone || !city || !state) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') +
      '-' + uuidv4().split('-')[0];

    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO ng_hospitals (
        name, slug, facility_type,
        contact_name, contact_email, contact_phone, contact_title,
        address_line1, address_line2, city, state, lga,
        phone, email, website,
        nhis_code, cac_number, facility_license_number, license_expiry,
        departments, bed_count, has_pharmacy, has_lab,
        description, owner_user_id, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,'pending_review')
      RETURNING id, slug, status
    `, [
      name, slug, facility_type,
      contact_name, contact_email, contact_phone, contact_title || null,
      address_line1, address_line2 || null, city, state, lga || null,
      phone || null, email || null, website || null,
      nhis_code || null, cac_number || null, facility_license_number || null,
      license_expiry || null,
      JSON.stringify(departments || []), bed_count || null,
      has_pharmacy || false, has_lab || false,
      description || null, user_id || null,
    ]);

    await client.query('COMMIT');
    res.status(201).json({
      hospital: result.rows[0],
      message: 'Hospital registered. Verification pending admin review.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- GET HOSPITAL ---

router.get('/:hospitalId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_hospitals WHERE id = $1',
      [req.params.hospitalId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Hospital not found' });
    res.json({ hospital: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STAFF ---

router.get('/:hospitalId/staff', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_hospital_staff WHERE hospital_id = $1 ORDER BY role, full_name',
      [req.params.hospitalId]
    );
    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:hospitalId/staff', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { full_name, email, phone, role, department, designation, mdcn_or_license } = req.body;
    if (!full_name || !role) return res.status(400).json({ error: 'full_name and role required' });

    const result = await pool.query(`
      INSERT INTO ng_hospital_staff
        (hospital_id, full_name, email, phone, role, department, designation, mdcn_or_license)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `, [
      req.params.hospitalId, full_name, email || null, phone || null,
      role, department || null, designation || null, mdcn_or_license || null,
    ]);
    res.status(201).json({ staff_id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:hospitalId/staff/:staffId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { status, department, designation, role } = req.body;
    await pool.query(`
      UPDATE ng_hospital_staff SET
        status = COALESCE($1, status),
        department = COALESCE($2, department),
        designation = COALESCE($3, designation),
        role = COALESCE($4, role)
      WHERE id = $5 AND hospital_id = $6
    `, [status, department, designation, role, req.params.staffId, req.params.hospitalId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INTEGRATION STATUS ---

router.get('/:hospitalId/integrations', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_hospital_integrations WHERE hospital_id = $1',
      [req.params.hospitalId]
    );
    res.json({ integrations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { status, state, limit = 50, offset = 0 } = req.query;
    const where = ['1=1'];
    const params = [];
    if (status) { where.push(`status = $${params.length + 1}`); params.push(status); }
    if (state) { where.push(`state = $${params.length + 1}`); params.push(state); }

    const result = await pool.query(`
      SELECT * FROM ng_hospitals WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_hospitals WHERE ${where.join(' AND ')}`, params
    );
    res.json({ hospitals: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:hospitalId/verify', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const decision = adminDecisions.validateDecision(req.params.hospitalId, req.body, {
      approve: 'verified', reject: 'rejected', suspend: 'suspended', activate: 'active',
    });
    const hospital = await adminDecisions.withActionTransaction(getPool(), async (client) => {
      await adminDecisions.requireCurrentNGActor(client, req.user.id);
      const current = await client.query(
        `SELECT h.id, h.status, h.owner_user_id FROM ng_hospitals h
          WHERE h.id = $1 AND (h.owner_user_id IS NULL OR EXISTS (
            SELECT 1 FROM users u WHERE u.id = h.owner_user_id AND u.market_scope = 'NG'))
          FOR UPDATE OF h`, [req.params.hospitalId]
      );
      if (!current.rowCount) throw adminDecisions.actionError(404, 'Hospital not found in this market.');
      const before = current.rows[0];
      await adminDecisions.requireNGRecordOwner(client, before.owner_user_id, 'Hospital');
      if (decision.action === 'activate' && !['verified', 'active'].includes(before.status)) {
        throw adminDecisions.actionError(409, 'Verify the hospital before activating it.');
      }
      const result = await client.query(
        `UPDATE ng_hospitals SET status = $1::text::ng_hospital_status, rejection_reason = $2,
          verified_at = CASE WHEN $1::text IN ('verified','active') THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
          verified_by = $3, updated_at = NOW() WHERE id = $4
          RETURNING id, status, verified_at, verified_by`,
        [decision.status, decision.reason, req.user.id, req.params.hospitalId]
      );
      if (result.rowCount !== 1) throw adminDecisions.actionError(404, 'Hospital not found in this market.');
      await adminDecisions.auditDecision(client, {
        actorId: req.user.id, resourceType: 'ng_hospital', resourceId: before.id,
        ...decision, before: { status: before.status }, after: { status: result.rows[0].status },
      });
      return result.rows[0];
    });
    res.json({ success: true, status: hospital.status, hospital });
  } catch (err) {
    adminDecisions.sendActionError(res, err);
  }
});

module.exports = router;
