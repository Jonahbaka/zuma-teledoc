/**
 * Prior Authorization API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const priorAuthService = require('../services/priorAuthService');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function integrationErrorResponse(res, error, fallback) {
  const unavailable = error.statusCode === 503;
  return res.status(unavailable ? 503 : 500).json({
    success: false, ...(unavailable ? { status: 'unavailable', code: error.code } : {}),
    error: unavailable ? error.message : fallback,
  });
}

// Get prior authorizations for current user (patient or provider)
router.get('/', authenticate, async (req, res) => {
  try {
    let priorAuths;
    
    if (req.user.role === 'patient') {
      priorAuths = await priorAuthService.getPriorAuthsByPatient(req.user.id);
    } else if (req.user.role === 'provider') {
      priorAuths = await priorAuthService.getPriorAuthsByProvider(req.user.id);
    } else {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    res.json({ success: true, priorAuths });
  } catch (error) {
    console.error('Error fetching prior authorizations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get prior authorization by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!['patient', 'provider'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    if (!uuid.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid authorization identifier' });
    const priorAuth = await priorAuthService.getPriorAuthById(req.params.id);
    
    if (!priorAuth) {
      return res.status(404).json({ success: false, error: 'Prior authorization not found' });
    }
    
    // Check access
    const ownerId = req.user.role === 'patient' ? priorAuth.patient_id : priorAuth.provider_id;
    if (String(ownerId) !== String(req.user.id)) {
      return res.status(404).json({ success: false, error: 'Prior authorization not found' });
    }
    
    res.json({ success: true, priorAuth });
  } catch (error) {
    console.error('Error fetching prior authorization:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create prior authorization
router.post('/', authenticate, auditMiddleware('create', 'prior_authorization'), async (req, res) => {
  try {
    if (req.user.role !== 'provider') {
      return res.status(403).json({ success: false, error: 'Only providers can create prior authorizations' });
    }
    
    const priorAuth = await priorAuthService.createPriorAuth({
      ...req.body,
      providerId: req.user.id,
      submittedBy: req.user.id
    });
    
    res.status(201).json({ success: true, priorAuth });
  } catch (error) {
    integrationErrorResponse(res, error, 'Prior authorization could not be submitted.');
  }
});

// Update prior authorization status
router.patch('/:id/status', authenticate, auditMiddleware('update', 'prior_authorization'), async (req, res) => {
  try {
    if (req.user.role !== 'provider') return res.status(403).json({ success: false, error: 'Only providers can update prior authorizations' });
    if (!uuid.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid authorization identifier' });
    const { status, ...updates } = req.body;
    
    const priorAuth = await priorAuthService.updatePriorAuthStatus(
      req.params.id,
      status,
      updates
    );
    
    res.json({ success: true, priorAuth });
  } catch (error) {
    integrationErrorResponse(res, error, 'Prior authorization status could not be updated.');
  }
});

module.exports = router;

