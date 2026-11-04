const express = require('express');
const router = express.Router();
const path = require('path');
const { buildDeployCommand, PROJECT_ROOT } = require('./deploy-command');
const { runDetachedCommand } = require('./run-detached-command');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Keys that the deploy webhook is permitted to inject into the production .env.
// Values for any other key are silently ignored — prevents arbitrary injection.
const INJECTABLE_ENV_KEYS = new Set([
  // LiveKit SFU
  'NG_LIVEKIT_URL',
  'NG_LIVEKIT_API_KEY',
  'NG_LIVEKIT_API_SECRET',
  // Database
  'DATABASE_URL',
  // Auth / session
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  // AI providers
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'CLAUDE_API_KEY',
  // Payments
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PUBLIC_KEY',
  'FLUTTERWAVE_SECRET_KEY',
  'FLUTTERWAVE_PUBLIC_KEY',
  // Comms
  'TERMII_API_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  // TURN / WebRTC
  'RTC_TURN_URLS',
  'TURN_STATIC_AUTH_SECRET',
  // Deploy
  'DEPLOY_SECRET',
]);

function mergeEnvFile(envPath, updates) {
  const safe = Object.entries(updates).filter(([k]) => INJECTABLE_ENV_KEYS.has(k));
  if (!safe.length) return;

  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch {}

  for (const [key, rawVal] of safe) {
    const val = String(rawVal).replace(/\r?\n/g, ''); // values must be single-line
    const line = `${key}=${val}`;
    if (new RegExp(`^${key}=`, 'm').test(content)) {
      content = content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += line + '\n';
    }
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  // Log key names only — values are intentionally omitted
  console.log('[deploy] .env updated — keys:', safe.map(([k]) => k).join(', '));
}

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
if (!DEPLOY_SECRET) {
  console.error('WARNING: DEPLOY_SECRET env var is not set. Deploy endpoint will only accept trusted GitHub OIDC.');
}

let deploying = false;
const DEPLOY_LOG = '/tmp/doctarx-deploy.log';
const DEPLOY_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min safety timeout
const DEPLOY_BRANCH = process.env.DEPLOY_GITHUB_REF_NAME || 'main';
let deployStartedAt = null;  // ms epoch of the current/last deploy start
let deployFinishedAt = null; // ms epoch when a terminal state was observed
let deployPid = null;        // PID of the detached bash process for the current deploy
let deployId = null;         // opaque id for the current/last deploy
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const GITHUB_OIDC_AUDIENCE = process.env.DEPLOY_GITHUB_OIDC_AUDIENCE || 'doctarx-deploy';
const GITHUB_DEPLOY_REPOSITORY = process.env.DEPLOY_GITHUB_REPOSITORY || 'Jonahbaka/zuma-teledoc';
const GITHUB_DEPLOY_REF = process.env.DEPLOY_GITHUB_REF || 'refs/heads/main';
let githubJwksCache = { fetchedAt: 0, keys: [] };

function newDeployId() {
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

// True if `pid` refers to a live process. `kill(pid, 0)` sends no signal but
// throws ESRCH if the process is gone (EPERM means it exists but is owned by
// another user — still alive).
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readDeployLog() {
  try {
    return fs.existsSync(DEPLOY_LOG) ? fs.readFileSync(DEPLOY_LOG, 'utf8') : '';
  } catch {
    return '';
  }
}

function firstMatch(raw, re) {
  const m = raw.match(re);
  return m ? m[1] : null;
}

// Parse the deploy log into the structured facts the status contract needs.
// The log is the SINGLE SOURCE OF TRUTH: the `pm2 reload` phase restarts this
// very Node process mid-deploy, wiping the in-memory deploy* vars, so identity
// (id/pid/commit/startedAt), per-phase checks, and the terminal state must all
// be recoverable from the log the detached bash process keeps writing.
function parseDeployLog(raw) {
  const checkVal = (marker) =>
    raw.includes(`[deploy:check] ${marker}=failed`) ? 'failed' :
    raw.includes(`[deploy:check] ${marker}=success`) ? 'success' : 'pending';
  const pidStr = firstMatch(raw, /\[deploy:pid\]\s+(\d+)/);
  const exitStr = firstMatch(raw, /\[deploy\] failed \(exit (\d+)\)/);
  return {
    id: firstMatch(raw, /\[deploy:id\]\s+(\S+)/),
    pid: pidStr ? parseInt(pidStr, 10) : null,
    startedAt: firstMatch(raw, /\[deploy\] start\s+(\S+)/),
    commit: firstMatch(raw, /\[deploy\] checkout\s+(\w+)/),
    finishedAt: firstMatch(raw, /\[deploy\] (?:complete|failed[^\n]*?)\s+(\d{4}-\d{2}-\d{2}T[0-9:]+Z)/),
    complete: raw.includes('[deploy] complete'),
    failedMarker: raw.includes('[deploy] failed'),
    verifyPass: raw.includes('[verify:result] PASS'),
    verifyFail: raw.includes('[verify:result] FAIL'),
    exitCode: exitStr ? parseInt(exitStr, 10) : null,
    checks: {
      build: checkVal('build'),
      pm2: checkVal('pm2'),
      health: checkVal('health'),
      ngHealth: checkVal('ngHealth'),
    },
  };
}

// Stable deploy status contract — the single shape both this endpoint and the
// GitHub Actions poller agree on:
//   { ok, deployId, pid, status, startedAt, finishedAt, commit, branch,
//     logPath, lastLines, exitCode, verified, checks }
// status ∈ idle | running | success | failed | timeout | unknown.
function computeDeployStatus(maxLines = 400) {
  const raw = readDeployLog();
  const p = parseDeployLog(raw);

  // Prefer live in-memory state; fall back to log-recovered values (needed
  // after pm2 reload restarts this process mid-deploy).
  const effPid = deployPid || p.pid;
  const effId = deployId || p.id;
  const effStartedMs = deployStartedAt || (p.startedAt ? Date.parse(p.startedAt) : null);

  const pidAlive = isPidAlive(effPid);
  const hasTerminal = p.complete || p.failedMarker;
  const ageSeconds = effStartedMs ? Math.round((Date.now() - effStartedMs) / 1000) : null;
  const timedOut = !hasTerminal && ageSeconds !== null && ageSeconds * 1000 > DEPLOY_LOCK_TIMEOUT_MS;
  // Crashed: no terminal marker, not timed out, the PID is gone — incomplete.
  const crashed = !hasTerminal && !timedOut && !pidAlive && effPid !== null && effStartedMs !== null;

  let status = 'idle';
  let exitCode = null;
  if (p.complete && !p.verifyFail) {
    status = 'success';
    exitCode = 0;
  } else if (p.failedMarker || p.verifyFail) {
    status = 'failed';
    exitCode = p.exitCode != null ? p.exitCode : 1;
  } else if (timedOut) {
    status = 'timeout';
  } else if (crashed) {
    status = 'unknown';
  } else if (pidAlive || (effStartedMs && !hasTerminal)) {
    status = 'running';
  } else if (!effId && !effStartedMs && !raw.trim()) {
    status = 'idle';
  } else {
    status = 'unknown';
  }

  const verified = p.verifyPass && status === 'success';
  let finishedAt = p.finishedAt || (deployFinishedAt ? new Date(deployFinishedAt).toISOString() : null);
  if (status === 'running' || status === 'idle') finishedAt = null;

  const allLines = raw ? raw.split('\n') : [];
  const tail = allLines.slice(-maxLines);

  return {
    ok: true,
    deployId: effId || null,
    pid: effPid || null,
    status,
    startedAt: effStartedMs ? new Date(effStartedMs).toISOString() : null,
    finishedAt,
    commit: p.commit || null,
    branch: DEPLOY_BRANCH,
    logPath: DEPLOY_LOG,
    lastLines: tail,
    exitCode,
    verified,
    checks: p.checks,
    // ── Legacy/compat fields for older pollers ──
    lines: tail,
    complete: p.complete,
    failed: ['failed', 'timeout', 'unknown'].includes(status),
    verify: p.verifyPass ? 'pass' : p.verifyFail ? 'fail' : 'unknown',
    deploying: status === 'running',
    ageSeconds,
  };
}

async function getGithubJwks() {
  const cacheTtlMs = 60 * 60 * 1000;
  if (githubJwksCache.keys.length && Date.now() - githubJwksCache.fetchedAt < cacheTtlMs) {
    return githubJwksCache.keys;
  }

  const response = await fetch(GITHUB_OIDC_JWKS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Unable to fetch GitHub OIDC keys: HTTP ${response.status}`);
  }

  const jwks = await response.json();
  githubJwksCache = {
    fetchedAt: Date.now(),
    keys: Array.isArray(jwks.keys) ? jwks.keys : []
  };

  return githubJwksCache.keys;
}

async function getGithubSigningKey(kid) {
  const keys = await getGithubJwks();
  const jwk = keys.find((key) => key.kid === kid);
  if (jwk) {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  githubJwksCache = { fetchedAt: 0, keys: [] };
  const freshKeys = await getGithubJwks();
  const freshJwk = freshKeys.find((key) => key.kid === kid);
  if (!freshJwk) {
    throw new Error('GitHub OIDC signing key not found');
  }

  return crypto.createPublicKey({ key: freshJwk, format: 'jwk' });
}

async function verifyGithubOidcToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) {
    throw new Error('Invalid GitHub OIDC token header');
  }

  const signingKey = await getGithubSigningKey(decoded.header.kid);
  const payload = jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    audience: GITHUB_OIDC_AUDIENCE,
    issuer: GITHUB_OIDC_ISSUER
  });

  if (payload.repository !== GITHUB_DEPLOY_REPOSITORY) {
    throw new Error('GitHub OIDC repository is not allowed');
  }

  if (GITHUB_DEPLOY_REF && payload.ref !== GITHUB_DEPLOY_REF) {
    throw new Error('GitHub OIDC ref is not allowed');
  }

  return payload;
}

async function authorizeDeployRequest(req) {
  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (DEPLOY_SECRET && token === DEPLOY_SECRET) {
    return { method: 'deploy_secret' };
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const payload = await verifyGithubOidcToken(match[1]);
    return { method: 'github_oidc', repository: payload.repository, ref: payload.ref };
  }

  return null;
}

router.post('/', async (req, res) => {
  // Accept either the server deploy secret or a trusted GitHub Actions OIDC token.
  try {
    const auth = await authorizeDeployRequest(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    console.log('[deploy] Authorized request', auth.method, auth.repository || '', auth.ref || '');
  } catch (error) {
    console.warn('[deploy] Authorization failed:', error.message);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // Recover the true state from the log + PID liveness. This is robust across
  // the `pm2 reload` that restarts THIS process mid-deploy (which wipes the
  // in-memory deploy* vars but leaves the detached bash + its log running).
  const current = computeDeployStatus();

  // A deploy that is genuinely still running: attach to it, do NOT start a
  // second one. The caller polls /api/deploy/log (by deployId/PID) instead.
  if (current.status === 'running' && isPidAlive(current.pid)) {
    return res.json({
      ok: true,
      success: false,
      message: 'Deploy already in progress - attach via /api/deploy/log',
      inProgress: true,
      deployId: current.deployId,
      pid: current.pid,
      status: 'running',
      logPath: DEPLOY_LOG,
      startedAt: current.startedAt,
      ageSeconds: current.ageSeconds,
    });
  }

  // Otherwise any lock is stale: previous deploy finished, timed out, or its
  // PID is dead (crash / OOM / reboot). Clear it and start a clean deploy.
  if (deploying) {
    console.warn(`[deploy] Clearing stale lock before new deploy (prev status=${current.status}, pid=${current.pid}, alive=${isPidAlive(current.pid)})`);
  }
  deploying = true;
  deployId = newDeployId();
  deployStartedAt = Date.now();
  deployFinishedAt = null;
  deployPid = null;

  // Merge any whitelisted env vars into .env before the deploy command runs.
  // This happens synchronously in Node.js — values never touch a shell command.
  if (req.body?.env && typeof req.body.env === 'object') {
    try {
      mergeEnvFile(path.join(PROJECT_ROOT, '.env'), req.body.env);
    } catch (e) {
      console.error('[deploy] .env merge failed:', e.message);
    }
  }

  // Truncate the previous deploy's log so /api/deploy/log only ever reflects the
  // current run — stale markers from a prior deploy must not be read as this
  // run's terminal state.
  try {
    fs.writeFileSync(DEPLOY_LOG, '');
  } catch (e) {
    console.warn('[deploy] could not truncate deploy log:', e.message);
  }

  const job = runDetachedCommand(buildDeployCommand(deployId), { logFile: DEPLOY_LOG });
  deployPid = job.pid;
  console.log(`[deploy] launched deploy ${deployId} (PID ${deployPid})`);

  // Best-effort watcher to release the in-memory lock on a terminal state.
  // (This timer is lost if `pm2 reload` restarts the process — the log remains
  // the authoritative source of truth either way.)
  const interval = setInterval(() => {
    try {
      const st = computeDeployStatus();
      if (['success', 'failed', 'timeout', 'unknown'].includes(st.status)) {
        deploying = false;
        if (!deployFinishedAt) deployFinishedAt = Date.now();
        clearInterval(interval);
      }
    } catch {
      // ignore read errors
    }
  }, 10000);

  res.json({
    ok: true,
    success: true,
    message: 'Deploy triggered',
    deployId,
    pid: job.pid,
    status: 'running',
    logPath: job.logFile,
    startedAt: new Date(deployStartedAt).toISOString(),
  });
});

// ── Deploy log reader ─────────────────────────────────────────────────────────
// Returns the last N lines of the deploy log so GitHub Actions can poll for
// verification results without needing SSH or a public-IP-accessible server.
// Requires the same authentication as the deploy endpoint.
router.get('/log', async (req, res) => {
  try {
    const auth = await authorizeDeployRequest(req);
    if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  } catch {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const lines = Math.min(parseInt(req.query.lines, 10) || 200, 1000);
  try {
    // The full stable status contract, including `lastLines` (tail of the log).
    return res.json(computeDeployStatus(lines));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Lightweight status (small log tail) — same auth, for quick supervision polls.
router.get('/status', async (req, res) => {
  try {
    const auth = await authorizeDeployRequest(req);
    if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  } catch {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return res.json(computeDeployStatus(50));
});

module.exports = router;
