/**
 * Error-only Sentry setup for the Express API. Initialize before importing
 * Express/HTTP so the current SDK can isolate concurrent requests correctly.
 * Enabled only when SENTRY_DSN is provided; no private request data is exported.
 */

const { scrubSentryEvent, createSentryPrivacyTransport } = require('../utils/sentryPrivacy');
let sentry;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return { enabled: false };
  // Keep the SDK out of the normal disabled startup path.
  const Sentry = require('@sentry/node');

  Sentry.init({
    dsn,
    enabled: true,
    debug: false,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.httpIntegration({
        spans: false,
        breadcrumbs: false,
        tracePropagation: false,
        trackIncomingRequestsAsSessions: false,
        ignoreIncomingRequestBody: () => true
      }),
      Sentry.expressIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration()
    ],
    // Performance/SQL/AI spans and other payload channels need their own PHI
    // review. SENTRY_TRACES_SAMPLE_RATE must not reopen them implicitly.
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    enableLogs: false,
    autoSessionTracking: false,
    sendClientReports: false,
    beforeBreadcrumb: () => null,
    beforeSendLog: () => null,
    beforeSendTransaction: () => null,
    beforeSend: scrubSentryEvent,
    transport: createSentryPrivacyTransport(Sentry.makeNodeTransport)
  });
  sentry = Sentry;
  return { enabled: true, Sentry };
}

function sentryErrorHandler(app) {
  if (!sentry) return;
  // Must run after routes but BEFORE the application's terminal error handler.
  sentry.setupExpressErrorHandler(app);
}

module.exports = { initSentry, sentryErrorHandler };
