import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

// Server-side Sentry (Next.js server runtime)
Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
});


