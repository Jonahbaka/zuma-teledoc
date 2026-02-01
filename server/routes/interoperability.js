/**
 * Interoperability API Routes
 * 
 * Provides FHIR R4 endpoints for integration with hospital EHR systems
 * like Epic, Cerner, and Allscripts.
 * 
 * Endpoints:
 * - FHIR Resource Access
 * - Referral Management
 * - Consent Management
 * - Analytics Export
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const FHIRBridge = require('../services/fhir-bridge');
const AnalyticsEngine = require('../services/analytics-engine');

// Initialize services
const fhirBridge = new FHIRBridge(db);
const analytics = new AnalyticsEngine(db);

// ============================================================================
// FHIR RESOURCE ENDPOINTS
// These are the 3 key endpoints hospitals need
// ============================================================================

/**
 * GET /api/interop/fhir/Patient/:id
 * 
 * Retrieve patient data in FHIR R4 format
 * Requires: Patient consent for the requesting organization
 */
router.get('/fhir/Patient/:id', authenticate, async (req, res) => {
  try {
    const patientId = req.params.id;
    const requestingOrg = req.headers['x-organization-id'];

    // Verify consent if external request
    if (requestingOrg) {
      const consent = await fhirBridge.consentManager.checkConsent(
        patientId, requestingOrg, 'treatment'
      );
      
      if (!consent) {
        return res.status(403).json({
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'forbidden',
            diagnostics: 'Patient has not consented to data sharing with this organization'
          }]
        });
      }
    }

    const patient = await fhirBridge.toFHIRPatient(patientId);
    
    res.set('Content-Type', 'application/fhir+json');
    res.json(patient);

  } catch (error) {
    console.error('FHIR Patient error:', error);
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /api/interop/fhir/Encounter/:id
 * 
 * Retrieve encounter/visit data in FHIR format
 */
router.get('/fhir/Encounter/:id', authenticate, async (req, res) => {
  try {
    const encounter = await fhirBridge.toFHIREncounter(req.params.id);
    res.set('Content-Type', 'application/fhir+json');
    res.json(encounter);
  } catch (error) {
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-found', diagnostics: error.message }]
    });
  }
});

/**
 * GET /api/interop/fhir/MedicationRequest/:id
 * 
 * Retrieve prescription data in FHIR format
 */
router.get('/fhir/MedicationRequest/:id', authenticate, async (req, res) => {
  try {
    const medication = await fhirBridge.toFHIRMedicationRequest(req.params.id);
    res.set('Content-Type', 'application/fhir+json');
    res.json(medication);
  } catch (error) {
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-found', diagnostics: error.message }]
    });
  }
});

/**
 * GET /api/interop/fhir/Patient/:id/Observation
 * 
 * Retrieve patient vitals and lab results
 */
router.get('/fhir/Patient/:patientId/Observation', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const observations = await fhirBridge.toFHIRObservations(req.params.patientId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });

    // Return as a FHIR Bundle
    res.set('Content-Type', 'application/fhir+json');
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: observations.length,
      entry: observations.map(obs => ({
        resource: obs,
        fullUrl: `urn:uuid:${obs.id}`
      }))
    });
  } catch (error) {
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

// ============================================================================
// REFERRAL ENDPOINTS
// ============================================================================

/**
 * POST /api/interop/referrals
 * 
 * Create and dispatch a patient referral to an external hospital
 */
router.post('/referrals', authenticate, requireRole('provider', 'admin'), async (req, res) => {
  try {
    const {
      patientId,
      destinationOrganizationId,
      specialty,
      urgency,
      reasonForReferral,
      clinicalNotes,
      includeHistory,
      includeMedications,
      includeVitals
    } = req.body;

    // Get destination organization details
    const { rows: orgs } = await db.query(
      'SELECT * FROM connected_organizations WHERE id = $1 AND status = $2',
      [destinationOrganizationId, 'active']
    );

    if (orgs.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Destination organization not found or not active'
      });
    }

    const destinationOrg = orgs[0];

    // Create the referral bundle
    const bundle = await fhirBridge.createReferralBundle(patientId, {
      referringProviderId: req.user.id,
      destinationOrganization: {
        id: destinationOrg.id,
        name: destinationOrg.name,
        fhirEndpoint: destinationOrg.fhir_endpoint
      },
      specialty,
      urgency,
      reasonForReferral,
      clinicalNotes,
      includeHistory,
      includeMedications,
      includeVitals
    });

    // Dispatch if organization has FHIR endpoint
    let dispatchResult = null;
    if (destinationOrg.fhir_endpoint) {
      dispatchResult = await fhirBridge.dispatchReferral(
        patientId,
        { ...req.body, destinationOrganization: destinationOrg },
        {
          url: destinationOrg.fhir_endpoint,
          authType: 'smart',
          credentials: {
            tokenUrl: destinationOrg.token_endpoint,
            clientId: destinationOrg.client_id_encrypted, // Would need decryption
            clientSecret: destinationOrg.client_secret_encrypted
          }
        }
      );
    }

    res.status(201).json({
      success: true,
      bundleId: bundle.id,
      dispatched: !!dispatchResult,
      dispatchResult
    });

  } catch (error) {
    console.error('Referral error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/interop/referrals/:bundleId
 * 
 * Get referral status
 */
router.get('/referrals/:bundleId', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, d.status as dispatch_status, d.dispatched_at
       FROM referral_audit_log r
       LEFT JOIN referral_dispatch_log d ON d.bundle_id = r.bundle_id
       WHERE r.bundle_id = $1`,
      [req.params.bundleId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Referral not found' });
    }

    res.json({ success: true, referral: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CONSENT ENDPOINTS
// ============================================================================

/**
 * POST /api/interop/consents
 * 
 * Create a new data sharing consent
 */
router.post('/consents', authenticate, async (req, res) => {
  try {
    const {
      patientId,
      organizationId,
      organizationName,
      purpose,
      scope,
      dataCategories,
      validUntil
    } = req.body;

    // Verify requester is the patient or their provider
    if (req.user.role === 'patient' && req.user.id !== patientId) {
      return res.status(403).json({
        success: false,
        error: 'Patients can only manage their own consents'
      });
    }

    const result = await fhirBridge.consentManager.createConsent({
      patientId,
      organizationId,
      organizationName,
      purpose,
      scope,
      dataCategories,
      validUntil: validUntil ? new Date(validUntil) : null,
      grantedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      consentId: result.consentId,
      fhirConsent: result.fhirConsent
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/interop/consents/patient/:patientId
 * 
 * Get all consents for a patient
 */
router.get('/consents/patient/:patientId', authenticate, async (req, res) => {
  try {
    const includeRevoked = req.query.includeRevoked === 'true';
    const consents = await fhirBridge.consentManager.getPatientConsents(
      req.params.patientId,
      includeRevoked
    );

    res.json({ success: true, consents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/interop/consents/:consentId
 * 
 * Revoke a consent
 */
router.delete('/consents/:consentId', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    
    // Get consent to verify patient
    const { rows } = await db.query(
      'SELECT patient_id FROM patient_consents WHERE id = $1',
      [req.params.consentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Consent not found' });
    }

    // Verify requester is the patient
    if (req.user.role === 'patient' && req.user.id !== rows[0].patient_id) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await fhirBridge.consentManager.revokeConsent(
      req.params.consentId,
      rows[0].patient_id,
      reason
    );

    res.json({ success: true, message: 'Consent revoked' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ANALYTICS ENDPOINTS (For Hospital IT Teams)
// ============================================================================

/**
 * GET /api/interop/analytics/treatment-efficacy
 * 
 * Get treatment efficacy metrics for population health analysis
 * De-identified data only
 */
router.get('/analytics/treatment-efficacy', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { conditionCode, medicationClass, minSampleSize } = req.query;
    
    const data = await analytics.getTreatmentEfficacy({
      conditionCode,
      medicationClass,
      minSampleSize: parseInt(minSampleSize) || 5
    });

    res.json({
      success: true,
      data,
      meta: {
        disclaimer: 'All data is de-identified per HIPAA Safe Harbor guidelines',
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/interop/analytics/provider-performance
 * 
 * Get provider performance metrics for quality reporting
 */
router.get('/analytics/provider-performance', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { specialty, performanceTier } = req.query;
    
    const data = await analytics.getProviderPerformance({
      specialty,
      performanceTier
    });

    res.json({
      success: true,
      data,
      meta: {
        disclaimer: 'Provider identities are anonymized',
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/interop/analytics/population-health
 * 
 * Get population health overview
 */
router.get('/analytics/population-health', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { ageBracket, gender, conditionCategory } = req.query;
    
    const data = await analytics.getPopulationHealth({
      ageBracket,
      gender,
      conditionCategory
    });

    res.json({
      success: true,
      data,
      meta: {
        disclaimer: 'All patient data is aggregated and de-identified',
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/interop/analytics/run-etl
 * 
 * Manually trigger ETL pipeline (admin only)
 */
router.post('/analytics/run-etl', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { fullRefresh, startDate, endDate } = req.body;
    
    const result = await analytics.runETL({
      fullRefresh,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/interop/analytics/export/:type
 * 
 * Export analytics data in various formats
 */
router.get('/analytics/export/:type', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { type } = req.params;
    const { format } = req.query;
    
    const data = await analytics.exportData(type, {
      format: format || 'json',
      filters: req.query
    });

    if (format === 'csv') {
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', `attachment; filename="${type}_export.csv"`);
      res.send(data);
    } else {
      res.json({ success: true, data });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CONNECTED ORGANIZATIONS MANAGEMENT
// ============================================================================

/**
 * GET /api/interop/organizations
 * 
 * List connected healthcare organizations
 */
router.get('/organizations', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, type, ehr_system, status, fhir_endpoint,
              contact_name, contact_email, last_sync_at, created_at
       FROM connected_organizations
       ORDER BY name`
    );

    res.json({ success: true, organizations: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/interop/organizations
 * 
 * Register a new healthcare organization
 */
router.post('/organizations', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const {
      name, type, fhirEndpoint, ehrSystem,
      contactName, contactEmail, contactPhone
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO connected_organizations 
       (name, type, fhir_endpoint, ehr_system, contact_name, contact_email, contact_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [name, type, fhirEndpoint, ehrSystem, contactName, contactEmail, contactPhone]
    );

    res.status(201).json({ success: true, organization: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
