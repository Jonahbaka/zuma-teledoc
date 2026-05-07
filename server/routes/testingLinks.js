/**
 * Testing Access Links Routes
 * Generate time-limited access links for providers/patients
 * that bypass payment requirements for demo/testing purposes
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const logger = require('../middleware/logger');
const {
  appendToken,
  buildAbsoluteUrl,
  getMarketConfig,
  getMarketScopeFromRequest,
  getScopedPortalPath,
  normalizeMarketScope,
} = require('../utils/marketScope');

const SUPPORTED_LINK_TYPES = new Set(['provider', 'patient', 'pharmacy', 'admin']);
const LINK_STATUS_FILTERS = new Set(['active', 'used', 'revoked', 'expired', 'deleted']);

// Generate a secure random token
const generateToken = () => crypto.randomBytes(32).toString('hex');
let lifecycleSchemaReadyPromise = null;

function ensureTestingLinksLifecycleSchema() {
  if (!lifecycleSchemaReadyPromise) {
    lifecycleSchemaReadyPromise = db.query(`
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active';
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS target_email VARCHAR(255);

      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'testing_access_links_link_type_check'
             AND conrelid = 'testing_access_links'::regclass
        ) THEN
          ALTER TABLE testing_access_links DROP CONSTRAINT testing_access_links_link_type_check;
        END IF;

        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'testing_access_links_link_type_check'
             AND conrelid = 'testing_access_links'::regclass
        ) THEN
          ALTER TABLE testing_access_links
            ADD CONSTRAINT testing_access_links_link_type_check
            CHECK (link_type IN ('provider', 'patient', 'pharmacy', 'admin'));
        END IF;
      END $$;

      UPDATE testing_access_links
         SET status = CASE
           WHEN deleted_at IS NOT NULL THEN 'deleted'
           WHEN revoked_at IS NOT NULL OR is_active = FALSE THEN 'revoked'
           WHEN expires_at <= NOW() THEN 'expired'
           WHEN max_uses IS NOT NULL AND current_uses >= max_uses THEN 'used'
           ELSE COALESCE(NULLIF(status, ''), 'active')
         END
       WHERE status IS NULL OR status = '';

      CREATE INDEX IF NOT EXISTS idx_testing_access_links_status ON testing_access_links(status);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_deleted_at ON testing_access_links(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_created_by ON testing_access_links(created_by);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_last_used_by ON testing_access_links(last_used_by);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_target_user_id ON testing_access_links(target_user_id);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_target_email ON testing_access_links(target_email);
    `).catch((error) => {
      lifecycleSchemaReadyPromise = null;
      throw error;
    });
  }

  return lifecycleSchemaReadyPromise;
}

const isQueryEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const parsePositiveInt = (value, fallback, max) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const normalizeLinkType = (value) => String(value || '').trim().toLowerCase();

const getLinkLifecycleStatus = (link = {}) => {
  if (link.deleted_at) return 'deleted';
  if (link.revoked_at || link.is_active === false) return 'revoked';
  if (link.expires_at && new Date(link.expires_at) < new Date()) return 'expired';
  if (link.max_uses && Number(link.current_uses || 0) >= Number(link.max_uses)) return 'used';
  return 'active';
};

const buildLinkUrls = (req, link, marketScope) => {
  const resolvedMarketScope = normalizeMarketScope(link.market_scope || marketScope);
  const baseUrl = getBaseUrl(req);
  const token = link.token;
  const accessPath = `${resolvedMarketScope === 'NG' ? '/ng' : ''}/access/${token}`;
  const loginPath = appendToken(getScopedPortalPath(link.link_type, resolvedMarketScope, 'login'), token);
  const registerPath = appendToken(getScopedPortalPath(link.link_type, resolvedMarketScope, 'register'), token);

  return {
    market_scope: resolvedMarketScope,
    role: link.link_type,
    email: link.target_email || null,
    accessUrl: accessPath,
    access_url: accessPath,
    fullUrl: buildAbsoluteUrl(baseUrl, accessPath),
    fullAccessUrl: buildAbsoluteUrl(baseUrl, accessPath),
    full_access_url: buildAbsoluteUrl(baseUrl, accessPath),
    loginUrl: buildAbsoluteUrl(baseUrl, loginPath),
    login_url: buildAbsoluteUrl(baseUrl, loginPath),
    registerUrl: buildAbsoluteUrl(baseUrl, registerPath),
    register_url: buildAbsoluteUrl(baseUrl, registerPath),
  };
};

const formatLink = (req, link, marketScope) => {
  const status = getLinkLifecycleStatus(link);
  return {
    ...link,
    ...buildLinkUrls(req, link, marketScope),
    status,
    isExpired: status === 'expired',
    isExhausted: status === 'used',
    isRevoked: status === 'revoked',
    isDeleted: status === 'deleted',
    createdByName: [link.created_by_first_name, link.created_by_last_name].filter(Boolean).join(' ') || link.created_by_email || null,
    lastUsedByName: [link.last_used_by_first_name, link.last_used_by_last_name].filter(Boolean).join(' ') || link.last_used_by_email || null,
  };
};

function appendStatusFilter(where, status) {
  if (status === 'active') {
    where.push(`tl.deleted_at IS NULL`);
    where.push(`tl.revoked_at IS NULL`);
    where.push(`tl.is_active = TRUE`);
    where.push(`tl.expires_at > NOW()`);
    where.push(`(tl.max_uses IS NULL OR tl.current_uses < tl.max_uses)`);
  } else if (status === 'used') {
    where.push(`tl.deleted_at IS NULL`);
    where.push(`tl.revoked_at IS NULL`);
    where.push(`tl.max_uses IS NOT NULL AND tl.current_uses >= tl.max_uses`);
  } else if (status === 'revoked') {
    where.push(`tl.deleted_at IS NULL`);
    where.push(`(tl.revoked_at IS NOT NULL OR tl.is_active = FALSE)`);
  } else if (status === 'expired') {
    where.push(`tl.deleted_at IS NULL`);
    where.push(`tl.revoked_at IS NULL`);
    where.push(`tl.expires_at <= NOW()`);
  } else if (status === 'deleted') {
    where.push(`tl.deleted_at IS NOT NULL`);
  }
}

// Get the correct base URL for links, preferring non-localhost env,
// then falling back to the request host (Cloud Run), then production.
const getBaseUrl = (req) => {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && !envUrl.includes('localhost')) {
    return envUrl;
  }

  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const host = forwardedHost || req?.get?.('host');
  const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol;
  if (host) {
    return `${proto || 'https'}://${host}`;
  }

  return 'https://doctarx.com';
};

/**
 * GET /api/testing-links
 * List all testing links (admin only)
 */
router.get('/', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const {
      type,
      active_only,
      status,
      query: search,
      createdBy,
      createdFrom,
      createdTo,
    } = req.query;
    const marketScope = getMarketScopeFromRequest(req, 'US');
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const offset = (page - 1) * limit;
    const includeDeleted = isQueryEnabled(req.query.includeDeleted);

    const params = [marketScope];
    const where = [`COALESCE(tl.market_scope, 'US') = $1`];

    const normalizedType = normalizeLinkType(type);
    if (SUPPORTED_LINK_TYPES.has(normalizedType)) {
      params.push(normalizedType);
      where.push(`tl.link_type = $${params.length}`);
    }

    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (LINK_STATUS_FILTERS.has(normalizedStatus)) {
      appendStatusFilter(where, normalizedStatus);
    } else if (active_only === 'true') {
      appendStatusFilter(where, 'active');
    } else if (!includeDeleted) {
      where.push(`tl.deleted_at IS NULL`);
    }

    if (search) {
      params.push(`%${String(search).trim()}%`);
      where.push(`(
        tl.label ILIKE $${params.length}
        OR tl.description ILIKE $${params.length}
        OR tl.token ILIKE $${params.length}
        OR creator.email ILIKE $${params.length}
        OR COALESCE(last_user.email, '') ILIKE $${params.length}
      )`);
    }

    if (createdBy) {
      const createdByValue = String(createdBy).trim();
      params.push(createdByValue.includes('@') ? `%${createdByValue}%` : createdByValue);
      where.push(createdByValue.includes('@')
        ? `creator.email ILIKE $${params.length}`
        : `tl.created_by::text = $${params.length}`);
    }

    if (createdFrom) {
      params.push(new Date(createdFrom));
      where.push(`tl.created_at >= $${params.length}`);
    }

    if (createdTo) {
      params.push(new Date(createdTo));
      where.push(`tl.created_at <= $${params.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM testing_access_links tl
      LEFT JOIN users creator ON tl.created_by = creator.id
      LEFT JOIN users last_user ON tl.last_used_by = last_user.id
      ${whereClause}
    `, params);

    const queryParams = [...params, limit, offset];
    const { rows } = await db.query(`
      SELECT
        tl.*,
        tl.link_type AS role,
        tl.target_email AS email,
        creator.email as created_by_email,
        creator.first_name as created_by_first_name,
        creator.last_name as created_by_last_name,
        last_user.email as last_used_by_email,
        last_user.first_name as last_used_by_first_name,
        last_user.last_name as last_used_by_last_name,
        (SELECT COUNT(*) FROM testing_link_activations WHERE link_id = tl.id) as activation_count
      FROM testing_access_links tl
      LEFT JOIN users creator ON tl.created_by = creator.id
      LEFT JOIN users last_user ON tl.last_used_by = last_user.id
      ${whereClause}
      ORDER BY tl.created_at DESC
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
    `, queryParams);

    const total = Number(countResult.rows[0]?.count || 0);
    res.json({
      success: true,
      links: rows.map((link) => formatLink(req, link, marketScope)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error fetching testing links', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch testing links' });
  }
});

/**
 * POST /api/testing-links
 * Create a new testing access link (admin only)
 */
router.post('/', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const {
      linkType,
      label,
      description,
      maxUses = 10,
      expiresInHours = 72,
      bypassPayment = true,
      bypassSubscription = true,
      grantTier = 'gold'
    } = req.body;
    const marketScope = getMarketScopeFromRequest(req, 'US');
    const marketConfig = getMarketConfig(marketScope);
    const normalizedLinkType = normalizeLinkType(linkType);
    
    if (!normalizedLinkType || !SUPPORTED_LINK_TYPES.has(normalizedLinkType)) {
      return res.status(400).json({ 
        success: false, 
        error: 'linkType must be patient, provider, pharmacy, or admin' 
      });
    }

    if (normalizedLinkType === 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only super-admins can create admin testing access links',
      });
    }
    
    const token = generateToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    const { rows } = await db.query(`
      INSERT INTO testing_access_links (
        token, link_type, label, description,
        max_uses, expires_at, bypass_payment, bypass_subscription,
        grant_tier, market_scope, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
      RETURNING *
    `, [
      token, normalizedLinkType, label || `${marketConfig.label} ${normalizedLinkType} test link`,
      description, maxUses, expiresAt,
      bypassPayment, bypassSubscription, grantTier, marketScope, req.user.id
    ]);
    
    const link = rows[0];
    
    logger.info('Testing link created', {
      linkId: link.id,
      linkType: normalizedLinkType,
      marketScope,
      createdBy: req.user.id,
      expiresAt
    });

    res.status(201).json({
      success: true,
      link: formatLink(req, link, marketScope),
    });
  } catch (error) {
    logger.error('Error creating testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create testing link' });
  }
});

/**
 * GET /api/testing-links/:id
 * Get a specific testing link details
 */
router.get('/:id', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const { id } = req.params;
    const marketScope = getMarketScopeFromRequest(req, 'US');
    
    const { rows: [link] } = await db.query(`
      SELECT 
        tl.*,
        tl.link_type AS role,
        tl.target_email AS email,
        creator.email as created_by_email,
        creator.first_name as created_by_first_name,
        creator.last_name as created_by_last_name,
        last_user.email as last_used_by_email,
        last_user.first_name as last_used_by_first_name,
        last_user.last_name as last_used_by_last_name
      FROM testing_access_links tl
      LEFT JOIN users creator ON tl.created_by = creator.id
      LEFT JOIN users last_user ON tl.last_used_by = last_user.id
      WHERE tl.id = $1 AND COALESCE(tl.market_scope, 'US') = $2
    `, [id, marketScope]);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Testing link not found' });
    }
    
    // Get activations
    const { rows: activations } = await db.query(`
      SELECT 
        tla.*,
        u.email,
        u.first_name,
        u.last_name,
        u.role
      FROM testing_link_activations tla
      JOIN users u ON tla.user_id = u.id
      WHERE tla.link_id = $1
      ORDER BY tla.activated_at DESC
    `, [id]);
    
    res.json({
      success: true,
      link: formatLink(req, link, marketScope),
      activations
    });
  } catch (error) {
    logger.error('Error fetching testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch testing link' });
  }
});

/**
 * PATCH /api/testing-links/:id
 * Update a testing link (extend, deactivate, etc.)
 */
router.patch('/:id', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const { id } = req.params;
    const { isActive, extendHours, maxUses, label, description, action, status } = req.body;
    const marketScope = getMarketScopeFromRequest(req, 'US');
    const shouldRevoke = action === 'revoke' || status === 'revoked' || isActive === false;
    const shouldReactivate = action === 'reactivate' || status === 'active' || isActive === true;
    
    const updates = [];
    const params = [id, marketScope];
    let paramIndex = 3;
    
    if (shouldRevoke) {
      updates.push(`is_active = FALSE`);
      updates.push(`status = 'revoked'`);
      updates.push(`revoked_at = COALESCE(revoked_at, NOW())`);
      updates.push(`revoked_by = COALESCE(revoked_by, $${paramIndex++})`);
      params.push(req.user.id);
    } else if (shouldReactivate) {
      updates.push(`is_active = TRUE`);
      updates.push(`status = 'active'`);
      updates.push(`revoked_at = NULL`);
      updates.push(`revoked_by = NULL`);
    }
    
    if (extendHours) {
      updates.push(`expires_at = expires_at + interval '${parseInt(extendHours)} hours'`);
    }
    
    if (maxUses !== undefined) {
      updates.push(`max_uses = $${paramIndex++}`);
      params.push(maxUses);
    }
    
    if (label) {
      updates.push(`label = $${paramIndex++}`);
      params.push(label);
    }
    
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }
    
    const { rows: [link] } = await db.query(`
      UPDATE testing_access_links
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND COALESCE(market_scope, 'US') = $2 AND deleted_at IS NULL
      RETURNING *
    `, params);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Testing link not found' });
    }
    
    logger.info('Testing link updated', {
      linkId: id,
      updatedBy: req.user.id,
      action: shouldRevoke ? 'revoke' : (shouldReactivate ? 'reactivate' : 'update'),
    });
    
    res.json({ success: true, link: formatLink(req, link, marketScope) });
  } catch (error) {
    logger.error('Error updating testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update testing link' });
  }
});

/**
 * DELETE /api/testing-links/:id
 * Soft-delete a testing link. We keep the row for audit/history, but hide it
 * from default admin lists and make the token unusable.
 */
router.delete('/:id', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const { id } = req.params;
    const marketScope = getMarketScopeFromRequest(req, 'US');
    
    const { rows } = await db.query(
      `UPDATE testing_access_links
          SET is_active = FALSE,
              status = 'deleted',
              deleted_at = COALESCE(deleted_at, NOW()),
              deleted_by = COALESCE(deleted_by, $3),
              updated_at = NOW()
        WHERE id = $1
          AND COALESCE(market_scope, 'US') = $2
          AND deleted_at IS NULL
        RETURNING *`,
      [id, marketScope, req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Testing link not found' });
    }
    
    logger.info('Testing link soft-deleted', { linkId: id, deletedBy: req.user.id });
    
    res.json({ success: true, message: 'Testing link deleted', link: formatLink(req, rows[0], marketScope) });
  } catch (error) {
    logger.error('Error deleting testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to delete testing link' });
  }
});

/**
 * POST /api/testing-links/validate
 * Validate a testing token and get its details (public endpoint)
 */
router.post('/validate', async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }
    
    const { rows: [link] } = await db.query(`
      SELECT * FROM testing_access_links
      WHERE token = $1
    `, [token]);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Invalid or inactive link' });
    }

    if (link.deleted_at) {
      return res.status(410).json({
        success: false,
        error: 'This test access link has been deleted. Please contact the administrator.',
        status: 'deleted',
      });
    }

    if (link.revoked_at || link.is_active === false) {
      return res.status(410).json({
        success: false,
        error: 'This test access link has been revoked. Please contact the administrator.',
        status: 'revoked',
      });
    }
    
    // Check expiration
    if (new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Link has expired', status: 'expired' });
    }
    
    // Check usage limit
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return res.status(410).json({ success: false, error: 'Link usage limit reached', status: 'used' });
    }
    
    res.json({
      success: true,
      linkType: link.link_type,
      label: link.label,
      grantTier: link.grant_tier,
      marketScope: normalizeMarketScope(link.market_scope),
      bypassPayment: link.bypass_payment,
      bypassSubscription: link.bypass_subscription,
      expiresAt: link.expires_at,
      status: getLinkLifecycleStatus(link),
      remainingUses: link.max_uses ? link.max_uses - link.current_uses : null
    });
  } catch (error) {
    logger.error('Error validating testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to validate link' });
  }
});

/**
 * POST /api/testing-links/activate
 * Activate testing bypass for a user (called after login/register with test token)
 */
router.post('/activate', authenticate, async (req, res) => {
  try {
    await ensureTestingLinksLifecycleSchema();
    const { token } = req.body;
    const userId = req.user.id;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }
    
    const { rows: [link] } = await db.query(`
      SELECT * FROM testing_access_links
      WHERE token = $1
    `, [token]);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Invalid or inactive link' });
    }

    if (link.deleted_at) {
      return res.status(410).json({
        success: false,
        error: 'This test access link has been deleted. Please contact the administrator.',
        status: 'deleted',
      });
    }

    if (link.revoked_at || link.is_active === false) {
      return res.status(410).json({
        success: false,
        error: 'This test access link has been revoked. Please contact the administrator.',
        status: 'revoked',
      });
    }
    
    // Validate link
    if (new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Link has expired', status: 'expired' });
    }
    
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return res.status(410).json({ success: false, error: 'Link usage limit reached', status: 'used' });
    }
    
    // Check if user role matches link type
    if (req.user.role !== link.link_type) {
      return res.status(403).json({ 
        success: false, 
        error: `This link is for ${link.link_type}s only` 
      });
    }
    
    // Check if already activated for this user
    const { rows: [existingActivation] } = await db.query(`
      SELECT * FROM testing_link_activations
      WHERE link_id = $1 AND user_id = $2
    `, [link.id, userId]);
    
    if (existingActivation) {
      return res.json({
        success: true,
        message: 'Already activated',
        bypassExpiresAt: existingActivation.bypass_expires_at
      });
    }
    
    // Calculate bypass expiration (same as link expiration or 30 days, whichever is sooner)
    const bypassExpiresAt = new Date(Math.min(
      new Date(link.expires_at).getTime(),
      Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    ));
    
    // Create activation record
    await db.query(`
      INSERT INTO testing_link_activations (
        link_id, user_id, ip_address, user_agent, bypass_expires_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      link.id, userId,
      req.ip || req.headers['x-forwarded-for'],
      req.headers['user-agent'],
      bypassExpiresAt
    ]);
    
    // Update link usage count
    await db.query(`
      UPDATE testing_access_links
      SET current_uses = current_uses + 1,
          last_used_at = NOW(),
          last_used_by = $2,
          status = CASE
            WHEN max_uses IS NOT NULL AND current_uses + 1 >= max_uses THEN 'used'
            ELSE status
          END
      WHERE id = $1
    `, [link.id, userId]);
    
    // Update user's testing bypass flags
    await db.query(`
      UPDATE users
      SET testing_bypass_active = true,
          testing_bypass_expires_at = $2,
          testing_bypass_tier = $3,
          market_scope = $4,
          region = CASE WHEN $4 = 'NG' THEN 'NG'::region_code ELSE COALESCE(region, 'US'::region_code) END,
          country = CASE WHEN $4 = 'NG' THEN 'Nigeria' ELSE COALESCE(country, 'USA') END
      WHERE id = $1
    `, [userId, bypassExpiresAt, link.grant_tier, normalizeMarketScope(link.market_scope)]);
    
    logger.info('Testing link activated', {
      linkId: link.id,
      userId,
      grantTier: link.grant_tier,
      marketScope: normalizeMarketScope(link.market_scope),
      bypassExpiresAt
    });
    
    res.json({
      success: true,
      message: 'Testing access activated',
      grantTier: link.grant_tier,
      marketScope: normalizeMarketScope(link.market_scope),
      bypassPayment: link.bypass_payment,
      bypassSubscription: link.bypass_subscription,
      bypassExpiresAt
    });
  } catch (error) {
    logger.error('Error activating testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to activate testing link' });
  }
});

/**
 * GET /api/testing-links/my-status
 * Check if current user has active testing bypass
 */
router.get('/my-status', authenticate, async (req, res) => {
  try {
    const { rows: [user] } = await db.query(`
      SELECT testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier
      FROM users WHERE id = $1
    `, [req.user.id]);
    
    const isActive = user.testing_bypass_active && 
      user.testing_bypass_expires_at && 
      new Date(user.testing_bypass_expires_at) > new Date();
    
    res.json({
      success: true,
      testingBypassActive: isActive,
      tier: isActive ? user.testing_bypass_tier : null,
      expiresAt: isActive ? user.testing_bypass_expires_at : null
    });
  } catch (error) {
    logger.error('Error checking testing status', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to check testing status' });
  }
});

module.exports = router;
