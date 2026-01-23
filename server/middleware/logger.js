/**
 * Winston Logger Configuration
 * Production-ready logging with file rotation
 */

const winston = require('winston');
const path = require('path');

const fs = require('fs');

const logLevel = process.env.LOG_LEVEL || 'info';
// Use /tmp in production (always writable on Cloud Run), fallback to ./logs for local dev
const logPath = process.env.LOG_FILE_PATH || (process.env.NODE_ENV === 'production' ? '/tmp/logs' : './logs');

// Ensure log directory exists
try {
  if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
  }
} catch (err) {
  console.warn(`Could not create log directory ${logPath}:`, err.message);
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: 'zuma-teledoc-api' },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// Add file transports in production (wrapped in try-catch to prevent startup failures)
if (process.env.NODE_ENV === 'production') {
  try {
    // Error log file
    logger.add(new winston.transports.File({
      filename: path.join(logPath, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }));
    
    // Combined log file
    logger.add(new winston.transports.File({
      filename: path.join(logPath, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10
    }));
    
    // Audit log file (HIPAA requirement)
    logger.add(new winston.transports.File({
      filename: path.join(logPath, 'audit.log'),
      level: 'info',
      format: fileFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 30 // Keep 30 days of audit logs
    }));
  } catch (err) {
    console.warn('Could not add file transports to logger:', err.message);
  }
}

// Audit logging helper (HIPAA compliance)
logger.audit = (action, details) => {
  logger.info('AUDIT', {
    audit: true,
    action,
    ...details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;

