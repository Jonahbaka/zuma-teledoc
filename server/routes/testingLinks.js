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

// Generate a secure random token
const generateToken = () => crypto.randomBytes(32).toString('hex');

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
    const { type, active_only } = req.query;
    
    let query = `
      SELECT 
        tl.*,
        u.email as created_by_email,
        u.first_name as created_by_first_name,
        u.last_name as created_by_last_name,
        (SELECT COUNT(*) FROM testing_link_activations WHERE link_id = tl.id) as activation_count
      FROM testing_access_links tl
      LEFT JOIN users u ON tl.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (type) {
      params.push(type);
      query += ` AND tl.link_type = $${params.length}`;
    }
    
    if (active_only === 'true') {
      query += ` AND tl.is_active = true AND tl.expires_at > NOW()`;
    }
    
    query += ` ORDER BY tl.created_at DESC`;
    
    const { rows } = await db.query(query, params);
    
    const baseUrl = getBaseUrl(req);
    res.json({
      success: true,
      links: rows.map(link => ({
        ...link,
        fullUrl: `${baseUrl}/access/${link.token}`,
        isExpired: new Date(link.expires_at) < new Date(),
        isExhausted: link.max_uses && link.current_uses >= link.max_uses
      }))
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
    
    if (!linkType || !['provider', 'patient'].includes(linkType)) {
      return res.status(400).json({ 
        success: false, 
        error: 'linkType must be "provider" or "patient"' 
      });
    }
    
    const token = generateToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    const { rows } = await db.query(`
      INSERT INTO testing_access_links (
        token, link_type, label, description,
        max_uses, expires_at, bypass_payment, bypass_subscription,
        grant_tier, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      token, linkType, label || `${linkType} test link`,
      description, maxUses, expiresAt,
      bypassPayment, bypassSubscription, grantTier, req.user.id
    ]);
    
    const link = rows[0];
    const baseUrl = getBaseUrl(req);
    
    logger.info('Testing link created', {
      linkId: link.id,
      linkType,
      createdBy: req.user.id,
      expiresAt
    });
    
    res.status(201).json({
      success: true,
      link: {
        ...link,
        fullUrl: `${baseUrl}/access/${token}`,
        loginUrl: `${baseUrl}/${linkType}/login?test_token=${token}`,
        registerUrl: `${baseUrl}/${linkType}/register?test_token=${token}`
      }
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
    const { id } = req.params;
    
    const { rows: [link] } = await db.query(`
      SELECT 
        tl.*,
        u.email as created_by_email
      FROM testing_access_links tl
      LEFT JOIN users u ON tl.created_by = u.id
      WHERE tl.id = $1
    `, [id]);
    
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
    
    const baseUrl = getBaseUrl(req);
    
    res.json({
      success: true,
      link: {
        ...link,
        fullUrl: `${baseUrl}/access/${link.token}`,
        loginUrl: `${baseUrl}/${link.link_type}/login?test_token=${link.token}`,
        registerUrl: `${baseUrl}/${link.link_type}/register?test_token=${link.token}`,
        isExpired: new Date(link.expires_at) < new Date(),
        isExhausted: link.max_uses && link.current_uses >= link.max_uses
      },
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
    const { id } = req.params;
    const { isActive, extendHours, maxUses, label, description } = req.body;
    
    const updates = [];
    const params = [id];
    let paramIndex = 2;
    
    if (typeof isActive === 'boolean') {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(isActive);
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
      WHERE id = $1
      RETURNING *
    `, params);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Testing link not found' });
    }
    
    logger.info('Testing link updated', { linkId: id, updatedBy: req.user.id });
    
    res.json({ success: true, link });
  } catch (error) {
    logger.error('Error updating testing link', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update testing link' });
  }
});

/**
 * DELETE /api/testing-links/:id
 * Delete a testing link
 */
router.delete('/:id', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rowCount } = await db.query(
      'DELETE FROM testing_access_links WHERE id = $1',
      [id]
    );
    
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Testing link not found' });
    }
    
    logger.info('Testing link deleted', { linkId: id, deletedBy: req.user.id });
    
    res.json({ success: true, message: 'Testing link deleted' });
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
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }
    
    const { rows: [link] } = await db.query(`
      SELECT * FROM testing_access_links
      WHERE token = $1 AND is_active = true
    `, [token]);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Invalid or inactive link' });
    }
    
    // Check expiration
    if (new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Link has expired' });
    }
    
    // Check usage limit
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return res.status(410).json({ success: false, error: 'Link usage limit reached' });
    }
    
    res.json({
      success: true,
      linkType: link.link_type,
      label: link.label,
      grantTier: link.grant_tier,
      bypassPayment: link.bypass_payment,
      bypassSubscription: link.bypass_subscription,
      expiresAt: link.expires_at,
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
    const { token } = req.body;
    const userId = req.user.id;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }
    
    const { rows: [link] } = await db.query(`
      SELECT * FROM testing_access_links
      WHERE token = $1 AND is_active = true
    `, [token]);
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Invalid or inactive link' });
    }
    
    // Validate link
    if (new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Link has expired' });
    }
    
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return res.status(410).json({ success: false, error: 'Link usage limit reached' });
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
          last_used_by = $2
      WHERE id = $1
    `, [link.id, userId]);
    
    // Update user's testing bypass flags
    await db.query(`
      UPDATE users
      SET testing_bypass_active = true,
          testing_bypass_expires_at = $2,
          testing_bypass_tier = $3
      WHERE id = $1
    `, [userId, bypassExpiresAt, link.grant_tier]);
    
    logger.info('Testing link activated', {
      linkId: link.id,
      userId,
      grantTier: link.grant_tier,
      bypassExpiresAt
    });
    
    res.json({
      success: true,
      message: 'Testing access activated',
      grantTier: link.grant_tier,
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
