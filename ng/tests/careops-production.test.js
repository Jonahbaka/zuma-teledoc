'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { toMinorUnits, verifyPaystackSignature, assertPaymentMatches } = require('../services/payments/paymentIntegrity');
const { importOutcome, valuesMatch, assertAggregatePayload } = require('../services/public-health/dhis2DeliveryService');
const media = require('../services/conferencing/livekitService');
const { receiveEvent } = require('../services/conferencing/livekitWebhookService');
const FHIRValidator = require('../../server/services/fhir-bridge/validator');
const { demoIntegrationsEnabled } = require('../../server/utils/integrationReadiness');

test('money conversion preserves integer kobo and rejects ambiguous values', () => {
  assert.equal(toMinorUnits('2500.05'), 250005);
  assert.equal(toMinorUnits('0'), 0);
  for (const value of ['1.001', '-1', 'NaN', '1e3', '90071992547409999']) assert.throws(() => toMinorUnits(value));
});

test('payment confirmation binds reference, currency, amount and environment', () => {
  const expected = { reference: 'opaque-reference', amountMinor: 10000, currency: 'NGN', environment: 'test' };
  const verified = { ...expected, verified: true };
  assert.doesNotThrow(() => assertPaymentMatches(verified, expected));
  for (const change of [{ amountMinor: 1 }, { currency: 'USD' }, { reference: 'another' }, { environment: 'live' }, { verified: false }]) {
    assert.throws(() => assertPaymentMatches({ ...verified, ...change }, expected), { code: 'PAYMENT_MISMATCH' });
  }
});

test('Paystack verifies original bytes and fails closed for malformed signatures', () => {
  const raw = Buffer.from('{ "event": "charge.success", "data": {} }');
  const key = 'synthetic-test-secret';
  const signature = crypto.createHmac('sha512', key).update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw, signature, key), true);
  assert.equal(verifyPaystackSignature(Buffer.from(JSON.stringify(JSON.parse(raw))), signature, key), false);
  assert.equal(verifyPaystackSignature(raw, undefined, key), false);
  assert.equal(verifyPaystackSignature(raw, 'invalid', key), false);
  assert.equal(verifyPaystackSignature(raw, signature, null), false);
});

test('successful HTTP responses do not prove a complete DHIS2 import', () => {
  assert.equal(importOutcome(200, { status: 'OK' }, 1).state, 'reconciliation');
  assert.equal(importOutcome(202, { response: { id: 'job-id' } }, 1).state, 'reconciliation');
  assert.equal(importOutcome(200, { status: 'SUCCESS', importCount: { imported: 0, updated: 0, ignored: 1 } }, 1).state, 'rejected');
  assert.equal(importOutcome(200, { status: 'SUCCESS', importCount: { imported: 1, updated: 0, ignored: 0 } }, 1).state, 'reconciliation');
  assert.equal(importOutcome(401, {}, 1).state, 'rejected');
});

test('remote DHIS2 reconciliation preserves zero, rejects missing and ambiguous cells', () => {
  const expected = { dataValues: [{ dataElement: 'element', categoryOptionCombo: 'combo', value: 0 }] };
  assert.equal(valuesMatch(expected, { dataValues: [{ dataElement: 'element', categoryOptionCombo: 'combo', value: '0' }] }), true);
  assert.equal(valuesMatch(expected, { dataValues: [] }), false);
  assert.equal(valuesMatch(expected, { dataValues: [{ dataElement: 'element', categoryOptionCombo: 'combo', value: '1' }] }), false);
  assert.equal(valuesMatch(expected, { dataValues: [{ dataElement: 'element', categoryOptionCombo: 'other', value: '0' }] }), false);
});

test('DHIS2 wire payload allows numeric aggregate cells only', () => {
  const payload = { dataSet: 'a1234567890', orgUnit: 'b1234567890', period: '202609', dataValues: [{ dataElement: 'c1234567890', value: 0 }] };
  assert.doesNotThrow(() => assertAggregatePayload(payload));
  for (const change of [{ patientName: 'Synthetic patient' }, { period: '202613' }, { orgUnit: 'invented-id' },
    { dataValues: [{ dataElement: 'c1234567890', value: 'Patient narrative' }] },
    { dataValues: [{ dataElement: 'c1234567890', value: null }] },
    { dataValues: [...payload.dataValues, ...payload.dataValues] }]) {
    assert.throws(() => assertAggregatePayload({ ...payload, ...change }), { code: 'DHIS2_PAYLOAD_INVALID' });
  }
});

test('SDK tokens carry explicit observer grants and bounded initial-join lifetime', async () => {
  const env = { NG_LIVEKIT_API_KEY: 'test-key', NG_LIVEKIT_API_SECRET: 'synthetic-livekit-secret-at-least-32-chars' };
  const token = await media.generateRoomToken('opaque-room', 'opaque-participant', 'Participant', {
    ...media.participantMediaGrants('observer', {}), ttlSeconds: 999999, env,
  });
  const claims = jwt.verify(token, env.NG_LIVEKIT_API_SECRET);
  assert.equal(claims.video.canPublish, false);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.equal(claims.video.room, 'opaque-room');
  assert.ok(claims.exp - claims.nbf <= 3600);
  const muted = media.participantMediaGrants('doctor', { speak: false, share_screen: false, send_chat: false });
  assert.equal(muted.canPublish, false);
  assert.equal(muted.canPublishData, false);
});

test('official SDK webhook verification rejects an altered body', async () => {
  const env = { NG_LIVEKIT_API_KEY: 'test-key', NG_LIVEKIT_API_SECRET: 'synthetic-livekit-secret-at-least-32-chars' };
  const raw = Buffer.from(JSON.stringify({ event: 'room_started', id: 'event-1', room: { name: crypto.randomUUID() } }));
  const token = jwt.sign({ sha256: crypto.createHash('sha256').update(raw).digest('base64') }, env.NG_LIVEKIT_API_SECRET, { issuer: env.NG_LIVEKIT_API_KEY, expiresIn: 60 });
  const event = await receiveEvent(raw, token, env);
  assert.equal(event.id, 'event-1');
  await assert.rejects(receiveEvent(Buffer.concat([raw, Buffer.from(' ')]), token, env));
});

test('conference consultants cannot elevate their role or grant superior moderation authority', async () => {
  const conference = require('../services/conferencing/conferenceService');
  const pool = { query: async (sql) => {
    if (sql.includes('SELECT r.*, p.id AS actor_participant_id')) return { rows: [{ id: 'room', host_user_id: 'owner', status: 'live', actor_participant_status: 'admitted', actor_participant_role: 'consultant' }] };
    if (sql.includes('SELECT * FROM ng_conf_participants')) return { rows: [{ role: 'consultant', status: 'admitted', permissions_json: {} }] };
    if (sql.includes('SELECT role FROM ng_conf_participants')) return { rows: [{ role: 'doctor' }] };
    throw new Error('Unauthorised moderation must not write state');
  } };
  await assert.rejects(conference.promoteParticipant('room', 'target', { user_id: 'consultant' }, { role: 'host' }, pool), { code: 'FORBIDDEN' });
  await assert.rejects(conference.promoteParticipant('room', 'target', { user_id: 'consultant' }, { permissions_overrides: { end_room: true } }, pool), { code: 'FORBIDDEN' });
});

test('FHIR validation rejects malformed full URLs, duplicate entries and absent resources', () => {
  const validator = new FHIRValidator();
  assert.equal(validator.validate(null).valid, false);
  assert.equal(validator.validateBundle({ resourceType: 'Bundle', type: 'message', entry: {} }).valid, false);
  const invalid = validator.validateBundle({ resourceType: 'Bundle', type: 'collection', entry: [{ fullUrl: 'urn:uuid:bp-prefixed-id', resource: { resourceType: 'Observation', status: 'final', code: {} } }] });
  assert.equal(invalid.valid, false);
});

test('PHC FHIR observations preserve zero, partial blood pressure, units and clinical status', () => {
  const { toObservation, toEncounter } = require('../services/interop/clinicalFhirService');
  const row = { id: 'synthetic-observation', status: 'preliminary', observation_code: '8310-5', code_system: 'http://loinc.org', value_type: 'numeric', value_numeric: 0, unit: '°C', observed_at: '2026-10-13T10:00:00Z' };
  assert.equal(toObservation(row).valueQuantity.value, 0);
  assert.equal(toObservation(row).valueQuantity.code, 'Cel');
  assert.equal(toObservation({ ...row, value_numeric: null }).dataAbsentReason.coding[0].code, 'unknown');
  const pressure = toObservation({ ...row, observation_code: '85354-9', value_type: 'quantity_pair', value_numeric: 120, value_numeric_secondary: null, unit: 'mmHg' });
  assert.equal(pressure.component[0].valueQuantity.code, 'mm[Hg]');
  assert.equal(pressure.component[1].dataAbsentReason.coding[0].code, 'unknown');
  assert.equal(toEncounter({ id: 'synthetic-encounter', status: 'signed' }).status, 'in-progress');
  assert.equal(toEncounter({ id: 'synthetic-encounter', status: 'signed', ended_at: '2026-10-13T10:00:00Z' }).status, 'finished');
});

test('synthetic integration flag cannot enable simulations in production', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, ALLOW_SYNTHETIC_INTEGRATIONS: process.env.ALLOW_SYNTHETIC_INTEGRATIONS };
  try {
    process.env.NODE_ENV = 'production'; process.env.ALLOW_SYNTHETIC_INTEGRATIONS = 'true';
    assert.equal(demoIntegrationsEnabled(), false);
    process.env.NODE_ENV = 'test'; assert.equal(demoIntegrationsEnabled(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('insurance adapters require current programme activation and an implemented capability', async () => {
  const { PartnerAdapterRegistry } = require('../services/insurance/partnerAdapterRegistry');
  const registry = new PartnerAdapterRegistry();
  let calls = 0;
  registry.register('synthetic-hmo', { capabilities: ['eligibility'], eligibility: async () => { calls++; return { status: 'synthetic' }; } });
  let partner = { id: 'synthetic-partner', partner_key: 'synthetic-hmo', onboarding_status: 'review' };
  const pool = { query: async (_sql, parameters) => { assert.equal(parameters[1], 'programme-1'); return { rows: [partner] }; } };
  await assert.rejects(registry.execute(pool, { programme_id: 'programme-1' }, partner.id, 'eligibility', {}), { code: 'INSURANCE_CAPABILITY_NOT_ACTIVATED' });
  assert.equal(calls, 0);
  partner = { ...partner, onboarding_status: 'live', contract_reference: 'synthetic-contract', activation_evidence_reference: 'synthetic-evidence' };
  await registry.execute(pool, { programme_id: 'programme-1' }, partner.id, 'eligibility', {});
  assert.equal(calls, 1);
  await assert.rejects(registry.execute(pool, { programme_id: 'programme-1' }, partner.id, 'claimSubmission', {}), { code: 'INSURANCE_CAPABILITY_NOT_ACTIVATED' });
  partner.onboarding_status = 'suspended';
  await assert.rejects(registry.execute(pool, { programme_id: 'programme-1' }, partner.id, 'eligibility', {}), { code: 'INSURANCE_CAPABILITY_NOT_ACTIVATED' });
  assert.equal(calls, 1);
});

test('updated mailer preserves local multipart generation without contacting recipients', async () => {
  const mailer = require('nodemailer');
  const transport = mailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const message = await transport.sendMail({ from: 'careops@example.test', to: 'synthetic@example.test', subject: 'Synthetic validation', text: 'Synthetic validation only', html: '<p>Synthetic validation only</p>' });
  assert.match(message.message.toString(), /multipart\/alternative/);
  assert.deepEqual(message.envelope.to, ['synthetic@example.test']);
});

test('MFA proof is signed, token-bound, user-bound, expiring, and rotation preserves expiry', () => {
  const previous = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = 'synthetic-mfa-unit-test-secret-at-least-32-chars';
  const { issueMfaAttestation, hasVerifiedMfa, rotateMfaAttestation } = require('../../server/utils/mfaAttestation');
  try {
    const attestation = issueMfaAttestation('actor-1', 'access-1');
    const req = { user: { id: 'actor-1' }, headers: { authorization: 'Bearer access-1' }, cookies: { mfaVerified: attestation } };
    assert.equal(hasVerifiedMfa(req), true);
    assert.equal(hasVerifiedMfa({ ...req, user: { id: 'actor-2' } }), false);
    assert.equal(hasVerifiedMfa({ ...req, headers: { authorization: 'Bearer access-2' } }), false);
    assert.equal(hasVerifiedMfa({ ...req, cookies: { mfaVerified: 'true' } }), false);
    const expired = issueMfaAttestation('actor-1', 'access-1', { expiresAt: Math.floor(Date.now() / 1000) - 1 });
    assert.equal(hasVerifiedMfa({ ...req, cookies: { mfaVerified: expired } }), false);
    const rotated = rotateMfaAttestation(req, 'actor-1', 'access-2');
    assert.equal(jwt.decode(rotated.value).exp, jwt.decode(attestation).exp);
    assert.equal(hasVerifiedMfa({ ...req, headers: { authorization: 'Bearer access-2' }, cookies: { mfaVerified: rotated.value } }), true);
  } finally { if (previous === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previous; }
});
