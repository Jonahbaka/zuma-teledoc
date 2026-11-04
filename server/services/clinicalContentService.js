'use strict';

const { decrypt } = require('../../lib/encryption');

// A recorded protected value must never appear to be absent because its key,
// authentication tag, or ciphertext is unavailable. Legacy content is used only
// when the row contains no protected representation of that field at all.
function readClinicalField(row, field, legacy = null) {
  const protectedValue = [row[field + '_encrypted'], row[field + '_iv'], row[field + '_tag']];
  if (protectedValue.every(value => value === null || value === undefined)) return legacy;
  let value;
  try { value = decrypt(...protectedValue); } catch (_error) { value = null; }
  if (typeof value !== 'string') throw Object.assign(new Error('Protected clinical content could not be opened.'), {
    statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE',
  });
  return value;
}

module.exports = { readClinicalField };
