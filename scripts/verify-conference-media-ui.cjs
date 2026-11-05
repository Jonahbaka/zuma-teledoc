'use strict';
// Runs the actual React components against fictional SFU events and Chromium's
// generated media devices. This is UI/lifecycle evidence, not physical-device,
// restrictive-network, clinical-consent, or real SFU interoperability proof.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');

const root = path.resolve(__dirname, '..');
const modules = {};
function addModule(id, filename, jsx = false) {
  if (modules[id]) return;
  const source = fs.readFileSync(filename, 'utf8');
  const code = jsx ? babel.transformSync(source, {
    filename, configFile: false, babelrc: false,
    presets: [[require.resolve('next/babel'), { 'preset-react': { runtime: 'classic' }, 'preset-env': { modules: 'commonjs', targets: { chrome: '120' } } }]],
  }).code : source;
  modules[id] = code;
  for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const dependency = match[1];
    if (dependency.startsWith('@babel/runtime/')) addModule(dependency, require.resolve(dependency));
    else if (dependency.startsWith('.')) {
      const absolute = require.resolve(path.resolve(path.dirname(filename), dependency));
      // Babel helpers use sibling-relative imports. Give each one an absolute
      // module ID in this small offline browser fixture.
      const childId = absolute.replaceAll('\\', '/');
      modules[id] = modules[id].split(`require("${dependency}")`).join(`require(${JSON.stringify(childId)})`).split(`require('${dependency}')`).join(`require(${JSON.stringify(childId)})`);
      if (id.startsWith('@babel/runtime/') || filename.includes(`${path.sep}@babel${path.sep}`)) addModule(childId, absolute);
    }
  }
}

async function main() {
  for (const name of ['livekitMediaLifecycle', 'localMediaPreview']) addModule(`@/lib/ng/${name}.cjs`, path.join(root, 'lib/ng', `${name}.cjs`));
  for (const name of ['MediaPreflight', 'LiveKitMediaPanel']) addModule(name, path.join(root, 'components/ng/conference', `${name}.jsx`), true);
  // The API module is intentionally stubbed; no real room or participant exists.
  const panelApi = path.join(root, 'components/ng/conference/conferenceApi.js').replaceAll('\\', '/');
  modules[panelApi] = 'exports.conf = { getLiveKitToken: async () => ({ livekitUrl: "wss://fictional.invalid", token: "fictional" }) };';
  const css = await postcss([tailwind({ ...require('../tailwind.config'), content: [{ raw: Object.values(modules).join('\n'), extension: 'jsx' }] })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><head><title>Fictional conference UI verification</title></head><body><div id="root"></div></body></html>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addStyleTag({ content: `${css.css}\nhtml,body,#root {height:100%;} body{font-family:Arial,sans-serif;background:#020617;}` });
    for (const [name, file] of [['react', 'react.development.js'], ['react-dom', 'react-dom.development.js']]) {
      await page.addScriptTag({ path: path.join(path.dirname(require.resolve(`${name}/package.json`)), 'umd', file) });
    }
    await page.evaluate(() => { window.react = window.React; });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('lucide-react/package.json')), 'dist/umd/lucide-react.js') });
    await page.evaluate((sources) => {
      const cache = {};
      const events = Object.fromEntries(['ConnectionStateChanged', 'ParticipantConnected', 'ParticipantDisconnected', 'ConnectionQualityChanged', 'AudioPlaybackStatusChanged', 'TrackSubscribed', 'TrackUnsubscribed', 'TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'Disconnected'].map((name) => [name, name]));
      class FictionalRoom {
        constructor() {
          this.handlers = {}; this.state = 'connected'; this.canPlaybackAudio = false; this.remoteParticipants = new Map();
          this.localParticipant = { identity: 'fictional-user', name: 'Fictional participant', connectionQuality: 'good', trackPublications: new Map(), isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false };
          for (const [method, key] of [['setMicrophoneEnabled', 'isMicrophoneEnabled'], ['setCameraEnabled', 'isCameraEnabled'], ['setScreenShareEnabled', 'isScreenShareEnabled']]) this.localParticipant[method] = async (value) => { this.localParticipant[key] = value; };
          window.fixtureRoom = this;
        }
        on(event, handler) { (this.handlers[event] ||= []).push(handler); return this; }
        emit(event, ...args) { for (const handler of this.handlers[event] || []) handler(...args); }
        removeAllListeners() { this.handlers = {}; }
        async connect() { this.emit('ConnectionStateChanged', 'connected'); }
        async disconnect() { this.state = 'disconnected'; }
        async startAudio() { this.canPlaybackAudio = true; this.emit('AudioPlaybackStatusChanged'); }
        async switchActiveDevice() { return true; }
      }
      const predefined = { react: window.React, 'livekit-client': { Room: FictionalRoom, RoomEvent: events, Track: { Source: {} } }, 'lucide-react': window.LucideReact };
      window.requireFixture = (id) => {
        if (predefined[id]) return predefined[id];
        if (cache[id]) return cache[id].exports;
        if (!sources[id]) throw new Error(`Missing fixture module ${id}`);
        const loaded = { exports: {} }; cache[id] = loaded;
        new Function('require', 'module', 'exports', sources[id])(window.requireFixture, loaded, loaded.exports);
        return loaded.exports;
      };
      window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
      window.mountFixture = (name, props = {}) => window.fixtureRoot.render(window.React.createElement('div', { style: name === 'MediaPreflight' ? { maxWidth: 448, margin: 'auto', padding: 16 } : { height: '100%' } }, window.React.createElement(window.requireFixture(name).default, props)));
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.captureRequests = []; window.capturedTracks = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => { window.captureRequests.push(constraints); const stream = await original(constraints); window.capturedTracks.push(...stream.getTracks()); return stream; };
      window.mountFixture('MediaPreflight');
    }, modules);
    await page.getByRole('button', { name: 'Check camera', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.captureRequests.length), 0); checks.push('lobby starts without any capture request');
    await page.getByRole('button', { name: 'Check camera', exact: true }).click();
    await page.getByRole('button', { name: 'Stop camera preview', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check microphone', exact: true }).click();
    await page.getByRole('meter').waitFor(); checks.push('explicit generated camera preview and microphone meter render');
    const directory = path.join(root, 'artifacts', 'conference-media-preview'); fs.mkdirSync(directory, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(directory, `preflight-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => window.mountFixture('MediaPreflight', { enabled: false }));
    await page.waitForFunction(() => window.capturedTracks.every((track) => track.readyState === 'ended')); checks.push('joining stops every preflight capture track');
    await page.evaluate(() => window.mountFixture('LiveKitMediaPanel', { room: { id: 'fictional-room' }, displayName: 'Fictional participant', onLeave: () => { window.left = true; } }));
    await page.getByRole('button', { name: 'Enable call audio', exact: true }).click();
    await page.getByRole('button', { name: 'Enable call audio', exact: true }).waitFor({ state: 'detached' }); checks.push('autoplay recovery starts playback and clears prompt');
    assert.equal(await page.evaluate(() => window.fixtureRoom.localParticipant.isMicrophoneEnabled || window.fixtureRoom.localParticipant.isCameraEnabled), false);
    await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start camera', exact: true }).click();
    await page.getByRole('button', { name: 'Stop camera', exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureRoom.localParticipant.connectionQuality = 'poor'; window.fixtureRoom.emit('ConnectionQualityChanged'); });
    await page.getByRole('button', { name: 'Turn off my video', exact: true }).click();
    await page.getByRole('button', { name: 'Start camera', exact: true }).waitFor(); checks.push('explicit mic/camera controls and poor-network camera-off recovery');
    await page.evaluate(() => { window.fixtureRoom.state = 'reconnecting'; window.fixtureRoom.emit('ConnectionStateChanged', 'reconnecting'); });
    assert.equal(await page.getByRole('button', { name: 'Mute microphone', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.fixtureRoom.state = 'connected'; window.fixtureRoom.emit('ConnectionStateChanged', 'connected'); });
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).waitFor(); checks.push('capture controls are disabled during reconnect');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(directory, `conference-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Leave call', exact: true }).click();
    await page.waitForFunction(() => window.left === true); checks.push('leave disconnects the room; desktop/mobile have no horizontal overflow');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify({ passed: checks, browserErrors: errors, limitations: ['Fictional SFU events', 'Chromium-generated devices', 'No real network or clinical validation'] }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, artifacts: directory }, null, 2));
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
