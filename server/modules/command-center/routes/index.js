/**
 * Command Center Routes Index
 * Mounts all command center related routes
 * @module command-center/routes
 */

const express = require('express');
const inboxRoutes = require('./inbox.routes');
const campaignRoutes = require('./campaign.routes');
const healthbotRoutes = require('./healthbot.routes');

const router = express.Router();

// Mount routes
router.use('/inbox', inboxRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/healthbot', healthbotRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    module: 'command-center',
    status: 'operational'
  });
});

module.exports = router;

