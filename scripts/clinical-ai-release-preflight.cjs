#!/usr/bin/env node
'use strict';
// Static and environment-only, never calls inference or touches a patient DB.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
const findings = [];
const add = (ok, code) => { if (!ok) findings.push(code); };
const env = process.env;
const prod = env.NODE_ENV === 'production';
const enabled = env.CLINICAL_AI_KILL_SWITCH !== 'true';
const provider = env.CLINICAL_AI_PROVIDER || '';
const clinical = read('ng/services/phc/clinicalAiService.js');
const adapter = read('ng/services/phc/clinicalAiGroqAdapter.js');
const migrationRunner = read('ng/migrations/migrate.js');
add(clinical.includes('assertClinicalAiOperational()'), 'CLINICAL_KILL_SWITCH_MISSING');
add(adapter.includes("ALLOWED_NON_PRODUCTION_ENVS"), 'GROQ_DEMO_ENV_GUARD_MISSING');
add(migrationRunner.includes('pg_advisory_lock') && migrationRunner.includes('pool.connect()'), 'NG_MIGRATION_SERIALIZATION_MISSING');
add(!prod || !enabled, 'PRODUCTION_AI_KILL_SWITCH_NOT_ENABLED');
add(!prod || env.CLINICAL_AI_ALLOW_EXTERNAL_PHI !== 'true', 'EXTERNAL_PHI_APPROVAL_NOT_INDEPENDENTLY_VERIFIED');
add(!prod || env.CLINICAL_AI_ALLOW_DEMO_GROQ !== 'true', 'PRODUCTION_GROQ_DEMO_FLAG_ENABLED');
add(!prod || provider !== 'groq', 'GROQ_FREE_TIER_NOT_A_REAL_PATIENT_PROVIDER');
if (enabled && !prod) {
  add(env.CLINICAL_AI_PROVIDER === 'groq', 'NONPRODUCTION_PROVIDER_UNSUPPORTED');
  add(env.CLINICAL_AI_ALLOW_DEMO_GROQ === 'true', 'NONPRODUCTION_GROQ_OPT_IN_MISSING');
  add(Boolean(env.GROQ_API_KEY), 'NONPRODUCTION_GROQ_KEY_MISSING');
  add(Boolean(env.CLINICAL_AI_ENCRYPTION_KEY), 'PROTECTED_DRAFT_KEY_MISSING');
}
const result = { ready: findings.length === 0, environment: prod ? 'production' : 'nonproduction', aiState: enabled ? 'enabled' : 'disabled', checks: findings, secretsPrinted: false };
console.log(JSON.stringify(result));
if (findings.length) process.exitCode = 1;
