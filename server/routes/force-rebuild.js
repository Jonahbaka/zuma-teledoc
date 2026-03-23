const express = require('express');
const router = express.Router();
const { buildDeployCommand } = require('./deploy-command');
const { runDetachedCommand } = require('./run-detached-command');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
let rebuilding = false;

/**
 * Manual rebuild endpoint.
 * POST /api/force-rebuild
 *
 * Normal deploys now rebuild by default, but this remains available
 * as an explicit recovery hook for stale runtime state.
 */

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (rebuilding) {
    return res.json({ success: false, message: 'Force rebuild already in progress - skipping' });
  }

  rebuilding = true;
  const job = runDetachedCommand(buildDeployCommand(), {
    logFile: '/tmp/doctarx-force-rebuild.log',
  });

  res.json({
    success: true,
    message: 'Force rebuild initiated',
    logFile: job.logFile,
    pid: job.pid,
  });
});

module.exports = router;
