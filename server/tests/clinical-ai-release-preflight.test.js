'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const script=path.join(root,'scripts/clinical-ai-release-preflight.cjs');
function run(env){return cp.spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',env:{...process.env,CLINICAL_AI_PROVIDER:'',CLINICAL_AI_KILL_SWITCH:'true',CLINICAL_AI_ALLOW_EXTERNAL_PHI:'false',CLINICAL_AI_ALLOW_DEMO_GROQ:'false',...env}});}
test('production release preflight passes only while AI externally disabled',()=>{
 const r=run({NODE_ENV:'production'});
 assert.equal(r.status,0,r.stdout+' '+r.stderr);
 assert.equal(JSON.parse(r.stdout).aiState,'disabled');
});
test('production AI activation is blocked without independent approvals',()=>{
 const r=run({NODE_ENV:'production',CLINICAL_AI_KILL_SWITCH:'false',CLINICAL_AI_PROVIDER:'groq',CLINICAL_AI_ALLOW_EXTERNAL_PHI:'true'});
 assert.equal(r.status,1);
 const out=JSON.parse(r.stdout);
 assert.ok(out.checks.includes('PRODUCTION_AI_KILL_SWITCH_NOT_ENABLED'));
 assert.ok(out.checks.includes('GROQ_FREE_TIER_NOT_A_REAL_PATIENT_PROVIDER'));
 assert.ok(out.checks.includes('EXTERNAL_PHI_APPROVAL_NOT_INDEPENDENTLY_VERIFIED'));
 assert.equal(r.stdout.includes(process.env.GROQ_API_KEY || 'never-disclose-secret'),false);
});
test('synthetic enabled mode fails closed without credentials',()=>{
 const r=run({NODE_ENV:'test',CLINICAL_AI_KILL_SWITCH:'false',CLINICAL_AI_PROVIDER:'groq',CLINICAL_AI_ALLOW_DEMO_GROQ:'true',GROQ_API_KEY:'',CLINICAL_AI_ENCRYPTION_KEY:''});
 assert.equal(r.status,1);const out=JSON.parse(r.stdout);
 assert.ok(out.checks.includes('NONPRODUCTION_GROQ_KEY_MISSING'));
 assert.ok(out.checks.includes('PROTECTED_DRAFT_KEY_MISSING'));
});
