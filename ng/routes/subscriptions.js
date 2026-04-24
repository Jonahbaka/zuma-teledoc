/**
 * Nigeria Subscription Routes
 * Plan management, subscription lifecycle, billing records
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const { v4: uuidv4 } = require('uuid');

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
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { plan_key, billing_cycle = 'monthly', org_id } = req.body;
    if (!plan_key) return res.status(400).json({ error: 'plan_key required' });

    const planResult = await client.query(
      'SELECT * FROM ng_subscription_plans WHERE plan_key = $1 AND is_active = true',
      [plan_key]
    );
    if (!planResult.rows.length) return res.status(404).json({ error: 'Plan not found' });
    const plan = planResult.rows[0];

    const price = billing_cycle === 'annual' && plan.price_annual
      ? plan.price_annual / 12
      : plan.price_monthly;

    await client.query('BEGIN');

    // Cancel any existing active subscription
    await client.query(`
      UPDATE ng_subscriptions SET status = 'canceled', canceled_at = NOW()
      WHERE subscriber_user_id = $1 AND status IN ('trial','active','past_due')
    `, [req.user.id]);

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + (billing_cycle === 'annual' ? 12 : 1));

    const result = await client.query(`
      INSERT INTO ng_subscriptions (
        subscriber_user_id, subscriber_org_id, plan_id, plan_key,
        status, billing_cycle, amount_per_period, max_members,
        current_period_start, current_period_end,
        trial_ends_at
      ) VALUES ($1,$2,$3,$4,'trial',$5,$6,$7,NOW(),$8,
        NOW() + INTERVAL '7 days'
      )
      RETURNING id, status, trial_ends_at, current_period_end
    `, [
      req.user.id, org_id || null, plan.id, plan_key,
      billing_cycle, price || 0, plan.max_members || null,
      periodEnd,
    ]);

    // Create billing record
    if (price) {
      const invoiceNum = 'NG-INV-' + Date.now();
      await client.query(`
        INSERT INTO ng_billing_records
          (subscription_id, subscriber_user_id, subscriber_org_id, billing_type,
           description, amount, status, invoice_number, due_at, period_start, period_end)
        VALUES ($1,$2,$3,'subscription',$4,$5,'pending',$6, NOW() + INTERVAL '7 days', NOW(),$7)
      `, [
        result.rows[0].id, req.user.id, org_id || null,
        `${plan.name} — ${billing_cycle} subscription`,
        price, invoiceNum, periodEnd,
      ]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      subscription: result.rows[0],
      message: 'Subscription started. Payment required to activate.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/:subscriptionId/cancel', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    await pool.query(`
      UPDATE ng_subscriptions SET
        status = 'canceled', canceled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND subscriber_user_id = $2
    `, [req.params.subscriptionId, req.user.id]);
    res.json({ success: true, message: 'Subscription canceled. Access continues until period end.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  const pool = getPool();
  try {
    const sub = await pool.query(
      'SELECT * FROM ng_subscriptions WHERE id = $1 AND subscriber_user_id = $2',
      [req.params.subscriptionId, req.user.id]
    );
    if (!sub.rows.length) return res.status(404).json({ error: 'Subscription not found' });

    const subscription = sub.rows[0];
    const reference = 'NG-SUB-' + uuidv4().replace(/-/g, '').slice(0, 20).toUpperCase();

    // Store reference for webhook verification
    await pool.query(
      'UPDATE ng_subscriptions SET last_payment_reference = $1 WHERE id = $2',
      [reference, req.params.subscriptionId]
    );

    res.json({
      reference,
      amount_kobo: Math.round(subscription.amount_per_period * 100),
      currency: 'NGN',
      email: req.user.email,
      metadata: {
        subscription_id: subscription.id,
        plan_key: subscription.plan_key,
        user_id: req.user.id,
      },
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/ng/patient/subscription?payment=complete`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WEBHOOK: activate after payment ---

router.post('/activate', authenticate, async (req, res) => {
  const pool = getPool();
  try {
    const { subscription_id, payment_reference, payment_provider } = req.body;
    if (!subscription_id || !payment_reference) {
      return res.status(400).json({ error: 'subscription_id and payment_reference required' });
    }

    await pool.query(`
      UPDATE ng_subscriptions SET
        status = 'active',
        last_payment_reference = $1,
        payment_provider = $2,
        last_payment_at = NOW(),
        failed_payment_attempts = 0,
        updated_at = NOW()
      WHERE id = $3
    `, [payment_reference, payment_provider || 'paystack', subscription_id]);

    await pool.query(`
      UPDATE ng_billing_records SET
        status = 'paid', payment_reference = $1, paid_at = NOW()
      WHERE subscription_id = $2 AND status = 'pending'
    `, [payment_reference, subscription_id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    res.json({ subscriptions: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
