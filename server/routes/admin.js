/**
 * Admin Routes
 * Administrative operations and dashboard data
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole, requireSuperAdmin } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { validate, searchUsersSchema, updateUserStatusSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');

const router = express.Router();

// All admin routes require admin or super_admin role
router.use(authenticate, requireRole('admin', 'super_admin'));

/**
 * GET /api/admin/dashboard
 * Get dashboard statistics
 */
router.get('/dashboard', async (req, res) => {
  try {
    // Get user counts by role
    const { rows: userCounts } = await db.query(`
      SELECT role, COUNT(*) as count
      FROM users WHERE is_active = true
      GROUP BY role
    `);
    
    // Get pending provider approvals
    const { rows: pendingProviders } = await db.query(`
      SELECT COUNT(*) as count
      FROM users WHERE role = 'provider' AND provider_status = 'pending'
    `);
    
    // Get appointment stats
    const { rows: appointmentStats } = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + 1) as today
      FROM appointments
    `);
    
    // Get recent activity (last 7 days)
    const { rows: weeklyActivity } = await db.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as appointments
      FROM appointments
      WHERE created_at >= CURRENT_DATE - 7
      GROUP BY DATE(created_at)
      ORDER BY date
    `);
    
    // Get subscription stats
    const { rows: subscriptionStats } = await db.query(`
      SELECT tier, COUNT(*) as count
      FROM subscriptions WHERE status = 'active'
      GROUP BY tier
    `);
    
    // Get revenue estimate (Docta Gold subscribers)
    const goldCount = subscriptionStats.find(s => s.tier === 'gold')?.count || 0;
    const platinumCount = subscriptionStats.find(s => s.tier === 'platinum')?.count || 0;
    const estimatedMRR = (goldCount * 29.99) + (platinumCount * 99.99);
    
    // Calculate admin counts
    const adminCount = parseInt(userCounts.find(r => r.role === 'admin')?.count || 0);
    const superAdminCount = parseInt(userCounts.find(r => r.role === 'super_admin')?.count || 0);
    
    res.json({
      success: true,
      dashboard: {
        users: {
          total: userCounts.reduce((sum, r) => sum + parseInt(r.count), 0),
          patients: parseInt(userCounts.find(r => r.role === 'patient')?.count || 0),
          providers: parseInt(userCounts.find(r => r.role === 'provider')?.count || 0),
          admins: adminCount,
          superAdmins: superAdminCount
        },
        providers: {
          pendingApproval: pendingProviders && pendingProviders[0] ? parseInt(pendingProviders[0].count) : 0
        },
        appointments: {
          scheduled: appointmentStats && appointmentStats[0] ? parseInt(appointmentStats[0].scheduled || 0) : 0,
          completed: appointmentStats && appointmentStats[0] ? parseInt(appointmentStats[0].completed || 0) : 0,
          cancelled: appointmentStats && appointmentStats[0] ? parseInt(appointmentStats[0].cancelled || 0) : 0,
          today: appointmentStats && appointmentStats[0] ? parseInt(appointmentStats[0].today || 0) : 0
        },
        subscriptions: {
          free: parseInt(subscriptionStats.find(s => s.tier === 'free')?.count || 0),
          gold: parseInt(goldCount),
          platinum: parseInt(platinumCount),
          estimatedMRR: estimatedMRR.toFixed(2)
        },
        weeklyActivity: weeklyActivity || []
      }
    });
  } catch (error) {
    logger.error('Get admin dashboard error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard data'
    });
  }
});

/**
 * GET /api/admin/users
 * Get users with filters
 */
router.get('/users', async (req, res) => {
  try {
    const filters = validate(searchUsersSchema, req.query);
    const { page, limit, sortBy, sortOrder } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    
    // Build where clause
    let whereClause = 'WHERE 1=1';
    const values = [];
    let paramIndex = 1;
    
    if (filters.query) {
      whereClause += ` AND (
        first_name ILIKE $${paramIndex} OR 
        last_name ILIKE $${paramIndex} OR 
        email ILIKE $${paramIndex}
      )`;
      values.push(`%${filters.query}%`);
      paramIndex++;
    }
    
    if (filters.role) {
      whereClause += ` AND role = $${paramIndex}`;
      values.push(filters.role);
      paramIndex++;
    }
    
    if (filters.providerStatus) {
      whereClause += ` AND provider_status = $${paramIndex}`;
      values.push(filters.providerStatus);
      paramIndex++;
    }
    
    if (filters.isActive !== undefined) {
      whereClause += ` AND is_active = $${paramIndex}`;
      values.push(filters.isActive);
      paramIndex++;
    }
    
    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) FROM users ${whereClause}`,
      values
    );
    const total = parseInt(countResult[0].count);
    
    // Get users
    values.push(limit, offset);
    
    const allowedSortFields = ['created_at', 'email', 'first_name', 'last_name', 'role'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    
    const { rows } = await db.query(
      `SELECT id, email, role, first_name, last_name, phone,
              is_active, is_verified, provider_status,
              specialty, credentials, created_at, last_login_at
       FROM users ${whereClause}
       ORDER BY ${sortField} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      values
    );
    
    res.json({
      success: true,
      users: rows.map(keysToCamel),
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get users error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get users'
    });
  }
});

/**
 * GET /api/admin/users/:id
 * Get user details
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await db.query(
      `SELECT u.*, s.tier as subscription_tier, s.status as subscription_status
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Remove sensitive fields
    const user = rows[0];
    delete user.password_hash;
    delete user.mfa_secret;
    delete user.mfa_backup_codes;
    
    res.json({
      success: true,
      user: keysToCamel(user)
    });
  } catch (error) {
    logger.error('Get user details error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get user details'
    });
  }
});

/**
 * PUT /api/admin/users/:id/status
 * Update user status
 */
router.put('/users/:id/status',
  auditMiddleware('update', 'user', { logChanges: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const data = validate(updateUserStatusSchema, { userId: id, ...req.body });
      
      // Get current user state
      const { rows: current } = await db.query(
        'SELECT is_active, provider_status FROM users WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      res.locals.oldValues = current[0];
      
      // Build update
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (data.isActive !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        values.push(data.isActive);
        paramIndex++;
      }
      
      if (data.providerStatus) {
        updates.push(`provider_status = $${paramIndex}`);
        values.push(data.providerStatus);
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
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, email, role, first_name, last_name, is_active, provider_status`,
        values
      );
      
      // If provider was approved, send notification
      if (data.providerStatus === 'approved' && current[0].provider_status !== 'approved') {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message)
           VALUES ($1, 'system', 'Account Approved', 'Your provider account has been approved. You can now accept appointments.')`,
          [id]
        );
      }
      
      // If user was deactivated, revoke all tokens
      if (data.isActive === false) {
        await db.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
          [id]
        );
      }
      
      logger.info('User status updated', { userId: id, adminId: req.user.id, changes: data });
      
      res.json({
        success: true,
        message: 'User status updated',
        user: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Update user status error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update user status'
      });
    }
  }
);

/**
 * GET /api/admin/providers/pending
 * Get providers pending approval
 */
router.get('/providers/pending', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, phone,
              license_number, license_state, license_expiry,
              specialty, npi_number, credentials, created_at
       FROM users
       WHERE role = 'provider' AND provider_status = 'pending'
       ORDER BY created_at ASC`
    );
    
    res.json({
      success: true,
      providers: rows.map(keysToCamel)
    });
  } catch (error) {
    logger.error('Get pending providers error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get pending providers'
    });
  }
});

/**
 * GET /api/admin/audit-logs
 * Get audit logs
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const filters = validate(paginationSchema, req.query);
    const { page, limit } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    
    const { userId, action, resourceType, startDate, endDate, phiOnly } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const values = [];
    let paramIndex = 1;
    
    if (userId) {
      whereClause += ` AND al.user_id = $${paramIndex}`;
      values.push(userId);
      paramIndex++;
    }
    
    if (action) {
      whereClause += ` AND al.action = $${paramIndex}`;
      values.push(action);
      paramIndex++;
    }
    
    if (resourceType) {
      whereClause += ` AND al.resource_type = $${paramIndex}`;
      values.push(resourceType);
      paramIndex++;
    }
    
    if (startDate) {
      whereClause += ` AND al.created_at >= $${paramIndex}`;
      values.push(new Date(startDate));
      paramIndex++;
    }
    
    if (endDate) {
      whereClause += ` AND al.created_at <= $${paramIndex}`;
      values.push(new Date(endDate));
      paramIndex++;
    }
    
    if (phiOnly === 'true') {
      whereClause += ' AND al.phi_accessed = true';
    }
    
    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) FROM audit_logs al ${whereClause}`,
      values
    );
    const total = parseInt(countResult[0].count);
    
    // Get audit logs
    values.push(limit, offset);
    
    const { rows } = await db.query(
      `SELECT al.*, 
              u.email as user_email,
              u.first_name as user_first_name,
              u.last_name as user_last_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      values
    );
    
    res.json({
      success: true,
      auditLogs: rows.map(row => ({
        ...keysToCamel(row),
        userName: row.user_first_name && row.user_last_name 
          ? `${row.user_first_name} ${row.user_last_name}` 
          : 'System'
      })),
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get audit logs error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get audit logs'
    });
  }
});

/**
 * GET /api/admin/analytics/appointments
 * Get appointment analytics
 */
router.get('/analytics/appointments', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Daily appointment counts
    const { rows: daily } = await db.query(`
      SELECT 
        DATE(scheduled_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE status = 'no_show') as no_show
      FROM appointments
      WHERE scheduled_at >= $1 AND scheduled_at <= $2
      GROUP BY DATE(scheduled_at)
      ORDER BY date
    `, [start, end]);
    
    // By provider
    const { rows: byProvider } = await db.query(`
      SELECT 
        u.id as provider_id,
        u.first_name,
        u.last_name,
        u.specialty,
        COUNT(*) as total_appointments,
        COUNT(*) FILTER (WHERE a.status = 'completed') as completed
      FROM appointments a
      JOIN users u ON u.id = a.provider_id
      WHERE a.scheduled_at >= $1 AND a.scheduled_at <= $2
      GROUP BY u.id, u.first_name, u.last_name, u.specialty
      ORDER BY total_appointments DESC
      LIMIT 10
    `, [start, end]);
    
    // By type
    const { rows: byType } = await db.query(`
      SELECT type, COUNT(*) as count
      FROM appointments
      WHERE scheduled_at >= $1 AND scheduled_at <= $2
      GROUP BY type
    `, [start, end]);
    
    res.json({
      success: true,
      analytics: {
        period: { 
          start: start.toISOString(), 
          end: end.toISOString() 
        },
        daily: daily.map(keysToCamel),
        byProvider: byProvider.map(keysToCamel),
        byType: byType.map(keysToCamel)
      }
    });
  } catch (error) {
    logger.error('Get appointment analytics error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics'
    });
  }
});

/**
 * GET /api/admin/analytics/revenue
 * Get revenue analytics
 */
router.get('/analytics/revenue', async (req, res) => {
  try {
    // Subscription revenue breakdown
    const { rows: subscriptions } = await db.query(`
      SELECT 
        tier,
        COUNT(*) as count,
        CASE tier
          WHEN 'gold' THEN COUNT(*) * 29.99
          WHEN 'platinum' THEN COUNT(*) * 99.99
          ELSE 0
        END as revenue
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY tier
    `);
    
    // Monthly trend
    const { rows: monthly } = await db.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        tier,
        COUNT(*) as new_subscriptions
      FROM subscriptions
      WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at), tier
      ORDER BY month
    `);
    
    const totalMRR = subscriptions.reduce((sum, s) => sum + parseFloat(s.revenue || 0), 0);
    
    res.json({
      success: true,
      revenue: {
        mrr: totalMRR.toFixed(2),
        arr: (totalMRR * 12).toFixed(2),
        byTier: subscriptions.map(keysToCamel),
        monthlyTrend: monthly.map(keysToCamel)
      }
    });
  } catch (error) {
    logger.error('Get revenue analytics error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get revenue analytics'
    });
  }
});

/**
 * POST /api/admin/admins
 * Create a new admin (super_admin only)
 */
router.post('/admins',
  requireSuperAdmin,
  auditMiddleware('create', 'admin', { logChanges: true }),
  async (req, res) => {
    try {
      const { email, firstName, lastName, password, role = 'admin' } = req.body;
      
      if (!email || !firstName || !lastName || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email, first name, last name, and password are required'
        });
      }
      
      if (role !== 'admin' && role !== 'super_admin') {
        return res.status(400).json({
          success: false,
          error: 'Invalid role. Must be admin or super_admin'
        });
      }
      
      // Check if user already exists
      const { rows: existing } = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'User with this email already exists'
        });
      }
      
      // Hash password
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Create admin user
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, is_verified)
         VALUES ($1, $2, $3, $4, $5, true, true)
         RETURNING id, email, first_name, last_name, role, created_at`,
        [email, passwordHash, firstName, lastName, role]
      );
      
      logger.info('Admin created', {
        adminId: rows[0].id,
        createdBy: req.user.id,
        role
      });
      
      res.status(201).json({
        success: true,
        message: `${role === 'super_admin' ? 'Super admin' : 'Admin'} created successfully`,
        admin: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Create admin error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to create admin'
      });
    }
  }
);

/**
 * PUT /api/admin/admins/:id/role
 * Grant or revoke admin access (super_admin only)
 */
router.put('/admins/:id/role',
  requireSuperAdmin,
  auditMiddleware('update', 'admin', { logChanges: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      
      if (!role || !['admin', 'super_admin', 'patient'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role'
        });
      }
      
      // Cannot change own role
      if (id === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change your own role'
        });
      }
      
      // Get current user
      const { rows: current } = await db.query(
        'SELECT role FROM users WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      res.locals.oldValues = { role: current[0].role };
      res.locals.newValues = { role };
      
      // Update role
      const { rows } = await db.query(
        `UPDATE users SET role = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, first_name, last_name, role`,
        [role, id]
      );
      
      logger.info('Admin role updated', {
        userId: id,
        oldRole: current[0].role,
        newRole: role,
        updatedBy: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Role updated successfully',
        user: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Update admin role error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update role'
      });
    }
  }
);

/**
 * GET /api/admin/admins
 * Get all admins (super_admin only)
 */
router.get('/admins',
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login_at
         FROM users
         WHERE role IN ('admin', 'super_admin')
         ORDER BY role DESC, created_at DESC`
      );
      
      res.json({
        success: true,
        admins: rows.map(keysToCamel)
      });
    } catch (error) {
      logger.error('Get admins error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get admins'
      });
    }
  }
);

/**
 * GET /api/admin/forecast
 * Get financial forecasting data
 */
router.get('/forecast', async (req, res) => {
  try {
    const { months = 12 } = req.query;
    
    // Current MRR
    const { rows: currentSubs } = await db.query(`
      SELECT tier, COUNT(*) as count
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY tier
    `);
    
    const goldCount = parseInt(currentSubs.find(s => s.tier === 'gold')?.count || 0);
    const platinumCount = parseInt(currentSubs.find(s => s.tier === 'platinum')?.count || 0);
    const currentMRR = (goldCount * 39.00) + (platinumCount * 99.99);
    
    // Historical growth rate (last 6 months)
    const { rows: historical } = await db.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as new_subs
      FROM subscriptions
      WHERE created_at >= CURRENT_DATE - INTERVAL '6 months'
        AND status = 'active'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `);
    
    // Calculate average monthly growth
    let totalGrowth = 0;
    if (historical.length > 1) {
      for (let i = 1; i < historical.length; i++) {
        const prev = parseInt(historical[i - 1].new_subs);
        const curr = parseInt(historical[i].new_subs);
        if (prev > 0) {
          totalGrowth += ((curr - prev) / prev) * 100;
        }
      }
    }
    const avgGrowthRate = historical.length > 1 ? totalGrowth / (historical.length - 1) : 5; // Default 5%
    
    // Forecast
    const forecast = [];
    let projectedMRR = currentMRR;
    const monthlyGrowth = avgGrowthRate / 100;
    
    for (let i = 0; i < parseInt(months); i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);
      
      // Projected MRR with growth
      projectedMRR = projectedMRR * (1 + monthlyGrowth);
      
      // Projected expenses (assume 40% of revenue)
      const projectedExpenses = projectedMRR * 0.4;
      
      // Projected profit
      const projectedProfit = projectedMRR - projectedExpenses;
      
      forecast.push({
        month: date.toISOString().substring(0, 7),
        projectedMRR: projectedMRR.toFixed(2),
        projectedExpenses: projectedExpenses.toFixed(2),
        projectedProfit: projectedProfit.toFixed(2),
        projectedARR: (projectedMRR * 12).toFixed(2)
      });
    }
    
    // Pay-per-visit revenue (last 30 days)
    const { rows: ppvRevenue } = await db.query(`
      SELECT 
        SUM(amount) as total,
        COUNT(*) as visits
      FROM payments
      WHERE payment_type = 'pay_per_visit'
        AND payment_status = 'completed'
        AND paid_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    
    // Insurance copay revenue
    const { rows: insuranceRevenue } = await db.query(`
      SELECT 
        SUM(amount) as total,
        COUNT(*) as copays
      FROM payments
      WHERE payment_type = 'insurance_copay'
        AND payment_status = 'completed'
        AND paid_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    
    res.json({
      success: true,
      forecast: {
        current: {
          mrr: currentMRR.toFixed(2),
          arr: (currentMRR * 12).toFixed(2),
          goldSubscriptions: goldCount,
          platinumSubscriptions: platinumCount
        },
        growthRate: avgGrowthRate.toFixed(2),
        monthly: forecast,
        additionalRevenue: {
          payPerVisit: {
            monthly: parseFloat(ppvRevenue[0]?.total || 0).toFixed(2),
            visits: parseInt(ppvRevenue[0]?.visits || 0)
          },
          insurance: {
            monthly: parseFloat(insuranceRevenue[0]?.total || 0).toFixed(2),
            copays: parseInt(insuranceRevenue[0]?.copays || 0)
          }
        }
      }
    });
  } catch (error) {
    logger.error('Get forecast error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get forecast'
    });
  }
});

/**
 * GET /api/admin/accounting
 * Get accounting summary
 */
router.get('/accounting', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Revenue by type
    const { rows: revenue } = await db.query(`
      SELECT 
        payment_type,
        SUM(amount) as total,
        COUNT(*) as count
      FROM payments
      WHERE payment_status = 'completed'
        AND paid_at >= $1 AND paid_at <= $2
      GROUP BY payment_type
    `, [start, end]);
    
    // Expenses (placeholder - would integrate with accounting system)
    const expenses = {
      infrastructure: 5000,
      payroll: 15000,
      marketing: 3000,
      operations: 2000
    };
    
    const totalRevenue = revenue.reduce((sum, r) => sum + parseFloat(r.total || 0), 0);
    const totalExpenses = Object.values(expenses).reduce((sum, e) => sum + e, 0);
    const netIncome = totalRevenue - totalExpenses;
    
    res.json({
      success: true,
      accounting: {
        period: { 
          start: start.toISOString(), 
          end: end.toISOString() 
        },
        revenue: {
          total: totalRevenue.toFixed(2),
          byType: revenue.map(keysToCamel)
        },
        expenses: {
          total: totalExpenses.toFixed(2),
          breakdown: expenses
        },
        netIncome: netIncome.toFixed(2),
        profitMargin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) : '0.00'
      }
    });
  } catch (error) {
    logger.error('Get accounting error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get accounting data'
    });
  }
});

module.exports = router;

