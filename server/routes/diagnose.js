const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

router.get('/', (req, res) => {
  try {
    const projectRoot = '/home/ec2-user/zuma-teledoc';
    const nextDir = path.join(projectRoot, '.next');
    
    const diagnostics = {
      projectRoot,
      projectExists: fs.existsSync(projectRoot),
      nextDirExists: fs.existsSync(nextDir),
      nextDirSize: null,
      nextDirFiles: [],
      nodeModulesExists: fs.existsSync(path.join(projectRoot, 'node_modules')),
      packageJsonExists: fs.existsSync(path.join(projectRoot, 'package.json')),
      pmStatus: null,
      timestamp: new Date().toISOString()
    };

    if (diagnostics.nextDirExists) {
      try {
        const stat = fs.statSync(nextDir);
        diagnostics.nextDirSize = stat.size;
        diagnostics.nextDirFiles = fs.readdirSync(nextDir).slice(0, 10);
      } catch (e) {
        diagnostics.nextDirError = e.message;
      }
    }

    // Check PM2 status
    try {
      const pmOutput = execSync('pm2 status doctarx 2>&1 || echo "not running"', {
        encoding: 'utf-8',
        timeout: 5000
      }).trim();
      diagnostics.pmStatus = pmOutput;
    } catch (e) {
      diagnostics.pmError = e.message;
    }

    res.json(diagnostics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
