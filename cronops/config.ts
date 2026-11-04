/**
 * ═══════════════════════════════════════════════════════════════
 *  CRONOPS CONFIG — Environment + Safety Flags
 * ═══════════════════════════════════════════════════════════════
 *
 *  Single source of truth for all runtime configuration.
 *  Reads from the root .env via dotenv (same file the server uses).
 *  Validates required vars at startup and fails fast if missing.
 */

import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env from project root (one level up from cronops/)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // fallback to process environment
}

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[CronOps] Required environment variable missing: ${key}`);
  return val;
}

function opt_env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

// ─── Core ─────────────────────────────────────────────────────

export const NODE_ENV  = opt_env('NODE_ENV', 'production');
export const IS_PROD   = NODE_ENV === 'production';
export const IS_DEV    = NODE_ENV === 'development';

// Dry-run mode: tasks check this before any write operation.
// Set CRONOPS_DRY_RUN=true to run all tasks in read-only mode.
export const DRY_RUN = opt_env('CRONOPS_DRY_RUN', 'false') === 'true';

// ─── Database ─────────────────────────────────────────────────

export const DATABASE_URL = require_env('DATABASE_URL');
export const PGSSLROOTCERT = opt_env('PGSSLROOTCERT', path.resolve(__dirname, '..', 'global-bundle.pem'));

// ─── Stripe ───────────────────────────────────────────────────

export const STRIPE_SECRET_KEY = opt_env('STRIPE_SECRET_KEY');

// ─── Google Analytics 4 ───────────────────────────────────────

export const GA4_PROPERTY_ID  = opt_env('GA4_PROPERTY_ID');
export const GA4_CLIENT_EMAIL = opt_env('GA4_CLIENT_EMAIL');
export const GA4_PRIVATE_KEY  = opt_env('GA4_PRIVATE_KEY', '').replace(/\\n/g, '\n');

// ─── App ──────────────────────────────────────────────────────

export const APP_URL         = opt_env('NEXT_PUBLIC_APP_URL', 'https://doctarx.com');
export const API_BASE_URL    = opt_env('NEXT_PUBLIC_API_URL', 'https://doctarx.com/api');
export const ALERT_EMAIL     = opt_env('ALERT_ADMIN_EMAIL', 'evolvedu@outlook.com');

// ─── Paths ────────────────────────────────────────────────────

export const CRONOPS_DIR = __dirname;
export const REPORTS_DIR = path.join(__dirname, 'reports');
export const LOGS_DIR    = path.join(__dirname, 'logs');

// ─── Task Tuning ──────────────────────────────────────────────

/** Max consecutive failures before a task is automatically disabled */
export const MAX_CONSECUTIVE_FAILURES = parseInt(opt_env('CRONOPS_MAX_FAILURES', '5'), 10);

/** Base delay (ms) for exponential backoff on task retry */
export const RETRY_BASE_DELAY_MS = parseInt(opt_env('CRONOPS_RETRY_BASE_MS', '5000'), 10);

/** Max number of retry attempts per task execution */
export const MAX_RETRIES = parseInt(opt_env('CRONOPS_MAX_RETRIES', '3'), 10);

/** Max lock age in minutes before considering a lock stale */
export const LOCK_TTL_MINUTES = parseInt(opt_env('CRONOPS_LOCK_TTL_MIN', '30'), 10);

// ─── CRM Thresholds ───────────────────────────────────────────

/** New lead count threshold that triggers an alert */
export const CRM_LEAD_ALERT_THRESHOLD = parseInt(opt_env('CRM_LEAD_ALERT_THRESHOLD', '10'), 10);

/** Minimum lead score to auto-advance pipeline stage */
export const CRM_AUTO_ADVANCE_MIN_SCORE = parseInt(opt_env('CRM_AUTO_ADVANCE_MIN_SCORE', '70'), 10);

// ─── Ensure output directories exist ─────────────────────────

import { mkdirSync } from 'fs';
[REPORTS_DIR, LOGS_DIR].forEach(dir => {
  try { mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
});
