const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

router.get('/', (req, res) => {
  try {
    const projectRoot = process.cwd();
    const creatorFile = path.join(projectRoot, 'server', 'routes', 'creator.js');
    const indexFile = path.join(projectRoot, 'server', 'index.js');
    
    const diagnosis = {
      timestamp: new Date().toISOString(),
      projectRoot,
      files: {
        creatorExists: fs.existsSync(creatorFile),
        creatorSize: fs.existsSync(creatorFile) ? fs.statSync(creatorFile).size : 0,
        indexExists: fs.existsSync(indexFile),
      },
      gitStatus: null,
      lastCommit: null,
      nodeVersion: process.version,
      pmid: process.env.pm_id,
    };

    try {
      diagnosis.gitStatus = execSync('git status --short', { cwd: projectRoot, encoding: 'utf-8' });
      diagnosis.lastCommit = execSync('git log --oneline -1', { cwd: projectRoot, encoding: 'utf-8' });
    } catch (e) {
      diagnosis.gitError = e.message;
    }

    // Check if creator route is in index.js
    if (fs.existsSync(indexFile)) {
      const indexContent = fs.readFileSync(indexFile, 'utf-8');
      diagnosis.creatorRoutedInIndex = indexContent.includes("loadRoute('/api/creator'");
    }

    res.json({ success: true, diagnosis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
