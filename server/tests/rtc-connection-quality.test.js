'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { describeQuality, readQualitySnapshot, createRtcQualitySampler, worstConnectionQuality } = require('../../lib/rtcConnectionQuality.cjs');
const report = (...rows) => new Map(rows.map(row => [row.id, row]));
const inbound = (timestamp, packetsReceived, packetsLost, other = {}) => ({ id: 'incoming-audio', type: 'inbound-rtp', kind: 'audio', timestamp, packetsReceived, packetsLost, ...other });
const pair = (rtt = 0.1, other = {}) => ({ id: 'selected-pair', type: 'candidate-pair', state: 'succeeded', nominated: true, timestamp: 1000, currentRoundTripTime: rtt, ...other });
const remote = (loss = 0, rtt = 0.1, other = {}) => ({ id: 'remote-audio', type: 'remote-inbound-rtp', kind: 'audio', timestamp: 1000, fractionLost: loss, roundTripTime: rtt, ...other });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('missing, partial, failed and malformed measurements never become good quality', () => {
  for (const measurements of [{}, { rttMs: 0 }, { packetLossPct: 0 }, { rttMs: NaN, packetLossPct: 0 }, { rttMs: Infinity, packetLossPct: null }, { rttMs: -1, packetLossPct: -1 }, { rttMs: 0, packetLossPct: 101 }]) assert.equal(describeQuality(measurements).level, 'unknown');
  assert.equal(readQualitySnapshot(new Map()).quality.level, 'unknown');
  assert.equal(describeQuality({ rttMs: 0, packetLossPct: 0 }).level, 'good', 'measured zero must not be treated as missing');
});

test('threshold boundaries use either latency or loss and do not invent missing metrics', () => {
  for (const [rttMs, packetLossPct, level] of [[179, 1.9, 'good'], [180, 0, 'fair'], [419, 0, 'fair'], [420, 0, 'poor'], [10, 2, 'fair'], [10, 5, 'poor'], [null, 10, 'poor'], [700, null, 'poor']]) assert.equal(describeQuality({ rttMs, packetLossPct }).level, level);
  assert.match(describeQuality({ packetLossPct: 9 }).label, /9% loss/);
  assert.match(describeQuality({ packetLossPct: 9 }).guidance, /turning off your camera/);
  assert.equal(describeQuality({ packetLossPct: 9 }).rttMs, null);
});

test('audio-only and video RTCP feedback both count; fraction lost is normalized once', () => {
  for (const kind of ['audio', 'video']) {
    const { quality } = readQualitySnapshot(report(remote(0.08, 0.1, { kind })));
    assert.equal(quality.level, 'poor'); assert.equal(quality.packetLossPct, 8); assert.equal(quality.rttMs, 100);
  }
  assert.equal(readQualitySnapshot(report(remote(8, undefined))).quality.packetLossPct, null, 'invalid percentage must not be reinterpreted as a valid fraction');
});

test('current incoming interval detects new loss instead of hiding it in lifetime totals', () => {
  const first = readQualitySnapshot(report(inbound(1000, 100000, 0)));
  assert.equal(first.quality.packetLossPct, null);
  const second = readQualitySnapshot(report(inbound(2000, 100090, 10), pair(0.1, { timestamp: 2000 })), first.snapshot);
  assert.equal(second.quality.packetLossPct, 10); assert.equal(second.quality.level, 'poor');
  const recovered = readQualitySnapshot(report(inbound(3000, 100190, 10), pair(0.1, { timestamp: 3000 })), second.snapshot);
  assert.equal(recovered.quality.packetLossPct, 0); assert.equal(recovered.quality.level, 'good');
});

test('counter/source resets, identical timestamps and no new packets cannot fabricate a healthy interval', () => {
  const first = readQualitySnapshot(report(inbound(1000, 1000, 20)));
  for (const next of [inbound(2000, 10, 0), inbound(1000, 1100, 20), inbound(900, 1100, 20), inbound(2000, 1000, 20), inbound(2000, 1100, 20, { ssrc: 999 })]) {
    assert.equal(readQualitySnapshot(report(next, pair()), first.snapshot).quality.level, 'unknown');
  }
  const correction = readQualitySnapshot(report(inbound(2000, 1100, -2), pair()), first.snapshot);
  assert.equal(correction.quality.packetLossPct, 0, 'negative cumulative loss correction is not negative packet loss');
});

test('the selected transport pair wins over an unrelated nominated low-latency candidate', () => {
  const stats = report({ id: 'transport', type: 'transport', selectedCandidatePairId: 'actual' }, pair(0.01), pair(0.8, { id: 'actual', nominated: false }), remote(0, undefined, { roundTripTime: undefined }));
  const quality = readQualitySnapshot(stats).quality;
  assert.equal(quality.rttMs, 800); assert.equal(quality.level, 'poor');
  const brokenReference = readQualitySnapshot(report({ id: 'transport', type: 'transport', selectedCandidatePairId: 'missing' }, pair(), remote(0, undefined, { roundTripTime: undefined })));
  assert.equal(brokenReference.quality.rttMs, null); assert.equal(brokenReference.quality.level, 'unknown');
});

test('ambiguous candidate nominations and stale measurements cannot claim measured latency', () => {
  assert.equal(readQualitySnapshot(report(pair(0.1), pair(0.2, { id: 'second' }))).quality.rttMs, null);
  const stats = report(pair(), remote()); const first = readQualitySnapshot(stats);
  assert.equal(first.quality.level, 'good'); assert.equal(readQualitySnapshot(stats, first.snapshot).quality.level, 'unknown');
});

test('a bad stream or participant cannot be averaged away by healthy peers', () => {
  const quality = readQualitySnapshot(report(remote(0, 0.03), remote(0.1, 0.1, { id: 'video', kind: 'video' }))).quality;
  assert.equal(quality.level, 'poor');
  assert.equal(worstConnectionQuality([{ level: 'good' }, { level: 'poor' }, { level: 'good' }]), 'poor');
  assert.equal(worstConnectionQuality([{ level: 'good' }, { level: 'unknown' }]), 'unknown');
  assert.equal(worstConnectionQuality([{ level: 'good' }, { level: 'fair' }]), 'fair');
  assert.equal(worstConnectionQuality([{ level: 'good' }]), 'good'); assert.equal(worstConnectionQuality([]), null);
});

test('the sampler isolates peers, forgets failed reads and detects real connection failure', async () => {
  const sample = createRtcQualitySampler(); let next = report(inbound(1000, 100, 0), pair());
  const pc = { connectionState: 'connected', getStats: async () => next };
  assert.equal((await sample(pc)).level, 'unknown');
  next = report(inbound(2000, 200, 0), pair(0.1, { timestamp: 2000 })); assert.equal((await sample(pc)).level, 'good');
  assert.equal((await sample({ ...pc })).level, 'unknown', 'new peer starts with its own baseline');
  pc.getStats = async () => { throw new Error('synthetic stats failure'); }; assert.equal((await sample(pc)).level, 'unknown');
  pc.getStats = async () => report(inbound(3000, 300, 0), pair(0.1, { timestamp: 3000 })); assert.equal((await sample(pc)).level, 'unknown');
  pc.connectionState = 'failed'; assert.equal((await sample(pc)).level, 'poor');
  pc.connectionState = 'closed'; assert.equal((await sample(pc)).level, 'unknown');
});

test('hung statistics time out and late reports do not update a future interval', async () => {
  const sample = createRtcQualitySampler({ timeoutMs: 5 }); const pending = deferred();
  const pc = { connectionState: 'connected', getStats: () => pending.promise };
  assert.equal((await sample(pc)).level, 'unknown');
  pending.resolve(report(inbound(1000, 100, 0))); await flush();
  pc.getStats = async () => report(inbound(2000, 200, 0), pair());
  assert.equal((await sample(pc)).level, 'unknown');
});

test('snapshot storage contains only measurement counters, not network addresses or participant metadata', () => {
  const { snapshot } = readQualitySnapshot(report(inbound(1000, 10, 0, { patientName: 'forbidden' }), pair(0.1, { address: 'private address', remoteCandidateId: 'candidate-id' })));
  const stored = JSON.stringify([...snapshot.values()]);
  for (const secret of ['forbidden', 'private address', 'candidate-id']) assert.equal(stored.includes(secret), false);
});

function conferencePolling(peers) {
  const source = fs.readFileSync(require.resolve('../../components/ng/conference/useConferenceSignaling.js'), 'utf8');
  const start = source.indexOf('  // ── Connection quality polling'), end = source.indexOf('  // ── Public actions', start);
  const updates = [], timers = new Map(), mediaEpoch = { current: 1 }, pcByPeer = { current: new Map(peers) };
  let cleanup, id = 0;
  const bindings = { enabled: true, isAuthenticated: true, roomId: 'synthetic-room', currentUserId: 'synthetic-account', reconnectKey: 0, mediaEpoch, pcByPeer, createRtcQualitySampler, worstConnectionQuality, setConnectionQuality: value => updates.push(value), setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: id => timers.delete(id) };
  new Function('useEffect', ...Object.keys(bindings), source.slice(start, end))(callback => { cleanup = callback(); }, ...Object.values(bindings));
  return { updates, timers, mediaEpoch, pcByPeer, cleanup: () => cleanup() };
}

test('conference polling serializes pending reads and discards departed-peer responses', async () => {
  const pending = deferred(); const pc = { connectionState: 'connected', getStats: () => pending.promise };
  const h = conferencePolling([['peer-a', pc]]);
  assert.equal(h.timers.size, 0, 'next poll waits for settlement'); h.pcByPeer.current.clear();
  pending.resolve(report(remote())); await flush(); assert.deepEqual(h.updates, []); assert.equal(h.timers.size, 1);
  h.cleanup(); assert.equal(h.timers.size, 0); assert.deepEqual(h.updates, [null]);
});

test('conference teardown discards a late healthy result and cannot restart its timer', async () => {
  const pending = deferred(); const h = conferencePolling([['peer-a', { connectionState: 'connected', getStats: () => pending.promise }]]);
  h.cleanup(); pending.resolve(report(remote())); await flush();
  assert.deepEqual(h.updates, [null]); assert.equal(h.timers.size, 0);
});

test('conference polling includes a failed participant rather than judging only healthy connections', async () => {
  const h = conferencePolling([['good', { connectionState: 'connected', getStats: async () => report(remote()) }], ['failed', { connectionState: 'failed', getStats() { assert.fail('failed peer should not be sampled'); } }]]);
  await flush(); assert.deepEqual(h.updates, ['poor']); h.cleanup();
});

test('a measured healthy stream cannot fill in missing evidence for another observed media stream', () => {
  const quality = readQualitySnapshot(report(remote(), inbound(1000, 100, 0))).quality;
  assert.equal(quality.level, 'unknown'); assert.match(quality.label, /Partial measurement/);
});

test('a regressed report cannot lower the timestamp baseline and make cached data look fresh later', () => {
  const first = readQualitySnapshot(report(remote(), pair()));
  const regressed = readQualitySnapshot(report(remote(0, 0.1, { timestamp: 900 }), pair(0.1, { timestamp: 900 })), first.snapshot);
  assert.equal(regressed.quality.level, 'unknown');
  const cached = readQualitySnapshot(report(remote(), pair()), regressed.snapshot);
  assert.equal(cached.quality.level, 'unknown');
});

for (const portal of ['patient', 'provider']) test(`${portal} quality badge renders honest measurements and accessible recovery guidance`, () => {
  const vm = require('node:vm');
  const { transformSync } = require('next/dist/build/swc');
  const source = fs.readFileSync(require.resolve(`../../app/(dashboard)/${portal}/appointments/[id]/call/page.js`), 'utf8');
  const start = source.indexOf('const QualityBadge ='), end = source.indexOf('\nconst ', start + 1);
  const code = transformSync(source.slice(start, end) + '\nmodule.exports = QualityBadge;', { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({ jsx, jsxs: jsx }) });
  const unknown = mod.exports({ quality: describeQuality({}) });
  assert.equal(unknown.props.role, 'status'); assert.equal(unknown.props['aria-live'], 'polite');
  assert.ok(JSON.stringify(unknown).includes('Not measured')); assert.equal(JSON.stringify(unknown).includes('Quality: Good'), false);
  const poor = mod.exports({ quality: describeQuality({ packetLossPct: 20 }) });
  assert.ok(JSON.stringify(poor).includes('turning off your camera')); assert.ok(JSON.stringify(poor).includes('20% loss'));
});
