'use strict';

// A .next directory is not a complete prior release. Until immutable backend,
// dependencies/configuration and schema compatibility are implemented and
// rehearsed, no environment variable, request flag or green CI can enable deploy.
const CODE = 'DEPLOYMENT_ROLLBACK_UNVERIFIED';
const MESSAGE = 'Release deployment is blocked: complete-release rollback has not been verified.';

function assertReleaseRollbackReady() {
  const error = new Error(MESSAGE);
  error.code = CODE;
  error.statusCode = 503;
  throw error;
}

function blockReleaseMutation(req, res, next) {
  if (req.method !== 'POST') return next();
  return res.status(503).json({ success: false, code: CODE, error: MESSAGE });
}

module.exports = { CODE, MESSAGE, assertReleaseRollbackReady, blockReleaseMutation };
