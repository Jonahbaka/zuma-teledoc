#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.LIVEKIT_E2E_PORT || 3137);
const COUNTS = String(process.env.LIVEKIT_E2E_COUNTS || '3,5,10')
  .split(',')
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isInteger(item) && item > 1);
const REQUIRE_LIVEKIT_E2E = process.env.REQUIRE_LIVEKIT_E2E === 'true';
const REQUIRE_TURN_RELAY = process.env.REQUIRE_TURN_RELAY === 'true';
const ARTIFACT_DIR = path.join(
  ROOT,
  'artifacts',
  'livekit-sfu-e2e',
  new Date().toISOString().replace(/[:.]/g, '-')
);

const livekitConfig = {
  url: process.env.NG_LIVEKIT_URL || process.env.LIVEKIT_URL,
  apiKey: process.env.NG_LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.NG_LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET,
};

const evidence = {
  runId: `livekit-sfu-e2e-${Date.now()}`,
  startedAt: new Date().toISOString(),
  completedAt: null,
  livekitHost: compactUrl(livekitConfig.url),
  counts: COUNTS,
  scenarios: [],
  finalResult: 'pending',
};

function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function compactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return value ? 'configured' : null;
  }
}

function hasLiveKitConfig() {
  return Boolean(livekitConfig.url && livekitConfig.apiKey && livekitConfig.apiSecret);
}

function writeEvidence() {
  ensureArtifactDir();
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'result.json'), JSON.stringify(evidence, null, 2));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error(`${url} timed out`)));
    req.end();
  });
}

function generateToken(roomName, identity, name) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: livekitConfig.apiKey,
    sub: identity,
    name,
    nbf: now - 10,
    exp: now + 60 * 60,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    },
  }, livekitConfig.apiSecret, { algorithm: 'HS256', noTimestamp: true });
}

function ensureFakeMediaFiles() {
  const mediaDir = path.join(os.tmpdir(), 'doctarx-livekit-e2e-media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const videoPath = path.join(mediaDir, 'doctarx-fake-camera.y4m');
  const audioPath = path.join(mediaDir, 'doctarx-fake-microphone.wav');

  if (!fs.existsSync(videoPath)) {
    const width = 96;
    const height = 96;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
    const frames = [header];
    for (let frameIndex = 0; frameIndex < 180; frameIndex += 1) {
      frames.push(
        Buffer.from('FRAME\n'),
        Buffer.alloc(ySize, 60 + (frameIndex % 90)),
        Buffer.alloc(uvSize, 92),
        Buffer.alloc(uvSize, 170)
      );
    }
    fs.writeFileSync(videoPath, Buffer.concat(frames));
  }

  if (!fs.existsSync(audioPath)) {
    const sampleRate = 48000;
    const durationSeconds = 4;
    const sampleCount = sampleRate * durationSeconds;
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
      buffer.writeInt16LE(sample, 44 + i * 2);
    }
    fs.writeFileSync(audioPath, buffer);
  }

  return { videoPath, audioPath };
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Chromium executable not found. Set CHROME_PATH.');
}

function startStaticServer() {
  const app = express();
  const livekitBundle = path.join(ROOT, 'node_modules', 'livekit-client', 'dist', 'livekit-client.umd.js');

  app.get('/health', (_, res) => res.json({ ok: true }));
  app.get('/livekit-client.umd.js', (_, res) => res.sendFile(livekitBundle));
  app.get('/room.html', (_, res) => {
    res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>DoctaRx LiveKit E2E</title>
  <style>
    body { margin: 0; background: #020617; color: #f8fafc; font-family: system-ui, sans-serif; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; padding: 12px; }
    video { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: #0f172a; }
    #status { padding: 10px 12px; font-size: 12px; color: #a7f3d0; border-bottom: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div id="status">starting</div>
  <main id="tiles"></main>
  <script src="/livekit-client.umd.js"></script>
  <script>
    const params = new URLSearchParams(location.search);
    const LK = window.LivekitClient;
    const statusEl = document.getElementById('status');
    const tiles = document.getElementById('tiles');

    window.__lkPeerConnections = [];
    const NativePeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function(...args) {
      const pc = new NativePeerConnection(...args);
      window.__lkPeerConnections.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = NativePeerConnection.prototype;

    const state = {
      identity: params.get('identity'),
      roomName: params.get('room'),
      connected: false,
      connectionState: 'new',
      local: { audio: 0, video: 0, screen: 0 },
      remote: { participants: 0, audio: 0, video: 0, screen: 0 },
      candidatePairs: [],
      turnRelayObserved: false,
      errors: [],
      events: [],
    };
    window.__lkE2E = state;

    function publications(participant) {
      return Array.from(participant?.trackPublications?.values?.() || []);
    }
    function kind(pub) {
      return String(pub?.kind || pub?.track?.kind || pub?.track?.mediaStreamTrack?.kind || '').toLowerCase();
    }
    function source(pub) {
      return String(pub?.source || pub?.track?.source || '').toLowerCase();
    }
    function countPubs(participants, predicate) {
      return participants.reduce((total, participant) => (
        total + publications(participant).filter((pub) => pub.track && !pub.isMuted && predicate(pub)).length
      ), 0);
    }
    function update() {
      const room = window.__lkRoom;
      if (!room) return;
      const local = room.localParticipant ? [room.localParticipant] : [];
      const remotes = Array.from(room.remoteParticipants?.values?.() || []);
      state.connectionState = room.state;
      state.connected = room.state === 'connected';
      state.local.audio = countPubs(local, (pub) => kind(pub) === 'audio');
      state.local.video = countPubs(local, (pub) => kind(pub) === 'video' && !source(pub).includes('screen'));
      state.local.screen = countPubs(local, (pub) => source(pub).includes('screen'));
      state.remote.participants = remotes.length;
      state.remote.audio = countPubs(remotes, (pub) => kind(pub) === 'audio');
      state.remote.video = countPubs(remotes, (pub) => kind(pub) === 'video' && !source(pub).includes('screen'));
      state.remote.screen = countPubs(remotes, (pub) => source(pub).includes('screen'));
      statusEl.textContent = JSON.stringify({
        identity: state.identity,
        connectionState: state.connectionState,
        local: state.local,
        remote: state.remote,
      });
    }
    function attachTrack(track, participant) {
      if (!track || typeof track.attach !== 'function') return;
      const element = document.createElement(track.kind === 'video' ? 'video' : 'audio');
      element.autoplay = true;
      element.playsInline = true;
      element.muted = participant?.isLocal || participant === window.__lkRoom?.localParticipant;
      element.dataset.identity = participant?.identity || 'unknown';
      element.dataset.kind = track.kind || '';
      track.attach(element);
      tiles.appendChild(element);
    }
    async function collectStats() {
      const pairs = [];
      for (const pc of window.__lkPeerConnections) {
        const stats = await pc.getStats();
        const byId = {};
        stats.forEach((report) => { byId[report.id] = report; });
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && (report.selected || (report.nominated && report.state === 'succeeded'))) {
            const local = byId[report.localCandidateId] || {};
            const remote = byId[report.remoteCandidateId] || {};
            pairs.push({
              state: report.state,
              nominated: Boolean(report.nominated),
              localCandidateType: local.candidateType || null,
              remoteCandidateType: remote.candidateType || null,
              protocol: local.protocol || remote.protocol || null,
            });
          }
        });
      }
      state.candidatePairs = pairs;
      state.turnRelayObserved = pairs.some((pair) => pair.localCandidateType === 'relay' || pair.remoteCandidateType === 'relay');
      return state;
    }
    window.__lkCollectStats = collectStats;

    async function start() {
      const room = new LK.Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { simulcast: true, stopMicTrackOnMute: false },
        videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 20 } },
      });
      window.__lkRoom = room;
      const record = (event) => (...args) => {
        state.events.push({ event, at: new Date().toISOString(), args: args.length });
        update();
      };
      room
        .on(LK.RoomEvent.ConnectionStateChanged, record('connection-state'))
        .on(LK.RoomEvent.ParticipantConnected, record('participant-connected'))
        .on(LK.RoomEvent.ParticipantDisconnected, record('participant-disconnected'))
        .on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
          attachTrack(track, participant);
          record('track-subscribed')(publication?.source || track?.source || track?.kind);
        })
        .on(LK.RoomEvent.TrackUnsubscribed, record('track-unsubscribed'))
        .on(LK.RoomEvent.LocalTrackPublished, (publication) => {
          attachTrack(publication.track, room.localParticipant);
          record('local-track-published')(publication?.source || publication?.kind);
        })
        .on(LK.RoomEvent.TrackMuted, record('track-muted'))
        .on(LK.RoomEvent.TrackUnmuted, record('track-unmuted'))
        .on(LK.RoomEvent.Disconnected, record('disconnected'));

      await room.connect(params.get('url'), params.get('token'), { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setCameraEnabled(true);
      update();
      setInterval(() => { update(); collectStats().catch(() => {}); }, 1000);
    }

    start().catch((error) => {
      state.errors.push(error && error.message ? error.message : String(error));
      statusEl.textContent = 'error: ' + state.errors.join('; ');
    });
  </script>
</body>
</html>`);
  });

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => resolve(server));
  });
}

class CdpClient {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.console = [];
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      let message = null;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result || {});
      } else if (message.method === 'Runtime.consoleAPICalled') {
        this.console.push(message.params);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${this.label} CDP ${method} timed out`));
        }
      }, 30000).unref();
    });
  }

  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitForValue('document.readyState', (value) => value === 'complete' || value === 'interactive', 30000);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`${this.label} evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  async waitForValue(expression, predicate, timeoutMs = 90000, intervalMs = 750) {
    const started = Date.now();
    let lastValue = null;
    while (Date.now() - started < timeoutMs) {
      try {
        lastValue = await this.evaluate(expression);
        if (predicate(lastValue)) return lastValue;
      } catch (error) {
        lastValue = { error: error.message };
      }
      await wait(intervalMs);
    }
    throw new Error(`${this.label} timed out. Last value: ${JSON.stringify(lastValue)}`);
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  async close() {
    try { await this.send('Browser.close'); } catch {}
  }
}

async function launchAgent({ label, debugPort, url }) {
  const chromePath = findChromePath();
  const media = ensureFakeMediaFiles();
  const userDataDir = path.join(os.tmpdir(), 'doctarx-livekit-e2e', `${path.basename(ARTIFACT_DIR)}-${label}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const proc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,860',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-extensions',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${media.videoPath}`,
    `--use-file-for-fake-audio-capture=${media.audioPath}`,
    '--autoplay-policy=no-user-gesture-required',
    '--allow-insecure-localhost',
    `--unsafely-treat-insecure-origin-as-secure=http://localhost:${PORT}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const logFile = path.join(ARTIFACT_DIR, `${label}-chrome.log`);
  proc.stdout.on('data', (chunk) => fs.appendFileSync(logFile, chunk));
  proc.stderr.on('data', (chunk) => fs.appendFileSync(logFile, chunk));

  let version = null;
  const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      version = await requestJson(versionUrl);
      if (version?.webSocketDebuggerUrl) break;
    } catch {}
    await wait(500);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error(`${label} Chrome did not expose CDP`);

  let target = null;
  try {
    target = await requestJson(`http://127.0.0.1:${debugPort}/json/new?about:blank`, 'PUT');
  } catch {
    const targets = await requestJson(`http://127.0.0.1:${debugPort}/json/list`);
    target = targets.find((item) => item.type === 'page');
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`${label} Chrome page target missing`);

  const client = new CdpClient(target.webSocketDebuggerUrl, label);
  await client.enable();
  await client.navigate(url);
  return { label, proc, client, url };
}

function roomUrl({ roomName, identity, displayName }) {
  const token = generateToken(roomName, identity, displayName);
  const params = new URLSearchParams({
    room: roomName,
    identity,
    name: displayName,
    url: livekitConfig.url,
    token,
  });
  return `http://localhost:${PORT}/room.html?${params.toString()}`;
}

function localMediaReady(snapshot) {
  return snapshot?.connected &&
    snapshot.local?.audio >= 1 &&
    snapshot.local?.video >= 1 &&
    !snapshot.errors?.length;
}

function remoteMediaReady(expectedRemote) {
  return (snapshot) => snapshot?.connected &&
    snapshot.remote?.participants >= expectedRemote &&
    snapshot.remote?.audio >= expectedRemote &&
    snapshot.remote?.video >= expectedRemote &&
    !snapshot.errors?.length;
}

async function runScenario(count) {
  const roomName = `doctarx-livekit-e2e-${count}-${crypto.randomUUID()}`;
  const scenario = {
    name: `${count}-participant LiveKit SFU media session`,
    count,
    roomName,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    localMedia: [],
    remoteMedia: [],
    weakBandwidth: null,
    reconnect: null,
    turnRelayObserved: false,
    candidatePairs: [],
    screenshots: [],
    error: null,
  };
  evidence.scenarios.push(scenario);
  writeEvidence();

  const agents = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const identity = `doctarx-e2e-${count}-${index}`;
      const displayName = `DoctaRx E2E ${index + 1}`;
      const url = roomUrl({ roomName, identity, displayName });
      agents.push(await launchAgent({
        label: `${count}p-${index + 1}`,
        debugPort: 9400 + count * 20 + index,
        url,
      }));
    }

    scenario.localMedia = await Promise.all(agents.map((agent) => (
      agent.client.waitForValue('window.__lkE2E || null', localMediaReady, 90000)
    )));

    scenario.remoteMedia = await Promise.all(agents.map((agent) => (
      agent.client.waitForValue('window.__lkE2E || null', remoteMediaReady(count - 1), 120000)
    )));

    const stats = await Promise.all(agents.map((agent) => (
      agent.client.evaluate('window.__lkCollectStats && window.__lkCollectStats()')
    )));
    scenario.turnRelayObserved = stats.some((snapshot) => snapshot?.turnRelayObserved);
    scenario.candidatePairs = stats.flatMap((snapshot) => snapshot?.candidatePairs || []);

    scenario.screenshots.push(await agents[0].client.screenshot(`${count}p-agent-1`));
    if (agents[count - 1]) {
      scenario.screenshots.push(await agents[count - 1].client.screenshot(`${count}p-agent-${count}`));
    }

    if (count === 3) {
      await agents[0].client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 500,
        downloadThroughput: 65 * 1024,
        uploadThroughput: 35 * 1024,
      });
      await wait(8000);
      scenario.weakBandwidth = await agents[0].client.waitForValue(
        'window.__lkE2E || null',
        (snapshot) => snapshot?.connected && snapshot.remote?.video >= count - 1,
        30000
      );
      await agents[0].client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });

      await agents[1].client.navigate(agents[1].url);
      scenario.reconnect = await agents[1].client.waitForValue(
        'window.__lkE2E || null',
        remoteMediaReady(count - 1),
        90000
      );
    }

    if (REQUIRE_TURN_RELAY && !scenario.turnRelayObserved) {
      throw new Error('TURN relay was required but no selected relay candidate pair was observed');
    }

    scenario.status = 'passed';
  } catch (error) {
    scenario.status = 'failed';
    scenario.error = error.message;
    throw error;
  } finally {
    scenario.completedAt = new Date().toISOString();
    writeEvidence();
    await Promise.all(agents.map(async (agent) => {
      try { await agent.client.close(); } catch {}
      try { agent.proc.kill(); } catch {}
    }));
  }
}

async function main() {
  ensureArtifactDir();

  if (!hasLiveKitConfig()) {
    evidence.finalResult = 'skipped';
    evidence.completedAt = new Date().toISOString();
    evidence.skipReason = 'LiveKit environment is not configured';
    writeEvidence();
    console.log(JSON.stringify({
      LIVEKIT_SFU_E2E: 'SKIPPED',
      reason: evidence.skipReason,
      artifact: path.join(ARTIFACT_DIR, 'result.json'),
    }, null, 2));
    if (REQUIRE_LIVEKIT_E2E) process.exit(1);
    return;
  }

  const server = await startStaticServer();
  try {
    for (const count of COUNTS) {
      await runScenario(count);
    }
    evidence.finalResult = evidence.scenarios.every((scenario) => scenario.status === 'passed')
      ? 'pass'
      : 'fail';
  } catch (error) {
    evidence.finalResult = 'fail';
    evidence.error = error.message;
  } finally {
    evidence.completedAt = new Date().toISOString();
    writeEvidence();
    await new Promise((resolve) => server.close(resolve));
  }

  for (const scenario of evidence.scenarios) {
    const remoteOk = scenario.remoteMedia.every((snapshot) => (
      snapshot.remote?.participants >= scenario.count - 1 &&
      snapshot.remote?.audio >= scenario.count - 1 &&
      snapshot.remote?.video >= scenario.count - 1
    ));
    console.log(`[${scenario.status.toUpperCase()}] ${scenario.name}: remoteMedia=${remoteOk} turnRelayObserved=${scenario.turnRelayObserved}`);
  }
  console.log(`LIVEKIT_SFU_E2E=${evidence.finalResult.toUpperCase()}`);
  console.log(`artifact=${path.join(ARTIFACT_DIR, 'result.json')}`);

  if (evidence.finalResult !== 'pass') process.exit(1);
}

main().catch((error) => {
  evidence.finalResult = 'fail';
  evidence.error = error.message;
  evidence.completedAt = new Date().toISOString();
  writeEvidence();
  console.error(error);
  process.exit(1);
});
