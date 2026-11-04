const { createUberDirectProvider, CourierProviderError } = require('./uberDirectProvider');

function createCourierProvider(options = {}) {
  const env = options.env || process.env;
  if (env.NG_COURIER_PROVIDER && env.NG_COURIER_PROVIDER !== 'uber_direct') {
    // Kwik/HealthPlus require verified commercial API and webhook contracts first.
    throw new CourierProviderError('COURIER_PROVIDER_UNSUPPORTED', 'This courier provider is not approved for activation');
  }
  return createUberDirectProvider(options);
}

module.exports = { createCourierProvider, CourierProviderError };
