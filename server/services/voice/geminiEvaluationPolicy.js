'use strict';
const { MODEL, LANGUAGES } = require('./geminiLiveEvaluationTransport');
const PURPOSE = 'synthetic_voice_evaluation';
const CONSENT_VERSION = 'voice-live-synthetic-v1';
const BINDING_KEYS = ['provider', 'accountRef', 'projectRef', 'model', 'region', 'termsVersion', 'retentionVersion'];
const ROLES = ['provider', 'admin', 'super_admin'];
const ref = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fail = (code, statusCode = 403) => { throw Object.assign(new Error('Current synthetic voice evaluation approval is required.'), { code, statusCode }); };
const denied = () => fail('VOICE_EVALUATION_APPROVAL_REQUIRED');
function active(record, at) {
  return record && record.status === 'approved' && record.revokedAt == null && ref(record.revision)
    && Number.isSafeInteger(record.validFrom) && record.validFrom <= at
    && Number.isSafeInteger(record.expiresAt) && record.expiresAt > at;
}
function sameBinding(record, binding) { return BINDING_KEYS.every(key => record?.[key] === binding[key]); }
function languageAllowed(record, language) { return Array.isArray(record?.languages) && record.languages.includes(language) && record.languages.every(item => Object.hasOwn(LANGUAGES, item)); }

// Separate Gemini approval scope. OpenAI approvals are never accepted.
// Google Developer API clinical-use restrictions remain a deployment gate.
// An unmounted, read-only policy adapter, not an approval store or activation
// switch. The trusted composition supplies its provider identity and a reader
// of a consistent, current authoritative snapshot. Never pass request bodies,
// browser storage or model output as the snapshot. The reader must reread on
// each call; this adapter deliberately has no approval cache or fallback.
function createGeminiEvaluationPolicy({ evaluationId, providerBinding, readApprovalSnapshot, requireFreeTier = false, now = Date.now } = {}) {
  if (!ref(evaluationId) || !providerBinding || Object.keys(providerBinding).some(key => !BINDING_KEYS.includes(key))
    || !BINDING_KEYS.every(key => ref(providerBinding[key])) || providerBinding.provider !== 'google'
    || providerBinding.model !== MODEL || typeof readApprovalSnapshot !== 'function' || typeof requireFreeTier !== 'boolean' || typeof now !== 'function')
    fail('VOICE_EVALUATION_POLICY_INVALID', 503);
  // Capture a copy so later caller mutations cannot silently change approval
  // scope. This metadata does not verify ownership of any provider credential.
  const binding = Object.freeze({ ...providerBinding });
  let pendingReads = 0;
  return async function authorize({ actor, language, context } = {}) {
    if (!ref(actor?.id) || !ROLES.includes(actor.role) || !Object.hasOwn(LANGUAGES, language)
      || !context || Object.keys(context).some(key => key !== 'consentVersion') || context.consentVersion !== CONSENT_VERSION) denied();
    let snapshot, timeout;
    if (pendingReads >= 50) fail('VOICE_EVALUATION_POLICY_UNAVAILABLE', 503);
    pendingReads++;
    // A timeout does not cancel a database/provider metadata read. Retain its
    // work slot until it settles so retries cannot accumulate unbounded work.
    const reading = Promise.resolve().then(() => readApprovalSnapshot({ actorId: actor.id, evaluationId, language }))
      .finally(() => { pendingReads--; });
    try {
      snapshot = await Promise.race([
        reading,
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Approval read timed out.')), 1000); }),
      ]);
    } catch { fail('VOICE_EVALUATION_POLICY_UNAVAILABLE', 503); }
    finally { clearTimeout(timeout); }
    const at = now();
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(snapshot?.observedAt) || snapshot.observedAt > at || at - snapshot.observedAt > 1000) denied();
    const { principal, evaluatorGrant, consent, processorApproval, budgetApproval, providerBilling } = snapshot;
    // Re-check current authority, not just the role captured at session start.
    if (principal?.id !== actor.id || principal.active !== true || !ROLES.includes(principal.role)) denied();
    for (const record of [evaluatorGrant, consent, processorApproval, budgetApproval]) {
      if (!active(record, at) || record.evaluationId !== evaluationId || record.purpose !== PURPOSE || record.dataClass !== 'synthetic' || !sameBinding(record, binding)) denied();
    }
    if (evaluatorGrant.actorId !== actor.id || !languageAllowed(evaluatorGrant, language)) denied();
    if (consent.actorId !== actor.id || consent.language !== language || consent.version !== CONSENT_VERSION
      || consent.audioScope !== 'fictional_tester_audio') denied();
    if (!languageAllowed(processorApproval, language)) denied();
    if (!ref(budgetApproval.approvalId)
      || !/^[A-Z]{3}$/.test(budgetApproval.currency) || !Number.isSafeInteger(budgetApproval.limitMinor)) denied();
    const freeTier = budgetApproval.billingMode === 'free_tier_only';
    if (requireFreeTier && !freeTier) denied();
    if (freeTier) {
      // Current, provider-account-derived evidence must be supplied by the
      // trusted reader. A zero budget, Studio login, a successful model listing,
      // or a paid project's spending cap cannot stand in for Free Tier status.
      // These checks validate metadata; they do not query Google or enforce a
      // provider spending cap. Do not fabricate or refresh evidence timestamps.
      if (budgetApproval.limitMinor !== 0 || !providerBilling || providerBilling.status !== 'verified'
        || providerBilling.revokedAt != null || !sameBinding(providerBilling, binding)
        || !ref(providerBilling.revision) || !ref(providerBilling.evidenceRef)
        || providerBilling.evidenceSource !== 'google_project_billing'
        || providerBilling.usageTier !== 'free' || providerBilling.billingEnabled !== false
        || providerBilling.freeTierEligible !== true || providerBilling.modelFreeTierAvailable !== true
        || !Number.isSafeInteger(providerBilling.observedAt) || providerBilling.observedAt > at || at - providerBilling.observedAt > 1000
        || !Number.isSafeInteger(providerBilling.validFrom) || providerBilling.validFrom > at
        || !Number.isSafeInteger(providerBilling.expiresAt) || providerBilling.expiresAt <= at) denied();
    } else if (budgetApproval.billingMode !== undefined || budgetApproval.limitMinor <= 0) denied();
    return {
      actorId: actor.id, language, dataClass: 'synthetic', consentActive: true, consentVersion: CONSENT_VERSION, providerApproved: true,
      evaluationId, providerBinding: { ...binding },
      observedAt: snapshot.observedAt,
      validUntil: Math.min(evaluatorGrant.expiresAt, consent.expiresAt, processorApproval.expiresAt, budgetApproval.expiresAt, freeTier ? providerBilling.expiresAt : Infinity),
      approvalRevisions: { evaluator: evaluatorGrant.revision, consent: consent.revision, processor: processorApproval.revision, budget: budgetApproval.revision,
        ...(freeTier ? { billing: providerBilling.revision } : {}) },
      // Permission metadata is not metering, an atomic reservation or proof
      // that a human will refrain from speaking patient information.
      budgetApproved: true, budgetEnforced: false, billingMode: freeTier ? 'free_tier_only' : 'approved_budget', audioContentVerifiedSynthetic: false,
    };
  };
}
module.exports = { createGeminiEvaluationPolicy };
