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
const { sendEmail, generateEmailTemplate } = require('../services/email');
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

      // Send invitation email with elegant template
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
      const inviteLink = `${baseUrl}/${type}/register?token=${token}`;
      const inviterName = `${req.user.firstName} ${req.user.lastName}`;
      const roleName = type === 'admin' ? 'Administrator' : 'Healthcare Provider';

      const features = type === 'provider' ? [
        { icon: '📹', text: 'HD Video consultations with patients' },
        { icon: '📋', text: 'AI-powered clinical documentation' },
        { icon: '💊', text: 'Electronic prescribing (eRx)' },
        { icon: '💳', text: 'Integrated billing and claims' },
        { icon: '📊', text: 'Practice analytics dashboard' }
      ] : [
        { icon: '👥', text: 'User and provider management' },
        { icon: '📈', text: 'Platform analytics and insights' },
        { icon: '🔐', text: 'Role-based access control' },
        { icon: '📝', text: 'Audit logs and compliance tools' }
      ];

      const featuresHtml = features.map(f => `<li style="margin-bottom: 8px;">${f.icon} ${f.text}</li>`).join('');

      const inviteBodyContent = `
        <p style="margin: 0 0 24px 0; font-size: 18px;">
          Hello <strong>${firstName || 'there'}</strong>,
        </p>
        
        <p style="margin: 0 0 24px 0;">
          <strong>${inviterName}</strong> has invited you to join <strong style="color: #7c3aed;">DoctaRx</strong> as a <strong>${roleName}</strong>!
        </p>
        
        ${personalMessage ? `
        <div style="background: #f3e8ff; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #7c3aed;">
          <p style="margin: 0; font-style: italic; color: #6b21a8;">
            "${personalMessage}"
          </p>
          <p style="margin: 8px 0 0 0; font-size: 13px; color: #9333ea;">— ${inviterName}</p>
        </div>
        ` : ''}
        
        <div style="background: linear-gradient(135deg, #10b98110 0%, #7c3aed10 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 0 0 16px 0; font-weight: 600; color: #1e1b4b; font-size: 17px;">
            🏥 As a DoctaRx ${roleName}, you'll have access to:
          </p>
          <ul style="margin: 0; padding-left: 20px; color: #334155;">
            ${featuresHtml}
          </ul>
        </div>
        
        <p style="margin: 24px 0; font-size: 14px; color: #64748b;">
          This invitation expires on <strong>${expiresAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
        </p>
      `;

      const inviteHtml = generateEmailTemplate({
        preheader: `${inviterName} has invited you to join DoctaRx as a ${roleName}`,
        headerIcon: type === 'provider' ? '🩺' : '🛡️',
        headerTitle: "You're Invited!",
        headerSubtitle: `Join DoctaRx as a ${roleName}`,
        headerColor: '#10b981',
        headerColorEnd: '#7c3aed',
        bodyContent: inviteBodyContent,
        ctaButton: {
          text: 'Accept Invitation →',
          url: inviteLink,
          color: '#10b981',
          colorEnd: '#059669'
        },
        footerNote: "If you didn't expect this invitation, you can safely ignore this email.",
        recipientEmail: email
      });

      await sendEmail({
        to: email,
        subject: `🎉 You're Invited to Join DoctaRx as a ${roleName}!`,
        html: inviteHtml
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

      // Resend email with elegant template
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
      const inviteLink = `${baseUrl}/${invite.role}/register?token=${invite.token}`;
      const roleName = invite.role === 'admin' ? 'Administrator' : 'Healthcare Provider';

      const reminderBodyContent = `
        <p style="margin: 0 0 24px 0; font-size: 18px;">
          Hello <strong>${invite.firstName || 'there'}</strong>,
        </p>
        
        <p style="margin: 0 0 24px 0;">
          This is a friendly reminder that you've been invited to join <strong style="color: #7c3aed;">DoctaRx</strong> as a <strong>${roleName}</strong>.
        </p>
        
        <div style="background: #fef3c7; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            ⏰ <strong>Don't miss out!</strong> Your invitation has been extended and will now expire on <strong>${newExpiresAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
          </p>
        </div>
        
        <p style="margin: 24px 0;">
          Click the button below to complete your registration and join our platform.
        </p>
      `;

      const reminderHtml = generateEmailTemplate({
        preheader: `Reminder: Your invitation to join DoctaRx is waiting!`,
        headerIcon: '⏰',
        headerTitle: 'Invitation Reminder',
        headerSubtitle: `Your ${roleName} spot is waiting`,
        headerColor: '#f59e0b',
        headerColorEnd: '#d97706',
        bodyContent: reminderBodyContent,
        ctaButton: {
          text: 'Accept Invitation →',
          url: inviteLink,
          color: '#10b981',
          colorEnd: '#059669'
        },
        recipientEmail: invite.email
      });

      await sendEmail({
        to: invite.email,
        subject: `⏰ Reminder: Your DoctaRx Invitation is Waiting!`,
        html: reminderHtml
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

