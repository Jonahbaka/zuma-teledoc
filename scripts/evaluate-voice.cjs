#!/usr/bin/env node
'use strict';
// Entirely local evaluation tooling. It cannot start a provider, access a key,
// capture a microphone, upload a recording, or approve activation.
const fs = require('node:fs'), path = require('node:path');
const { SCENARIO_CATALOG, createEvaluationTemplate } = require('../lib/voice/evaluationScenarios.cjs');
const { createEvaluationTrial, analyzeEvaluationTrial } = require('../server/services/voice/voiceEvaluationEvidence');
const { inspectEvaluationRecordings } = require('../server/services/voice/voiceEvaluationFiles');
const { readEvaluationTrial } = require('../server/services/voice/voiceEvaluationRead');
const { runVoiceEvaluationSmoke } = require('./voice-evaluation-smoke.cjs');
const usage = 'Usage: node scripts/evaluate-voice.cjs catalog|checklist|smoke|template --scenario ID|analyze --trial FILE --corpus-root DIR [--out NEW_FILE]';
async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv, options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--scenario', '--trial', '--corpus-root', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i])) throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  const permitted = { catalog: ['--out'], checklist: ['--out'], smoke: ['--out'], template: ['--scenario', '--out'], analyze: ['--trial', '--corpus-root', '--out'] };
  if (!Object.hasOwn(permitted, command) || Object.keys(options).some(key => !permitted[command].includes(key))) throw new Error(usage);
  let result;
  if (command === 'catalog') result = SCENARIO_CATALOG;
  if (command === 'checklist') result = createEvaluationTemplate();
  if (command === 'template') result = createEvaluationTrial(options['--scenario']);
  if (command === 'smoke') result = await runVoiceEvaluationSmoke();
  if (command === 'analyze') {
    if (!options['--trial'] || !options['--corpus-root']) throw new Error(usage);
    const trial = JSON.parse(readEvaluationTrial(path.resolve(options['--trial'])));
    // Validate JSON shape and scope before touching any named audio file.
    analyzeEvaluationTrial(trial);
    const artifacts = inspectEvaluationRecordings(trial.recordings, { corpusRoot: path.resolve(options['--corpus-root']) });
    result = analyzeEvaluationTrial(trial, { artifacts });
  }
  const output = JSON.stringify(result, null, 2) + '\n';
  if (options['--out']) fs.writeFileSync(path.resolve(options['--out']), output, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(output);
  if (command === 'smoke' && result.structuralStatus !== 'passed') return 1;
  // Incomplete human/audio evidence is explicitly not a successful review.
  if (command === 'analyze' && result.completeness !== 'review_supplied') return 2;
  return 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(JSON.stringify({ error: typeof error?.code === 'string' && error.code.startsWith('VOICE_EVALUATION_') ? error.code : 'VOICE_EVALUATION_COMMAND_FAILED',
    ...(error.message === usage ? { usage } : {}), ...(error.field ? { field: error.field } : {}) }) + '\n'); process.exitCode = 1;
});
module.exports = { main };
