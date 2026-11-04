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
const pharmacistRx = require('../services/pharmacy/pharmacistRxService');
const prescriberRx = require('../services/rx-engine/prescriberRxService');
const patientAdminRxRead = require('../services/rx-engine/patientAdminRxReadService');
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// ─── Clinical role enforcement ────────────────────────────────────────────────
// The routes were previously authenticate-only: any logged-in user — including a
// patient — could sign, dispense, cancel, or approve refills. These guards split
// prescriber / pharmacist / patient duties. Administration is not clinical authority.
const roleOf = (req) => String(req.user?.role || '').toLowerCase().trim().replace(/\s+/g, '_');
const PRESCRIBER = new Set(['doctor', 'provider', 'consultant', 'physician', 'specialist', 'prescriber']);
const PHARMACIST = new Set(['pharmacist', 'pharmacy', 'dispenser']);
const PATIENT    = new Set(['patient']);

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
    // Operational admins are not clinically credentialed by virtue of admin access.
    // Only authenticated prescribers and dispensing professionals may mutate Rx state.
    if (allowed.has(role)) return next();
    return res.status(403).json({ ok: false, error: `forbidden: action requires role ${[...allowed].join(' | ')}` });
  };
}

function handleError(res, err) {
  if (/^CLINICAL_AI_RX_|^CLINICAL_AI_CARE_ACTION_|^CLINICAL_AI_ENCOUNTER_MISMATCH$|^ASSIGNED_CLINICIAN_REQUIRED$/.test(err.code || '')) {
    return res.status(err.statusCode || 409).json({ ok: false, code: err.code, error: 'The clinical review does not authorize this prescription context.' });
  }
  if (err.code === 'NOT_FOUND')          return res.status(404).json({ ok: false, error: err.message });
  if (err.code === 'FORBIDDEN')          return res.status(403).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_TRANSITION') return res.status(409).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_STATE')      return res.status(409).json({ ok: false, error: err.message });
  console.error('[NG/Rx]', err);
  return res.status(500).json({ ok: false, error: err.message });
}

async function pharmacistAction(req, res, action, itemId = null) {
  const { getPool } = require('../../server/db');
  try { res.json({ ok: true, prescription: await pharmacistRx.mutate(getPool(), req.user, req.params.id, action, req.body || {}, itemId) }); }
  catch (error) { pharmacistRx.sendError(res, error); }
}

async function prescriberAction(req, res, action, refillDecision = false) {
  try {
    const result = await prescriberRx.mutate(require('../../server/db').getPool(), req.user,
      refillDecision ? req.params.refillId : req.params.id, action, req.body || {});
    const refill = action === 'refill' || refillDecision;
    res.status(action === 'refill' ? 201 : 200).json({ ok:true,[refill ? 'refill' : 'prescription']:result });
  } catch (error) { prescriberRx.sendError(res,error); }
}

router.get('/', async (req, res) => {
  if (PRESCRIBER.has(roleOf(req))) {
    try { return res.json({ ok:true,prescriptions:await prescriberRx.list(require('../../server/db').getPool(),req.user,req.query) }); }
    catch (error) { return prescriberRx.sendError(res,error); }
  }
  if (PHARMACIST.has(roleOf(req))) {
    try { return res.json({ ok: true, prescriptions: await pharmacistRx.list(require('../../server/db').getPool(), req.user, req.query) }); }
    catch (error) { return pharmacistRx.sendError(res, error); }
  }
  try {
    res.json({ ok: true, prescriptions: await patientAdminRxRead.list(require('../../server/db').getPool(), req.user, req.query) });
  } catch (error) { patientAdminRxRead.sendError(res, error); }
});

router.post('/', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  try {
    // Manual prescriptions remain supported; optional approved-AI provenance is
    // validated as a pair and never replaces current prescriber/care authority.
    const aiSourceSuggestionId = req.body?.aiSourceSuggestionId || null;
    const phcEncounterId = req.body?.phcEncounterId || null;
    if ((aiSourceSuggestionId == null) !== (phcEncounterId == null)) return res.status(400).json({ ok:false,code:'CLINICAL_AI_RX_SOURCE_INVALID',error:'Provide both the approved AI review and PHC encounter, or neither.' });
    const prescription = await prescriberRx.create(require('../../server/db').getPool(),req.user,{ ...req.body,aiSourceSuggestionId,phcEncounterId });
    res.status(201).json({ ok:true,prescription });
  } catch (error) { prescriberRx.sendError(res,error); }
});

router.get('/:id', async (req, res) => {
  if (PRESCRIBER.has(roleOf(req))) {
    try { return res.json({ ok:true,prescription:await prescriberRx.read(require('../../server/db').getPool(),req.user,req.params.id,false) }); }
    catch (error) { return prescriberRx.sendError(res,error); }
  }
  if (PHARMACIST.has(roleOf(req))) {
    try { return res.json({ ok: true, prescription: await pharmacistRx.read(require('../../server/db').getPool(), req.user, req.params.id, false) }); }
    catch (error) { return pharmacistRx.sendError(res, error); }
  }
  try {
    res.json({ ok: true, prescription: await patientAdminRxRead.read(require('../../server/db').getPool(), req.user, req.params.id) });
  } catch (error) { patientAdminRxRead.sendError(res, error); }
});

router.get('/:id/events', async (req, res) => {
  if (PRESCRIBER.has(roleOf(req))) {
    try { return res.json({ ok:true,events:await prescriberRx.read(require('../../server/db').getPool(),req.user,req.params.id,true) }); }
    catch (error) { return prescriberRx.sendError(res,error); }
  }
  if (PHARMACIST.has(roleOf(req))) {
    try { return res.json({ ok: true, events: await pharmacistRx.read(require('../../server/db').getPool(), req.user, req.params.id, true) }); }
    catch (error) { return pharmacistRx.sendError(res, error); }
  }
  try {
    res.json({ ok: true, events: await patientAdminRxRead.read(require('../../server/db').getPool(), req.user, req.params.id, true) });
  } catch (error) { patientAdminRxRead.sendError(res, error); }
});

router.post('/:id/sign', requireRole(PRESCRIBER), express.json(), async (req, res) => prescriberAction(req,res,'sign'));

router.post('/:id/send', requireRole(PRESCRIBER), express.json(), async (req, res) => {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    const pid = req.body?.pharmacy_id;
    if (!pid) return res.status(400).json({ ok: false, error: 'pharmacy_id required' });
    const prescription = await prescriberRx.mutate(pool,req.user,req.params.id,'send',req.body || {});
    // Pharmacy notification is permitted only after a signed, routed Rx.
    // The notification service independently rechecks those conditions.
    let pharmacyNotification = null;
    try {
      pharmacyNotification = await require('../services/whatsapp/whatsappDispenseService')
        .createPharmacyPrescriptionNotification({
          prescriptionId: prescription.id, pharmacyId: pid,
          createdByUserId: req.user.id,
        });
    } catch (_notificationError) {
      // Sending was committed; do not falsely report that the Rx failed.
      // The pharmacy dashboard remains the authoritative inbox.
    }
    res.json({ ok: true, prescription, pharmacyNotification });
  } catch (e) { prescriberRx.sendError(res, e); }
});

router.post('/:id/receive', requireRole(PHARMACIST), async (req, res) => {
  return pharmacistAction(req, res, 'receive');
});

router.post('/:id/cancel', requireRole(PRESCRIBER), express.json(), async (req, res) => prescriberAction(req,res,'cancel'));

router.post('/:id/complete', requireRole(PHARMACIST, PRESCRIBER), async (req, res) => {
  if (PHARMACIST.has(roleOf(req))) return pharmacistAction(req,res,'complete');
  return prescriberAction(req,res,'complete');
});

router.post('/:id/items/:itemId/dispense', requireRole(PHARMACIST), express.json(), async (req, res) => {
  return pharmacistAction(req, res, 'dispense', req.params.itemId);
});

router.post('/:id/items/:itemId/unavailable', requireRole(PHARMACIST), express.json(), async (req, res) => {
  return pharmacistAction(req, res, 'unavailable', req.params.itemId);
});

router.post('/:id/refill', requireRole(PATIENT, PRESCRIBER), express.json(), async (req, res) => {
  if (PRESCRIBER.has(roleOf(req))) return prescriberAction(req,res,'refill');
  const { getPool } = require('../../server/db');
  const pool = getPool();
  try {
    res.status(201).json({ ok: true, refill: await svc.requestPatientRefill(req.params.id, req.body?.item_id, actor(req), req.body || {}, pool) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/refills/:refillId/approve', requireRole(PRESCRIBER), async (req, res) => prescriberAction(req,res,'approve_refill',true));

router.post('/refills/:refillId/deny', requireRole(PRESCRIBER), express.json(), async (req, res) => prescriberAction(req,res,'deny_refill',true));

module.exports = router;
