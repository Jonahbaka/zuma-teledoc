/**
 * Claims API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const claimsService = require('../services/claimsService');
const db = require('../db');
const { patientMarketSql, actorMarket, patientFinancialAccess, scopedFinancialRecord } = require('../middleware/financialRecordScope');
const claimScope = scopedFinancialRecord('claims', 'claim');

// Get claims for current user
router.get('/', authenticate, async (req, res) => {
  try {
    if (!['patient', 'provider', 'admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    const { rows: claims } = await db.query(
      `SELECT c.* FROM claims c JOIN users p ON p.id = c.patient_id
        WHERE ${patientMarketSql('p')} = $1
          AND ($2 <> 'patient' OR c.patient_id = $3)
          AND ($2 <> 'provider' OR c.provider_id = $3)
          AND ($4 = false OR c.requires_review = true)
        ORDER BY c.created_at DESC LIMIT 100`,
      [actorMarket(req.user), req.user.role, req.user.id, req.query.status === 'review']
    );
    
    res.json({ success: true, claims });
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get claim by ID
router.get('/:id', authenticate, claimScope, async (req, res) => {
  try {
    const claim = req.claim;
    
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
    if (req.user.role !== 'provider') {
      return res.status(403).json({ success: false, error: 'Only providers can create claims' });
    }
    if (!await patientFinancialAccess(req.user, req.body.patientId)) {
      return res.status(403).json({ success: false, error: 'Patient access denied' });
    }
    
    const claim = await claimsService.createAndScrubClaim({
      ...req.body,
      providerId: req.user.id,
      createdBy: req.user.id
    });
    
    res.status(201).json({ success: true, claim });
  } catch (error) {
    console.error('Error creating claim:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Claim creation failed', code: error.code });
  }
});

// Submit claim to clearinghouse
router.post('/:id/submit', authenticate, claimScope, auditMiddleware('update', 'claim'), async (req, res) => {
  try {
    if (req.user.role !== 'provider' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    const claim = await claimsService.submitClaimToClearinghouse(req.params.id);
    
    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error submitting claim:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Claim submission failed', code: error.code });
  }
});

// Apply auto-corrections to claim
router.patch('/:id/correct', authenticate, claimScope, auditMiddleware('update', 'claim'), async (req, res) => {
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
router.patch('/:id/remittance', authenticate, claimScope, auditMiddleware('update', 'claim'), async (req, res) => {
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

