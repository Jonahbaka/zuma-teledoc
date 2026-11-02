'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ai = require('../services/phc/clinicalAiService');
const encounter = { id: 'encounter-a', patient_user_id: 'patient-a', chief_complaint: 'Synthetic complaint', status: 'in_progress' };
const observations = [];
const now = Date.parse('2026-11-01T10:00:00Z');
function draft() {
  return { encounter_id: encounter.id, patient_user_id: encounter.patient_user_id, expires_at: '2026-11-01T11:00:00Z', input_hash: crypto.createHash('sha256').update(JSON.stringify(ai.buildGroundedInput(encounter, observations).input)).digest('hex') };
}
test('only same patient/encounter and fresh unchanged source snapshot permits acceptance checks', () => {
  assert.doesNotThrow(() => ai.assertReviewFreshness(draft(), encounter, observations, encounter.id, now));
  for (const args of [
    [{ ...draft(), patient_user_id: 'patient-b' }, encounter, observations, encounter.id],
    [draft(), encounter, observations, 'encounter-b'],
    [draft(), { ...encounter, id: 'encounter-b' }, observations, encounter.id],
  ]) assert.throws(() => ai.assertReviewFreshness(...args, now), { code: 'CLINICAL_AI_ENCOUNTER_MISMATCH' });
  assert.throws(() => ai.assertReviewFreshness({ ...draft(), expires_at: '2026-11-01T09:00:00Z' }, encounter, observations, encounter.id, now), { code: 'CLINICAL_AI_DRAFT_EXPIRED' });
  assert.throws(() => ai.assertReviewFreshness(draft(), { ...encounter, chief_complaint: 'Changed source' }, observations, encounter.id, now), { code: 'CLINICAL_AI_SOURCE_CHANGED' });
  assert.throws(() => ai.assertReviewFreshness({ ...draft(), input_hash: null }, encounter, observations, encounter.id, now), { code: 'CLINICAL_AI_SOURCE_CHANGED' });
});
test('non-clinician cannot review via service even if route authorization is missed', async () => {
  const pool = { connect() { throw new Error('Must reject before DB'); } };
  await assert.rejects(ai.reviewSuggestion(pool, {}, { programmeRole: 'phc_nurse' }, 'draft-a', { decision: 'accepted', expectedEncounterId: encounter.id }), { code: 'ASSIGNED_CLINICIAN_REQUIRED' });
});

const source = fs.readFileSync(path.join(__dirname, '../../components/ng/phc/PhcWorkspace.jsx'), 'utf8');
function handlerHarness() {
  const pending = new Map();
  let suggestion = null;
  let error = '';
  const version = { current: 0 };
  const context = { aiRequestVersion: version, context: {}, aiDraftType: 'soap_draft', careStages: require('../../shared/clinicalAiStages.json'), programmeRole: 'remote_clinician', setAiEditedOutput() {}, setAiTaskOptions() {}, setAiSuggestion: value => { suggestion = value; }, setError: value => { error = value; }, setNotice() {},
    run: (_name, operation) => operation(),
    phcAPI: { createAiSuggestion: (_context, { encounterId }) => new Promise(resolve => pending.set(encounterId, resolve)) },
  };
  const body = source.slice(source.indexOf('  const requestAiDraft ='), source.indexOf('  const reviewAiDraft =')).replace('const requestAiDraft =', 'globalThis.requestAiDraft =');
  vm.runInNewContext(body, context);
  return { request: context.requestAiDraft, resolve: (id, returnedId = id) => pending.get(id)({ data: { suggestion: { id: `draft-${id}`, encounter_id: returnedId, output: {} } } }), invalidate() { version.current++; suggestion = null; }, suggestion: () => suggestion, error: () => error };
}
test('late draft response cannot replace newer encounter draft', async () => {
  const view = handlerHarness();
  const a = view.request('encounter-a');
  const b = view.request('encounter-b', 'encounter_summary', 'queue');
  view.resolve('encounter-b'); await b;
  view.resolve('encounter-a'); await a;
  assert.equal(view.suggestion().encounter_id, 'encounter-b');
  assert.equal(view.suggestion().reviewView, 'queue');
});
test('patient/context invalidation discards in-flight draft and response mismatch is rejected', async () => {
  const view = handlerHarness();
  const a = view.request('encounter-a'); view.invalidate(); view.resolve('encounter-a'); await a;
  assert.equal(view.suggestion(), null);
  const b = view.request('encounter-b'); view.resolve('encounter-b', 'encounter-a'); await b;
  assert.equal(view.suggestion(), null);
  assert.match(view.error(), /does not match/);
});
test('patient UI resets draft immediately and binds display/review to encounter identity', () => {
  assert.match(source, /clearAiSuggestion\(\); setSelectedPatient\(patient\); setActiveEncounter\(null\)/);
  assert.match(source, /String\(aiSuggestion.encounter_id\) === String\(activeEncounter.id\)/);
  assert.match(source, /expectedEncounterId: aiSuggestion.encounter_id/);
  assert.match(source, /AI-generated content is unverified/);
  assert.match(source, /assertion.sourceRefs.join/);
});

test('source hash is stable when observations have identical timestamps but change order', () => {
  const one = { id: 'observation-b', value_numeric: 1 };
  const two = { id: 'observation-a', value_numeric: 2 };
  assert.deepEqual(ai.buildGroundedInput(encounter, [one, two]).input, ai.buildGroundedInput(encounter, [two, one]).input);
});
test('review and observation writes share encounter lock; assignment remains locked during review', () => {
  const aiSource = fs.readFileSync(path.join(__dirname, '../services/phc/clinicalAiService.js'), 'utf8');
  const workflowSource = fs.readFileSync(path.join(__dirname, '../services/phc/phcWorkflowService.js'), 'utf8');
  assert.match(aiSource, /SELECT assigned_provider_user_id[\s\S]*?LIMIT 1 FOR UPDATE/);
  assert.match(aiSource, /SELECT id FROM ng_clinical_encounters[\s\S]*?FOR UPDATE/);
  assert.match(aiSource, /SELECT id FROM ng_clinical_observations[\s\S]*?FOR SHARE/);
  const capture = workflowSource.slice(workflowSource.indexOf('async function createObservation('), workflowSource.indexOf('async function listObservations('));
  assert.ok(capture.indexOf('FOR UPDATE') < capture.indexOf('INSERT INTO ng_clinical_observations'));
});

test('structured SOAP cannot bypass assertion provenance and task proposals need sources', () => {
  const valid = { summary: 'Recorded concern.', handoverDraft: 'Recorded concern.', assertions: [{ text: 'Recorded concern.', sourceRefs: ['encounter:chief_complaint'] }], missingInformation: [], uncertainties: [], soapDraft: { subjective: 'Recorded concern.', objective: '', assessment: '', plan: '' }, followUpDrafts: [] };
  const sources = new Map([['encounter:chief_complaint', {}]]);
  assert.doesNotThrow(() => ai.validateGrounding(ai.parseModelJson(JSON.stringify(valid)), sources));
  assert.throws(() => ai.validateGrounding({ ...valid, soapDraft: { ...valid.soapDraft, assessment: 'Unsupported diagnosis' } }, sources), { code: 'CLINICAL_AI_NARRATIVE_REJECTED' });
  assert.throws(() => ai.validateGrounding({ ...valid, followUpDrafts: [{ title: 'Unlinked proposal', instructions: '', sourceRefs: [] }] }, sources), { code: 'CLINICAL_AI_GROUNDING_REJECTED' });
});

test('accepted follow-up source uses reviewed encrypted content and denies tampered content', async () => {
  const workflow = require('../services/phc/phcWorkflowService');
  const oldGet = workflow.getEncounter;
  const oldList = workflow.listObservations;
  const oldKey = process.env.CLINICAL_AI_ENCRYPTION_KEY;
  process.env.CLINICAL_AI_ENCRYPTION_KEY = '1234567890abcdef'.repeat(4);
  workflow.getEncounter = async () => encounter;
  workflow.listObservations = async () => ({ observations: [] });
  const original = ai.encryptJson({ followUpDrafts: [{ title: 'Original proposal', instructions: '' }] });
  const edit = ai.encryptJson({ followUpDrafts: [{ title: 'Clinician-reviewed proposal', instructions: 'Verify documented information.' }] });
  const suggestion = { ...draft(), status: 'accepted', decision: 'accepted_with_edits', reviewer_user_id: 'clinician-a', expires_at: new Date(Date.now() + 60000).toISOString(), output_encrypted: original.encrypted, output_iv: original.iv, output_tag: original.tag, edited_output_encrypted: edit.encrypted, edited_output_iv: edit.iv, edited_output_tag: edit.tag };
  const client = { async query(sql) {
    if (sql.includes('SELECT s.*')) return { rows: [suggestion] };
    if (sql.includes('SELECT assigned_provider_user_id')) return { rows: [{ assigned_provider_user_id: 'clinician-a' }] };
    return { rows: [] };
  } };
  const context = { programmeRole: 'remote_clinician', userId: 'clinician-a', programme_id: 'programme-a', facility_id: 'facility-a' };
  const request = { suggestionId: 'draft-a', draftIndex: 0, patientUserId: encounter.patient_user_id, encounterId: encounter.id, title: 'Clinician-reviewed proposal', instructions: 'Verify documented information.' };
  try {
    await assert.doesNotReject(() => ai.assertAcceptedFollowUpSource(client, context, request));
    await assert.rejects(ai.assertAcceptedFollowUpSource(client, context, { ...request, title: 'Tampered proposal' }), { code: 'CLINICAL_AI_FOLLOW_UP_MISMATCH' });
    await assert.rejects(ai.assertAcceptedFollowUpSource(client, context, { ...request, patientUserId: 'patient-b' }), { code: 'CLINICAL_AI_ENCOUNTER_MISMATCH' });
    suggestion.decision = 'accepted';
    await assert.rejects(ai.assertAcceptedFollowUpSource(client, context, request), { code: 'CLINICAL_AI_FOLLOW_UP_MISMATCH' });
    suggestion.decision = 'accepted_with_edits';
    suggestion.edited_output_encrypted = null;
    await assert.rejects(ai.assertAcceptedFollowUpSource(client, context, request), { code: 'CLINICAL_AI_ACCEPTED_REVIEW_REQUIRED' });
    suggestion.status = 'drafted';
    await assert.rejects(ai.assertAcceptedFollowUpSource(client, context, request), { code: 'CLINICAL_AI_ACCEPTED_REVIEW_REQUIRED' });
  } finally {
    workflow.getEncounter = oldGet; workflow.listObservations = oldList;
    if (oldKey === undefined) delete process.env.CLINICAL_AI_ENCRYPTION_KEY; else process.env.CLINICAL_AI_ENCRYPTION_KEY = oldKey;
  }
});

test('synthetic provider draft persists protected provenance and clinician review never auto-writes chart', async () => {
  const workflow = require('../services/phc/phcWorkflowService');
  const oldGet = workflow.getEncounter;
  const oldList = workflow.listObservations;
  const oldKey = process.env.CLINICAL_AI_ENCRYPTION_KEY;
  process.env.CLINICAL_AI_ENCRYPTION_KEY = 'abcdef1234567890'.repeat(4);
  const sourceEncounter = { ...encounter, assigned_provider_user_id: 'clinician-a' };
  workflow.getEncounter = async () => sourceEncounter;
  workflow.listObservations = async () => ({ observations: [] });
  const queries = [];
  let stored;
  const client = { release() {}, async query(sql, args = []) {
    queries.push(sql);
    if (sql.includes('SELECT p.settings_json')) return { rows: [{ ai_flag: 1 }] };
    if (sql.includes('INSERT INTO ng_clinical_ai_suggestions')) {
      stored = { id: 'draft-a', encounter_id: args[3], patient_user_id: args[2], status: 'drafted', input_hash: args[9], output_encrypted: args[10], output_iv: args[11], output_tag: args[12], validation_json: JSON.parse(args[15]), expires_at: new Date(Date.now() + 60000).toISOString() };
      return { rows: [stored] };
    }
    if (sql.includes('SELECT * FROM ng_clinical_ai_suggestions')) return { rows: [stored] };
    if (sql.includes('SELECT assigned_provider_user_id')) return { rows: [{ assigned_provider_user_id: 'clinician-a' }] };
    return { rows: [] };
  } };
  const pool = { query: client.query.bind(client), connect: async () => client };
  const context = { programmeRole: 'remote_clinician', userId: 'clinician-a', programme_id: 'programme-a', facility_id: 'facility-a', demo_only: true };
  const output = { summary: 'Synthetic complaint', handoverDraft: 'Synthetic complaint', assertions: [{ text: 'Synthetic complaint', sourceRefs: ['encounter:chief_complaint'] }], missingInformation: [], uncertainties: [], soapDraft: { subjective: 'Synthetic complaint', objective: '', assessment: '', plan: '' }, followUpDrafts: [] };
  try {
    const result = await ai.createSuggestion(pool, {}, context, { encounterId: encounter.id, suggestionType: 'soap_draft' }, async ({ input }) => {
      assert.equal(input.encounter.chiefComplaint, encounter.chief_complaint);
      return { text: JSON.stringify(output), provider: 'synthetic-test', model: 'fixture', modelVersion: 'fixture' };
    });
    assert.equal(result.encounter_id, encounter.id);
    assert.equal(result.patient_user_id, encounter.patient_user_id);
    assert.equal(stored.validation_json.groundingValidated, false);
    assert.notEqual(stored.output_encrypted, JSON.stringify(output));
    assert.deepEqual(ai.decryptJson({ encrypted: stored.output_encrypted, iv: stored.output_iv, tag: stored.output_tag }), output);
    const review = await ai.reviewSuggestion(pool, {}, context, result.id, { decision: 'accepted', expectedEncounterId: encounter.id });
    assert.equal(review.status, 'accepted');
    assert.ok(queries.some(sql => sql.includes('INSERT INTO ng_clinical_ai_reviews')));
    assert.equal(queries.some(sql => /INSERT INTO clinical_notes|UPDATE clinical_notes|INSERT INTO ng_follow_up_tasks/.test(sql)), false);
  } finally {
    workflow.getEncounter = oldGet; workflow.listObservations = oldList;
    if (oldKey === undefined) delete process.env.CLINICAL_AI_ENCRYPTION_KEY; else process.env.CLINICAL_AI_ENCRYPTION_KEY = oldKey;
  }
});

test('edited content cannot be smuggled into an accepted-original review', async () => {
  await assert.rejects(ai.reviewSuggestion({ connect() { throw new Error('Must reject before DB'); } }, {}, { programmeRole: 'remote_clinician' }, 'draft-a', { decision: 'accepted', expectedEncounterId: encounter.id, editedOutput: {} }), { code: 'CLINICAL_AI_EDIT_DECISION_REQUIRED' });
});

test('clinical editor and task controls have explicit labels independent of initial text and options', () => {
  assert.match(source, /const fieldId = useId\(\)/);
  assert.match(source, /htmlFor=\{`\$\{fieldId\}-task-\$\{index\}-instructions`\}>Follow-up instructions<\/Label><Textarea id=\{`\$\{fieldId\}-task-\$\{index\}-instructions`\}/);
  assert.match(source, /htmlFor=\{`\$\{taskFieldId\}-\$\{index\}-role`\}>Responsible role<\/Label><select id=/);
  assert.doesNotMatch(source, /<Label>Follow-up instructions<Textarea|<Label>Responsible role<select/);
});


test('Groq adapter refuses real patient, production and non-opted-in requests before HTTP', async () => {
  const { requestGroqDraft } = require('../services/phc/clinicalAiGroqAdapter');
  const env = { NODE_ENV: 'test', GROQ_API_KEY: 'synthetic-only-key', CLINICAL_AI_ALLOW_DEMO_GROQ: 'true' };
  const args = { context: { demo_only: true }, model: 'openai/gpt-oss-120b', systemPrompt: 'Synthetic test', userPrompt: 'Synthetic record' };
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ model: args.model, choices: [{ message: { content: '{}' } }] }) }; };
  for (const [context, changedEnv] of [
    [{ demo_only: false }, env],
    [{ demo_only: 'true' }, env],
    [args.context, { ...env, NODE_ENV: 'production' }],
    [args.context, { ...env, NODE_ENV: 'staging' }],
    [args.context, { ...env, CLINICAL_AI_ALLOW_DEMO_GROQ: 'false' }],
  ]) {
    await assert.rejects(
      requestGroqDraft({ ...args, context }, { env: changedEnv, fetchImpl }),
      { code: 'CLINICAL_AI_GROQ_DEMO_ONLY' }
    );
  }
  assert.equal(calls, 0);
});

test('Groq synthetic adapter sends only to pinned endpoint and returns shaped output', async () => {
  const { requestGroqDraft } = require('../services/phc/clinicalAiGroqAdapter');
  const env = { NODE_ENV: 'test', GROQ_API_KEY: 'synthetic-only-key', CLINICAL_AI_ALLOW_DEMO_GROQ: 'true' };
  const args = { context: { demo_only: true }, model: 'openai/gpt-oss-120b', systemPrompt: 'Safe synthetic system prompt', userPrompt: 'Synthetic encounter record' };
  let captured;
  const result = await requestGroqDraft(args, {
    env,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ model: args.model, choices: [{ message: { content: '{"summary":""}' } }] }) };
    },
  });
  assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, 'Bearer synthetic-only-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, args.model);
  assert.deepEqual(body.messages.map(item => item.role), ['system', 'user']);
  assert.equal(result.provider, 'groq');
  assert.equal(result.text, '{"summary":""}');
});

test('Groq synthetic adapter never returns upstream failure bodies', async () => {
  const { requestGroqDraft } = require('../services/phc/clinicalAiGroqAdapter');
  const env = { NODE_ENV: 'test', GROQ_API_KEY: 'synthetic-only-key', CLINICAL_AI_ALLOW_DEMO_GROQ: 'true' };
  const args = { context: { demo_only: true }, model: 'openai/gpt-oss-120b', systemPrompt: 'test', userPrompt: 'test' };
  const cases = [
    async () => ({ ok: false, status: 429, json: async () => ({ private: 'sensitive text' }) }),
    async () => { throw new Error('sensitive text'); },
    async () => ({ ok: true, json: async () => ({ choices: [] }) }),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(requestGroqDraft(args, { env, fetchImpl }), error => (
      error.code === 'CLINICAL_AI_PROVIDER_ERROR'
      && !String(error.message).includes('sensitive text')
    ));
  }
});


test('central AI care stages cover the PHC care journey with source-linking and role restriction', () => {
  const { careStages, SUPPORTED_TYPES, systemPrompt } = require('../services/phc/clinicalAiService');
  for (const type of ['intake_review', 'triage_review', 'consultation_brief', 'soap_draft', 'emr_reconciliation', 'prescription_review', 'referral_brief', 'follow_up_draft']) {
    assert.equal(SUPPORTED_TYPES.has(type), true);
    assert.ok(careStages[type].roles.length > 0);
    assert.match(systemPrompt(type, ['encounter:chief_complaint']), /sourceRefs/);
  }
  assert.match(careStages.prescription_review.prompt, /Do not suggest or validate any medicine/);
  assert.match(careStages.triage_review.prompt, /Do not assign a triage level/);
});

test('Clinical Copilot read endpoints filter clinician-only stages from nurse worklists', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../services/phc/clinicalAiService.js'), 'utf8');
  assert.match(source, /result\.rows\.filter\(\(row\) => careStages\[row\.suggestion_type\]\?\.roles\.includes\(context\.programmeRole\)\)/);
  assert.match(source, /if \(!careStages\[row\.suggestion_type\]\?\.roles\.includes\(context\.programmeRole\)\)/);
  assert.match(source, /CLINICAL_AI_STAGE_ROLE_DENIED/);
});

test('manual prescription provenance is optional and cannot bypass clinical review or pharmacy signing', () => {
  const fs=require('node:fs'),path=require('node:path');
  const rx=fs.readFileSync(path.join(__dirname,'../services/rx-engine/prescriptionWorkflowService.js'),'utf8');
  const route=fs.readFileSync(path.join(__dirname,'../routes/prescriptions.js'),'utf8');
  const migration=fs.readFileSync(path.join(__dirname,'../migrations/035_ng_rx_ai_review_provenance.sql'),'utf8');
  assert.match(rx,/verifyClinicalAiRxProvenance\(client, input\)/);
  assert.match(rx,/assertAcceptedCareActionSource\(client, context/);
  assert.match(rx,/clinical_ai_source_suggestion_id/);
  assert.match(route,/aiSourceSuggestionId/);
  assert.match(route,/phcEncounterId/);
  assert.match(migration,/ng_rx_ai_provenance_pair/);
  assert.match(migration,/clinical_ai_source_encounter_id/);
  assert.doesNotMatch(rx.slice(rx.indexOf('async function verifyClinicalAiRxProvenance'), rx.indexOf('async function createDraft')), /\.sign\(|\.sendToPharmacy\(|\.dispenseItem\(/);
});

test('pharmacy medication checkout never treats an AI-reviewed Rx draft as signed or routed', () => {
 const fs=require('node:fs'),path=require('node:path');
 const delivery=fs.readFileSync(path.join(__dirname,'../services/logistics/medicationDeliveryWorkflowService.js'),'utf8');
 const rxRoutes=fs.readFileSync(path.join(__dirname,'../routes/prescriptions.js'),'utf8');
 const rxService=fs.readFileSync(path.join(__dirname,'../services/rx-engine/prescriptionWorkflowService.js'),'utf8');
 assert.match(delivery,/!rx\.signed_at/);
 assert.match(delivery,/rx\.routed_pharmacy_id !== p\.id/);
 assert.match(delivery,/prescription_claim_active=true/);
 assert.match(rxRoutes,/\/\:id\/sign/);
 assert.match(rxRoutes,/\/\:id\/send/);
 assert.match(rxService,/lifecycle_status\)\s*VALUES|lifecycle_status, clinical_ai_source_suggestion_id/);
 assert.match(rxService,/'drafted'/);
});

test('prescription mutations require clinical professional role; administration cannot sign or dispense', () => {
 const fs=require('node:fs'),path=require('node:path');
 const routes=fs.readFileSync(path.join(__dirname,'../routes/prescriptions.js'),'utf8');
 assert.match(routes,/if \(allowed\.has\(role\)\) return next\(\)/);
 assert.doesNotMatch(routes,/ADMIN\.has\(role\) \|\| allowed\.has\(role\)/);
 assert.match(routes,/router\.post\('\/:id\/sign', requireRole\(PRESCRIBER\)/);
 assert.match(routes,/router\.post\('\/:id\/receive', requireRole\(PHARMACIST\)/);
 assert.match(routes,/router\.post\('\/:id\/items\/:itemId\/dispense', requireRole\(PHARMACIST\)/);
});

test('pharmacy inbox and status endpoints reject unsigned and merely preferred prescriptions', () => {
 const fs=require('node:fs'),path=require('node:path');
 const route=fs.readFileSync(path.join(__dirname,'../routes/pharmacy.js'),'utf8');
 const inbox=route.slice(route.indexOf("router.get('/:pharmacyId/prescriptions'"),route.indexOf("router.get('/:pharmacyId/whatsapp-notifications'"));
 const mutate=route.slice(route.indexOf("router.patch('/:pharmacyId/prescriptions/:prescriptionId'"),route.indexOf("router.get('/:pharmacyId/medication-requests'"));
 assert.match(inbox,/WHERE rx\.routed_pharmacy_id = \$1/);
 assert.match(inbox,/rx\.signed_at IS NOT NULL/);
 assert.match(inbox,/rx\.lifecycle_status IN/);
 assert.doesNotMatch(inbox,/OR rx\.preferred_pharmacy_id = \$1/);
 assert.match(mutate,/req\.user\?\.role !== 'pharmacy'/);
 assert.match(mutate,/routed_pharmacy_id = \$7/);
 assert.match(mutate,/signed_at IS NOT NULL/);
 assert.match(mutate,/\$1 <> 'fulfilled' OR lifecycle_status IN/);
});
test('main Nigeria provider saves normalized unsigned Rx, no WhatsApp before signing', () => {
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../routes/provider.js'),'utf8');
 const start=src.indexOf("router.post('/prescriptions'");
 const end=src.indexOf('// --- PROVIDER PROFILE ---',start);
 const body=src.slice(start,end);
 assert.match(body,/INSERT INTO ng_rx_items/);
 assert.match(body,/lifecycle_status, clinical_ai_source_suggestion_id/);
 assert.match(body,/'drafted'/);
 assert.match(body,/routed_pharmacy_id, routed_at/);
 assert.doesNotMatch(body,/createPharmacyPrescriptionNotification/);
 assert.match(body,/whatsappNotification: null/);
});

test('pharmacy notifications and pharmacist Rx access are restricted to signed explicit routing', () => {
 const fs=require('node:fs'),path=require('node:path');
 const notifications=fs.readFileSync(path.join(__dirname,'../services/whatsapp/whatsappDispenseService.js'),'utf8');
 const routes=fs.readFileSync(path.join(__dirname,'../routes/prescriptions.js'),'utf8');
 const service=fs.readFileSync(path.join(__dirname,'../services/rx-engine/prescriptionWorkflowService.js'),'utf8');
 assert.match(notifications,/rx\.signed_at IS NOT NULL/);
 assert.match(notifications,/rx\.routed_pharmacy_id = \$2/);
 assert.match(routes,/rx\.routed_pharmacy_id === pharmacyId/);
 assert.doesNotMatch(routes,/\[rx\.preferred_pharmacy_id, rx\.routed_pharmacy_id/);
 const send=routes.slice(routes.indexOf("router.post('/:id/send'"),routes.indexOf("router.post('/:id/receive'"));
 assert.ok(send.indexOf('svc.sendToPharmacy') < send.indexOf('createPharmacyPrescriptionNotification'));
 assert.match(service,/pharmacy_response_status = 'pending_pharmacy_confirmation'/);
});

test('release kill switch prevents inference review and provenance-based care actions', () => {
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../services/phc/clinicalAiService.js'),'utf8');
 assert.match(src,/function assertClinicalAiOperational\(\)/);
 for(const name of ['reviewSuggestion','assertAcceptedCareActionSource','assertAcceptedFollowUpSource']){
   const start=src.indexOf('async function '+name+'(');
   assert.ok(start>0,name+' must exist');
   assert.ok(src.slice(start,start+700).includes('assertClinicalAiOperational()'),name+' must enforce kill switch');
 }
});
