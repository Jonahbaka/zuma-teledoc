'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createAppointmentPayloadCodec } = require('../services/appointmentPayloadService');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
function primitives(env = { NODE_ENV: 'production', ENCRYPTION_KEY: 'ab'.repeat(32) }) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../lib/encryption'), 'utf8'), {
    module: mod, exports: mod.exports, Buffer, process: { env }, console: { error() {} },
    require(name) { assert.equal(name, 'crypto'); return crypto; },
  });
  return mod.exports;
}
const row = () => ({ id: crypto.randomUUID(), patient_id: crypto.randomUUID(), provider_id: crypto.randomUUID(),
  reason_for_visit: 'Synthetic private symptom', patient_notes: '', provider_notes: null,
  cancellation_reason: 'Synthetic private reason', metadata: { intake: { allergyStatus: 'unknown' }, triage: { symptoms: 'Synthetic private symptom' } }, status: 'scheduled' });
const codec = () => createAppointmentPayloadCodec(primitives());
function stored(input, api) { return { ...input, reason_for_visit: null, patient_notes: null, provider_notes: null, cancellation_reason: null, metadata: null, protected_payload: api.protectAppointmentPayload(input) }; }
test('versioned payload round trips with empty/null and protected intake; storage does not contain narratives', () => {
  const api = codec(), input = row(), saved = stored(input, api);
  assert.ok(!JSON.stringify(saved).includes('Synthetic private'));
  const decoded = api.serializeAppointment(saved, { view: 'clinical' });
  assert.deepEqual(decoded, input); assert.ok(!Object.hasOwn(decoded, 'protected_payload'));
  assert.notEqual(api.protectAppointmentPayload(input).encrypted, saved.protected_payload.encrypted);
});
test('legacy compatibility clones metadata, while scheduling never decrypts or discloses clinical storage', () => {
  const input = row(), api = codec(); const result = api.serializeAppointment(input, { view: 'clinical' });
  result.metadata.triage.symptoms = 'changed'; assert.notEqual(input.metadata.triage.symptoms, 'changed');
  const forbidden = createAppointmentPayloadCodec({ decryptCurrentKey() { throw Error('must not decrypt'); } });
  const result2 = forbidden.serializeAppointment({ ...input, protected_payload: { invalid: true } }, { view: 'scheduling' });
  assert.deepEqual(result2, { id: input.id, patient_id: input.patient_id, provider_id: input.provider_id, status: input.status });
  assert.throws(() => api.serializeAppointment(input), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
});
test('raw encrypted row cannot be reprotected from cleared or stale legacy columns', () => {
  const api = codec(), input = row(), saved = stored(input, api);
  assert.throws(() => api.protectAppointmentPayload(saved), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
  const hydrated = api.serializeAppointment(saved, { view: 'clinical' });
  hydrated.provider_notes = 'Synthetic updated note';
  const next = { ...saved, protected_payload: api.protectAppointmentPayload(hydrated) };
  assert.equal(api.readAppointmentPayload(next).provider_notes, 'Synthetic updated note');
  assert.equal(api.readAppointmentPayload(next).reason_for_visit, input.reason_for_visit);
});
test('ciphertext is bound to appointment, patient and provider identities; copying a valid envelope fails closed', () => {
  const api = codec(), input = row(), saved = stored(input, api);
  for (const field of ['id', 'patient_id', 'provider_id']) {
    assert.throws(() => api.readAppointmentPayload({ ...saved, [field]: crypto.randomUUID() }), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
  }
  assert.deepEqual(api.readAppointmentPayload({ ...saved, id: saved.id.toUpperCase() }), api.readAppointmentPayload(saved));
});
test('malformed, future, incomplete, tampered and wrong-key payloads never fall back to retained plaintext', () => {
  const api = codec(), input = row(), envelope = api.protectAppointmentPayload(input);
  for (const protected_payload of [{}, '', [], { ...envelope, version: 2 }, { ...envelope, iv: null }, { ...envelope, tag: '00'.repeat(16) }, { ...envelope, extra: 'bad' }]) {
    assert.throws(() => api.readAppointmentPayload({ ...input, protected_payload }), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
  }
  const wrong = createAppointmentPayloadCodec(primitives({ NODE_ENV: 'production', ENCRYPTION_KEY: 'cd'.repeat(32) }));
  assert.throws(() => wrong.readAppointmentPayload({ ...input, protected_payload: envelope }), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
});
test('new versioned payload rejects known legacy fallback encryption even when row identities match', () => {
  const input = row(), legacy = createAppointmentPayloadCodec(primitives({ NODE_ENV: 'development' }));
  const envelope = legacy.protectAppointmentPayload(input);
  assert.throws(() => codec().readAppointmentPayload({ ...input, protected_payload: envelope }), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
});
test('even authenticated malformed inner versions/identities/field shapes fail closed', () => {
  const input = row(), api = codec(), enc = primitives();
  for (const inner of [{}, { version: 2, record: {}, fields: {} }, { version: 1, record: { id: input.id, patient_id: input.patient_id, provider_id: input.provider_id }, fields: { reason_for_visit: 1 } }]) {
    const protected_payload = { version: 1, ...enc.encrypt(JSON.stringify(inner)) };
    assert.throws(() => api.readAppointmentPayload({ ...input, protected_payload }), { code: 'APPOINTMENT_PAYLOAD_UNAVAILABLE' });
  }
});
test('production writes reject absent dedicated key; invalid/oversized snapshots fail without logging clinical values', () => {
  const missing = createAppointmentPayloadCodec(primitives({ NODE_ENV: 'production' }));
  assert.throws(() => missing.protectAppointmentPayload(row()), { code: 'PHI_ENCRYPTION_KEY_REQUIRED' });
  const api = codec();
  for (const input of [{ ...row(), id: 'bad' }, { ...row(), metadata: [] }, { ...row(), metadata: new Date('2020-01-01T00:00:00Z') }, { ...row(), patient_notes: 1 }, { ...row(), reason_for_visit: 'x'.repeat(1024 * 1024 + 1) }]) {
    assert.throws(() => api.protectAppointmentPayload(input), error => error.code === 'APPOINTMENT_PAYLOAD_UNAVAILABLE' && !error.message.includes('Synthetic'));
  }
});
test('additive migration is registered and contains no backfill or writer activation', () => {
  const migrate = require('../db/migrate');
  const migration = migrate.getMigrations().find(item => item.name === '043_appointment_protected_payload');
  assert.ok(migration); assert.match(migration.up, /ADD COLUMN IF NOT EXISTS protected_payload JSONB/);
  assert.doesNotMatch(migration.up, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  for (const file of ['../routes/appointments', '../services/triageService', '../services/appointmentIntentService']) {
    assert.ok(!fs.readFileSync(require.resolve(file), 'utf8').includes("appointmentPayloadService"));
  }
});
const target = process.env.SIMULATION_DATABASE_URL;
test('isolated PostgreSQL additive migration reruns and preserves legacy data; malformed envelopes rejected', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } }); assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target, statement_timeout: 10000 }); const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE TEMP TABLE appointments(id uuid, reason_for_visit text) ON COMMIT DROP');
    const input = row(); await c.query('INSERT INTO appointments(id,reason_for_visit) VALUES($1,$2)', [input.id, input.reason_for_visit]);
    const sql = fs.readFileSync(require.resolve('../db/migrations/043_appointment_protected_payload.sql'), 'utf8');
    await c.query(sql); await c.query(sql);
    const legacy = (await c.query('SELECT * FROM appointments')).rows[0]; assert.equal(legacy.reason_for_visit, input.reason_for_visit); assert.equal(legacy.protected_payload, null);
    const payload = codec().protectAppointmentPayload(input);
    await c.query('UPDATE appointments SET protected_payload=$1 WHERE id=$2', [payload, input.id]);
    for (const malformed of [{}, { version: 2, encrypted: 'x', iv: 'x', tag: 'x' }, []]) {
      await c.query('SAVEPOINT reject_envelope');
      await assert.rejects(c.query('UPDATE appointments SET protected_payload=$1', [JSON.stringify(malformed)]), { code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT reject_envelope');
    }
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
});
