/**
 * Pharmacy API Routes
 * Pharmacy finder, preferences, and network management
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const pharmacyService = require('../services/pharmacyService');
const logger = require('../middleware/logger');
const { z } = require('zod');
const { validate } = require('../../lib/validation');

// Validation schemas
const addPharmacySchema = z.object({
  pharmacyName: z.string().min(1).max(255),
  pharmacyAddress: z.string().min(1),
  pharmacyPhone: z.string().optional(),
  pharmacyNpi: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distanceMiles: z.number().optional(),
  isPreferred: z.boolean().optional(),
  source: z.enum(['patient_selected', 'ocr_extracted', 'gps_located']).optional()
});

/**
 * GET /api/pharmacy/nearby
 * Find pharmacies near a location
 */
router.get('/nearby',
  authenticate,
  async (req, res) => {
    try {
      const { latitude, longitude, radius } = req.query;
      
      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          error: 'Latitude and longitude are required'
        });
      }
      
      const pharmacies = await pharmacyService.findNearbyPharmacies(
        parseFloat(latitude),
        parseFloat(longitude),
        parseInt(radius) || 5000
      );
      
      res.json({
        success: true,
        pharmacies
      });
    } catch (error) {
      logger.error('Find nearby pharmacies error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to find nearby pharmacies'
      });
    }
  }
);

/**
 * GET /api/pharmacy/search
 * Search pharmacies by name or address
 */
router.get('/search',
  authenticate,
  async (req, res) => {
    try {
      const { q, latitude, longitude, limit } = req.query;
      
      if (!q || q.length < 2) {
        return res.json({
          success: true,
          pharmacies: []
        });
      }
      
      const pharmacies = await pharmacyService.searchPharmacies(q, {
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        limit: parseInt(limit) || 20
      });
      
      res.json({
        success: true,
        pharmacies
      });
    } catch (error) {
      logger.error('Search pharmacies error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search pharmacies'
      });
    }
  }
);

/**
 * GET /api/pharmacy/preferences
 * Get patient's pharmacy preferences
 */
router.get('/preferences',
  authenticate,
  async (req, res) => {
    try {
      // For providers/admins, allow querying specific patient
      const patientId = ['provider', 'admin', 'super_admin'].includes(req.user.role)
        ? req.query.patientId || req.user.id
        : req.user.id;
      
      const pharmacies = await pharmacyService.getPatientPharmacies(patientId);
      
      res.json({
        success: true,
        pharmacies
      });
    } catch (error) {
      logger.error('Get pharmacy preferences error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get pharmacy preferences'
      });
    }
  }
);

/**
 * POST /api/pharmacy/preferences
 * Add pharmacy to patient preferences
 */
router.post('/preferences',
  authenticate,
  auditMiddleware('create', 'pharmacy_preference'),
  async (req, res) => {
    try {
      const data = validate(addPharmacySchema, req.body);
      
      // For providers/admins, allow setting for specific patient
      const patientId = ['provider', 'admin', 'super_admin'].includes(req.user.role)
        ? req.body.patientId || req.user.id
        : req.user.id;
      
      const pharmacy = await pharmacyService.addPatientPharmacy(patientId, data);
      
      logger.info('Pharmacy preference added', {
        patientId,
        pharmacyName: data.pharmacyName
      });
      
      res.status(201).json({
        success: true,
        pharmacy
      });
    } catch (error) {
      logger.error('Add pharmacy preference error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add pharmacy preference'
      });
    }
  }
);

/**
 * PUT /api/pharmacy/preferences/:id/preferred
 * Set pharmacy as preferred
 */
router.put('/preferences/:id/preferred',
  authenticate,
  auditMiddleware('update', 'pharmacy_preference'),
  async (req, res) => {
    try {
      const pharmacy = await pharmacyService.setPreferredPharmacy(req.user.id, req.params.id);
      
      if (!pharmacy) {
        return res.status(404).json({
          success: false,
          error: 'Pharmacy preference not found'
        });
      }
      
      res.json({
        success: true,
        pharmacy
      });
    } catch (error) {
      logger.error('Set preferred pharmacy error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set preferred pharmacy'
      });
    }
  }
);

/**
 * DELETE /api/pharmacy/preferences/:id
 * Remove pharmacy from preferences
 */
router.delete('/preferences/:id',
  authenticate,
  auditMiddleware('delete', 'pharmacy_preference'),
  async (req, res) => {
    try {
      const deleted = await pharmacyService.removePatientPharmacy(req.user.id, req.params.id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Pharmacy preference not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Pharmacy removed from preferences'
      });
    } catch (error) {
      logger.error('Remove pharmacy preference error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove pharmacy preference'
      });
    }
  }
);

/**
 * GET /api/pharmacy/:npi
 * Get pharmacy by NPI
 */
router.get('/:npi',
  authenticate,
  async (req, res) => {
    try {
      const pharmacy = await pharmacyService.getPharmacyByNpi(req.params.npi);
      
      if (!pharmacy) {
        return res.status(404).json({
          success: false,
          error: 'Pharmacy not found'
        });
      }
      
      res.json({
        success: true,
        pharmacy
      });
    } catch (error) {
      logger.error('Get pharmacy by NPI error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get pharmacy'
      });
    }
  }
);

/**
 * POST /api/pharmacy/network
 * Add pharmacy to network (admin only)
 */
router.post('/network',
  authenticate,
  requireRole(['admin', 'super_admin']),
  auditMiddleware('create', 'pharmacy'),
  async (req, res) => {
    try {
      const pharmacy = await pharmacyService.upsertPharmacy(req.body);
      
      logger.info('Pharmacy added to network', {
        pharmacyId: pharmacy.id,
        name: pharmacy.name,
        npi: pharmacy.npi
      });
      
      res.status(201).json({
        success: true,
        pharmacy
      });
    } catch (error) {
      logger.error('Add pharmacy to network error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add pharmacy to network'
      });
    }
  }
);

module.exports = router;

