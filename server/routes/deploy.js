const express = require('express');
const router = express.Router();
const { exec } = require('child_process');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.json({ success: true, message: 'Deploy triggered' });

  exec(
    'cd /home/ec2-user/zuma-teledoc && git pull origin main && npm install && npm run build && pm2 restart doctarx && pm2 restart cronops',
    { timeout: 600000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[DEPLOY] Error:', err.message);
      }
      if (stdout) console.log('[DEPLOY] stdout:', stdout);
      if (stderr) console.log('[DEPLOY] stderr:', stderr);
    }
  );
});

module.exports = router;
