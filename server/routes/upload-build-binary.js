const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const multer = require('multer');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';

// Setup multer for file upload (no size limit)
const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

/**
 * Binary upload endpoint
 * POST /api/upload-build-binary (multipart/form-data)
 * 
 * curl -X POST https://doctarx.com/api/upload-build-binary \
 *   -H "x-deploy-token: doctarx-deploy-2026" \
 *   -F "tarball=@/tmp/next-minimal.tar.gz"
 */

router.post('/', upload.single('tarball'), (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const tmpFile = req.file.path;
  res.json({
    success: true,
    message: 'Upload received, extracting...',
    fileSize: req.file.size
  });

  // Extract in background
  const projectRoot = '/home/ec2-user/zuma-teledoc';
  const cmd = `cd ${projectRoot} && tar -xzf ${tmpFile} && rm ${tmpFile} && pm2 restart doctarx cronops`;

  exec(cmd, { timeout: 300000 /* 5 min */ }, (err, stdout, stderr) => {
    if (err) {
      console.error('[BUILD-UPLOAD-BINARY] Error:', err.message);
      console.error('[BUILD-UPLOAD-BINARY] stderr:', stderr);
    } else {
      console.log('[BUILD-UPLOAD-BINARY] ✅ Success');
    }
  });
});

module.exports = router;
