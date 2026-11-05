'use strict';
const { shouldNoIndex } = require('../../lib/seo/public-seo-config.cjs');
module.exports = function searchIndexPolicy(req, res, next) {
  if (shouldNoIndex(req.originalUrl || req.url)) res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet');
  next();
};
