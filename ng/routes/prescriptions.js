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

function actor(req) {
  return {
    user_id: req.user?.id || null,
    kind: req.user?.role === 'pharmacist' ? 'pharmacist'
        : req.user?.role === 'patient'    ? 'patient'
        :                                    'prescriber',
  };
}

function handleError(res, err) {
  if (err.code === 'NOT_FOUND')          return res.status(404).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_TRANSITION') return res.status(409).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_STATE')      return res.status(409).json({ ok: false, error: err.message });
  console.error('[NG/Rx]', err);
  return res.status(500).json({ ok: false, error: err.message });
}

router.get('/', async (req, res) => {
  try {
    const rows = await svc.listPrescriptions({
      provider_id:     req.query.provider_id,
      patient_user_id: req.query.patient_user_id,
      pharmacy_id:     req.query.pharmacy_id,
      status:          req.query.status,
      since:           req.query.since,
      limit:           req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, prescriptions: rows });
  } catch (e) { handleError(res, e); }
});

router.post('/', express.json(), async (req, res) => {
  try {
    const rx = await svc.createDraft({ ...req.body, provider_id: req.body.provider_id || req.user?.provider_id });
    res.status(201).json({ ok: true, prescription: rx });
  } catch (e) { handleError(res, e); }
});

router.get('/:id', async (req, res) => {
  try {
    const rx = await svc.getPrescription(req.params.id);
    if (!rx) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, prescription: rx });
  } catch (e) { handleError(res, e); }
});

router.get('/:id/events', async (req, res) => {
  try { res.json({ ok: true, events: await svc.listEvents(req.params.id) }); }
  catch (e) { handleError(res, e); }
});

router.post('/:id/sign', express.json(), async (req, res) => {
  try { res.json({ ok: true, prescription: await svc.sign(req.params.id, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

router.post('/:id/send', express.json(), async (req, res) => {
  try {
    const pid = req.body?.pharmacy_id;
    if (!pid) return res.status(400).json({ ok: false, error: 'pharmacy_id required' });
    res.json({ ok: true, prescription: await svc.sendToPharmacy(req.params.id, pid, actor(req)) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/receive', async (req, res) => {
  try { res.json({ ok: true, prescription: await svc.acknowledgeReceipt(req.params.id, actor(req)) }); }
  catch (e) { handleError(res, e); }
});

router.post('/:id/cancel', express.json(), async (req, res) => {
  try { res.json({ ok: true, prescription: await svc.cancel(req.params.id, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

router.post('/:id/complete', async (req, res) => {
  try { res.json({ ok: true, prescription: await svc.complete(req.params.id, actor(req)) }); }
  catch (e) { handleError(res, e); }
});

router.post('/:id/items/:itemId/dispense', express.json(), async (req, res) => {
  try {
    res.json({ ok: true, prescription: await svc.dispenseItem(req.params.id, req.params.itemId, actor(req), req.body || {}) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/items/:itemId/unavailable', express.json(), async (req, res) => {
  try {
    res.json({ ok: true, prescription: await svc.markItemUnavailable(req.params.id, req.params.itemId, actor(req), req.body || {}) });
  } catch (e) { handleError(res, e); }
});

router.post('/:id/refill', express.json(), async (req, res) => {
  try { res.status(201).json({ ok: true, refill: await svc.requestRefill(req.params.id, req.body?.item_id, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

router.post('/refills/:refillId/approve', async (req, res) => {
  try { res.json({ ok: true, refill: await svc.approveRefill(req.params.refillId, actor(req)) }); }
  catch (e) { handleError(res, e); }
});

router.post('/refills/:refillId/deny', express.json(), async (req, res) => {
  try { res.json({ ok: true, refill: await svc.denyRefill(req.params.refillId, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

module.exports = router;
