/**
 * Winston Logger Configuration
 * Production-ready logging with file rotation
 */

const winston = require('winston');

const logLevel = process.env.LOG_LEVEL || 'info';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
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

