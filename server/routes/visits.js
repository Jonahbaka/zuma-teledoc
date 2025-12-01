/**
 * Visit Routes
 * SOAP notes and clinical documentation
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole, canAccessPatient } = require('../middleware/auth');
const { auditMiddleware, auditPhiAccess } = require('../middleware/audit');
const { encrypt, decrypt, encryptFields, decryptFields } = require('../../lib/encryption');
const { validate, createVisitSchema, signVisitSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');

const router = express.Router();

/**
 * POST /api/visits
 * Create a new visit/SOAP note
 */
router.post('/',
  authenticate,
  requireRole('provider'),
  auditMiddleware('create', 'visit', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(createVisitSchema, req.body);
      
      // Verify appointment exists and belongs to this provider
      const { rows: appointments } = await db.query(
        `SELECT id, patient_id, provider_id, status FROM appointments WHERE id = $1`,
        [data.appointmentId]
      );
      
      if (appointments.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      
      const appointment = appointments[0];
      
      if (appointment.provider_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      // Check if visit already exists
      const { rows: existing } = await db.query(
        'SELECT id FROM visits WHERE appointment_id = $1',
        [data.appointmentId]
      );
      
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Visit record already exists for this appointment'
        });
      }
      
      // Encrypt SOAP fields
      const subjective = data.subjective ? encrypt(data.subjective) : { encrypted: null, iv: null, tag: null };
      const objective = data.objective ? encrypt(data.objective) : { encrypted: null, iv: null, tag: null };
      const assessment = data.assessment ? encrypt(data.assessment) : { encrypted: null, iv: null, tag: null };
      const plan = data.plan ? encrypt(data.plan) : { encrypted: null, iv: null, tag: null };
      const vitals = data.vitals ? encrypt(JSON.stringify(data.vitals)) : { encrypted: null, iv: null, tag: null };
      
      const { rows } = await db.query(
        `INSERT INTO visits (
          appointment_id, patient_id, provider_id,
          subjective_encrypted, subjective_iv, subjective_tag,
          objective_encrypted, objective_iv, objective_tag,
          assessment_encrypted, assessment_iv, assessment_tag,
          plan_encrypted, plan_iv, plan_tag,
          vitals_encrypted, vitals_iv, vitals_tag,
          icd_codes, cpt_codes,
          follow_up_required, follow_up_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING id, appointment_id, patient_id, provider_id, 
                  icd_codes, cpt_codes, is_signed, follow_up_required, created_at`,
        [
          data.appointmentId,
          appointment.patient_id,
          req.user.id,
          subjective.encrypted, subjective.iv, subjective.tag,
          objective.encrypted, objective.iv, objective.tag,
          assessment.encrypted, assessment.iv, assessment.tag,
          plan.encrypted, plan.iv, plan.tag,
          vitals.encrypted, vitals.iv, vitals.tag,
          data.icdCodes || [],
          data.cptCodes || [],
          data.followUpRequired,
          data.followUpNotes
        ]
      );
      
      // Update appointment status
      await db.query(
        `UPDATE appointments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [data.appointmentId]
      );
      
      res.locals.patientId = appointment.patient_id;
      
      logger.info('Visit created', { 
        visitId: rows[0].id, 
        appointmentId: data.appointmentId,
        providerId: req.user.id 
      });
      
      res.status(201).json({
        success: true,
        message: 'Visit record created successfully',
        visit: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      
      logger.error('Create visit error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to create visit'
      });
    }
  }
);

/**
 * GET /api/visits/:id
 * Get visit details with decrypted content
 */
router.get('/:id',
  authenticate,
  auditPhiAccess('visit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const { rows } = await db.query(
        `SELECT v.*,
                a.scheduled_at, a.type as appointment_type, a.reason_for_visit,
                p.first_name as patient_first_name, p.last_name as patient_last_name,
                p.date_of_birth as patient_dob,
                pr.first_name as provider_first_name, pr.last_name as provider_last_name,
                pr.credentials as provider_credentials
         FROM visits v
         JOIN appointments a ON a.id = v.appointment_id
         JOIN users p ON p.id = v.patient_id
         JOIN users pr ON pr.id = v.provider_id
         WHERE v.id = $1`,
        [id]
      );
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Visit not found'
        });
      }
      
      const visit = rows[0];
      
      // Check access
      if (req.user.role === 'patient' && visit.patient_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      if (req.user.role === 'provider' && visit.provider_id !== req.user.id) {
        // Check if provider has relationship with patient
        const { rows: relationship } = await db.query(
          `SELECT 1 FROM appointments 
           WHERE provider_id = $1 AND patient_id = $2 LIMIT 1`,
          [req.user.id, visit.patient_id]
        );
        
        if (relationship.length === 0) {
          return res.status(403).json({
            success: false,
            error: 'Access denied'
          });
        }
      }
      
      // Decrypt SOAP content
      const decrypted = {
        id: visit.id,
        appointmentId: visit.appointment_id,
        patientId: visit.patient_id,
        providerId: visit.provider_id,
        patient: {
          firstName: visit.patient_first_name,
          lastName: visit.patient_last_name,
          dateOfBirth: visit.patient_dob
        },
        provider: {
          firstName: visit.provider_first_name,
          lastName: visit.provider_last_name,
          credentials: visit.provider_credentials
        },
        appointment: {
          scheduledAt: visit.scheduled_at,
          type: visit.appointment_type,
          reasonForVisit: visit.reason_for_visit
        },
        subjective: decrypt(visit.subjective_encrypted, visit.subjective_iv, visit.subjective_tag),
        objective: decrypt(visit.objective_encrypted, visit.objective_iv, visit.objective_tag),
        assessment: decrypt(visit.assessment_encrypted, visit.assessment_iv, visit.assessment_tag),
        plan: decrypt(visit.plan_encrypted, visit.plan_iv, visit.plan_tag),
        vitals: visit.vitals_encrypted 
          ? JSON.parse(decrypt(visit.vitals_encrypted, visit.vitals_iv, visit.vitals_tag))
          : null,
        icdCodes: visit.icd_codes,
        cptCodes: visit.cpt_codes,
        isSigned: visit.is_signed,
        signedAt: visit.signed_at,
        isLocked: visit.is_locked,
        followUpRequired: visit.follow_up_required,
        followUpNotes: visit.follow_up_notes,
        createdAt: visit.created_at,
        updatedAt: visit.updated_at
      };
      
      res.locals.patientId = visit.patient_id;
      
      res.json({
        success: true,
        visit: decrypted
      });
    } catch (error) {
      logger.error('Get visit error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get visit'
      });
    }
  }
);

/**
 * PUT /api/visits/:id
 * Update visit (only if not signed)
 */
router.put('/:id',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'visit', { phiAccessed: true, logChanges: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get current visit
      const { rows: current } = await db.query(
        'SELECT * FROM visits WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Visit not found'
        });
      }
      
      const visit = current[0];
      
      // Check access
      if (visit.provider_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Only the creating provider can update this visit'
        });
      }
      
      // Check if signed/locked
      if (visit.is_signed || visit.is_locked) {
        return res.status(400).json({
          success: false,
          error: 'Signed visits cannot be modified'
        });
      }
      
      const { subjective, objective, assessment, plan, vitals, icdCodes, cptCodes, followUpRequired, followUpNotes } = req.body;
      
      // Build update
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (subjective !== undefined) {
        const enc = encrypt(subjective);
        updates.push(`subjective_encrypted = $${paramIndex}`);
        values.push(enc.encrypted);
        paramIndex++;
        updates.push(`subjective_iv = $${paramIndex}`);
        values.push(enc.iv);
        paramIndex++;
        updates.push(`subjective_tag = $${paramIndex}`);
        values.push(enc.tag);
        paramIndex++;
      }
      
      if (objective !== undefined) {
        const enc = encrypt(objective);
        updates.push(`objective_encrypted = $${paramIndex}`);
        values.push(enc.encrypted);
        paramIndex++;
        updates.push(`objective_iv = $${paramIndex}`);
        values.push(enc.iv);
        paramIndex++;
        updates.push(`objective_tag = $${paramIndex}`);
        values.push(enc.tag);
        paramIndex++;
      }
      
      if (assessment !== undefined) {
        const enc = encrypt(assessment);
        updates.push(`assessment_encrypted = $${paramIndex}`);
        values.push(enc.encrypted);
        paramIndex++;
        updates.push(`assessment_iv = $${paramIndex}`);
        values.push(enc.iv);
        paramIndex++;
        updates.push(`assessment_tag = $${paramIndex}`);
        values.push(enc.tag);
        paramIndex++;
      }
      
      if (plan !== undefined) {
        const enc = encrypt(plan);
        updates.push(`plan_encrypted = $${paramIndex}`);
        values.push(enc.encrypted);
        paramIndex++;
        updates.push(`plan_iv = $${paramIndex}`);
        values.push(enc.iv);
        paramIndex++;
        updates.push(`plan_tag = $${paramIndex}`);
        values.push(enc.tag);
        paramIndex++;
      }
      
      if (vitals !== undefined) {
        const enc = encrypt(JSON.stringify(vitals));
        updates.push(`vitals_encrypted = $${paramIndex}`);
        values.push(enc.encrypted);
        paramIndex++;
        updates.push(`vitals_iv = $${paramIndex}`);
        values.push(enc.iv);
        paramIndex++;
        updates.push(`vitals_tag = $${paramIndex}`);
        values.push(enc.tag);
        paramIndex++;
      }
      
      if (icdCodes !== undefined) {
        updates.push(`icd_codes = $${paramIndex}`);
        values.push(icdCodes);
        paramIndex++;
      }
      
      if (cptCodes !== undefined) {
        updates.push(`cpt_codes = $${paramIndex}`);
        values.push(cptCodes);
        paramIndex++;
      }
      
      if (followUpRequired !== undefined) {
        updates.push(`follow_up_required = $${paramIndex}`);
        values.push(followUpRequired);
        paramIndex++;
      }
      
      if (followUpNotes !== undefined) {
        updates.push(`follow_up_notes = $${paramIndex}`);
        values.push(followUpNotes);
        paramIndex++;
      }
      
      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }
      
      values.push(id);
      
      const { rows } = await db.query(
        `UPDATE visits SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, appointment_id, icd_codes, cpt_codes, 
                   is_signed, follow_up_required, updated_at`,
        values
      );
      
      res.locals.patientId = visit.patient_id;
      
      logger.info('Visit updated', { visitId: id, providerId: req.user.id });
      
      res.json({
        success: true,
        message: 'Visit updated successfully',
        visit: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Update visit error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update visit'
      });
    }
  }
);

/**
 * POST /api/visits/:id/sign
 * Sign and lock the visit
 */
router.post('/:id/sign',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'visit', { description: 'Sign visit' }),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get visit
      const { rows: current } = await db.query(
        'SELECT * FROM visits WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Visit not found'
        });
      }
      
      const visit = current[0];
      
      // Check access
      if (visit.provider_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Only the creating provider can sign this visit'
        });
      }
      
      if (visit.is_signed) {
        return res.status(400).json({
          success: false,
          error: 'Visit is already signed'
        });
      }
      
      // Sign the visit
      const { rows } = await db.query(
        `UPDATE visits SET 
          is_signed = true, 
          signed_at = NOW(),
          is_locked = true,
          updated_at = NOW()
         WHERE id = $1
         RETURNING id, is_signed, signed_at, is_locked`,
        [id]
      );
      
      res.locals.patientId = visit.patient_id;
      
      logger.info('Visit signed', { visitId: id, providerId: req.user.id });
      
      res.json({
        success: true,
        message: 'Visit signed and locked',
        visit: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Sign visit error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to sign visit'
      });
    }
  }
);

/**
 * GET /api/visits/patient/:patientId
 * Get all visits for a patient
 */
router.get('/patient/:patientId',
  authenticate,
  canAccessPatient,
  auditPhiAccess('visit'),
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const filters = validate(paginationSchema, req.query);
      const { page, limit } = parseQueryParams(filters);
      const offset = (page - 1) * limit;
      
      // Get total count
      const { rows: countResult } = await db.query(
        'SELECT COUNT(*) FROM visits WHERE patient_id = $1',
        [patientId]
      );
      const total = parseInt(countResult[0].count);
      
      // Get visits (summary only, not decrypted)
      const { rows } = await db.query(
        `SELECT v.id, v.appointment_id, v.patient_id, v.provider_id,
                v.icd_codes, v.cpt_codes, v.is_signed, v.signed_at,
                v.follow_up_required, v.created_at,
                a.scheduled_at, a.type as appointment_type,
                pr.first_name as provider_first_name,
                pr.last_name as provider_last_name,
                pr.credentials as provider_credentials
         FROM visits v
         JOIN appointments a ON a.id = v.appointment_id
         JOIN users pr ON pr.id = v.provider_id
         WHERE v.patient_id = $1
         ORDER BY v.created_at DESC
         LIMIT $2 OFFSET $3`,
        [patientId, limit, offset]
      );
      
      res.locals.patientId = patientId;
      
      res.json({
        success: true,
        visits: rows.map(keysToCamel),
        pagination: getPaginationMeta(total, page, limit)
      });
    } catch (error) {
      logger.error('Get patient visits error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get visits'
      });
    }
  }
);

/**
 * GET /api/visits/appointment/:appointmentId
 * Get visit by appointment ID
 */
router.get('/appointment/:appointmentId',
  authenticate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;
      
      const { rows } = await db.query(
        `SELECT v.*, 
                p.first_name as patient_first_name,
                p.last_name as patient_last_name
         FROM visits v
         JOIN users p ON p.id = v.patient_id
         WHERE v.appointment_id = $1
         LIMIT 1`,
        [appointmentId]
      );
      
      if (rows.length === 0) {
        return res.json({
          success: true,
          visit: null
        });
      }
      
      // Check access
      const visit = rows[0];
      if (req.user.role === 'patient' && visit.patient_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized'
        });
      }
      if (req.user.role === 'provider' && visit.provider_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized'
        });
      }
      
      res.json({
        success: true,
        visit: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Get visit by appointment error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get visit'
      });
    }
  }
);

/**
 * GET /api/visits/provider/recent
 * Get provider's recent visits
 */
router.get('/provider/recent',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      
      const { rows } = await db.query(
        `SELECT v.id, v.appointment_id, v.patient_id,
                v.icd_codes, v.is_signed, v.created_at,
                p.first_name as patient_first_name,
                p.last_name as patient_last_name,
                a.scheduled_at, a.reason_for_visit
         FROM visits v
         JOIN users p ON p.id = v.patient_id
         JOIN appointments a ON a.id = v.appointment_id
         WHERE v.provider_id = $1
         ORDER BY v.created_at DESC
         LIMIT $2`,
        [req.user.id, limit]
      );
      
      res.json({
        success: true,
        visits: rows.map(keysToCamel)
      });
    } catch (error) {
      logger.error('Get recent visits error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get recent visits'
      });
    }
  }
);

module.exports = router;

