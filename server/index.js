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

// Initialize Socket.io for real-time chat
let socketService = null;
try {
  socketService = require('./services/socketService');
  socketService.initializeSocket(server);
  console.log('🔌 Real-time chat enabled');
} catch (err) {
  console.error('⚠️ Socket.io initialization failed:', err.message);
}

// Minimal health check - available immediately
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'listening', port: PORT, initialized, nextReady });
});

// Readiness: only "ready" when API middleware + Next handler are attached.
// Useful for monitoring and for debugging split traffic between revisions.
app.get('/readyz', (req, res) => {
  if (initialized && nextReady) {
    return res.status(200).json({ ready: true });
  }
  return res.status(503).json({ ready: false, initialized, nextReady });
});

app.get('/api/health', (req, res) => {
  const health = {
    status: 'healthy',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    initialized,
    nextReady,
    version: 'genesis-v3',
    // Cloud Run metadata (helps diagnose load balancer / revision split)
    service: process.env.K_SERVICE,
    revision: process.env.K_REVISION,
    configuration: process.env.K_CONFIGURATION
  };
  try {
    const orchestrator = require('./services/agent-orchestrator');
    health.agents = orchestrator.agents?.size || 0;
    health.heartbeat = orchestrator.getHeartbeatStatus?.() || {};
    health.operatingMode = orchestrator.operatingMode;
  } catch (e) { /* not ready yet */ }
  res.json(health);
});

// Early warmup guard:
// Cloud Run starts routing traffic as soon as the port is listening.
// We intentionally bind PORT before heavy init to avoid startup timeouts,
// but that means requests can arrive before routes / Next handler are registered.
// Without this guard, Express returns its default 404 during that window.
app.use((req, res, next) => {
  // Always allow health/readiness immediately.
  if (req.path === '/health' || req.path === '/api/health' || req.path === '/readyz') return next();

  // Once initialized, let real routes handle it.
  // For API routes: they can be ready before Next.
  if (initialized && (req.path.startsWith('/api') || (nextReady && handle))) return next();

  // During warmup: never return 404 for "/" (or any app path).
  // For API calls, 503 is clearer than a misleading 404.
  if (req.path.startsWith('/api')) {
    res.setHeader('Retry-After', '3');
    return res.status(503).json({
      success: false,
      error: 'Service warming up',
      initialized,
      nextReady
    });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Retry-After', '3');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>DoctaRx</title>
    <meta http-equiv="refresh" content="2">
    <meta name="robots" content="noindex">
    <style>
      body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}
      .loader{text-align:center;}
      .spinner{width:40px;height:40px;border:4px solid #e0e0e0;border-top:4px solid #9333ea;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;}
      @keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
    </style></head>
    <body><div class="loader"><div class="spinner"></div><p>Starting DoctaRx...</p></div></body></html>
  `);
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
        // Next.js requires 'unsafe-inline' and 'unsafe-eval' + wasm-unsafe-eval for MediaPipe WASM
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
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
          'ws://localhost:8080',
          'ws://localhost:3000',
          'wss://doctarx.com',
          'wss://www.doctarx.com',
          'https://*.sentry.io',
          'https://www.googletagmanager.com',
          'https://www.google-analytics.com',
          'https://analytics.google.com',
          'https://images.unsplash.com'
        ],
        // Allow Google Fonts
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com', 'data:'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", 'blob:', 'mediastream:'],
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
  
  // Rate limiting - COMPLETELY DISABLED for testing
  // const limiter = rateLimit({
  //   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  //   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  //   message: { success: false, error: 'Too many requests' },
  //   standardHeaders: true,
  //   legacyHeaders: false,
  //   validate: { trustProxy: false, xForwardedForHeader: false }
  // });
  // app.use('/api', limiter);
  
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
  loadRoute('/api/interop', './routes/interoperability');
  loadRoute('/api/predictive', './routes/predictive');
  loadRoute('/api/enterprise', './routes/enterprise');
  loadRoute('/api/agent-ops', './routes/agentOps');
  loadRoute('/api/agent-chat', './routes/agentChat');
  loadRoute('/api/inbox', './routes/inbox');
  loadRoute('/api/crm', './routes/crm');
  loadRoute('/api/financial', './routes/financial');
  loadRoute('/api/agent-ide', './routes/agentIde');
  loadRoute('/api/agent-social', './routes/agentSocial');
  loadRoute('/api/realtime-analytics', './routes/realtimeAnalytics');
  loadRoute('/api/auth/zoho/recruit', './routes/zohoRecruitAuth');
  console.log('✅ API routes loading complete');
  
  // Initialize Predictive Intelligence Engine (non-blocking)
  try {
    const predictiveEngine = require('./services/predictive-engine');
    predictiveEngine.initialize().then(() => {
      console.log('🧠 Predictive Intelligence Engine: Online');
    }).catch(err => {
      console.error('🧠 Predictive Engine: Init warning -', err.message);
    });
  } catch (err) {
    console.error('🧠 Predictive Engine: Not available -', err.message);
  }

  // Initialize AI Agent Orchestrator (non-blocking)
  try {
    const agentOrchestrator = require('./services/agent-orchestrator');
    agentOrchestrator.initialize().then(() => {
      console.log('🤖 AI Agent Orchestrator: Online');

      // Stream real-time Agent Ops events to admin consoles.
      try {
        if (socketService?.emitAgentOpsEvent) {
          const claudeConfigured = Boolean(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY);
          const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

          // Initial heartbeat when orchestrator comes online.
          socketService.emitAgentOpsEvent({
            type: 'agent-ops.system.online',
            severity: 'info',
            source: 'orchestrator',
            payload: {
              status: 'online',
              mode: agentOrchestrator.operatingMode || 'observation',
              llm: {
                primary: 'claude',
                fallback: 'gemini',
                claudeConfigured,
                geminiConfigured
              }
            },
            createdAt: new Date().toISOString()
          });

          // Bridge event bus -> websocket stream.
          if (agentOrchestrator.eventBus?.subscribe) {
            agentOrchestrator.eventBus.subscribe('*', async (event) => {
              socketService.emitAgentOpsEvent({
                type: event.type,
                severity: event.severity || 'info',
                source: event.source || 'event-bus',
                payload: event.payload || {},
                createdAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString()
              });
            });
          }
        }
      } catch (streamErr) {
        console.error('⚠️ Agent Ops stream bridge warning:', streamErr.message);
      }
    }).catch(err => {
      console.error('🤖 Agent Orchestrator: Init warning -', err.message);
    });
  } catch (err) {
    console.error('🤖 Agent Orchestrator: Not available -', err.message);
  }

  // ═══ APP NERVE BRIDGE — Connect real app actions to agent nervous system ═══
  try {
    const nerveBridge = require('./services/agent-orchestrator/app-nerve-bridge');
    app.use(nerveBridge.middleware());
    console.log('🧬 App Nerve Bridge: CONNECTED — Agents can sense real app activity');
  } catch (err) {
    console.error('🧬 App Nerve Bridge: Not available -', err.message);
  }

  // ═══ FINANCIAL SERVICE — Corporate Treasury & Accounting ═══
  try {
    const financialService = require('./services/financialService');
    financialService.initialize().then(() => {
      console.log('💰 Financial Service: ONLINE — Corporate Treasury active');
    }).catch(err => {
      console.error('💰 Financial Service: Init warning -', err.message);
    });
  } catch (err) {
    console.error('💰 Financial Service: Not available -', err.message);
  }

  // ═══ AGENT SOCIAL — The Agora ═══
  try {
    const agentSocialService = require('./services/agentSocialService');
    agentSocialService.initialize().then(() => {
      console.log('🏛️ Agent Social (The Agora): ONLINE — Agent society active');
    }).catch(err => {
      console.error('🏛️ Agent Social: Init warning -', err.message);
    });
  } catch (err) {
    console.error('🏛️ Agent Social: Not available -', err.message);
  }

  // ═══ CRM SERVICE — AI Agent Customer Relationship Management ═══
  try {
    const crmService = require('./services/crmService');
    crmService.initialize().then(() => {
      console.log('📇 CRM Service: ONLINE — Agent outreach system ready');
    }).catch(err => {
      console.error('📇 CRM: Init warning -', err.message);
    });
  } catch (err) {
    console.error('📇 CRM: Not available -', err.message);
  }
  
  // 404 for API
  app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
  });
  
  // Global error handler — feeds The Debugger
  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    
    // Feed error to The Debugger for analysis
    try {
      const orchestrator = require('./services/agent-orchestrator');
      orchestrator.captureError(err, `${req.method} ${req.originalUrl}`);
    } catch (e) { /* orchestrator not ready yet */ }

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

  // Capture uncaught exceptions → feed The Debugger
  process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message);
    try {
      const orchestrator = require('./services/agent-orchestrator');
      orchestrator.captureError(err, 'uncaughtException');
    } catch (e) { /* orchestrator not ready */ }
  });
  process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection:', reason);
    try {
      const orchestrator = require('./services/agent-orchestrator');
      orchestrator.captureError(new Error(String(reason)), 'unhandledRejection');
    } catch (e) { /* orchestrator not ready */ }
  });
  
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
