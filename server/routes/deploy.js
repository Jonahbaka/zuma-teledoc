const express = require('express');
const router = express.Router();
const { buildDeployCommand } = require('./deploy-command');
const { runDetachedCommand } = require('./run-detached-command');
const fs = require('fs');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
if (!DEPLOY_SECRET) {
  console.error('FATAL: DEPLOY_SECRET env var is not set. Deploy endpoint is disabled.');
}

let deploying = false;
const DEPLOY_LOG = '/tmp/doctarx-deploy.log';
const DEPLOY_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min safety timeout
let deployStartedAt = null;

function isDeployStuck() {
  if (!deploying || !deployStartedAt) return false;
  return Date.now() - deployStartedAt > DEPLOY_LOCK_TIMEOUT_MS;
}

router.post('/', (req, res) => {
  // Require DEPLOY_SECRET to be explicitly set — no insecure fallback
  if (!DEPLOY_SECRET) {
    return res.status(503).json({ success: false, error: 'Deploy endpoint not configured. Set DEPLOY_SECRET env var.' });
  }

  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (token !== DEPLOY_SECRET) {
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
