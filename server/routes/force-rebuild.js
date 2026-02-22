const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';

/**
 * Force Rebuild Endpoint
 * POST /api/force-rebuild
 * 
 * When Next.js files are changed, the normal webhook won't rebuild
 * because .next/ already exists. This endpoint force-deletes .next
 * and triggers a full rebuild.
 * 
 * Usage:
 * curl -X POST https://doctarx.com/api/force-rebuild \
 *   -H "x-deploy-token: doctarx-deploy-2026"
 */

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.json({ success: true, message: 'Force rebuild initiated' });

  const projectRoot = '/home/ec2-user/zuma-teledoc';
  const cmd = [
    `cd ${projectRoot}`,
    'git pull origin main || true',
    'rm -rf .next', // Force delete .next
    'rm -rf .turbo', // Clear turbo cache
    'npm run build',
    'pm2 restart doctarx cronops',
  ].join(' && ');

  exec(cmd, { timeout: 1800000 /* 30 min */ }, (err, stdout, stderr) => {
    if (err) {
      console.error('[FORCE-REBUILD] Error:', err.message);
      if (stderr) console.error('[FORCE-REBUILD] stderr:', stderr);
    } else {
      console.log('[FORCE-REBUILD] ✅ Complete');
    }
    if (stdout) console.log('[FORCE-REBUILD] stdout:', stdout.slice(-500)); // Last 500 chars
  });
});

module.exports = router;
