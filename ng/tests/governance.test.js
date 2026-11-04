'use strict';

/**
 * ng/tests/governance.test.js
 * Unit tests for governance workflow logic (no DB — pure logic).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── WORKFLOW_TRANSITIONS mirror (keep in sync with governanceService.js) ────
const WORKFLOW_TRANSITIONS = {
  submitted:           ['area_council_review', 'rejected'],
  area_council_review: ['fcta_review', 'rejected'],
  fcta_review:         ['approved', 'rejected'],
  approved:            ['dhis2_ready', 'rejected'],
  dhis2_ready:         ['exported'],
  rejected:            ['submitted'],
  exported:            [],
};

function isValidTransition(from, to) {
  return (WORKFLOW_TRANSITIONS[from] ?? []).includes(to);
}

describe('governance workflow transitions', () => {
  it('submitted can move to area_council_review or rejected', () => {
    assert.ok(isValidTransition('submitted', 'area_council_review'));
    assert.ok(isValidTransition('submitted', 'rejected'));
    assert.ok(!isValidTransition('submitted', 'approved'));
    assert.ok(!isValidTransition('submitted', 'exported'));
  });

  it('area_council_review can move to fcta_review or rejected', () => {
    assert.ok(isValidTransition('area_council_review', 'fcta_review'));
    assert.ok(isValidTransition('area_council_review', 'rejected'));
    assert.ok(!isValidTransition('area_council_review', 'approved'));
  });

  it('fcta_review can move to approved or rejected', () => {
    assert.ok(isValidTransition('fcta_review', 'approved'));
    assert.ok(isValidTransition('fcta_review', 'rejected'));
    assert.ok(!isValidTransition('fcta_review', 'dhis2_ready'));
  });

  it('approved can move to dhis2_ready or rejected', () => {
    assert.ok(isValidTransition('approved', 'dhis2_ready'));
    assert.ok(isValidTransition('approved', 'rejected'));
    assert.ok(!isValidTransition('approved', 'exported'));
  });

  it('dhis2_ready can only move to exported', () => {
    assert.ok(isValidTransition('dhis2_ready', 'exported'));
    assert.ok(!isValidTransition('dhis2_ready', 'approved'));
    assert.ok(!isValidTransition('dhis2_ready', 'rejected'));
  });

  it('exported is terminal — no transitions', () => {
    assert.ok(!isValidTransition('exported', 'approved'));
    assert.ok(!isValidTransition('exported', 'submitted'));
  });

  it('rejected can be resubmitted', () => {
    assert.ok(isValidTransition('rejected', 'submitted'));
    assert.ok(!isValidTransition('rejected', 'approved'));
  });

  it('unknown status has no valid transitions', () => {
    assert.ok(!isValidTransition('unknown', 'submitted'));
    assert.ok(!isValidTransition(null, 'submitted'));
  });

  it('cannot skip stages (submitted → approved)', () => {
    assert.ok(!isValidTransition('submitted', 'approved'));
    assert.ok(!isValidTransition('submitted', 'dhis2_ready'));
    assert.ok(!isValidTransition('submitted', 'exported'));
  });
});
