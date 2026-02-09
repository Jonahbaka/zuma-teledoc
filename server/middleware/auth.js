/**
 * Authentication Middleware
 * JWT verification and role-based access control
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const logger = require('./logger');

// Generate fallback secret if not provided (matches auth.js logic)
const generateFallbackSecret = () => crypto.randomBytes(64).toString('hex');

let ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  // Use a consistent fallback that matches auth.js - we need the SAME secret
  // This is stored in memory and shared across the app
  ACCESS_TOKEN_SECRET = global.__JWT_ACCESS_SECRET || (global.__JWT_ACCESS_SECRET = generateFallbackSecret());
  console.warn('WARNING: JWT_ACCESS_SECRET not set in auth middleware, using fallback.');
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
        error: 'Authentication required'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    
    // Get user from database
    const { rows } = await db.query(
      `SELECT id, email, role, first_name, last_name, is_active, mfa_enabled, provider_status, access_level
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
    
    // Check provider status
    if (user.role === 'provider' && user.provider_status !== 'approved') {
      return res.status(403).json({
        success: false,
        error: 'Provider account pending approval'
      });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      mfaEnabled: user.mfa_enabled,
      providerStatus: user.provider_status,
      accessLevel: user.access_level
    };
    
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
        error: 'Invalid token'
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
  const allowedRoles = roles.flat();
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    // Super admin has access to everything
    if (req.user.role === 'super_admin') {
      return next();
    }
    
    if (!allowedRoles.includes(req.user.role)) {
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

