/**
 * Enhanced Triage API Routes
 * Triage queue management, AI analysis, and priority routing
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const triageQueueService = require('../services/triageQueueService');
const aiTriageEngine = require('../services/aiTriageEngine');
const logger = require('../middleware/logger');
const { z } = require('zod');
const { validate } = require('../../lib/validation');

// Validation schemas
const createTriageSessionSchema = z.object({
  chiefComplaint: z.string().min(1).max(500),
  symptoms: z.string().min(1).max(2000),
  symptomDuration: z.string().max(100).optional(),
  symptomOnset: z.string().datetime().optional(),
  symptomSeverity: z.number().int().min(1).max(10).optional(),
  appointmentId: z.string().uuid().optional(),
  vitals: z.object({
    temperature: z.number().optional(),
    heartRate: z.number().int().optional(),
    systolic: z.number().int().optional(),
    diastolic: z.number().int().optional(),
    respiratoryRate: z.number().int().optional(),
    oxygenSaturation: z.number().optional(),
    painLevel: z.number().int().min(0).max(10).optional()
  }).optional()
});

/**
 * POST /api/triage-queue/session
 * Create new triage session and add to queue
 */
router.post('/session',
  authenticate,
  requireRole(['patient']),
  auditMiddleware('create', 'triage_session'),
  async (req, res) => {
    try {
      const data = validate(createTriageSessionSchema, req.body);
      
      const result = await triageQueueService.createTriageSession(req.user.id, data);
      
      logger.info('Triage session created', {
        sessionId: result.session.id,
        patientId: req.user.id,
        triageLevel: result.aiAnalysis.triageLevel,
        severity: result.aiAnalysis.severity,
        isEmergency: result.aiAnalysis.isEmergency
      });
      
      res.status(201).json({
        success: true,
        session: result.session,
        queueEntry: result.queueEntry,
        analysis: {
          severity: result.aiAnalysis.severity,
          triageLevel: result.aiAnalysis.triageLevel,
          suggestedSpecialty: result.aiAnalysis.suggestedSpecialty,
          isEmergency: result.aiAnalysis.isEmergency,
          emergencyFlags: result.aiAnalysis.emergencyFlags,
          clinicalFlags: result.aiAnalysis.clinicalFlags,
          suggestedMedications: result.aiAnalysis.suggestedMedications,
          differentialDiagnosis: result.aiAnalysis.differentialDiagnosis,
          recommendedTests: result.aiAnalysis.recommendedTests,
          soapDraft: result.aiAnalysis.soapDraft,
          priorityScore: result.aiAnalysis.priorityScore,
          estimatedWaitMinutes: result.queueEntry.estimatedWaitMinutes
        }
      });
    } catch (error) {
      logger.error('Create triage session error:', error);
      res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Failed to create triage session'
      });
    }
  }
);

/**
 * POST /api/triage-queue/analyze
 * Run AI triage analysis without creating session (preview)
 */
router.post('/analyze',
  authenticate,
  async (req, res) => {
    try {
      const { symptoms, chiefComplaint, vitals } = req.body;
      
      if (!symptoms && !chiefComplaint) {
        return res.status(400).json({
          success: false,
          error: 'Symptoms or chief complaint required'
        });
      }
      
      const analysis = await aiTriageEngine.runTriage(
        `${chiefComplaint || ''}. ${symptoms || ''}`.trim(),
        vitals
      );
      
      res.json({
        success: true,
        analysis: {
          severity: analysis.severity,
          triageLevel: analysis.triageLevel,
          suggestedSpecialty: analysis.suggestedSpecialty,
          isEmergency: analysis.isEmergency,
          emergencyFlags: analysis.emergencyFlags,
          clinicalFlags: analysis.clinicalFlags,
          affectedBodySystems: analysis.affectedBodySystems,
          suggestedMedications: analysis.suggestedMedications,
          differentialDiagnosis: analysis.differentialDiagnosis,
          recommendedTests: analysis.recommendedTests,
          confidenceScore: analysis.confidenceScore,
          requiresImmediateAttention: analysis.requiresImmediateAttention
        }
      });
    } catch (error) {
      logger.error('Triage analysis error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to analyze symptoms'
      });
    }
  }
);

/**
 * GET /api/triage-queue
 * Get triage queue (for providers)
 */
router.get('/',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  async (req, res) => {
    try {
      const { status, specialty, limit, showAll } = req.query;
      
      const queue = await triageQueueService.getTriageQueue(req.user.id, {
        status: status || 'waiting',
        specialty,
        limit: parseInt(limit) || 50,
        showAll: showAll === 'true'
      });
      
      res.json({
        success: true,
        queue
      });
    } catch (error) {
      logger.error('Get triage queue error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get triage queue'
      });
    }
  }
);

/**
 * GET /api/triage-queue/stats
 * Get queue statistics
 */
router.get('/stats',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  async (req, res) => {
    try {
      const stats = await triageQueueService.getQueueStats(req.user.id);
      
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error('Get queue stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get queue statistics'
      });
    }
  }
);

/**
 * GET /api/triage-queue/session/:id
 * Get triage session by ID
 */
router.get('/session/:id',
  authenticate,
  auditMiddleware('read', 'triage_session'),
  async (req, res) => {
    try {
      const session = await triageQueueService.getTriageSession(
        req.params.id,
        req.user.id,
        req.user.role
      );
      
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Triage session not found'
        });
      }
      
      res.json({
        success: true,
        session
      });
    } catch (error) {
      logger.error('Get triage session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get triage session'
      });
    }
  }
);

/**
 * GET /api/triage-queue/history
 * Get patient's triage history
 */
router.get('/history',
  authenticate,
  async (req, res) => {
    try {
      const { limit } = req.query;
      
      // Patients see their own history, providers/admins can query specific patient
      const patientId = ['provider', 'admin', 'super_admin'].includes(req.user.role)
        ? req.query.patientId || req.user.id
        : req.user.id;
      
      const history = await triageQueueService.getPatientTriageHistory(
        patientId,
        parseInt(limit) || 20
      );
      
      res.json({
        success: true,
        history
      });
    } catch (error) {
      logger.error('Get triage history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get triage history'
      });
    }
  }
);

/**
 * POST /api/triage-queue/:id/claim
 * Claim a triage case
 */
router.post('/:id/claim',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'triage_queue'),
  async (req, res) => {
    try {
      const queueEntry = await triageQueueService.claimTriageCase(
        req.params.id,
        req.user.id
      );
      
      logger.info('Triage case claimed', {
        queueId: req.params.id,
        providerId: req.user.id
      });
      
      res.json({
        success: true,
        queueEntry
      });
    } catch (error) {
      logger.error('Claim triage case error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to claim triage case'
      });
    }
  }
);

/**
 * POST /api/triage-queue/:id/start
 * Start consultation for triage case
 */
router.post('/:id/start',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'triage_queue'),
  async (req, res) => {
    try {
      const queueEntry = await triageQueueService.startConsultation(
        req.params.id,
        req.user.id
      );
      
      logger.info('Triage consultation started', {
        queueId: req.params.id,
        providerId: req.user.id
      });
      
      res.json({
        success: true,
        queueEntry
      });
    } catch (error) {
      logger.error('Start consultation error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to start consultation'
      });
    }
  }
);

/**
 * POST /api/triage-queue/:id/complete
 * Complete triage consultation
 */
router.post('/:id/complete',
  authenticate,
  requireRole(['provider', 'admin', 'super_admin']),
  auditMiddleware('update', 'triage_queue'),
  async (req, res) => {
    try {
      const { disposition, notes } = req.body;
      
      if (!disposition) {
        return res.status(400).json({
          success: false,
          error: 'Disposition is required'
        });
      }
      
      const queueEntry = await triageQueueService.completeConsultation(
        req.params.id,
        req.user.id,
        disposition,
        notes
      );
      
      logger.info('Triage consultation completed', {
        queueId: req.params.id,
        providerId: req.user.id,
        disposition
      });
      
      res.json({
        success: true,
        queueEntry
      });
    } catch (error) {
      logger.error('Complete consultation error:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to complete consultation'
      });
    }
  }
);

/**
 * GET /api/triage-queue/levels
 * Get triage level definitions
 */
router.get('/levels',
  authenticate,
  async (req, res) => {
    try {
      const levels = aiTriageEngine.getAllTriageLevels();
      const bodySystems = aiTriageEngine.getBodySystems();
      
      res.json({
        success: true,
        levels,
        bodySystems
      });
    } catch (error) {
      logger.error('Get triage levels error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get triage levels'
      });
    }
  }
);

module.exports = router;

