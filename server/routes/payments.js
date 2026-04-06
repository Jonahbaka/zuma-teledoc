const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../../lib/validation');
const z = require('zod');
const { keysToCamel } = require('../../lib/utils');
const logger = require('../middleware/logger');
const { getUserTestingAccess } = require('../services/testingAccessService');

// Payment pricing constants (hidden from frontend)
const PAYMENT_PRICES = {
  pay_per_visit: 79.00,
  insurance_copay: 15.00
};

// Schema for pay-per-visit payment
const payPerVisitSchema = z.object({
  appointmentId: z.string().uuid(),
  paymentMethodId: z.string().optional()
});

// Schema for insurance copay
const insuranceCopaySchema = z.object({
  appointmentId: z.string().uuid(),
  insuranceId: z.string().uuid()
});

// Get payment for appointment
router.get('/appointment/:appointmentId', authenticate, async (req, res) => {
  try {
    const { appointmentId } = req.params;

    // Verify appointment belongs to user
    const { rows: appointmentRows } = await db.query(
      `SELECT * FROM appointments 
       WHERE id = $1 AND (patient_id = $2 OR provider_id = $2)`,
      [appointmentId, req.user.id]
    );

    if (appointmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    const appointment = keysToCamel(appointmentRows[0]);
    const patientTestingAccess =
      appointment.patientId === req.user.id ? await getUserTestingAccess(req.user.id) : null;
    const paymentBypassed = Boolean(patientTestingAccess?.testingBypassActive);
    const effectivePaymentRequired = paymentBypassed ? false : appointment.paymentRequired || false;
    const effectivePaymentCompleted = paymentBypassed ? true : appointment.paymentCompleted || false;

    // Get payment if exists
    if (appointment.paymentId) {
      const { rows: paymentRows } = await db.query(
        `SELECT * FROM payments WHERE id = $1`,
        [appointment.paymentId]
      );

      if (paymentRows.length > 0) {
        return res.json({
          success: true,
          payment: keysToCamel(paymentRows[0]),
          paymentRequired: effectivePaymentRequired,
          paymentCompleted: effectivePaymentCompleted,
          testingBypassActive: paymentBypassed
        });
      }
    }

    res.json({
      success: true,
      payment: null,
      paymentRequired: effectivePaymentRequired,
      paymentCompleted: effectivePaymentCompleted,
      testingBypassActive: paymentBypassed
    });
  } catch (error) {
    logger.error('Get payment error', {
      error: error.message,
      userId: req.user.id,
      appointmentId: req.params.appointmentId
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment'
    });
  }
});

// Process pay-per-visit payment
router.post('/pay-per-visit', authenticate, async (req, res) => {
  try {
    const data = validate(payPerVisitSchema, req.body);

    // Verify appointment exists and belongs to user
    const { rows: appointmentRows } = await db.query(
      `SELECT * FROM appointments WHERE id = $1 AND patient_id = $2`,
      [data.appointmentId, req.user.id]
    );

    if (appointmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    const appointment = keysToCamel(appointmentRows[0]);

    if (appointment.paymentCompleted) {
      return res.status(400).json({
        success: false,
        error: 'Payment already completed for this appointment'
      });
    }

    const amount = PAYMENT_PRICES.pay_per_visit;

      // Start transaction
      const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create payment record (in production, integrate with Stripe)
      const { rows: paymentRows } = await client.query(
        `INSERT INTO payments (
          user_id, appointment_id, type, status, amount, currency,
          description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          req.user.id,
          data.appointmentId,
          'pay_per_visit',
          'completed', // In production, set to 'pending' and update after Stripe confirmation
          amount,
          'USD',
          'Pay-per-visit consultation',
          JSON.stringify({ appointmentId: data.appointmentId })
        ]
      );

      const payment = paymentRows[0];

      // Update appointment with payment
      await client.query(
        `UPDATE appointments 
         SET payment_id = $1, 
             payment_completed = true,
             payment_required = false,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [payment.id, data.appointmentId]
      );

      // Update user access level temporarily for this visit
      // (Access level will be checked when joining waiting room)
      await client.query(
        `UPDATE users SET access_level = 'pay_per_visit' WHERE id = $1`,
        [req.user.id]
      );

      await client.query('COMMIT');

      logger.info('Pay-per-visit payment processed', {
        userId: req.user.id,
        appointmentId: data.appointmentId,
        paymentId: payment.id
      });

      res.status(201).json({
        success: true,
        payment: keysToCamel(payment),
        message: 'Payment processed successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: error.errors
      });
    }

    logger.error('Pay-per-visit error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to process payment'
    });
  }
});

// Process insurance copay
router.post('/insurance-copay', authenticate, async (req, res) => {
  try {
    const data = validate(insuranceCopaySchema, req.body);

    // Verify appointment exists and belongs to user
    const { rows: appointmentRows } = await db.query(
      `SELECT * FROM appointments WHERE id = $1 AND patient_id = $2`,
      [data.appointmentId, req.user.id]
    );

    if (appointmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Verify insurance exists and belongs to user
    const { rows: insuranceRows } = await db.query(
      `SELECT * FROM patient_insurance WHERE id = $1 AND patient_id = $2 AND is_verified = true`,
      [data.insuranceId, req.user.id]
    );

    if (insuranceRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Insurance not found or not verified'
      });
    }

    const appointment = keysToCamel(appointmentRows[0]);

    if (appointment.paymentCompleted) {
      return res.status(400).json({
        success: false,
        error: 'Payment already completed for this appointment'
      });
    }

    const copayAmount = PAYMENT_PRICES.insurance_copay;

      // Start transaction
      const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create payment record
      const { rows: paymentRows } = await client.query(
        `INSERT INTO payments (
          user_id, appointment_id, insurance_id, type, status, amount, 
          copay_amount, currency, description, metadata, claim_submitted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          req.user.id,
          data.appointmentId,
          data.insuranceId,
          'insurance_copay',
          'completed',
          copayAmount,
          copayAmount,
          'USD',
          'Insurance copay',
          JSON.stringify({ 
            appointmentId: data.appointmentId,
            insuranceId: data.insuranceId 
          }),
          false // Will be set to true after claim submission
        ]
      );

      const payment = paymentRows[0];

      // Update appointment with payment
      await client.query(
        `UPDATE appointments 
         SET payment_id = $1, 
             payment_completed = true,
             payment_required = false,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [payment.id, data.appointmentId]
      );

      // Update user access level
      await client.query(
        `UPDATE users SET access_level = 'insurance' WHERE id = $1`,
        [req.user.id]
      );

      // Submit insurance claim (in production, integrate with insurance API)
      // For now, mark as submitted
      await client.query(
        `UPDATE payments 
         SET claim_submitted = true, 
             claim_id = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [`CLAIM-${Date.now()}`, payment.id]
      );

      await client.query('COMMIT');

      logger.info('Insurance copay processed', {
        userId: req.user.id,
        appointmentId: data.appointmentId,
        insuranceId: data.insuranceId,
        paymentId: payment.id
      });

      res.status(201).json({
        success: true,
        payment: keysToCamel(payment),
        message: 'Copay processed and claim submitted'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: error.errors
      });
    }

    logger.error('Insurance copay error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to process copay'
    });
  }
});

// Get user's payment history
router.get('/history', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, a.scheduled_at as appointment_date
       FROM payments p
       LEFT JOIN appointments a ON a.id = p.appointment_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      success: true,
      payments: rows.map(keysToCamel)
    });
  } catch (error) {
    logger.error('Get payment history error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment history'
    });
  }
});

module.exports = router;

