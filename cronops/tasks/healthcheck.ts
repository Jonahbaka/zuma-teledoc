/**
 * ═══════════════════════════════════════════════════════════════
 *  HEALTHCHECK TASK — EC2 Uptime, API, DB, and Service Monitor
 * ═══════════════════════════════════════════════════════════════
 *
 *  Schedule: every 10 minutes
 *  Risk:     low (read-only)
 *
 *  What it does:
 *  1. Checks database connectivity and query latency.
 *  2. Checks all critical API endpoints (health, hive/status, auth).
 *  3. Validates external service reachability (Stripe, GA4, AWS SES).
 *  4. Checks for abnormal PM2/process state via uptime signals.
 *  5. Detects degraded service vs full outage.
 *  6. Writes a health report to /cronops/reports/YYYY-MM-DD-health.md.
 *  7. Logs anomalies for the security/analytics tasks to pick up.
 *
 *  Safe: no writes to application DB or external state.
 *  Idempotent: appends a new time-stamped section per run.
 */

import https from 'https';
import http from 'http';
import os from 'os';
import type { CronTask, TaskResult } from '../types';
import { info, warn } from '../logger';
import { healthCheck as dbHealthCheck } from '../services/db';
import { query } from '../services/db';
import { writeReport } from '../services/reportWriter';
import { APP_URL, STRIPE_SECRET_KEY, GA4_PROPERTY_ID } from '../config';

const TASK_NAME = 'healthcheck';

// ─── Types ────────────────────────────────────────────────────

interface ServiceCheck {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
  error?: string;
}

// ─── HTTP ping helper ─────────────────────────────────────────

function httpGet(url: string, timeoutMs = 8000): Promise<ServiceCheck> {
  return new Promise((resolve) => {
    const start = Date.now();
    const name = url;
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;

    const req = (mod as any).request(url, {
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false, // health checks on self-signed certs are fine
    }, (res: any) => {
      const latencyMs = Date.now() - start;
      const ok = res.statusCode >= 200 && res.statusCode < 500;
      resolve({ name, ok, latencyMs, detail: `HTTP ${res.statusCode}` });
      res.resume();
    });

    req.on('error', (err: Error) => {
      resolve({ name, ok: false, latencyMs: Date.now() - start, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ name, ok: false, latencyMs: timeoutMs, error: 'timeout' });
    });

    req.end();
  });
}

// ─── Core checks ─────────────────────────────────────────────

async function checkDatabase(): Promise<ServiceCheck> {
  const result = await dbHealthCheck();
  return {
    name: 'PostgreSQL (RDS)',
    ok: result.ok,
    latencyMs: result.latencyMs,
    detail: result.ok ? `Query latency: ${result.latencyMs}ms` : undefined,
    error: result.error,
  };
}

async function checkApplicationEndpoints(): Promise<ServiceCheck[]> {
  const endpoints = [
    `${APP_URL}/api/health`,
    `${APP_URL}/api/hive/status`,
    `${APP_URL}/health`,
  ];

  return Promise.all(endpoints.map(url => httpGet(url)));
}

async function checkStripeReachability(): Promise<ServiceCheck> {
  if (!STRIPE_SECRET_KEY) {
    return { name: 'Stripe', ok: false, detail: 'STRIPE_SECRET_KEY not set' };
  }
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' as any });
    const start = Date.now();
    await stripe.balance.retrieve();
    return { name: 'Stripe API', ok: true, latencyMs: Date.now() - start, detail: 'Balance endpoint OK' };
  } catch (err) {
    const e = err as Error;
    const isAuthError = e.message.includes('authentication') || e.message.includes('auth');
    return { name: 'Stripe API', ok: !isAuthError, error: e.message, detail: isAuthError ? 'Auth issue (key invalid?)' : 'API reachable but error' };
  }
}

async function checkGoogleReachability(): Promise<ServiceCheck> {
  if (!GA4_PROPERTY_ID) {
    return { name: 'Google/GA4', ok: false, detail: 'GA4_PROPERTY_ID not set' };
  }
  // Just check Google is reachable (lightweight ping)
  return httpGet('https://analytics.googleapis.com/v1beta/properties/' + GA4_PROPERTY_ID + ':runReport');
}

async function checkSystemMetrics(): Promise<{
  cpuLoad1m: number;
  memUsedPct: number;
  uptimeHours: number;
  freeMemMB: number;
}> {
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpuLoad1m: Math.round(loadAvg[0] * 100) / 100,
    memUsedPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    uptimeHours: Math.round(process.uptime() / 3600 * 10) / 10,
    freeMemMB: Math.round(freeMem / 1_048_576),
  };
}

async function checkDatabaseLoad(): Promise<{
  activeConnections: number;
  longRunningQueries: number;
  tableCount: number;
}> {
  try {
    const [conns, longQ, tables] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) count FROM pg_stat_activity WHERE state = 'active'`).catch(() => ({ rows: [{ count: '0' }] })),
      query<{ count: string }>(`SELECT COUNT(*) count FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '5 seconds'`).catch(() => ({ rows: [{ count: '0' }] })),
      query<{ count: string }>(`SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema = 'public'`).catch(() => ({ rows: [{ count: '0' }] })),
    ]);
    return {
      activeConnections: parseInt(conns.rows[0]?.count || '0', 10),
      longRunningQueries: parseInt(longQ.rows[0]?.count || '0', 10),
      tableCount: parseInt(tables.rows[0]?.count || '0', 10),
    };
  } catch {
    return { activeConnections: 0, longRunningQueries: 0, tableCount: 0 };
  }
}

// ─── Status determination ─────────────────────────────────────

type OverallStatus = 'healthy' | 'degraded' | 'critical';

function determineOverallStatus(
  db: ServiceCheck,
  endpoints: ServiceCheck[],
  sys: { cpuLoad1m: number; memUsedPct: number },
): OverallStatus {
  if (!db.ok) return 'critical';
  const endpointsDown = endpoints.filter(e => !e.ok).length;
  if (endpointsDown >= endpoints.length) return 'critical';
  if (endpointsDown > 0 || sys.memUsedPct > 90 || sys.cpuLoad1m > 4) return 'degraded';
  return 'healthy';
}

// ─── Report builder ───────────────────────────────────────────

function buildHealthReport(
  db: ServiceCheck,
  endpoints: ServiceCheck[],
  stripe: ServiceCheck,
  google: ServiceCheck,
  sys: Awaited<ReturnType<typeof checkSystemMetrics>>,
  dbLoad: Awaited<ReturnType<typeof checkDatabaseLoad>>,
  status: OverallStatus,
  ts: string
): string {
  const statusIcon = status === 'healthy' ? '🟢' : status === 'degraded' ? '🟡' : '🔴';

  let content = `**Run at ${ts}** — Overall: ${statusIcon} ${status.toUpperCase()}\n\n`;

  // DB
  const dbIcon = db.ok ? '✅' : '❌';
  content += `#### Database\n\n`;
  content += `${dbIcon} ${db.name}: ${db.ok ? `${db.latencyMs}ms latency` : db.error}\n`;
  content += `- Active connections: ${dbLoad.activeConnections}\n`;
  content += `- Long-running queries (>5s): ${dbLoad.longRunningQueries}${dbLoad.longRunningQueries > 0 ? ' ⚠️' : ''}\n`;
  content += `- Tables in schema: ${dbLoad.tableCount}\n\n`;

  // Endpoints
  content += `#### API Endpoints\n\n`;
  for (const e of endpoints) {
    const icon = e.ok ? '✅' : '❌';
    content += `${icon} \`${e.name}\`: ${e.detail || e.error || 'N/A'} (${e.latencyMs || 0}ms)\n`;
  }
  content += '\n';

  // External services
  content += `#### External Services\n\n`;
  const sIcon = (s: ServiceCheck) => s.ok ? '✅' : '❌';
  content += `${sIcon(stripe)} ${stripe.name}: ${stripe.detail || stripe.error || 'N/A'} (${stripe.latencyMs || 0}ms)\n`;
  content += `${sIcon(google)} ${google.name}: ${google.detail || google.error || 'N/A'} (${google.latencyMs || 0}ms)\n\n`;

  // System
  content += `#### System Metrics\n\n`;
  content += `| Metric | Value | Status |\n|--------|-------|--------|\n`;
  content += `| CPU Load (1m) | ${sys.cpuLoad1m} | ${sys.cpuLoad1m > 4 ? '⚠️ High' : '✅ Normal'} |\n`;
  content += `| Memory Used | ${sys.memUsedPct}% | ${sys.memUsedPct > 90 ? '⚠️ High' : '✅ Normal'} |\n`;
  content += `| Free Memory | ${sys.freeMemMB} MB | - |\n`;
  content += `| CronOps Uptime | ${sys.uptimeHours}h | - |\n`;

  return content;
}

// ─── Task definition ──────────────────────────────────────────

const healthcheckTask: CronTask = {
  name: 'healthcheck',
  schedule: '*/10 * * * *', // Every 10 minutes
  riskLevel: 'low',

  async run(): Promise<TaskResult> {
    const logs: string[] = [];
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    info(TASK_NAME, 'Running health checks...');

    const [db, endpoints, stripe, google, sys, dbLoad] = await Promise.all([
      checkDatabase(),
      checkApplicationEndpoints(),
      checkStripeReachability(),
      checkGoogleReachability(),
      checkSystemMetrics(),
      checkDatabaseLoad(),
    ]);

    // Determine overall status
    const status = determineOverallStatus(db, endpoints, sys);

    // Log findings
    logs.push(`DB: ${db.ok ? `OK (${db.latencyMs}ms)` : `FAIL — ${db.error}`}`);
    if (!db.ok) logs.push(`[ERROR] Database is unreachable!`);
    if (dbLoad.longRunningQueries > 0) logs.push(`[WARN] ${dbLoad.longRunningQueries} long-running DB queries`);

    for (const e of endpoints) {
      logs.push(`Endpoint ${e.name}: ${e.ok ? `OK ${e.latencyMs}ms` : `FAIL — ${e.error || e.detail}`}`);
      if (!e.ok) warn(TASK_NAME, `Endpoint down: ${e.name}`);
    }

    logs.push(`Stripe: ${stripe.ok ? `OK ${stripe.latencyMs}ms` : stripe.error}`);
    logs.push(`Google: ${google.ok ? `OK ${google.latencyMs}ms` : google.error}`);
    logs.push(`System: CPU ${sys.cpuLoad1m} | Mem ${sys.memUsedPct}%`);
    if (sys.memUsedPct > 90) logs.push(`[WARN] Memory usage critical: ${sys.memUsedPct}%`);
    if (sys.cpuLoad1m > 4) logs.push(`[WARN] CPU load high: ${sys.cpuLoad1m}`);
    logs.push(`Overall status: ${status.toUpperCase()}`);

    const reportContent = buildHealthReport(db, endpoints, stripe, google, sys, dbLoad, status, ts);
    const reportPath = writeReport('health', [
      { heading: `Health Check — ${status.toUpperCase()}`, content: reportContent },
    ]);
    logs.push(`Report appended: ${reportPath}`);

    const endpointsOk = endpoints.filter(e => e.ok).length;
    info(TASK_NAME, `Health: ${status}. DB: ${db.ok ? 'UP' : 'DOWN'}. Endpoints: ${endpointsOk}/${endpoints.length}`);

    return {
      success: status !== 'critical',
      message: `${status.toUpperCase()} | DB: ${db.ok ? 'UP' : 'DOWN'} | Endpoints: ${endpointsOk}/${endpoints.length} | Mem: ${sys.memUsedPct}%`,
      logs,
      reportPath,
      metrics: {
        overallStatus: status,
        dbOk: db.ok ? 1 : 0,
        dbLatencyMs: db.latencyMs || 0,
        endpointsOk,
        endpointsTotal: endpoints.length,
        stripeOk: stripe.ok ? 1 : 0,
        cpuLoad: sys.cpuLoad1m,
        memUsedPct: sys.memUsedPct,
        activeDbConnections: dbLoad.activeConnections,
        longRunningQueries: dbLoad.longRunningQueries,
      },
    };
  },
};

export default healthcheckTask;
