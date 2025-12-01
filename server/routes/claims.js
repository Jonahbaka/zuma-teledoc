/**
 * Claims API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const claimsService = require('../services/claimsService');

// Get claims for current user
router.get('/', authenticate, async (req, res) => {
  try {
    let claims;
    
    if (req.user.role === 'patient') {
      claims = await claimsService.getClaimsByPatient(req.user.id);
    } else if (req.user.role === 'provider' || req.user.role === 'admin') {
      // Providers and admins can see claims requiring review
      if (req.query.status === 'review') {
        claims = await claimsService.getClaimsRequiringReview();
      } else {
        // Get all claims (in production, add pagination and filtering)
        const result = await require('../db').pool.query(
          'SELECT * FROM claims ORDER BY created_at DESC LIMIT 100'
        );
        claims = result.rows;
      }
    } else {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    res.json({ success: true, claims });
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get claim by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await require('../db').pool.query(
      'SELECT * FROM claims WHERE id = $1',
      [req.params.id]
    );
    
    const claim = result.rows[0];
    
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    
    // Check access
    if (req.user.role === 'patient' && claim.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error fetching claim:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create and scrub claim
router.post('/', authenticate, auditMiddleware('create', 'claim'), async (req, res) => {
  try {
    if (req.user.role !== 'provider' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only providers can create claims' });
    }
    
    const claim = await claimsService.createAndScrubClaim({
      ...req.body,
      providerId: req.user.id,
      createdBy: req.user.id
    });
    
    res.status(201).json({ success: true, claim });
  } catch (error) {
    console.error('Error creating claim:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit claim to clearinghouse
router.post('/:id/submit', authenticate, auditMiddleware('update', 'claim'), async (req, res) => {
  try {
    if (req.user.role !== 'provider' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    const claim = await claimsService.submitClaimToClearinghouse(req.params.id);
    
    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error submitting claim:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply auto-corrections to claim
router.patch('/:id/correct', authenticate, auditMiddleware('update', 'claim'), async (req, res) => {
  try {
    if (req.user.role !== 'provider' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    const claim = await claimsService.applyAutoCorrections(
      req.params.id,
      req.body.corrections
    );
    
    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error applying corrections:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update claim remittance
router.patch('/:id/remittance', authenticate, auditMiddleware('update', 'claim'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only admins can update remittance' });
    }
    
    const claim = await claimsService.updateClaimRemittance(
      req.params.id,
      req.body
    );
    
    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error updating remittance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

