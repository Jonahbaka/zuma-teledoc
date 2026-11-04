'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkSql } = require('../../scripts/verify-migration-safety.cjs');

const file = 'ng/migrations/030_ng_medication_prescription_claims.sql';
const sql = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('reviewed active-Rx index replacement preserves data and passes the ordinary static gate', () => {
  const findings = checkSql(sql, file);
  assert.equal(findings.filter(finding => finding.severity === 'blocking').length, 0);
  assert.equal(findings.filter(finding => finding.kind === 'REVIEWED_INDEX_REPLACEMENT').length, 1);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(sql, /o\.status='cancelled'/);
  assert.match(sql, /b\.pickup_proof IS NOT NULL/);
  assert.match(sql, /i\.status='dispensed'/);
});

test('index exception cannot excuse another file, removed uniqueness, broader predicate or other destruction', () => {
  for (const [candidate, candidateFile] of [
    [sql, 'ng/migrations/031_unreviewed.sql'],
    [sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX'), file],
    [sql.replace('AND prescription_claim_active=true', ''), file],
    [sql.replace('DEFAULT true', 'DEFAULT false'), file],
    [sql.replace('DROP INDEX IF EXISTS ng_medication_one_digital_rx', 'DROP INDEX IF EXISTS another_index'), file],
    [sql + '\nDROP TABLE ng_medication_fulfillments;', file],
    [sql + '\nTRUNCATE ng_medication_fulfillments;', file],
  ]) assert.ok(checkSql(candidate, candidateFile).some(finding => finding.severity === 'blocking'));
});
