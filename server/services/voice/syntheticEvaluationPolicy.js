'use strict';
const { MODEL, LANGUAGES } = require('../../../shared/voice/liveProtocol.cjs');
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

// An unmounted, read-only policy adapter, not an approval store or activation
// switch. The trusted composition supplies its provider identity and a reader
// of a consistent, current authoritative snapshot. Never pass request bodies,
// browser storage or model output as the snapshot. The reader must reread on
// each call; this adapter deliberately has no approval cache or fallback.
function createSyntheticEvaluationPolicy({ evaluationId, providerBinding, readApprovalSnapshot, now = Date.now } = {}) {
  if (!ref(evaluationId) || !providerBinding || Object.keys(providerBinding).some(key => !BINDING_KEYS.includes(key))
    || !BINDING_KEYS.every(key => ref(providerBinding[key])) || providerBinding.provider !== 'openai'
    || providerBinding.model !== MODEL || typeof readApprovalSnapshot !== 'function' || typeof now !== 'function')
    fail('VOICE_EVALUATION_POLICY_INVALID', 503);
  // Capture a copy so later caller mutations cannot silently change approval
  // scope. This metadata does not verify ownership of any provider credential.
  const binding = Object.freeze({ ...providerBinding });
  return async function authorize({ actor, language, context } = {}) {
    if (!ref(actor?.id) || !ROLES.includes(actor.role) || !Object.hasOwn(LANGUAGES, language)
      || !context || Object.keys(context).some(key => key !== 'consentVersion') || context.consentVersion !== CONSENT_VERSION) denied();
    let snapshot, timeout;
    try {
      snapshot = await Promise.race([
        readApprovalSnapshot({ actorId: actor.id, evaluationId, language }),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Approval read timed out.')), 1000); }),
      ]);
    } catch { fail('VOICE_EVALUATION_POLICY_UNAVAILABLE', 503); }
    finally { clearTimeout(timeout); }
    const at = now();
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(snapshot?.observedAt) || snapshot.observedAt > at || at - snapshot.observedAt > 1000) denied();
    const { principal, evaluatorGrant, consent, processorApproval, budgetApproval } = snapshot;
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
      || !/^[A-Z]{3}$/.test(budgetApproval.currency) || !Number.isSafeInteger(budgetApproval.limitMinor) || budgetApproval.limitMinor <= 0) denied();
    return {
      actorId: actor.id, language, dataClass: 'synthetic', consentActive: true, consentVersion: CONSENT_VERSION, providerApproved: true,
      evaluationId, providerBinding: { ...binding },
      observedAt: snapshot.observedAt,
      validUntil: Math.min(evaluatorGrant.expiresAt, consent.expiresAt, processorApproval.expiresAt, budgetApproval.expiresAt),
      approvalRevisions: { evaluator: evaluatorGrant.revision, consent: consent.revision, processor: processorApproval.revision, budget: budgetApproval.revision },
      // Permission metadata is not metering, an atomic reservation or proof
      // that a human will refrain from speaking patient information.
      budgetApproved: true, budgetEnforced: false, audioContentVerifiedSynthetic: false,
    };
  };
}
module.exports = { createSyntheticEvaluationPolicy };
