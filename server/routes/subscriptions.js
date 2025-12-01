const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../../lib/validation');
const z = require('zod');
const { keysToCamel } = require('../../lib/utils');
const logger = require('../middleware/logger');

// Subscription pricing constants (hidden from frontend, only used internally)
const SUBSCRIPTION_PRICES = {
  gold_monthly: 39.00,
  gold_yearly: 299.00,
  pay_per_visit: 79.00,
  insurance_copay: 15.00
};

// Schema for creating subscription
const createSubscriptionSchema = z.object({
  type: z.enum(['gold_monthly', 'gold_yearly']),
  paymentMethodId: z.string().optional() // Stripe payment method ID
});

// Schema for updating subscription
const updateSubscriptionSchema = z.object({
  autoRenew: z.boolean().optional(),
  cancelAtPeriodEnd: z.boolean().optional()
});

// Get current user's subscription
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, u.access_level
       FROM subscriptions s
       RIGHT JOIN users u ON u.id = s.user_id
       WHERE u.id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        subscription: null,
        accessLevel: 'read_only'
      });
    }

    const subscription = keysToCamel(rows[0]);
    const isActive = subscription.status === 'active' && 
                     subscription.currentPeriodEnd && 
                     new Date(subscription.currentPeriodEnd) > new Date();

    res.json({
      success: true,
      subscription: isActive ? subscription : null,
      accessLevel: rows[0].access_level || 'read_only'
    });
  } catch (error) {
    logger.error('Get subscription error', { error: error.message, userId: req.user.id });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription'
    });
  }
});

// Create new subscription
router.post('/', authenticate, async (req, res) => {
  try {
    const data = validate(createSubscriptionSchema, req.body);
    
    // Determine access level and pricing
    const accessLevel = data.type;
    const amount = SUBSCRIPTION_PRICES[data.type];
    const subscriptionType = data.type === 'gold_monthly' ? 'monthly' : 'yearly';
    
    // Calculate period dates
    const now = new Date();
    const periodStart = now;
    const periodEnd = new Date(now);
    if (data.type === 'gold_monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }
    const nextBillingDate = new Date(periodEnd);

      // Start transaction
      const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create payment record (in production, integrate with Stripe)
      const { rows: paymentRows } = await client.query(
        `INSERT INTO payments (
          user_id, type, status, amount, currency,
          description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          req.user.id,
          'subscription',
          'completed', // In production, set to 'pending' and update after Stripe confirmation
          amount,
          'USD',
          `${data.type === 'gold_monthly' ? 'Monthly' : 'Yearly'} Gold Membership`,
          JSON.stringify({ subscriptionType: data.type })
        ]
      );

      const paymentId = paymentRows[0].id;

      // Cancel any existing active subscriptions
      await client.query(
        `UPDATE subscriptions 
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND status = 'active'`,
        [req.user.id]
      );

      // Create new subscription
      const { rows: subscriptionRows } = await client.query(
        `INSERT INTO subscriptions (
          user_id, tier, status, subscription_type, amount, currency,
          current_period_start, current_period_end, next_billing_date,
          auto_renew, stripe_customer_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          req.user.id,
          'gold',
          'active',
          subscriptionType,
          amount,
          'USD',
          periodStart,
          periodEnd,
          nextBillingDate,
          true,
          null // In production, set Stripe customer ID
        ]
      );

      // Update user access level
      await client.query(
        `UPDATE users SET access_level = $1 WHERE id = $2`,
        [accessLevel, req.user.id]
      );

      // Link payment to subscription
      await client.query(
        `UPDATE payments SET subscription_id = $1 WHERE id = $2`,
        [subscriptionRows[0].id, paymentId]
      );

      await client.query('COMMIT');

      logger.info('Subscription created', {
        userId: req.user.id,
        subscriptionId: subscriptionRows[0].id,
        type: data.type
      });

      res.status(201).json({
        success: true,
        subscription: keysToCamel(subscriptionRows[0]),
        message: 'Subscription created successfully'
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

    logger.error('Create subscription error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to create subscription'
    });
  }
});

// Update subscription (cancel, renew, etc.)
router.patch('/me', authenticate, async (req, res) => {
  try {
    const data = validate(updateSubscriptionSchema, req.body);

    // Get current subscription
    const { rows: subscriptionRows } = await db.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (subscriptionRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active subscription found'
      });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (data.autoRenew !== undefined) {
      updates.push(`auto_renew = $${paramCount++}`);
      values.push(data.autoRenew);
    }

    if (data.cancelAtPeriodEnd !== undefined) {
      updates.push(`cancel_at_period_end = $${paramCount++}`);
      values.push(data.cancelAtPeriodEnd);
      if (data.cancelAtPeriodEnd) {
        updates.push(`cancelled_at = CURRENT_TIMESTAMP`);
      } else {
        updates.push(`cancelled_at = NULL`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid updates provided'
      });
    }

    values.push(subscriptionRows[0].id);
    const { rows } = await db.query(
      `UPDATE subscriptions 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    logger.info('Subscription updated', {
      userId: req.user.id,
      subscriptionId: rows[0].id
    });

    res.json({
      success: true,
      subscription: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: error.errors
      });
    }

    logger.error('Update subscription error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update subscription'
    });
  }
});

// Cancel subscription
router.post('/me/cancel', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', 
           cancelled_at = CURRENT_TIMESTAMP,
           cancel_at_period_end = true,
           auto_renew = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND status = 'active'
       RETURNING *`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active subscription found'
      });
    }

    // Update user access level to read_only after period ends
    // (In production, schedule this for when period actually ends)
    const subscription = keysToCamel(rows[0]);
    const periodEnd = new Date(subscription.currentPeriodEnd);
    const now = new Date();

    if (periodEnd <= now) {
      await db.query(
        `UPDATE users SET access_level = 'read_only' WHERE id = $1`,
        [req.user.id]
      );
    }

    logger.info('Subscription cancelled', {
      userId: req.user.id,
      subscriptionId: rows[0].id
    });

    res.json({
      success: true,
      subscription: subscription,
      message: 'Subscription cancelled. Access will continue until period end.'
    });
  } catch (error) {
    logger.error('Cancel subscription error', {
      error: error.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      error: 'Failed to cancel subscription'
    });
  }
});

module.exports = router;

