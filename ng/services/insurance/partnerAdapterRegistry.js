'use strict';

const CAPABILITIES = new Set(['eligibility', 'authorizationRequest', 'authorizationStatus', 'claimSubmission', 'claimStatus', 'remittanceImport']);

class PartnerAdapterRegistry {
  constructor() { this.adapters = new Map(); }

  register(partnerKey, adapter) {
    if (!partnerKey || !adapter || !Array.isArray(adapter.capabilities)) throw new Error('An explicit adapter capability contract is required');
    for (const capability of adapter.capabilities) {
      if (!CAPABILITIES.has(capability) || typeof adapter[capability] !== 'function') throw new Error('Unsupported or unimplemented partner capability');
    }
    if (this.adapters.has(partnerKey)) throw new Error('Partner adapter is already registered');
    this.adapters.set(partnerKey, adapter);
  }

  async execute(pool, context, partnerId, capability, input) {
    if (!CAPABILITIES.has(capability)) throw Object.assign(new Error('Unsupported insurance operation'), { statusCode: 400 });
    // Re-read activation on every call. Registration, a saved card, or a secret
    // alone must never activate an insurance agreement or clinical disclosure.
    const { rows } = await pool.query(
      'SELECT * FROM ng_insurance_partners WHERE id=$1 AND programme_id=$2', [partnerId, context.programme_id]
    );
    const partner = rows[0];
    const adapter = partner && this.adapters.get(partner.partner_key);
    if (partner?.onboarding_status !== 'live' || !partner.contract_reference || !partner.activation_evidence_reference || !adapter?.capabilities.includes(capability)) {
      throw Object.assign(new Error('This insurance capability is not activated for the programme.'), { statusCode: 503, code: 'INSURANCE_CAPABILITY_NOT_ACTIVATED' });
    }
    // Caller must already authorize member/encounter scope and disclosure; the
    // registry is a transport boundary, not a replacement authorization layer.
    return adapter[capability](input, { partnerId: partner.id, programmeId: context.programme_id, partnerVersion: partner.version });
  }
}

module.exports = { PartnerAdapterRegistry, CAPABILITIES };
