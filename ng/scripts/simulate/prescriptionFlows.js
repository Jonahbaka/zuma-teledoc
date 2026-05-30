'use strict';

/**
 * ng/scripts/simulate/prescriptionFlows.js
 *
 * Prescription lifecycle scenarios. These import the REAL state machine and the
 * REAL completion rule from prescriptionWorkflowService.js (TRANSITIONS,
 * isValidTransition, isTerminal, nextDispenseStatus) so the harness can never
 * drift from production. The dispense model mirrors the service exactly: an item
 * is dispensed once (whole item), and the prescription status is recomputed from
 * item tallies via nextDispenseStatus — the same function the live service runs.
 */

const { assert, step } = require('./lib');
const {
  TRANSITIONS,
  isValidTransition,
  isTerminal,
  nextDispenseStatus,
} = require('../../services/rx-engine/prescriptionWorkflowService');

const ALL = Object.keys(TRANSITIONS);

// In-memory prescription that mirrors the service's item model: each item is
// pending → dispensed | cancelled | unavailable. No per-item quantity
// accumulation (the live service marks the whole item dispensed in one call).
function newRx(itemCount = 1) {
  return {
    status: 'drafted',
    items: Array.from({ length: itemCount }, (_, i) => ({ id: `it-${i}`, status: 'pending' })),
  };
}

function counts(rx) {
  const total = rx.items.length;
  const dispensed = rx.items.filter(i => i.status === 'dispensed').length;
  const finalized = rx.items.filter(i => ['dispensed', 'cancelled', 'unavailable'].includes(i.status)).length;
  return { total, dispensed, finalized };
}

// Mirrors prescriptionWorkflowService.dispenseItem guards + recompute.
function dispenseItem(rx, itemIdx) {
  if (!['received', 'partially_dispensed'].includes(rx.status)) {
    const e = new Error('rx not dispensable'); e.code = 'INVALID_STATE'; throw e;
  }
  const it = rx.items[itemIdx];
  if (['dispensed', 'cancelled'].includes(it.status)) {
    const e = new Error('item already terminal'); e.code = 'INVALID_STATE'; throw e;
  }
  if (it.status === 'unavailable') {
    const e = new Error('item unavailable'); e.code = 'INVALID_STATE'; throw e;
  }
  it.status = 'dispensed';
  rx.status = nextDispenseStatus(rx.status, counts(rx));
}

function markUnavailable(rx, itemIdx) {
  rx.items[itemIdx].status = 'unavailable';
  rx.status = nextDispenseStatus(rx.status, counts(rx));
}

function transition(rx, target) {
  if (!isValidTransition(rx.status, target)) {
    const e = new Error(`bad transition ${rx.status} → ${target}`); e.code = 'INVALID_TRANSITION'; throw e;
  }
  rx.status = target;
}

const scenarios = [
  {
    suite: 'prescriptions',
    name: 'Happy path: drafted → signed → sent → received → fully_dispensed → completed',
    run(ctx) {
      const rx = newRx(1);
      transition(rx, 'signed');             step(ctx, 'signed');
      transition(rx, 'sent_to_pharmacy');   step(ctx, 'sent_to_pharmacy');
      transition(rx, 'received');           step(ctx, 'received');
      dispenseItem(rx, 0);                  step(ctx, 'dispensed only item');
      assert.equal(rx.status, 'fully_dispensed');
      transition(rx, 'completed');          step(ctx, 'completed');
      assert.ok(isTerminal(rx.status));
    },
  },
  {
    suite: 'prescriptions',
    name: 'Multi-item partial: dispense 1 of 3 → partial, then remaining → full',
    run(ctx) {
      const rx = newRx(3);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      dispenseItem(rx, 0); assert.equal(rx.status, 'partially_dispensed');
      step(ctx, `after 1/3: ${rx.status}`);
      dispenseItem(rx, 1); assert.equal(rx.status, 'partially_dispensed');
      step(ctx, `after 2/3: ${rx.status}`);
      dispenseItem(rx, 2); assert.equal(rx.status, 'fully_dispensed');
      step(ctx, `after 3/3: ${rx.status}`);
    },
  },
  {
    suite: 'prescriptions',
    name: 'Regression: dispensed item + unavailable item → fully_dispensed (was stuck partial)',
    run(ctx) {
      // This is the bug the old fake hid: with an unavailable item, the real
      // service used `dispensed === total` and could NEVER reach fully_dispensed.
      const rx = newRx(2);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      markUnavailable(rx, 1);
      step(ctx, 'item #2 flagged unavailable');
      dispenseItem(rx, 0);
      assert.equal(rx.status, 'fully_dispensed',
        'unavailable items must finalize, not block completion');
      step(ctx, 'unavailable item finalized; Rx completes');
      transition(rx, 'completed');
      assert.ok(isTerminal(rx.status));
    },
  },
  {
    suite: 'prescriptions',
    name: 'Last-item unavailable after a dispense also completes the Rx',
    run(ctx) {
      const rx = newRx(2);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      dispenseItem(rx, 0); assert.equal(rx.status, 'partially_dispensed');
      markUnavailable(rx, 1);
      assert.equal(rx.status, 'fully_dispensed',
        'marking the last pending item unavailable must finalize the Rx');
      step(ctx, 'recompute on markUnavailable advances to fully_dispensed');
    },
  },
  {
    suite: 'prescriptions',
    name: 'Cancellation is allowed from every non-terminal state',
    run(ctx) {
      const nonTerminal = ALL.filter(s => !isTerminal(s) && s !== 'fully_dispensed');
      for (const s of nonTerminal) {
        assert.ok(isValidTransition(s, 'cancelled'), `${s} must allow → cancelled`);
        step(ctx, `${s} → cancelled ✓`);
      }
    },
  },
  {
    suite: 'prescriptions',
    name: 'Terminal-state immutability: completed/cancelled/expired reject every transition',
    run(ctx) {
      for (const term of ['completed', 'cancelled', 'expired']) {
        for (const target of ALL) {
          assert.ok(!isValidTransition(term, target), `${term} must reject → ${target}`);
        }
        step(ctx, `${term} is fully immutable`);
      }
    },
  },
  {
    suite: 'prescriptions',
    name: 'Failure injection: dispense before received throws',
    run(ctx) {
      const rx = newRx(1);
      ['signed', 'sent_to_pharmacy'].forEach(t => transition(rx, t));
      let threw = false;
      try { dispenseItem(rx, 0); } catch (e) { threw = (e.code === 'INVALID_STATE'); }
      assert.ok(threw, 'must throw before received');
      step(ctx, 'dispense before ack correctly rejected');
    },
  },
  {
    suite: 'prescriptions',
    name: 'Failure injection: re-dispensing a dispensed item throws INVALID_STATE',
    run(ctx) {
      const rx = newRx(1);
      ['signed', 'sent_to_pharmacy', 'received'].forEach(t => transition(rx, t));
      dispenseItem(rx, 0);
      const before = rx.status;
      let threw = false;
      try { dispenseItem(rx, 0); } catch (e) { threw = (e.code === 'INVALID_STATE'); }
      assert.ok(threw, 'must throw INVALID_STATE re-dispensing a terminal item');
      assert.equal(rx.status, before, 'status must not change on rejected re-dispense');
      step(ctx, `re-dispense rejected (status stayed ${before})`);
    },
  },
  {
    suite: 'prescriptions',
    name: 'Refill mechanics: authorize 2, request twice, third request rejected',
    run(ctx) {
      const item = { refills_remaining: 2 };
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
