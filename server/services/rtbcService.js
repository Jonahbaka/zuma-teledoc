'use strict';

const { integrationUnavailable } = require('../utils/integrationReadiness');

/**
 * Live medication benefits, formulary and negotiated prices require an
 * activated payer transport. This legacy service has no operational adapter.
 * Historical cache rows may contain simulated values and are never evidence
 * of a current benefit or price.
 */
class RTBCService {
  assertAvailable() {
    throw integrationUnavailable('Live medication benefits and pricing');
  }

  async getRTBCViaSurescripts() { this.assertAvailable(); }
  async getFDBFormularyData() { this.assertAvailable(); }
  async getRTBC() { this.assertAvailable(); }
  async comparePrices() { this.assertAvailable(); }
}

module.exports = new RTBCService();

