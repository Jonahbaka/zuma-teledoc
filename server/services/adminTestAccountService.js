const bcrypt = require('bcryptjs');
const db = require('../db');
const logger = require('../middleware/logger');
const { createAuditLog } = require('../middleware/audit');
const { keysToCamel } = require('../../lib/utils');
const {
  getMarketConfig,
  getMarketScopeFromRequest,
  getScopedPortalPath,
} = require('../utils/marketScope');

const TEST_ACCOUNT_ROLES = new Set(['provider', 'patient', 'pharmacy', 'admin']);
const TEST_ACCOUNT_STATUSES = new Set([
  'active',
  'inactive',
  'pending',
  'password_change_required',
  'testing_access_active',
  'testing_access_expired',
  'revoked',
  'deleted',
]);
const TEST_ACCOUNT_TIERS = new Set(['basic', 'gold', 'platinum']);
const TEST_ACCOUNT_ACCESS_LEVEL_BY_TIER = {
  basic: 'basic_monthly',
  gold: 'gold_monthly',
  platinum: 'platinum_monthly',
};
let adminTestAccountSchemaReadyPromise = null;

function ensureAdminTestAccountSchema() {
  if (!adminTestAccountSchemaReadyPromise) {
    adminTestAccountSchemaReadyPromise = db.query(`
      DO $$ BEGIN
        CREATE TYPE region_code AS ENUM ('US', 'NG', 'GH', 'KE', 'ZA');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE access_level ADD VALUE IF NOT EXISTS 'basic_monthly';
      EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE access_level ADD VALUE IF NOT EXISTS 'platinum_monthly';
      EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
      END $$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS region region_code DEFAULT 'US';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_active BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_expires_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_tier VARCHAR(50);

      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_level') THEN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level access_level DEFAULT 'read_only';
        ELSE
          ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level VARCHAR(50) DEFAULT 'read_only';
        END IF;
      END $$;

      UPDATE users
         SET market_scope = CASE
           WHEN region::text = 'NG' OR UPPER(COALESCE(country, '')) IN ('NG', 'NIGERIA') THEN 'NG'
           ELSE COALESCE(NULLIF(market_scope, ''), 'US')
         END
       WHERE market_scope IS NULL OR market_scope = '';

      CREATE INDEX IF NOT EXISTS idx_users_market_scope ON users(market_scope);
      CREATE INDEX IF NOT EXISTS idx_users_role_market_scope ON users(role, market_scope);
    `).catch((error) => {
      adminTestAccountSchemaReadyPromise = null;
      throw error;
    });
  }

  return adminTestAccountSchemaReadyPromise;
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function parseTestingDays(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return 30;
  return Math.min(Math.max(parsed, 1), 365);
}

function normalizeRole(value) {
  return String(value || 'provider').trim().toLowerCase();
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function isNigerianPhone(value) {
  if (!value) return true;
  return /^\+234\d{7,14}$/.test(String(value).replace(/\s+/g, ''));
}

function requiredProviderSpecialty(role, specialty) {
  return role === 'provider' && !specialty;
}

function buildCreateAccountResponse(user, marketScope) {
  return {
    ...keysToCamel(user),
    marketScope,
    loginUrl: getScopedPortalPath(user.role, marketScope, 'login'),
    dashboardUrl: getScopedPortalPath(user.role, marketScope, 'dashboard'),
  };
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function getMetadata(row = {}) {
  if (!row.test_account_metadata) return {};

  if (typeof row.test_account_metadata === 'string') {
    try {
      return JSON.parse(row.test_account_metadata);
    } catch {
      return {};
    }
  }

  return row.test_account_metadata;
}

function mapTestAccountRow(row, marketScope) {
  const metadata = getMetadata(row);
  const account = keysToCamel(row);
  const resolvedMarketScope = row.market_scope || metadata.marketScope || marketScope;
  const isPharmacy = row.role === 'pharmacy';
  const isDeleted = Boolean(metadata.deletedAt);
  const isRevoked = Boolean(metadata.revokedAt) || row.is_active === false;
  const status = isDeleted
    ? 'deleted'
    : isRevoked
      ? 'revoked'
      : row.must_change_password
        ? 'password_change_required'
        : 'active';
  const businessName = metadata.businessName || (isPharmacy ? row.first_name : null);
  const contactPerson = metadata.contactPerson || (isPharmacy ? row.last_name : null);
  const displayName = isPharmacy
    ? [businessName, contactPerson ? `(${contactPerson})` : null].filter(Boolean).join(' ')
    : [row.first_name, row.last_name].filter(Boolean).join(' ');

  return {
    ...account,
    id: row.id,
    role: row.role,
    displayName: displayName || row.email,
    businessName,
    contactPerson,
    branchLocation: metadata.branchLocation || metadata.lga || row.city || null,
    whatsappNumber: metadata.whatsappNumber || null,
    preferredPrescriptionReceivingMethod: metadata.preferredPrescriptionReceivingMethod || null,
    marketScope: resolvedMarketScope,
    status,
    revokedAt: metadata.revokedAt || null,
    revokedBy: metadata.revokedBy || null,
    revokedByEmail: metadata.revokedByEmail || null,
    deletedAt: metadata.deletedAt || null,
    deletedBy: metadata.deletedBy || null,
    deletedByEmail: metadata.deletedByEmail || null,
    createdByAdminId: metadata.createdByAdminId || metadata.createdBy || null,
    createdByAdminEmail: metadata.createdByAdminEmail || metadata.createdByEmail || null,
    testAccountMetadata: metadata,
    accessUrl: getScopedPortalPath(row.role, resolvedMarketScope, 'login'),
    loginUrl: getScopedPortalPath(row.role, resolvedMarketScope, 'login'),
    dashboardUrl: getScopedPortalPath(row.role, resolvedMarketScope, 'dashboard'),
  };
}

async function listAdminTestAccounts(req, res, options = {}) {
  try {
    await ensureAdminTestAccountSchema();
    const marketScope = options.marketScope || getMarketScopeFromRequest(req, 'US');
    const limit = parsePositiveInteger(req.query.limit, 50, 100);
    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const offset = (page - 1) * limit;
    const role = String(req.query.role || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.query || req.query.search || '').trim();
    const includeDeleted = ['1', 'true', 'yes', 'on'].includes(String(req.query.includeDeleted || '').toLowerCase());
    const createdBy = String(req.query.createdBy || '').trim();
    const createdFrom = String(req.query.createdFrom || '').trim();
    const createdTo = String(req.query.createdTo || '').trim();
    const params = [marketScope];
    const where = [
      `u.role IN ('patient', 'provider', 'pharmacy', 'admin')`,
      `COALESCE(u.market_scope, 'US') = $1`,
      `(
        u.test_account_metadata->>'testAccount' = 'true'
        OR u.test_account_metadata->>'isTestAccount' = 'true'
      )`,
    ];

    if (TEST_ACCOUNT_ROLES.has(role)) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }

    if (!includeDeleted && status !== 'deleted') {
      where.push(`COALESCE(u.test_account_metadata->>'deletedAt', '') = ''`);
    }

    if (TEST_ACCOUNT_STATUSES.has(status)) {
      if (status === 'active') {
        where.push('u.is_active = TRUE');
        where.push(`COALESCE(u.test_account_metadata->>'revokedAt', '') = ''`);
        where.push(`COALESCE(u.test_account_metadata->>'deletedAt', '') = ''`);
      } else if (status === 'inactive') {
        where.push('u.is_active = FALSE');
      } else if (status === 'pending') {
        where.push(`(
          u.provider_status = 'pending'
          OR COALESCE(u.test_account_metadata->>'onboardingStatus', '') = 'pending'
        )`);
      } else if (status === 'password_change_required') {
        where.push('u.must_change_password = TRUE');
      } else if (status === 'testing_access_active') {
        where.push(`(
          u.testing_bypass_active = TRUE
          AND (u.testing_bypass_expires_at IS NULL OR u.testing_bypass_expires_at > NOW())
        )`);
      } else if (status === 'testing_access_expired') {
        where.push(`(
          u.testing_bypass_active = TRUE
          AND u.testing_bypass_expires_at IS NOT NULL
          AND u.testing_bypass_expires_at <= NOW()
        )`);
      } else if (status === 'revoked') {
        where.push(`COALESCE(u.test_account_metadata->>'deletedAt', '') = ''`);
        where.push(`(
          u.is_active = FALSE
          OR COALESCE(u.test_account_metadata->>'revokedAt', '') <> ''
        )`);
      } else if (status === 'deleted') {
        where.push(`COALESCE(u.test_account_metadata->>'deletedAt', '') <> ''`);
      }
    }

    if (createdBy) {
      params.push(createdBy);
      where.push(`u.test_account_metadata->>'createdByAdminId' = $${params.length}`);
    }

    if (createdFrom) {
      params.push(new Date(createdFrom));
      where.push(`u.created_at >= $${params.length}`);
    }

    if (createdTo) {
      params.push(new Date(createdTo));
      where.push(`u.created_at <= $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        u.email ILIKE $${params.length}
        OR u.first_name ILIKE $${params.length}
        OR u.last_name ILIKE $${params.length}
        OR COALESCE(u.phone, '') ILIKE $${params.length}
        OR COALESCE(u.specialty, '') ILIKE $${params.length}
        OR COALESCE(u.test_account_metadata::text, '') ILIKE $${params.length}
      )`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM users u
         ${whereClause}`,
      params
    );

    const queryParams = [...params, limit, offset];
    const result = await db.query(
      `SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.phone,
              u.country, u.region, u.market_scope, u.state, u.city,
              u.specialty, u.provider_status, u.is_active, u.is_verified,
              u.must_change_password, u.testing_bypass_active,
              u.testing_bypass_expires_at, u.testing_bypass_tier,
              u.test_account_metadata, u.created_at, u.updated_at, u.last_login_at
         FROM users u
         ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    const total = Number(countResult.rows[0]?.count || 0);

    res.json({
      success: true,
      accounts: result.rows.map((row) => mapTestAccountRow(row, marketScope)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('List admin test accounts error', {
      error: error.message,
      adminId: req.user?.id,
    });

    if (error.code === '42703') {
      return res.status(503).json({
        success: false,
        error: 'Market-scoped test account columns are not migrated yet',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to list test accounts',
    });
  }
}

async function createAdminTestAccount(req, res, options = {}) {
  let client;
  let transactionOpen = false;

  try {
    await ensureAdminTestAccountSchema();
    const marketScope = options.marketScope || getMarketScopeFromRequest(req, 'US');
    const marketConfig = getMarketConfig(marketScope);
    const email = normalizeEmail(req.body.email);
    const role = normalizeRole(req.body.role);
    let firstName = String(req.body.firstName || '').trim();
    let lastName = String(req.body.lastName || '').trim();
    const temporaryPassword = String(req.body.temporaryPassword || '');
    const specialty = String(req.body.specialty || '').trim() || null;
    const phone = String(req.body.phone || '').trim() || null;
    const state = String(req.body.state || req.body.fctState || '').trim() || null;
    const lga = String(req.body.lga || req.body.city || '').trim() || null;
    const facilityType = String(req.body.facilityType || '').trim() || null;
    const businessName = normalizeOptionalText(req.body.businessName || req.body.pharmacyBusinessName);
    const contactPerson = normalizeOptionalText(req.body.contactPerson || req.body.primaryContactPerson);
    const whatsappNumber = normalizeOptionalText(req.body.whatsappNumber || req.body.whatsappBusinessNumber);
    const branchLocation = normalizeOptionalText(req.body.branchLocation || req.body.branch);
    const licenseNumber = normalizeOptionalText(req.body.licenseNumber || req.body.registrationNumber);
    const preferredPrescriptionReceivingMethod = normalizeOptionalText(req.body.preferredPrescriptionReceivingMethod) || 'dashboard_plus_whatsapp';
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
        error: 'Admin-created test accounts are limited to provider, patient, pharmacy, and admin roles',
      });
    }

    if (role === 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only super-admins can create admin test accounts',
      });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required',
      });
    }

    if (role === 'pharmacy') {
      firstName = businessName || firstName;
      lastName = contactPerson || lastName || 'Pharmacy Admin';
    }

    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: role === 'pharmacy'
          ? 'Pharmacy business name and contact person are required'
          : 'First name and last name are required',
      });
    }

    if (temporaryPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Temporary password must be at least 8 characters',
      });
    }

    if (requiredProviderSpecialty(role, specialty)) {
      return res.status(400).json({
        success: false,
        error: 'Specialty is required for provider test accounts',
      });
    }

    if (marketScope === 'NG' && !isNigerianPhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Nigeria test accounts must use a +234 phone number when phone is provided',
      });
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    client = await db.getClient();
    await client.query('BEGIN');
    transactionOpen = true;

    const { rows: existingRows } = await client.query(
      `SELECT id, email, role, market_scope, region, country
         FROM users
        WHERE email = $1 AND role = $2
        LIMIT 1`,
      [email, role]
    );

    if (existingRows.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({
        success: false,
        error: `A ${existingRows[0].role} account with this email already exists`,
      });
    }

    const providerStatus = role === 'provider'
      ? (bypassCredentialing ? 'approved' : 'pending')
      : null;
    const accessLevel = testingBypassActive
      ? TEST_ACCOUNT_ACCESS_LEVEL_BY_TIER[testingBypassTier]
      : 'read_only';
    const credentials = role === 'provider'
      ? (marketScope === 'NG' ? 'MDCN' : 'MD')
      : null;
    const accountMetadata = {
      testAccount: true,
      createdFrom: marketScope === 'NG' ? 'ng_admin_portal' : 'us_admin_portal',
      marketScope,
      status: 'active',
      createdByAdminId: req.user?.id || null,
      createdByAdminEmail: req.user?.email || null,
      country: marketConfig.country,
      facilityType: facilityType || null,
      lga: lga || null,
      stateOrFct: state || null,
      bypassCredentialing: role === 'provider' ? bypassCredentialing : null,
      businessName: role === 'pharmacy' ? firstName : null,
      contactPerson: role === 'pharmacy' ? lastName : null,
      whatsappNumber: role === 'pharmacy' ? whatsappNumber : null,
      branchLocation: role === 'pharmacy' ? (branchLocation || lga || null) : null,
      licenseNumber: role === 'pharmacy' ? licenseNumber : null,
      preferredPrescriptionReceivingMethod: role === 'pharmacy'
        ? preferredPrescriptionReceivingMethod
        : null,
      onboardingStatus: role === 'pharmacy' ? 'approved_for_testing' : null,
    };

    const { rows } = await client.query(
      `INSERT INTO users (
         email, password_hash, role, first_name, last_name,
         phone, country, region, market_scope, state, city,
         specialty, credentials, provider_status, access_level,
         is_active, is_verified, email_verified_at,
         failed_login_attempts, locked_until,
         must_change_password, password_changed_at,
         testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier,
         hipaa_consent_at, terms_accepted_at, test_account_metadata,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15,
         TRUE, TRUE, NOW(),
         0, NULL,
         $16, $17,
         $18, $19, $20,
         NOW(), NOW(), $21,
         NOW(), NOW()
       )
       RETURNING id, email, role, first_name, last_name, provider_status,
                 is_active, is_verified, must_change_password,
                 testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier,
                 country, region, market_scope, state, city, phone, specialty,
                 test_account_metadata`,
      [
        email,
        passwordHash,
        role,
        firstName,
        lastName,
        phone,
        marketConfig.country,
        marketConfig.region,
        marketScope,
        state,
        lga,
        role === 'provider' ? specialty : null,
        credentials,
        providerStatus,
        accessLevel,
        forcePasswordChange,
        forcePasswordChange ? null : new Date(),
        testingBypassActive,
        testingBypassExpiresAt,
        testingBypassActive ? testingBypassTier : null,
        JSON.stringify(accountMetadata),
      ]
    );

    const user = rows[0];

    if (testingBypassActive) {
      await client.query(
        `INSERT INTO subscriptions (
           user_id, tier, status, current_period_start, current_period_end, created_at, updated_at
         ) VALUES ($1, $2, 'active', NOW(), $3, NOW(), NOW())`,
        [user.id, testingBypassTier, testingBypassExpiresAt]
      );
    }

    await client.query('COMMIT');
    transactionOpen = false;

    try {
      await createAuditLog(req, 'create', 'user', user.id, {
        description: 'Created market-scoped test account from admin portal',
        newValues: {
          email: user.email,
          role: user.role,
          providerStatus: user.provider_status,
          marketScope: user.market_scope,
          region: user.region,
          country: user.country,
          state: user.state,
          city: user.city,
          specialty: user.specialty,
          mustChangePassword: user.must_change_password,
          testingBypassActive: user.testing_bypass_active,
          testingBypassTier: user.testing_bypass_tier,
          testingBypassExpiresAt: user.testing_bypass_expires_at,
        },
      });
    } catch (auditError) {
      logger.error('Failed to audit test account creation', {
        error: auditError.message,
        userId: user.id,
        adminId: req.user?.id,
      });
    }

    logger.info('Admin test account created', {
      userId: user.id,
      role: user.role,
      providerStatus: user.provider_status,
      marketScope: user.market_scope,
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: `${marketConfig.label} ${role} test account created`,
      user: buildCreateAccountResponse(user, marketScope),
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
      adminId: req.user?.id,
    });

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists',
      });
    }

    if (error.code === '42703') {
      return res.status(503).json({
        success: false,
        error: 'Market-scoped test account columns are not migrated yet',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create test account',
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function updateAdminTestAccountLifecycle(req, res, options = {}) {
  try {
    await ensureAdminTestAccountSchema();
    const marketScope = options.marketScope || getMarketScopeFromRequest(req, 'US');
    const accountId = req.params.id || req.params.accountId;
    const action = options.action;

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'Test account ID is required' });
    }

    const timestamp = new Date().toISOString();
    const actorId = req.user?.id || null;
    const actorEmail = req.user?.email || null;
    const patch = action === 'delete'
      ? {
        status: 'deleted',
        deletedAt: timestamp,
        deletedBy: actorId,
        deletedByEmail: actorEmail,
        revokedAt: timestamp,
        revokedBy: actorId,
        revokedByEmail: actorEmail,
      }
      : {
        status: 'revoked',
        revokedAt: timestamp,
        revokedBy: actorId,
        revokedByEmail: actorEmail,
      };

    const { rows } = await db.query(
      `UPDATE users u
          SET is_active = FALSE,
              testing_bypass_active = FALSE,
              testing_bypass_expires_at = CASE WHEN $4 = 'delete' THEN NOW() ELSE testing_bypass_expires_at END,
              test_account_metadata = COALESCE(u.test_account_metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE u.id = $1
          AND COALESCE(u.market_scope, 'US') = $2
          AND u.role IN ('patient', 'provider', 'pharmacy', 'admin')
          AND (
            u.test_account_metadata->>'testAccount' = 'true'
            OR u.test_account_metadata->>'isTestAccount' = 'true'
          )
          AND (
            $4 <> 'delete'
            OR COALESCE(u.test_account_metadata->>'deletedAt', '') = ''
          )
        RETURNING u.id, u.email, u.role, u.first_name, u.last_name, u.phone,
                  u.country, u.region, u.market_scope, u.state, u.city,
                  u.specialty, u.provider_status, u.is_active, u.is_verified,
                  u.must_change_password, u.testing_bypass_active,
                  u.testing_bypass_expires_at, u.testing_bypass_tier,
                  u.test_account_metadata, u.created_at, u.updated_at, u.last_login_at`,
      [accountId, marketScope, JSON.stringify(patch), action]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Test account not found' });
    }

    const account = mapTestAccountRow(rows[0], marketScope);

    try {
      await createAuditLog(req, action === 'delete' ? 'delete' : 'revoke', 'user', account.id, {
        description: `${action === 'delete' ? 'Deleted' : 'Revoked'} admin-created test account`,
        newValues: {
          email: account.email,
          role: account.role,
          marketScope: account.marketScope,
          status: account.status,
        },
      });
    } catch (auditError) {
      logger.error('Failed to audit test account lifecycle update', {
        error: auditError.message,
        userId: account.id,
        adminId: req.user?.id,
      });
    }

    logger.info('Admin test account lifecycle updated', {
      userId: account.id,
      role: account.role,
      marketScope: account.marketScope,
      action,
      actorId,
    });

    res.json({
      success: true,
      message: action === 'delete' ? 'Test account deleted' : 'Test account revoked',
      account,
    });
  } catch (error) {
    logger.error('Update test account lifecycle error', {
      error: error.message,
      adminId: req.user?.id,
    });

    if (error.code === '42703') {
      return res.status(503).json({
        success: false,
        error: 'Market-scoped test account columns are not migrated yet',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update test account',
    });
  }
}

module.exports = {
  createAdminTestAccount,
  updateAdminTestAccountLifecycle,
  listAdminTestAccounts,
  mapTestAccountRow,
};
