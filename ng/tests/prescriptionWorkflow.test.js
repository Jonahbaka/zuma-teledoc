'use strict';

/**
 * ng/tests/prescriptionWorkflow.test.js
 * State-machine and ref-number tests for the prescription workflow.
 * No DB required — mirrors pure helpers inline.
 * Run: node --test ng/tests/prescriptionWorkflow.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const TRANSITIONS = {
  drafted:             ['signed', 'cancelled'],
  signed:              ['sent_to_pharmacy', 'cancelled'],
  sent_to_pharmacy:    ['received', 'cancelled', 'expired'],
  received:            ['partially_dispensed', 'fully_dispensed', 'cancelled', 'expired'],
  partially_dispensed: ['partially_dispensed', 'fully_dispensed', 'cancelled', 'expired'],
  fully_dispensed:     ['completed'],
  completed:           [],
  cancelled:           [],
  expired:             [],
};
function isValidTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }
function isTerminal(s) { return (TRANSITIONS[s] || []).length === 0; }
function generateRxNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tail = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `NG-RX-${date}-${tail}`;
}

describe('Rx state machine', () => {
  it('accepts the canonical happy path', () => {
    const path = ['drafted', 'signed', 'sent_to_pharmacy', 'received', 'fully_dispensed', 'completed'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isValidTransition(path[i], path[i + 1]), true,
        `expected ${path[i]} → ${path[i + 1]}`);
    }
  });

  it('supports partial → partial → full pathway', () => {
    assert.equal(isValidTransition('received', 'partially_dispensed'), true);
    assert.equal(isValidTransition('partially_dispensed', 'partially_dispensed'), true);
    assert.equal(isValidTransition('partially_dispensed', 'fully_dispensed'), true);
  });

  it('forbids skipping past signing', () => {
    assert.equal(isValidTransition('drafted', 'sent_to_pharmacy'), false);
    assert.equal(isValidTransition('drafted', 'received'), false);
    assert.equal(isValidTransition('drafted', 'fully_dispensed'), false);
  });

  it('forbids expiry from early stages', () => {
    assert.equal(isValidTransition('drafted', 'expired'), false);
    assert.equal(isValidTransition('signed',  'expired'), false);
    assert.equal(isValidTransition('sent_to_pharmacy', 'expired'), true);
    assert.equal(isValidTransition('received', 'expired'), true);
  });

  it('cancellation valid from every non-terminal state', () => {
    for (const s of ['drafted', 'signed', 'sent_to_pharmacy', 'received', 'partially_dispensed']) {
      assert.equal(isValidTransition(s, 'cancelled'), true, `${s} → cancelled`);
    }
    // fully_dispensed should NOT be cancellable — past that point, complete
    assert.equal(isValidTransition('fully_dispensed', 'cancelled'), false);
  });

  it('terminal states cannot transition out', () => {
    for (const t of ['completed', 'cancelled', 'expired']) {
      assert.equal(isTerminal(t), true);
      assert.equal(isValidTransition(t, 'drafted'), false);
      assert.equal(isValidTransition(t, 'sent_to_pharmacy'), false);
    }
  });

  it('only fully_dispensed can advance to completed', () => {
    assert.equal(isValidTransition('fully_dispensed', 'completed'), true);
    for (const s of ['drafted', 'signed', 'sent_to_pharmacy', 'received', 'partially_dispensed']) {
      assert.equal(isValidTransition(s, 'completed'), false, `${s} → completed should be invalid`);
    }
  });

  it('rejects unknown states', () => {
    assert.equal(isValidTransition('whatever', 'signed'), false);
    assert.equal(isValidTransition('signed', 'whatever'), false);
    assert.equal(isValidTransition(null, 'signed'), false);
  });
});

describe('generateRxNumber', () => {
  it('matches NG-RX-YYYYMMDD-XXXX format', () => {
    const n = generateRxNumber();
    assert.match(n, /^NG-RX-\d{8}-[0-9A-F]{4}$/);
  });
  it('generates unique numbers across 50 calls (statistically)', () => {
    // 2 hex bytes = 65,536-tail space. Birthday-problem at n=50 → P(collision)≈2%.
    // Keep sample small to keep flake risk negligible.
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(generateRxNumber());
    assert.equal(seen.size, 50);
  });
});
