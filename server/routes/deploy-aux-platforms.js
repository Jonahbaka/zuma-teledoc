const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const uploadBuildBinaryRoute = require('./upload-build-binary');

const router = express.Router();

const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const SCRIPT_PATH = `${PROJECT_ROOT}/.github/scripts/deploy_aux_platforms.sh`;
const DEPLOY_LOG = '/tmp/doctarx-aux-platform-deploy.log';
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '';
const PUBLIC_IP = process.env.DOCTARX_PUBLIC_IP || '18.217.97.145';
const MAX_LOG_LINES = 500;
const authorizeDeployRequest = uploadBuildBinaryRoute._test.authorizeDeployRequest;

function safeSecretEqual(received, expected = DEPLOY_SECRET) {
  if (!expected || !received) return false;
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function authorizeRequest(req) {
  if (safeSecretEqual(req.headers['x-deploy-token'])) return { method: 'deploy_secret' };
  return authorizeDeployRequest(req);
}

function safeSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLog() {
  try {
    return fs.readFileSync(DEPLOY_LOG, 'utf8');
  } catch {
    return '';
  }
}

function parseStatus(raw = '', pidAlive = isPidAlive) {
  const pidMatch = raw.match(/\[aux-api:pid\]\s+(\d+)/);
  const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : null;
  const success = raw.includes('[aux-deploy:result] success');
  const failed = raw.includes('[aux-deploy:result] failure');
  const alive = pid ? pidAlive(pid) : false;
  let status = 'idle';
  if (success) status = 'success';
  else if (failed) status = 'failed';
  else if (alive) status = 'running';
  else if (raw.trim()) status = 'failed';

  const lines = raw.split(/\r?\n/).filter(Boolean);
  return {
    status,
    pid,
    alive,
    complete: success || failed,
    lastLines: lines.slice(-MAX_LOG_LINES),
  };
}

async function authenticated(req, res) {
  try {
    const auth = await authorizeRequest(req);
    if (auth) return auth;
  } catch {
    // Authentication details are intentionally not exposed to callers.
  }
  res.status(401).json({ success: false, error: 'Unauthorized' });
  return null;
}

router.post('/', async (req, res) => {
  if (!await authenticated(req, res)) return;

  const nestoraSha = safeSha(req.body?.nestoraSha);
  const nursingSha = safeSha(req.body?.nursingSha);
  if (!nestoraSha || !nursingSha) {
    return res.status(400).json({ success: false, error: 'Two full commit SHAs are required' });
  }
  if (!fs.existsSync(SCRIPT_PATH)) {
    return res.status(503).json({ success: false, error: 'Auxiliary deploy script is unavailable' });
  }

  const current = parseStatus(readLog());
  if (current.status === 'running') {
    return res.status(409).json({ success: false, error: 'Auxiliary deployment is already running', ...current });
  }

  fs.writeFileSync(
    DEPLOY_LOG,
    `[aux-api] start ${new Date().toISOString()}\n`,
    { mode: 0o600 }
  );
  const output = fs.openSync(DEPLOY_LOG, 'a');
  let child;
  try {
    child = spawn('bash', [SCRIPT_PATH], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ['ignore', output, output],
      env: {
        ...process.env,
        NESTORA_SHA: nestoraSha,
        NURSING_SHA: nursingSha,
        PUBLIC_IP,
      },
    });
  } catch (error) {
    fs.closeSync(output);
    fs.appendFileSync(DEPLOY_LOG, `[aux-deploy:result] failure exit=spawn\n`);
    return res.status(500).json({ success: false, error: 'Auxiliary deployment could not start' });
  }

  fs.closeSync(output);
  fs.appendFileSync(DEPLOY_LOG, `[aux-api:pid] ${child.pid}\n`);
  child.once('error', () => {
    fs.appendFileSync(DEPLOY_LOG, '[aux-deploy:result] failure exit=spawn\n');
  });
  child.unref();

  return res.status(202).json({ success: true, status: 'running', pid: child.pid });
});

router.get('/status', async (req, res) => {
  if (!await authenticated(req, res)) return;
  return res.json({ success: true, ...parseStatus(readLog()) });
});

router._test = {
  authorizeRequest,
  parseStatus,
  safeSecretEqual,
  safeSha,
};

module.exports = router;
