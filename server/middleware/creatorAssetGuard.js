'use strict';

const { isLegacyCreatorAssetPath } = require('../../lib/legacyCreatorAssets.cjs');

// Must run before generic uploads, Next's public files, and the warmup handler.
module.exports = function creatorAssetGuard(req, res, next) {
  if (!isLegacyCreatorAssetPath(req.path) && !isLegacyCreatorAssetPath(req.originalUrl || req.url)) return next();
  return res.set('Cache-Control', 'private, no-store').status(404).end();
};
