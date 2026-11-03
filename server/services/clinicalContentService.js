'use strict';

const { decrypt, decryptCurrentKey } = require('../../lib/encryption');

// A recorded protected value must never appear to be absent because its key,
// authentication tag, or ciphertext is unavailable. Legacy content is used only
// when the row contains no protected representation of that field at all.
function readClinicalField(row, field, legacy = null, { currentKeyOnly = false } = {}) {
  const protectedValue = [row[field + '_encrypted'], row[field + '_iv'], row[field + '_tag']];
  if (protectedValue.every(value => value === null || value === undefined)) return legacy;
  let value;
  try { value = (currentKeyOnly ? decryptCurrentKey : decrypt)(...protectedValue); } catch (_error) { value = null; }
  if (typeof value !== 'string') throw Object.assign(new Error('Protected clinical content could not be opened.'), {
    statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE',
  });
  return value;
}

// These narrative columns were introduced with dedicated-key writes. Do not
// accept credential-derived legacy keys for their new protected values.
function readClinicalNarrative(row, field) {
  return readClinicalField(row, field, row[field] ?? null, { currentKeyOnly: true });
}

module.exports = { readClinicalField, readClinicalNarrative };
