/**
 * Clinical Encounters API Routes
 * Mini-EHR System of Record for Telehealth
 * 
 * Provides endpoints for:
 * - Clinical encounter management
 * - SOAP notes with versioning
 * - Patient clinical profiles
 * - Prescription intents (eRx integration)
 * - Telehealth consent
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { authenticate, requireRole, canAccessPatient } = require('../middleware/auth');
const { auditMiddleware, auditPhiAccess } = require('../middleware/audit');
const { validate } = require('../../lib/validation');
const { keysToCamel } = require('../../lib/utils');
const logger = require('../middleware/logger');

// Services
const clinicalEncounterService = require('../services/clinicalEncounterService');
const patientClinicalProfileService = require('../services/patientClinicalProfileService');
const eRxIntegrationService = require('../services/eRxIntegrationService');
const telehealthConsentService = require('../services/telehealthConsentService');

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createEncounterSchema = z.object({
  appointmentId: z.string().uuid().optional(),
  patientId: z.string().uuid(),
  encounterType: z.enum(['telehealth_video', 'telehealth_phone', 'telehealth_async', 'in_person', 'chart_review']),
  patientState: z.string().length(2),
  patientLocationMethod: z.enum(['self_reported', 'ip_geolocation', 'gps']).optional(),
  providerState: z.string().length(2).optional(),
  chiefComplaint: z.string().max(2000).optional(),
  telehealthConsentId: z.string().uuid().optional()
});

const createNoteSchema = z.object({
  noteType: z.enum(['soap', 'progress', 'procedure', 'consultation']).default('soap'),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
  vitals: z.object({
    bloodPressureSystolic: z.number().optional(),
    bloodPressureDiastolic: z.number().optional(),
    heartRate: z.number().optional(),
    respiratoryRate: z.number().optional(),
    temperature: z.number().optional(),
    oxygenSaturation: z.number().optional(),
    weight: z.number().optional(),
    height: z.number().optional()
  }).optional(),
  physicalExam: z.string().optional(),
  icdCodes: z.array(z.string()).optional(),
  cptCodes: z.array(z.string()).optional(),
  followUpRequired: z.boolean().optional(),
  followUpInterval: z.string().optional(),
  followUpNotes: z.string().optional()
});

const createAmendmentSchema = z.object({
  reason: z.string().min(1, 'Amendment reason is required'),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
  icdCodes: z.array(z.string()).optional(),
  cptCodes: z.array(z.string()).optional()
});

const allergySchema = z.object({
  allergen: z.string().min(1),
  allergenType: z.enum(['medication', 'food', 'environmental', 'latex', 'contrast', 'other']),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).optional(),
  onsetDate: z.string().optional(),
  source: z.enum(['patient_reported', 'provider_documented', 'imported']).optional()
});

const problemSchema = z.object({
  icd10Code: z.string().optional(),
  icd10Description: z.string().optional(),
  problemDescription: z.string().optional(),
  problemType: z.enum(['acute', 'chronic', 'resolved', 'inactive', 'rule_out']).optional(),
  priority: z.enum(['primary', 'secondary', 'tertiary']).optional(),
  onsetDate: z.string().optional(),
  encounterId: z.string().uuid().optional()
});

const medicationSchema = z.object({
  medicationName: z.string().min(1),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  route: z.string().optional(),
  medicationType: z.enum(['prescription', 'otc', 'supplement', 'herbal', 'other']).optional(),
  isPrn: z.boolean().optional(),
  source: z.enum(['patient_reported', 'provider_documented', 'erx_import']).optional(),
  prescriberName: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const prescriptionIntentSchema = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  medicationName: z.string().min(1),
  genericName: z.string().optional(),
  dosageStrength: z.string().min(1),
  dosageForm: z.string().min(1),
  route: z.string().optional(),
  quantity: z.number().int().positive(),
  daysSupply: z.number().int().positive(),
  refillsAuthorized: z.number().int().min(0).max(12).optional(),
  indication: z.string().min(1),
  indicationIcd10: z.string().optional(),
  rationale: z.string().optional(),
  sigDirections: z.string().min(1),
  patientInstructions: z.string().optional(),
  pharmacyName: z.string().optional(),
  pharmacyNpi: z.string().optional(),
  pharmacyAddress: z.string().optional(),
  isControlled: z.boolean().optional(),
  scheduleClass: z.enum(['II', 'III', 'IV', 'V']).optional()
});

const captureConsentSchema = z.object({
  templateId: z.string().uuid(),
  templateVersion: z.string().optional(),
  patientState: z.string().length(2),
  consentMethod: z.enum(['electronic_signature', 'verbal_recorded', 'verbal_witnessed', 'written']),
  signatureData: z.any().optional(),
  witnessName: z.string().optional(),
  witnessId: z.string().uuid().optional()
});

// ============================================================================
// CLINICAL ENCOUNTERS
// ============================================================================

/**
 * POST /api/clinical-encounters
 * Create a new clinical encounter
 */
router.post('/',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('create', 'clinical_encounter', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(createEncounterSchema, req.body);
      
      // Validate telehealth consent for telehealth encounters
      if (data.encounterType.startsWith('telehealth')) {
        try {
          await telehealthConsentService.validateConsentForEncounter(
            data.patientId,
            data.patientState
          );
        } catch (consentError) {
          if (consentError.code === 'CONSENT_REQUIRED') {
            return res.status(400).json({
              success: false,
              error: consentError.message,
              code: consentError.code,
              consentRequired: consentError.data
            });
          }
          throw consentError;
        }
      }
      
      const encounter = await clinicalEncounterService.createEncounter(data, req.user.id);
      
      res.status(201).json({
        success: true,
        message: 'Clinical encounter created',
        encounter
      });
    } catch (error) {
      logger.error('Create encounter error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to create encounter'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/:id
 * Get encounter details
 *
 * NOTE: Constrain :id to UUID to avoid collisions with singleton routes like
 * /prescription-intents (otherwise Express will treat "prescription-intents" as :id).
 */
router.get('/:id([0-9a-fA-F-]{36})',
  authenticate,
  auditPhiAccess('clinical_encounter'),
  async (req, res) => {
    try {
      const encounter = await clinicalEncounterService.getEncounterById(
        req.params.id,
        req.user.id,
        req.user.role
      );
      
      if (!encounter) {
        return res.status(404).json({
          success: false,
          error: 'Encounter not found'
        });
      }
      
      res.json({
        success: true,
        encounter
      });
    } catch (error) {
      logger.error('Get encounter error:', error);
      res.status(error.message?.includes('denied') ? 403 : 500).json({
        success: false,
        error: error.message || 'Failed to get encounter'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/:id/complete
 * Complete a clinical encounter
 */
router.post('/:id([0-9a-fA-F-]{36})/complete',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'clinical_encounter'),
  async (req, res) => {
    try {
      const encounter = await clinicalEncounterService.completeEncounter(
        req.params.id,
        req.user.id
      );
      
      res.json({
        success: true,
        message: 'Encounter completed',
        encounter
      });
    } catch (error) {
      logger.error('Complete encounter error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to complete encounter'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId
 * Get patient's encounter history
 */
router.get('/patient/:patientId',
  authenticate,
  canAccessPatient,
  auditPhiAccess('clinical_encounter'),
  async (req, res) => {
    try {
      const { status, limit, offset } = req.query;
      
      const encounters = await clinicalEncounterService.getPatientEncounters(
        req.params.patientId,
        { status, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 }
      );
      
      res.json({
        success: true,
        encounters
      });
    } catch (error) {
      logger.error('Get patient encounters error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get encounters'
      });
    }
  }
);

// ============================================================================
// CLINICAL NOTES
// ============================================================================

/**
 * POST /api/clinical-encounters/:encounterId/notes
 * Create a clinical note (SOAP)
 */
router.post('/:encounterId/notes',
  authenticate,
  requireRole('provider'),
  auditMiddleware('create', 'clinical_note', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(createNoteSchema, req.body);
      
      const note = await clinicalEncounterService.createNote(
        req.params.encounterId,
        req.user.id,
        data
      );
      
      res.status(201).json({
        success: true,
        message: 'Clinical note created',
        note
      });
    } catch (error) {
      logger.error('Create note error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create note'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/:encounterId/notes
 * Get all notes for an encounter
 */
router.get('/:encounterId/notes',
  authenticate,
  auditPhiAccess('clinical_note'),
  async (req, res) => {
    try {
      const notes = await clinicalEncounterService.getEncounterNotes(
        req.params.encounterId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        notes
      });
    } catch (error) {
      logger.error('Get notes error:', error);
      res.status(error.message?.includes('denied') ? 403 : 500).json({
        success: false,
        error: error.message || 'Failed to get notes'
      });
    }
  }
);

/**
 * PUT /api/clinical-encounters/notes/:noteId
 * Update an unsigned note
 */
router.put('/notes/:noteId',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'clinical_note', { phiAccessed: true, logChanges: true }),
  async (req, res) => {
    try {
      const data = validate(createNoteSchema.partial(), req.body);
      
      const note = await clinicalEncounterService.updateNote(
        req.params.noteId,
        req.user.id,
        data
      );
      
      res.json({
        success: true,
        message: 'Note updated',
        note
      });
    } catch (error) {
      logger.error('Update note error:', error);
      res.status(error.message?.includes('signed') ? 400 : 500).json({
        success: false,
        error: error.message || 'Failed to update note'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/notes/:noteId/sign
 * Sign and lock a clinical note
 */
router.post('/notes/:noteId/sign',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'clinical_note', { description: 'Sign clinical note' }),
  async (req, res) => {
    try {
      const note = await clinicalEncounterService.signNote(
        req.params.noteId,
        req.user.id
      );
      
      res.json({
        success: true,
        message: 'Note signed and locked',
        note
      });
    } catch (error) {
      logger.error('Sign note error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to sign note'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/notes/:noteId/amend
 * Create an amendment to a signed note
 */
router.post('/notes/:noteId/amend',
  authenticate,
  requireRole('provider'),
  auditMiddleware('create', 'clinical_note', { phiAccessed: true, description: 'Amend note' }),
  async (req, res) => {
    try {
      const data = validate(createAmendmentSchema, req.body);
      
      const amendment = await clinicalEncounterService.createAmendment(
        req.params.noteId,
        req.user.id,
        data
      );
      
      res.status(201).json({
        success: true,
        message: 'Amendment created',
        note: amendment
      });
    } catch (error) {
      logger.error('Create amendment error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create amendment'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/notes/:noteId/history
 * Get note version history
 */
router.get('/notes/:noteId/history',
  authenticate,
  auditPhiAccess('clinical_note'),
  async (req, res) => {
    try {
      const history = await clinicalEncounterService.getNoteVersionHistory(
        req.params.noteId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        history
      });
    } catch (error) {
      logger.error('Get note history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get note history'
      });
    }
  }
);

// ============================================================================
// PATIENT CLINICAL PROFILE
// ============================================================================

/**
 * GET /api/clinical-encounters/patient/:patientId/profile
 * Get patient clinical profile
 */
router.get('/patient/:patientId/profile',
  authenticate,
  canAccessPatient,
  auditPhiAccess('patient_clinical_profile'),
  async (req, res) => {
    try {
      const profile = await patientClinicalProfileService.getOrCreateProfile(req.params.patientId);
      
      res.json({
        success: true,
        profile
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get profile'
      });
    }
  }
);

/**
 * PUT /api/clinical-encounters/patient/:patientId/profile
 * Update patient clinical profile
 */
router.put('/patient/:patientId/profile',
  authenticate,
  canAccessPatient,
  auditMiddleware('update', 'patient_clinical_profile', { phiAccessed: true }),
  async (req, res) => {
    try {
      const profile = await patientClinicalProfileService.updateProfile(
        req.params.patientId,
        req.body,
        req.user.id
      );
      
      res.json({
        success: true,
        profile
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update profile'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/patient/:patientId/verify-identity
 * Verify patient identity
 */
router.post('/patient/:patientId/verify-identity',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('update', 'patient_clinical_profile', { description: 'Verify identity' }),
  async (req, res) => {
    try {
      const { method } = req.body;
      
      if (!method) {
        return res.status(400).json({
          success: false,
          error: 'Verification method is required'
        });
      }
      
      const profile = await patientClinicalProfileService.verifyIdentity(
        req.params.patientId,
        method,
        req.user.id
      );
      
      res.json({
        success: true,
        message: 'Patient identity verified',
        profile
      });
    } catch (error) {
      logger.error('Verify identity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify identity'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId/summary
 * Get complete clinical summary
 */
router.get('/patient/:patientId/summary',
  authenticate,
  canAccessPatient,
  auditPhiAccess('patient_clinical_summary'),
  async (req, res) => {
    try {
      const summary = await patientClinicalProfileService.getClinicalSummary(
        req.params.patientId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        ...summary
      });
    } catch (error) {
      logger.error('Get clinical summary error:', error);
      res.status(error.message?.includes('denied') ? 403 : 500).json({
        success: false,
        error: error.message || 'Failed to get clinical summary'
      });
    }
  }
);

// ============================================================================
// ALLERGIES
// ============================================================================

/**
 * POST /api/clinical-encounters/patient/:patientId/allergies
 * Add an allergy
 */
router.post('/patient/:patientId/allergies',
  authenticate,
  canAccessPatient,
  auditMiddleware('create', 'patient_allergy', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(allergySchema, req.body);
      
      const allergy = await patientClinicalProfileService.addAllergy(
        req.params.patientId,
        data,
        req.user.id
      );
      
      res.status(201).json({
        success: true,
        allergy
      });
    } catch (error) {
      logger.error('Add allergy error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to add allergy'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId/allergies
 * Get patient allergies
 */
router.get('/patient/:patientId/allergies',
  authenticate,
  canAccessPatient,
  auditPhiAccess('patient_allergy'),
  async (req, res) => {
    try {
      const allergies = await patientClinicalProfileService.getAllergies(
        req.params.patientId,
        req.query.includeInactive === 'true'
      );
      
      res.json({
        success: true,
        allergies
      });
    } catch (error) {
      logger.error('Get allergies error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get allergies'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/allergies/:id/verify
 * Verify an allergy (provider action)
 */
router.post('/allergies/:id/verify',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'patient_allergy', { description: 'Verify allergy' }),
  async (req, res) => {
    try {
      const allergy = await patientClinicalProfileService.verifyAllergy(
        req.params.id,
        req.user.id
      );
      
      res.json({
        success: true,
        allergy
      });
    } catch (error) {
      logger.error('Verify allergy error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify allergy'
      });
    }
  }
);

/**
 * DELETE /api/clinical-encounters/allergies/:id
 * Inactivate an allergy
 */
router.delete('/allergies/:id',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('update', 'patient_allergy', { description: 'Inactivate allergy' }),
  async (req, res) => {
    try {
      const { reason } = req.body;
      
      const allergy = await patientClinicalProfileService.inactivateAllergy(
        req.params.id,
        req.user.id,
        reason || 'Inactivated by provider'
      );
      
      res.json({
        success: true,
        allergy
      });
    } catch (error) {
      logger.error('Inactivate allergy error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to inactivate allergy'
      });
    }
  }
);

// ============================================================================
// PROBLEM LIST
// ============================================================================

/**
 * POST /api/clinical-encounters/patient/:patientId/problems
 * Add a problem/diagnosis
 */
router.post('/patient/:patientId/problems',
  authenticate,
  requireRole('provider'),
  auditMiddleware('create', 'patient_problem', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(problemSchema, req.body);
      
      const problem = await patientClinicalProfileService.addProblem(
        req.params.patientId,
        data,
        req.user.id
      );
      
      res.status(201).json({
        success: true,
        problem
      });
    } catch (error) {
      logger.error('Add problem error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to add problem'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId/problems
 * Get patient problem list
 */
router.get('/patient/:patientId/problems',
  authenticate,
  canAccessPatient,
  auditPhiAccess('patient_problem'),
  async (req, res) => {
    try {
      const problems = await patientClinicalProfileService.getProblems(
        req.params.patientId,
        {
          includeInactive: req.query.includeInactive === 'true',
          problemType: req.query.problemType
        }
      );
      
      res.json({
        success: true,
        problems
      });
    } catch (error) {
      logger.error('Get problems error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get problems'
      });
    }
  }
);

/**
 * PUT /api/clinical-encounters/problems/:id
 * Update a problem
 */
router.put('/problems/:id',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'patient_problem', { phiAccessed: true }),
  async (req, res) => {
    try {
      const problem = await patientClinicalProfileService.updateProblem(
        req.params.id,
        req.body,
        req.user.id
      );
      
      res.json({
        success: true,
        problem
      });
    } catch (error) {
      logger.error('Update problem error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update problem'
      });
    }
  }
);

// ============================================================================
// MEDICATIONS
// ============================================================================

/**
 * POST /api/clinical-encounters/patient/:patientId/medications
 * Add a medication
 */
router.post('/patient/:patientId/medications',
  authenticate,
  canAccessPatient,
  auditMiddleware('create', 'patient_medication', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(medicationSchema, req.body);
      
      const medication = await patientClinicalProfileService.addMedication(
        req.params.patientId,
        data,
        req.user.id
      );
      
      res.status(201).json({
        success: true,
        medication
      });
    } catch (error) {
      logger.error('Add medication error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to add medication'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId/medications
 * Get patient medication list
 */
router.get('/patient/:patientId/medications',
  authenticate,
  canAccessPatient,
  auditPhiAccess('patient_medication'),
  async (req, res) => {
    try {
      const medications = await patientClinicalProfileService.getMedications(
        req.params.patientId,
        req.query.includeInactive === 'true'
      );
      
      res.json({
        success: true,
        medications
      });
    } catch (error) {
      logger.error('Get medications error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get medications'
      });
    }
  }
);

/**
 * DELETE /api/clinical-encounters/medications/:id
 * Discontinue a medication
 */
router.delete('/medications/:id',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('update', 'patient_medication', { description: 'Discontinue medication' }),
  async (req, res) => {
    try {
      const { reason } = req.body;
      
      const medication = await patientClinicalProfileService.discontinueMedication(
        req.params.id,
        req.user.id,
        reason || 'Discontinued by provider'
      );
      
      res.json({
        success: true,
        medication
      });
    } catch (error) {
      logger.error('Discontinue medication error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to discontinue medication'
      });
    }
  }
);

// ============================================================================
// PRESCRIPTION INTENTS (eRx Integration)
// ============================================================================

/**
 * GET /api/clinical-encounters/prescription-intents
 * List prescription intents (patient sees theirs; provider sees theirs; admins forbidden by default)
 */
router.get('/prescription-intents',
  authenticate,
  async (req, res) => {
    try {
      const { status, limit, offset } = req.query;
      const parsed = {
        status: status || undefined,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0
      };

      if (req.user.role === 'provider') {
        const intents = await eRxIntegrationService.getProviderPrescriptionIntents(req.user.id, parsed);
        return res.json({ success: true, prescriptionIntents: intents });
      }

      if (req.user.role === 'patient') {
        const intents = await eRxIntegrationService.getPatientPrescriptionIntents(req.user.id, parsed);
        return res.json({ success: true, prescriptionIntents: intents });
      }

      return res.status(403).json({ success: false, error: 'Access denied' });
    } catch (error) {
      logger.error('List prescription intents error:', error);
      return res.status(500).json({ success: false, error: 'Failed to list prescription intents' });
    }
  }
);

/**
 * POST /api/clinical-encounters/prescription-intents
 * Create a prescription intent
 */
router.post('/prescription-intents',
  authenticate,
  requireRole('provider'),
  auditMiddleware('create', 'prescription_intent', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(prescriptionIntentSchema, req.body);
      
      // Check if controlled substance
      if (data.isControlled) {
        const canPrescribe = await eRxIntegrationService.canPrescribeControlled(req.user.id);
        if (!canPrescribe) {
          return res.status(403).json({
            success: false,
            error: 'Valid DEA registration required for controlled substances'
          });
        }
      }
      
      const intent = await eRxIntegrationService.createPrescriptionIntent(data, req.user.id);
      
      res.status(201).json({
        success: true,
        prescriptionIntent: intent
      });
    } catch (error) {
      logger.error('Create prescription intent error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create prescription intent'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/:encounterId/prescription-intents
 * Get prescription intents for an encounter
 */
router.get('/:encounterId/prescription-intents',
  authenticate,
  auditPhiAccess('prescription_intent'),
  async (req, res) => {
    try {
      const intents = await eRxIntegrationService.getEncounterPrescriptionIntents(
        req.params.encounterId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        prescriptionIntents: intents
      });
    } catch (error) {
      logger.error('Get prescription intents error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prescription intents'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/prescription-intents/:id/handoff
 * Initiate handoff to external e-prescribing
 */
router.post('/prescription-intents/:id/handoff',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'prescription_intent', { description: 'eRx handoff initiated' }),
  async (req, res) => {
    try {
      const { eRxSystem } = req.body;
      
      const handoff = await eRxIntegrationService.initiateERxHandoff(
        req.params.id,
        req.user.id,
        eRxSystem
      );
      
      res.json({
        success: true,
        handoff
      });
    } catch (error) {
      logger.error('eRx handoff error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initiate eRx handoff'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/prescription-intents/:id/cancel
 * Cancel a prescription intent
 */
router.post('/prescription-intents/:id/cancel',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'prescription_intent', { description: 'Cancelled' }),
  async (req, res) => {
    try {
      const { reason } = req.body;
      
      const intent = await eRxIntegrationService.cancelPrescriptionIntent(
        req.params.id,
        req.user.id,
        reason
      );
      
      res.json({
        success: true,
        prescriptionIntent: intent
      });
    } catch (error) {
      logger.error('Cancel prescription intent error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to cancel prescription intent'
      });
    }
  }
);

// ============================================================================
// TELEHEALTH CONSENT
// ============================================================================

/**
 * GET /api/clinical-encounters/consent/template
 * Get active consent template for a state
 */
router.get('/consent/template',
  authenticate,
  async (req, res) => {
    try {
      const { state } = req.query;
      
      if (!state) {
        return res.status(400).json({
          success: false,
          error: 'State is required'
        });
      }
      
      const template = await telehealthConsentService.getActiveTemplateForState(state);
      
      res.json({
        success: true,
        template
      });
    } catch (error) {
      logger.error('Get consent template error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get consent template'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/consent
 * Capture telehealth consent
 */
router.post('/consent',
  authenticate,
  auditMiddleware('create', 'telehealth_consent'),
  async (req, res) => {
    try {
      const data = validate(captureConsentSchema, req.body);
      
      // Patient can only capture their own consent
      const patientId = req.user.role === 'patient' ? req.user.id : req.body.patientId;
      
      if (!patientId) {
        return res.status(400).json({
          success: false,
          error: 'Patient ID is required'
        });
      }
      
      const consent = await telehealthConsentService.captureConsent(patientId, data, req);
      
      res.status(201).json({
        success: true,
        message: 'Telehealth consent captured',
        consent
      });
    } catch (error) {
      logger.error('Capture consent error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to capture consent'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/consent/check
 * Check if patient has valid consent
 */
router.get('/consent/check',
  authenticate,
  async (req, res) => {
    try {
      const { patientId, state } = req.query;
      const checkPatientId = patientId || (req.user.role === 'patient' ? req.user.id : null);
      
      if (!checkPatientId || !state) {
        return res.status(400).json({
          success: false,
          error: 'Patient ID and state are required'
        });
      }
      
      const hasConsent = await telehealthConsentService.hasValidConsent(checkPatientId, state);
      
      res.json({
        success: true,
        hasValidConsent: hasConsent,
        state
      });
    } catch (error) {
      logger.error('Check consent error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check consent'
      });
    }
  }
);

/**
 * GET /api/clinical-encounters/patient/:patientId/consents
 * Get patient's consent history
 */
router.get('/patient/:patientId/consents',
  authenticate,
  canAccessPatient,
  async (req, res) => {
    try {
      const consents = await telehealthConsentService.getPatientConsents(req.params.patientId);
      
      res.json({
        success: true,
        consents
      });
    } catch (error) {
      logger.error('Get consents error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get consents'
      });
    }
  }
);

/**
 * POST /api/clinical-encounters/consent/:id/revoke
 * Revoke a consent
 */
router.post('/consent/:id/revoke',
  authenticate,
  auditMiddleware('update', 'telehealth_consent', { description: 'Revoked' }),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const patientId = req.user.role === 'patient' ? req.user.id : req.body.patientId;
      
      if (!patientId) {
        return res.status(400).json({
          success: false,
          error: 'Patient ID is required'
        });
      }
      
      const consent = await telehealthConsentService.revokeConsent(
        req.params.id,
        patientId,
        reason || 'Revoked by patient'
      );
      
      res.json({
        success: true,
        consent
      });
    } catch (error) {
      logger.error('Revoke consent error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to revoke consent'
      });
    }
  }
);

module.exports = router;
