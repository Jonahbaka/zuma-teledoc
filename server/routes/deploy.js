const express = require('express');
const router = express.Router();
const { buildDeployCommand } = require('./deploy-command');
const { runDetachedCommand } = require('./run-detached-command');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
if (!DEPLOY_SECRET) {
  console.error('WARNING: DEPLOY_SECRET env var is not set. Deploy endpoint will only accept trusted GitHub OIDC.');
}

let deploying = false;
const DEPLOY_LOG = '/tmp/doctarx-deploy.log';
const DEPLOY_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min safety timeout
let deployStartedAt = null;
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

  if (deploying) {
    return res.json({ success: false, message: 'Deploy already in progress - skipping' });
  }

  deploying = true;
  deployStartedAt = Date.now();

  const job = runDetachedCommand(buildDeployCommand(), { logFile: DEPLOY_LOG });

  // Watch for deploy completion via log file tail and reset flag
  const interval = setInterval(() => {
    try {
      const log = fs.existsSync(DEPLOY_LOG) ? fs.readFileSync(DEPLOY_LOG, 'utf8') : '';
      const done = log.includes('pm2 start') && (log.includes('[PM2]') || log.includes('online'));
      const failed = log.includes('npm ERR!') || log.includes('Build failed');
      if (done || failed || isDeployStuck()) {
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

module.exports = router;
