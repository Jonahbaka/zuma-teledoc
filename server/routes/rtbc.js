'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rtbcService = require('../services/rtbcService');

function medicationInput(input) {
  return typeof input.medicationName === 'string' && input.medicationName.trim().length > 0
    && input.medicationName.length <= 255
    && (input.ndcCode == null || typeof input.ndcCode === 'string' && input.ndcCode.length <= 20)
    && (input.insuranceId == null || typeof input.insuranceId === 'string'
      && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.insuranceId));
}

function errorResponse(res, error) {
  const unavailable = error.statusCode === 503;
  return res.status(unavailable ? 503 : 500).json({
    success: false, ...(unavailable ? { status: 'unavailable', code: error.code } : {}),
    error: unavailable ? error.message : 'Medication benefits could not be checked.',
  });
}

router.get('/check', authenticate, async (req, res) => {
  if (!medicationInput(req.query)) return res.status(400).json({ success: false, error: 'Valid medication details are required.' });
  try {
    const rtbc = await rtbcService.getRTBC(req.user.id, req.query.medicationName.trim(), req.query.ndcCode || null, req.query.insuranceId || null);
    res.json({ success: true, rtbc });
  } catch (error) { errorResponse(res, error); }
});

router.post('/compare', authenticate, async (req, res) => {
  if (!medicationInput(req.body)) return res.status(400).json({ success: false, error: 'Valid medication details are required.' });
  try {
    // A client-supplied membership flag cannot establish a negotiated price.
    const comparison = await rtbcService.comparePrices(req.user.id, req.body.medicationName.trim(), req.body.ndcCode || null);
    res.json({ success: true, ...comparison });
  } catch (error) { errorResponse(res, error); }
});

module.exports = router;

