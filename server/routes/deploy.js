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
    [
      'cd /home/ec2-user/zuma-teledoc',
      'git pull origin main',
      'npm install',
      'npm run build',
      // Symlink _next -> .next so nginx try_files can resolve /_next/static/ paths
      'ln -sfn .next _next',
      // Patch any nginx conf that still references the old ubuntu home path
      "sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true",
      // Reload nginx if config is valid
      'sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true',
      'pm2 restart doctarx',
      'pm2 restart cronops',
    ].join(' && '),
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
