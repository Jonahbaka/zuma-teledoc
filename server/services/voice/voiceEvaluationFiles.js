'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { readEvaluationDescriptor } = require('./voiceEvaluationRead');
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const fail = code => Object.assign(new Error('Local evaluation recording could not be verified.'), { code });
function wavDetails(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw fail('VOICE_EVALUATION_AUDIO_INVALID');
  let cursor = 12, format, dataBytes = 0, dataChunks = 0;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.toString('ascii', cursor, cursor + 4), size = bytes.readUInt32LE(cursor + 4), start = cursor + 8;
    if (start + size > bytes.length) throw fail('VOICE_EVALUATION_AUDIO_INVALID');
    if (id === 'fmt ') {
      if (format || size < 16) throw fail('VOICE_EVALUATION_AUDIO_INVALID');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14) };
    }
    if (id === 'data') { dataBytes += size; dataChunks++; }
    cursor = start + size + (size % 2);
  }
  if (cursor !== bytes.length || !format || dataChunks !== 1 || dataBytes === 0 || format.encoding !== 1 || format.bitsPerSample !== 16
    || ![1, 2].includes(format.channels) || ![16000, 24000, 44100, 48000].includes(format.sampleRate)
    || format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRate * format.blockAlign
    || dataBytes % format.blockAlign || dataBytes / format.byteRate > 600) throw fail('VOICE_EVALUATION_AUDIO_INVALID');
  return { format: 'wav_pcm16', channels: format.channels, sampleRate: format.sampleRate, durationMs: Math.round(dataBytes * 1000 / format.byteRate), decodedAudioVerified: false };
}
function audioDetails(bytes, extension) {
  if (extension === '.wav') return wavDetails(bytes);
  if (extension === '.mp3' && bytes.length >= 16 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return { format: 'mp3_header_only', decodedAudioVerified: false };
  if (extension === '.webm' && bytes.length >= 16 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { format: 'webm_header_only', decodedAudioVerified: false };
  throw fail('VOICE_EVALUATION_AUDIO_INVALID');
}
function inspectEvaluationRecordings(recordings, { corpusRoot } = {}) {
  if (!Array.isArray(recordings) || recordings.length > 8 || !corpusRoot || !path.isAbsolute(corpusRoot)) throw fail('VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED');
  // Linux descriptor-relative traversal pins each directory and refuses every
  // symlink, including ancestors. Do not fall back to racy pathname traversal.
  if (process.platform !== 'linux') throw fail('VOICE_EVALUATION_SAFE_FILE_ACCESS_UNAVAILABLE');
  let rootDescriptor;
  try {
    const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    rootDescriptor = fs.openSync('/', flags);
    // Pin the corpus's ancestors too. A realpath/stat/open sequence would let
    // an ancestor replacement redirect both the stat and open to a new root.
    for (const part of path.resolve(corpusRoot).split('/').filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${rootDescriptor}/${part}`, flags);
      fs.closeSync(rootDescriptor); rootDescriptor = next;
    }
  } catch {
    if (rootDescriptor !== undefined) fs.closeSync(rootDescriptor);
    throw fail('VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED');
  }
  const seen = new Set();
  try { return recordings.map(recording => {
    if (!recording || typeof recording.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(recording.id) || seen.has(recording.id)
      || typeof recording.path !== 'string' || recording.path.length > 256 || recording.path.includes('\0') || recording.path.includes('\\')
      || path.isAbsolute(recording.path) || recording.path.split('/').some(part => !part || part === '.' || part === '..')
      || !['.wav', '.mp3', '.webm'].includes(path.extname(recording.path).toLowerCase()) || !/^[a-f0-9]{64}$/.test(recording.sha256 || '')) throw fail('VOICE_EVALUATION_RECORDING_PATH_INVALID');
    seen.add(recording.id); const descriptors = [];
    try {
      const parts = recording.path.split('/'); let parent = rootDescriptor;
      for (let i = 0; i < parts.length; i++) {
        const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
          | (i < parts.length - 1 ? fs.constants.O_DIRECTORY : 0);
        parent = fs.openSync(`/proc/self/fd/${parent}/${parts[i]}`, flags); descriptors.push(parent);
      }
      const bytes = readEvaluationDescriptor(parent, { minBytes: 16, maxBytes: MAX_AUDIO_BYTES, code: 'VOICE_EVALUATION_AUDIO_INVALID' });
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== recording.sha256) throw fail('VOICE_EVALUATION_AUDIO_HASH_MISMATCH');
      return { id: recording.id, sha256: digest, bytes: bytes.length, status: 'header_and_hash_checked', ...audioDetails(bytes, path.extname(recording.path).toLowerCase()), audioContentVerified: false };
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('VOICE_EVALUATION_')) throw error;
      if (['ELOOP', 'ENOTDIR'].includes(error?.code)) throw fail('VOICE_EVALUATION_RECORDING_PATH_INVALID');
      throw fail('VOICE_EVALUATION_RECORDING_UNAVAILABLE');
    } finally { for (const descriptor of descriptors.reverse()) fs.closeSync(descriptor); }
  }); } finally { fs.closeSync(rootDescriptor); }
}
module.exports = { MAX_AUDIO_BYTES, inspectEvaluationRecordings };
