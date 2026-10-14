/**
 * Nigeria Subscription Routes
 * Plan management, subscription lifecycle, billing records
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const manualActivation = require('../services/manualSubscriptionActivationService');
const adminDecisions = require('../services/adminVerificationService');
const { cancelSubscription } = require('../services/subscriptionCancellationService');
const subscriptionCheckout = require('../services/subscriptionCheckoutGateService');

// --- PLANS ---

router.get('/plans', async (req, res) => {
  const pool = getPool();
  try {
    const { role } = req.query;
    const where = role ? 'WHERE target_role = $1 AND is_active = true' : 'WHERE is_active = true';
    const params = role ? [role] : [];
    const result = await pool.query(
      `SELECT * FROM ng_subscription_plans ${where} ORDER BY price_monthly ASC NULLS LAST`,
      params
    );
    res.json({ plans: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USER SUBSCRIPTION ---

router.get('/me', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT s.*, p.name as plan_name, p.features, p.max_consultations
      FROM ng_subscriptions s
      JOIN ng_subscription_plans p ON s.plan_id = p.id
      WHERE s.subscriber_user_id = $1
        AND s.status IN ('trial','active','past_due')
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [req.user.id]);
    res.json({ subscription: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/subscribe', authenticate, async (req, res) => {
  try {
    await subscriptionCheckout.assertCheckoutUnavailable(getPool(), { actorId: req.user.id });
  } catch (error) { subscriptionCheckout.sendCheckoutError(res, error); }
});

router.post('/admin/:subscriptionId/cancel', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const subscription = await cancelSubscription(getPool(), {
      actorId: req.user.id, subscriptionId: req.params.subscriptionId, admin: true, reason: req.body?.reason,
    });
    res.json({ success: true, subscription, message: 'DoctaRx subscription access canceled. This records the local access decision; it does not confirm a refund or stop an external recurring payment.' });
  } catch (err) {
    adminDecisions.sendActionError(res, err);
  }
});

router.post('/:subscriptionId/cancel', authenticate, async (req, res) => {
  try {
    const subscription = await cancelSubscription(getPool(), {
      actorId: req.user.id, subscriptionId: req.params.subscriptionId, reason: req.body?.reason,
    });
    res.json({ success: true, subscription, message: 'DoctaRx subscription access canceled. This records the local access decision; it does not confirm a refund or stop an external recurring payment.' });
  } catch (err) {
    adminDecisions.sendActionError(res, err);
  }
});

// --- BILLING HISTORY ---

router.get('/billing-history', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT * FROM ng_billing_records
      WHERE subscriber_user_id = $1
      ORDER BY created_at DESC LIMIT 30
    `, [req.user.id]);
    res.json({ records: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PAYSTACK PAYMENT INITIATION ---

router.post('/:subscriptionId/initiate-payment', authenticate, async (req, res) => {
  try {
    await subscriptionCheckout.assertCheckoutUnavailable(getPool(), { actorId: req.user.id, subscriptionId: req.params.subscriptionId });
  } catch (error) { subscriptionCheckout.sendCheckoutError(res, error); }
});

// Customer activation stays closed until independent subscription receipts exist.
router.post('/activate', authenticate, async (req, res) => {
  try {
    if (!req.body?.subscription_id) throw adminDecisions.actionError(400, 'A valid subscription ID is required.');
    await subscriptionCheckout.assertCheckoutUnavailable(getPool(), {
      actorId: req.user.id, subscriptionId: req.body.subscription_id, activation: req.body,
    });
  } catch (error) { subscriptionCheckout.sendCheckoutError(res, error); }
});

// --- ADMIN: manual payment/subscription activation ---

router.post('/admin/manual-activation', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const subscription = await manualActivation.activateManualSubscription(getPool(), req.user.id, req.body);
    res.status(201).json({ success: true, subscription, paymentEvidence: 'manual_admin_confirmation' });
  } catch (error) { adminDecisions.sendActionError(res, error); }
});

// --- ADMIN: all subscriptions ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { status, plan_key, limit = 50, offset = 0 } = req.query;
    const where = ['1=1'];
    const params = [];
    if (status) { where.push(`s.status = $${params.length + 1}`); params.push(status); }
    if (plan_key) { where.push(`s.plan_key = $${params.length + 1}`); params.push(plan_key); }

    const result = await pool.query(`
      SELECT s.*, u.email as user_email, p.name as plan_name
      FROM ng_subscriptions s
      LEFT JOIN users u ON s.subscriber_user_id = u.id
      LEFT JOIN ng_subscription_plans p ON s.plan_id = p.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_subscriptions s WHERE ${where.join(' AND ')}`, params
    );
    const summary = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active,
         COALESCE(SUM(amount_per_period) FILTER (WHERE status = 'active'), 0) AS mrr
       FROM ng_subscriptions s
       WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({
      subscriptions: result.rows,
      total: parseInt(count.rows[0].count),
      active: parseInt(summary.rows[0]?.active || 0),
      mrr: Number(summary.rows[0]?.mrr || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
