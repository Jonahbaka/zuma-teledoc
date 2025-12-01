/**
 * User Routes
 * User profile management
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { validate, updateProfileSchema } = require('../../lib/validation');
const { keysToCamel } = require('../../lib/utils');

const router = express.Router();

/**
 * GET /api/users/profile
 * Get current user profile
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.role, u.first_name, u.last_name,
              u.date_of_birth, u.phone, u.address_line1, u.address_line2,
              u.city, u.state, u.zip_code, u.country,
              u.is_verified, u.provider_status,
              u.license_number, u.license_state, u.license_expiry,
              u.specialty, u.npi_number, u.credentials, u.bio,
              u.created_at, u.updated_at
       FROM users u WHERE u.id = $1`,
      [req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      profile: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Get profile error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get profile'
    });
  }
});

/**
 * PUT /api/users/profile
 * Update current user profile
 */
router.put('/profile', 
  authenticate,
  auditMiddleware('update', 'user', { logChanges: true }),
  async (req, res) => {
    try {
      const data = validate(updateProfileSchema, req.body);
      
      // Build update query dynamically
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      const fieldMapping = {
        firstName: 'first_name',
        lastName: 'last_name',
        phone: 'phone',
        dateOfBirth: 'date_of_birth',
        addressLine1: 'address_line1',
        addressLine2: 'address_line2',
        city: 'city',
        state: 'state',
        zipCode: 'zip_code',
        bio: 'bio',
        specialty: 'specialty'
      };
      
      for (const [key, dbField] of Object.entries(fieldMapping)) {
        if (data[key] !== undefined) {
          updates.push(`${dbField} = $${paramIndex}`);
          values.push(data[key]);
          paramIndex++;
        }
      }
      
      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }
      
      values.push(req.user.id);
      
      const { rows } = await db.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, email, role, first_name, last_name, phone,
                   address_line1, address_line2, city, state, zip_code`,
        values
      );
      
      logger.info('Profile updated', { userId: req.user.id });
      
      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      
      logger.error('Update profile error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }
);

/**
 * GET /api/users/:id
 * Get user by ID (admin or self only)
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check permissions
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    const { rows } = await db.query(
      `SELECT id, email, role, first_name, last_name,
              date_of_birth, phone, city, state,
              is_active, is_verified, provider_status,
              specialty, credentials, bio, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Get user error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get user'
    });
  }
});

/**
 * DELETE /api/users/account
 * Delete own account (deactivate)
 */
router.delete('/account', authenticate, async (req, res) => {
  try {
    // Deactivate account instead of hard delete (HIPAA compliance)
    await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );
    
    // Revoke all tokens
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );
    
    logger.info('Account deactivated', { userId: req.user.id });
    
    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });
  } catch (error) {
    logger.error('Delete account error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate account'
    });
  }
});

module.exports = router;

