/**
 * Nigeria Organization Routes
 * Registration, member management, billing
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const { v4: uuidv4 } = require('uuid');

// --- ORGANIZATION REGISTRATION ---

router.post('/register', async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const {
      name, type, admin_name, admin_email, admin_phone, admin_title,
      address_line1, address_line2, city, state, lga,
      email, phone, website, rc_number, tax_id, description,
      user_id,
    } = req.body;

    if (!name || !type || !admin_name || !admin_email || !admin_phone) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') +
      '-' + uuidv4().split('-')[0];

    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO ng_organizations (
        name, slug, type, admin_name, admin_email, admin_phone, admin_title,
        address_line1, address_line2, city, state, lga,
        email, phone, website, rc_number, tax_id, description,
        owner_user_id, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending_review')
      RETURNING id, slug, status
    `, [
      name, slug, type, admin_name, admin_email, admin_phone, admin_title || null,
      address_line1 || null, address_line2 || null, city || null, state || null, lga || null,
      email || null, phone || null, website || null, rc_number || null, tax_id || null,
      description || null, user_id || null,
    ]);

    const orgId = result.rows[0].id;

    // If user_id provided, add them as owner member
    if (user_id) {
      await client.query(`
        INSERT INTO ng_organization_members (org_id, user_id, full_name, role, status, joined_at)
        VALUES ($1, $2, $3, 'owner', 'active', NOW())
      `, [orgId, user_id, admin_name]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      organization: result.rows[0],
      message: 'Organisation registered. Verification pending.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- GET ORGANIZATION ---

router.get('/:orgId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_organizations WHERE id = $1',
      [req.params.orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Organisation not found' });
    res.json({ organization: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MEMBERS ---

router.get('/:orgId/members', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const where = ['m.org_id = $1'];
    const params = [req.params.orgId];
    if (status) { where.push(`m.status = $${params.length + 1}`); params.push(status); }

    const result = await pool.query(`
      SELECT m.*, u.email as user_email
      FROM ng_organization_members m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_organization_members WHERE org_id = $1`,
      [req.params.orgId]
    );
    res.json({ members: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:orgId/members/invite', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { email, phone, full_name, department, designation, role = 'member' } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

    const token = uuidv4();
    const result = await pool.query(`
      INSERT INTO ng_organization_members
        (org_id, invite_email, invite_phone, full_name, department, designation, role,
         status, invite_token, invited_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'invited',$8,NOW())
      RETURNING id, invite_token
    `, [
      req.params.orgId, email || null, phone || null,
      full_name || null, department || null, designation || null, role, token,
    ]);

    // TODO: Send invite via email/SMS using existing notification service
    res.status(201).json({ member: result.rows[0], invite_link: `/ng/auth/register?token=${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:orgId/members/bulk', authenticate, async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { members } = req.body;
    if (!Array.isArray(members) || !members.length) {
      return res.status(400).json({ error: 'Members array required' });
    }

    await client.query('BEGIN');
    const inserted = [];
    for (const m of members.slice(0, 500)) {
      const token = uuidv4();
      const row = await client.query(`
        INSERT INTO ng_organization_members
          (org_id, invite_email, invite_phone, full_name, department, designation, role, status, invite_token, invited_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'invited',$8,NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        req.params.orgId, m.email || null, m.phone || null, m.full_name || null,
        m.department || null, m.designation || null, m.role || 'member', token,
      ]);
      if (row.rows.length) inserted.push(row.rows[0].id);
    }

    await client.query(`
      UPDATE ng_organizations SET active_member_count = (
        SELECT COUNT(*) FROM ng_organization_members
        WHERE org_id = $1 AND status IN ('active','invited')
      ), updated_at = NOW() WHERE id = $1
    `, [req.params.orgId]);

    await client.query('COMMIT');
    res.json({ inserted: inserted.length, total_submitted: members.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:orgId/members/:memberId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { status, role, department, designation } = req.body;
    await pool.query(`
      UPDATE ng_organization_members
      SET status = COALESCE($1, status),
          role = COALESCE($2, role),
          department = COALESCE($3, department),
          designation = COALESCE($4, designation),
          updated_at = NOW()
      WHERE id = $5 AND org_id = $6
    `, [status, role, department, designation, req.params.memberId, req.params.orgId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:orgId/members/:memberId', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    await pool.query(`
      UPDATE ng_organization_members SET status = 'removed', removed_at = NOW()
      WHERE id = $1 AND org_id = $2
    `, [req.params.memberId, req.params.orgId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BILLING ---

router.get('/:orgId/billing', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const org = await pool.query('SELECT * FROM ng_organizations WHERE id = $1', [req.params.orgId]);
    const billing = await pool.query(
      'SELECT * FROM ng_billing_records WHERE subscriber_org_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.orgId]
    );
    const sub = org.rows[0]?.subscription_id
      ? await pool.query('SELECT * FROM ng_subscriptions WHERE id = $1', [org.rows[0].subscription_id])
      : { rows: [] };
    res.json({
      organization: org.rows[0],
      subscription: sub.rows[0] || null,
      billing_records: billing.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN: LIST & VERIFY ORGS ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { status, type, limit = 50, offset = 0 } = req.query;
    const where = ['1=1'];
    const params = [];
    if (status) { where.push(`status = $${params.length + 1}`); params.push(status); }
    if (type) { where.push(`type = $${params.length + 1}`); params.push(type); }

    const result = await pool.query(`
      SELECT * FROM ng_organizations WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_organizations WHERE ${where.join(' AND ')}`, params
    );
    res.json({ organizations: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:orgId/verify', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { action, reason } = req.body;
    const statusMap = { approve: 'active', reject: 'rejected', suspend: 'suspended' };
    if (!statusMap[action]) return res.status(400).json({ error: 'Invalid action' });

    await pool.query(`
      UPDATE ng_organizations SET
        status = $1, rejection_reason = $2,
        verified_at = CASE WHEN $1 = 'active' THEN NOW() ELSE verified_at END,
        verified_by = $3, updated_at = NOW()
      WHERE id = $4
    `, [statusMap[action], reason || null, req.user.id, req.params.orgId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
