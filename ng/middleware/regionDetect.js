/**
 * Region Detection Middleware
 * Automatically detects user region from URL, headers, or user profile
 */

const { getRegion } = require('../../shared/config/regions');

function regionDetect(req, res, next) {
  // Priority 1: Explicit /api/ng/ path
  if (req.path.startsWith('/api/ng/') || req.path.startsWith('/ng/')) {
    req.region = getRegion('NG');
    req.regionCode = 'NG';
    next();
    return;
  }

  // Priority 2: X-Region header
  const headerRegion = req.headers['x-region'];
  if (headerRegion) {
    try {
      req.region = getRegion(headerRegion);
      req.regionCode = headerRegion.toUpperCase();
      next();
      return;
    } catch (e) {
      // Fall through
    }
  }

  // Priority 3: User profile region (from auth)
  if (req.user?.region) {
    try {
      req.region = getRegion(req.user.region);
      req.regionCode = req.user.region;
      next();
      return;
    } catch (e) {
      // Fall through
    }
  }

  // Default: US
  req.region = getRegion('US');
  req.regionCode = 'US';
  next();
}

module.exports = regionDetect;
