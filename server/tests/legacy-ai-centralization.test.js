'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('legacy SOAP and diagnosis paths use canonical linked review, not heuristic prescribing', () => {
 const src=fs.readFileSync(path.join(__dirname,'../routes/aiAssist.js'),'utf8');
 assert.match(src,/linkedPhcAi\.createLinkedDraft/);
 assert.match(src,/linkedPhcAi\.reviewLinkedDraft/);
 assert.doesNotMatch(src,/function generateSOAPSuggestion|function generateDiagnosticSuggestions/);
 assert.match(src,/suggestedDiagnoses: \[\]/);
});
test('legacy triage metadata cannot persist browser supplied priority or drugs',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../services/triageService.js'),'utf8');
 assert.match(src,/const medsJson = JSON\.stringify\(\[\]\)/);
 assert.match(src,/const flagsJson = JSON\.stringify\(\[\]\)/);
 assert.match(src,/'UNASSESSED'/);
 assert.doesNotMatch(src,/triageResult\.severity \|\| 0/);
});

test('legacy caption translation requires separate server approval for clinical text', () => {
 const src=fs.readFileSync(path.join(__dirname,'../routes/aiAssist.js'),'utf8');
 assert.match(src,/CLINICAL_AI_ALLOW_EXTERNAL_TRANSLATION/);
 assert.match(src,/CLINICAL_AI_TRANSLATION_PROVIDER_APPROVED/);
 assert.match(src,/CLINICAL_AI_ALLOW_EXTERNAL_PHI/);
 const gate=src.indexOf("process.env.CLINICAL_AI_ALLOW_EXTERNAL_TRANSLATION");
 const call=src.indexOf("llm.callLLM(");
 assert.ok(gate > -1 && call > gate, 'approval must precede external model call');
 assert.match(src,/manualInterpreterRequired: true/);
});
