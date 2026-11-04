'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const service = require('../services/clinicalEncounterService');
const ai = require('../../ng/services/phc/clinicalAiService');
const workflow = require('../../ng/services/phc/phcWorkflowService');
const scope = require('../../ng/services/phc/programmeScopeService');
const ids = Array.from({length:5}, () => crypto.randomUUID());
const [canonicalId, providerId, suggestionId, encounterId, patientId] = ids;

test('reviewed import checks exact canonical linkage, current programme/assignment and prefers clinician edits', async () => {
  const original = { scope: scope.assertProgrammeScope, encounter: workflow.getEncounter, observations: workflow.listObservations, decrypt: ai.decryptJson, freshness: ai.assertReviewFreshness };
  let reviewedSource;
  let seenScope;
  const queries = [];
  let permitted = true;
  let structured = true;
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('JOIN ng_clinical_ai_reviews')) return { rows: permitted ? [{ id: suggestionId, programme_id:'programme', facility_id:'facility', encounter_id:encounterId, patient_user_id:patientId, decision:'accepted_with_edits', edited_output_encrypted:'clinician-edit', output_encrypted:'original' }] : [] };
    if (sql.includes('SELECT assigned_provider_user_id')) return { rows:[{assigned_provider_user_id:providerId}] };
    return { rows:[] };
  } };
  scope.assertProgrammeScope = async (_pool, actor, options) => { seenScope=options; return { programmeRole:'remote_clinician', userId:actor.id }; };
  workflow.getEncounter = async () => ({id:encounterId,patient_user_id:patientId});
  workflow.listObservations = async () => ({observations:[]});
  ai.assertReviewFreshness = () => {};
  ai.decryptJson = ({encrypted}) => { reviewedSource=encrypted; return structured ? {soapDraft:{subjective:'Reviewed source',objective:'',assessment:'',plan:''}} : {summary:'Not SOAP'}; };
  try {
    const result = await service._reviewedAiDraft(client,canonicalId,providerId,suggestionId);
    assert.equal(reviewedSource,'clinician-edit');
    assert.equal(result.aiSuggestionId,suggestionId);
    assert.deepEqual(seenScope.allowedRoles,['remote_clinician']);
    assert.equal(seenScope.patientUserId,patientId);
    assert.match(queries[0],/l.source_table='ng_clinical_encounters'/);
    assert.match(queries[0],/ce.patient_id=s.patient_user_id/);
    assert.match(queries[0],/ce.id=\$2 AND ce.provider_id=\$3/);
    structured=false;
    await assert.rejects(service._reviewedAiDraft(client,canonicalId,providerId,suggestionId),{code:'CLINICAL_AI_SOAP_REQUIRED'});
    permitted=false;
    await assert.rejects(service._reviewedAiDraft(client,canonicalId,providerId,suggestionId),{code:'CLINICAL_AI_IMPORT_DENIED'});
  } finally { scope.assertProgrammeScope=original.scope; workflow.getEncounter=original.encounter; workflow.listObservations=original.observations; ai.decryptJson=original.decrypt; ai.assertReviewFreshness=original.freshness; }
});

test('AI import never updates an existing note or accepts malformed references', async () => {
  await assert.rejects(service.updateNote(ids[0],providerId,{aiSuggestionId:suggestionId}),{code:'CLINICAL_AI_NEW_NOTE_REQUIRED'});
  await assert.rejects(service.getReviewedAiDraft('wrong',providerId,suggestionId),{code:'CLINICAL_REFERENCE_INVALID'});
});
const source=fs.readFileSync(path.join(__dirname,'../../app/(dashboard)/provider/encounters/[id]/page.js'),'utf8');
function view() {
  let result; let resolve; let imported; const messages=[];
  const context={ operation:{current:null},mounted:{current:true},editorRef:{current:{}},installEditor(){},soapFields: note => note, changeDraft(value){result=value;}, currentNoteDraft:{current:{subjective:'',objective:'',assessment:'',plan:'',physicalExam:''}},currentEncounter:{current:canonicalId},currentAiSuggestion:{current:suggestionId},encounterId:canonicalId,aiSuggestionId:suggestionId,importVersion:{current:0},setImportingDraft(){},setNoteDraft(value){result=value;},setImportedAiSuggestionId(value){imported=value;},toast(value){messages.push(value);},clinicalEhrAPI:{getReviewedAiDraft:()=>new Promise(done=>{resolve=done;})} };
  vm.runInNewContext(source.slice(source.indexOf('  const importReviewedDraft ='),source.indexOf('  const createOrUpdateNote =')).replace('const importReviewedDraft =','globalThis.importReviewedDraft ='),context);
  return {context,request:context.importReviewedDraft,resolve:()=>resolve({data:{success:true,aiSuggestionId:suggestionId,noteDraft:{subjective:'Reviewed'}}}),result:()=>result,imported:()=>imported,messages};
}
test('explicit UI import preserves edits made before or during loading and ignores changed encounter', async () => {
  let v=view(); v.context.currentNoteDraft.current.subjective='Unsaved work'; await v.request(); assert.equal(v.result(),undefined);
  v=view(); let request=v.request(); v.context.currentNoteDraft.current.plan='New manual edit'; v.resolve(); await request; assert.equal(v.result(),undefined);
  v=view(); request=v.request(); v.context.currentEncounter.current='another'; v.resolve(); await request; assert.equal(v.result(),undefined);
  v=view(); request=v.request(); v.context.currentAiSuggestion.current='new-source'; v.resolve(); await request; assert.equal(v.result(),undefined);
  v=view(); request=v.request(); v.resolve(); await request; assert.equal(v.result().subjective,'Reviewed'); assert.equal(v.imported(),suggestionId);
});
test('import remains separate from save/sign; imported source creates a new note', () => {
  const importHandler=source.slice(source.indexOf('  const importReviewedDraft ='),source.indexOf('  const createOrUpdateNote ='));
  assert.doesNotMatch(importHandler,/\.createNote\(|\.updateNote\(|\.signNote\(/);
  assert.match(importHandler,/installEditor\(\{ encounterId: requestedEncounter, note: null/);
  assert.match(source,/aiSuggestionId: importedAiSuggestionId/);
  const backend=fs.readFileSync(path.join(__dirname,'../services/clinicalEncounterService.js'),'utf8');
  assert.match(backend,/new_values->>'aiSuggestionId'=\$1/);
  assert.match(backend,/CLINICAL_AI_ALREADY_IMPORTED/);
  assert.match(backend,/await this\._reviewedAiDraft\(client, encounterId, providerId, noteData.aiSuggestionId\)/);
});

test('same reviewed source replay returns existing note; conflicting replay cannot create or overwrite', async () => {
  const db = require('../db');
  const originals={pool:db.getPool,source:service._reviewedAiDraft,encounter:service._lockEncounter};
  const noteData={noteType:'soap',subjective:'Reviewed text',aiSuggestionId:suggestionId};
  const importHash=crypto.createHash('sha256').update(JSON.stringify(Object.keys(noteData).sort().map(key=>[key,noteData[key]]))).digest('hex');
  let writes=0; let validated=0; let commits=0;
  const existing={id:crypto.randomUUID(),encounter_id:canonicalId,provider_id:providerId,patient_id:patientId,import_metadata:{importHash}};
  const client={release(){},async query(sql){
    if(sql.includes('FROM audit_logs a')) return {rows:[existing]};
    if(sql==='COMMIT') commits++;
    if(/INSERT INTO clinical_notes|UPDATE clinical_notes/.test(sql)) writes++;
    return {rows:[]};
  }};
  db.getPool=()=>({connect:async()=>client});
  service._reviewedAiDraft=async()=>{validated++;};
  service._lockEncounter=async()=>({id:canonicalId,patient_id:patientId});
  try {
    const replay=await service.createNote(canonicalId,providerId,noteData);
    assert.equal(replay.id,existing.id); assert.equal(commits,1); assert.equal(validated,1); assert.equal(writes,0);
    await assert.rejects(service.createNote(canonicalId,providerId,{...noteData,subjective:'Different text'}),{code:'CLINICAL_AI_ALREADY_IMPORTED'});
    assert.equal(writes,0); assert.equal(commits,1);
  } finally {db.getPool=originals.pool;service._reviewedAiDraft=originals.source;service._lockEncounter=originals.encounter;}
});

 test('delayed save completion cannot clear provenance on another encounter', () => {
  const save = source.slice(source.indexOf('  const createOrUpdateNote ='), source.indexOf('  const signNote ='));
  assert.match(save, /const currentSave = \(\) => mounted.current && currentEncounter.current === requestedEncounter && operation.current === request/);
  assert.match(save, /if \(!currentSave\(\)\) return;[\s\S]*?setImportedAiSuggestionId\(null\)/);
});


test('chart identity uses the canonical nested patient and provider response fields', () => {
  const encounter = service._formatEncounter({ id: ids[0], patient_id: ids[1], provider_id: ids[2], patient_first_name: 'Synthetic', patient_last_name: 'Patient', provider_first_name: 'Synthetic', provider_last_name: 'Clinician' });
  assert.deepEqual(encounter.patient, { firstName: 'Synthetic', lastName: 'Patient', dateOfBirth: undefined });
  assert.equal(encounter.provider.firstName, 'Synthetic');
  assert.equal(encounter.provider.lastName, 'Clinician');
  const page = fs.readFileSync(path.join(__dirname, '../../app/(dashboard)/provider/encounters/[id]/page.js'), 'utf8');
  assert.match(page, /encounter\?\.patient\?\.firstName/);
  assert.match(page, /encounter\?\.provider\?\.firstName/);
  assert.doesNotMatch(page, /encounter\?\.patientFirstName|encounter\?\.providerFirstName/);
  assert.match(page, /Name unavailable/);
});
