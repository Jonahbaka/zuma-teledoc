'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveContext, prepareDraft } = require('../../lib/clinical-copilot-context.cjs');
const context = { appointmentId: 'fictional-visit', patientId: 'fictional-patient', providerId: 'fictional-provider' };
const encounter = { id: 'fictional-encounter', ...context, status: 'in_progress' };
const response = (key, value) => ({ data: { success: true, [key]: value } });
test('copilot selects exact owned appointment encounter, never latest unrelated encounter', async () => {
  const api = { appointments: { getById: async () => response('appointment', { id: context.appointmentId, patientId: context.patientId, providerId: context.providerId }) },
    clinical: { getPatientEncounters: async () => response('encounters', [{ ...encounter, id: 'unrelated', appointmentId: 'another' }, encounter]) } };
  assert.equal((await resolveContext(api, context)).encounter.id, encounter.id);
  api.clinical.getPatientEncounters = async () => response('encounters', [{ ...encounter, providerId: 'other-provider' }]);
  assert.equal((await resolveContext(api, context)).encounter, null);
  api.appointments.getById = async () => response('appointment', { id: 'another', ...context });
  await assert.rejects(resolveContext(api, context));
});
test('draft generation rechecks exact encounter and sends only canonical ID plus stage', async () => {
  let generated = 0;
  const api = { getEncounter: async () => response('encounter', encounter), createEncounterAiDraft: async (...args) => {
    generated++; assert.deepEqual(args, [encounter.id, 'soap_draft']);
    return response('suggestion', { id: 'fictional-draft', status: 'drafted', patient_user_id: context.patientId });
  } };
  assert.equal((await prepareDraft(api, context, encounter.id, 'soap_draft')).id, 'fictional-draft');
  api.getEncounter = async () => response('encounter', { ...encounter, status: 'completed' });
  await assert.rejects(prepareDraft(api, context, encounter.id, 'soap_draft'));
  assert.equal(generated, 1);
});
test('copilot refuses unverified or wrong-patient AI draft responses', async () => {
  const api = { getEncounter: async () => response('encounter', encounter), createEncounterAiDraft: async () => response('suggestion', { id: 'wrong', status: 'drafted', patient_user_id: 'other-patient' }) };
  await assert.rejects(prepareDraft(api, context, encounter.id, 'soap_draft'));
});
