/**
 * Insurance Wallet & OCR API Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const insuranceWalletService = require('../services/insuranceWalletService');
const ocrService = require('../services/ocrService');
const eligibilityService = require('../services/eligibilityService');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Get patient insurance wallet
router.get('/wallet', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can access wallet' });
    }
    
    const wallet = await insuranceWalletService.getWallet(req.user.id);
    res.json({ success: true, wallet });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get insurance by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const insurance = await insuranceWalletService.getInsuranceById(
      req.params.id,
      req.user.id,
      req.query.reason || 'view'
    );
    
    if (!insurance) {
      return res.status(404).json({ success: false, error: 'Insurance not found' });
    }
    
    // Check access
    if (req.user.role === 'patient' && insurance.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    res.json({ success: true, insurance });
  } catch (error) {
    console.error('Error fetching insurance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload and OCR insurance card
router.post('/ocr', authenticate, auditMiddleware('create', 'insurance', { phiAccessed: true }), upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 }
]), async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can upload insurance cards' });
    }
    
    const frontFile = req.files?.frontImage?.[0];
    const backFile = req.files?.backImage?.[0];
    
    if (!frontFile) {
      return res.status(400).json({ success: false, error: 'Front image is required' });
    }
    
    // Convert to base64
    const frontImageBase64 = frontFile.buffer.toString('base64');
    const backImageBase64 = backFile?.buffer.toString('base64');
    
    // Process with OCR
    const ocrProvider = req.body.ocrProvider || 'auto';
    const insurance = await ocrService.saveInsuranceCardWithOCR(
      req.user.id,
      frontImageBase64,
      backImageBase64,
      ocrProvider
    );
    
    // Auto-verify eligibility if high confidence
    if (insurance.ocr_confidence_score >= 0.8) {
      try {
        await insuranceWalletService.verifyEligibility(insurance.id);
      } catch (eligError) {
        // Don't fail the request if eligibility check fails
        console.warn('Auto-eligibility check failed:', eligError);
      }
    }
    
    res.status(201).json({ success: true, insurance });
  } catch (error) {
    console.error('Error processing OCR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set primary insurance
router.patch('/:id/primary', authenticate, auditMiddleware('update', 'insurance'), async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can set primary insurance' });
    }
    
    const insurance = await insuranceWalletService.setPrimaryInsurance(
      req.user.id,
      req.params.id
    );
    
    res.json({ success: true, insurance });
  } catch (error) {
    console.error('Error setting primary insurance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify eligibility
router.post('/:id/verify', authenticate, auditMiddleware('verify', 'insurance'), async (req, res) => {
  try {
    const result = await insuranceWalletService.verifyEligibility(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error verifying eligibility:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update insurance status
router.patch('/:id/status', authenticate, auditMiddleware('update', 'insurance'), async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can update status' });
    }
    
    const insurance = await insuranceWalletService.setInsuranceStatus(
      req.params.id,
      req.body.status
    );
    
    res.json({ success: true, insurance });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Capture consent
router.post('/:id/consent', authenticate, auditMiddleware('update', 'insurance', { phiAccessed: true }), async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can give consent' });
    }
    
    const insurance = await insuranceWalletService.captureConsent(
      req.params.id,
      req.body.consentGiven === true
    );
    
    res.json({ success: true, insurance });
  } catch (error) {
    console.error('Error capturing consent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export insurance proof
router.get('/:id/export', authenticate, auditMiddleware('export', 'insurance', { phiAccessed: true }), async (req, res) => {
  try {
    const exportData = await insuranceWalletService.exportInsuranceProof(
      req.params.id,
      req.user.id
    );
    
    res.json({ success: true, ...exportData });
  } catch (error) {
    console.error('Error exporting proof:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit log
router.get('/:id/audit', authenticate, async (req, res) => {
  try {
    const auditLog = await insuranceWalletService.getAuditLog(req.params.id);
    res.json({ success: true, auditLog });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

