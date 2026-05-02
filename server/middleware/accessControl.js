/**
 * Access Control Middleware
 * Restricts access based on user access level
 */

const db = require('../db');
const { keysToCamel } = require('../../lib/utils');
const logger = require('../middleware/logger');
const {
  getEffectiveAccessLevel,
  getTestingBypassState
} = require('../services/testingAccessService');

// Access levels that can book appointments and join waiting rooms
const PAID_ACCESS_LEVELS = ['basic_monthly', 'gold_monthly', 'gold_yearly', 'platinum_monthly', 'pay_per_visit', 'insurance'];

// Access levels that can access prescriptions
const PRESCRIPTION_ACCESS_LEVELS = ['basic_monthly', 'gold_monthly', 'gold_yearly', 'platinum_monthly', 'pay_per_visit', 'insurance'];

/**
 * Check if user has paid access (can book appointments, join waiting rooms)
 */
const requirePaidAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Get user's current access level
    const { rows } = await db.query(
      `SELECT access_level, id, testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const testingBypass = getTestingBypassState(rows[0]);
    const accessLevel = getEffectiveAccessLevel(rows[0]);

    // Patients can create a free account and book pay-per-consult appointments.
    // Payment/coverage is enforced on the appointment itself when a visit is accessed.
    if (req.user.role === 'patient' && req.method === 'POST' && req.path === '/') {
      req.userAccessLevel = accessLevel;
      req.testingBypass = testingBypass;
      return next();
    }

    // Check if user has paid access
    if (!PAID_ACCESS_LEVELS.includes(accessLevel)) {
      return res.status(403).json({
        success: false,
        error: 'Consultation payment or organization coverage is required',
        accessLevel: accessLevel,
        requiredAccess: 'paid'
      });
    }

    // For pay_per_visit and insurance, verify payment for specific appointment if provided
    if (req.params.appointmentId || req.body.appointmentId) {
      const appointmentId = req.params.appointmentId || req.body.appointmentId;
      
      const { rows: appointmentRows } = await db.query(
        `SELECT payment_completed, payment_required, patient_id 
         FROM appointments 
         WHERE id = $1 AND patient_id = $2`,
        [appointmentId, req.user.id]
      );

      if (appointmentRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }

      const appointment = keysToCamel(appointmentRows[0]);

      if (appointment.paymentRequired && !appointment.paymentCompleted && !testingBypass.active) {
        return res.status(402).json({
          success: false,
          error: 'Payment required before accessing this appointment',
          paymentRequired: true
        });
      }
    }

    req.userAccessLevel = accessLevel;
    req.testingBypass = testingBypass;
    next();
  } catch (error) {
    logger.error('Access control error', {
      error: error.message,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      error: 'Access control check failed'
    });
  }
};

/**
 * Check if user can access prescriptions
 */
const requirePrescriptionAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { rows } = await db.query(
      `SELECT access_level, testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const accessLevel = getEffectiveAccessLevel(rows[0]);

    if (!PRESCRIPTION_ACCESS_LEVELS.includes(accessLevel)) {
      return res.status(403).json({
        success: false,
        error: 'Paid subscription or payment required to access prescriptions',
        accessLevel: accessLevel
      });
    }

    next();
  } catch (error) {
    logger.error('Prescription access control error', {
      error: error.message,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      error: 'Access control check failed'
    });
  }
};

/**
 * Check if user is read-only (for read-only content access)
 */
const allowReadOnly = async (req, res, next) => {
  // Read-only users can access this, but we still need authentication
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};

/**
 * Get user access level (helper function)
 */
const getUserAccessLevel = async (userId) => {
  try {
    const { rows } = await db.query(
      `SELECT access_level FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0].access_level;
  } catch (error) {
    logger.error('Get user access level error', {
      error: error.message,
      userId
    });
    return null;
  }
};

/**
 * Check if user has active subscription
 */
const hasActiveSubscription = async (userId) => {
  try {
    const { rows } = await db.query(
      `SELECT s.* FROM subscriptions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE u.id = $1 
         AND s.status = 'active'
         AND s.current_period_end > CURRENT_TIMESTAMP
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId]
    );

    return rows.length > 0;
  } catch (error) {
    logger.error('Check active subscription error', {
      error: error.message,
      userId
    });
    return false;
  }
};

module.exports = {
  requirePaidAccess,
  requirePrescriptionAccess,
  allowReadOnly,
  getUserAccessLevel,
  hasActiveSubscription,
  PAID_ACCESS_LEVELS,
  PRESCRIPTION_ACCESS_LEVELS
};

