'use strict';
const fs = require('node:fs');
const invalid = code => Object.assign(new Error('Local evaluation file could not be read safely.'), { code });

// Validate and read the same opened object; do not trust a pathname stat.
// O_NONBLOCK prevents a replacement FIFO from blocking before fstat rejects it.
function readEvaluationDescriptor(descriptor, { minBytes = 0, maxBytes, code }) {
  const stat = fs.fstatSync(descriptor);
  if (!stat.isFile() || stat.size < minBytes || stat.size > maxBytes) throw invalid(code);
  const bytes = Buffer.allocUnsafe(stat.size); let offset = 0;
  while (offset < bytes.length) {
    const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (!read) throw invalid(code); offset += read;
  }
  const final = fs.fstatSync(descriptor);
  if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) !== 0 || final.size !== stat.size
    || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) throw invalid(code);
  return bytes;
}
function readEvaluationTrial(file) {
  let descriptor;
  try {
    if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_NONBLOCK)) throw invalid('VOICE_EVALUATION_INPUT_INVALID');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    return readEvaluationDescriptor(descriptor, { maxBytes: 262144, code: 'VOICE_EVALUATION_INPUT_INVALID' }).toString('utf8');
  } catch { throw invalid('VOICE_EVALUATION_INPUT_INVALID'); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
module.exports = { readEvaluationDescriptor, readEvaluationTrial };
