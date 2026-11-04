'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createGeminiEvaluationPolicy } = require('../../services/voice/geminiEvaluationPolicy');
const { MODEL } = require('../../services/voice/geminiLiveEvaluationTransport');
const actor = { id: 'fictional-evaluator', role: 'provider' }, context = { consentVersion: 'voice-live-synthetic-v1' };
function fixture(options = {}) {
  let at = 10000;
  const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: 'fictional-region', termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
  const record = { ...binding, status: 'approved', revision: 'r1', validFrom: 0, expiresAt: 100000, evaluationId: 'fictional-eval', purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic' };
  const snapshot = { observedAt: at, principal: { id: actor.id, role: actor.role, active: true },
    evaluatorGrant: { ...record, actorId: actor.id, languages: ['ha', 'ig', 'yo'] },
    consent: { ...record, actorId: actor.id, language: 'ha', version: context.consentVersion, audioScope: 'fictional_tester_audio' },
    processorApproval: { ...record, languages: ['ha', 'ig', 'yo'] },
    budgetApproval: { ...record, approvalId: 'fictional-zero-budget', currency: 'USD', limitMinor: 0, billingMode: 'free_tier_only' },
    providerBilling: { ...binding, status: 'verified', revision: 'billing-r1', evidenceRef: 'fictional-evidence', evidenceSource: 'google_project_billing', observedAt: at, validFrom: 0, expiresAt: 90000,
      usageTier: 'free', billingEnabled: false, freeTierEligible: true, modelFreeTierAvailable: true } };
  const config = { evaluationId: record.evaluationId, providerBinding: binding, requireFreeTier: true, now: () => at, readApprovalSnapshot: async () => structuredClone(snapshot), ...options };
  const policy = createGeminiEvaluationPolicy(config);
  return { config, snapshot, policy, request: () => policy({ actor, language: 'ha', context }), advance: ms => { at += ms; snapshot.observedAt = at; } };
}
test('explicit zero-charge scope requires separate current verified project billing evidence', async () => {
  const f = fixture(), result = await f.request();
  assert.equal(result.billingMode, 'free_tier_only'); assert.equal(result.budgetEnforced, false);
  assert.equal(result.validUntil, 90000); assert.equal(result.approvalRevisions.billing, 'billing-r1');
  assert.equal(result.providerBilling, undefined); assert.equal(result.budgetApproval, undefined); assert.equal(result.evidenceRef, undefined);
});
test('zero budget, paid budget and paid-project zero cap are not Free Tier approval', async () => {
  for (const patch of [{ billingMode: undefined }, { billingMode: undefined, limitMinor: 1 }, { billingMode: 'paid_project_cap' }, { limitMinor: 1 }, { limitMinor: -1 }, { limitMinor: '0' }]) {
    const f = fixture(); Object.assign(f.snapshot.budgetApproval, patch); await assert.rejects(f.request(), { code: 'VOICE_EVALUATION_APPROVAL_REQUIRED' });
  }
});
test('missing or ineligible, paid, unverified, stale, future, revoked and wrong-project billing evidence fails closed', async () => {
  for (const patch of [null, { usageTier: 'paid' }, { billingEnabled: true }, { billingEnabled: undefined }, { freeTierEligible: false }, { freeTierEligible: 'true' }, { modelFreeTierAvailable: false },
    { status: 'pending' }, { evidenceSource: 'studio_browser' }, { evidenceSource: 'models_list' }, { evidenceRef: '' }, { revision: '' }, { observedAt: 8999 }, { observedAt: 10001 },
    { expiresAt: 10000 }, { validFrom: 10001 }, { revokedAt: 1 }, { projectRef: 'wrong' }, { accountRef: 'wrong' }, { model: 'wrong' }, { provider: 'wrong' }]) {
    const f = fixture(); if (patch) Object.assign(f.snapshot.providerBilling, patch); else delete f.snapshot.providerBilling;
    await assert.rejects(f.request(), { code: 'VOICE_EVALUATION_APPROVAL_REQUIRED' });
  }
});
test('a refreshed approval snapshot cannot make stale billing evidence current', async () => {
  const f = fixture(); await f.request(); f.advance(1001); await assert.rejects(f.request());
});
test('billing eligibility is reread and paid upgrade revokes an existing free approval', async () => {
  const f = fixture(); await f.request(); f.snapshot.providerBilling.billingEnabled = true; await assert.rejects(f.request());
  f.snapshot.providerBilling.billingEnabled = false; f.snapshot.providerBilling.freeTierEligible = false; await assert.rejects(f.request());
});
test('standalone legacy positive-budget policy stays explicit and never turns zero into paid approval', async () => {
  const f = fixture({ requireFreeTier: false }); delete f.snapshot.budgetApproval.billingMode; f.snapshot.budgetApproval.limitMinor = 1;
  assert.equal((await f.request()).billingMode, 'approved_budget'); f.snapshot.budgetApproval.limitMinor = 0; await assert.rejects(f.request());
  assert.throws(() => createGeminiEvaluationPolicy({ ...f.config, requireFreeTier: 'true' }), { code: 'VOICE_EVALUATION_POLICY_INVALID' });
});
test('caller context cannot supply free-tier authority or change required cost scope', async () => {
  const f = fixture(); await assert.rejects(f.policy({ actor, language: 'ha', context: { ...context, billingMode: 'free_tier_only' } }));
});
test('noncancelable timed-out approval reads retain bounded slots until actual completion', { timeout: 4000 }, async () => {
  const f = fixture(); let release, reads = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const policy = createGeminiEvaluationPolicy({ ...f.config, readApprovalSnapshot: async () => { reads++; await wait; return f.snapshot; } });
  const request = () => policy({ actor, language: 'ha', context });
  await Promise.all(Array.from({ length: 50 }, () => assert.rejects(request(), { code: 'VOICE_EVALUATION_POLICY_UNAVAILABLE' })));
  await assert.rejects(request(), { code: 'VOICE_EVALUATION_POLICY_UNAVAILABLE' }); assert.equal(reads, 50);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal((await request()).billingMode, 'free_tier_only'); assert.equal(reads, 51);
});

test('catalog expansion never extends an existing language approval or fictional consent', async () => {
  const f = fixture();
  await assert.rejects(f.policy({ actor, language: 'sw', context }), { code: 'VOICE_EVALUATION_APPROVAL_REQUIRED' });
  f.snapshot.evaluatorGrant.languages.push('sw'); f.snapshot.processorApproval.languages.push('sw');
  await assert.rejects(f.policy({ actor, language: 'sw', context }), { code: 'VOICE_EVALUATION_APPROVAL_REQUIRED' });
  f.snapshot.consent.language = 'sw';
  const result = await f.policy({ actor, language: 'sw', context }); assert.equal(result.language, 'sw'); assert.equal(result.billingMode, 'free_tier_only');
  await assert.rejects(f.request(), { code: 'VOICE_EVALUATION_APPROVAL_REQUIRED' });
});
