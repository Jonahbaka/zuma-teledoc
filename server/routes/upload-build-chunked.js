const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const multer = require('multer');

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || 'doctarx-deploy-2026';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';
const CHUNK_DIR = '/tmp/build-chunks';

// Ensure chunk directory exists
fs.mkdirSync(CHUNK_DIR, { recursive: true });

const upload = multer({
  dest: CHUNK_DIR,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per chunk
});

/**
 * Chunked upload endpoint
 * Upload chunks, then call /assemble?token=X to reconstruct and deploy
 *
 * curl -F "chunk=@chunk_aa" -H "x-deploy-token: doctarx-deploy-2026" \
 *      https://doctarx.com/api/upload-build-chunked
 * curl -F "chunk=@chunk_ab" -H "x-deploy-token: doctarx-deploy-2026" \
 *      https://doctarx.com/api/upload-build-chunked
 * curl -X POST https://doctarx.com/api/upload-build-chunked?assemble=1 \
 *      -H "x-deploy-token: doctarx-deploy-2026"
 */

router.post('/', upload.single('chunk'), (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const chunkName = req.query.name || `chunk_${Date.now()}`;
  const finalPath = path.join(CHUNK_DIR, chunkName);
  fs.renameSync(req.file.path, finalPath);

  const chunks = fs.readdirSync(CHUNK_DIR).filter(f => f.startsWith('chunk_')).sort();
  
  res.json({
    success: true,
    message: `Chunk received (${chunks.length} total)`,
    chunkName,
    totalChunks: chunks.length,
    fileSize: req.file.size,
    chunks
  });
});

// Assemble chunks and deploy
router.post('/assemble', (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (token !== DEPLOY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const chunks = fs.readdirSync(CHUNK_DIR)
    .filter(f => f.startsWith('chunk_'))
    .sort();

  if (chunks.length === 0) {
    return res.status(400).json({ success: false, error: 'No chunks found' });
  }

  res.json({
    success: true,
    message: `Assembling ${chunks.length} chunks...`,
    chunks
  });

  // Assemble in background
  const tmpFile = path.join(CHUNK_DIR, 'next.tar.gz');
  const chunkPaths = chunks.map(c => path.join(CHUNK_DIR, c)).join(' ');
  const projectRoot = '/home/ec2-user/zuma-teledoc';

  const cmd = [
    `cat ${chunkPaths} > ${tmpFile}`,
    `cd ${projectRoot}`,
    `tar -xzf ${tmpFile}`,
    `rm ${tmpFile} ${chunkPaths}`,
    `pm2 restart ${PM2_APP_NAME} cronops`
  ].join(' && ');

  exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[BUILD-CHUNKED-ASSEMBLE] Error:', err.message);
    } else {
      console.log('[BUILD-CHUNKED-ASSEMBLE] ✅ Complete');
    }
    // Cleanup
    try {
      fs.rmSync(CHUNK_DIR, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  });
});

module.exports = router;
