/**
 * Admin Routes
 * Administrative operations and dashboard data
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole, requireSuperAdmin, requireMfa } = require('../middleware/auth');
const { auditMiddleware, createAuditLog } = require('../middleware/audit');
const { validate, searchUsersSchema, updateUserStatusSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');
const notificationService = require('../services/notifications');

const router = express.Router();

const TEST_ACCOUNT_ROLES = new Set(['patient', 'provider', 'pharmacy']);
const TEST_ACCOUNT_TIERS = new Set(['basic', 'gold', 'platinum']);
const TEST_ACCOUNT_COUNTRIES = new Set(['USA', 'Nigeria']);
const TEST_ACCOUNT_ACCESS_LEVEL_BY_TIER = {
  basic: 'basic_monthly',
  gold: 'gold_monthly',
  platinum: 'platinum_monthly'
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const parseTestingDays = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return 30;
  return Math.min(Math.max(parsed, 1), 365);
};

// All admin routes require admin or super_admin role
router.use(authenticate, requireRole('admin', 'super_admin'));

// Production hardening: require MFA for sensitive WRITE operations only
// Read-only routes (GET) are allowed without MFA — dashboard/analytics must be accessible
// MFA is enforced on POST/PUT/DELETE for admin management, user changes, etc.
router.use((req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const isAdminUser = req.user?.role === 'admin' || req.user?.role === 'super_admin';

  if (!isProd || !isAdminUser) return next();

  // Read-only requests (GET) are always allowed — don't block dashboard/analytics/revenue
  if (req.method === 'GET') return next();

  // Write operations require MFA if the user has it enabled
  if (req.user.mfaEnabled) {
    return requireMfa(req, res, next);
  }

  // If MFA is not enabled, allow writes but log a warning
  // (Don't block admin from using the app just because MFA isn't set up yet)
  if (!req.user.mfaEnabled) {
    logger.warn('Admin write operation without MFA', {
      userId: req.user.id,
      method: req.method,
      path: req.originalUrl
    });
  }

  return next();
});

/**
 * GET /api/admin/dashboard
 * Get dashboard statistics
 */
router.get('/dashboard', async (req, res) => {
  try {
    const safeCount = async (q) => {
      try { return parseInt((await db.query(q)).rows[0]?.cnt || (await db.query(q)).rows[0]?.count || 0); }
      catch { return 0; }
    };

    // Run all queries in parallel for speed
    const [
      userCountsResult,
      apptStatsResult,
      weeklyActivityResult,
      subscriptionStatsResult,
      crmResult,
      prescriptionResult,
      triageResult,
      invitationResult,
      aiMsgResult,
      erxResult,
      credentialingResult,
      recentErrorsResult,
    ] = await Promise.allSettled([
      db.query(`SELECT role, COUNT(*) as count FROM users WHERE is_active=true GROUP BY role`),
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status='scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status='completed') as completed,
        COUNT(*) FILTER (WHERE status='cancelled') as cancelled,
        COUNT(*) FILTER (WHERE scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + 1) as today
        FROM appointments`),
      db.query(`SELECT DATE(created_at) as date, COUNT(*) as appointments
        FROM appointments WHERE created_at >= CURRENT_DATE - 7
        GROUP BY DATE(created_at) ORDER BY date`),
      db.query(`SELECT tier, COUNT(*) as count FROM subscriptions WHERE status='active' GROUP BY tier`),
      db.query(`SELECT COUNT(*) as cnt FROM crm_contacts`),
      db.query(`SELECT COUNT(*) as cnt FROM prescriptions`),
      db.query(`SELECT COUNT(*) as cnt FROM triage_queue`),
      db.query(`SELECT COUNT(*) as cnt FROM invitations WHERE status='pending'`),
      db.query(`SELECT COUNT(*) as cnt FROM ai_chat_messages WHERE created_at > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT COUNT(*) as cnt FROM erx_prescriptions WHERE status='pending'`),
      db.query(`SELECT COUNT(*) as cnt FROM provider_credentialing WHERE status='pending'`),
      db.query(`SELECT COUNT(*) as cnt FROM audit_logs WHERE action ILIKE '%error%' AND created_at > NOW() - INTERVAL '24 hours'`),
    ]);

    const rows = (result) => result.status === 'fulfilled' ? result.value.rows : [];
    const cnt  = (result) => parseInt(rows(result)?.[0]?.cnt || rows(result)?.[0]?.count || 0);

    const userCounts      = rows(userCountsResult);
    const apptStats       = rows(apptStatsResult)[0] || {};
    const weeklyActivity  = rows(weeklyActivityResult);
    const subscStats      = rows(subscriptionStatsResult);

    const byRole = {};
    userCounts.forEach(r => { byRole[r.role] = parseInt(r.count); });
    const totalUsers    = Object.values(byRole).reduce((s, v) => s + v, 0);
    const totalPatients = byRole.patient || 0;
    const totalProviders= byRole.provider || 0;
    const adminCount    = (byRole.admin || 0) + (byRole.super_admin || 0);

    const goldCount     = parseInt(subscStats.find(s => s.tier === 'gold')?.count || 0);
    const platinumCount = parseInt(subscStats.find(s => s.tier === 'platinum')?.count || 0);
    const estimatedMRR  = (goldCount * 29.99) + (platinumCount * 99.99);

    const crmContacts        = cnt(crmResult);
    const totalPrescriptions = cnt(prescriptionResult);
    const totalTriageSessions= cnt(triageResult);
    const pendingInvitations = cnt(invitationResult);
    const totalAgentActions  = cnt(aiMsgResult);
    const pendingErx         = cnt(erxResult);
    const pendingCredentialing = cnt(credentialingResult);
    const recentErrors       = cnt(recentErrorsResult);

    res.json({
      success: true,
      // Flat metrics object — matches what agent ops UI and agents expect
      metrics: {
        totalusers:          totalUsers,
        totalpatients:       totalPatients,
        totalproviders:      totalProviders,
        crmcontacts:         crmContacts,
        totalagentactions:   totalAgentActions,
        recenterrors:        recentErrors,
        totalprescriptions:  totalPrescriptions,
        totaltriagesessions: totalTriageSessions,
        pendinginvitations:  pendingInvitations,
        pendingerx:          pendingErx,
        pendingcredentialing: pendingCredentialing,
        activesubscriptions: parseInt(subscStats.reduce((s, r) => s + parseInt(r.count), 0)),
        estimatedmrr:        parseFloat(estimatedMRR.toFixed(2)),
      },
      // Nested structure for backward-compatible dashboard components
      dashboard: {
        users: {
          total:      totalUsers,
          patients:   totalPatients,
          providers:  totalProviders,
          admins:     adminCount,
        },
        providers: {
          pendingApproval: cnt(userCountsResult),  // reuse existing data
        },
        appointments: {
          scheduled: parseInt(apptStats.scheduled || 0),
          completed: parseInt(apptStats.completed || 0),
          cancelled: parseInt(apptStats.cancelled || 0),
          today:     parseInt(apptStats.today || 0),
        },
        subscriptions: {
          free:      parseInt(subscStats.find(s => s.tier === 'free')?.count || 0),
          gold:      goldCount,
          platinum:  platinumCount,
          estimatedMRR: estimatedMRR.toFixed(2),
        },
        crm: { contacts: crmContacts },
        prescriptions: { total: totalPrescriptions, pendingErx },
        triage: { sessions: totalTriageSessions },
        agents: { messages24h: totalAgentActions, recentErrors },
        weeklyActivity: weeklyActivity || [],
      }
    });
  } catch (error) {
    logger.error('Get admin dashboard error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get dashboard data' });
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
 * POST /api/admin/test-accounts
 * Create a real test account from the admin portal.
 *
 * Provider test accounts can optionally bypass credentialing for trusted QA/demo
 * workflows; otherwise they are created as pending providers.
 */
router.post('/test-accounts', requireSuperAdmin, async (req, res) => {
  let client;
  let transactionOpen = false;

  try {
    const email = normalizeEmail(req.body.email);
    const role = String(req.body.role || 'provider').trim().toLowerCase();
    const pharmacyBusinessName = String(req.body.pharmacyBusinessName || req.body.businessName || '').trim();
    const firstName = String(req.body.firstName || (role === 'pharmacy' ? pharmacyBusinessName : '')).trim();
    const lastName = String(req.body.lastName || (role === 'pharmacy' ? 'Pharmacy' : '')).trim();
    const temporaryPassword = String(req.body.temporaryPassword || '');
    const specialty = String(req.body.specialty || '').trim() || null;
    const requestedCountry = String(req.body.country || 'USA').trim();
    const country = TEST_ACCOUNT_COUNTRIES.has(requestedCountry) ? requestedCountry : 'USA';
    const forcePasswordChange = true;
    const bypassCredentialing = req.body.bypassCredentialing !== false;
    const testingBypassActive = req.body.activateTestingBypass !== false;
    const testingBypassTier = TEST_ACCOUNT_TIERS.has(req.body.testingBypassTier)
      ? req.body.testingBypassTier
      : 'gold';
    const testingBypassDays = parseTestingDays(req.body.testingBypassDays);
    const testingBypassExpiresAt = testingBypassActive
      ? new Date(Date.now() + testingBypassDays * 24 * 60 * 60 * 1000)
      : null;

    if (!TEST_ACCOUNT_ROLES.has(role)) {
      return res.status(400).json({
        success: false,
        error: 'Admin-created test accounts support patient, provider, and pharmacy roles'
      });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required'
      });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'First name and last name are required'
      });
    }

    if (temporaryPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Temporary password must be at least 8 characters'
      });
    }

    if (role === 'provider' && !specialty) {
      return res.status(400).json({
        success: false,
        error: 'Specialty is required for provider test accounts'
      });
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    client = await db.getClient();
    await client.query('BEGIN');
    transactionOpen = true;

    const { rows: existingRows } = await client.query(
      `SELECT id, email, role
         FROM users
        WHERE email = $1
        LIMIT 1`,
      [email]
    );

    if (existingRows.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({
        success: false,
        error: `An account with this email already exists as ${existingRows[0].role}`
      });
    }

    const providerStatus = role === 'provider'
      ? (bypassCredentialing ? 'approved' : 'pending')
      : null;
    const accessLevel = testingBypassActive && role !== 'pharmacy'
      ? TEST_ACCOUNT_ACCESS_LEVEL_BY_TIER[testingBypassTier]
      : role === 'patient'
        ? 'pay_per_visit'
        : 'read_only';

    const { rows } = await client.query(
      `INSERT INTO users (
         email, password_hash, role, first_name, last_name,
         country, specialty, credentials,
         is_active, is_verified, email_verified_at,
         provider_status, access_level,
         failed_login_attempts, locked_until,
         must_change_password, password_changed_at,
         testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier,
         market_scope, account_status, is_test_account,
         hipaa_consent_at, terms_accepted_at,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         TRUE, TRUE, NOW(),
         $9, $10,
         0, NULL,
         $11, $12,
         $13, $14, $15,
         $16, 'active', TRUE,
         NOW(), NOW(),
         NOW(), NOW()
       )
       RETURNING id, email, role, first_name, last_name, provider_status,
                 is_active, is_verified, must_change_password,
                 testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier,
                 country, specialty, market_scope, account_status, is_test_account`,
      [
        email,
        passwordHash,
        role,
        firstName,
        lastName,
        country,
        role === 'provider' ? specialty : null,
        role === 'provider' ? 'MD' : null,
        providerStatus,
        accessLevel,
        forcePasswordChange,
        forcePasswordChange ? null : new Date(),
        testingBypassActive,
        testingBypassExpiresAt,
        testingBypassActive && role !== 'pharmacy' ? testingBypassTier : null,
        country === 'Nigeria' ? 'NG' : 'US'
      ]
    );

    const user = rows[0];

    if (testingBypassActive && role !== 'pharmacy') {
      await client.query(
        `INSERT INTO subscriptions (
           user_id, tier, status, current_period_start, current_period_end, created_at, updated_at
         ) VALUES ($1, $2, 'active', NOW(), $3, NOW(), NOW())`,
        [user.id, testingBypassTier, testingBypassExpiresAt]
      );
    }

    if (country === 'Nigeria') {
      await client.query(
        `UPDATE users
            SET region = 'NG',
                coverage_status = CASE WHEN role = 'patient' THEN 'self_pay' ELSE coverage_status END,
                updated_at = NOW()
          WHERE id = $1`,
        [user.id]
      ).catch(() => null);
    }

    if (role === 'provider' && country === 'Nigeria') {
      await client.query(
        `INSERT INTO ng_providers (
           user_id, full_name, email, phone, mdcn_number, specialty,
           status, trial_status, subscription_status, access_status,
           consult_fee_general, consult_fee_specialist
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, 'not_started', 'inactive', $8,
           3000, 8000
         )
         ON CONFLICT (user_id) DO NOTHING`,
        [
          user.id,
          `${firstName} ${lastName}`.trim(),
          email,
          req.body.phone || '+2340000000000',
          req.body.mdcnNumber || req.body.licenseNumber || `TEST-${Date.now()}`,
          'general_practice',
          bypassCredentialing ? 'verified' : 'pending',
          bypassCredentialing ? 'trial_not_started' : 'pending_approval',
        ]
      );
    }

    if (role === 'pharmacy' && country === 'Nigeria') {
      const businessName = pharmacyBusinessName || `${firstName} ${lastName}`.trim();
      const slug = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        `INSERT INTO ng_pharmacies (
           owner_user_id, name, slug, pcn_license_number, pcn_license_expiry,
           superintendent_name, superintendent_pcn_number, superintendent_phone,
           address_line1, city, state, phone, whatsapp, email,
           whatsapp_business_number, preferred_prescription_receiving_method,
           notification_preferences, status, account_status, onboarding_status
         ) VALUES (
           $1,$2,$3,$4,NOW() + INTERVAL '1 year',
           $5,$6,$7,$8,$9,$10,$11,$12,$13,
           $14,$15,$16,$17,$18,$19
         )
         ON CONFLICT (pcn_license_number) DO NOTHING`,
        [
          user.id,
          businessName,
          slug,
          req.body.licenseNumber || req.body.pcnLicenseNumber || `TEST-PCN-${Date.now()}`,
          req.body.superintendentName || `${firstName} ${lastName}`.trim(),
          req.body.superintendentPcnNumber || `TEST-SP-${Date.now()}`,
          req.body.phone || '+2340000000000',
          req.body.branchLocation || req.body.addressLine1 || 'Test pharmacy branch',
          req.body.city || 'Abuja',
          req.body.state || 'FCT',
          req.body.phone || '+2340000000000',
          req.body.whatsappNumber || req.body.whatsapp || null,
          email,
          req.body.whatsappBusinessNumber || req.body.whatsappNumber || req.body.whatsapp || null,
          req.body.preferredPrescriptionReceivingMethod || 'dashboard',
          JSON.stringify({
            dashboard: true,
            whatsapp: ['whatsapp', 'dashboard_whatsapp'].includes(req.body.preferredPrescriptionReceivingMethod),
          }),
          bypassCredentialing ? 'approved' : 'pending_review',
          bypassCredentialing ? 'active' : 'pending_onboarding',
          bypassCredentialing ? 'approved' : 'profile_submitted',
        ]
      );
    }

    await client.query('COMMIT');
    transactionOpen = false;

    try {
      await createAuditLog(req, 'create', 'user', user.id, {
        description: 'Created test account from admin portal',
        newValues: {
          email: user.email,
          role: user.role,
          providerStatus: user.provider_status,
          bypassCredentialing,
          country: user.country,
          specialty: user.specialty,
          mustChangePassword: user.must_change_password,
          testingBypassActive: user.testing_bypass_active,
          testingBypassTier: user.testing_bypass_tier,
          testingBypassExpiresAt: user.testing_bypass_expires_at
        }
      });
    } catch (auditError) {
      logger.error('Failed to audit test account creation', {
        error: auditError.message,
        userId: user.id,
        adminId: req.user?.id
      });
    }

    logger.info('Admin test account created', {
      userId: user.id,
      email: user.email,
      role: user.role,
      providerStatus: user.provider_status,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} test account created`,
      user: keysToCamel(user)
    });
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed after test account creation error', { error: rollbackError.message });
      }
    }

    logger.error('Create test account error', {
      error: error.message,
      adminId: req.user?.id
    });

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create test account'
    });
  } finally {
    if (client) {
      client.release();
    }
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
      
      // If provider status changed, send notification
      if (data.providerStatus && data.providerStatus !== current[0].provider_status) {
        const { rows: providerData } = await db.query(
          'SELECT first_name, last_name FROM users WHERE id = $1',
          [id]
        );
        if (providerData.length > 0) {
          await notificationService.sendProviderStatusNotification(
            { id, lastName: providerData[0].last_name },
            data.providerStatus,
            req.body.reason || null
          );
        }
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
 * POST /api/admin/users/:id/unlock
 * Clear login lock state for a user
 */
router.post('/users/:id/unlock', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: currentRows } = await db.query(
      `SELECT id, email, role, failed_login_attempts, locked_until, is_active, provider_status
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (currentRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const currentUser = currentRows[0];

    if (['admin', 'super_admin'].includes(currentUser.role) && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only Super Admins can unlock admin accounts'
      });
    }

    const { rows } = await db.query(
      `UPDATE users
          SET failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, role, is_active, provider_status, failed_login_attempts, locked_until`,
      [id]
    );

    await createAuditLog(req, 'unlock_login', 'user', id, {
      description: 'Cleared account login lock',
      oldValues: {
        failedLoginAttempts: currentUser.failed_login_attempts,
        lockedUntil: currentUser.locked_until
      },
      newValues: {
        failedLoginAttempts: rows[0].failed_login_attempts,
        lockedUntil: rows[0].locked_until
      }
    });

    logger.info('User login lock cleared', {
      userId: id,
      unlockedBy: req.user.id,
      email: currentUser.email
    });

    res.json({
      success: true,
      message: 'User login lock cleared',
      user: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Unlock user login error', { error: error.message, userId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to clear user login lock'
    });
  }
});

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
 * Get revenue analytics — resilient to missing tables
 */
router.get('/analytics/revenue', async (req, res) => {
  try {
    let subscriptions = [];
    let monthly = [];
    let payments = [];
    let paymentsByMonth = [];

    // Try subscription data (table may not exist)
    try {
      const subResult = await db.query(`
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
      subscriptions = subResult.rows;
    } catch (e) { /* subscriptions table may not exist yet */ }

    // Try monthly subscription trend
    try {
      const monthResult = await db.query(`
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          tier,
          COUNT(*) as new_subscriptions
        FROM subscriptions
        WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at), tier
        ORDER BY month
      `);
      monthly = monthResult.rows;
    } catch (e) { /* skip */ }

    // Try payments data (Stripe payments)
    try {
      const payResult = await db.query(`
        SELECT 
          COUNT(*) as total_payments,
          COALESCE(SUM(amount), 0) as total_amount,
          COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END), 0) as successful_amount,
          COUNT(CASE WHEN status = 'succeeded' THEN 1 END) as successful_count,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as monthly_count,
          COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' AND status = 'succeeded' THEN amount ELSE 0 END), 0) as monthly_amount,
          COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days' AND status = 'succeeded' THEN amount ELSE 0 END), 0) as weekly_amount
        FROM payments
      `);
      payments = payResult.rows[0] || {};
    } catch (e) { /* payments table may not exist */ }

    // Try monthly payment trend
    try {
      const monthPayResult = await db.query(`
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          COUNT(*) as count,
          COALESCE(SUM(amount), 0) as amount,
          status
        FROM payments
        WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at), status
        ORDER BY month
      `);
      paymentsByMonth = monthPayResult.rows;
    } catch (e) { /* skip */ }

    // Try video session revenue
    let sessionRevenue = { total: 0, count: 0 };
    try {
      const sessResult = await db.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(amount_charged), 0) as total
        FROM video_sessions
        WHERE status = 'completed' AND amount_charged > 0
      `);
      sessionRevenue = sessResult.rows[0] || sessionRevenue;
    } catch (e) { /* skip */ }

    const totalMRR = subscriptions.reduce((sum, s) => sum + parseFloat(s.revenue || 0), 0);
    const totalPayments = parseFloat(payments.successful_amount || 0) / 100; // Stripe stores in cents
    const monthlyPayments = parseFloat(payments.monthly_amount || 0) / 100;
    const weeklyPayments = parseFloat(payments.weekly_amount || 0) / 100;

    res.json({
      success: true,
      revenue: {
        totalRevenue: Math.round((totalMRR + totalPayments + parseFloat(sessionRevenue.total || 0)) * 100) / 100,
        mrr: Math.round(totalMRR * 100) / 100,
        arr: Math.round(totalMRR * 12 * 100) / 100,
        monthlyRevenue: Math.round((totalMRR + monthlyPayments) * 100) / 100,
        weeklyRevenue: Math.round(weeklyPayments * 100) / 100,
        yearlyRevenue: Math.round(((totalMRR * 12) + totalPayments) * 100) / 100,
        byTier: subscriptions.map(keysToCamel),
        byPlan: subscriptions.map(s => ({
          plan: s.tier,
          count: parseInt(s.count),
          revenue: parseFloat(s.revenue || 0)
        })),
        monthlyTrend: monthly.map(keysToCamel),
        paymentsTrend: paymentsByMonth.map(keysToCamel),
        payments: {
          totalCount: parseInt(payments.total_payments || 0),
          successfulCount: parseInt(payments.successful_count || 0),
          totalAmount: Math.round(totalPayments * 100) / 100,
          monthlyAmount: Math.round(monthlyPayments * 100) / 100
        },
        sessions: {
          completedPaid: parseInt(sessionRevenue.count || 0),
          sessionRevenue: Math.round(parseFloat(sessionRevenue.total || 0) * 100) / 100
        },
        growth: totalMRR > 0 ? Math.round((monthlyPayments / totalMRR) * 1000) / 10 : 0
      }
    });
  } catch (error) {
    logger.error('Get revenue analytics error', { error: error.message });
    // Return empty data instead of 500 — page should still render
    res.json({
      success: true,
      revenue: {
        totalRevenue: 0,
        mrr: 0,
        arr: 0,
        monthlyRevenue: 0,
        weeklyRevenue: 0,
        yearlyRevenue: 0,
        byTier: [],
        byPlan: [],
        monthlyTrend: [],
        paymentsTrend: [],
        payments: { totalCount: 0, successfulCount: 0, totalAmount: 0, monthlyAmount: 0 },
        sessions: { completedPaid: 0, sessionRevenue: 0 },
        growth: 0
      }
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

/**
 * POST /api/admin/messages
 * Send a message/notification to a specific user
 */
router.post('/messages',
  auditMiddleware('create', 'admin_message'),
  async (req, res) => {
    try {
      const { userId, subject, content, sendEmail = false } = req.body;
      
      if (!userId || !subject || !content) {
        return res.status(400).json({
          success: false,
          error: 'User ID, subject, and content are required'
        });
      }
      
      // Verify user exists
      const { rows: users } = await db.query(
        'SELECT id, email, first_name, last_name, role FROM users WHERE id = $1 AND is_active = true',
        [userId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const recipient = users[0];
      const adminName = `${req.user.firstName || req.user.first_name} ${req.user.lastName || req.user.last_name}`;
      
      // Create in-app notification
      await notificationService.sendAdminMessageNotification(
        userId,
        adminName,
        subject,
        content
      );
      
      // Optionally send email
      if (sendEmail) {
        try {
          const emailService = require('../services/email');
          await emailService.sendAdminMessage(recipient, subject, content, adminName);
        } catch (emailError) {
          logger.warn('Failed to send admin message email', { error: emailError.message });
        }
      }
      
      logger.info('Admin message sent', {
        adminId: req.user.id,
        recipientId: userId,
        subject
      });
      
      res.status(201).json({
        success: true,
        message: 'Message sent successfully'
      });
    } catch (error) {
      logger.error('Send admin message error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
  }
);

/**
 * POST /api/admin/messages/bulk
 * Send a message to multiple users by role or selection
 */
router.post('/messages/bulk',
  auditMiddleware('create', 'admin_bulk_message'),
  async (req, res) => {
    try {
      const { userIds, targetRole, subject, content, sendEmail = false } = req.body;
      
      if (!subject || !content) {
        return res.status(400).json({
          success: false,
          error: 'Subject and content are required'
        });
      }
      
      if (!userIds && !targetRole) {
        return res.status(400).json({
          success: false,
          error: 'Either userIds or targetRole must be provided'
        });
      }
      
      let recipients;
      
      if (userIds && userIds.length > 0) {
        // Send to specific users
        const { rows } = await db.query(
          'SELECT id, email, first_name, last_name, role FROM users WHERE id = ANY($1) AND is_active = true',
          [userIds]
        );
        recipients = rows;
      } else {
        // Send to all users of a role
        const { rows } = await db.query(
          'SELECT id, email, first_name, last_name, role FROM users WHERE role = $1 AND is_active = true',
          [targetRole]
        );
        recipients = rows;
      }
      
      if (recipients.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No recipients found'
        });
      }
      
      const adminName = `${req.user.firstName || req.user.first_name} ${req.user.lastName || req.user.last_name}`;
      
      // Create notifications for all recipients
      let sentCount = 0;
      for (const recipient of recipients) {
        await notificationService.sendAdminMessageNotification(
          recipient.id,
          adminName,
          subject,
          content
        );
        sentCount++;
        
        // Optionally send email
        if (sendEmail) {
          try {
            const emailService = require('../services/email');
            await emailService.sendAdminMessage(recipient, subject, content, adminName);
          } catch (emailError) {
            logger.warn('Failed to send admin message email', { 
              error: emailError.message, 
              recipientId: recipient.id 
            });
          }
        }
      }
      
      logger.info('Bulk admin message sent', {
        adminId: req.user.id,
        recipientCount: sentCount,
        targetRole: targetRole || 'specific users',
        subject
      });
      
      res.status(201).json({
        success: true,
        message: `Message sent to ${sentCount} users`
      });
    } catch (error) {
      logger.error('Send bulk admin message error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to send bulk message'
      });
    }
  }
);

/**
 * GET /api/admin/communications
 * Get all admin communications history
 */
router.get('/communications', async (req, res) => {
  try {
    const filters = validate(paginationSchema, req.query);
    const { page, limit } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    
    const { rows: countResult } = await db.query(`
      SELECT COUNT(*) FROM notifications 
      WHERE type = 'system' AND title != 'Welcome to DoctaRx! 🎉'
    `);
    const total = parseInt(countResult[0].count);
    
    const { rows } = await db.query(`
      SELECT n.*, u.email, u.first_name, u.last_name, u.role
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE n.type = 'system' AND n.title NOT LIKE 'Welcome%'
      ORDER BY n.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    res.json({
      success: true,
      communications: rows.map(row => ({
        id: row.id,
        title: row.title,
        message: row.message,
        isRead: row.is_read,
        createdAt: row.created_at,
        recipient: {
          id: row.user_id,
          email: row.email,
          name: `${row.first_name} ${row.last_name}`,
          role: row.role
        }
      })),
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get admin communications error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get communications'
    });
  }
});

/**
 * POST /api/admin/admins
 * Create a new admin account (Super Admin only)
 */
router.post('/admins',
  requireSuperAdmin,
  auditMiddleware('create', 'admin'),
  async (req, res) => {
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    
    try {
      const { firstName, lastName, email, role = 'admin', sendInvite = true } = req.body;
      
      if (!email || !firstName) {
        return res.status(400).json({
          success: false,
          error: 'Email and first name are required'
        });
      }
      
      // Validate role
      if (!['admin', 'super_admin'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role'
        });
      }
      
      // Check if user already exists
      const { rows: existing } = await db.query(
        `SELECT id FROM users WHERE email = $1 AND role IN ('admin', 'super_admin')`,
        [email.toLowerCase()]
      );
      
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'An admin account with this email already exists'
        });
      }
      
      // Generate temporary password
      const tempPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      
      // Create admin user
      const { rows } = await db.query(
        `INSERT INTO users (
          email, password_hash, first_name, last_name, role,
          email_verified, is_active, must_change_password
        ) VALUES ($1, $2, $3, $4, $5, true, true, true)
        RETURNING id, email, first_name, last_name, role, created_at`,
        [email.toLowerCase(), passwordHash, firstName, lastName, role]
      );
      
      const newAdmin = keysToCamel(rows[0]);
      
      // Send credentials email if requested
      if (sendInvite) {
        const { sendEmail } = require('../services/email');
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
        
        await sendEmail({
          to: email,
          subject: 'Your Docta Admin Account Has Been Created',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #10b981, #14b8a6); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0;">Docta Admin Console</h1>
              </div>
              <div style="padding: 30px; background: #f9fafb;">
                <h2>Welcome, ${firstName}!</h2>
                <p>Your administrator account has been created. Here are your login credentials:</p>
                <div style="background: #e5e7eb; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <p style="color: #dc2626; font-weight: bold;">⚠️ You will be required to change your password on first login.</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${baseUrl}/secure/admin" style="background: linear-gradient(135deg, #10b981, #14b8a6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                    Login to Admin Console
                  </a>
                </div>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="color: #9ca3af; font-size: 12px;">
                  This is a confidential communication. Do not share your credentials with anyone.
                </p>
              </div>
            </div>
          `
        });
      }
      
      logger.info('Admin account created', {
        adminId: newAdmin.id,
        role: newAdmin.role,
        createdBy: req.user.id
      });
      
      res.status(201).json({
        success: true,
        admin: newAdmin,
        message: sendInvite ? 'Admin created and credentials sent' : 'Admin created successfully'
      });
    } catch (error) {
      logger.error('Create admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create admin account'
      });
    }
  }
);

/**
 * PUT /api/admin/users/:id/status
 * Update user status (activate/deactivate, approve/reject provider)
 */
router.put('/users/:id/status',
  auditMiddleware('update', 'user_status'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive, providerStatus } = req.body;
      
      // Cannot modify own account
      if (id === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot modify your own account status'
        });
      }
      
      // Get current user
      const { rows: currentUser } = await db.query(
        `SELECT role FROM users WHERE id = $1`,
        [id]
      );
      
      if (currentUser.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Only super_admin can modify other admins
      if (['admin', 'super_admin'].includes(currentUser[0].role) && req.user.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admins can modify admin accounts'
        });
      }
      
      // Build update query
      const updates = [];
      const params = [];
      let paramIndex = 1;
      
      if (typeof isActive === 'boolean') {
        updates.push(`is_active = $${paramIndex++}`);
        params.push(isActive);
      }
      
      if (providerStatus && ['pending', 'approved', 'suspended', 'rejected'].includes(providerStatus)) {
        updates.push(`provider_status = $${paramIndex++}`);
        params.push(providerStatus);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid updates provided'
        });
      }
      
      params.push(id);
      
      const { rows } = await db.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, email, first_name, last_name, role, is_active, provider_status`,
        params
      );
      
      logger.info('User status updated', {
        userId: id,
        updates: { isActive, providerStatus },
        updatedBy: req.user.id
      });
      
      res.json({
        success: true,
        user: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Update user status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update user status'
      });
    }
  }
);

/**
 * DELETE /api/admin/users/:id
 * Delete a user (Super Admin only)
 */
router.delete('/users/:id',
  requireSuperAdmin,
  auditMiddleware('delete', 'user'),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Cannot delete own account
      if (id === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete your own account'
        });
      }
      
      // Get user info before deletion
      const { rows: userRows } = await db.query(
        `SELECT email, role, first_name, last_name FROM users WHERE id = $1`,
        [id]
      );
      
      if (userRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const userToDelete = userRows[0];
      
      // Delete user (cascades to related records)
      await db.query(`DELETE FROM users WHERE id = $1`, [id]);
      
      logger.info('User deleted', {
        deletedUserId: id,
        deletedUserEmail: userToDelete.email,
        deletedUserRole: userToDelete.role,
        deletedBy: req.user.id
      });
      
      res.json({
        success: true,
        message: `User ${userToDelete.email} has been deleted`
      });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }
  }
);

/**
 * POST /api/admin/test-email
 * Send a test welcome email to verify deliverability (Super Admin only)
 */
router.post('/test-email',
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { email, type = 'welcome' } = req.body;
      
      // Default to admin's email if none provided
      const targetEmail = email || req.user.email;
      
      if (!targetEmail) {
        return res.status(400).json({
          success: false,
          error: 'Email address is required'
        });
      }
      
      const emailService = require('../services/email');
      
      // Create mock user object for test
      const testUser = {
        id: req.user.id,
        email: targetEmail,
        firstName: req.user.firstName || req.user.first_name || 'Test',
        lastName: req.user.lastName || req.user.last_name || 'User',
        role: 'patient' // Test as patient to see full welcome email
      };
      
      if (type === 'welcome') {
        await emailService.sendWelcomeEmail(testUser);
        logger.info('Test welcome email sent', { to: targetEmail, by: req.user.id });
        
        res.json({
          success: true,
          message: `Welcome email sent to ${targetEmail}`,
          details: {
            type: 'welcome',
            recipient: targetEmail,
            sentAt: new Date().toISOString()
          }
        });
      } else if (type === 'verification') {
        const crypto = require('crypto');
        const testToken = crypto.randomBytes(32).toString('hex');
        await emailService.sendVerificationEmail(testUser, testToken);
        logger.info('Test verification email sent', { to: targetEmail, by: req.user.id });
        
        res.json({
          success: true,
          message: `Verification email sent to ${targetEmail}`,
          details: {
            type: 'verification',
            recipient: targetEmail,
            sentAt: new Date().toISOString()
          }
        });
      } else if (type === 'admin_message') {
        const adminName = `${req.user.firstName || req.user.first_name} ${req.user.lastName || req.user.last_name}`;
        await emailService.sendAdminMessage(
          testUser, 
          'Test Admin Message', 
          'This is a test message from the Docta Admin Console.\n\nIf you received this email, your email configuration is working correctly!',
          adminName
        );
        logger.info('Test admin message email sent', { to: targetEmail, by: req.user.id });
        
        res.json({
          success: true,
          message: `Admin message email sent to ${targetEmail}`,
          details: {
            type: 'admin_message',
            recipient: targetEmail,
            sentAt: new Date().toISOString()
          }
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid email type. Use: welcome, verification, or admin_message'
        });
      }
    } catch (error) {
      logger.error('Test email error:', error);
      res.status(500).json({
        success: false,
        error: `Failed to send test email: ${error.message}`
      });
    }
  }
);

module.exports = router;

