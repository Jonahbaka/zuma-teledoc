'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bridge = require('../services/linkedPhcAiService');

test('canonical encounter adapter verifies clinician and exact linked PHC record before inference', async () => {
  const chart = require('../services/clinicalEncounterService');
  const scope = require('../../ng/services/phc/programmeScopeService');
  const ai = require('../../ng/services/phc/clinicalAiService');
  const originals = { lock: chart._lockEncounter, scope: scope.assertProgrammeScope, create: ai.createSuggestion, review: ai.reviewSuggestion };
  const ids = Array.from({ length: 5 }, () => require('node:crypto').randomUUID());
  const [canonical, clinician, source, patient, draft] = ids;
  let generated = 0, reviewed = 0, sawScope, sawSql;
  chart._lockEncounter = async (_client, encounterId, actorId) => {
    assert.equal(encounterId, canonical);
    assert.equal(actorId, clinician);
    return { id: canonical, patient_id: patient };
  };
  scope.assertProgrammeScope = async (_client, actor, opts) => {
    assert.equal(actor.id, clinician); sawScope = opts;
    return { userId: clinician, programmeRole: 'remote_clinician', programme_id: 'programme', facility_id: 'facility' };
  };
  ai.createSuggestion = async (_pool, _req, context, options) => {
    generated++;
    assert.equal(context.programmeRole, 'remote_clinician');
    assert.equal(options.encounterId, source);
    return { id: draft, status: 'drafted' };
  };
  ai.reviewSuggestion = async (_pool, _req, context, suggestionId, decision) => {
    reviewed++;
    assert.equal(suggestionId, draft);
    assert.equal(decision.expectedEncounterId, source);
    return { status: 'accepted' };
  };
  const pool = {
    connect: async () => ({ release() {}, async query(sql, values = []) {
      if (sql.includes('FROM clinical_encounters ce')) {
        sawSql = sql;
        return { rows: [{ source_encounter_id: source, patient_user_id: patient, programme_id: 'programme', facility_id: 'facility' }] };
      }
      return { rows: [] };
    } }),
    async query() { return { rows: [{ id: draft }] }; },
  };
  try {
    const result = await bridge.createLinkedDraft({}, canonical, clinician, 'soap_draft', pool);
    assert.equal(result.id, draft);
    assert.equal(sawScope.requireEnrollment, true);
    assert.deepEqual(sawScope.allowedRoles, ['remote_clinician']);
    assert.match(sawSql, /e.patient_user_id=ce.patient_id/);
    assert.match(sawSql, /ce.provider_id=\$2/);
    await bridge.reviewLinkedDraft({}, canonical, clinician, draft, { decision: 'accepted' }, pool);
    assert.equal(generated, 1);
    assert.equal(reviewed, 1);
  } finally {
    chart._lockEncounter = originals.lock;
    scope.assertProgrammeScope = originals.scope;
    ai.createSuggestion = originals.create;
    ai.reviewSuggestion = originals.review;
  }
});

test('provider route and chart UI keep AI note generation, review, import and signing separate', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/clinicalEncounters.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../app/(dashboard)/provider/encounters/[id]/page.js'), 'utf8');
  assert.match(routes, /createLinkedDraft\(req, req.params.encounterId, req.user.id/);
  assert.match(routes, /reviewLinkedDraft\(req, req.params.encounterId, req.user.id/);
  assert.match(page, /const prepareEncounterAiDraft = async/);
  assert.match(page, /const reviewEncounterAiDraft = async/);
  const prepare = page.slice(page.indexOf('  const prepareEncounterAiDraft ='), page.indexOf('  const importReviewedDraft ='));
  assert.doesNotMatch(prepare, /\.signNote\(|\.createPrescriptionIntent\(|\.createNote\(/);
});
