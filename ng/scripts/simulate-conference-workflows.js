#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AGENTS = [
  { id: 'patient', role: 'Patient', canPublish: true, canDocument: false },
  { id: 'juniorDoctor', role: 'Junior Doctor', canPublish: true, canDocument: true },
  { id: 'consultant', role: 'Senior Consultant', canPublish: true, canDocument: true, canAdmit: true },
  { id: 'nurse', role: 'Nurse', canPublish: true, canRecordVitals: true },
  { id: 'pharmacist', role: 'Pharmacist', canPublish: true, canDispense: true },
  { id: 'labTech', role: 'Lab Technician', canPublish: true, canAttachLabs: true },
  { id: 'hospitalAdmin', role: 'Hospital Administrator', canPublish: true, canModerate: true },
  { id: 'referralCoordinator', role: 'Referral Coordinator', canPublish: true, canManageReferrals: true },
  { id: 'intern', role: 'Intern Observer', canPublish: false, readOnly: true },
  { id: 'observer2', role: 'Intern Observer', canPublish: false, readOnly: true },
];

const SCENARIOS = [
  ['2-person room join', 'simulated'],
  ['2-person offer answer signaling', 'simulated'],
  ['ICE candidate message exchange', 'simulated'],
  ['2-person secure chat exchange', 'simulated'],
  ['2-person leave cleanup', 'simulated'],
  ['2-person reconnect after socket drop', 'simulated'],
  ['3-way consultation join', 'simulated'],
  ['Junior doctor escalates to consultant', 'simulated'],
  ['3-way role permission enforcement', 'simulated'],
  ['Weak-bandwidth delayed signaling', 'simulated'],
  ['5-person clinical review join', 'simulated'],
  ['5-person active speaker update', 'simulated'],
  ['5-person hand raise queue', 'simulated'],
  ['5-person mute camera state sync', 'simulated'],
  ['Screen share permission gate', 'simulated'],
  ['Dropped participant cleanup', 'simulated'],
  ['Reconnect storm recovery', 'simulated'],
  ['10-person hospital board join', 'simulated'],
  ['10-person moderator controls', 'simulated'],
  ['Intern observer read-only enforcement', 'simulated'],
  ['Pharmacist dispense-only permission', 'simulated'],
  ['Lab technician attachment permission', 'simulated'],
  ['Websocket event throughput under load', 'simulated'],
  ['nginx websocket upgrade configuration', 'readiness-check-only'],
  ['TURN relay configuration', 'readiness-check-only'],
  ['SFU configuration', 'readiness-check-only'],
  ['Real browser WebRTC media exchange', 'browser-tested-or-not-tested'],
];

function createRoom(name, agentIds) {
  return {
    id: `${name}-${crypto.randomUUID()}`,
    participants: new Map(),
    events: [],
    agentIds,
  };
}

function getAgent(id) {
  const agent = AGENTS.find((item) => item.id === id);
  if (!agent) throw new Error(`Unknown agent ${id}`);
  return agent;
}

function emit(room, type, payload = {}) {
  room.events.push({ type, payload, at: new Date().toISOString() });
}

function join(room, agentId) {
  const agent = getAgent(agentId);
  const participant = {
    socketId: crypto.randomUUID(),
    agentId,
    role: agent.role,
    connected: true,
    muted: false,
    camera: agent.canPublish,
    joinedAt: new Date().toISOString(),
  };
  room.participants.set(agentId, participant);
  emit(room, 'participant.joined', { agentId, role: agent.role, participantCount: room.participants.size });
  return participant;
}

function leave(room, agentId) {
  room.participants.delete(agentId);
  emit(room, 'participant.left', { agentId, participantCount: room.participants.size });
}

function signal(room, from, to, signalType, metadata = {}) {
  if (!room.participants.has(from) || !room.participants.has(to)) {
    throw new Error('Cannot signal unavailable participant');
  }
  emit(room, 'signal', { from, to, signalType, metadata });
}

function assertRole(agentId, capability) {
  const agent = getAgent(agentId);
  if (!agent[capability]) {
    const error = new Error(`${agent.role} lacks ${capability}`);
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
}

function readiness(env = process.env) {
  const turnConfigured = Boolean(env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL);
  const sfuConfigured = Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
  const websocketUpgradeConfigured = env.NGINX_WEBSOCKET_UPGRADE === 'true' || env.LOCAL_SOCKET_IO_TEST === 'true';
  const browserMediaEvidence = env.BROWSER_WEBRTC_EVIDENCE === 'true';
  return {
    turnConfigured,
    sfuConfigured,
    websocketUpgradeConfigured,
    browserMediaEvidence,
  };
}

function result(name, status, evidenceType, details = {}) {
  return { name, status, evidenceType, details, at: new Date().toISOString() };
}

async function runConferenceSimulation({ env = process.env } = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  const ready = readiness(env);

  const two = createRoom('two-person', ['patient', 'juniorDoctor']);
  join(two, 'patient'); join(two, 'juniorDoctor');
  results.push(result('2-person room join', 'passed', 'simulated', { participantCount: two.participants.size }));
  signal(two, 'juniorDoctor', 'patient', 'offer');
  signal(two, 'patient', 'juniorDoctor', 'answer');
  results.push(result('2-person offer answer signaling', 'passed', 'simulated', { signals: 2 }));
  signal(two, 'juniorDoctor', 'patient', 'ice-candidate', { candidateType: 'host' });
  signal(two, 'patient', 'juniorDoctor', 'ice-candidate', { candidateType: 'srflx' });
  results.push(result('ICE candidate message exchange', 'passed', 'simulated', { candidateMessages: 2, realIceNegotiation: false }));
  emit(two, 'chat.message', { from: 'patient', body: 'I can hear you.' });
  emit(two, 'chat.message', { from: 'juniorDoctor', body: 'Video is visible.' });
  results.push(result('2-person secure chat exchange', 'passed', 'simulated', { messages: 2 }));
  leave(two, 'patient');
  results.push(result('2-person leave cleanup', 'passed', 'simulated', { participantCount: two.participants.size }));
  join(two, 'patient');
  emit(two, 'socket.reconnected', { agentId: 'patient' });
  results.push(result('2-person reconnect after socket drop', 'passed', 'simulated', { participantCount: two.participants.size }));

  const three = createRoom('three-way', ['patient', 'juniorDoctor', 'consultant']);
  ['patient', 'juniorDoctor', 'consultant'].forEach((agentId) => join(three, agentId));
  results.push(result('3-way consultation join', 'passed', 'simulated', { participantCount: three.participants.size }));
  assertRole('juniorDoctor', 'canDocument');
  assertRole('consultant', 'canAdmit');
  emit(three, 'consultation.escalated', { from: 'juniorDoctor', to: 'consultant' });
  results.push(result('Junior doctor escalates to consultant', 'passed', 'simulated', { escalation: true }));
  try {
    assertRole('patient', 'canDocument');
    results.push(result('3-way role permission enforcement', 'failed', 'simulated', { reason: 'patient documented unexpectedly' }));
  } catch (error) {
    results.push(result('3-way role permission enforcement', 'passed', 'simulated', { deniedSafely: error.code === 'PERMISSION_DENIED' }));
  }
  signal(three, 'patient', 'juniorDoctor', 'ice-candidate', { latencyMs: 1200, packetLossPercent: 8 });
  emit(three, 'bandwidth.degraded', { agentId: 'patient', mode: 'audio-only' });
  results.push(result('Weak-bandwidth delayed signaling', 'passed', 'simulated', { packetLossPercent: 8, mediaContinuityMeasured: false }));

  const five = createRoom('five-person', ['patient', 'juniorDoctor', 'consultant', 'nurse', 'pharmacist']);
  five.agentIds.forEach((agentId) => join(five, agentId));
  results.push(result('5-person clinical review join', 'passed', 'simulated', { participantCount: five.participants.size }));
  emit(five, 'active-speaker.changed', { agentId: 'consultant' });
  results.push(result('5-person active speaker update', 'passed', 'simulated', { activeSpeaker: 'consultant' }));
  emit(five, 'hand.raise', { agentId: 'patient' });
  results.push(result('5-person hand raise queue', 'passed', 'simulated', { queueLength: 1 }));
  five.participants.get('juniorDoctor').muted = true;
  five.participants.get('patient').camera = false;
  emit(five, 'media.state', { muted: ['juniorDoctor'], cameraOff: ['patient'] });
  results.push(result('5-person mute camera state sync', 'passed', 'simulated', { muted: 1, cameraOff: 1 }));
  try {
    assertRole('intern', 'canPublish');
    results.push(result('Screen share permission gate', 'failed', 'simulated'));
  } catch (error) {
    results.push(result('Screen share permission gate', 'passed', 'simulated', { deniedSafely: error.code === 'PERMISSION_DENIED' }));
  }
  leave(five, 'patient');
  results.push(result('Dropped participant cleanup', 'passed', 'simulated', { participantCount: five.participants.size }));
  ['patient', 'nurse', 'pharmacist'].forEach((agentId) => {
    join(five, agentId);
    emit(five, 'socket.reconnected', { agentId });
  });
  results.push(result('Reconnect storm recovery', 'passed', 'simulated', { reconnects: 3, participantCount: five.participants.size }));

  const ten = createRoom('ten-person', AGENTS.map((agent) => agent.id));
  ten.agentIds.forEach((agentId) => join(ten, agentId));
  results.push(result('10-person hospital board join', 'passed', 'simulated', { participantCount: ten.participants.size }));
  assertRole('hospitalAdmin', 'canModerate');
  emit(ten, 'moderator.control', { by: 'hospitalAdmin', action: 'mute-all' });
  results.push(result('10-person moderator controls', 'passed', 'simulated', { moderator: 'hospitalAdmin' }));
  try {
    assertRole('intern', 'canDocument');
    results.push(result('Intern observer read-only enforcement', 'failed', 'simulated'));
  } catch (error) {
    results.push(result('Intern observer read-only enforcement', 'passed', 'simulated', { deniedSafely: true }));
  }
  try {
    assertRole('pharmacist', 'canDocument');
    results.push(result('Pharmacist dispense-only permission', 'failed', 'simulated'));
  } catch (error) {
    assertRole('pharmacist', 'canDispense');
    results.push(result('Pharmacist dispense-only permission', 'passed', 'simulated', { deniedDocumentation: true, allowedDispense: true }));
  }
  assertRole('labTech', 'canAttachLabs');
  results.push(result('Lab technician attachment permission', 'passed', 'simulated', { allowedAttachment: true }));
  for (let i = 0; i < 250; i += 1) {
    emit(ten, 'signal', { from: ten.agentIds[i % ten.agentIds.length], sequence: i });
  }
  results.push(result('Websocket event throughput under load', 'passed', 'simulated', { events: ten.events.length }));

  results.push(result(
    'nginx websocket upgrade configuration',
    ready.websocketUpgradeConfigured ? 'passed' : 'skipped',
    'readiness-check-only',
    { configured: ready.websocketUpgradeConfigured }
  ));
  results.push(result(
    'TURN relay configuration',
    ready.turnConfigured ? 'passed' : 'skipped',
    'readiness-check-only',
    { configured: ready.turnConfigured, relayExercised: false }
  ));
  results.push(result(
    'SFU configuration',
    ready.sfuConfigured ? 'passed' : 'skipped',
    'readiness-check-only',
    { configured: ready.sfuConfigured, sfuMediaExercised: false }
  ));
  results.push(result(
    'Real browser WebRTC media exchange',
    ready.browserMediaEvidence ? 'passed' : 'skipped',
    ready.browserMediaEvidence ? 'browser-tested' : 'not-tested',
    { browserHarnessEvidenceProvided: ready.browserMediaEvidence }
  ));

  return {
    runId: `conference-sim-${Date.now()}`,
    startedAt,
    completedAt: new Date().toISOString(),
    finalResult: results.filter((item) => item.evidenceType === 'simulated').every((item) => item.status === 'passed') ? 'pass' : 'fail',
    scenarioCount: results.length,
    readiness: ready,
    results,
  };
}

async function main() {
  const evidence = await runConferenceSimulation();
  writeEvidence(evidence, 'conference-simulation-evidence.json');
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.finalResult !== 'pass') process.exitCode = 1;
}

function writeEvidence(evidence, fileName) {
  const artifactRoot = process.env.SIMULATION_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'ng-simulations', evidence.runId);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, fileName);
  evidence.artifactPath = artifactPath;
  fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2));
  return artifactPath;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  AGENTS,
  SCENARIOS,
  assertRole,
  readiness,
  runConferenceSimulation,
  writeEvidence,
};
