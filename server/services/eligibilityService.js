'use strict';

const { integrationUnavailable } = require('../utils/integrationReadiness');

/**
 * The legacy RTE integration has no operational payer transport. A configured
 * key or a development flag cannot verify a member's coverage.
 */
class EligibilityService {
  async verifyRealTime() {
    throw integrationUnavailable('Live insurance eligibility');
  }
}

module.exports = new EligibilityService();

