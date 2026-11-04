/**
 * Nigeria Hospital / Clinic Routes
 * Registration, staff management, departments, integration status
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const adminDecisions = require('../services/adminVerificationService');
const integrationRead = require('../services/hospitalIntegrationReadService');
const hospitalManagement = require('../services/hospitalManagementService');

function sendHospitalError(res, err, fallback) {
  const status = [400,403,404,409].includes(err.status) ? err.status : 503;
  return res.status(status).json({ error: status === 503 ? fallback : err.message });
}

// Public applications remain supported, but supplied credentials must be valid.
// Never silently downgrade an expired or revoked session to anonymous creation.
function authenticateRegistration(req, res, next) {
  if (Object.prototype.hasOwnProperty.call(req.headers || {}, 'authorization') || req.cookies?.accessToken) {
    return authenticate(req, res, next);
  }
  return next();
}

// --- HOSPITAL REGISTRATION ---

router.post('/register', authenticateRegistration, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const { hospital, ownerLinked } = await hospitalManagement.registerHospital(getPool(), req);
    res.status(201).json({ hospital, owner_linked: ownerLinked,
      message: 'Hospital registered. Verification pending admin review.' });
  } catch (err) {
    sendHospitalError(res, err, 'Hospital registration could not be saved. Please retry.');
  }
});

// --- GET HOSPITAL ---

router.get('/:hospitalId', authenticate, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json(await hospitalManagement.readHospital(getPool(), req, req.params.hospitalId));
  } catch (err) {
    sendHospitalError(res, err, 'Hospital details are currently unavailable.');
  }
});

// --- STAFF ---

router.get('/:hospitalId/staff', authenticate, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json(await hospitalManagement.readStaff(getPool(), req, req.params.hospitalId));
  } catch (err) {
    sendHospitalError(res, err, 'Hospital staff details are currently unavailable.');
  }
});

router.post('/:hospitalId/staff', authenticate, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const staff = await hospitalManagement.createStaff(getPool(), req, req.params.hospitalId);
    res.status(201).json({ staff_id: staff.id, staff });
  } catch (err) {
    sendHospitalError(res, err, 'The staff record could not be saved. Please retry.');
  }
});

router.patch('/:hospitalId/staff/:staffId', authenticate, async (req, res) => {
  try {
    await integrationRead.updateStaff(getPool(),req,req.params.hospitalId,req.params.staffId);
    res.json({ success:true });
  } catch(err) {
    const status=[400,403,404].includes(err.status) ? err.status : 503;
    res.status(status).json({ error:status===503 ? 'The staff update could not be saved.' : err.message });
  }
});

// --- INTEGRATION STATUS ---

router.get('/:hospitalId/integrations', authenticate, async (req, res) => {
  res.set('Cache-Control','private, no-store');
  try {
    const integrations = await integrationRead.readIntegrations(getPool(),req,req.params.hospitalId);
    res.json({ integrations });
  } catch (err) {
    const status = [400,403,404].includes(err.status) ? err.status : 503;
    res.status(status).json({ error:status === 503 ? 'Integration status is currently unavailable.' : err.message });
  }
});

// --- ADMIN ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json(await hospitalManagement.listHospitals(getPool(), req));
  } catch (err) {
    sendHospitalError(res, err, 'Hospital applications are currently unavailable.');
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
