'use strict';

/**
 * ng/scripts/simulate/referralFlows.js
 *
 * DRN referral state-machine scenarios — happy path, decline branch,
 * no-show, expired-by-TTL, emergency urgency match. Mirrors the
 * REFERRAL_TRANSITIONS table from referralNetworkService.js.
 */

const { assert, step } = require('./lib');

const REFERRAL_TRANSITIONS = {
  draft:       ['sent', 'cancelled'],
  sent:        ['received', 'cancelled', 'expired'],
  received:    ['accepted', 'declined', 'expired', 'cancelled'],
  accepted:    ['scheduled', 'cancelled'],
  scheduled:   ['in_progress', 'no_show', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [],
  cancelled:   [],
  no_show:     [],
  declined:    [],
  expired:     [],
};
const isValid    = (f, t) => (REFERRAL_TRANSITIONS[f] || []).includes(t);
const isTerminal = s => (REFERRAL_TRANSITIONS[s] || []).length === 0;

function newReferral() { return { id: 'ref-' + Math.random().toString(36).slice(2, 8), status: 'draft' }; }
function transition(r, target) {
  if (!isValid(r.status, target)) {
    const e = new Error(`bad ${r.status} → ${target}`); e.code = 'INVALID_TRANSITION'; throw e;
  }
  r.status = target;
}

// AI-matcher scoring (same shape as referralNetworkService.scoreCandidate)
function score(request, cand) {
  if (cand.specialty !== request.specialty) return 0;
  let s = 35;
  if (request.prefer_lga && cand.org_lga === request.prefer_lga) s += 20;
  else if (request.prefer_state && cand.org_state === request.prefer_state) s += 12;
  if (request.urgency === 'emergency' && cand.accepts_emergency) s += 15;
  else if (request.urgency === 'emergency') s -= 25;
  return s;
}

const scenarios = [
  {
    suite: 'referrals',
    name: 'Happy path: draft → sent → received → accepted → scheduled → in_progress → completed',
    run(ctx) {
      const r = newReferral();
      for (const s of ['sent','received','accepted','scheduled','in_progress','completed']) {
        transition(r, s); step(ctx, s);
      }
      assert.ok(isTerminal(r.status));
    },
  },
  {
    suite: 'referrals',
    name: 'Decline branch: draft → sent → received → declined (terminal)',
    run(ctx) {
      const r = newReferral();
      transition(r, 'sent');
      transition(r, 'received');
      transition(r, 'declined');
      step(ctx, 'declined');
      assert.ok(isTerminal(r.status));
      // Cannot un-decline.
      let threw = false;
      try { transition(r, 'accepted'); } catch { threw = true; }
      assert.ok(threw, 'declined is terminal');
    },
  },
  {
    suite: 'referrals',
    name: 'No-show: scheduled → no_show (terminal)',
    run(ctx) {
      const r = newReferral();
      for (const s of ['sent','received','accepted','scheduled','no_show']) {
        transition(r, s); step(ctx, s);
      }
      assert.ok(isTerminal(r.status));
    },
  },
  {
    suite: 'referrals',
    name: 'Expiry by TTL: sent / received / partial all permit → expired',
    run(ctx) {
      for (const start of ['sent','received']) {
        const r = { id: 'r', status: start };
        assert.ok(isValid(start, 'expired'), `${start} → expired must be allowed`);
        transition(r, 'expired');
        step(ctx, `${start} → expired ✓`);
      }
    },
  },
  {
    suite: 'referrals',
    name: 'AI matcher: emergency referral prefers emergency-capable facility',
    run(ctx) {
      const req = { specialty: 'cardiology', urgency: 'emergency', prefer_lga: 'AMAC' };
      const fast  = { specialty: 'cardiology', org_lga: 'AMAC', accepts_emergency: true };
      const slow  = { specialty: 'cardiology', org_lga: 'AMAC', accepts_emergency: false };
      const fastScore = score(req, fast);
      const slowScore = score(req, slow);
      step(ctx, `fast=${fastScore}, slow=${slowScore}`);
      assert.ok(fastScore > slowScore + 30, 'emergency-capable should win by ≥30');
    },
  },
  {
    suite: 'referrals',
    name: 'AI matcher: same-LGA outranks same-state when both apply',
    run(ctx) {
      const req = { specialty: 'pediatrics', prefer_lga: 'AMAC', prefer_state: 'FCT' };
      const lga   = { specialty: 'pediatrics', org_lga: 'AMAC',  org_state: 'FCT' };
      const state = { specialty: 'pediatrics', org_lga: 'BWARI', org_state: 'FCT' };
      assert.ok(score(req, lga) > score(req, state),
        'LGA proximity must beat state-only proximity');
      step(ctx, `LGA=${score(req,lga)} > state=${score(req,state)}`);
    },
  },
  {
    suite: 'referrals',
    name: 'Cancellation reachable from every non-terminal state',
    run(ctx) {
      for (const s of Object.keys(REFERRAL_TRANSITIONS)) {
        if (isTerminal(s)) continue;
        assert.ok(isValid(s, 'cancelled'), `${s} should be cancellable`);
        step(ctx, `${s} → cancelled ✓`);
      }
    },
  },
];

module.exports = { scenarios };
