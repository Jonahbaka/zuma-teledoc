const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { keysToCamel } = require('../../lib/utils');
const logger = require('../middleware/logger');
const { getUserTestingAccess } = require('../services/testingAccessService');
const membership = require('../services/consumerMembershipService');

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
    const funding = await membership.appointmentFunding(appointment.patientId, appointmentId);
    const effectivePaymentRequired = !funding.covered;
    const visitPaymentVerified = funding.paymentVerified && ['stripe_verified_checkout', 'paystack_verified_consultation'].includes(funding.source);
    const effectivePaymentCompleted = visitPaymentVerified;

    // Get payment if exists
    if (appointment.paymentId) {
      const { rows: paymentRows } = await db.query(
        `SELECT * FROM payments WHERE id = $1`,
        [appointment.paymentId]
      );

      if (paymentRows.length > 0) {
        return res.json({
          success: true,
          payment: visitPaymentVerified && paymentRows[0].metadata?.source === 'stripe_verified_checkout' && paymentRows[0].status === 'completed' && !paymentRows[0].metadata?.disputed ? keysToCamel(paymentRows[0]) : null,
          recordedPayment: keysToCamel(paymentRows[0]),
          paymentVerified: visitPaymentVerified,
          membershipPaymentVerified: funding.source === 'stripe_verified_invoice',
          coverageApproved: funding.covered && !visitPaymentVerified,
          fundingSource: funding.source,
          paymentRequired: effectivePaymentRequired,
          paymentCompleted: effectivePaymentCompleted,
          testingBypassActive: paymentBypassed
        });
      }
    }

    res.json({
      success: true,
      payment: null,
      paymentVerified: visitPaymentVerified,
      membershipPaymentVerified: funding.source === 'stripe_verified_invoice',
      coverageApproved: funding.covered && !visitPaymentVerified,
      fundingSource: funding.source,
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

// Legacy handlers created completed payments and claims without collection.
// No write occurs here; verified hosted checkout remains the payment route.
for (const path of ['/pay-per-visit', '/insurance-copay']) router.post(path, authenticate, (_req, res) => res.status(503).json({
  success: false, code: 'VERIFIED_PAYMENT_REQUIRED',
  error: 'Direct payment collection and claim submission are not activated here. No payment was collected, claim submitted or access granted.',
  checkoutPath: '/api/stripe/checkout/consultation'
}));

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

