'use strict';
const router = require('express').Router();
const workflow = require('../services/logistics/medicationDeliveryWorkflowService');
const { getPool } = require('../../server/db');
router.use(async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const actor = req.user?.id && (await getPool().query('SELECT id,role,is_active FROM users WHERE id=$1', [req.user.id])).rows[0];
    if (!actor?.is_active || !['admin', 'super_admin'].includes(actor.role)) return res.status(403).json({ error: 'Administrator access is required.' });
    next();
  } catch { res.status(503).json({ error: 'Medication operations authorization is unavailable.' }); }
});
const route = fn => async (req, res) => { try { res.json(await fn(req)); } catch (error) { res.status(error.status || error.statusCode || 503).json({ error: error.status || error.statusCode ? error.message : 'Medication operations are temporarily unavailable.' }); } };
router.get('/', route(req => workflow.adminReport(req.user)));
router.get('/insurance-partners', route(req => workflow.listInsurancePartners(req.user)));
router.get('/:orderId/checkout', route(req => workflow.getCheckout(req.params.orderId, req.user)));
router.post('/:orderId/coverage', route(req => workflow.setCoverage(req.params.orderId, req.user, req.body)));
router.post('/:orderId/refunds/refresh', route(req => workflow.refreshRefunds(req.params.orderId, req.user)));
router.post('/:orderId/returns/refund', route(req => workflow.refundReturn(req.params.orderId, req.user, req.body)));
router.post('/:orderId/settlements', route(req => workflow.initiateSettlement(req.params.orderId, req.user, req.body)));
router.post('/:orderId/settlements/refresh', route(req => workflow.refreshSettlements(req.params.orderId, req.user)));
module.exports = router;
