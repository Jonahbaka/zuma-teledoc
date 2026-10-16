'use strict';

const db = require('../db');
const { integrationUnavailable } = require('../utils/integrationReadiness');

/**
 * Keep historical authorization records readable. No operational insurer
 * submission or authenticated status-response adapter exists in this legacy
 * service, so mutation cannot create a receipt, approval or submitted record.
 */
class PriorAuthService {
  assertAvailable() {
    throw integrationUnavailable('Prior authorization submission and status updates');
  }

  async submitViaCoverMyMeds() { this.assertAvailable(); }
  async submitViaSurescripts() { this.assertAvailable(); }
  async createPriorAuth() { this.assertAvailable(); }
  async updatePriorAuthStatus() { this.assertAvailable(); }

  async getPriorAuthById(paId) {
    const result = await db.pool.query('SELECT * FROM prior_authorizations WHERE id = $1', [paId]);
    return result.rows[0];
  }

  async getPriorAuthsByPatient(patientId) {
    const result = await db.pool.query(
      'SELECT * FROM prior_authorizations WHERE patient_id = $1 ORDER BY created_at DESC', [patientId]
    );
    return result.rows;
  }

  async getPriorAuthsByProvider(providerId) {
    const result = await db.pool.query(
      'SELECT * FROM prior_authorizations WHERE provider_id = $1 ORDER BY created_at DESC', [providerId]
    );
    return result.rows;
  }

  async autoSubmitIfRequired(_patientId, _providerId, _medicationName, _visitId, _appointmentId, rtbcResult) {
    if (!rtbcResult?.requiresPriorAuth) return null;
    this.assertAvailable();
  }
}

module.exports = new PriorAuthService();

