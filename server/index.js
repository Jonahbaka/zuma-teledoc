/**
 * Docta. Express Server
 * Production-ready API server with security middleware
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Database
const db = require('./db');

// Logger
const logger = require('./middleware/logger');
const { initSentry, sentryErrorHandler } = require('./middleware/sentry');

const app = express();
const PORT = process.env.PORT || 8080;

// Track startup status
let nextApp = null;
let handle = null;
let nextReady = false;

// 1. START LISTENING IMMEDIATELY (Satisfies Cloud Run health check)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 PORT OPEN: ${PORT} (0.0.0.0)`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🕒 Time: ${new Date().toISOString()}`);
  
  // 2. Load heavy dependencies AFTER port is bound
  try {
    initializeServices();
  } catch (err) {
    console.error('❌ CRITICAL STARTUP ERROR:', err);
    // Don't process.exit(1) yet, keep the port open so we can see logs
  }
});

// Basic health check available immediately
app.get('/api/health/minimal', (req, res) => {
  res.status(200).json({ status: 'ok', port: PORT, nextReady });
});

async function initializeServices() {
  console.log('📦 Initializing services...');
  
  // Database
  const dbHealth = await db.healthCheck();
  console.log(`🗄️ Database: ${dbHealth.healthy ? 'OK' : 'FAILED (' + dbHealth.error + ')'}`);

  // Initialize Next.js in background
  const next = require('next');
  const dev = process.env.NODE_ENV !== 'production';
  nextApp = next({ dev });
  
  nextApp.prepare().then(() => {
    handle = nextApp.getRequestHandler();
    nextReady = true;
    console.log('✅ Next.js is ready');
  }).catch(err => {
    console.error('❌ Failed to prepare Next.js:', err.message);
  });
}

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Sentry must be initialized as early as possible
const sentryState = initSentry(app);
if (sentryState.enabled) {
  logger.info('Sentry enabled for API server');
}

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// CORS configuration - MUST be before other middleware
const corsOptions = {
  origin: function (origin, callback) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const allowedOrigins = [
      appUrl,
      // Include both www and non-www versions
      appUrl.replace('https://', 'https://www.'),
      // Local development fallbacks
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://doctarx.com',
      'https://www.doctarx.com'
    ].filter(Boolean);
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.some(allowed => origin === allowed || origin.endsWith(allowed.replace('https://', '')))) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked origin', { origin, allowedOrigins });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Security middleware
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://doctarx.com/api';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", appUrl, apiUrl, 'https://doctarx.com', 'https://www.doctarx.com', 'http://localhost:3000', 'http://localhost:3001', 'wss://doctarx.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com']
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Stripe webhook needs raw body - MUST be before json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser(process.env.SESSION_SECRET));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false }
});

// Apply rate limiting to all API routes
app.use('/api', limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later'
  }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Password reset & contact forms are frequent abuse targets
const sensitivePublicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_SENSITIVE_MAX_REQUESTS) || 5,
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false }
});
app.use('/api/auth/password/request-reset', sensitivePublicLimiter);
app.use('/api/contact', sensitivePublicLimiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      database: dbHealth
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Readiness endpoint (production gating)
// - verifies DB connectivity
// - verifies critical env vars are present
app.get('/api/ready', async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';

  const requiredAlways = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'SESSION_SECRET',
    'NEXT_PUBLIC_APP_URL'
  ];

  const requiredProd = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM'
  ];

  const missing = [];
  for (const k of requiredAlways) if (!process.env[k]) missing.push(k);
  if (isProd) for (const k of requiredProd) if (!process.env[k]) missing.push(k);

  let dbHealth = { healthy: false, error: 'not_checked' };
  try {
    dbHealth = await db.healthCheck();
  } catch (e) {
    dbHealth = { healthy: false, error: e.message };
  }

  const ready = missing.length === 0 && dbHealth?.healthy === true;
  const payload = {
    success: ready,
    ready,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbHealth,
    missingEnv: missing
  };

  if (!ready) {
    // Optional: email ops when readiness is failing (avoid spamming by keeping it manual/off by default)
    // If you want this enabled, set READYNESS_ALERTS=true.
    if (process.env.READINESS_ALERTS === 'true') {
      try {
        const opsAlerts = require('./services/opsAlerts');
        await opsAlerts.notifyReadinessFailure({ details: payload });
      } catch (e) {
        logger.error('Failed to send readiness failure alert', { error: e.message });
      }
    }
    return res.status(503).json(payload);
  }

  return res.json(payload);
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes (loaded after server starts listening)
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const appointmentRoutes = require('./routes/appointments');
const medicalRecordRoutes = require('./routes/medicalRecords');
const messageRoutes = require('./routes/messages');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const providerRoutes = require('./routes/providers');
const visitRoutes = require('./routes/visits');
const aiAssistRoutes = require('./routes/aiAssist');
const subscriptionRoutes = require('./routes/subscriptions');
const paymentRoutes = require('./routes/payments');
const priorAuthRoutes = require('./routes/priorAuth');
const claimsRoutes = require('./routes/claims');
const insuranceRoutes = require('./routes/insurance');
const rtbcRoutes = require('./routes/rtbc');
const triageRoutes = require('./routes/triage');
const prescriptionRoutes = require('./routes/prescriptions');
const pharmacyRoutes = require('./routes/pharmacy');
const triageQueueRoutes = require('./routes/triageQueue');
const invitationRoutes = require('./routes/invitations');
const stripeRoutes = require('./routes/stripe');
const credentialingRoutes = require('./routes/credentialing');
const membershipRoutes = require('./routes/membership');
const contactRoutes = require('./routes/contact');
const clinicalEncounterRoutes = require('./routes/clinicalEncounters');
const testingLinksRoutes = require('./routes/testingLinks');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/ai-assist', aiAssistRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/prior-auth', priorAuthRoutes);
app.use('/api/claims', claimsRoutes);
app.use('/api/insurance', insuranceRoutes);
app.use('/api/rtbc', rtbcRoutes);
app.use('/api/triage', triageRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/triage-queue', triageQueueRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/membership', membershipRoutes);
app.use('/api/credentialing', credentialingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/clinical-encounters', clinicalEncounterRoutes);
app.use('/api/testing-links', testingLinksRoutes);

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log the error
  logger.error('Unhandled error', {
    requestId: req.id,
    error: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    url: req.originalUrl,
    method: req.method
  });

  // Determine status code
  const statusCode = err.status || err.statusCode || 500;

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal server error'
      : err.message,
    errors: err.errors || undefined,
    requestId: req.id
  });
});

// Sentry error handler (must be after all controllers, before process exit)
sentryErrorHandler(app);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    await db.close();
    logger.info('Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch-all to serve Next.js app (must be last route)
app.all('*', (req, res) => {
  if (!nextReady || !handle) {
    // Return a simple loading page while Next.js prepares
    return res.status(200).send(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><title>Docta.</title>
      <meta http-equiv="refresh" content="3">
      <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}
      .loader{text-align:center;}.spinner{width:40px;height:40px;border:4px solid #e0e0e0;border-top:4px solid #9333ea;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;}
      @keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}</style></head>
      <body><div class="loader"><div class="spinner"></div><p>Starting Docta...</p></div></body></html>
    `);
  }
  return handle(req, res);
});

module.exports = app;

