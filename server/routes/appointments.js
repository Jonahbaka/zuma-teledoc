/**
 * Appointment Routes
 * Scheduling, management, and history
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePaidAccess } = require('../middleware/accessControl');
const { auditMiddleware } = require('../middleware/audit');
const {
  validate,
  createAppointmentSchema,
  updateAppointmentSchema,
  searchAppointmentsSchema
} = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta, generateRoomId } = require('../../lib/utils');
const notificationService = require('../services/notifications');
const { getUserTestingAccess } = require('../services/testingAccessService');
const {
  ensureAppointmentRoomId,
  getAuthorizedVideoAppointment,
  getTelehealthIceServers
} = require('../services/telehealthSessionService');

const router = express.Router();
const SAME_MINUTE_BUFFER_MS = 5 * 60 * 1000;
const PROVIDER_UPCOMING_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const MAX_UPCOMING_LIMIT = 50;

/**
 * POST /api/appointments
 * Create new appointment
 */
router.post('/',
  authenticate,
  requirePaidAccess,
  auditMiddleware('create', 'appointment'),
  async (req, res) => {
    try {
      const data = validate(createAppointmentSchema, req.body);
      
      // Verify provider exists and is approved
      const { rows: providers } = await db.query(
        `SELECT id, first_name, last_name FROM users 
         WHERE id = $1 AND role = 'provider' AND provider_status = 'approved' AND is_active = true`,
        [data.providerId]
      );
      
      if (providers.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Provider not found or not available'
        });
      }
      
      // Check for scheduling conflicts
      const scheduledAt = new Date(data.scheduledAt);
      const endTime = new Date(scheduledAt.getTime() + data.durationMinutes * 60000);
      
      const { rows: conflicts } = await db.query(
        `SELECT id FROM appointments 
         WHERE provider_id = $1 
         AND status NOT IN ('cancelled', 'completed', 'no_show')
         AND (
           (scheduled_at <= $2 AND scheduled_at + (duration_minutes || ' minutes')::interval > $2)
           OR (scheduled_at < $3 AND scheduled_at + (duration_minutes || ' minutes')::interval >= $3)
           OR (scheduled_at >= $2 AND scheduled_at + (duration_minutes || ' minutes')::interval <= $3)
         )`,
        [data.providerId, scheduledAt, endTime]
      );
      
      if (conflicts.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Time slot is not available'
        });
      }
      
      // Generate room ID for video call
      const roomId = data.type === 'video' ? generateRoomId() : null;
      
      // Create appointment
      const patientId = req.user.role === 'patient' ? req.user.id : req.body.patientId;
      const patientTestingAccess =
        req.user.role === 'patient' && patientId === req.user.id
          ? {
              testingBypassActive: Boolean(req.user.testingBypassActive)
            }
          : await getUserTestingAccess(patientId);
      const paymentRequired = !patientTestingAccess.testingBypassActive;
      const paymentCompleted = Boolean(patientTestingAccess.testingBypassActive);
      
      const { rows } = await db.query(
        `INSERT INTO appointments (
          patient_id, provider_id, scheduled_at, duration_minutes,
          type, reason_for_visit, patient_notes, room_id,
          payment_required, payment_completed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          patientId,
          data.providerId,
          scheduledAt,
          data.durationMinutes,
          data.type,
          data.reasonForVisit,
          data.patientNotes,
          roomId,
          paymentRequired,
          paymentCompleted
        ]
      );
      
      // Get patient and provider details for notifications
      const { rows: patientRows } = await db.query(
        'SELECT id, email, first_name, last_name, role FROM users WHERE id = $1',
        [patientId]
      );
      
      // Prepare appointment data with names
      const appointmentData = {
        ...keysToCamel(rows[0]),
        providerFirstName: providers[0]?.first_name,
        providerLastName: providers[0]?.last_name,
        patientFirstName: patientRows[0]?.first_name,
        patientLastName: patientRows[0]?.last_name
      };
      
      // Create in-app notifications for both provider and patient
      try {
        // Notify provider
        await notificationService.sendAppointmentNotification(
          appointmentData,
          data.providerId,
          'provider',
          'created'
        );
        
        // Notify patient (if different from current user or explicit)
        await notificationService.sendAppointmentNotification(
          appointmentData,
          patientId,
          'patient',
          'created'
        );
      } catch (notifyError) {
        logger.warn('Failed to create appointment notifications', { error: notifyError.message });
      }
      
      // Send email notifications
      try {
        const emailService = require('../services/email');
        
        // Get provider details for email
        const { rows: providerRows } = await db.query(
          'SELECT id, email, first_name, last_name, role FROM users WHERE id = $1',
          [data.providerId]
        );
        
        if (providerRows.length > 0) {
          await emailService.sendAppointmentNotification(
            appointmentData,
            keysToCamel(providerRows[0]),
            'created'
          );
        }
        
        if (patientRows.length > 0) {
          await emailService.sendAppointmentNotification(
            appointmentData,
            keysToCamel(patientRows[0]),
            'created'
          );
        }
      } catch (emailError) {
        logger.error('Failed to send appointment notification emails', { 
          error: emailError.message, 
          appointmentId: rows[0].id 
        });
        // Don't fail appointment creation if email fails
      }
      
      logger.info('Appointment created', { 
        appointmentId: rows[0].id, 
        patientId, 
        providerId: data.providerId 
      });
      
      res.status(201).json({
        success: true,
        message: 'Appointment scheduled successfully',
        appointment: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      
      logger.error('Create appointment error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to create appointment'
      });
    }
  }
);

/**
 * GET /api/appointments
 * Get appointments with filters
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filters = validate(searchAppointmentsSchema, req.query);
    const { page, limit, sortBy, sortOrder } = parseQueryParams(filters);
    
    // 1. BUILD QUERY ONCE
    // We build the WHERE clause and values array a single time to avoid index mismatch errors
    const whereConditions = [];
    const values = [];
    let paramIndex = 1;
    
    const userRole = String(req.user.role || '').toLowerCase().trim();
    const userId = req.user.id;
    
    // Role-based filtering
    if (userRole === 'patient') {
      // FIX: Use direct comparison. Postgres handles UUID type coercion automatically.
      // Removed ::text casting which causes case-sensitivity issues.
      whereConditions.push(`a.patient_id = $${paramIndex++}`);
      values.push(userId);
    } else if (userRole === 'provider') {
      whereConditions.push(`a.provider_id = $${paramIndex++}`);
      values.push(userId);

      if (filters.patientId) {
        whereConditions.push(`a.patient_id = $${paramIndex++}`);
        values.push(filters.patientId);
      }
    } else if (userRole === 'admin' || userRole === 'super_admin') {
      // Admins can see all, or filter by specific user if provided in query
      if (filters.patientId) {
        whereConditions.push(`a.patient_id = $${paramIndex++}`);
        values.push(filters.patientId);
      }
      if (filters.providerId) {
        whereConditions.push(`a.provider_id = $${paramIndex++}`);
        values.push(filters.providerId);
      }
    } else {
      // Unknown role - log warning but try to get appointments by patient_id as fallback
      logger.warn('Unknown user role in appointments query', {
        userId: req.user.id,
        role: req.user.role,
        roleNormalized: userRole
      });
      whereConditions.push(`a.patient_id = $${paramIndex++}`);
      values.push(userId);
    }
    
    // Status Filter
    if (filters.status) {
      whereConditions.push(`a.status = $${paramIndex++}`);
      values.push(filters.status);
    }
    
    // Date Range Filters
    if (filters.startDate) {
      whereConditions.push(`a.scheduled_at >= $${paramIndex++}`);
      values.push(new Date(filters.startDate));
    }
    if (filters.endDate) {
      whereConditions.push(`a.scheduled_at <= $${paramIndex++}`);
      values.push(new Date(filters.endDate));
    }
    
    // Construct the final WHERE string
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';
    
    // 2. GET COUNT (Reusing the exact same whereClause)
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM appointments a 
      ${whereClause}
    `;
    
    const { rows: countResult } = await db.query(countQuery, values);
    const total = parseInt(countResult[0]?.count || 0);
    
    // 3. GET DATA (Extending the values array for pagination)
    const offset = (page - 1) * limit;
    
    // FIX: Calculate parameter indices - limit and offset are the next two parameters
    const limitParamIndex = paramIndex;
    const offsetParamIndex = paramIndex + 1;
    const queryValues = [...values, limit, offset];
    
    const dataQuery = `
      SELECT a.*,
             p.first_name as patient_first_name, p.last_name as patient_last_name,
             pr.first_name as provider_first_name, pr.last_name as provider_last_name,
             pr.specialty as provider_specialty
      FROM appointments a
      LEFT JOIN users p ON p.id = a.patient_id
      LEFT JOIN users pr ON pr.id = a.provider_id
      ${whereClause}
      ORDER BY a.scheduled_at ${sortOrder}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `;
    
    const { rows } = await db.query(dataQuery, queryValues);
    
    // Enhance with triage data from metadata
    let appointments = rows.map(keysToCamel);
    
    appointments = appointments.map((apt) => {
      // Extract triage data from metadata if it exists
      if (apt.metadata && apt.metadata.triage) {
        apt.triageData = apt.metadata.triage;
      }
      return apt;
    });
    
    res.json({
      success: true,
      appointments,
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get appointments error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to get appointments'
    });
  }
});

/**
 * GET /api/appointments/upcoming
 * Get upcoming appointments
 */
router.get('/upcoming', authenticate, async (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_UPCOMING_LIMIT)
      : 5;
    const referenceTime = new Date();
    const whereConditions = [];
    const values = [referenceTime];
    let paramIndex = 2;

    const userRole = String(req.user.role || '').toLowerCase().trim();
    let orderByClause = 'ORDER BY a.scheduled_at ASC';

    if (!['patient', 'provider', 'admin', 'super_admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    if (userRole === 'provider') {
      const providerVisibilityStart = new Date(referenceTime.getTime() - PROVIDER_UPCOMING_LOOKBACK_MS);
      whereConditions.push(`a.scheduled_at >= $${paramIndex++}`);
      values.push(providerVisibilityStart);
      whereConditions.push(`a.status IN ('scheduled', 'confirmed', 'in_progress')`);
      whereConditions.push(`a.provider_id = $${paramIndex++}`);
      values.push(req.user.id);
      orderByClause = `
        ORDER BY
          CASE
            WHEN a.status = 'in_progress' THEN 0
            WHEN a.scheduled_at <= $1 THEN 1
            ELSE 2
          END,
          ABS(EXTRACT(EPOCH FROM (a.scheduled_at - $1))),
          a.scheduled_at ASC
      `;
    } else {
      whereConditions.push(`a.scheduled_at > $1`);
      whereConditions.push(`a.status IN ('scheduled', 'confirmed')`);

      if (userRole === 'patient') {
        whereConditions.push(`a.patient_id = $${paramIndex++}`);
        values.push(req.user.id);
      }
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    values.push(limit);
    
    const { rows } = await db.query(
      `SELECT a.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.specialty as provider_specialty
       FROM appointments a
       LEFT JOIN users p ON p.id = a.patient_id
       LEFT JOIN users pr ON pr.id = a.provider_id
       ${whereClause}
       ${orderByClause}
       LIMIT $${paramIndex}`,
      values
    );
    
    res.json({
      success: true,
      appointments: rows.map(keysToCamel)
    });
  } catch (error) {
    logger.error('Get upcoming appointments error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to get upcoming appointments'
    });
  }
});

/**
 * POST /api/appointments/smart-book
 * Smart booking - auto-match provider based on category/symptoms
 * NOTE: This route MUST come BEFORE /:id routes
 */
router.post('/smart-book',
  authenticate,
  auditMiddleware('create', 'appointment'),
  async (req, res) => {
    try {
      const {
        category,
        specialties,
        providerId: requestedProviderId,
        scheduledAt,
        type,
        reasonForVisit,
        patientNotes,
        durationMinutes = 30,
        triageResult
      } = req.body;
      
      // Validate required fields
      if (!scheduledAt) {
        return res.status(400).json({
          success: false,
          error: 'Appointment date and time are required'
        });
      }
      
      // FIX: Use ID directly. If it is a UUID, the DB driver handles it.
      // If you explicitly stringify it and the DB expects UUID, it usually works, 
      // but avoiding manual type coercion reduces edge cases.
      const patientId = req.user.id;
      
      // Verify patient ID is valid
      if (!patientId) {
        return res.status(400).json({
          success: false,
          error: 'Patient ID is required'
        });
      }

      const patientTestingAccess = await getUserTestingAccess(patientId);
      const paymentRequired = !patientTestingAccess.testingBypassActive;
      const paymentCompleted = Boolean(patientTestingAccess.testingBypassActive);
      
      const scheduledDate = new Date(scheduledAt);
      
      // Validate date is valid
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date or time format'
        });
      }
      
      // Allow same-minute bookings with a short tolerance for client/server clock drift.
      if (scheduledDate.getTime() < Date.now() - SAME_MINUTE_BUFFER_MS) {
        return res.status(400).json({
          success: false,
          error: 'Appointment must be scheduled for now or a future date and time'
        });
      }
      
      // Validate required fields
      if (!category || !reasonForVisit) {
        return res.status(400).json({
          success: false,
          error: 'Category and reason for visit are required'
        });
      }
      
      // Find available provider matching specialties
      let providerId = requestedProviderId || null;
      let provider = null;

      if (providerId) {
        const { rows: requestedProviders } = await db.query(
          `SELECT id, first_name, last_name, specialty, credentials
           FROM users
           WHERE id = $1
           AND role = 'provider'
           AND provider_status = 'approved'
           AND is_active = true
           LIMIT 1`,
          [providerId]
        );

        if (requestedProviders.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Selected provider is not available'
          });
        }

        provider = requestedProviders[0];
      }
      
      // Try to find a provider with matching specialty
      const specialtyList = Array.isArray(specialties)
        ? specialties
        : String(specialties || '')
            .split(',')
            .filter(Boolean);
      
      if (!providerId) {
        for (const specialty of specialtyList) {
          const { rows: providers } = await db.query(
            `SELECT id, first_name, last_name, specialty, credentials
             FROM users
             WHERE role = 'provider'
             AND provider_status = 'approved'
             AND is_active = true
             AND (specialty ILIKE $1 OR specialty ILIKE $2)
             ORDER BY RANDOM()
             LIMIT 1`,
            [`%${specialty.trim()}%`, `%${category}%`]
          );
          
          if (providers.length > 0) {
            providerId = providers[0].id;
            provider = providers[0];
            break;
          }
        }
      }
      
      // Fallback: get any available provider
      if (!providerId) {
        const { rows: anyProviders } = await db.query(
          `SELECT id, first_name, last_name, specialty, credentials
           FROM users
           WHERE role = 'provider'
           AND provider_status = 'approved'
           AND is_active = true
           ORDER BY RANDOM()
           LIMIT 1`
        );
        
        if (anyProviders.length > 0) {
          providerId = anyProviders[0].id;
          provider = anyProviders[0];
        }
      }
      
      if (!providerId) {
        return res.status(404).json({
          success: false,
          error: 'No available providers found. Please try again later.'
        });
      }
      
      // Generate room ID for video calls
      const roomId = type === 'video' ? generateRoomId() : null;
      
      // Prepare metadata with triage data if available
      let metadata = null;
      if (triageResult) {
        try {
          // Ensure metadata column exists
          await db.query(`
            ALTER TABLE appointments 
            ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
          `);
          
          // Build safe triage data
          const flagsJson = JSON.stringify(Array.isArray(triageResult.flags) ? triageResult.flags : []);
          const medsJson = JSON.stringify(Array.isArray(triageResult.suggestedMeds) ? triageResult.suggestedMeds : []);
          
          metadata = {
            triage: {
              severity: triageResult.severity || 0,
              soapDraft: triageResult.soapDraft || '',
              triageLevel: triageResult.triageLevel || (triageResult.severity >= 4 ? 'URGENT' : 'ROUTINE'),
              suggestedSpecialty: triageResult.suggestedSpecialty || 'Primary Care',
              flags: JSON.parse(flagsJson),
              suggestedMeds: JSON.parse(medsJson),
              symptoms: reasonForVisit || '',
              timestamp: new Date().toISOString()
            }
          };
        } catch (metadataError) {
          // If metadata creation fails, continue without it
          console.warn('Failed to create metadata:', metadataError);
        }
      }
      
      // Create the appointment
      const insertValues = [
        patientId,      // $1 - FIX: Use directly, DB driver handles UUID typing
        providerId,     // $2
        scheduledDate,  // $3
        durationMinutes,// $4
        type || 'video',// $5
        reasonForVisit, // $6
        patientNotes || null, // $7
        roomId,         // $8
        metadata ? JSON.stringify(metadata) : '{}', // $9
        paymentRequired, // $10
        paymentCompleted // $11
      ];
      
      const { rows } = await db.query(
        `INSERT INTO appointments (
          patient_id, provider_id, scheduled_at, duration_minutes,
          type, reason_for_visit, patient_notes, room_id, status, metadata,
          payment_required, payment_completed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9::jsonb, $10, $11)
        RETURNING *`,
        insertValues
      );
      
      if (!rows || rows.length === 0) {
        throw new Error('Failed to create appointment - no rows returned');
      }
      
      // Create notification for provider
      await db.query(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
         VALUES ($1, 'appointment', 'New Appointment', $2, 'appointment', $3)`,
        [
          providerId,
          `New ${type || 'video'} appointment scheduled for ${scheduledDate.toLocaleString()}`,
          rows[0].id
        ]
      );
      
      // Send email notifications
      try {
        const emailService = require('../services/email');
        
        // Get provider details
        const { rows: providerRows } = await db.query(
          'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
          [providerId]
        );
        
        // Get patient details
        const { rows: patientRows } = await db.query(
          'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
          [patientId]
        );
        
        // Prepare appointment data with names for email template
        const appointmentData = keysToCamel(rows[0]);
        appointmentData.providerFirstName = provider?.first_name || providerRows[0]?.first_name;
        appointmentData.providerLastName = provider?.last_name || providerRows[0]?.last_name;
        appointmentData.patientFirstName = patientRows[0]?.first_name;
        appointmentData.patientLastName = patientRows[0]?.last_name;
        
        if (providerRows.length > 0) {
          await emailService.sendAppointmentNotification(
            appointmentData,
            keysToCamel(providerRows[0]),
            'created'
          );
        }
        
        if (patientRows.length > 0) {
          await emailService.sendAppointmentNotification(
            appointmentData,
            keysToCamel(patientRows[0]),
            'created'
          );
        }
      } catch (emailError) {
        logger.error('Failed to send appointment notification emails', { 
          error: emailError.message, 
          appointmentId: rows[0].id 
        });
        // Don't fail appointment creation if email fails
      }
      
      logger.info('Smart appointment booked', {
        appointmentId: rows[0].id,
        patientId,
        providerId,
        category,
        requestedProviderId: requestedProviderId || null
      });
      
      res.status(201).json({
        success: true,
        message: 'Appointment scheduled successfully',
        appointment: keysToCamel(rows[0]),
        provider: provider ? {
          id: provider.id,
          name: `Dr. ${provider.first_name} ${provider.last_name}`,
          specialty: provider.specialty,
          credentials: provider.credentials
        } : null
      });
    } catch (error) {
      logger.error('Smart booking error', { 
        error: error.message, 
        stack: error.stack,
        body: req.body 
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to book appointment. Please check your inputs and try again.'
      });
    }
  }
);

/**
 * GET /api/appointments/provider/today
 * Get provider's appointments for today
 * NOTE: This route MUST come BEFORE /:id routes
 */
router.get('/provider/today',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const { rows } = await db.query(
        `SELECT a.*,
                p.first_name as patient_first_name,
                p.last_name as patient_last_name,
                p.date_of_birth as patient_dob,
                p.phone as patient_phone
         FROM appointments a
         JOIN users p ON p.id = a.patient_id
         WHERE a.provider_id = $1
         AND a.scheduled_at >= $2
         AND a.scheduled_at < $3
         ORDER BY a.scheduled_at ASC`,
        [req.user.id, today, tomorrow]
      );
      
      res.json({
        success: true,
        appointments: rows.map(keysToCamel)
      });
    } catch (error) {
      logger.error('Get provider today appointments error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get appointments'
      });
    }
  }
);

/**
 * GET /api/appointments/:id
 * Get appointment details
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await db.query(
      `SELECT a.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              p.email as patient_email, p.phone as patient_phone,
              p.date_of_birth as patient_dob,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.specialty as provider_specialty, pr.credentials as provider_credentials
       FROM appointments a
       JOIN users p ON p.id = a.patient_id
       JOIN users pr ON pr.id = a.provider_id
       WHERE a.id = $1`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    const appointment = rows[0];
    
    // Check access
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (req.user.role === 'provider' && appointment.provider_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    let appointmentData = keysToCamel(appointment);
    
    // Extract triage data from metadata if it exists
    if (appointmentData.metadata && appointmentData.metadata.triage) {
      appointmentData.triageData = appointmentData.metadata.triage;
    }
    
    res.json({
      success: true,
      appointment: appointmentData
    });
  } catch (error) {
    logger.error('Get appointment error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get appointment'
    });
  }
});

/**
 * PUT /api/appointments/:id
 * Update appointment
 */
router.put('/:id',
  authenticate,
  auditMiddleware('update', 'appointment', { logChanges: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const data = validate(updateAppointmentSchema, req.body);
      
      // Get current appointment
      const { rows: current } = await db.query(
        'SELECT * FROM appointments WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      
      const appointment = current[0];
      
      // Check access
      const canUpdate = 
        req.user.role === 'admin' ||
        (req.user.role === 'patient' && appointment.patient_id === req.user.id) ||
        (req.user.role === 'provider' && appointment.provider_id === req.user.id);
      
      if (!canUpdate) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      // Build update query
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (data.status) {
        updates.push(`status = $${paramIndex}`);
        values.push(data.status);
        paramIndex++;
        
        // Handle status-specific updates
        if (data.status === 'cancelled') {
          updates.push(`cancelled_at = NOW()`);
          updates.push(`cancelled_by = $${paramIndex}`);
          values.push(req.user.id);
          paramIndex++;
          
          if (data.cancellationReason) {
            updates.push(`cancellation_reason = $${paramIndex}`);
            values.push(data.cancellationReason);
            paramIndex++;
          }
        }
        
        if (data.status === 'confirmed') {
          updates.push(`confirmed_at = NOW()`);
        }
        
        if (data.status === 'in_progress') {
          updates.push(`started_at = NOW()`);
        }
        
        if (data.status === 'completed') {
          updates.push(`completed_at = NOW()`);
        }
      }
      
      if (data.scheduledAt) {
        updates.push(`scheduled_at = $${paramIndex}`);
        values.push(new Date(data.scheduledAt));
        paramIndex++;
      }
      
      if (data.providerNotes !== undefined) {
        updates.push(`provider_notes = $${paramIndex}`);
        values.push(data.providerNotes);
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
        `UPDATE appointments SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );
      
      // Create notification for status changes
      if (data.status) {
        const notifyUserId = req.user.id === appointment.patient_id 
          ? appointment.provider_id 
          : appointment.patient_id;
        
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
           VALUES ($1, 'appointment', 'Appointment Updated', $2, 'appointment', $3)`,
          [
            notifyUserId,
            `Appointment status changed to ${data.status}`,
            id
          ]
        );
      }
      
      logger.info('Appointment updated', { appointmentId: id, updates: Object.keys(data) });
      
      res.json({
        success: true,
        message: 'Appointment updated successfully',
        appointment: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      
      logger.error('Update appointment error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update appointment'
      });
    }
  }
);

/**
 * POST /api/appointments/:id/cancel
 * Cancel appointment
 */
router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get appointment
    const { rows: current } = await db.query(
      'SELECT * FROM appointments WHERE id = $1',
      [id]
    );
    
    if (current.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }
    
    const appointment = current[0];
    
    // Check access
    if (req.user.role === 'patient' && appointment.patient_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (req.user.role === 'provider' && appointment.provider_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    // Check if can be cancelled
    if (['completed', 'cancelled', 'in_progress'].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        error: 'This appointment cannot be cancelled'
      });
    }
    
    // Cancel appointment
    const { rows } = await db.query(
      `UPDATE appointments SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $1,
        cancellation_reason = $2,
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [req.user.id, reason, id]
    );
    
    // Notify the other party
    const notifyUserId = req.user.id === appointment.patient_id 
      ? appointment.provider_id 
      : appointment.patient_id;
    
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       VALUES ($1, 'appointment', 'Appointment Cancelled', $2, 'appointment', $3)`,
      [
        notifyUserId,
        reason ? `Appointment cancelled. Reason: ${reason}` : 'Your appointment has been cancelled',
        id
      ]
    );
    
    logger.info('Appointment cancelled', { appointmentId: id, cancelledBy: req.user.id });
    
    res.json({
      success: true,
      message: 'Appointment cancelled successfully',
      appointment: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Cancel appointment error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to cancel appointment'
    });
  }
});

/**
 * POST /api/appointments/:id/join
 * Get video call join information
 */
router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await getAuthorizedVideoAppointment(id, req.user);
    const roomId = await ensureAppointmentRoomId(appointment.id, appointment.roomId);

    res.json({
      success: true,
      roomId,
      joinUrl: `/video/${roomId}`,
      appointmentId: id,
      iceServers: getTelehealthIceServers()
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message
      });
    }

    logger.error('Join appointment error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to join appointment'
    });
  }
});

module.exports = router;

