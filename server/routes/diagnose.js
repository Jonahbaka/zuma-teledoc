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

    // NG diagnostics
    const ngRoutesFile = path.join(projectRoot, 'ng', 'routes', 'index.js');
    const ngDbFile = path.join(projectRoot, 'server', 'db', 'index.js');
    diagnosis.ng = {
      routesFileExists: fs.existsSync(ngRoutesFile),
      ngDirExists: fs.existsSync(path.join(projectRoot, 'ng')),
      ngConfigExists: fs.existsSync(path.join(projectRoot, 'ng', 'config', 'index.js')),
      dbHasGetPool: false,
      routeLoadError: null,
    };
    // Check if db exports getPool
    try {
      const dbMod = require('../db');
      diagnosis.ng.dbHasGetPool = typeof dbMod.getPool === 'function';
    } catch (e) {
      diagnosis.ng.dbHasGetPool = 'error: ' + e.message;
    }
    // Try loading NG routes
    try {
      require('../../ng/routes');
      diagnosis.ng.routeLoadError = null;
      diagnosis.ng.routesLoaded = true;
    } catch (e) {
      diagnosis.ng.routeLoadError = e.message;
      diagnosis.ng.routeLoadStack = e.stack?.split('\n').slice(0, 5).join('\n');
      diagnosis.ng.routesLoaded = false;
    }

    res.json({ success: true, diagnosis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
