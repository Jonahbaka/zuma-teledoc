/**
 * Prescription API Routes
 * E-prescribing, medication management, and pharmacy integration
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { validate } = require('../../lib/validation');
const prescriptionService = require('../services/prescriptionService');
const logger = require('../middleware/logger');
const { z } = require('zod');

// Validation schemas
const createPrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  visitId: z.string().uuid().optional(),
  medicationName: z.string().min(1).max(255),
  genericName: z.string().max(255).optional(),
  ndcCode: z.string().max(20).optional(),
  dosageStrength: z.string().min(1).max(100),
  dosageForm: z.string().min(1).max(100),
  dosageUnit: z.string().max(50).optional(),
  routeOfAdministration: z.string().max(100).optional(),
  quantity: z.number().int().positive(),
  quantityUnit: z.string().max(50).optional(),
  daysSupply: z.number().int().positive(),
  refillsAllowed: z.number().int().min(0).max(12).optional(),
  dispenseAsWritten: z.boolean().optional(),
  scheduleClass: z.enum(['II', 'III', 'IV', 'V', 'non-controlled']).optional(),
  sigDirections: z.string().min(1),
  patientInstructions: z.string().optional(),
  pharmacyNotes: z.string().optional(),
  diagnosisCode: z.string().max(20).optional(),
  diagnosisDescription: z.string().optional(),
  indication: z.string().optional(),
  requiresPriorAuth: z.boolean().optional(),
  pharmacy: z.object({
    id: z.string().optional(),
    name: z.string(),
    npi: z.string().optional(),
    address: z.string(),
    phone: z.string().optional(),
    fax: z.string().optional()
  }).optional()
});

const updatePharmacySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  npi: z.string().optional(),
  address: z.string().min(1),
  phone: z.string().optional(),
  fax: z.string().optional()
});

/**
 * POST /api/prescriptions
 * Create a new prescription
 */
router.post('/',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('create', 'prescription'),
  async (req, res) => {
    try {
      const data = validate(createPrescriptionSchema, req.body);
      
      const prescription = await prescriptionService.createPrescription(data, req.user.id);
      
      logger.info('Prescription created', {
        prescriptionId: prescription.id,
        providerId: req.user.id,
        patientId: data.patientId,
        medication: data.medicationName
      });
      
      res.status(201).json({
        success: true,
        prescription
      });
    } catch (error) {
      logger.error('Create prescription error:', error);
      res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Failed to create prescription'
      });
    }
  }
);

/**
 * GET /api/prescriptions
 * Get prescriptions (provider sees their prescriptions, patient sees theirs)
 */
router.get('/',
  authenticate,
  async (req, res) => {
    try {
      const { status, patientId, limit, offset } = req.query;
      
      let prescriptions;
      if (req.user.role === 'patient') {
        prescriptions = await prescriptionService.getPatientPrescriptions(
          req.user.id,
          { status, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 }
        );
      } else if (['provider', 'admin', 'super_admin'].includes(req.user.role)) {
        prescriptions = await prescriptionService.getProviderPrescriptions(
          req.user.id,
          { status, patientId, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 }
        );
      } else {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      
      res.json({
        success: true,
        prescriptions
      });
    } catch (error) {
      logger.error('Get prescriptions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prescriptions'
      });
    }
  }
);

/**
 * GET /api/prescriptions/:id
 * Get prescription by ID
 */
router.get('/:id',
  authenticate,
  auditMiddleware('read', 'prescription'),
  async (req, res) => {
    try {
      const prescription = await prescriptionService.getPrescriptionById(
        req.params.id,
        req.user.id,
        req.user.role
      );
      
      if (!prescription) {
        return res.status(404).json({
          success: false,
          error: 'Prescription not found'
        });
      }
      
      res.json({
        success: true,
        prescription
      });
    } catch (error) {
      logger.error('Get prescription error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prescription'
      });
    }
  }
);

/**
 * GET /api/prescriptions/:id/history
 * Get prescription history
 */
router.get('/:id/history',
  authenticate,
  async (req, res) => {
    try {
      const history = await prescriptionService.getPrescriptionHistory(req.params.id);
      
      res.json({
        success: true,
        history
      });
    } catch (error) {
      logger.error('Get prescription history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prescription history'
      });
    }
  }
);

/**
 * POST /api/prescriptions/:id/sign-and-send
 * Sign and send prescription to pharmacy
 */
router.post('/:id/sign-and-send',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'prescription'),
  async (req, res) => {
    try {
      const { deaNumber, signature } = req.body;
      
      const prescription = await prescriptionService.signAndSend(
        req.params.id,
        req.user.id,
        deaNumber,
        signature
      );
      
      logger.info('Prescription signed and sent', {
        prescriptionId: req.params.id,
        providerId: req.user.id
      });
      
      res.json({
        success: true,
        prescription,
        message: 'Prescription sent to pharmacy'
      });
    } catch (error) {
      logger.error('Sign and send error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to send prescription'
      });
    }
  }
);

/**
 * PUT /api/prescriptions/:id/pharmacy
 * Update prescription pharmacy
 */
router.put('/:id/pharmacy',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'prescription'),
  async (req, res) => {
    try {
      const pharmacy = validate(updatePharmacySchema, req.body);
      
      const prescription = await prescriptionService.updatePharmacy(
        req.params.id,
        req.user.id,
        pharmacy
      );
      
      res.json({
        success: true,
        prescription
      });
    } catch (error) {
      logger.error('Update pharmacy error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to update pharmacy'
      });
    }
  }
);

/**
 * POST /api/prescriptions/:id/cancel
 * Cancel prescription
 */
router.post('/:id/cancel',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'prescription'),
  async (req, res) => {
    try {
      const { reason } = req.body;
      
      const prescription = await prescriptionService.cancelPrescription(
        req.params.id,
        req.user.id,
        reason
      );
      
      logger.info('Prescription cancelled', {
        prescriptionId: req.params.id,
        providerId: req.user.id,
        reason
      });
      
      res.json({
        success: true,
        prescription,
        message: 'Prescription cancelled'
      });
    } catch (error) {
      logger.error('Cancel prescription error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to cancel prescription'
      });
    }
  }
);

/**
 * POST /api/prescriptions/:id/refill
 * Request prescription refill
 */
router.post('/:id/refill',
  authenticate,
  requireRole(['patient']),
  auditMiddleware('update', 'prescription'),
  async (req, res) => {
    try {
      const prescription = await prescriptionService.requestRefill(
        req.params.id,
        req.user.id
      );
      
      logger.info('Refill requested', {
        prescriptionId: req.params.id,
        patientId: req.user.id
      });
      
      res.json({
        success: true,
        prescription,
        message: 'Refill request sent'
      });
    } catch (error) {
      logger.error('Request refill error:', error);
      res.status(error.message?.includes('not eligible') ? 400 : 500).json({
        success: false,
        error: error.message || 'Failed to request refill'
      });
    }
  }
);

/**
 * GET /api/prescriptions/medications/search
 * Search medications for auto-complete
 */
router.get('/medications/search',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || q.length < 2) {
        return res.json({
          success: true,
          medications: []
        });
      }
      
      const medications = await prescriptionService.searchMedications(q);
      
      res.json({
        success: true,
        medications
      });
    } catch (error) {
      logger.error('Search medications error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search medications'
      });
    }
  }
);

module.exports = router;

