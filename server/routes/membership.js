/**
 * Membership API Routes
 * Read-only endpoints for membership card display.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const membershipService = require('../services/membershipService');
const db = require('../db');

// GET /api/membership/me
router.get('/me', authenticate, async (req, res) => {
  try {
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
      card: card || null,
      subscription: rows[0] || null,
      accessLevel: req.user.accessLevel
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load membership' });
  }
});

module.exports = router;


