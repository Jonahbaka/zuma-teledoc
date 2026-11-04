'use strict';
// Dormant preparation: callers must enforce current account, market, care scope
// and read audit BEFORE using the clinical serializer. No route imports this yet.
const encryption = require('../../lib/encryption');
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const TEXT_FIELDS = ['reason_for_visit', 'patient_notes', 'provider_notes', 'cancellation_reason'];
const SCHEDULING_FIELDS = ['id', 'patient_id', 'provider_id', 'scheduled_at', 'duration_minutes', 'status', 'type', 'created_at', 'updated_at', 'confirmed_at', 'cancelled_at', 'cancelled_by'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => Object.assign(new Error('Protected appointment data is unavailable'), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE', statusCode: 503 });
function identity(row) {
  const ids = {};
  for (const field of ['id', 'patient_id', 'provider_id']) {
    if (!UUID.test(String(row?.[field] || ''))) throw fail();
    ids[field] = row[field].toLowerCase();
  }
  return ids;
}
function snapshot(row) {
  const fields = {};
  for (const name of TEXT_FIELDS) {
    const value = row[name] ?? null;
    if (value !== null && typeof value !== 'string') throw fail();
    fields[name] = value;
  }
  if (row.metadata != null && !object(row.metadata)) throw fail();
  fields.metadata = row.metadata ?? null;
  let json;
  try { json = JSON.stringify(fields); } catch (_) { throw fail(); }
  if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) throw fail();
  const copy = JSON.parse(json);
  if (copy.metadata !== null && !object(copy.metadata)) throw fail();
  return copy;
}
function exactKeys(value, names) {
  return object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function validEnvelope(value) {
  return exactKeys(value, ['version', 'encrypted', 'iv', 'tag']) && value.version === VERSION &&
    typeof value.encrypted === 'string' && value.encrypted.length > 0 && value.encrypted.length <= (MAX_BYTES + 1024) * 2 &&
    value.encrypted.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.encrypted) &&
    typeof value.iv === 'string' && /^[a-f\d]{24}$/i.test(value.iv) &&
    typeof value.tag === 'string' && /^[a-f\d]{32}$/i.test(value.tag);
}
function createAppointmentPayloadCodec(crypto = encryption) {
  function protectAppointmentPayload(row) {
    // Reject raw stored rows: their legacy fields may be cleared or stale.
    // A future writer must lock, authorize, hydrate, merge, then protect.
    if (row?.protected_payload != null) throw fail();
    const record = identity(row);
    const payload = { version: VERSION, record, fields: snapshot(row) };
    let result;
    try { result = crypto.encrypt(JSON.stringify(payload)); } catch (error) {
      if (error.code === 'PHI_ENCRYPTION_KEY_REQUIRED') throw Object.assign(new Error('Dedicated appointment encryption key is required'), { code: error.code, statusCode: 503 });
      throw fail();
    }
    const envelope = { version: VERSION, encrypted: result?.encrypted, iv: result?.iv, tag: result?.tag };
    if (!validEnvelope(envelope)) throw fail();
    return envelope;
  }
  function readAppointmentPayload(row) {
    const expected = identity(row);
    // Only an absent envelope is legacy. Corrupt/new versions must NEVER fall
    // back to stale plaintext columns, including when those columns are set.
    if (row.protected_payload == null) return snapshot(row);
    const envelope = row.protected_payload;
    if (!validEnvelope(envelope)) throw fail();
    let payload;
    try {
      const decoded = crypto.decryptCurrentKey(envelope.encrypted, envelope.iv, envelope.tag);
      if (typeof decoded !== 'string' || Buffer.byteLength(decoded, 'utf8') > MAX_BYTES + 1024) throw fail();
      payload = JSON.parse(decoded);
    } catch (_) { throw fail(); }
    if (!exactKeys(payload, ['version', 'record', 'fields']) || payload.version !== VERSION ||
        !exactKeys(payload.record, Object.keys(expected)) ||
        Object.keys(expected).some(key => payload.record[key] !== expected[key]) ||
        !exactKeys(payload.fields, [...TEXT_FIELDS, 'metadata'])) throw fail();
    return snapshot(payload.fields);
  }
  function serializeAppointment(row, { view } = {}) {
    // View is a server-selected data-minimization contract, NOT authorization.
    if (view === 'scheduling') return Object.fromEntries(SCHEDULING_FIELDS.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
    if (view !== 'clinical') throw fail();
    const fields = readAppointmentPayload(row);
    const result = { ...row, ...fields };
    delete result.protected_payload;
    return result;
  }
  return { protectAppointmentPayload, readAppointmentPayload, serializeAppointment };
}
module.exports = { ...createAppointmentPayloadCodec(), createAppointmentPayloadCodec };
