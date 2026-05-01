const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * Emergency build upload endpoint
 * POST /api/upload-build?token=<deploy-token>
 * 
 * Receives a base64-encoded tarball of the .next directory
 * Extracts it to /home/ec2-user/zuma-teledoc/.next
 * Restarts PM2
 * 
 * Usage:
 * cd /path/to/zuma-teledoc
 * tar -czf next.tar.gz .next/
 * base64 next.tar.gz > next.b64
 * curl -X POST https://doctarx.com/api/upload-build \
 *   -H "Content-Type: application/json" \
 *   -d @- < next.b64 \
 *   -H "x-deploy-token: doctarx-deploy-2026"
 */

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';
const CRONOPS_ROOT = '/home/ec2-user/zuma-teledoc/cronops';

router.post('/', (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // Get the base64 data from raw body
  let base64Data = '';
  req.on('data', chunk => {
    base64Data += chunk.toString();
  });

  req.on('end', async () => {
    try {
      // Decode base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      const tmpFile = '/tmp/next-build.tar.gz';
      
      // Write to temp file
      fs.writeFileSync(tmpFile, buffer);
      
      // Extract to project root
      const projectRoot = '/home/ec2-user/zuma-teledoc';
      const cmd = [
        `cd ${projectRoot}`,
        `tar -xzf ${tmpFile}`,
        `rm ${tmpFile}`,
        `(pm2 restart ${PM2_APP_NAME} --update-env || pm2 start npm --name ${PM2_APP_NAME} -- start)`,
        `(pm2 restart cronops --update-env || pm2 start npm --name cronops --cwd ${CRONOPS_ROOT} -- run start:prod)`,
      ].join(' && ');
      
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('[BUILD-UPLOAD] Error:', err.message);
          return res.status(500).json({
            success: false,
            error: err.message,
            stderr: stderr || ''
          });
        }
        
        console.log('[BUILD-UPLOAD] Success:', stdout);
        res.json({
          success: true,
          message: 'Build extracted and PM2 restarted',
          stdout: stdout || 'OK'
        });
      });
    } catch (err) {
      console.error('[BUILD-UPLOAD] Parse error:', err.message);
      res.status(400).json({
        success: false,
        error: err.message
      });
    }
  });
});

module.exports = router;
