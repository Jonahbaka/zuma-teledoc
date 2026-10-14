/**
 * Membership API Routes
 * Read-only endpoints for membership card display.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const membershipService = require('../services/membershipService');
const db = require('../db');
const consumerMembership = require('../services/consumerMembershipService');
const stripeService = require('../services/stripeService');

// GET /api/membership/me
router.get('/me', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const state = await consumerMembership.readState(req.user.id, stripeService.PRICING);
    const card = await membershipService.getMyCard(req.user.id);

    // Also expose subscription tier/status for UI
    const { rows } = await db.query(
      `SELECT tier, status, current_period_end
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    res.json({
      success: true,
      card: state.paymentVerified && card?.stripe_subscription_id === state.subscription?.stripe_subscription_id && card.tier === state.subscription.tier && card.status === 'active' && new Date(card.current_period_end) > new Date() ? card : null,
      subscription: state.subscription,
      recordedSubscription: rows[0] || null,
      paymentVerified: state.paymentVerified,
      verificationSource: state.verificationSource,
      paymentEnvironment: state.paymentEnvironment,
      accessLevel: state.accessLevel,
      accessSource: state.accessSource,
      testingBypassActive: state.testingBypassActive
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load membership' });
  }
});

module.exports = router;


