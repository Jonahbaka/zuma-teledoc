/**
 * Docta. Express Server
 * Cloud Run compatible - binds to PORT immediately
 */

// STEP 1: Minimal imports that cannot crash
const express = require('express');
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = '0.0.0.0';

// Track startup status
let nextReady = false;
let handle = null;
let initialized = false;

// STEP 2: BIND PORT IMMEDIATELY - This MUST happen first for Cloud Run
const server = app.listen(PORT, HOST, () => {
  console.log(`\n========================================`);
  console.log(`🚀 SERVER LISTENING ON ${HOST}:${PORT}`);
  console.log(`🕒 ${new Date().toISOString()}`);
  console.log(`========================================\n`);
  
  // STEP 3: Initialize everything else AFTER port is bound
  initializeApp().catch(err => {
    console.error('❌ Initialization error (non-fatal):', err.message);
  });
});

// Minimal health check - available immediately
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'listening', port: PORT, initialized, nextReady });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'listening', port: PORT, initialized, nextReady });
});

/**
 * Initialize all services AFTER port is already bound
 */
async function initializeApp() {
  console.log('📦 Loading dependencies...');
  
  // Now safe to load heavy modules
  require('dotenv').config();
  const helmet = require('helmet');
  const cors = require('cors');
  const cookieParser = require('cookie-parser');
  const rateLimit = require('express-rate-limit');
  const { v4: uuidv4 } = require('uuid');
  const path = require('path');
  
  // Database (with error handling)
  let db;
  try {
    db = require('./db');
    const dbHealth = await db.healthCheck();
    console.log(`🗄️ Database: ${dbHealth.healthy ? 'OK' : 'FAILED - ' + dbHealth.error}`);
  } catch (err) {
    console.error('🗄️ Database: FAILED to load -', err.message);
  }
  
  // Logger (console only)
  const logger = require('./middleware/logger');
  const { initSentry, sentryErrorHandler } = require('./middleware/sentry');
  
  console.log('⚙️ Configuring middleware...');
  
  // Trust proxy
  app.set('trust proxy', 1);
  
  // Sentry
  const sentryState = initSentry(app);
  if (sentryState.enabled) {
    console.log('🔍 Sentry: Enabled');
  }
  
  // Request ID
  app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
  });
  
  // CORS
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  const corsOptions = {
    origin: function (origin, callback) {
      const allowedOrigins = [
        appUrl,
        appUrl.replace('https://', 'https://www.'),
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://doctarx.com',
        'https://www.doctarx.com'
      ].filter(Boolean);
      if (!origin || allowedOrigins.some(allowed => origin === allowed || origin.endsWith(allowed.replace('https://', '')))) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
    optionsSuccessStatus: 204
  };
  app.use(cors(corsOptions));
  
  // Security - FIXED CSP for Next.js compatibility
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://doctarx.com/api';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Next.js requires 'unsafe-inline' and 'unsafe-eval' for scripts
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        // Allow inline styles and Google Fonts
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: [
          "'self'", 
          appUrl, 
          apiUrl, 
          'https://doctarx.com', 
          'https://www.doctarx.com', 
          'http://localhost:3000', 
          'http://localhost:3001', 
          'wss://doctarx.com',
          'https://*.sentry.io'
        ],
        // Allow Google Fonts
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com', 'data:'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
        workerSrc: ["'self'", 'blob:']
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
  
  // Stripe webhook (raw body)
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  
  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser(process.env.SESSION_SECRET));
  
  // Rate limiting - INCREASED for testing
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // Increased from 100
    message: { success: false, error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, xForwardedForHeader: false }
  });
  app.use('/api', limiter);
  
  // Auth rate limiting - DISABLED for testing
  // const authLimiter = rateLimit({
  //   windowMs: 15 * 60 * 1000,
  //   max: 50,
  //   message: { success: false, error: 'Too many auth attempts' }
  // });
  // app.use('/api/auth/login', authLimiter);
  // app.use('/api/auth/register', authLimiter);
  
  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'production' || res.statusCode >= 400) {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });
  
  // Serve uploads
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  
  console.log('📚 Loading API routes...');
  
  // Helper to safely load routes
  const loadRoute = (path, routeModule) => {
    try {
      app.use(path, require(routeModule));
      return true;
    } catch (err) {
      console.error(`❌ Failed to load ${path}:`, err.message);
      return false;
    }
  };
  
  // Load routes individually to identify failures
  loadRoute('/api/auth', './routes/auth');
  loadRoute('/api/users', './routes/users');
  loadRoute('/api/appointments', './routes/appointments');
  loadRoute('/api/medical-records', './routes/medicalRecords');
  loadRoute('/api/messages', './routes/messages');
  loadRoute('/api/notifications', './routes/notifications');
  loadRoute('/api/admin', './routes/admin');
  loadRoute('/api/providers', './routes/providers');
  loadRoute('/api/visits', './routes/visits');
  loadRoute('/api/ai-assist', './routes/aiAssist');
  loadRoute('/api/subscriptions', './routes/subscriptions');
  loadRoute('/api/payments', './routes/payments');
  loadRoute('/api/prior-auth', './routes/priorAuth');
  loadRoute('/api/claims', './routes/claims');
  loadRoute('/api/insurance', './routes/insurance');
  loadRoute('/api/rtbc', './routes/rtbc');
  loadRoute('/api/triage', './routes/triage');
  loadRoute('/api/prescriptions', './routes/prescriptions');
  loadRoute('/api/pharmacy', './routes/pharmacy');
  loadRoute('/api/triage-queue', './routes/triageQueue');
  loadRoute('/api/invitations', './routes/invitations');
  loadRoute('/api/stripe', './routes/stripe');
  loadRoute('/api/membership', './routes/membership');
  loadRoute('/api/credentialing', './routes/credentialing');
  loadRoute('/api/contact', './routes/contact');
  loadRoute('/api/clinical-encounters', './routes/clinicalEncounters');
  loadRoute('/api/testing-links', './routes/testingLinks');
  console.log('✅ API routes loading complete');
  
  // 404 for API
  app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
  });
  
  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: process.env.NODE_ENV === 'production' && statusCode === 500 ? 'Internal server error' : err.message
    });
  });
  
  // Sentry error handler
  sentryErrorHandler(app);
  
  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`${signal} received. Shutting down...`);
    try {
      if (db) await db.close();
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  initialized = true;
  console.log('✅ Express API ready');
  
  // Initialize Next.js last (heaviest)
  console.log('⏳ Preparing Next.js...');
  try {
    const next = require('next');
    const dev = process.env.NODE_ENV !== 'production';
    const nextApp = next({ dev });
    
    await nextApp.prepare();
    handle = nextApp.getRequestHandler();
    nextReady = true;
    console.log('✅ Next.js ready');
  } catch (err) {
    console.error('❌ Next.js failed:', err.message);
  }
  
  // Catch-all for Next.js (must be last)
  app.all('*', (req, res) => {
    if (!nextReady || !handle) {
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
  
  console.log('\n========================================');
  console.log('🎉 APPLICATION FULLY INITIALIZED');
  console.log('========================================\n');
}

module.exports = app;
