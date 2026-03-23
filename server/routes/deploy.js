const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { buildDeployCommand } = require('./deploy-command');

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
  res.json({ success: true, message: 'Deploy triggered' });

  exec(buildDeployCommand(), { timeout: 1800000 /* 30 min */ }, (err, stdout, stderr) => {
    deploying = false;
    if (err) console.error('[DEPLOY] Error:', err.message);
    if (stdout) console.log('[DEPLOY] stdout:', stdout);
    if (stderr) console.log('[DEPLOY] stderr:', stderr);
    console.log('[DEPLOY] Complete');
  });
});

module.exports = router;
