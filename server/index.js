/**
 * DoctaRx Express Server
 * Cloud Run compatible - binds to PORT immediately
 */

// Load environment variables first so PORT and all secrets are available immediately
require('dotenv').config();

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

// Initialize OpenClaw WebSocket adapter (bridges OpenClaw protocol → Hive)
try {
  const { initOpenClawAdapter } = require('./routes/openclawAdapter');
  initOpenClawAdapter(server);
} catch (err) {
  console.error('⚠️ OpenClaw adapter failed:', err.message);
}

// Minimal health check - available immediately
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'listening', port: PORT, initialized, nextReady });
});

function setNoCacheHeaders(res) {
  // Prevent CDNs/edges/browsers from caching the warmup loader HTML.
  // If this ever gets cached, users can see "Connecting..." even when the app is ready.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Common reverse-proxy / CDN hints
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function renderWarmupLoaderHtml() {
  // Keep this self-contained (no external CSS/JS) so it is fast and reliable even during cold start.
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DoctaRx | Connecting...</title>
  <meta http-equiv="refresh" content="2">
  <meta name="robots" content="noindex">
  <style>
    :root {
      --docta-blue: #0f172a;
      --docta-primary: #3b82f6;
      --docta-accent: #22d3ee;
    }
    body {
      background-color: #020617;
      margin: 0;
      overflow: hidden;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .loader-wrapper {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, #0b1220 0%, #020617 70%);
      z-index: 9999;
    }
    .logo-container {
      position: relative;
      width: 120px;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-d {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: var(--docta-primary);
      stroke-width: 4;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.3));
      animation: drawD 3s ease-in-out infinite alternate;
    }
    @keyframes drawD {
      0% { stroke-dasharray: 0, 400; opacity: 0.5; transform: scale(0.95); }
      50% { stroke-dasharray: 200, 400; opacity: 1; transform: scale(1); }
      100% { stroke-dasharray: 400, 400; opacity: 0.8; transform: scale(0.98); }
    }
    .pulse-ring {
      position: absolute;
      border: 2px solid var(--docta-accent);
      border-radius: 50%;
      opacity: 0;
      animation: ripple 3s cubic-bezier(0.23, 1, 0.32, 1) infinite;
    }
    .pulse-ring:nth-child(2) { animation-delay: 1s; }
    .pulse-ring:nth-child(3) { animation-delay: 2s; }
    @keyframes ripple {
      0% { width: 60px; height: 60px; opacity: 0.6; }
      100% { width: 250px; height: 250px; opacity: 0; }
    }
    .ekg-container {
      margin-top: 40px;
      width: 200px;
      height: 40px;
      overflow: hidden;
      position: relative;
    }
    .ekg-svg {
      width: 400px;
      height: 100%;
      fill: none;
      stroke: var(--docta-accent);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      animation: moveEkg 2s linear infinite;
    }
    @keyframes moveEkg {
      from { transform: translateX(0); }
      to { transform: translateX(-200px); }
    }
    .loading-text {
      margin-top: 24px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #e2e8f0;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      display: flex;
      gap: 4px;
      align-items: baseline;
    }
    .dot { animation: dotFlashing 1.5s infinite linear; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dotFlashing {
      0%, 100% { opacity: 0.2; }
      50% { opacity: 1; }
    }
    .fineprint {
      margin-top: 14px;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 300;
    }
    .blob {
      position: absolute;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(34, 211, 238, 0.10) 0%, transparent 70%);
      border-radius: 50%;
      filter: blur(60px);
      z-index: -1;
      animation: float 10s ease-in-out infinite;
    }
    .blob-1 { top: -100px; left: -100px; }
    .blob-2 { bottom: -100px; right: -100px; animation-delay: -5s; }
    @keyframes float {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(40px, 30px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .logo-d, .pulse-ring, .ekg-svg, .blob { animation: none !important; }
    }
  </style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>

  <div class="loader-wrapper">
    <div class="pulse-ring"></div>
    <div class="pulse-ring"></div>
    <div class="pulse-ring"></div>

    <div class="logo-container" style="width: 340px; height: 86px;">
      <div style="background:#020617; border:1px solid #1f2937; border-radius:16px; padding:14px 16px; box-shadow: 0 0 20px rgba(34,211,238,0.18);">
        <svg viewBox="0 0 400 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="DoctaRx" role="img" style="width: 100%; height: 100%;">
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <g transform="translate(10, 10)">
            <path d="M20 5 H45 C70 5 70 75 45 75 H20 V5 Z" stroke="#3B82F6" stroke-width="8" stroke-linecap="round"/>
            <path d="M20 40 L35 40 L40 25 L48 55 L55 40 L70 40" stroke="#22D3EE" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
          </g>
          <text x="100" y="65" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="52" fill="#FFFFFF" letter-spacing="-1" filter="url(#glow)">
            Docta<tspan fill="#22D3EE">Rx</tspan>
          </text>
        </svg>
      </div>
    </div>

    <div class="ekg-container" aria-hidden="true">
      <svg class="ekg-svg" viewBox="0 0 400 40">
        <path d="M0 20 L40 20 L45 10 L50 30 L55 20 L100 20 L140 20 L145 10 L150 30 L155 20 L200 20 L240 20 L245 10 L250 30 L255 20 L300 20 L340 20 L345 10 L350 30 L355 20 L400 20" />
      </svg>
    </div>

    <div class="loading-text">
      <span>Connecting to DoctaRx</span>
      <span class="dot">.</span>
      <span class="dot">.</span>
      <span class="dot">.</span>
    </div>
    <div class="fineprint">Secure &amp; HIPAA Compliant Session</div>
  </div>
</body>
</html>
  `.trim();
}

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
    setNoCacheHeaders(res);
    return res.status(503).json({
      success: false,
      error: 'Service warming up',
      initialized,
      nextReady
    });
  }

  setNoCacheHeaders(res);
  res.setHeader('Retry-After', '3');
  return res.status(200).send(renderWarmupLoaderHtml());
});

/**
 * Initialize all services AFTER port is already bound
 */
async function initializeApp() {
  console.log('📦 Loading dependencies...');
  
  // Now safe to load heavy modules (dotenv already loaded at startup)
  const helmet = require('helmet');
  const cors = require('cors');
  const compression = require('compression');
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

  // Response compression (major speed win for HTML/JSON).
  // Keep it after CORS but before heavy routes.
  app.use(compression({ level: 6 }));
  
  // Security - FIXED CSP for Next.js compatibility
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://doctarx.com/api';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Next.js requires 'unsafe-inline' and 'unsafe-eval' + wasm-unsafe-eval for MediaPipe WASM
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://static.cloudflareinsights.com"],
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
        workerSrc: ["'self'", 'blob:'],
        upgradeInsecureRequests: []   // Upgrade all subresources to HTTPS
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // HTTPS is live — all security headers enabled
    hsts: {
      maxAge: 31536000,        // 1 year
      includeSubDomains: true  // covers www.doctarx.com
    },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    originAgentCluster: true
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
  
  // Ensure agent/CRM/credential DB tables exist before loading routes
  try {
    const ensureAgentTables = require('./db/ensureAgentTables');
    await ensureAgentTables();
  } catch (err) {
    console.error('⚠️ Agent tables check skipped:', err.message);
  }

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
  loadRoute('/api/hive', './routes/hive');
  loadRoute('/api/deploy', './routes/deploy');
  loadRoute('/api/upload-build', './routes/upload-build');
  loadRoute('/api/openclaw', './routes/openclawApi');
  console.log('✅ API routes loading complete (+ Hive Gateway + OpenClaw REST API)');
  
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
      setNoCacheHeaders(res);
      res.setHeader('Retry-After', '3');
      return res.status(200).send(renderWarmupLoaderHtml());
    }
    return handle(req, res);
  });
  
  console.log('\n========================================');
  console.log('🎉 APPLICATION FULLY INITIALIZED');
  console.log('========================================\n');
}

module.exports = app;
