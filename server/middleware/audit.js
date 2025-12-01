/**
 * Audit Logging Middleware
 * HIPAA-compliant audit trail for PHI access
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Log audit event to database
 * @param {Object} auditData - Audit event data
 */
const logAuditEvent = async (auditData) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id,
        ip_address, user_agent, description,
        old_values, new_values, phi_accessed, patient_id,
        success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        auditData.userId,
        auditData.action,
        auditData.resourceType,
        auditData.resourceId,
        auditData.ipAddress,
        auditData.userAgent,
        auditData.description,
        auditData.oldValues ? JSON.stringify(auditData.oldValues) : null,
        auditData.newValues ? JSON.stringify(auditData.newValues) : null,
        auditData.phiAccessed || false,
        auditData.patientId,
        auditData.success !== false,
        auditData.errorMessage
      ]
    );
  } catch (error) {
    logger.error('Failed to write audit log', {
      error: error.message,
      auditData
    });
  }
};

/**
 * Create audit middleware for specific actions
 * @param {string} action - Audit action type
 * @param {string} resourceType - Type of resource being accessed
 * @param {Object} options - Additional options
 */
const auditMiddleware = (action, resourceType, options = {}) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json method to capture response
    res.json = async (body) => {
      const duration = Date.now() - startTime;
      const success = res.statusCode >= 200 && res.statusCode < 400;
      
      // Log audit event
      await logAuditEvent({
        userId: req.user?.id,
        action,
        resourceType,
        resourceId: req.params.id || req.body?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        description: `${action} ${resourceType}${options.description ? ': ' + options.description : ''}`,
        oldValues: res.locals.oldValues,
        newValues: success && options.logChanges ? sanitizeForAudit(req.body) : null,
        phiAccessed: options.phiAccessed || false,
        patientId: req.params.patientId || req.body?.patientId || res.locals.patientId,
        success,
        errorMessage: !success ? body?.error : null
      });
      
      // Log to file as well
      logger.audit(action, {
        userId: req.user?.id,
        resourceType,
        resourceId: req.params.id,
        success,
        duration: `${duration}ms`,
        statusCode: res.statusCode
      });
      
      return originalJson(body);
    };
    
    next();
  };
};

/**
 * Sanitize data for audit logging (remove sensitive fields)
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
const sanitizeForAudit = (data) => {
  if (!data) return null;
  
  const sanitized = { ...data };
  const sensitiveFields = ['password', 'passwordHash', 'mfaSecret', 'mfaBackupCodes', 'token'];
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  return sanitized;
};

/**
 * Audit PHI access
 */
const auditPhiAccess = (resourceType) => {
  return auditMiddleware('access_phi', resourceType, { phiAccessed: true });
};

/**
 * Audit login attempt
 */
const auditLogin = async (req, success, userId = null, errorMessage = null) => {
  await logAuditEvent({
    userId,
    action: 'login',
    resourceType: 'session',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    description: success ? 'Successful login' : 'Failed login attempt',
    newValues: { email: req.body?.email },
    success,
    errorMessage
  });
};

/**
 * Audit logout
 */
const auditLogout = async (req) => {
  await logAuditEvent({
    userId: req.user?.id,
    action: 'logout',
    resourceType: 'session',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    description: 'User logged out',
    success: true
  });
};

/**
 * Audit data export (HIPAA requirement)
 */
const auditExport = async (req, resourceType, patientId, details = {}) => {
  await logAuditEvent({
    userId: req.user?.id,
    action: 'export',
    resourceType,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    description: `Exported ${resourceType} data`,
    phiAccessed: true,
    patientId,
    newValues: details,
    success: true
  });
};

/**
 * Create audit log entry (convenience function)
 * @param {Object} req - Express request object
 * @param {string} action - Action being performed
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - Resource ID
 * @param {Object} options - Additional options
 */
const createAuditLog = async (req, action, resourceType, resourceId, options = {}) => {
  await logAuditEvent({
    userId: req.user?.id,
    action,
    resourceType,
    resourceId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    description: options.description || `${action} ${resourceType}`,
    phiAccessed: options.phiAccessed || false,
    patientId: options.patientId || req.params?.patientId || req.body?.patientId,
    newValues: options.newValues || null,
    oldValues: options.oldValues || null,
    success: options.success !== false,
    errorMessage: options.errorMessage || null
  });
};

module.exports = {
  logAuditEvent,
  auditMiddleware,
  auditPhiAccess,
  auditLogin,
  auditLogout,
  auditExport,
  createAuditLog,
  sanitizeForAudit
};

