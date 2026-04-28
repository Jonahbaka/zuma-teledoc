/**
 * Authentication Middleware
 * JWT verification and role-based access control
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const logger = require('./logger');
const {
  getEffectiveAccessLevel,
  getTestingBypassPayload
} = require('../services/testingAccessService');

// Generate fallback secret if not provided (matches auth.js logic)
const generateFallbackSecret = () => crypto.randomBytes(64).toString('hex');

// IMPORTANT: Random fallback secrets break in multi-instance deployments (or after restart).
// If explicit JWT secrets are not provided, derive a stable secret from an existing server secret.
const deriveStableJwtSecret = (purpose) => {
  const seed =
    process.env.JWT_SECRET ||
    process.env.JWT_DERIVATION_SEED ||
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.DATABASE_URL;
  if (!seed) return null;
  return crypto.createHmac('sha256', String(seed)).update(String(purpose)).digest('hex');
};

let ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  const derived = deriveStableJwtSecret('doctarx.jwt.access.v1');
  if (derived) {
    ACCESS_TOKEN_SECRET = derived;
    console.warn('WARNING: JWT_ACCESS_SECRET not set in auth middleware — deriving a stable secret from server env. Set JWT_ACCESS_SECRET explicitly in production.');
  } else {
    // Use a consistent fallback that matches auth.js - we need the SAME secret
    // This is stored in memory and shared across the app (single-process dev only).
    ACCESS_TOKEN_SECRET = global.__JWT_ACCESS_SECRET || (global.__JWT_ACCESS_SECRET = generateFallbackSecret());
    console.warn('WARNING: JWT_ACCESS_SECRET not set in auth middleware, using generated random fallback. Tokens may break across restarts/instances.');
  }
}

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const roleAliasMap = {
  administrator: 'admin',
  superadmin: 'super_admin',
  'super-admin': 'super_admin'
};
const canonicalRole = (role) => roleAliasMap[normalizeRole(role)] || normalizeRole(role);

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/password/change'
]);

function isPasswordChangeAllowedRequest(req) {
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return PASSWORD_CHANGE_ALLOWED_PATHS.has(path);
}

/**
 * Verify JWT access token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header or cookie
    let token = null;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    
    // Get user from database
    const { rows } = await db.query(
      `SELECT id, email, role, first_name, last_name, is_active, mfa_enabled, provider_status, access_level,
              must_change_password, testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier
       FROM users WHERE id = $1`,
      [decoded.userId]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = rows[0];
    
    // Check if user is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated'
      });
    }
    
    const isPasswordChangeAllowed = isPasswordChangeAllowedRequest(req);

    // Check provider status. Pending providers may still read their session and
    // rotate a temporary password, but protected provider APIs stay blocked.
    if (user.role === 'provider' && user.provider_status !== 'approved' && !isPasswordChangeAllowed) {
      return res.status(403).json({
        success: false,
        error: 'Provider account pending approval'
      });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: canonicalRole(user.role),
      firstName: user.first_name,
      lastName: user.last_name,
      mfaEnabled: user.mfa_enabled,
      providerStatus: user.provider_status,
      mustChangePassword: user.must_change_password === true,
      accessLevel: getEffectiveAccessLevel(user),
      ...getTestingBypassPayload(user)
    };

    if (
      req.user.role === 'provider' &&
      req.user.mustChangePassword &&
      !isPasswordChangeAllowed
    ) {
      return res.status(403).json({
        success: false,
        error: 'Password change required before accessing provider features.',
        code: 'PASSWORD_CHANGE_REQUIRED'
      });
    }
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    logger.error('Authentication error', { error: error.message, stack: error.stack });
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed: ' + error.message
    });
  }
};

/**
 * Require specific roles
 * @param  {...string} roles - Allowed roles (can be array or individual arguments)
 */
const requireRole = (...roles) => {
  // Flatten in case an array is passed: requireRole(['a', 'b']) or requireRole('a', 'b')
  const allowedRoles = roles.flat().map(canonicalRole);
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    // Super admin has access to everything
    if (canonicalRole(req.user.role) === 'super_admin') {
      return next();
    }
    
    if (!allowedRoles.includes(canonicalRole(req.user.role))) {
      logger.audit('ACCESS_DENIED', {
        userId: req.user.id,
        requiredRoles: allowedRoles,
        userRole: req.user.role,
        resource: req.originalUrl
      });
      
      return res.status(403).json({
        success: false,
        error: 'Access denied. Insufficient permissions.'
      });
    }
    
    next();
  };
};

/**
 * Require super admin role
 */
const requireSuperAdmin = requireRole('super_admin');

/**
 * Require MFA verification for sensitive operations
 */
const requireMfa = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  
  // If user has MFA enabled, check if session has been MFA verified
  if (req.user.mfaEnabled) {
    const mfaVerified = req.cookies.mfaVerified === 'true';
    
    if (!mfaVerified) {
      return res.status(403).json({
        success: false,
        error: 'MFA verification required',
        code: 'MFA_REQUIRED'
      });
    }
  }
  
  next();
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token = null;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return next();
    }
    
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    
    const { rows } = await db.query(
      `SELECT id, email, role, first_name, last_name, is_active
       FROM users WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );
    
    if (rows.length > 0) {
      req.user = {
        id: rows[0].id,
        email: rows[0].email,
        role: rows[0].role,
        firstName: rows[0].first_name,
        lastName: rows[0].last_name
      };
    }
    
    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
};

/**
 * Check if user can access patient data
 * @param {string} patientId - Patient ID to check access for
 */
const canAccessPatient = async (req, res, next) => {
  const patientId = req.params.patientId || req.body.patientId || req.query.patientId;
  
  if (!patientId) {
    return res.status(400).json({
      success: false,
      error: 'Patient ID required'
    });
  }
  
  const { user } = req;
  
  // Admin can access all patients
  if (user.role === 'admin') {
    return next();
  }
  
  // Patient can only access their own data
  if (user.role === 'patient') {
    if (user.id !== patientId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    return next();
  }
  
  // Provider can access patients they have appointments with
  if (user.role === 'provider') {
    const { rows } = await db.query(
      `SELECT 1 FROM appointments 
       WHERE provider_id = $1 AND patient_id = $2 
       LIMIT 1`,
      [user.id, patientId]
    );
    
    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'No provider-patient relationship found'
      });
    }
    
    return next();
  }
  
  return res.status(403).json({
    success: false,
    error: 'Access denied'
  });
};

module.exports = {
  authenticate,
  requireRole,
  requireSuperAdmin,
  requireMfa,
  optionalAuth,
  canAccessPatient
};

