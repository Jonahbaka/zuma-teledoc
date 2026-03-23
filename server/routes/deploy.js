const express = require('express');
const router = express.Router();
const { buildDeployCommand } = require('./deploy-command');
const { runDetachedCommand } = require('./run-detached-command');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
let deploying = false;

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (deploying) {
    return res.json({ success: false, message: 'Deploy already in progress - skipping' });
  }

  deploying = true;
  const job = runDetachedCommand(buildDeployCommand(), {
    logFile: '/tmp/doctarx-deploy.log',
  });

  res.json({
    success: true,
    message: 'Deploy triggered',
    logFile: job.logFile,
    pid: job.pid,
  });
});

module.exports = router;
