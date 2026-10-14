/**
 * Insurance Wallet & OCR API Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireRole, canAccessPatient } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const insuranceWalletService = require('../services/insuranceWalletService');
const manualInsuranceService = require('../services/manualInsuranceService');
const db = require('../db');
const ocrService = require('../services/ocrService');
const { scopedFinancialRecord, patientFinancialAccess } = require('../middleware/financialRecordScope');
const insuranceScope = scopedFinancialRecord('patient_insurance', 'insurance');
function integrationErrorResponse(res, error, fallback) {
  const unavailable = error.statusCode === 503;
  return res.status(unavailable ? 503 : 500).json({
    success: false, ...(unavailable ? { status: 'unavailable', code: error.code } : {}),
    error: unavailable ? error.message : fallback,
  });
}

function ocrAccessAndReadiness(req, res, next) {
  if (req.user.role !== 'patient') return res.status(403).json({ success: false, error: 'Only patients can upload insurance cards' });
  try { ocrService.assertAvailable(); return next(); }
  catch (error) { return integrationErrorResponse(res, error, 'Insurance card scanning could not be started.'); }
}
async function patientScope(req, res, next) {
  try {
    if (!await patientFinancialAccess(req.user, req.params.patientId)) return res.status(404).json({ success: false, error: 'Patient not found' });
    next();
  } catch (error) { next(error); }
}

router.post('/manual', authenticate, async (req, res) => {
  try {
    const result = await manualInsuranceService.saveManualInsurance(db.pool, req, req.body);
    res.set('Cache-Control', 'private, no-store');
    res.status(result.created ? 201 : 200).json({ success: true, insurance: result.insurance });
  } catch (error) {
    const status = [400, 403, 409, 503].includes(error.statusCode) ? error.statusCode : 503;
    res.status(status).json({ success: false, ...(status === 503 ? { status: 'unavailable' } : {}),
      code: error.code || 'INSURANCE_STORAGE_UNAVAILABLE',
      error: error.statusCode ? error.message : 'Insurance details could not be saved securely. Try again later.' });
  }
});

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Provider/Admin: Get a patient's insurance wallet (for visits/triage prep)
router.get('/patient/:patientId/wallet',
  authenticate,
  requireRole('provider', 'admin', 'super_admin'),
  canAccessPatient,
  patientScope,
  async (req, res) => {
    try {
      const wallet = await insuranceWalletService.getWallet(req.params.patientId);
      res.json({ success: true, wallet });
    } catch (error) {
      console.error('Error fetching patient wallet:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Provider/Admin: Get a specific insurance record with audit logging (images omitted by default)
router.get('/patient/:patientId/:id',
  authenticate,
  requireRole('provider', 'admin', 'super_admin'),
  canAccessPatient,
  patientScope,
  insuranceScope,
  async (req, res) => {
    try {
      if (String(req.insurance.user_id || req.insurance.patient_id) !== String(req.params.patientId)) return res.status(404).json({ success: false, error: 'Insurance not found' });
      const insurance = await insuranceWalletService.getInsuranceById(
        req.params.id,
        req.user.id,
        req.query.reason || 'provider_view'
      );

      if (!insurance || String(insurance.patient_id) !== String(req.params.patientId)) {
        return res.status(404).json({ success: false, error: 'Insurance not found' });
      }

      // Avoid returning decrypted images to provider unless explicitly requested (PHI minimization)
      const includeImages = req.query.includeImages === 'true';
      if (!includeImages) {
        insurance.frontImageDecrypted = null;
        insurance.backImageDecrypted = null;
      }

      res.json({ success: true, insurance });
    } catch (error) {
      console.error('Error fetching patient insurance:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

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
router.get('/:id', authenticate, insuranceScope, async (req, res) => {
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
router.post('/ocr', authenticate, ocrAccessAndReadiness, auditMiddleware('create', 'insurance', { phiAccessed: true }), upload.fields([
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
    
    res.status(201).json({ success: true, insurance });
  } catch (error) {
    integrationErrorResponse(res, error, 'Insurance card scanning could not be completed.');
  }
});

// Set primary insurance
router.patch('/:id/primary', authenticate, insuranceScope, auditMiddleware('update', 'insurance'), async (req, res) => {
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
router.post('/:id/verify', authenticate, insuranceScope, auditMiddleware('verify', 'insurance'), async (req, res) => {
  try {
    const result = await insuranceWalletService.verifyEligibility(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    integrationErrorResponse(res, error, 'Insurance eligibility could not be checked.');
  }
});

// Update insurance status
router.patch('/:id/status', authenticate, insuranceScope, auditMiddleware('update', 'insurance'), async (req, res) => {
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
router.post('/:id/consent', authenticate, insuranceScope, auditMiddleware('update', 'insurance', { phiAccessed: true }), async (req, res) => {
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
router.get('/:id/export', authenticate, insuranceScope, auditMiddleware('export', 'insurance', { phiAccessed: true }), async (req, res) => {
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
router.get('/:id/audit', authenticate, insuranceScope, async (req, res) => {
  try {
    const auditLog = await insuranceWalletService.getAuditLog(req.params.id);
    res.json({ success: true, auditLog });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

