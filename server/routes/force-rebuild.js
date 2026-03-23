const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { buildDeployCommand } = require('./deploy-command');

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
  res.json({ success: true, message: 'Force rebuild initiated' });

  exec(buildDeployCommand(), { timeout: 1800000 /* 30 min */ }, (err, stdout, stderr) => {
    rebuilding = false;
    if (err) {
      console.error('[FORCE-REBUILD] Error:', err.message);
      if (stderr) console.error('[FORCE-REBUILD] stderr:', stderr);
    } else {
      console.log('[FORCE-REBUILD] Complete');
    }
    if (stdout) console.log('[FORCE-REBUILD] stdout:', stdout.slice(-500));
  });
});

module.exports = router;
