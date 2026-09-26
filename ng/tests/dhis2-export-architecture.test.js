'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyFailure,
  assertNoPatientIdentifiers,
  buildDataValueSet,
  classifyFailure,
  computeSubmissionKey,
  formatPeriod,
  reconcile,
  resolveMapping,
  retryDelayMs,
  _test: { MAX_ATTEMPTS },
} = require('../services/public-health/dhis2ExportService');

const APPROVED_MAPPINGS = [
  { indicatorKey: 'consultations_completed', dataElement: 'DE_CONS_01', approvalStatus: 'approved' },
  { indicatorKey: 'referrals_out', dataElement: 'DE_REF_OUT_01', approvalStatus: 'approved' },
  { indicatorKey: 'unapproved_indicator', dataElement: 'DE_X', approvalStatus: 'pending' },
];

test('periods are formatted for DHIS2 and invalid periods are rejected', () => {
  assert.equal(formatPeriod('2026-09'), 'September 2026');
  assert.equal(formatPeriod('2026-01'), 'January 2026');
  assert.equal(formatPeriod('2026-12'), 'December 2026');
  assert.throws(() => formatPeriod('2026-13'), (e) => e.code === 'PERIOD_INVALID');
  assert.throws(() => formatPeriod('2026-00'), (e) => e.code === 'PERIOD_INVALID');
  assert.throws(() => formatPeriod('Sept 2026'), (e) => e.code === 'PERIOD_INVALID');
  assert.throws(() => formatPeriod(''), (e) => e.code === 'PERIOD_INVALID');
  assert.throws(() => formatPeriod(undefined), (e) => e.code === 'PERIOD_INVALID');
});

test('only approved mappings resolve, and an unmapped indicator is a hard stop', () => {
  assert.equal(
    resolveMapping({ indicatorKey: 'consultations_completed', mappings: APPROVED_MAPPINGS }).dataElement,
    'DE_CONS_01'
  );
  assert.throws(
    () => resolveMapping({ indicatorKey: 'unknown', mappings: APPROVED_MAPPINGS }),
    (e) => e.statusCode === 422 && e.code === 'INDICATOR_MAPPING_MISSING'
  );
  assert.throws(
    () => resolveMapping({ indicatorKey: 'unapproved_indicator', mappings: APPROVED_MAPPINGS }),
    (e) => e.code === 'INDICATOR_MAPPING_NOT_APPROVED'
  );
  assert.throws(() => resolveMapping({ indicatorKey: '', mappings: [] }), (e) => e.code === 'INDICATOR_KEY_REQUIRED');
});

test('the export guard rejects payloads carrying patient identifiers', () => {
  assert.throws(
    () => assertNoPatientIdentifiers({ patient_name: 'Amina Bello' }),
    (e) => e.statusCode === 422 && e.code === 'PATIENT_IDENTIFIER_DETECTED'
  );
  assert.throws(
    () => assertNoPatientIdentifiers({ dataValues: [{ value: '12', comment: 'call 08031234567' }] }),
    (e) => e.code === 'PATIENT_IDENTIFIER_DETECTED'
  );
  assert.throws(
    () => assertNoPatientIdentifiers({ meta: { contact: 'nurse@phc.gov.ng' } }),
    (e) => e.code === 'PATIENT_IDENTIFIER_DETECTED'
  );
  assert.equal(
    assertNoPatientIdentifiers({ orgUnit: 'PHC-GWAGWA', dataValues: [{ dataElement: 'DE_CONS_01', value: '12' }] }),
    true
  );
});

test('a data value set is built with mapped elements, counts, and the DHIS2 period', () => {
  const payload = buildDataValueSet({
    orgUnit: 'ORG-GWAGWA',
    orgUnitName: 'Gwagwa PHC',
    period: '2026-09',
    values: [
      { indicatorKey: 'consultations_completed', value: 41 },
      { indicatorKey: 'referrals_out', value: 0 },
    ],
    mappings: APPROVED_MAPPINGS,
  });

  assert.equal(payload.orgUnit, 'ORG-GWAGWA');
  assert.equal(payload.period, 'September 2026');
  assert.equal(payload.dataValues.length, 2);
  assert.equal(payload.dataValues[0].dataElement, 'DE_CONS_01');
  assert.equal(payload.dataValues[0].value, '41');
  assert.equal(payload.dataValues[1].value, '0', 'a genuine zero is exported as zero, not omitted');
});

test('missing, negative, and fractional counts are refused rather than guessed', () => {
  const build = (value) => () => buildDataValueSet({
    orgUnit: 'ORG-KARMO',
    period: '2026-09',
    values: [{ indicatorKey: 'consultations_completed', value }],
    mappings: APPROVED_MAPPINGS,
  });

  assert.throws(build(null), (e) => e.code === 'INDICATOR_VALUE_MISSING');
  assert.throws(build(undefined), (e) => e.code === 'INDICATOR_VALUE_MISSING');
  assert.throws(build(''), (e) => e.code === 'INDICATOR_VALUE_MISSING');
  assert.throws(build(-3), (e) => e.code === 'INDICATOR_VALUE_INVALID');
  assert.throws(build(2.5), (e) => e.code === 'INDICATOR_VALUE_INVALID');
  assert.throws(build('many'), (e) => e.code === 'INDICATOR_VALUE_INVALID');
});

test('an empty report is refused so an uncounted facility is not reported as zero', () => {
  assert.throws(
    () => buildDataValueSet({ orgUnit: 'ORG-PYAKASA', period: '2026-09', values: [], mappings: APPROVED_MAPPINGS }),
    (e) => e.code === 'NO_VALUES_SUPPLIED'
  );
  assert.throws(
    () => buildDataValueSet({
      orgUnit: '', period: '2026-09',
      values: [{ indicatorKey: 'consultations_completed', value: 1 }], mappings: APPROVED_MAPPINGS,
    }),
    (e) => e.code === 'ORG_UNIT_REQUIRED'
  );
});

test('the same report always produces the same submission key, and a changed value does not', () => {
  const base = { orgUnit: 'ORG-GWAGWA', period: '2026-09', values: [{ indicatorKey: 'consultations_completed', value: 41 }] };
  const again = { orgUnit: 'ORG-GWAGWA', period: '2026-09', values: [{ indicatorKey: 'consultations_completed', value: 41 }] };
  const changed = { orgUnit: 'ORG-GWAGWA', period: '2026-09', values: [{ indicatorKey: 'consultations_completed', value: 42 }] };
  const otherPeriod = { orgUnit: 'ORG-GWAGWA', period: '2026-10', values: [{ indicatorKey: 'consultations_completed', value: 41 }] };
  const otherFacility = { orgUnit: 'ORG-KARMO', period: '2026-09', values: [{ indicatorKey: 'consultations_completed', value: 41 }] };

  const key = computeSubmissionKey(base);
  assert.equal(computeSubmissionKey(again), key, 'a retry must map to the same key');
  assert.notEqual(computeSubmissionKey(changed), key);
  assert.notEqual(computeSubmissionKey(otherPeriod), key);
  assert.notEqual(computeSubmissionKey(otherFacility), key);
  assert.match(key, /^[a-f0-9]{64}$/);
});

test('value ordering does not change the submission key', () => {
  const a = computeSubmissionKey({
    orgUnit: 'ORG-GWAGWA', period: '2026-09',
    values: [{ indicatorKey: 'consultations_completed', value: 1 }, { indicatorKey: 'referrals_out', value: 2 }],
  });
  const b = computeSubmissionKey({
    orgUnit: 'ORG-GWAGWA', period: '2026-09',
    values: [{ indicatorKey: 'referrals_out', value: 2 }, { indicatorKey: 'consultations_completed', value: 1 }],
  });
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Retry, dead-letter, reconciliation
// ---------------------------------------------------------------------------

test('transient upstream failures retry, permanent client errors do not', () => {
  assert.deepEqual(classifyFailure({ statusCode: 503 }), { retryable: true, reason: 'TRANSIENT_UPSTREAM' });
  assert.deepEqual(classifyFailure({ statusCode: 429 }), { retryable: true, reason: 'TRANSIENT_UPSTREAM' });
  assert.deepEqual(classifyFailure({ code: 'ECONNRESET' }), { retryable: true, reason: 'NETWORK_TRANSIENT' });
  assert.deepEqual(classifyFailure({ statusCode: 400 }), { retryable: false, reason: 'PERMANENT_CLIENT_ERROR' });
  assert.deepEqual(classifyFailure({ statusCode: 401 }), { retryable: false, reason: 'PERMANENT_CLIENT_ERROR' });
  assert.equal(classifyFailure({}).retryable, false);
});

test('retry backoff grows and is capped', () => {
  assert.equal(retryDelayMs(1), 5000);
  assert.equal(retryDelayMs(2), 10000);
  assert.equal(retryDelayMs(3), 20000);
  assert.equal(retryDelayMs(20), 300000, 'backoff is capped');
  assert.equal(retryDelayMs(0), 5000, 'a zero attempt is treated as the first');
});

test('a queued submission retries with a scheduled next attempt, then dead-letters', () => {
  const now = '2026-09-26T10:00:00.000Z';
  const item = { submissionKey: 'k1', orgUnit: 'ORG-GWAGWA', period: 'September 2026', attempts: 0, status: 'queued' };

  const first = applyFailure(item, { statusCode: 503 }, { now });
  assert.equal(first.status, 'retrying');
  assert.equal(first.attempts, 1);
  assert.equal(first.nextAttemptAt, '2026-09-26T10:00:05.000Z');
  assert.equal(first.deadLetteredAt, undefined);

  let current = first;
  while (current.status === 'retrying' && current.attempts < MAX_ATTEMPTS) {
    current = applyFailure(current, { statusCode: 503 }, { now });
  }
  assert.equal(current.status, 'dead_letter');
  assert.equal(current.attempts, MAX_ATTEMPTS);
  assert.equal(current.deadLetterReason, 'MAX_ATTEMPTS_EXHAUSTED');
  assert.equal(current.nextAttemptAt, null, 'a dead letter is never retried again');
  assert.ok(current.deadLetteredAt);
});

test('a permanent failure dead-letters immediately without burning the retry budget', () => {
  const dead = applyFailure(
    { submissionKey: 'k2', orgUnit: 'ORG-KARMO', period: 'September 2026', attempts: 0 },
    { statusCode: 400 }
  );
  assert.equal(dead.status, 'dead_letter');
  assert.equal(dead.attempts, 1);
  assert.equal(dead.deadLetterReason, 'PERMANENT_CLIENT_ERROR');
});

test('reconciliation separates confirmed, missing, and rejected submissions', () => {
  const items = [
    { submissionKey: 'k1', orgUnit: 'ORG-GWAGWA', period: 'September 2026' },
    { submissionKey: 'k2', orgUnit: 'ORG-KARMO', period: 'September 2026' },
    { submissionKey: 'k3', orgUnit: 'ORG-GARKI', period: 'September 2026' },
  ];
  const responses = [
    { submissionKey: 'k1', accepted: true },
    { submissionKey: 'k3', accepted: false, reason: 'DUPLICATE_PERIOD', errors: ['dataValue already exists'] },
  ];

  const result = reconcile({ items, responses });
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.confirmed, 1);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.isReconciled, false);
  assert.equal(result.missing[0].submissionKey, 'k2');
  assert.equal(result.rejected[0].reason, 'DUPLICATE_PERIOD');
  assert.deepEqual(result.rejected[0].errors, ['dataValue already exists']);

  const complete = reconcile({
    items, responses: items.map((i) => ({ submissionKey: i.submissionKey, accepted: true })),
  });
  assert.equal(complete.summary.isReconciled, true);
});

test('an already-accepted duplicate period reconciles as confirmed, not as data loss', () => {
  const result = reconcile({
    items: [{ submissionKey: 'k1', orgUnit: 'ORG-GWAGWA', period: 'September 2026' }],
    responses: [{ submissionKey: 'k1', accepted: true, duplicatePeriod: true }],
  });
  assert.equal(result.summary.isReconciled, true);
  assert.equal(result.confirmed[0].response.duplicatePeriod, true);
});
