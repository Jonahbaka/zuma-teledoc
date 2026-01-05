/**
 * Sentry setup for the Express API
 * Enabled only when SENTRY_DSN is provided.
 */

const Sentry = require('@sentry/node');

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return { enabled: false };

  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    integrations: [
      // Auto-instrument HTTP calls
      Sentry.httpIntegration({ tracing: true })
    ]
  });

  // Request & tracing handlers must be the first middleware on the app
  app.use(Sentry.requestHandler());
  app.use(Sentry.tracingHandler());

  return { enabled: true, Sentry };
}

function sentryErrorHandler(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  app.use(Sentry.errorHandler());
}

module.exports = {
  initSentry,
  sentryErrorHandler
};


