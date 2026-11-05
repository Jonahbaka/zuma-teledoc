'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const linuxDescriptorTraversal = process.platform === 'linux';
const secureTrialRead = Number.isInteger(fs.constants.O_NOFOLLOW) && Number.isInteger(fs.constants.O_NONBLOCK);
const linuxOnly = { skip: linuxDescriptorTraversal ? false : 'Requires Linux /proc/self/fd descriptor-relative traversal; unsupported platforms are separately tested to fail closed.' };

function symlinkOrSkip(t, target, link, type) {
  try { fs.symlinkSync(target, link, type); return true; }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('Windows does not grant symbolic-link creation to this test process; Linux symlink refusal remains mandatory.');
      return false;
    }
    throw error;
  }
}

// Exercise the exact private byte-parser functions on every OS. This isolated
// harness does not simulate secure filesystem traversal or claim it succeeded.
function audioParser() {
  const file = require.resolve('../../services/voice/voiceEvaluationFiles');
  const loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.testAudioDetails = audioDetails;', {
    module: loaded, exports: loaded.exports, require: createRequire(file), Buffer, process,
  }, { filename: file });
  return loaded.exports.testAudioDetails;
}

module.exports = { linuxDescriptorTraversal, secureTrialRead, linuxOnly, symlinkOrSkip, audioParser };
