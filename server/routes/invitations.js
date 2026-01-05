/**
 * Invitation Routes
 * Handles provider and admin invitations
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const logger = require('../middleware/logger');
const { sendEmail } = require('../services/email');
const { keysToCamel, keysToSnake } = require('../../lib/utils');

/**
 * POST /api/invitations
 * Create and send a new invitation
 */
router.post('/',
  authenticate,
  requireRole(['admin', 'super_admin']),
  auditMiddleware('create', 'invitation'),
  async (req, res) => {
    try {
      const {
        email,
        firstName,
        lastName,
        type, // 'provider' or 'admin'
        specialty,
        personalMessage,
        expiresInDays = 7
      } = req.body;

      if (!email || !type) {
        return res.status(400).json({
          success: false,
          error: 'Email and type are required'
        });
      }

      // Only super_admin can create admin invites
      if (type === 'admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: 'Only Super Admins can invite administrators'
        });
      }

      // Check if invite already exists for this email/role
      const existingInvite = await db.query(
        `SELECT id FROM invitations 
         WHERE email = $1 AND role = $2 AND status = 'pending'`,
        [email.toLowerCase(), type]
      );

      if (existingInvite.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'An active invitation already exists for this email'
        });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      // Create invitation
      const { rows } = await db.query(
        `INSERT INTO invitations (
          email, first_name, last_name, role, specialty,
          token, status, invited_by_user_id, organization_name, personal_message, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
        RETURNING *`,
        [
          email.toLowerCase(),
          firstName,
          lastName,
          type,
          specialty,
          token,
          req.user.id,
          'Docta Healthcare',
          personalMessage,
          expiresAt
        ]
      );

      const invitation = keysToCamel(rows[0]);

      // Send invitation email
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
      const inviteLink = `${baseUrl}/${type}/register?token=${token}`;

      await sendEmail({
        to: email,
        subject: `You're invited to join Docta as a ${type === 'admin' ? 'Administrator' : 'Healthcare Provider'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Docta Healthcare</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <h2>Hello ${firstName || 'there'},</h2>
              <p>You've been invited to join Docta as a ${type === 'admin' ? 'Administrator' : 'Healthcare Provider'}.</p>
              ${personalMessage ? `<p style="background: #e5e7eb; padding: 15px; border-radius: 8px; font-style: italic;">"${personalMessage}"</p>` : ''}
              <p>Click the button below to complete your registration:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${inviteLink}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">This invitation expires on ${expiresAt.toLocaleDateString()}.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #9ca3af; font-size: 12px;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </div>
          </div>
        `
      });

      logger.info('Invitation sent', {
        inviteId: invitation.id,
        email,
        type,
        invitedBy: req.user.id
      });

      res.status(201).json({
        success: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt
        }
      });
    } catch (error) {
      logger.error('Create invitation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create invitation'
      });
    }
  }
);

/**
 * GET /api/invitations
 * Get all invitations (admin only)
 */
router.get('/',
  authenticate,
  requireRole(['admin', 'super_admin']),
  async (req, res) => {
    try {
      const { status, type, limit = 50, offset = 0 } = req.query;

      let query = `
        SELECT i.*, 
               u.first_name as invited_by_first_name,
               u.last_name as invited_by_last_name
        FROM invitations i
        LEFT JOIN users u ON u.id = i.invited_by_user_id
        WHERE 1=1
      `;
      const params = [];

      if (status) {
        params.push(status);
        query += ` AND i.status = $${params.length}`;
      }

      if (type) {
        params.push(type);
        query += ` AND i.role = $${params.length}`;
      }

      params.push(parseInt(limit), parseInt(offset));
      query += ` ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

      const { rows } = await db.query(query, params);

      // Update expired invitations
      await db.query(
        `UPDATE invitations SET status = 'expired' 
         WHERE status = 'pending' AND expires_at < NOW()`
      );

      res.json({
        success: true,
        invites: rows.map(row => ({
          ...keysToCamel(row),
          invitedByName: row.invited_by_first_name 
            ? `${row.invited_by_first_name} ${row.invited_by_last_name}`
            : 'System'
        }))
      });
    } catch (error) {
      logger.error('Get invitations error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get invitations'
      });
    }
  }
);

/**
 * GET /api/invitations/validate/:token
 * Validate an invitation token (public)
 */
router.get('/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { rows } = await db.query(
      `SELECT i.*, 
              u.first_name as invited_by_first_name,
              u.last_name as invited_by_last_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by_user_id
       WHERE i.token = $1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid invitation token'
      });
    }

    const invite = keysToCamel(rows[0]);

    // Check if expired
    if (new Date(invite.expiresAt) < new Date()) {
      await db.query(
        `UPDATE invitations SET status = 'expired' WHERE id = $1`,
        [invite.id]
      );
      return res.status(400).json({
        success: false,
        error: 'This invitation has expired'
      });
    }

    // Check if already used
    if (invite.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `This invitation has already been ${invite.status}`
      });
    }

    res.json({
      success: true,
      invite: {
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        role: invite.role,
        specialty: invite.specialty,
        organizationName: invite.organizationName,
        invitedByName: rows[0].invited_by_first_name 
          ? `${rows[0].invited_by_first_name} ${rows[0].invited_by_last_name}`
          : 'System',
        expiresAt: invite.expiresAt
      }
    });
  } catch (error) {
    logger.error('Validate invitation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate invitation'
    });
  }
});

/**
 * POST /api/invitations/:id/resend
 * Resend an invitation
 */
router.post('/:id/resend',
  authenticate,
  requireRole(['admin', 'super_admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get invitation
      const { rows } = await db.query(
        `SELECT * FROM invitations WHERE id = $1`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invitation not found'
        });
      }

      const invite = keysToCamel(rows[0]);

      if (invite.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: `Cannot resend ${invite.status} invitation`
        });
      }

      // Extend expiration
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      await db.query(
        `UPDATE invitations SET expires_at = $1, updated_at = NOW() WHERE id = $2`,
        [newExpiresAt, id]
      );

      // Resend email
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
      const inviteLink = `${baseUrl}/${invite.role}/register?token=${invite.token}`;

      await sendEmail({
        to: invite.email,
        subject: `Reminder: You're invited to join Docta`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Docta Healthcare</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <h2>Hello ${invite.firstName || 'there'},</h2>
              <p>This is a reminder that you've been invited to join Docta.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${inviteLink}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">This invitation expires on ${newExpiresAt.toLocaleDateString()}.</p>
            </div>
          </div>
        `
      });

      logger.info('Invitation resent', { inviteId: id });

      res.json({
        success: true,
        message: 'Invitation resent successfully'
      });
    } catch (error) {
      logger.error('Resend invitation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resend invitation'
      });
    }
  }
);

/**
 * DELETE /api/invitations/:id
 * Revoke an invitation
 */
router.delete('/:id',
  authenticate,
  requireRole(['admin', 'super_admin']),
  auditMiddleware('delete', 'invitation'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const { rows } = await db.query(
        `UPDATE invitations SET status = 'revoked', updated_at = NOW() 
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invitation not found or already processed'
        });
      }

      logger.info('Invitation revoked', { inviteId: id, revokedBy: req.user.id });

      res.json({
        success: true,
        message: 'Invitation revoked'
      });
    } catch (error) {
      logger.error('Revoke invitation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke invitation'
      });
    }
  }
);

/**
 * POST /api/invitations/accept
 * Accept invitation and create account (public)
 */
router.post('/accept', async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    const {
      token,
      firstName,
      lastName,
      password,
      phone,
      specialty,
      npiNumber,
      medicalLicense
    } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required'
      });
    }

    await client.query('BEGIN');

    // Get and validate invitation
    const { rows: inviteRows } = await client.query(
      `SELECT * FROM invitations WHERE token = $1 FOR UPDATE`,
      [token]
    );

    if (inviteRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Invalid invitation token'
      });
    }

    const invite = keysToCamel(inviteRows[0]);

    if (invite.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `This invitation has already been ${invite.status}`
      });
    }

    if (new Date(invite.expiresAt) < new Date()) {
      await client.query(
        `UPDATE invitations SET status = 'expired' WHERE id = $1`,
        [invite.id]
      );
      await client.query('COMMIT');
      return res.status(400).json({
        success: false,
        error: 'This invitation has expired'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const { rows: userRows } = await client.query(
      `INSERT INTO users (
        email, password_hash, first_name, last_name, role, phone,
        email_verified, is_active, provider_status
      ) VALUES ($1, $2, $3, $4, $5, $6, true, true, $7)
      RETURNING id, email, first_name, last_name, role`,
      [
        invite.email,
        passwordHash,
        firstName || invite.firstName,
        lastName || invite.lastName,
        invite.role,
        phone,
        invite.role === 'provider' ? 'approved' : null
      ]
    );

    const user = keysToCamel(userRows[0]);

    // If provider, create provider profile
    if (invite.role === 'provider') {
      await client.query(
        `INSERT INTO provider_profiles (
          user_id, specialty, npi_number, license_number
        ) VALUES ($1, $2, $3, $4)`,
        [user.id, specialty || invite.specialty, npiNumber, medicalLicense]
      );
    }

    // Mark invitation as accepted
    await client.query(
      `UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [invite.id]
    );

    await client.query('COMMIT');

    logger.info('Invitation accepted', {
      inviteId: invite.id,
      userId: user.id,
      role: invite.role
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Accept invitation error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  } finally {
    client.release();
  }
});

module.exports = router;

