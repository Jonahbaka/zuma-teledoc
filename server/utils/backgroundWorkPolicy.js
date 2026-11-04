'use strict';

// A release health-check process must not compete with the serving application
// for scheduled work. This never grants an otherwise unavailable capability.
function backgroundWorkAllowed(env = process.env) {
  return env.DOCTARX_DEPLOY_CHECK !== 'true' && env.DISABLE_SCHEDULERS !== 'true';
}

module.exports = { backgroundWorkAllowed };
