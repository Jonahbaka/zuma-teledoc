#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const API_PORT = Number(process.env.E2E_API_PORT || 8080);
const NEXT_PORT = Number(process.env.E2E_NEXT_PORT || 3100);
const APPOINTMENT_ID = process.env.E2E_NG_VIDEO_APPOINTMENT_ID || 'ng-video-e2e-appointment';
const ROOM_ID = process.env.E2E_NG_VIDEO_ROOM_ID || `ng-video-room-${APPOINTMENT_ID}`;
const ARTIFACT_DIR = path.join(
  ROOT,
  'artifacts',
  'video-e2e',
  new Date().toISOString().replace(/[:.]/g, '-')
);

const providerUser = {
  id: 'ng-provider-video-agent',
  email: 'ng.provider.video.agent@doctarx.test',
  role: 'provider',
  firstName: 'Amina',
  lastName: 'Okafor',
  name: 'Dr. Amina Okafor',
  marketScope: 'NG',
  country: 'NG',
  mustChangePassword: false,
  accountStatus: 'active'
};

const patientUser = {
  id: 'ng-patient-video-agent',
  email: 'ng.patient.video.agent@doctarx.test',
  role: 'patient',
  firstName: 'Chinedu',
  lastName: 'Bello',
  name: 'Chinedu Bello',
  marketScope: 'NG',
  country: 'NG',
  mustChangePassword: false,
  accountStatus: 'active'
};

const tokenUsers = new Map([
  ['provider-token', providerUser],
  ['patient-token', patientUser]
]);

const appointment = {
  id: APPOINTMENT_ID,
  type: 'video',
  status: 'confirmed',
  roomId: ROOM_ID,
  patientId: patientUser.id,
  providerId: providerUser.id,
  patientFirstName: patientUser.firstName,
  patientLastName: patientUser.lastName,
  providerFirstName: providerUser.firstName,
  providerLastName: providerUser.lastName,
  providerSpecialty: 'General Practice',
  scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  durationMinutes: 30,
  reasonForVisit: 'Nigeria launch-readiness video call test',
  marketScope: 'NG'
};

const evidence = {
  environment: 'local-next-production-build-with-contract-fixture',
  appointmentId: APPOINTMENT_ID,
  roomId: ROOM_ID,
  providerAccount: providerUser.email,
  patientAccount: patientUser.email,
  fixture: {
    apiPort: API_PORT,
    nextPort: NEXT_PORT,
    joinAttempts: [],
    signals: [],
    messages: []
  },
  provider: {},
  patient: {},
  controls: {},
  messaging: {},
  screenshots: {},
  console: {
    provider: [],
    patient: []
  },
  networkFailures: {
    provider: [],
    patient: []
  }
};

function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function ensureFakeMediaFiles() {
  const mediaDir = path.join(os.tmpdir(), 'doctarx-video-e2e-media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const videoPath = path.join(mediaDir, 'doctarx-fake-camera.y4m');
  const audioPath = path.join(mediaDir, 'doctarx-fake-microphone.wav');

  if (!fs.existsSync(videoPath)) {
    const width = 64;
    const height = 64;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);
    const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
    const frames = [header];
    for (let frameIndex = 0; frameIndex < 90; frameIndex += 1) {
      const frameHeader = Buffer.from('FRAME\n');
      const yPlane = Buffer.alloc(ySize, 72 + (frameIndex % 48));
      const uPlane = Buffer.alloc(uvSize, 96);
      const vPlane = Buffer.alloc(uvSize, 160);
      frames.push(frameHeader, yPlane, uPlane, vPlane);
    }
    fs.writeFileSync(videoPath, Buffer.concat(frames));
  }

  if (!fs.existsSync(audioPath)) {
    const sampleRate = 48000;
    const durationSeconds = 3;
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
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
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${url} timed out`));
    });
    req.end();
  });
}

async function waitForHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(750);
  }
  throw lastError || new Error(`${url} did not become ready`);
}

function getBearerUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return tokenUsers.get(token) || null;
}

function startFixtureServer() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_, res) => {
    res.json({ success: true, status: 'ok', appointmentId: APPOINTMENT_ID, roomId: ROOM_ID });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    res.json({ success: true, user });
  });

  app.get('/api/appointments/:id', (req, res) => {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    if (req.params.id !== APPOINTMENT_ID) {
      res.status(404).json({ success: false, message: 'Appointment not found' });
      return;
    }
    res.json({ success: true, appointment });
  });

  app.post('/api/appointments/:id/join', (req, res) => {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    if (req.params.id !== APPOINTMENT_ID) {
      res.status(404).json({ success: false, message: 'Appointment not found' });
      return;
    }
    evidence.fixture.joinAttempts.push({
      role: user.role,
      userId: user.id,
      appointmentId: APPOINTMENT_ID,
      roomId: ROOM_ID,
      at: new Date().toISOString()
    });
    res.json({
      success: true,
      appointmentId: APPOINTMENT_ID,
      roomId: ROOM_ID,
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    });
  });

  app.put('/api/appointments/:id', (req, res) => {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    if (req.params.id === APPOINTMENT_ID && req.body?.status) {
      appointment.status = req.body.status;
    }
    res.json({ success: true, appointment });
  });

  app.get('/api/payments/appointment/:id', (req, res) => {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    res.json({
      success: true,
      paymentRequired: false,
      paymentCompleted: true,
      amount: 0,
      currency: 'NGN'
    });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: true, credentials: true },
    transports: ['polling', 'websocket']
  });
  const roomParticipants = new Map();
  const socketSessions = new Map();

  function participantFor(socket, user, displayName) {
    return {
      socketId: socket.id,
      id: user.id,
      role: user.role,
      name: String(displayName || user.name || `${user.firstName} ${user.lastName}`).trim(),
      joinedAt: new Date().toISOString()
    };
  }

  function emitAck(ack, payload) {
    if (typeof ack === 'function') {
      ack(payload);
    }
  }

  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token || '').trim();
    const user = tokenUsers.get(token);
    if (!user) {
      next(new Error('Unauthorized'));
      return;
    }
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.on('telehealth:join', (payload = {}, ack) => {
      if (payload.appointmentId !== APPOINTMENT_ID) {
        emitAck(ack, { ok: false, error: 'Appointment not found' });
        return;
      }

      const roomKey = `telehealth:${ROOM_ID}`;
      const participant = participantFor(socket, socket.user, payload.displayName);
      const existing = Array.from(roomParticipants.values()).filter((item) => item.socketId !== socket.id);
      roomParticipants.set(socket.id, participant);
      socketSessions.set(socket.id, { appointmentId: APPOINTMENT_ID, roomId: ROOM_ID, roomKey, participant });
      socket.join(roomKey);

      const response = {
        ok: true,
        appointmentId: APPOINTMENT_ID,
        roomId: ROOM_ID,
        participant,
        participants: existing,
        iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
      };
      const participantCount = roomParticipants.size;
      const status = participantCount > 1 ? 'in_progress' : 'waiting';

      socket.emit('telehealth:joined', response);
      socket.emit('telehealth:status', { appointmentId: APPOINTMENT_ID, roomId: ROOM_ID, status, participantCount });
      socket.to(roomKey).emit('telehealth:participant-joined', {
        appointmentId: APPOINTMENT_ID,
        roomId: ROOM_ID,
        participant
      });
      socket.to(roomKey).emit('telehealth:status', {
        appointmentId: APPOINTMENT_ID,
        roomId: ROOM_ID,
        status,
        participantCount
      });
      emitAck(ack, response);
    });

    socket.on('telehealth:signal', (payload = {}, ack) => {
      const session = socketSessions.get(socket.id);
      if (!session) {
        emitAck(ack, { ok: false, error: 'Video session not initialized' });
        return;
      }
      const signalType = String(payload.signalType || '').trim();
      if (!payload.toSocketId || !roomParticipants.has(payload.toSocketId)) {
        emitAck(ack, { ok: false, error: 'Participant unavailable' });
        return;
      }
      evidence.fixture.signals.push({
        fromSocketId: socket.id,
        toSocketId: payload.toSocketId,
        signalType,
        at: new Date().toISOString()
      });
      io.to(payload.toSocketId).emit('telehealth:signal', {
        appointmentId: APPOINTMENT_ID,
        roomId: ROOM_ID,
        fromSocketId: socket.id,
        participant: session.participant,
        signalType,
        signal: payload.signal || null
      });
      emitAck(ack, { ok: true });
    });

    socket.on('telehealth:message', (payload = {}, ack) => {
      const session = socketSessions.get(socket.id);
      if (!session) {
        emitAck(ack, { ok: false, error: 'Video session not initialized' });
        return;
      }
      const body = String(payload.body || '').trim().slice(0, 1000);
      if (!body) {
        emitAck(ack, { ok: false, error: 'Message text is required' });
        return;
      }
      const message = {
        id: crypto.randomUUID(),
        appointmentId: APPOINTMENT_ID,
        roomId: ROOM_ID,
        senderSocketId: socket.id,
        senderUserId: socket.user.id,
        senderRole: socket.user.role,
        senderName: session.participant.name,
        body,
        sentAt: new Date().toISOString()
      };
      evidence.fixture.messages.push(message);
      io.to(session.roomKey).emit('telehealth:message', message);
      emitAck(ack, { ok: true, message });
    });

    socket.on('telehealth:leave', (_, ack) => {
      const session = socketSessions.get(socket.id);
      roomParticipants.delete(socket.id);
      socketSessions.delete(socket.id);
      if (session) {
        socket.to(session.roomKey).emit('telehealth:participant-left', {
          appointmentId: APPOINTMENT_ID,
          roomId: ROOM_ID,
          participant: session.participant
        });
      }
      emitAck(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      const session = socketSessions.get(socket.id);
      roomParticipants.delete(socket.id);
      socketSessions.delete(socket.id);
      if (session) {
        socket.to(session.roomKey).emit('telehealth:participant-left', {
          appointmentId: APPOINTMENT_ID,
          roomId: ROOM_ID,
          participant: session.participant
        });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(API_PORT, () => resolve({ server, io }));
  });
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chrome or Edge was not found. Set CHROME_PATH to run the video E2E test.');
  }
  return found;
}

function startNextServer() {
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const proc = spawn(process.execPath, [nextBin, 'start', '-p', String(NEXT_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`,
      NEXT_PUBLIC_SOCKET_URL: `http://localhost:${API_PORT}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logPath = path.join(ARTIFACT_DIR, 'next-start.log');
  proc.stdout.on('data', (chunk) => fs.appendFileSync(logPath, chunk));
  proc.stderr.on('data', (chunk) => fs.appendFileSync(logPath, chunk));
  return proc;
}

class CdpClient {
  constructor(wsUrl, role) {
    this.ws = new WebSocket(wsUrl);
    this.role = role;
    this.nextId = 1;
    this.pending = new Map();
    this.console = [];
    this.networkFailures = [];
    this.loadResolvers = [];

    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          resolve(message.result);
        }
        return;
      }
      if (message.method === 'Page.loadEventFired') {
        this.loadResolvers.splice(0).forEach((resolve) => resolve());
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ');
        this.console.push({ type: message.params.type, text, at: new Date().toISOString() });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.console.push({
          type: 'exception',
          text: message.params.exceptionDetails?.text || 'Runtime exception',
          at: new Date().toISOString()
        });
      }
      if (message.method === 'Network.loadingFailed') {
        this.networkFailures.push({
          requestId: message.params.requestId,
          errorText: message.params.errorText,
          blockedReason: message.params.blockedReason || null,
          at: new Date().toISOString()
        });
      }
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 15000);
    });
  }

  async enable() {
    await this.ready();
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await Promise.race([
      new Promise((resolve) => this.loadResolvers.push(resolve)),
      wait(15000)
    ]);
    await this.waitFor(() => 'document.readyState === "complete" || document.readyState === "interactive"', 30000);
  }

  async waitFor(expressionFactory, timeoutMs = 30000, intervalMs = 500) {
    const start = Date.now();
    let lastValue = null;
    while (Date.now() - start < timeoutMs) {
      const expression = typeof expressionFactory === 'function' ? expressionFactory() : expressionFactory;
      try {
        lastValue = await this.evaluate(`(() => { return Boolean(${expression}); })()`);
        if (lastValue) {
          return true;
        }
      } catch {
        // keep polling until timeout
      }
      await wait(intervalMs);
    }
    throw new Error(`${this.role} timed out waiting for ${String(expressionFactory)}`);
  }

  async waitForValue(expression, predicate, timeoutMs = 45000, intervalMs = 500) {
    const start = Date.now();
    let lastValue = null;
    while (Date.now() - start < timeoutMs) {
      try {
        lastValue = await this.evaluate(expression);
        if (predicate(lastValue)) {
          return lastValue;
        }
      } catch {
        // keep polling
      }
      await wait(intervalMs);
    }
    throw new Error(`${this.role} timed out waiting for value. Last value: ${JSON.stringify(lastValue)}`);
  }

  async clickByText(pattern) {
    const result = await this.waitForValue(
      `(() => {
        const rx = new RegExp(${JSON.stringify(pattern)}, 'i');
        const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const element = elements.find((item) => {
          const text = [item.innerText, item.textContent, item.getAttribute('title'), item.getAttribute('aria-label')]
            .filter(Boolean)
            .join(' ');
          const rect = item.getBoundingClientRect();
          return rx.test(text) && rect.width > 0 && rect.height > 0 && !item.disabled;
        });
        if (!element) {
          return { ok: false, visible: elements.map((item) => item.innerText || item.getAttribute('title') || item.getAttribute('aria-label')).filter(Boolean).slice(0, 20) };
        }
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
        return { ok: true, text: element.innerText || element.getAttribute('title') || element.getAttribute('aria-label') };
      })()`,
      (value) => value?.ok,
      45000
    );
    return result;
  }

  async clickBySelector(selector) {
    const result = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return { ok: true, text: element.innerText || element.getAttribute('title') || element.getAttribute('aria-label') || ${JSON.stringify(selector)} };
    })()`);
    if (!result?.ok) {
      throw new Error(`${this.role} could not click ${selector}`);
    }
    return result;
  }

  async submitChat(text) {
    return this.evaluate(`(async () => {
      const input = document.querySelector('[data-testid="telehealth-chat-input"]');
      if (!input) return { ok: false, reason: 'chat input missing' };
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor.set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const form = input.closest('form');
      if (form?.requestSubmit) {
        form.requestSubmit();
      } else if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      return { ok: true };
    })()`);
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  async close() {
    try {
      await this.send('Browser.close');
    } catch {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }
}

async function launchBrowserAgent({ role, token, user, debugPort, width = 1280, height = 900 }) {
  const chromePath = findChromePath();
  const sharedFakeMedia = ensureFakeMediaFiles();
  const roleMediaDir = path.join(
    os.tmpdir(),
    'doctarx-video-e2e-media',
    `${path.basename(ARTIFACT_DIR)}-${role}`
  );
  fs.rmSync(roleMediaDir, { recursive: true, force: true });
  fs.mkdirSync(roleMediaDir, { recursive: true });
  const fakeMedia = {
    videoPath: path.join(roleMediaDir, `${role}-camera.y4m`),
    audioPath: path.join(roleMediaDir, `${role}-microphone.wav`)
  };
  fs.copyFileSync(sharedFakeMedia.videoPath, fakeMedia.videoPath);
  fs.copyFileSync(sharedFakeMedia.audioPath, fakeMedia.audioPath);
  const userDataDir = path.join(
    os.tmpdir(),
    'doctarx-video-e2e',
    `${path.basename(ARTIFACT_DIR)}-${role}-chrome-profile`
  );
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${fakeMedia.videoPath}`,
    `--use-file-for-fake-audio-capture=${fakeMedia.audioPath}`,
    '--autoplay-policy=no-user-gesture-required',
    '--allow-insecure-localhost',
    `--unsafely-treat-insecure-origin-as-secure=http://localhost:${NEXT_PORT},http://localhost:${API_PORT}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const browserLog = path.join(ARTIFACT_DIR, `${role}-chrome.log`);
  proc.stdout.on('data', (chunk) => fs.appendFileSync(browserLog, chunk));
  proc.stderr.on('data', (chunk) => fs.appendFileSync(browserLog, chunk));

  const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
  let version = null;
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      version = await requestJson(versionUrl);
      if (version?.webSocketDebuggerUrl) {
        break;
      }
    } catch {
      // wait for debugging server
    }
    await wait(500);
  }
  if (!version?.webSocketDebuggerUrl) {
    throw new Error(`${role} Chrome debugging server did not become available`);
  }

  let target = null;
  try {
    target = await requestJson(`http://127.0.0.1:${debugPort}/json/new?about:blank`, 'PUT');
  } catch {
    const targets = await requestJson(`http://127.0.0.1:${debugPort}/json/list`);
    target = targets?.find((item) => item.type === 'page');
  }

  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`${role} Chrome debugging target did not become available`);
  }

  const client = new CdpClient(target.webSocketDebuggerUrl, role);
  await client.enable();
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.setItem('accessToken', ${JSON.stringify(token)});
      localStorage.setItem('refreshToken', ${JSON.stringify(`${token}-refresh`)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
    `
  });

  return { proc, client };
}

function isConnectedSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      snapshot.roomId === ROOM_ID &&
      snapshot.localTrackCount >= 1 &&
      snapshot.remoteTrackCount >= 1 &&
      ['connected', 'completed'].includes(String(snapshot.peerConnectionState || '')) &&
      ['connected', 'completed'].includes(String(snapshot.iceConnectionState || ''))
  );
}

async function runE2E() {
  ensureArtifactDir();
  const fixture = await startFixtureServer();
  const nextProc = startNextServer();
  const providerAgent = await launchBrowserAgent({
    role: 'provider',
    token: 'provider-token',
    user: providerUser,
    debugPort: 9223,
    width: 1440,
    height: 960
  });
  const patientAgent = await launchBrowserAgent({
    role: 'patient',
    token: 'patient-token',
    user: patientUser,
    debugPort: 9224,
    width: 1280,
    height: 900
  });

  try {
    await waitForHttp(`http://localhost:${API_PORT}/api/health`, 30000);
    await waitForHttp(`http://localhost:${NEXT_PORT}/ng/provider/appointments/${APPOINTMENT_ID}/call`, 90000);

    const providerUrl = `http://localhost:${NEXT_PORT}/ng/provider/appointments/${APPOINTMENT_ID}/call`;
    const patientUrl = `http://localhost:${NEXT_PORT}/ng/patient/appointments/${APPOINTMENT_ID}/call`;

    await Promise.all([
      providerAgent.client.navigate(providerUrl),
      patientAgent.client.navigate(patientUrl)
    ]);

    evidence.provider.joinClick = await providerAgent.client.clickByText('Join now');
    evidence.provider.afterJoin = await providerAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.roomId === ROOM_ID && snapshot.localTrackCount >= 1,
      45000
    );

    evidence.patient.joinClick = await patientAgent.client.clickByText('Join Appointment');
    evidence.patient.afterJoin = await patientAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.roomId === ROOM_ID && snapshot.localTrackCount >= 1,
      90000
    );

    const [providerConnected, patientConnected] = await Promise.all([
      providerAgent.client.waitForValue('window.__doctarxTelehealthDebug || null', isConnectedSnapshot, 70000),
      patientAgent.client.waitForValue('window.__doctarxTelehealthDebug || null', isConnectedSnapshot, 70000)
    ]);

    evidence.provider.connected = providerConnected;
    evidence.patient.connected = patientConnected;
    evidence.provider.joinedSameRoom = providerConnected.roomId === ROOM_ID;
    evidence.patient.joinedSameRoom = patientConnected.roomId === ROOM_ID;

    evidence.screenshots.providerConnected = await providerAgent.client.screenshot('provider-connected');
    evidence.screenshots.patientConnected = await patientAgent.client.screenshot('patient-connected');

    await providerAgent.client.clickByText('Mute');
    const providerMuted = await providerAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localAudioTrackCount >= 1 && snapshot.localEnabledAudioTrackCount === 0,
      10000
    );
    await providerAgent.client.clickByText('Unmute');
    const providerUnmuted = await providerAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localEnabledAudioTrackCount >= 1,
      10000
    );

    await providerAgent.client.clickByText('Stop Video');
    const providerCameraOff = await providerAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localVideoTrackCount >= 1 && snapshot.localEnabledVideoTrackCount === 0,
      10000
    );
    await providerAgent.client.clickByText('Start Video');
    const providerCameraOn = await providerAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localEnabledVideoTrackCount >= 1,
      10000
    );

    await patientAgent.client.clickByText('Microphone');
    const patientMuted = await patientAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localAudioTrackCount >= 1 && snapshot.localEnabledAudioTrackCount === 0,
      10000
    );
    await patientAgent.client.clickByText('Microphone');
    const patientUnmuted = await patientAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localEnabledAudioTrackCount >= 1,
      10000
    );
    await patientAgent.client.clickByText('Camera');
    const patientCameraOff = await patientAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localVideoTrackCount >= 1 && snapshot.localEnabledVideoTrackCount === 0,
      10000
    );
    await patientAgent.client.clickByText('Camera');
    const patientCameraOn = await patientAgent.client.waitForValue(
      'window.__doctarxTelehealthDebug || null',
      (snapshot) => snapshot?.localEnabledVideoTrackCount >= 1,
      10000
    );

    evidence.controls = {
      providerMuted,
      providerUnmuted,
      providerCameraOff,
      providerCameraOn,
      patientMuted,
      patientUnmuted,
      patientCameraOff,
      patientCameraOn
    };

    await providerAgent.client.clickByText('Chat');
    await providerAgent.client.submitChat('Provider agent confirms audio and video are connected.');
    await patientAgent.client.clickByText('Chat');
    await patientAgent.client.waitForValue(
      `document.body.innerText`,
      (text) => String(text || '').includes('Provider agent confirms audio and video are connected.'),
      15000
    );
    await patientAgent.client.submitChat('Patient agent confirms remote stream is visible and audible.');
    await providerAgent.client.waitForValue(
      `document.body.innerText`,
      (text) => String(text || '').includes('Patient agent confirms remote stream is visible and audible.'),
      15000
    );
    evidence.messaging.providerToPatient = true;
    evidence.messaging.patientToProvider = true;

    evidence.screenshots.providerChat = await providerAgent.client.screenshot('provider-chat');
    evidence.screenshots.patientChat = await patientAgent.client.screenshot('patient-chat');

    await providerAgent.client.clickBySelector('[data-testid="telehealth-leave-call"]');
    await wait(500);
    await patientAgent.client.clickBySelector('[data-testid="telehealth-leave-call"]');
    evidence.provider.leftCleanly = true;
    evidence.patient.leftCleanly = true;

    evidence.console.provider = providerAgent.client.console;
    evidence.console.patient = patientAgent.client.console;
    evidence.networkFailures.provider = providerAgent.client.networkFailures;
    evidence.networkFailures.patient = patientAgent.client.networkFailures;
    evidence.finalResult = 'pass';
  } catch (error) {
    evidence.finalResult = 'fail';
    evidence.error = error.stack || error.message;
    try {
      evidence.provider.failureSnapshot = await providerAgent.client.evaluate('window.__doctarxTelehealthDebug || null');
      evidence.screenshots.providerFailure = await providerAgent.client.screenshot('provider-failure');
    } catch {
      // ignore failure evidence collection errors
    }
    try {
      evidence.patient.failureSnapshot = await patientAgent.client.evaluate('window.__doctarxTelehealthDebug || null');
      evidence.screenshots.patientFailure = await patientAgent.client.screenshot('patient-failure');
    } catch {
      // ignore failure evidence collection errors
    }
    evidence.console.provider = providerAgent.client.console;
    evidence.console.patient = patientAgent.client.console;
    evidence.networkFailures.provider = providerAgent.client.networkFailures;
    evidence.networkFailures.patient = patientAgent.client.networkFailures;
    throw error;
  } finally {
    const resultPath = path.join(ARTIFACT_DIR, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
    console.log(`Video E2E evidence written to ${resultPath}`);

    await Promise.allSettled([
      providerAgent.client.close(),
      patientAgent.client.close()
    ]);
    for (const proc of [providerAgent.proc, patientAgent.proc, nextProc]) {
      if (!proc.killed) {
        proc.kill();
      }
    }
    await new Promise((resolve) => fixture.io.close(() => resolve()));
    await new Promise((resolve) => fixture.server.close(() => resolve()));
  }
}

runE2E().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
