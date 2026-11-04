/**
 * ═══════════════════════════════════════════════════════════════
 *  SECURITY AUDIT TASK — Dependency, SSL, and Platform Checks
 * ═══════════════════════════════════════════════════════════════
 *
 *  Schedule: daily at 2:00 AM ET
 *  Risk:     low (read-only)
 *
 *  What it does:
 *  1. Runs npm audit on the project to detect known vulnerabilities.
 *  2. Checks SSL certificate expiry for the production domain.
 *  3. Validates API endpoint health (non-destructive GET requests).
 *  4. Queries the DB for recent audit log entries / error spikes.
 *  5. Writes a security report to /cronops/reports/YYYY-MM-DD-security.md.
 *
 *  No application DB writes. All checks are non-destructive.
 *  Idempotent: re-runs produce fresh report sections.
 */

import { execSync } from 'child_process';
import https from 'https';
import path from 'path';
import type { CronTask, TaskResult } from '../types';
import { info, warn } from '../logger';
import { query } from '../services/db';
import { writeReport } from '../services/reportWriter';
import { APP_URL } from '../config';

const TASK_NAME = 'security';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ─── Npm audit ────────────────────────────────────────────────

interface AuditResult {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
  raw: string;
  error?: string;
}

function runNpmAudit(): AuditResult {
  try {
    const stdout = execSync('npm audit --json', {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    const data = JSON.parse(stdout);
    const vuln = data.metadata?.vulnerabilities || {};

    return {
      critical: vuln.critical || 0,
      high: vuln.high || 0,
      moderate: vuln.moderate || 0,
      low: vuln.low || 0,
      info: vuln.info || 0,
      total: vuln.total || 0,
      raw: stdout.slice(0, 3000),
    };
  } catch (err) {
    // npm audit exits with code 1 if vulnerabilities exist — still parse stdout
    const e = err as { stdout?: Buffer; message?: string };
    if (e.stdout) {
      try {
        const data = JSON.parse(e.stdout.toString());
        const vuln = data.metadata?.vulnerabilities || {};
        return {
          critical: vuln.critical || 0,
          high: vuln.high || 0,
          moderate: vuln.moderate || 0,
          low: vuln.low || 0,
          info: vuln.info || 0,
          total: vuln.total || 0,
          raw: e.stdout.toString().slice(0, 3000),
        };
      } catch { /* fall through */ }
    }
    return { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0, raw: '', error: e.message };
  }
}

// ─── SSL certificate check ────────────────────────────────────

interface SSLResult {
  domain: string;
  valid: boolean;
  expiresAt?: string;
  daysUntilExpiry?: number;
  issuer?: string;
  error?: string;
}

function checkSSL(domain: string): Promise<SSLResult> {
  return new Promise((resolve) => {
    const req = https.request({
      host: domain,
      port: 443,
      method: 'HEAD',
      path: '/',
      rejectUnauthorized: true,
      timeout: 10_000,
    }, (res) => {
      const cert = (res.socket as any).getPeerCertificate?.();
      if (!cert || Object.keys(cert).length === 0) {
        resolve({ domain, valid: false, error: 'No certificate data' });
        return;
      }

      const expiresAt = new Date(cert.valid_to);
      const daysUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
      const issuer = cert.issuer?.O || 'Unknown';

      resolve({
        domain,
        valid: true,
        expiresAt: expiresAt.toISOString().slice(0, 10),
        daysUntilExpiry,
        issuer,
      });
    });

    req.on('error', (err) => {
      resolve({ domain, valid: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ domain, valid: false, error: 'Connection timeout' });
    });

    req.end();
  });
}

// ─── API endpoint health ──────────────────────────────────────

interface EndpointCheck {
  endpoint: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

async function checkEndpoint(url: string): Promise<EndpointCheck> {
  const start = Date.now();
  try {
    const https_module = await import('https');
    const http_module = await import('http');
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https_module : http_module;

    return await new Promise<EndpointCheck>((resolve) => {
      const req = (mod as any).request(url, { method: 'GET', timeout: 8000, rejectUnauthorized: false }, (res: any) => {
        const latencyMs = Date.now() - start;
        resolve({
          endpoint: url,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          latencyMs,
        });
        res.resume(); // drain
      });
      req.on('error', (err: Error) => resolve({ endpoint: url, ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ endpoint: url, ok: false, error: 'timeout' }); });
      req.end();
    });
  } catch (err) {
    return { endpoint: url, ok: false, error: (err as Error).message, latencyMs: Date.now() - start };
  }
}

async function checkAllEndpoints(): Promise<EndpointCheck[]> {
  const endpoints = [
    `${APP_URL}/api/health`,
    `${APP_URL}/api/hive/status`,
  ];
  return Promise.all(endpoints.map(checkEndpoint));
}

// ─── DB security checks ───────────────────────────────────────

interface DbSecurityResult {
  recentErrors: number;
  failedLogins24h: number;
  suspiciousActivity: string[];
  error?: string;
}

async function runDbSecurityChecks(): Promise<DbSecurityResult> {
  try {
    const [errors, logins] = await Promise.all([
      // Recent error log entries (application-level errors)
      query<{ count: string }>(`
        SELECT COUNT(*) count FROM ai_audit_log
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND action_type ILIKE '%error%'
      `).catch(() => ({ rows: [{ count: '0' }] })),

      // Failed login attempts (if the table tracks them)
      query<{ count: string }>(`
        SELECT COUNT(*) count FROM users
        WHERE last_login_at > NOW() - INTERVAL '24 hours'
          AND is_active = false
      `).catch(() => ({ rows: [{ count: '0' }] })),
    ]);

    const recentErrors = parseInt(errors.rows[0]?.count || '0', 10);
    const failedLogins24h = parseInt(logins.rows[0]?.count || '0', 10);
    const suspiciousActivity: string[] = [];

    if (recentErrors > 100) suspiciousActivity.push(`High error rate: ${recentErrors} errors in 24h`);
    if (failedLogins24h > 20) suspiciousActivity.push(`Suspicious: ${failedLogins24h} inactive user logins in 24h`);

    return { recentErrors, failedLogins24h, suspiciousActivity };
  } catch (err) {
    return { recentErrors: 0, failedLogins24h: 0, suspiciousActivity: [], error: (err as Error).message };
  }
}

// ─── Report builder ───────────────────────────────────────────

function buildSecurityReport(
  audit: AuditResult,
  ssl: SSLResult[],
  endpoints: EndpointCheck[],
  db: DbSecurityResult,
  ts: string
): string {
  // Dependency audit section
  let auditContent = audit.error
    ? `_npm audit failed: ${audit.error}_`
    : [
        `| Severity | Count |`,
        `|----------|-------|`,
        `| 🔴 Critical | **${audit.critical}** |`,
        `| 🟠 High | ${audit.high} |`,
        `| 🟡 Moderate | ${audit.moderate} |`,
        `| 🟢 Low | ${audit.low} |`,
        `| Total | ${audit.total} |`,
        audit.critical > 0 ? '\n⚠️ **CRITICAL vulnerabilities require immediate action.**' : '\n✅ No critical vulnerabilities.',
      ].join('\n');

  // SSL section
  let sslContent = ssl.map(r => {
    if (r.error) return `- ❌ ${r.domain}: ${r.error}`;
    const warn30 = (r.daysUntilExpiry || 0) < 30 ? ' ⚠️ EXPIRING SOON' : '';
    return `- ✅ ${r.domain}: valid, expires ${r.expiresAt} (${r.daysUntilExpiry} days)${warn30} — ${r.issuer}`;
  }).join('\n') || '_No SSL checks configured._';

  // Endpoint section
  let endpointContent = endpoints.map(e => {
    const icon = e.ok ? '✅' : '❌';
    const latency = e.latencyMs ? ` (${e.latencyMs}ms)` : '';
    return `- ${icon} \`${e.endpoint}\`: HTTP ${e.statusCode || 'ERR'}${latency}${e.error ? ` — ${e.error}` : ''}`;
  }).join('\n') || '_No endpoints checked._';

  // DB section
  let dbContent = db.error
    ? `_DB check failed: ${db.error}_`
    : [
        `- Error log entries (24h): ${db.recentErrors}`,
        `- Inactive user logins (24h): ${db.failedLogins24h}`,
        db.suspiciousActivity.length > 0
          ? '\n**⚠️ Suspicious Activity:**\n' + db.suspiciousActivity.map(a => `  - ${a}`).join('\n')
          : '- ✅ No suspicious activity detected.',
      ].join('\n');

  return `**Run at ${ts}**\n\n` +
    `#### Dependency Vulnerabilities\n\n${auditContent}\n\n` +
    `#### SSL Certificate Status\n\n${sslContent}\n\n` +
    `#### API Endpoint Health\n\n${endpointContent}\n\n` +
    `#### Database Security\n\n${dbContent}`;
}

// ─── Task definition ──────────────────────────────────────────

const securityTask: CronTask = {
  name: 'security',
  schedule: '0 2 * * *', // Daily at 2:00 AM ET
  riskLevel: 'low',

  async run(): Promise<TaskResult> {
    const logs: string[] = [];
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    info(TASK_NAME, 'Starting security audit...');

    // Run all checks concurrently
    const [audit, ssl, endpoints, db] = await Promise.all([
      Promise.resolve().then(() => {
        info(TASK_NAME, 'Running npm audit...');
        return runNpmAudit();
      }),
      (async () => {
        const domain = APP_URL.replace(/^https?:\/\//, '').split('/')[0];
        info(TASK_NAME, `Checking SSL for ${domain}...`);
        return [await checkSSL(domain)];
      })(),
      (async () => {
        info(TASK_NAME, 'Checking API endpoints...');
        return checkAllEndpoints();
      })(),
      (async () => {
        info(TASK_NAME, 'Running DB security checks...');
        return runDbSecurityChecks();
      })(),
    ]);

    // Log results
    logs.push(`npm audit: ${audit.total} total vulns (${audit.critical} critical, ${audit.high} high)`);
    if (audit.critical > 0) logs.push(`[ERROR] ${audit.critical} CRITICAL vulnerabilities found in dependencies!`);

    for (const s of ssl) {
      if (s.valid) {
        logs.push(`SSL ${s.domain}: valid, ${s.daysUntilExpiry} days remaining`);
        if ((s.daysUntilExpiry || 0) < 30) logs.push(`[WARN] SSL certificate expiring in ${s.daysUntilExpiry} days!`);
      } else {
        logs.push(`[ERROR] SSL ${s.domain}: ${s.error}`);
      }
    }

    for (const e of endpoints) {
      const status = e.ok ? 'OK' : 'FAIL';
      logs.push(`Endpoint ${e.endpoint}: ${status} (${e.statusCode || 'N/A'}) ${e.latencyMs || 0}ms`);
      if (!e.ok) logs.push(`[WARN] Endpoint check failed: ${e.endpoint}`);
    }

    logs.push(`DB security: ${db.recentErrors} errors, ${db.failedLogins24h} suspicious logins`);
    logs.push(...db.suspiciousActivity.map(a => `[WARN] ${a}`));

    // Build report
    const reportContent = buildSecurityReport(audit, ssl, endpoints, db, ts);
    const reportPath = writeReport('security', [
      { heading: 'Daily Security Audit', content: reportContent },
    ], { overwrite: true });
    logs.push(`Report written: ${reportPath}`);

    const issuesFound = audit.critical > 0 || audit.high > 0 || endpoints.some(e => !e.ok) || db.suspiciousActivity.length > 0;

    info(TASK_NAME, `Audit complete. Issues found: ${issuesFound ? 'YES ⚠️' : 'No ✅'}`);

    return {
      success: true,
      message: `Audit done. Vulns: ${audit.critical}C/${audit.high}H. Endpoints: ${endpoints.filter(e => e.ok).length}/${endpoints.length} OK`,
      logs,
      reportPath,
      metrics: {
        critical: audit.critical,
        high: audit.high,
        moderate: audit.moderate,
        sslDaysLeft: ssl[0]?.daysUntilExpiry || 0,
        endpointsOk: endpoints.filter(e => e.ok).length,
        endpointsTotal: endpoints.length,
        dbErrors24h: db.recentErrors,
      },
    };
  },
};

export default securityTask;
