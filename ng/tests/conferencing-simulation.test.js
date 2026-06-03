const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SCENARIOS,
  readiness,
  runConferenceSimulation,
} = require('../scripts/simulate-conference-workflows');

test('conference harness exposes the required 27 scenarios', () => {
  assert.equal(SCENARIOS.length, 27);
  assert.ok(SCENARIOS.some(([name]) => name === '2-person room join'));
  assert.ok(SCENARIOS.some(([name]) => name === '3-way consultation join'));
  assert.ok(SCENARIOS.some(([name]) => name === '5-person clinical review join'));
  assert.ok(SCENARIOS.some(([name]) => name === '10-person hospital board join'));
  assert.ok(SCENARIOS.some(([name]) => name === 'TURN relay configuration'));
  assert.ok(SCENARIOS.some(([name]) => name === 'SFU configuration'));
  assert.ok(SCENARIOS.some(([name]) => name === 'Real browser WebRTC media exchange'));
});

test('conference simulation passes simulated signaling and skips unprovided real-media evidence', async () => {
  const evidence = await runConferenceSimulation({ env: {} });
  assert.equal(evidence.finalResult, 'pass');
  assert.equal(evidence.scenarioCount, 27);

  const simulated = evidence.results.filter((item) => item.evidenceType === 'simulated');
  assert.ok(simulated.length >= 20);
  assert.ok(simulated.every((item) => item.status === 'passed'));

  const turn = evidence.results.find((item) => item.name === 'TURN relay configuration');
  const sfu = evidence.results.find((item) => item.name === 'SFU configuration');
  const media = evidence.results.find((item) => item.name === 'Real browser WebRTC media exchange');
  assert.equal(turn.status, 'skipped');
  assert.equal(turn.evidenceType, 'readiness-check-only');
  assert.equal(sfu.status, 'skipped');
  assert.equal(media.status, 'skipped');
  assert.equal(media.evidenceType, 'not-tested');
});

test('conference readiness switches to passed when explicit local evidence flags are supplied', async () => {
  const env = {
    TURN_URL: 'turn:localhost:3478',
    TURN_USERNAME: 'demo',
    TURN_CREDENTIAL: 'demo',
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret',
    LOCAL_SOCKET_IO_TEST: 'true',
    BROWSER_WEBRTC_EVIDENCE: 'true',
  };
  assert.deepEqual(readiness(env), {
    turnConfigured: true,
    sfuConfigured: true,
    websocketUpgradeConfigured: true,
    browserMediaEvidence: true,
  });
  const evidence = await runConferenceSimulation({ env });
  assert.equal(evidence.results.find((item) => item.name === 'TURN relay configuration').status, 'passed');
  assert.equal(evidence.results.find((item) => item.name === 'SFU configuration').status, 'passed');
  assert.equal(evidence.results.find((item) => item.name === 'Real browser WebRTC media exchange').evidenceType, 'browser-tested');
});
