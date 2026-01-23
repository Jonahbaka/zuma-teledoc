/**
 * Authentication Routes
 * Handles user registration, login, logout, and MFA
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireMfa } = require('../middleware/auth');
const { auditLogin, auditLogout, logAuditEvent } = require('../middleware/audit');
const { hash, generateToken } = require('../../lib/encryption');
const {
  validate,
  registerSchema,
  loginSchema,
  setupMfaSchema,
  verifyMfaSchema,
  disableMfaSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  changePasswordSchema
} = require('../../lib/validation');

const crypto = require('crypto');
const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Generate fallback secrets if not provided (for development/initial deployment)
// WARNING: In production, always set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET env vars
const generateFallbackSecret = () => crypto.randomBytes(64).toString('hex');

// Use global storage to ensure same secret is used across all modules
let ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
let REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_TOKEN_SECRET) {
  // Store in global so auth middleware can use the same secret
  ACCESS_TOKEN_SECRET = global.__JWT_ACCESS_SECRET || (global.__JWT_ACCESS_SECRET = generateFallbackSecret());
  console.warn('WARNING: JWT_ACCESS_SECRET not set, using generated fallback. Set this in production!');
}
if (!REFRESH_TOKEN_SECRET) {
  REFRESH_TOKEN_SECRET = global.__JWT_REFRESH_SECRET || (global.__JWT_REFRESH_SECRET = generateFallbackSecret());
  console.warn('WARNING: JWT_REFRESH_SECRET not set, using generated fallback. Set this in production!');
}

const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

/**
 * Generate access and refresh tokens
 */
const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
  
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );
  
  return { accessToken, refreshToken };
};

/**
 * Set auth cookies
 */
const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN || (isProd ? '.doctarx.com' : undefined);
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    // IMPORTANT: must allow Stripe -> return redirect back to our site to still include cookies
    // 'strict' can break auth continuity after external redirects.
    sameSite: isProd ? 'lax' : 'strict',
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {})
  };
  
  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000 // 15 minutes
  });
  
  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

/**
 * Clear auth cookies
 */
const clearAuthCookies = (res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN || (isProd ? '.doctarx.com' : undefined);
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'lax' : 'strict',
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {})
  };
  
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);
  res.clearCookie('mfaVerified', cookieOptions);
};

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
  try {
    const data = validate(registerSchema, req.body);
    
    // Check if email already exists for this role
    const { rows: existingUsers } = await db.query(
      'SELECT id FROM users WHERE email = $1 AND role = $2',
      [data.email, data.role]
    );
    
    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists for this role'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    
    // Determine provider status
    const providerStatus = data.role === 'provider' ? 'pending' : null;
    
    // Create user
    const { rows } = await db.query(
      `INSERT INTO users (
        email, password_hash, role, first_name, last_name,
        date_of_birth, phone, license_number, license_state,
        specialty, npi_number, credentials, provider_status,
        hipaa_consent_at, terms_accepted_at, is_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, email, role, first_name, last_name`,
      [
        data.email,
        passwordHash,
        data.role,
        data.firstName,
        data.lastName,
        data.dateOfBirth || null,
        data.phone || null,
        data.licenseNumber || null,
        data.licenseState || null,
        data.specialty || null,
        data.npiNumber || null,
        data.credentials || null,
        providerStatus,
        data.hipaaConsent ? new Date() : null,
        data.termsAccepted ? new Date() : null,
        false // Don't auto-verify - require email verification
      ]
    );
    
    const user = rows[0];
    
    // Create subscription record (free tier by default)
    await db.query(
      `INSERT INTO subscriptions (user_id, tier, status) VALUES ($1, 'free', 'active')`,
      [user.id]
    );
    
    // Generate email verification token
    const verificationToken = generateToken(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiration
    
    await db.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, hash(verificationToken), expiresAt]
    );
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    
    // Store refresh token hash
    const tokenHash = hash(refreshToken);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, ip_address, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
      [user.id, tokenHash, req.ip]
    );
    
    // Set cookies
    setAuthCookies(res, accessToken, refreshToken);
    
    // Audit log
    await auditLogin(req, true, user.id);
    
    // Send verification email, welcome email, and create in-app notification
    try {
      const emailService = require('../services/email');
      const notificationService = require('../services/notifications');
      
      // Send verification email
      await emailService.sendVerificationEmail({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }, verificationToken);
      
      // Send welcome email
      await emailService.sendWelcomeEmail({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      });
      
      // Create in-app welcome notification
      await notificationService.sendWelcomeNotification({
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      });
    } catch (emailError) {
      logger.error('Failed to send verification/welcome notifications', { 
        error: emailError.message, 
        userId: user.id 
      });
      // Don't fail registration if email/notification fails
    }
    
    logger.info('User registered', { userId: user.id, role: user.role });
    
    res.status(201).json({
      success: true,
      message: data.role === 'provider' 
        ? 'Registration successful. Your account is pending approval.'
        : 'Registration successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: error.errors
      });
    }
    
    logger.error('Registration error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', async (req, res) => {
  try {
    const data = validate(loginSchema, req.body);
    
    // Get user(s) by email, optionally narrowed by role (to support same email across roles)
    const params = [data.email];
    let whereClause = 'WHERE email = $1';
    if (data.role) {
      // When 'admin' role is specified, also match 'super_admin' for admin portal access
      if (data.role === 'admin') {
        whereClause += " AND role IN ('admin', 'super_admin')";
      } else {
        params.push(data.role);
        whereClause += ' AND role = $2';
      }
    }

    const { rows } = await db.query(
      `SELECT id, email, password_hash, role, first_name, last_name,
              is_active, mfa_enabled, mfa_secret, failed_login_attempts,
              locked_until, provider_status
       FROM users ${whereClause}`,
      params
    );
    
    if (rows.length === 0) {
      await auditLogin(req, false, null, 'User not found');
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // If multiple accounts share the same email and no role was provided, require role selection
    if (rows.length > 1 && !data.role) {
      const availableRoles = [...new Set(rows.map(r => r.role))];
      await auditLogin(req, false, null, 'Multiple accounts for email - role required');
      return res.status(409).json({
        success: false,
        error: 'Multiple accounts exist for this email. Please select an account type (role) and try again.',
        availableRoles
      });
    }
    
    const user = rows[0];
    
    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await auditLogin(req, false, user.id, 'Account locked');
      return res.status(423).json({
        success: false,
        error: 'Account is temporarily locked. Please try again later.'
      });
    }
    
    // Check if account is active
    if (!user.is_active) {
      await auditLogin(req, false, user.id, 'Account inactive');
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated. Please contact support.'
      });
    }
    
    // Check provider status
    if (user.role === 'provider' && user.provider_status === 'pending') {
      await auditLogin(req, false, user.id, 'Provider pending approval');
      return res.status(403).json({
        success: false,
        error: 'Your provider account is pending approval.'
      });
    }
    
    if (user.role === 'provider' && user.provider_status === 'rejected') {
      await auditLogin(req, false, user.id, 'Provider rejected');
      return res.status(403).json({
        success: false,
        error: 'Your provider application was not approved.'
      });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(data.password, user.password_hash);
    
    if (!validPassword) {
      // Increment failed attempts
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;
      const lockAccount = newFailedAttempts >= 5;
      
      await db.query(
        `UPDATE users SET 
          failed_login_attempts = $1,
          locked_until = $2
         WHERE id = $3`,
        [
          newFailedAttempts,
          lockAccount ? new Date(Date.now() + 30 * 60 * 1000) : null, // 30 min lock
          user.id
        ]
      );
      
      await auditLogin(req, false, user.id, 'Invalid password');
      
      return res.status(401).json({
        success: false,
        error: lockAccount 
          ? 'Too many failed attempts. Account locked for 30 minutes.'
          : 'Invalid email or password'
      });
    }
    
    // Check MFA if enabled
    if (user.mfa_enabled) {
      if (!data.mfaCode) {
        return res.status(200).json({
          success: true,
          mfaRequired: true,
          message: 'MFA code required'
        });
      }
      
      // Verify MFA code
      const verified = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: data.mfaCode,
        window: parseInt(process.env.MFA_WINDOW) || 1
      });
      
      if (!verified) {
        await auditLogin(req, false, user.id, 'Invalid MFA code');
        return res.status(401).json({
          success: false,
          error: 'Invalid MFA code'
        });
      }
    }
    
    // Reset failed attempts and update last login
    await db.query(
      `UPDATE users SET 
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NOW()
       WHERE id = $1`,
      [user.id]
    );
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    
    // Store refresh token
    const tokenHash = hash(refreshToken);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, ip_address, device_info, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
      [user.id, tokenHash, req.ip, req.get('user-agent')]
    );
    
    // Set cookies
    setAuthCookies(res, accessToken, refreshToken);
    
    // Set MFA verified cookie if MFA was passed
    if (user.mfa_enabled) {
      const isProd = process.env.NODE_ENV === 'production';
      const cookieDomain = process.env.COOKIE_DOMAIN || (isProd ? '.doctarx.com' : undefined);
      res.cookie('mfaVerified', 'true', {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'lax' : 'strict',
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        maxAge: 15 * 60 * 1000 // 15 minutes
      });
    }
    
    // Audit log
    await auditLogin(req, true, user.id);
    
    logger.info('User logged in', { userId: user.id });
    
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        mfaEnabled: user.mfa_enabled
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: error.errors
      });
    }
    
    logger.error('Login error', { error: error.message, stack: error.stack });
    
    // Check for JWT secret configuration error
    if (error.message && error.message.includes('secretOrPrivateKey')) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: JWT secrets not configured'
      });
    }
    
    // Check for database errors
    if (error.code && error.code.startsWith('23')) { // PostgreSQL constraint errors
      return res.status(500).json({
        success: false,
        error: 'Database constraint error',
        detail: error.detail || error.message
      });
    }
    
    if (error.code === '42P01') { // Table doesn't exist
      return res.status(500).json({
        success: false,
        error: 'Database table missing - migrations may need to run',
        detail: error.message
      });
    }
    
    // Return error details for debugging
    res.status(500).json({
      success: false,
      error: 'Login failed',
      errorType: error.name || 'Unknown',
      errorCode: error.code || 'none',
      errorMessage: error.message
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
  try {
    // Get refresh token from cookie or body
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token type'
      });
    }
    
    // Check if token exists in database and not revoked
    const tokenHash = hash(refreshToken);
    const { rows: tokens } = await db.query(
      `SELECT id, user_id FROM refresh_tokens 
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    
    if (tokens.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }
    
    // Get user
    const { rows: users } = await db.query(
      `SELECT id, email, role, first_name, last_name, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );
    
    if (users.length === 0 || !users[0].is_active) {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive'
      });
    }
    
    const user = users[0];
    
    // Revoke old refresh token
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [tokens[0].id]
    );
    
    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role);
    
    // Store new refresh token
    const newTokenHash = hash(newRefreshToken);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, ip_address, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
      [user.id, newTokenHash, req.ip]
    );
    
    // Set cookies
    setAuthCookies(res, accessToken, newRefreshToken);
    
    res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }
    
    logger.error('Token refresh error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Get refresh token
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (refreshToken) {
      // Revoke refresh token
      const tokenHash = hash(refreshToken);
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash]
      );
    }
    
    // Clear cookies
    clearAuthCookies(res);
    
    // Audit log
    await auditLogout(req);
    
    logger.info('User logged out', { userId: req.user.id });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.role, u.first_name, u.last_name,
              u.date_of_birth, u.phone, u.address_line1, u.address_line2,
              u.city, u.state, u.zip_code, u.country,
              u.mfa_enabled, u.is_verified, u.provider_status,
              u.license_number, u.license_state, u.specialty,
              u.credentials, u.bio, u.created_at,
              s.tier as subscription_tier, s.status as subscription_status
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = rows[0];
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        dateOfBirth: user.date_of_birth,
        phone: user.phone,
        address: {
          line1: user.address_line1,
          line2: user.address_line2,
          city: user.city,
          state: user.state,
          zipCode: user.zip_code,
          country: user.country
        },
        mfaEnabled: user.mfa_enabled,
        isVerified: user.is_verified,
        providerStatus: user.provider_status,
        providerInfo: user.role === 'provider' ? {
          licenseNumber: user.license_number,
          licenseState: user.license_state,
          specialty: user.specialty,
          credentials: user.credentials,
          bio: user.bio
        } : null,
        subscription: {
          tier: user.subscription_tier,
          status: user.subscription_status
        },
        createdAt: user.created_at
      }
    });
  } catch (error) {
    logger.error('Get current user error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get user info'
    });
  }
});

/**
 * POST /api/auth/mfa/setup
 * Setup MFA for user
 */
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const data = validate(setupMfaSchema, req.body);
    
    // Verify password
    const { rows } = await db.query(
      'SELECT password_hash, mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (rows[0].mfa_enabled) {
      return res.status(400).json({
        success: false,
        error: 'MFA is already enabled'
      });
    }
    
    const validPassword = await bcrypt.compare(data.password, rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password'
      });
    }
    
    // Generate MFA secret
    const secret = speakeasy.generateSecret({
      name: `${process.env.MFA_ISSUER || 'Docta.'}:${req.user.email}`,
      issuer: process.env.MFA_ISSUER || 'Docta.'
    });
    
    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    
    // Store secret temporarily (will be confirmed after verification)
    await db.query(
      'UPDATE users SET mfa_secret = $1 WHERE id = $2',
      [secret.base32, req.user.id]
    );
    
    // Audit MFA setup initiation
    await logAuditEvent({
      userId: req.user.id,
      action: 'setup_mfa',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      description: 'MFA setup initiated',
      success: true
    });
    
    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (error) {
    logger.error('MFA setup error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'MFA setup failed'
    });
  }
});

/**
 * POST /api/auth/mfa/verify
 * Verify and enable MFA
 */
router.post('/mfa/verify', authenticate, async (req, res) => {
  try {
    const data = validate(verifyMfaSchema, req.body);
    
    // Get MFA secret
    const { rows } = await db.query(
      'SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (!rows[0].mfa_secret) {
      return res.status(400).json({
        success: false,
        error: 'MFA setup not initiated'
      });
    }
    
    // Verify code
    const verified = speakeasy.totp.verify({
      secret: rows[0].mfa_secret,
      encoding: 'base32',
      token: data.code,
      window: 1
    });
    
    if (!verified) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code'
      });
    }
    
    // Generate backup codes
    const backupCodes = Array.from({ length: 10 }, () => generateToken(4).toUpperCase());
    
    // Enable MFA
    await db.query(
      `UPDATE users SET mfa_enabled = true, mfa_backup_codes = $1 WHERE id = $2`,
      [backupCodes, req.user.id]
    );
    
    // Audit MFA enable
    await logAuditEvent({
      userId: req.user.id,
      action: 'enable_mfa',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      description: 'MFA enabled successfully',
      newValues: { mfaEnabled: true },
      success: true
    });
    
    logger.info('MFA enabled', { userId: req.user.id, ipAddress: req.ip });
    
    res.json({
      success: true,
      message: 'MFA enabled successfully',
      backupCodes
    });
  } catch (error) {
    logger.error('MFA verify error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'MFA verification failed'
    });
  }
});

/**
 * POST /api/auth/mfa/disable
 * Disable MFA
 */
router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    const data = validate(disableMfaSchema, req.body);
    
    // Get user
    const { rows } = await db.query(
      'SELECT password_hash, mfa_secret, mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (!rows[0].mfa_enabled) {
      return res.status(400).json({
        success: false,
        error: 'MFA is not enabled'
      });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(data.password, rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password'
      });
    }
    
    // Verify MFA code
    const verified = speakeasy.totp.verify({
      secret: rows[0].mfa_secret,
      encoding: 'base32',
      token: data.code,
      window: 1
    });
    
    if (!verified) {
      return res.status(400).json({
        success: false,
        error: 'Invalid MFA code'
      });
    }
    
    // Disable MFA
    await db.query(
      `UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1`,
      [req.user.id]
    );
    
    // Audit MFA disable
    await logAuditEvent({
      userId: req.user.id,
      action: 'disable_mfa',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      description: 'MFA disabled',
      oldValues: { mfaEnabled: true },
      newValues: { mfaEnabled: false },
      success: true
    });
    
    logger.info('MFA disabled', { userId: req.user.id, ipAddress: req.ip });
    
    res.json({
      success: true,
      message: 'MFA disabled successfully'
    });
  } catch (error) {
    logger.error('MFA disable error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to disable MFA'
    });
  }
});

/**
 * POST /api/auth/password/change
 * Change password
 */
router.post('/password/change', authenticate, async (req, res) => {
  try {
    const data = validate(changePasswordSchema, req.body);
    
    // Get user
    const { rows } = await db.query(
      'SELECT password_hash, email, role FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Verify current password
    const validPassword = await bcrypt.compare(data.currentPassword, rows[0].password_hash);
    if (!validPassword) {
      // Audit failed password change attempt
      await logAuditEvent({
        userId: req.user.id,
        action: 'change_password',
        resourceType: 'user',
        resourceId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        description: 'Failed password change attempt - incorrect current password',
        success: false,
        errorMessage: 'Current password is incorrect'
      });
      
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }
    
    // Check if new password is same as current
    const samePassword = await bcrypt.compare(data.newPassword, rows[0].password_hash);
    if (samePassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password'
      });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    
    // Update password
    await db.query(
      `UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, req.user.id]
    );
    
    // Revoke all refresh tokens (force re-login)
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );
    
    // Audit successful password change
    await logAuditEvent({
      userId: req.user.id,
      action: 'change_password',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      description: 'Password changed successfully',
      oldValues: { passwordChanged: true },
      newValues: { passwordChanged: true },
      success: true
    });
    
    logger.info('Password changed', { 
      userId: req.user.id,
      email: rows[0].email,
      role: rows[0].role,
      ipAddress: req.ip
    });
    
    res.json({
      success: true,
      message: 'Password changed successfully. Please login again.'
    });
  } catch (error) {
    logger.error('Password change error', { 
      error: error.message,
      userId: req.user?.id,
      ipAddress: req.ip
    });
    
    // Audit error
    if (req.user?.id) {
      await logAuditEvent({
        userId: req.user.id,
        action: 'change_password',
        resourceType: 'user',
        resourceId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        description: 'Password change error',
        success: false,
        errorMessage: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

/**
 * POST /api/auth/password/request-reset
 * Request password reset
 */
router.post('/password/request-reset', async (req, res) => {
  try {
    const data = validate(requestPasswordResetSchema, req.body);
    
    // Find user(s) by email, optionally narrowed by role (supports same email across roles)
    const params = [data.email];
    let whereClause = 'WHERE email = $1 AND is_active = true';
    if (data.role) {
      params.push(data.role);
      whereClause += ' AND role = $2';
    }

    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, role
       FROM users ${whereClause}`,
      params
    );
    
    // Always return success to prevent email enumeration
    if (rows.length === 0) {
      logger.warn('Password reset requested for non-existent email', { email: data.email });
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // If multiple accounts share the same email and role was not provided, do not guess.
    // Still return generic success to avoid enumeration.
    if (rows.length > 1 && !data.role) {
      logger.warn('Password reset requested for email with multiple accounts; role required', {
        email: data.email,
        roles: [...new Set(rows.map(r => r.role))]
      });
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }
    
    const user = rows[0];
    
    // Generate reset token
    const resetToken = generateToken(32);
    const tokenHash = hash(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Store reset token
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [user.id, tokenHash, expiresAt]
    );
    
    // Send password reset email
    const emailService = require('../services/email');
    await emailService.sendPasswordResetEmail(user, resetToken);
    
    logger.info('Password reset requested', { userId: user.id, email: user.email });
    
    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    logger.error('Password reset request error', { error: error.message });
    // Still return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  }
});

/**
 * POST /api/auth/password/reset
 * Reset password with token
 */
router.post('/password/reset', async (req, res) => {
  try {
    const data = validate(resetPasswordSchema, req.body);
    
    // Find reset token
    const tokenHash = hash(data.token);
    const { rows } = await db.query(
      `SELECT prt.user_id, prt.expires_at, u.email, u.first_name, u.last_name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1 AND u.is_active = true`,
      [tokenHash]
    );
    
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token'
      });
    }
    
    const resetToken = rows[0];
    
    // Check if token expired
    if (new Date(resetToken.expires_at) < new Date()) {
      await db.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1',
        [resetToken.user_id]
      );
      return res.status(400).json({
        success: false,
        error: 'Reset token has expired. Please request a new one.'
      });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    
    // Update password
    await db.query(
      `UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2`,
      [newPasswordHash, resetToken.user_id]
    );
    
    // Delete reset token
    await db.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [resetToken.user_id]
    );
    
    // Revoke all refresh tokens
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
      [resetToken.user_id]
    );
    
    logger.info('Password reset completed', { userId: resetToken.user_id });
    
    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.'
    });
  } catch (error) {
    logger.error('Password reset error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email address with token
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token is required'
      });
    }
    
    const tokenHash = hash(token);
    
    // Find verification token
    const { rows: tokens } = await db.query(
      `SELECT et.*, u.id as user_id, u.email, u.is_verified
       FROM email_verification_tokens et
       JOIN users u ON u.id = et.user_id
       WHERE et.token = $1 AND et.used_at IS NULL AND et.expires_at > NOW()`,
      [tokenHash]
    );
    
    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token'
      });
    }
    
    const verificationToken = tokens[0];
    
    // Check if already verified
    if (verificationToken.is_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email address is already verified'
      });
    }
    
    // Mark token as used
    await db.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [verificationToken.id]
    );
    
    // Verify user email
    await db.query(
      `UPDATE users SET is_verified = true, email_verified_at = NOW() WHERE id = $1`,
      [verificationToken.user_id]
    );
    
    logger.info('Email verified', { userId: verificationToken.user_id });
    
    res.json({
      success: true,
      message: 'Email address verified successfully'
    });
  } catch (error) {
    logger.error('Email verification error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to verify email address'
    });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email
 */
router.post('/resend-verification',
  authenticate,
  async (req, res) => {
    try {
      // Check if already verified
      const { rows: users } = await db.query(
        'SELECT id, email, first_name, last_name, role, is_verified FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const user = users[0];
      
      if (user.is_verified) {
        return res.status(400).json({
          success: false,
          error: 'Email address is already verified'
        });
      }
      
      // Delete old unused tokens
      await db.query(
        `DELETE FROM email_verification_tokens 
         WHERE user_id = $1 AND used_at IS NULL`,
        [req.user.id]
      );
      
      // Generate new verification token
      const verificationToken = generateToken(32);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      await db.query(
        `INSERT INTO email_verification_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [req.user.id, hash(verificationToken), expiresAt]
      );
      
      // Send verification email
      const emailService = require('../services/email');
      await emailService.sendVerificationEmail({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }, verificationToken);
      
      logger.info('Verification email resent', { userId: req.user.id });
      
      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });
    } catch (error) {
      logger.error('Resend verification error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to resend verification email'
      });
    }
  }
);

module.exports = router;

