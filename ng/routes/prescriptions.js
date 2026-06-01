/**
 * ng/routes/prescriptions.js
 * Prescription lifecycle API. Mounted at /api/ng/prescriptions (authenticated).
 *
 *   GET  /                              — list (?provider_id|patient_user_id|pharmacy_id|status|since|limit)
 *   POST /                              — create draft
 *   GET  /:id                           — single + items
 *   GET  /:id/events                    — audit trail
 *   POST /:id/sign                      — lock draft
 *   POST /:id/send                      — { pharmacy_id }
 *   POST /:id/receive                   — pharmacy acknowledges
 *   POST /:id/cancel                    — { reason }
 *   POST /:id/complete                  — final
 *   POST /:id/items/:itemId/dispense    — { quantity?, substitute_drug_id?, substitute_reason?, pharmacy_id?, notes? }
 *   POST /:id/items/:itemId/unavailable — { notes? }
 *   POST /:id/refill                    — { item_id?, quantity?, notes? }
 *   POST /refills/:refillId/approve
 *   POST /refills/:refillId/deny        — { reason? }
 */

const express = require('express');
const router = express.Router();
const svc = require('../services/rx-engine/prescriptionWorkflowService');

// ─── Clinical role enforcement ────────────────────────────────────────────────
// The routes were previously authenticate-only: any logged-in user — including a
// patient — could sign, dispense, cancel, or approve refills. These guards split
// prescriber / pharmacist / patient duties. Admins may override any action.
const roleOf = (req) => String(req.user?.role || '').toLowerCase().trim().replace(/\s+/g, '_');
const PRESCRIBER = new Set(['doctor', 'provider', 'consultant', 'physician', 'specialist', 'prescriber']);
const PHARMACIST = new Set(['pharmacist', 'pharmacy', 'dispenser']);
const PATIENT    = new Set(['patient']);
const ADMIN      = new Set(['admin', 'administrator', 'super_admin', 'superadmin', 'platform_admin']);

function actor(req) {
  const role = roleOf(req);
  return {
    user_id: req.user?.id || null,
    kind: PHARMACIST.has(role) ? 'pharmacist'
        : PATIENT.has(role)    ? 'patient'
        :                        'prescriber',
  };
}

function requireRole(...groups) {
  const allowed = new Set(groups.flatMap((g) => [...g]));
  return (req, res, next) => {
    const role = roleOf(req);
    if (ADMIN.has(role) || allowed.has(role)) return next();
    return res.status(403).json({ ok: false, error: `forbidden: action requires role ${[...allowed].join(' | ')}` });
  };
}

function handleError(res, err) {
  if (err.code === 'NOT_FOUND')          return res.status(404).json({ ok: false, error: err.message });
  if (err.code === 'FORBIDDEN')          return res.status(403).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_TRANSITION') return res.status(409).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_STATE')      return res.status(409).json({ ok: false, error: err.message });
  console.error('[NG/Rx]', err);
  return res.status(500).json({ ok: false, error: err.message });
}

async function resolveProviderId(req, pool) {
  const result = await pool.query('SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1', [req.user.id]);
  return result.rows[0]?.id || null;
}

async function resolvePharmacyId(req, pool) {
  const result = await pool.query('SELECT id FROM ng_pharmacies WHERE owner_user_id = $1 LIMIT 1', [req.user.id]);
  return result.rows[0]?.id || null;
}

function canAccessRx(role, rx, { providerId, pharmacyId, patientUserId }) {
  if (ADMIN.has(role)) return true;
  if (PATIENT.has(role)) return rx.patient_user_id === patientUserId;
  if (PRESCRIBER.has(role)) return Boolean(providerId && rx.provider_id === providerId);
  if (PHARMACIST.has(role)) {
    return Boolean(
      pharmacyId &&
      [rx.preferred_pharmacy_id, rx.routed_pharmacy_id, rx.dispensed_by_pharmacy_id].includes(pharmacyId)
    );
  }
  return false;
}

async function getScopedPrescription(req, pool, allowedGroups = [PATIENT, PRESCRIBER, PHARMACIST]) {
  const role = roleOf(req);
  const allowed = new Set(allowedGroups.flatMap((group) => [...group]));
  if (!ADMIN.has(role) && !allowed.has(role)) {
    const e = new Error('Prescription access denied');
    e.code = 'FORBIDDEN';
    throw e;
  }

  const rx = await svc.getPrescription(req.params.id, pool);
  if (!rx) return null;

  const providerId = PRESCRIBER.has(role) ? await resolveProviderId(req, pool) : null;
  const pharmacyId = PHARMACIST.has(role) ? await resolvePharmacyId(req, pool) : null;
  const patientUserId = PATIENT.has(role) ? req.user.id : null;
  if (canAccessRx(role, rx, { providerId, pharmacyId, patientUserId })) return rx;

  const e = new Error('Prescription access denied');
  e.code = 'FORBIDDEN';
  throw e;
}

async function getScopedRefillPrescription(req, refillId, pool, allowedGroups = [PRESCRIBER]) {
  const result = await pool.query('SELECT prescription_id FROM ng_rx_refills WHERE id = $1', [refillId]);
  const prescriptionId = result.rows[0]?.prescription_id;
  if (!prescriptionId) {
    const e = new Error('Refill not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  req.params.id = prescriptionId;
  return getScopedPrescription(req, pool, allowedGroups);
}

router.get('/', async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const role = roleOf(req);
    const scope = {
      provider_id: req.query.provider_id,
      patient_user_id: req.query.patient_user_id,
      pharmacy_id: req.query.pharmacy_id,
    };

    if (!ADMIN.has(role)) {
      if (PATIENT.has(role)) {
        scope.provider_id = undefined;
        scope.patient_user_id = req.user.id;
        scope.pharmacy_id = undefined;
      } else if (PRESCRIBER.has(role)) {
        const providerId = await resolveProviderId(req, pool);
        if (!providerId) return res.json({ ok: true, prescriptions: [] });
        scope.provider_id = providerId;
        scope.patient_user_id = undefined;
        scope.pharmacy_id = undefined;
      } else if (PHARMACIST.has(role)) {
        const pharmacyId = await resolvePharmacyId(req, pool);
        if (!pharmacyId) return res.json({ ok: true, prescriptions: [] });
        scope.provider_id = undefined;
        scope.patient_user_id = undefined;
        scope.pharmacy_id = pharmacyId;
      } else {
        return res.status(403).json({ ok: false, error: 'Prescription access denied' });
      }
    }

    const rows = await svc.listPrescriptions({
      provider_id:     scope.provider_id,
      patient_user_id: scope.patient_user_id,
      pharmacy_id:     scope.pharmacy_id,
      status:          req.query.status,
      since:           req.query.since,
      limit:           req.query.limit ? Number(req.query.limit) : undefined,
    }, pool);
    res.json({ ok: true, prescriptions: rows });
  } catch (e) { handleError(res, e); }
});

router.post('/', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const role = roleOf(req);
    const providerId = ADMIN.has(role) ? req.body.provider_id : await resolveProviderId(req, pool);
    if (!providerId) return res.status(403).json({ ok: false, error: 'Provider profile required' });
    const rx = await svc.createDraft({ ...req.body, provider_id: providerId });
    res.status(201).json({ ok: true, prescription: rx });
  } catch (e) { handleError(res, e); }
});

router.get('/:id', async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: rx });
  } catch (e) { handleError(res, e); }
});

router.get('/:id/events', async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, events: await svc.listEvents(req.params.id, pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/:id/sign', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PRESCRIBER]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.sign(req.params.id, actor(req), req.body || {}, pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/:id/send', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const pid = req.body?.pharmacy_id;
    if (!pid) return res.status(400).json({ ok: false, error: 'pharmacy_id required' });
    const rx = await getScopedPrescription(req, pool, [PRESCRIBER]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.sendToPharmacy(req.params.id, pid, actor(req), pool) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/receive', requireRole(PHARMACIST), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PHARMACIST]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.acknowledgeReceipt(req.params.id, actor(req), pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/:id/cancel', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PRESCRIBER]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.cancel(req.params.id, actor(req), req.body || {}, pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/:id/complete', requireRole(PHARMACIST, PRESCRIBER), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PHARMACIST, PRESCRIBER]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.complete(req.params.id, actor(req), pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/:id/items/:itemId/dispense', requireRole(PHARMACIST), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PHARMACIST]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.dispenseItem(req.params.id, req.params.itemId, actor(req), req.body || {}, pool) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/items/:itemId/unavailable', requireRole(PHARMACIST), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PHARMACIST]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: await svc.markItemUnavailable(req.params.id, req.params.itemId, actor(req), req.body || {}, pool) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/refill', requireRole(PATIENT, PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const rx = await getScopedPrescription(req, pool, [PATIENT, PRESCRIBER]);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.status(201).json({ ok: true, refill: await svc.requestRefill(req.params.id, req.body?.item_id, actor(req), req.body || {}, pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/refills/:refillId/approve', requireRole(PRESCRIBER), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    await getScopedRefillPrescription(req, req.params.refillId, pool, [PRESCRIBER]);
    res.json({ ok: true, refill: await svc.approveRefill(req.params.refillId, actor(req), pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/refills/:refillId/deny', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    await getScopedRefillPrescription(req, req.params.refillId, pool, [PRESCRIBER]);
    res.json({ ok: true, refill: await svc.denyRefill(req.params.refillId, actor(req), req.body || {}, pool) });
  }
  catch (e) { handleError(res, e); }
});

module.exports = router;
