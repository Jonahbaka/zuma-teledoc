import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

// Edge runtime Sentry (if/when used)
Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
});


