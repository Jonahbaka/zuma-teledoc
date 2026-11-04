'use strict';
const path = require('node:path');
module.exports = function privateCredentialUploads(req, res, next) {
  let pathname;
  try { pathname = path.posix.normalize('/' + decodeURIComponent(req.path).replace(/\\/g, '/')); }
  catch { return res.sendStatus(400); }
  if (pathname.split('/').filter(Boolean)[0]?.toLowerCase() === 'credentialing') {
    return res.set('Cache-Control', 'no-store').sendStatus(404);
  }
  next();
};
