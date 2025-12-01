/**
 * Prior Authorization API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const priorAuthService = require('../services/priorAuthService');

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
    const priorAuth = await priorAuthService.getPriorAuthById(req.params.id);
    
    if (!priorAuth) {
      return res.status(404).json({ success: false, error: 'Prior authorization not found' });
    }
    
    // Check access
    if (req.user.role === 'patient' && priorAuth.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
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
    console.error('Error creating prior authorization:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update prior authorization status
router.patch('/:id/status', authenticate, auditMiddleware('update', 'prior_authorization'), async (req, res) => {
  try {
    const { status, ...updates } = req.body;
    
    const priorAuth = await priorAuthService.updatePriorAuthStatus(
      req.params.id,
      status,
      updates
    );
    
    res.json({ success: true, priorAuth });
  } catch (error) {
    console.error('Error updating prior authorization:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

