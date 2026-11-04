'use strict';
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');
const labs = require('../services/clinicalLabService');
router.use((_req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
router.use(authenticate, requireRole('provider'));
const run = action => async (req, res) => {
  try { res.json({ success: true, data: await action(req) }); }
  catch (error) { res.status(error.statusCode || 503).json({ success: false, code: /^(LAB|CLINICAL)_[A-Z_]+$/.test(error.code || '') ? error.code : 'LAB_UNAVAILABLE', error: 'The laboratory operation could not be confirmed. Refresh the encounter before retrying.' }); }
};
router.get('/:encounterId/orders', run(req => labs.list(db.getPool(), req.user, req.params.encounterId)));
router.post('/:encounterId/orders', run(req => labs.create(db.getPool(), req.user, req.params.encounterId, req.body)));
router.post('/:encounterId/orders/:orderId/events', run(req => labs.append(db.getPool(), req.user, req.params.encounterId, req.params.orderId, req.body)));
module.exports = router;
