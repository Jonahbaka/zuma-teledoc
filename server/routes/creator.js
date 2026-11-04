'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

/**
 * Legacy creator endpoints have no real upload, generation, publishing,
 * scheduling, analytics, or owner-scoped storage implementation. Keep the
 * namespace closed until those capabilities have an authenticated, verified
 * implementation. Historical ownerless public JSON is not trusted content.
 *
 * Do not read request-controlled paths, load legacy metadata, create directories,
 * or manufacture successful operations, statistics, post IDs or platform URLs.
 */
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.use(authenticate);
router.use((_req, res) => res.status(503).json({
  success: false,
  code: 'CREATOR_UNAVAILABLE',
  error: 'Creator uploads, content generation, publishing, scheduling and analytics are unavailable.',
}));

module.exports = router;
