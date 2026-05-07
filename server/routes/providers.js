/**
 * Provider Routes
 * Provider-specific operations and schedules
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { validate, createScheduleSchema, createTimeOffSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');

const router = express.Router();
const PUBLIC_PROVIDER_FILTER = `
  role = 'provider'
  AND provider_status = 'approved'
  AND is_active = true
  AND COALESCE(is_test_account, FALSE) = FALSE
  AND COALESCE(account_status, 'active') NOT IN ('deleted', 'suspended', 'revoked', 'inactive')
  AND COALESCE(test_account_metadata->>'testAccount', '') NOT IN ('true', 'TRUE')
  AND COALESCE(test_account_metadata->>'isTestAccount', '') NOT IN ('true', 'TRUE')
  AND COALESCE(test_account_metadata->>'createdFrom', '') NOT IN ('admin_portal', 'us_admin_portal', 'ng_admin_portal', 'admin_testing_access')
  AND NOT EXISTS (
    SELECT 1
    FROM testing_access_links tal
    WHERE tal.target_user_id = users.id
       OR LOWER(COALESCE(tal.target_email, '')) = LOWER(users.email)
       OR tal.last_used_by = users.id
  )
  AND EXISTS (
    SELECT 1
    FROM provider_credentialing pc
    WHERE pc.provider_id = users.id
      AND pc.status = 'approved'
  )
`;

/**
 * GET /api/providers
 * Get list of approved providers
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filters = validate(paginationSchema, req.query);
    const { page, limit } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    
    const { specialty } = req.query;
    
    let whereClause = `WHERE ${PUBLIC_PROVIDER_FILTER}`;
    const values = [];
    let paramIndex = 1;
    
    if (specialty) {
      whereClause += ` AND specialty ILIKE $${paramIndex}`;
      values.push(`%${specialty}%`);
      paramIndex++;
    }
    
    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) FROM users ${whereClause}`,
      values
    );
    const total = parseInt(countResult[0].count);
    
    // Get providers
    values.push(limit, offset);
    
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, specialty, credentials, bio,
              city, state
       FROM users ${whereClause}
       ORDER BY last_name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      values
    );
    
    res.json({
      success: true,
      providers: rows.map(keysToCamel),
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get providers error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get providers'
    });
  }
});

/**
 * GET /api/providers/me/schedule
 * Get current provider's schedule
 * NOTE: Must be defined BEFORE /:id routes to avoid route conflicts
 */
router.get('/me/schedule',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM provider_schedules WHERE provider_id = $1 ORDER BY day_of_week`,
        [req.user.id]
      );
      
      res.json({
        success: true,
        schedule: rows.map(keysToCamel)
      });
    } catch (error) {
      logger.error('Get schedule error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get schedule'
      });
    }
  }
);

/**
 * PUT /api/providers/me/schedule
 * Update provider's schedule
 */
router.put('/me/schedule',
  authenticate,
  requireRole('provider'),
  auditMiddleware('update', 'provider_schedule'),
  async (req, res) => {
    try {
      const { schedule } = req.body;
      
      if (!Array.isArray(schedule)) {
        return res.status(400).json({
          success: false,
          error: 'Schedule must be an array'
        });
      }
      
      // Validate each schedule entry
      const validatedSchedule = schedule.map(s => validate(createScheduleSchema, s));
      
      // Use transaction to update schedule
      await db.transaction(async (client) => {
        // Delete existing schedule
        await client.query(
          'DELETE FROM provider_schedules WHERE provider_id = $1',
          [req.user.id]
        );
        
        // Insert new schedule
        for (const entry of validatedSchedule) {
          await client.query(
            `INSERT INTO provider_schedules (
              provider_id, day_of_week, start_time, end_time,
              slot_duration_minutes, buffer_minutes, is_available
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              req.user.id,
              entry.dayOfWeek,
              entry.startTime,
              entry.endTime,
              entry.slotDurationMinutes,
              entry.bufferMinutes,
              entry.isAvailable
            ]
          );
        }
      });
      
      logger.info('Provider schedule updated', { providerId: req.user.id });
      
      res.json({
        success: true,
        message: 'Schedule updated successfully'
      });
    } catch (error) {
      logger.error('Update schedule error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update schedule'
      });
    }
  }
);

/**
 * GET /api/providers/me/time-off
 * Get provider's time off
 */
router.get('/me/time-off',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM provider_time_off 
         WHERE provider_id = $1 AND end_datetime >= NOW()
         ORDER BY start_datetime`,
        [req.user.id]
      );
      
      res.json({
        success: true,
        timeOff: rows.map(keysToCamel)
      });
    } catch (error) {
      logger.error('Get time off error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get time off'
      });
    }
  }
);

/**
 * POST /api/providers/me/time-off
 * Add time off
 */
router.post('/me/time-off',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const data = validate(createTimeOffSchema, req.body);
      
      const { rows } = await db.query(
        `INSERT INTO provider_time_off (provider_id, start_datetime, end_datetime, reason, is_recurring)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.user.id, data.startDatetime, data.endDatetime, data.reason, data.isRecurring]
      );

      // Cancel affected appointments and notify patients
      try {
        const { rows: affectedAppointments } = await db.query(
          `SELECT a.id, a.patient_id, a.scheduled_at,
                  p.first_name as patient_first_name, p.last_name as patient_last_name,
                  pr.first_name as provider_first_name, pr.last_name as provider_last_name
           FROM appointments a
           JOIN users p ON p.id = a.patient_id
           JOIN users pr ON pr.id = a.provider_id
           WHERE a.provider_id = $1
             AND a.scheduled_at BETWEEN $2 AND $3
             AND a.status IN ('scheduled', 'confirmed')`,
          [req.user.id, data.startDatetime, data.endDatetime]
        );

        if (affectedAppointments.length > 0) {
          const appointmentIds = affectedAppointments.map(a => a.id);

          // Cancel all affected appointments in bulk
          await db.query(
            `UPDATE appointments
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $1,
                 cancellation_reason = $2,
                 updated_at = NOW()
             WHERE id = ANY($3::uuid[])`,
            [
              req.user.id,
              data.reason ? `Provider time off: ${data.reason}` : 'Provider unavailable during this period',
              appointmentIds
            ]
          );

          // Notify each affected patient
          const notificationService = require('../services/notifications');
          for (const appt of affectedAppointments) {
            const apptData = {
              id: appt.id,
              scheduledAt: appt.scheduled_at,
              providerFirstName: appt.provider_first_name,
              providerLastName: appt.provider_last_name,
              patientFirstName: appt.patient_first_name,
              patientLastName: appt.patient_last_name
            };
            await notificationService.sendAppointmentNotification(apptData, appt.patient_id, 'patient', 'cancelled');
          }

          logger.info('Affected appointments cancelled for time off', {
            providerId: req.user.id,
            timeOffId: rows[0].id,
            cancelledCount: affectedAppointments.length
          });
        }
      } catch (cancellationError) {
        logger.error('Failed to cancel affected appointments for time off', {
          error: cancellationError.message,
          providerId: req.user.id
        });
        // Don't fail the time-off creation if cancellation has issues
      }

      logger.info('Time off added', { providerId: req.user.id, timeOffId: rows[0].id });
      
      res.status(201).json({
        success: true,
        message: 'Time off added',
        timeOff: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Add time off error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to add time off'
      });
    }
  }
);

/**
 * DELETE /api/providers/me/time-off/:id
 * Delete time off
 */
router.delete('/me/time-off/:id',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const { rowCount } = await db.query(
        'DELETE FROM provider_time_off WHERE id = $1 AND provider_id = $2',
        [id, req.user.id]
      );
      
      if (rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Time off not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Time off deleted'
      });
    } catch (error) {
      logger.error('Delete time off error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to delete time off'
      });
    }
  }
);

/**
 * GET /api/providers/me/patients
 * Get provider's patients
 */
router.get('/me/patients',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const filters = validate(paginationSchema, req.query);
      const { page, limit } = parseQueryParams(filters);
      const offset = (page - 1) * limit;
      
      // Get patients who have had appointments with this provider
      const { rows: countResult } = await db.query(
        `SELECT COUNT(DISTINCT patient_id) 
         FROM appointments WHERE provider_id = $1`,
        [req.user.id]
      );
      const total = parseInt(countResult[0].count);
      
      const { rows } = await db.query(
        `SELECT DISTINCT ON (u.id)
          u.id, u.first_name, u.last_name, u.email, u.phone,
          u.date_of_birth, u.city, u.state,
          MAX(a.scheduled_at) as last_visit,
          COUNT(a.id) as total_appointments
         FROM users u
         JOIN appointments a ON a.patient_id = u.id
         WHERE a.provider_id = $1
         GROUP BY u.id
         ORDER BY u.id, last_visit DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );
      
      res.json({
        success: true,
        patients: rows.map(keysToCamel),
        pagination: getPaginationMeta(total, page, limit)
      });
    } catch (error) {
      logger.error('Get provider patients error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get patients'
      });
    }
  }
);

/**
 * GET /api/providers/:id
 * Get provider details
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format to prevent route conflicts
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid provider ID format'
      });
    }
    
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, specialty, credentials, bio,
              city, state, npi_number
       FROM users
       WHERE id = $1 AND ${PUBLIC_PROVIDER_FILTER}`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Provider not found'
      });
    }
    
    // Get provider's schedule
    const { rows: schedule } = await db.query(
      `SELECT day_of_week, start_time, end_time, slot_duration_minutes, is_available
       FROM provider_schedules
       WHERE provider_id = $1
       ORDER BY day_of_week`,
      [id]
    );
    
    res.json({
      success: true,
      provider: {
        ...keysToCamel(rows[0]),
        schedule: schedule.map(keysToCamel)
      }
    });
  } catch (error) {
    logger.error('Get provider error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get provider'
    });
  }
});

/**
 * GET /api/providers/:id/availability
 * Get provider's available time slots for a date
 */
router.get('/:id/availability', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required'
      });
    }
    
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    
    // Get provider's schedule for this day
    const { rows: schedules } = await db.query(
      `SELECT start_time, end_time, slot_duration_minutes, buffer_minutes, is_available
       FROM provider_schedules
       WHERE provider_id = $1 AND day_of_week = $2`,
      [id, dayOfWeek]
    );
    
    if (schedules.length === 0 || !schedules[0].is_available) {
      return res.json({
        success: true,
        availableSlots: []
      });
    }
    
    const schedule = schedules[0];
    
    // Check for time off
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const { rows: timeOff } = await db.query(
      `SELECT 1 FROM provider_time_off
       WHERE provider_id = $1 
       AND start_datetime <= $2 
       AND end_datetime >= $3`,
      [id, endOfDay, startOfDay]
    );
    
    if (timeOff.length > 0) {
      return res.json({
        success: true,
        availableSlots: []
      });
    }
    
    // Get existing appointments for this date
    const { rows: appointments } = await db.query(
      `SELECT scheduled_at, duration_minutes
       FROM appointments
       WHERE provider_id = $1 
       AND DATE(scheduled_at) = $2
       AND status NOT IN ('cancelled', 'no_show')`,
      [id, date]
    );
    
    // Generate available slots
    const slots = [];
    const slotDuration = schedule.slot_duration_minutes;
    const buffer = schedule.buffer_minutes || 0;
    
    // Parse start and end times
    const [startHour, startMin] = schedule.start_time.split(':').map(Number);
    const [endHour, endMin] = schedule.end_time.split(':').map(Number);
    
    let current = new Date(targetDate);
    current.setHours(startHour, startMin, 0, 0);
    
    const endTime = new Date(targetDate);
    endTime.setHours(endHour, endMin, 0, 0);
    
    while (current < endTime) {
      const slotEnd = new Date(current.getTime() + slotDuration * 60000);
      
      // Check if slot is available
      const isBooked = appointments.some(apt => {
        const aptStart = new Date(apt.scheduled_at);
        const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60000);
        return (current >= aptStart && current < aptEnd) || 
               (slotEnd > aptStart && slotEnd <= aptEnd);
      });
      
      // Don't show past slots for today
      const now = new Date();
      const isPast = current < now;
      
      if (!isBooked && !isPast) {
        slots.push({
          startTime: current.toISOString(),
          endTime: slotEnd.toISOString()
        });
      }
      
      // Move to next slot
      current = new Date(current.getTime() + (slotDuration + buffer) * 60000);
    }
    
    res.json({
      success: true,
      date,
      availableSlots: slots
    });
  } catch (error) {
    logger.error('Get provider availability error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get availability'
    });
  }
});

module.exports = router;

