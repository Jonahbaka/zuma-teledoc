const express = require('express');
const router = express.Router();
const { exec } = require('child_process');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
let deploying = false;

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (deploying) {
    return res.json({ success: false, message: 'Deploy already in progress — skipping' });
  }

  deploying = true;
  res.json({ success: true, message: 'Deploy triggered' });

  const cmd = [
    'cd /home/ec2-user/zuma-teledoc',
    'git pull origin main',
    'npm install --prefer-offline',
    'npm run build',
    // Symlink _next -> .next so nginx try_files resolves /_next/static/ paths
    'ln -sfn .next _next',
    // Fix stale ubuntu path in nginx confs; reload if valid
    "sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true",
    'sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true',
    'pm2 restart doctarx',
    'pm2 restart cronops',
  ].join(' && ');

  exec(cmd, { timeout: 1800000 /* 30 min */ }, (err, stdout, stderr) => {
    deploying = false;
    if (err) console.error('[DEPLOY] Error:', err.message);
    if (stdout) console.log('[DEPLOY] stdout:', stdout);
    if (stderr) console.log('[DEPLOY] stderr:', stderr);
    console.log('[DEPLOY] Complete');
  });
});

module.exports = router;
