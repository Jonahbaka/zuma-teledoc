'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inspectEvaluationRecordings, MAX_AUDIO_BYTES } = require('../../services/voice/voiceEvaluationFiles');
const { readEvaluationTrial } = require('../../services/voice/voiceEvaluationRead');

// Generated silence establishes file parsing only, never a spoken evaluation.
function wav() {
  const bytes = Buffer.alloc(44 + 320);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(320, 40);
  return bytes;
}
function corpus(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-evaluation-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name = 'fictional.wav', bytes = wav()) => {
    fs.writeFileSync(path.join(root, name), bytes);
    return { id: 'fictional-recording', role: 'duplex', path: name, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const inspect = recordings => inspectEvaluationRecordings(recordings, { corpusRoot: root });
  return { root, write, inspect };
}
test('local PCM WAV checking returns metadata and hashes but no content, transcript or acoustic validation', t => {
  const f = corpus(t), recording = f.write(), [result] = f.inspect([recording]);
  assert.deepEqual(result, { id: recording.id, sha256: recording.sha256, bytes: 364, status: 'header_and_hash_checked',
    format: 'wav_pcm16', channels: 1, sampleRate: 16000, durationMs: 10, decodedAudioVerified: false, audioContentVerified: false });
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal(fs.readFileSync(path.join(f.root, recording.path)).equals(wav()), true);
});
test('changed recording bytes cannot reuse the supplied artifact digest', t => {
  const f = corpus(t), recording = f.write();
  const changed = wav(); changed[44] = 1; fs.writeFileSync(path.join(f.root, recording.path), changed);
  assert.throws(() => f.inspect([recording]), { code: 'VOICE_EVALUATION_AUDIO_HASH_MISMATCH' });
});
test('recording input is bounded, relative, unique and constrained to the explicit corpus', t => {
  const f = corpus(t), recording = f.write();
  for (const file of ['../fictional.wav', '/tmp/fictional.wav', 'sub/../fictional.wav', './fictional.wav', 'sub//fictional.wav',
    'fictional.wav\0', 'sub\\fictional.wav', 'fictional.txt', 'a'.repeat(257) + '.wav']) {
    assert.throws(() => f.inspect([{ ...recording, path: file }]), { code: 'VOICE_EVALUATION_RECORDING_PATH_INVALID' });
  }
  assert.throws(() => f.inspect([recording, recording]), { code: 'VOICE_EVALUATION_RECORDING_PATH_INVALID' });
  assert.throws(() => f.inspect([{ ...recording, sha256: '' }]), { code: 'VOICE_EVALUATION_RECORDING_PATH_INVALID' });
  assert.throws(() => f.inspect(Array(9).fill(recording)), { code: 'VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED' });
  assert.throws(() => inspectEvaluationRecordings([], { corpusRoot: 'relative' }), { code: 'VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED' });
  assert.throws(() => inspectEvaluationRecordings([], { corpusRoot: path.join(f.root, recording.path) }), { code: 'VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED' });
});
test('symlinks escaping the corpus and non-files are refused without disclosing paths', t => {
  const f = corpus(t), outside = corpus(t), recording = outside.write();
  fs.symlinkSync(path.join(outside.root, recording.path), path.join(f.root, 'outside.wav'));
  fs.symlinkSync(outside.root, path.join(f.root, 'outside-dir'));
  fs.mkdirSync(path.join(f.root, 'directory.wav'));
  for (const file of ['outside.wav', 'outside-dir/fictional.wav']) {
    assert.throws(() => f.inspect([{ ...recording, path: file }]), { code: 'VOICE_EVALUATION_RECORDING_PATH_INVALID' });
  }
  assert.throws(() => f.inspect([{ ...recording, path: 'directory.wav' }]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' });
  assert.throws(() => f.inspect([{ ...recording, path: 'missing.wav' }]), error => {
    assert.equal(error.code, 'VOICE_EVALUATION_RECORDING_UNAVAILABLE'); assert.equal(error.message.includes(f.root), false); return true;
  });
});
test('oversized local audio is rejected before loading its bytes', t => {
  const f = corpus(t), recording = f.write();
  fs.truncateSync(path.join(f.root, recording.path), MAX_AUDIO_BYTES + 1);
  assert.throws(() => f.inspect([recording]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' });
});
test('replacing an ancestor with an outside symlink before opening is rejected', t => {
  const f = corpus(t), outside = corpus(t), recording = outside.write();
  fs.mkdirSync(path.join(f.root, 'nested')); fs.writeFileSync(path.join(f.root, 'nested/fictional.wav'), wav());
  const original = fs.openSync; let replaced = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (!replaced && file.startsWith('/proc/self/fd/') && file.endsWith('/nested')) {
      replaced = true; fs.renameSync(path.join(f.root, 'nested'), path.join(f.root, 'original'));
      fs.symlinkSync(outside.root, path.join(f.root, 'nested'));
    }
    return original(file, ...args);
  });
  assert.throws(() => f.inspect([{ ...recording, path: 'nested/fictional.wav' }]), { code: 'VOICE_EVALUATION_RECORDING_PATH_INVALID' });
  assert.equal(replaced, true);
});
test('corpus root acquisition also refuses replacement of its own ancestors', t => {
  const f = corpus(t), outside = corpus(t);
  fs.mkdirSync(path.join(f.root, 'base/corpus'), { recursive: true }); fs.mkdirSync(path.join(outside.root, 'corpus'));
  fs.writeFileSync(path.join(outside.root, 'corpus/fictional.wav'), wav());
  const original = fs.openSync; let replaced = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (!replaced && file.startsWith('/proc/self/fd/') && file.endsWith('/base')) {
      replaced = true; fs.renameSync(path.join(f.root, 'base'), path.join(f.root, 'original'));
      fs.symlinkSync(outside.root, path.join(f.root, 'base'));
    }
    return original(file, ...args);
  });
  assert.throws(() => inspectEvaluationRecordings([{ id: 'outside', role: 'duplex', path: 'fictional.wav', sha256: createHash('sha256').update(wav()).digest('hex') }],
    { corpusRoot: path.join(f.root, 'base/corpus') }), { code: 'VOICE_EVALUATION_RECORDING_SCOPE_REQUIRED' });
  assert.equal(replaced, true);
});
test('directory identity stays pinned if its pathname is replaced after opening', t => {
  const f = corpus(t), outside = corpus(t), different = wav(); different[44] = 3; outside.write('fictional.wav', different);
  fs.mkdirSync(path.join(f.root, 'nested')); fs.writeFileSync(path.join(f.root, 'nested/fictional.wav'), wav());
  const recording = { id: 'fictional-recording', role: 'duplex', path: 'nested/fictional.wav', sha256: createHash('sha256').update(wav()).digest('hex') };
  const original = fs.openSync; let replaced = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const descriptor = original(file, ...args);
    if (!replaced && file.startsWith('/proc/self/fd/') && file.endsWith('/nested')) {
      replaced = true; fs.renameSync(path.join(f.root, 'nested'), path.join(f.root, 'original'));
      fs.symlinkSync(outside.root, path.join(f.root, 'nested'));
    }
    return descriptor;
  });
  assert.equal(f.inspect([recording])[0].sha256, recording.sha256); assert.equal(replaced, true);
});
test('a file growing during a bounded descriptor read is rejected', t => {
  const f = corpus(t), recording = f.write(), original = fs.readSync; let grew = false;
  t.mock.method(fs, 'readSync', (...args) => {
    const result = original(...args);
    if (!grew) { grew = true; fs.appendFileSync(path.join(f.root, recording.path), Buffer.alloc(1)); }
    return result;
  });
  assert.throws(() => f.inspect([recording]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' }); assert.equal(grew, true);
});
test('FIFO inputs cannot block trial or recording reads', t => {
  const f = corpus(t), file = path.join(f.root, 'fifo.wav');
  const created = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 1000 }); assert.equal(created.status, 0, created.stderr);
  assert.throws(() => readEvaluationTrial(file), { code: 'VOICE_EVALUATION_INPUT_INVALID' });
  assert.throws(() => f.inspect([{ id: 'fifo', role: 'duplex', path: 'fifo.wav', sha256: 'a'.repeat(64) }]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' });
});
test('malformed PCM headers, sizes and formats cannot receive a checked WAV result', t => {
  const f = corpus(t);
  for (const mutate of [b => b.write('NOPE'), b => b.writeUInt32LE(0, 4), b => b.writeUInt16LE(3, 20),
    b => b.writeUInt16LE(3, 22), b => b.writeUInt32LE(12345, 24), b => b.writeUInt32LE(1, 28),
    b => b.writeUInt16LE(1, 32), b => b.writeUInt16LE(8, 34), b => b.writeUInt32LE(99999, 40), b => b.write('JUNK', 36)]) {
    const bytes = wav(); mutate(bytes); const recording = f.write('bad.wav', bytes);
    assert.throws(() => f.inspect([recording]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' });
  }
});
test('MP3 and WebM signatures are identified only as header checks, never decoded audio', t => {
  const f = corpus(t);
  for (const [extension, header, format] of [['mp3', Buffer.from('ID3'), 'mp3_header_only'],
    ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'webm_header_only']]) {
    const bytes = Buffer.alloc(16); header.copy(bytes); const recording = f.write('fictional.' + extension, bytes);
    const [result] = f.inspect([recording]); assert.equal(result.format, format);
    assert.equal(result.decodedAudioVerified, false); assert.equal(result.audioContentVerified, false);
    bytes[0] = 0; const invalid = f.write('bad.' + extension, bytes);
    assert.throws(() => f.inspect([invalid]), { code: 'VOICE_EVALUATION_AUDIO_INVALID' });
  }
});
