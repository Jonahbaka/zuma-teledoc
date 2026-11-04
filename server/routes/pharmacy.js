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
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function preferenceTarget(req) {
  if (!['patient', 'provider', 'admin', 'super_admin'].includes(req.user.role)) throw Object.assign(new Error('Pharmacy preference access is unavailable for this account.'), { statusCode: 403, code: 'PHARMACY_PREFERENCE_FORBIDDEN' });
  const bodyId = req.body?.patientId;
  const queryId = req.query?.patientId;
  const hasBody = Object.prototype.hasOwnProperty.call(req.body || {}, 'patientId');
  const hasQuery = Object.prototype.hasOwnProperty.call(req.query || {}, 'patientId');
  if ((hasBody && (typeof bodyId !== 'string' || !uuid.test(bodyId))) || (hasQuery && (typeof queryId !== 'string' || !uuid.test(queryId)))) throw Object.assign(new Error('Choose a valid patient account.'), { statusCode: 400, code: 'PHARMACY_PREFERENCE_INPUT_INVALID' });
  if (hasBody && hasQuery && bodyId !== queryId) throw Object.assign(new Error('Choose one patient account.'), { statusCode: 400, code: 'PHARMACY_PREFERENCE_INPUT_INVALID' });
  const selected = hasBody ? bodyId : hasQuery ? queryId : req.user.role === 'patient' ? req.user.id : null;
  if (typeof selected !== 'string' || !uuid.test(selected)) throw Object.assign(new Error('Choose a valid patient account.'), { statusCode: 400, code: 'PHARMACY_PREFERENCE_INPUT_INVALID' });
  return selected;
}
function preferenceFailure(res, error) {
  const status = [400, 403, 404, 409, 503].includes(error.statusCode) ? error.statusCode : 503;
  const code = error.statusCode && String(error.code || '').startsWith('PHARMACY_PREFERENCE_') ? error.code : 'PHARMACY_PREFERENCE_STORAGE_UNAVAILABLE';
  logger.warn('Pharmacy preference request failed', { status, code });
  res.set('Cache-Control', 'private, no-store');
  return res.status(status).json({ success: false, code, ...(status === 503 ? { status: 'unavailable' } : {}),
    error: error.statusCode ? error.message : 'Pharmacy preferences could not be accessed. Try again later.' });
}

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
      const patientId = preferenceTarget(req);
      const pharmacies = await pharmacyService.getPatientPharmacies(patientId, req);
      res.set('Cache-Control', 'private, no-store');
      
      res.json({
        success: true,
        pharmacies
      });
    } catch (error) {
      preferenceFailure(res, error);
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
      const patientId = preferenceTarget(req);
      const saved = await pharmacyService.addPatientPharmacy(patientId, req.body, req);
      res.set('Cache-Control', 'private, no-store');
      res.status(saved.created ? 201 : 200).json({
        success: true,
        pharmacy: saved.pharmacy,
        created: saved.created
      });
    } catch (error) {
      preferenceFailure(res, error);
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
      const pharmacy = await pharmacyService.setPreferredPharmacy(preferenceTarget(req), req.params.id, req);
      res.set('Cache-Control', 'private, no-store');
      
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
      preferenceFailure(res, error);
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
      const deleted = await pharmacyService.removePatientPharmacy(preferenceTarget(req), req.params.id, req);
      res.set('Cache-Control', 'private, no-store');
      
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
      preferenceFailure(res, error);
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

