'use strict';
const { sqlDateEndUtc } = require('../shared/sqlDate');

// Shared by operational checkout and clinical reads. An approved licence is
// insufficient after a pharmacy account is suspended or its ownership changes.
function isClinicalPharmacyActive(pharmacy, now = Date.now()) {
  const expiryEnd = sqlDateEndUtc(pharmacy?.pcn_license_expiry);
  return Boolean(pharmacy?.status === 'approved' && pharmacy.account_status === 'active'
    && pharmacy.verified_at && String(pharmacy.pcn_license_number || '').trim()
    && String(pharmacy.superintendent_pcn_number || '').trim()
    && pharmacy.pcn_license_expiry && Number.isFinite(expiryEnd) && expiryEnd > now);
}
function assertClinicalPharmacyActive(pharmacy, now = Date.now()) {
  if (!isClinicalPharmacyActive(pharmacy, now)) throw Object.assign(
    new Error('An active, approved pharmacy with current professional authorization is required.'),
    { status: 403, statusCode: 403, code: 'PHARMACY_CLINICAL_ACCESS_INACTIVE' }
  );
}
module.exports = { isClinicalPharmacyActive, assertClinicalPharmacyActive };
