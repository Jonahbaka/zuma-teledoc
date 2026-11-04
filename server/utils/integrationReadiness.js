'use strict';

function demoIntegrationsEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_SYNTHETIC_INTEGRATIONS === 'true';
}

function integrationUnavailable(capability) {
  const error = new Error(`${capability} is not connected. Partner activation is required.`);
  error.statusCode = 503;
  error.code = 'INTEGRATION_NOT_ACTIVATED';
  return error;
}

function requireSyntheticIntegration(capability) {
  if (!demoIntegrationsEnabled()) throw integrationUnavailable(capability);
}

function requireLegacyPrescriptionTransport() {
  // This legacy service has no external transport. Keep signed intent creation
  // in the existing eRx workflow; never manufacture a pharmacy delivery here.
  throw integrationUnavailable('Legacy prescription delivery');
}

module.exports = { demoIntegrationsEnabled, integrationUnavailable, requireSyntheticIntegration, requireLegacyPrescriptionTransport };
