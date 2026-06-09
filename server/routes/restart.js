const express = require('express');
const router = express.Router();
const { runDetachedCommand } = require('./run-detached-command');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
const CRONOPS_ROOT = '/home/ec2-user/zuma-teledoc/cronops';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';

/**
 * Emergency restart endpoint
 * POST /api/restart?token=<secret>
 *
 * Restarts the app under PM2 without pulling or building.
 * Useful when the app is stuck but the checked-out build is valid.
 */

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'] || req.query.token;
  if (!DEPLOY_SECRET || token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.json({ success: true, message: 'Restart initiated' });

  const cmd = [
    'cd /home/ec2-user/zuma-teledoc',
    '(pm2 delete doctarx 2>/dev/null || true)',
    'sleep 1',
    `(pm2 restart ${PM2_APP_NAME} --update-env || pm2 start npm --name ${PM2_APP_NAME} -- start)`,
    `(pm2 restart cronops --update-env || pm2 start npm --name cronops --cwd ${CRONOPS_ROOT} -- run start:prod)`,
  ].join(' && ');

  const job = runDetachedCommand(cmd, {
    logFile: '/tmp/doctarx-restart.log',
  });

  console.log('[RESTART] queued', job);
});

module.exports = router;
