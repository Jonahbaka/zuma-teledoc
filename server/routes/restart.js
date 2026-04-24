const express = require('express');
const router = express.Router();
const { runDetachedCommand } = require('./run-detached-command');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
const CRONOPS_ROOT = '/home/ec2-user/zuma-teledoc/cronops';

/**
 * Emergency restart endpoint
 * POST /api/restart?token=<secret>
 *
 * Hard kills and restarts PM2 apps immediately.
 * Useful when stuck (no git pull, no build, just restart).
 */

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'] || req.query.token;
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.json({ success: true, message: 'Restart initiated' });

  const cmd = [
    'pkill -9 -f "node server" || true',
    'pkill -9 -f "pm2" || true',
    'sleep 2',
    'cd /home/ec2-user/zuma-teledoc',
    'pm2 delete all 2>/dev/null || true',
    'sleep 1',
    'pm2 start npm --name doctarx -- start',
    `pm2 start npm --name cronops --cwd ${CRONOPS_ROOT} -- run start:prod`,
  ].join(' && ');

  const job = runDetachedCommand(cmd, {
    logFile: '/tmp/doctarx-restart.log',
  });

  console.log('[RESTART] queued', job);
});

module.exports = router;
