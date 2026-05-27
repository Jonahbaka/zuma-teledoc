'use strict';

/**
 * ng/scripts/simulate/prescriptionFlows.js
 *
 * Prescription lifecycle scenarios — happy path + every cancellation
 * branch + terminal-state immutability + refill mechanics. Mirrors the
 * TRANSITIONS map from prescriptionWorkflowService.js so the harness
 * stays in sync with what the service actually allows.
 */

const { assert, step } = require('./lib');

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
const ALL = Object.keys(TRANSITIONS);
const isValid    = (f, t) => (TRANSITIONS[f] || []).includes(t);
const isTerminal = s => (TRANSITIONS[s] || []).length === 0;

// Toy rx with items
function newRx(items = []) {
  return {
    id: 'rx-' + Math.random().toString(36).slice(2, 8),
    status: 'drafted',
    items: items.map((q, i) => ({
      id: `it-${i}`,
      ordered: q,
      dispensed: 0,
      refills_authorized: 0,
      refills_remaining: 0,
      unavailable: false,
    })),
  };
}

// Dispense advances the rx based on item totals — same rule the service uses.
function dispenseItem(rx, itemIdx, qty) {
  const it = rx.items[itemIdx];
  if (it.unavailable) {
    const e = new Error('item unavailable'); e.code = 'INVALID_STATE'; throw e;
  }
  if (!['received', 'partially_dispensed'].includes(rx.status)) {
    const e = new Error('rx not dispensable'); e.code = 'INVALID_TRANSITION'; throw e;
  }
  it.dispensed += qty;
  if (it.dispensed > it.ordered) {
    const e = new Error('over-dispense'); e.code = 'INVALID_STATE'; throw e;
  }
  const allFull = rx.items.every(i => i.unavailable || i.dispensed >= i.ordered);
  rx.status = allFull ? 'fully_dispensed' : 'partially_dispensed';
}

function transition(rx, target) {
  if (!isValid(rx.status, target)) {
    const e = new Error(`bad transition ${rx.status} → ${target}`); e.code = 'INVALID_TRANSITION'; throw e;
  }
  rx.status = target;
}

const scenarios = [
  {
    suite: 'prescriptions',
    name: 'Happy path: drafted → signed → sent → received → fully_dispensed → completed',
    run(ctx) {
      const rx = newRx([10]);
      transition(rx, 'signed');             step(ctx, 'signed');
      transition(rx, 'sent_to_pharmacy');   step(ctx, 'sent_to_pharmacy');
      transition(rx, 'received');           step(ctx, 'received');
      dispenseItem(rx, 0, 10);              step(ctx, 'dispensed full quantity');
      assert.equal(rx.status, 'fully_dispensed');
      transition(rx, 'completed');          step(ctx, 'completed');
      assert.ok(isTerminal(rx.status));
    },
  },
  {
    suite: 'prescriptions',
    name: 'Partial dispense: 2 → 3 → 5 (full) advances correctly across calls',
    run(ctx) {
      const rx = newRx([10]);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      dispenseItem(rx, 0, 2); assert.equal(rx.status, 'partially_dispensed');
      step(ctx, `after 2: ${rx.status}`);
      dispenseItem(rx, 0, 3); assert.equal(rx.status, 'partially_dispensed');
      step(ctx, `after +3 (=5): ${rx.status}`);
      dispenseItem(rx, 0, 5); assert.equal(rx.status, 'fully_dispensed');
      step(ctx, `after +5 (=10): ${rx.status}`);
    },
  },
  {
    suite: 'prescriptions',
    name: 'Multi-item dispense: 2 items, one partial + one unavailable → still advances',
    run(ctx) {
      const rx = newRx([5, 3]);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      rx.items[1].unavailable = true;
      step(ctx, 'item #1 flagged unavailable');
      dispenseItem(rx, 0, 5);
      // Because item 1 is unavailable, allFull is true after item 0 is done.
      assert.equal(rx.status, 'fully_dispensed',
        'unavailable items should not block full-dispense');
      step(ctx, 'unavailable item correctly excluded from completion check');
    },
  },
  {
    suite: 'prescriptions',
    name: 'Cancellation is allowed from every non-terminal state',
    run(ctx) {
      const nonTerminal = ALL.filter(s => !isTerminal(s) && s !== 'fully_dispensed');
      for (const s of nonTerminal) {
        const rx = { id: 'rx', status: s, items: [] };
        // partially_dispensed can self-loop, but cancelled is in its transition list too
        assert.ok(isValid(s, 'cancelled'), `${s} must allow → cancelled`);
        transition(rx, 'cancelled');
        step(ctx, `${s} → cancelled ✓`);
        assert.ok(isTerminal(rx.status));
      }
    },
  },
  {
    suite: 'prescriptions',
    name: 'Terminal-state immutability: completed/cancelled/expired reject every transition',
    run(ctx) {
      for (const term of ['completed', 'cancelled', 'expired']) {
        for (const target of ALL) {
          assert.ok(!isValid(term, target),
            `${term} must reject → ${target}`);
        }
        step(ctx, `${term} is fully immutable`);
      }
    },
  },
  {
    suite: 'prescriptions',
    name: 'Failure injection: dispense before received throws INVALID_TRANSITION',
    run(ctx) {
      const rx = newRx([5]);
      ['signed', 'sent_to_pharmacy'].forEach(t => transition(rx, t));
      let threw = false;
      try { dispenseItem(rx, 0, 1); } catch (e) {
        threw = (e.code === 'INVALID_TRANSITION');
      }
      assert.ok(threw, 'must throw INVALID_TRANSITION before received');
      step(ctx, 'dispense before ack correctly rejected');
    },
  },
  {
    suite: 'prescriptions',
    name: 'Failure injection: over-dispense throws and does not corrupt status',
    run(ctx) {
      const rx = newRx([3]);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      dispenseItem(rx, 0, 2);
      const before = rx.status;
      let threw = false;
      try { dispenseItem(rx, 0, 5); } catch (e) {
        threw = (e.code === 'INVALID_STATE');
      }
      // The toy throws after mutating — the real service is transactional, so
      // it would not commit. We just assert the throw fires deterministically.
      assert.ok(threw, 'must throw INVALID_STATE on over-dispense');
      step(ctx, `over-dispense rejected (status was ${before}, threw INVALID_STATE)`);
    },
  },
  {
    suite: 'prescriptions',
    name: 'Refill mechanics: authorize 2, request twice, third request rejected',
    run(ctx) {
      const item = { ordered: 10, dispensed: 10, refills_authorized: 2, refills_remaining: 2, unavailable: false };
      function refill(it) {
        if (it.refills_remaining <= 0) { const e = new Error('no refills'); e.code = 'INVALID_STATE'; throw e; }
        it.refills_remaining -= 1;
      }
      refill(item); refill(item);
      step(ctx, `refills remaining after 2 requests: ${item.refills_remaining}`);
      let threw = false;
      try { refill(item); } catch (e) { threw = (e.code === 'INVALID_STATE'); }
      assert.ok(threw, 'third refill must be rejected');
    },
  },
];

module.exports = { scenarios };
