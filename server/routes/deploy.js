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
let deployStartedAt = null;
let deployPid = null; // PID of the detached bash process running the current deploy
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const GITHUB_OIDC_AUDIENCE = process.env.DEPLOY_GITHUB_OIDC_AUDIENCE || 'doctarx-deploy';
const GITHUB_DEPLOY_REPOSITORY = process.env.DEPLOY_GITHUB_REPOSITORY || 'Jonahbaka/zuma-teledoc';
const GITHUB_DEPLOY_REF = process.env.DEPLOY_GITHUB_REF || 'refs/heads/main';
let githubJwksCache = { fetchedAt: 0, keys: [] };

function isDeployStuck() {
  if (!deploying || !deployStartedAt) return false;
  return Date.now() - deployStartedAt > DEPLOY_LOCK_TIMEOUT_MS;
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

// Derive the terminal/in-flight state of the current (or last) deploy from the
// log markers plus PID liveness. The detached bash script is guaranteed to end
// in exactly one of `[deploy] complete` / `[deploy] failed`; if neither marker
// is present and the PID is dead, the process crashed (e.g. OOM-killed) and the
// deploy is incomplete — never report that as success.
function computeDeployStatus() {
  const raw = readDeployLog();
  const complete = raw.includes('[deploy] complete');
  const verifyPass = raw.includes('[verify:result] PASS');
  const verifyFail = raw.includes('[verify:result] FAIL');
  const markedFailed =
    raw.includes('[deploy] failed') ||
    raw.includes('npm ERR!') ||
    raw.includes('Build failed');
  const pidAlive = isPidAlive(deployPid);
  // Crashed: still flagged as deploying, the process is gone, and no terminal
  // marker was ever written.
  const crashed = !complete && !markedFailed && !pidAlive && deployPid !== null && deploying;
  const timedOut = isDeployStuck();

  let status;
  if (complete && !verifyFail) status = 'success';
  else if (markedFailed || verifyFail) status = 'failed';
  else if (crashed) status = 'crashed';
  else if (timedOut) status = 'timeout';
  else if (deploying || pidAlive) status = 'running';
  else status = 'idle';

  return {
    status,
    complete,
    failed: markedFailed || verifyFail || crashed || timedOut,
    verify: verifyPass ? 'pass' : verifyFail ? 'fail' : 'unknown',
    pid: deployPid,
    pidAlive,
    crashed,
    timedOut,
    deploying,
    ageSeconds: deployStartedAt ? Math.round((Date.now() - deployStartedAt) / 1000) : null,
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

  // Release stuck lock automatically after timeout
  if (isDeployStuck()) {
    console.warn('[deploy] Releasing stale deploy lock (exceeded 30m timeout)');
    deploying = false;
    deployStartedAt = null;
  }

  // Release a stale lock left behind by a crashed deploy: the process is gone
  // but no terminal marker was written (e.g. OOM-kill / instance reboot).
  if (deploying && deployPid !== null && !isPidAlive(deployPid)) {
    const log = readDeployLog();
    if (!log.includes('[deploy] complete')) {
      console.warn(`[deploy] Previous deploy PID ${deployPid} is dead without completing — clearing stale lock`);
    }
    deploying = false;
    deployStartedAt = null;
  }

  // A deploy that is genuinely still running: do NOT start a second one. The
  // caller should attach to the existing deploy by polling /api/deploy/log.
  if (deploying && isPidAlive(deployPid)) {
    const st = computeDeployStatus();
    return res.json({
      success: false,
      message: 'Deploy already in progress - attach via /api/deploy/log',
      inProgress: true,
      pid: deployPid,
      logFile: DEPLOY_LOG,
      ageSeconds: st.ageSeconds,
    });
  }

  deploying = true;
  deployStartedAt = Date.now();

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

  const job = runDetachedCommand(buildDeployCommand(), { logFile: DEPLOY_LOG });
  deployPid = job.pid;
  console.log(`[deploy] launched detached deploy PID ${deployPid}`);

  // Watch for a terminal state and release the lock. The detached script writes
  // exactly one terminal marker; we also release if the process dies without a
  // marker (crash) or the safety timeout is exceeded.
  const interval = setInterval(() => {
    try {
      const log = readDeployLog();
      const done = log.includes('[deploy] complete');
      const failed = log.includes('[deploy] failed')
        || log.includes('npm ERR!')
        || log.includes('Build failed');
      const crashed = !done && !failed && !isPidAlive(deployPid);
      if (done || failed || crashed || isDeployStuck()) {
        if (crashed) {
          console.warn(`[deploy] PID ${deployPid} exited without a terminal marker — treating as failed`);
        }
        deploying = false;
        deployStartedAt = null;
        clearInterval(interval);
      }
    } catch {
      // ignore read errors
    }
  }, 10000);

  res.json({
    success: true,
    message: 'Deploy triggered',
    logFile: job.logFile,
    pid: job.pid,
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
    const st = computeDeployStatus();
    if (!fs.existsSync(DEPLOY_LOG)) {
      return res.json({ ok: true, ...st, lines: [], raw: '' });
    }
    const raw = fs.readFileSync(DEPLOY_LOG, 'utf8');
    const all = raw.split('\n');
    const tail = all.slice(-lines);
    // `complete`/`failed`/`deploying` kept at top level for backward
    // compatibility with the polling workflow; `status` carries the full state.
    res.json({ ok: true, ...st, lines: tail, raw: tail.join('\n') });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Lightweight status (no log body) — same auth, for quick supervision polls.
router.get('/status', async (req, res) => {
  try {
    const auth = await authorizeDeployRequest(req);
    if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  } catch {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  res.json({ ok: true, ...computeDeployStatus() });
});

module.exports = router;
