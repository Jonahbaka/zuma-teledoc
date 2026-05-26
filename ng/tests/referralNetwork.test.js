'use strict';

/**
 * ng/tests/referralNetwork.test.js
 * Unit tests for the DoctaRx Referral Network (DRN) service.
 *
 * Pure-function suite: state machine, AI matching score, commission split,
 * QR token hashing, ref-code generation. No database required.
 *
 * Run with: node --test ng/tests/referralNetwork.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Mirror state machine (must stay in sync with referralNetworkService.js)
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

function isValidTransition(from, to) {
  return (REFERRAL_TRANSITIONS[from] || []).includes(to);
}
function isTerminal(s) {
  return (REFERRAL_TRANSITIONS[s] || []).length === 0;
}

function toNumber(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function scoreCandidate(request, candidate) {
  const reasons = [];
  let score = 0;
  if (candidate.specialty === request.specialty) { score += 35; reasons.push('specialty match'); }
  else return { score: 0, reasons: ['specialty mismatch'] };

  if (request.prefer_lga && candidate.org_lga === request.prefer_lga) { score += 20; reasons.push('same LGA'); }
  else if (request.prefer_state && candidate.org_state === request.prefer_state) { score += 12; reasons.push('same state'); }

  if (request.urgency === 'emergency' && candidate.accepts_emergency) { score += 15; reasons.push('emergency-capable'); }
  else if (request.urgency === 'emergency' && !candidate.accepts_emergency) { score -= 25; reasons.push('not emergency-capable'); }

  if (request.max_price && candidate.price_max_naira) {
    if (toNumber(candidate.price_max_naira) <= toNumber(request.max_price)) { score += 10; reasons.push('within budget'); }
    else { score -= 8; reasons.push('over budget'); }
  }
  if (request.accepts_insurance && candidate.accepts_insurance) { score += 8; reasons.push('accepts insurance'); }

  const accept = toNumber(candidate.acceptance_rate);
  if (accept >= 90) { score += 8; }
  else if (accept >= 70) { score += 4; }
  else if (accept < 50) { score -= 6; }

  const wait = toNumber(candidate.avg_wait_minutes);
  if (wait > 0 && wait <= 30) { score += 6; }
  else if (wait > 0 && wait <= 90) { score += 2; }
  else if (wait > 180) { score -= 4; }

  if (candidate.completed_referrals > 50) { score += 4; }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function round2(n) { return Math.round(n * 100) / 100; }
function computeSplit(referral) {
  const fee = toNumber(referral.service_fee_naira);
  if (fee <= 0) return [];
  const splits = [];
  if (referral.originating_agent) {
    splits.push({ kind: 'agent', rate: 5, amount: round2(fee * 0.05), agent_id: referral.originating_agent });
  } else if (referral.originating_provider) {
    splits.push({ kind: 'originating_provider', rate: 3, amount: round2(fee * 0.03), provider_id: referral.originating_provider });
  }
  if (referral.originating_org) {
    splits.push({ kind: 'originating_org', rate: 2, amount: round2(fee * 0.02), organization_id: referral.originating_org });
  }
  const taken = splits.reduce((s, x) => s + x.amount, 0);
  splits.push({ kind: 'platform', rate: null, amount: Math.max(0, round2(fee - taken)) });
  return splits;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function generateRefCode() {
  const year = new Date().getUTCFullYear();
  const rand = crypto.randomBytes(4).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `DRN-${year}-${rand}`;
}

// ─── State machine ────────────────────────────────────────────────────────────

describe('DRN state machine', () => {
  it('accepts the happy path: draft → sent → received → accepted → scheduled → in_progress → completed', () => {
    const path = ['draft', 'sent', 'received', 'accepted', 'scheduled', 'in_progress', 'completed'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(isValidTransition(path[i], path[i + 1]), true,
        `expected ${path[i]} → ${path[i + 1]} to be valid`);
    }
  });

  it('forbids skipping stages', () => {
    assert.equal(isValidTransition('draft', 'completed'), false);
    assert.equal(isValidTransition('draft', 'accepted'), false);
    assert.equal(isValidTransition('sent', 'completed'), false);
    assert.equal(isValidTransition('received', 'in_progress'), false);
  });

  it('forbids transitioning out of terminal states', () => {
    for (const terminal of ['completed', 'cancelled', 'no_show', 'declined', 'expired']) {
      assert.equal(isTerminal(terminal), true);
      assert.equal(isValidTransition(terminal, 'sent'), false);
      assert.equal(isValidTransition(terminal, 'draft'), false);
    }
  });

  it('allows cancellation from every non-terminal state', () => {
    for (const s of ['draft', 'sent', 'received', 'accepted', 'scheduled', 'in_progress']) {
      assert.equal(isValidTransition(s, 'cancelled'), true, `expected ${s} → cancelled to be valid`);
    }
  });

  it('allows expiry only from sent/received', () => {
    assert.equal(isValidTransition('sent', 'expired'), true);
    assert.equal(isValidTransition('received', 'expired'), true);
    assert.equal(isValidTransition('accepted', 'expired'), false);
    assert.equal(isValidTransition('scheduled', 'expired'), false);
  });

  it('rejects unknown states', () => {
    assert.equal(isValidTransition('weird', 'sent'), false);
    assert.equal(isValidTransition('sent', 'weird'), false);
    assert.equal(isValidTransition(null, 'sent'), false);
  });
});

// ─── AI matching score ────────────────────────────────────────────────────────

describe('DRN scoreCandidate', () => {
  const baseReq = { specialty: 'obstetrics', urgency: 'routine' };
  const baseCand = {
    specialty: 'obstetrics', org_state: 'FCT', org_lga: 'AMAC',
    accepts_emergency: true, price_max_naira: 20000,
    acceptance_rate: 95, avg_wait_minutes: 25, completed_referrals: 80,
    accepts_insurance: true,
  };

  it('returns 0 with reason when specialty mismatches', () => {
    const r = scoreCandidate(baseReq, { ...baseCand, specialty: 'cardiology' });
    assert.equal(r.score, 0);
    assert.deepEqual(r.reasons, ['specialty mismatch']);
  });

  it('rewards same LGA over same state', () => {
    const sameLga   = scoreCandidate({ ...baseReq, prefer_state: 'FCT', prefer_lga: 'AMAC' }, baseCand);
    const sameState = scoreCandidate({ ...baseReq, prefer_state: 'FCT', prefer_lga: 'BWARI' }, baseCand);
    assert.ok(sameLga.score > sameState.score);
  });

  it('penalises non-emergency-capable when urgency=emergency', () => {
    const cap = scoreCandidate({ ...baseReq, urgency: 'emergency' }, baseCand);
    const noCap = scoreCandidate({ ...baseReq, urgency: 'emergency' }, { ...baseCand, accepts_emergency: false });
    assert.ok(cap.score > noCap.score);
    assert.ok(noCap.reasons.includes('not emergency-capable'));
  });

  it('rewards within-budget candidates', () => {
    const within = scoreCandidate({ ...baseReq, max_price: 25000 }, baseCand);
    const over   = scoreCandidate({ ...baseReq, max_price: 10000 }, baseCand);
    assert.ok(within.score > over.score);
  });

  it('clamps score between 0 and 100', () => {
    const r = scoreCandidate({ ...baseReq, prefer_lga: 'AMAC', prefer_state: 'FCT', urgency: 'emergency', max_price: 25000, accepts_insurance: true }, baseCand);
    assert.ok(r.score >= 0 && r.score <= 100);
  });
});

// ─── Commission split ─────────────────────────────────────────────────────────

describe('DRN computeSplit', () => {
  it('returns empty when fee is zero or missing', () => {
    assert.deepEqual(computeSplit({}), []);
    assert.deepEqual(computeSplit({ service_fee_naira: 0 }), []);
  });

  it('agent split takes 5%, org takes 2%, platform takes 93%', () => {
    const splits = computeSplit({ service_fee_naira: 10000, originating_agent: 'a1', originating_org: 'o1' });
    const byKind = Object.fromEntries(splits.map(s => [s.kind, s.amount]));
    assert.equal(byKind.agent, 500);
    assert.equal(byKind.originating_org, 200);
    assert.equal(byKind.platform, 9300);
  });

  it('provider split (3%) only applies when no agent is present', () => {
    const withAgent = computeSplit({ service_fee_naira: 10000, originating_agent: 'a1', originating_provider: 'p1' });
    assert.equal(withAgent.find(s => s.kind === 'originating_provider'), undefined);
    assert.equal(withAgent.find(s => s.kind === 'agent').amount, 500);

    const noAgent = computeSplit({ service_fee_naira: 10000, originating_provider: 'p1' });
    assert.equal(noAgent.find(s => s.kind === 'originating_provider').amount, 300);
  });

  it('total of all splits always equals the fee exactly', () => {
    for (const fee of [1000, 7777, 50000, 12345.67]) {
      const splits = computeSplit({ service_fee_naira: fee, originating_agent: 'a', originating_org: 'o' });
      const total = round2(splits.reduce((s, x) => s + x.amount, 0));
      assert.equal(total, round2(fee), `sum should equal fee for ${fee}`);
    }
  });

  it('platform never goes negative', () => {
    const splits = computeSplit({ service_fee_naira: 100, originating_agent: 'a', originating_org: 'o' });
    const platform = splits.find(s => s.kind === 'platform');
    assert.ok(platform.amount >= 0);
  });
});

// ─── QR token hashing ─────────────────────────────────────────────────────────

describe('DRN QR token hashing', () => {
  it('produces a stable 64-char hex sha256 digest', () => {
    const h = hashToken('abc123');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashToken('abc123'));
  });

  it('different tokens produce different hashes', () => {
    assert.notEqual(hashToken('a'), hashToken('b'));
  });
});

// ─── Ref code generator ───────────────────────────────────────────────────────

describe('DRN ref-code', () => {
  it('matches DRN-YYYY-XXXXXX format', () => {
    const code = generateRefCode();
    assert.match(code, /^DRN-\d{4}-[A-Z0-9]{6}$/);
  });

  it('generates unique codes across 100 calls', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(generateRefCode());
    assert.equal(seen.size, 100);
  });
});
