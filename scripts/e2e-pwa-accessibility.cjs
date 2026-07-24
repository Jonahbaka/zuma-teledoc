#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.E2E_PWA_PORT || 3200);
const DEBUG_PORT = Number(process.env.E2E_PWA_DEBUG_PORT || 9231);
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = path.join(
  ROOT,
  'artifacts',
  'pwa-accessibility-e2e',
  new Date().toISOString().replace(/[:.]/g, '-')
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    req.setTimeout(5000, () => req.destroy(new Error(`${url} timed out`)));
    req.end();
  });
}

async function waitForHttp(url, timeoutMs = 90000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw lastError || new Error(`${url} did not become ready`);
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge was not found; set CHROME_PATH');
  return found;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.loadResolvers = [];
    this.consoleErrors = [];
    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Page.loadEventFired') {
        this.loadResolvers.splice(0).forEach((resolve) => resolve());
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(
          (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ')
        );
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
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 20000);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    return result.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await Promise.race([
      new Promise((resolve) => this.loadResolvers.push(resolve)),
      wait(15000)
    ]);
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    });
    const destination = path.join(ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(destination, Buffer.from(result.data, 'base64'));
    return destination;
  }
}

async function launchChrome() {
  const profileDir = path.join(os.tmpdir(), `doctarx-pwa-e2e-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const browser = spawn(findChromePath(), [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-insecure-localhost',
    `--unsafely-treat-insecure-origin-as-secure=${BASE_URL}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = path.join(ARTIFACT_DIR, 'chrome.log');
  browser.stdout.on('data', (chunk) => fs.appendFileSync(log, chunk));
  browser.stderr.on('data', (chunk) => fs.appendFileSync(log, chunk));

  let target;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const targets = await requestJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      target = targets.find((candidate) => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      // Chrome is still starting.
    }
    await wait(400);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome debugging target was unavailable');
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.enable();
  return { browser, client, profileDir };
}

function assertion(name, pass, actual) {
  return { name, pass: Boolean(pass), actual };
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const nextServer = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const nextLog = path.join(ARTIFACT_DIR, 'next-start.log');
  nextServer.stdout.on('data', (chunk) => fs.appendFileSync(nextLog, chunk));
  nextServer.stderr.on('data', (chunk) => fs.appendFileSync(nextLog, chunk));

  let chrome;
  const evidence = {
    environment: 'local Next.js production build in headless Chrome',
    viewport: {},
    screenshots: {},
    assertions: [],
    consoleErrors: [],
    finalResult: 'fail'
  };

  try {
    await waitForHttp(BASE_URL);
    chrome = await launchChrome();
    const { client } = chrome;
    await client.navigate(BASE_URL);
    await wait(2500);

    const desktop = await client.evaluate(`(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const manifestUrl = manifestLink ? new URL(manifestLink.href, location.href).href : null;
      const manifest = manifestUrl ? await fetch(manifestUrl).then((response) => response.json()) : null;
      const registration = await navigator.serviceWorker.ready;
      return {
        title: document.title,
        manifestUrl,
        manifest,
        serviceWorkerState: registration.active?.state || null,
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth
      };
    })()`);
    evidence.viewport.desktop = desktop;
    evidence.screenshots.desktop = await client.screenshot('desktop-home');
    evidence.assertions.push(
      assertion('manifest is linked', desktop.manifestUrl, desktop.manifestUrl),
      assertion('manifest is standalone', desktop.manifest?.display === 'standalone', desktop.manifest?.display),
      assertion('manifest has maskable icon', desktop.manifest?.icons?.some((icon) => String(icon.purpose).includes('maskable')), desktop.manifest?.icons),
      assertion('manifest has shortcuts', desktop.manifest?.shortcuts?.length > 0, desktop.manifest?.shortcuts?.length),
      assertion('service worker is active', desktop.serviceWorkerState === 'activated', desktop.serviceWorkerState),
      assertion('desktop has no horizontal overflow', desktop.scrollWidth <= desktop.width, `${desktop.scrollWidth}/${desktop.width}`)
    );

    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const keyboard = await client.evaluate(`(() => {
      const active = document.activeElement;
      const rect = active?.getBoundingClientRect();
      return {
        text: active?.textContent?.trim(),
        className: active?.className,
        visible: Boolean(rect && rect.width > 0 && rect.height > 0)
      };
    })()`);
    evidence.assertions.push(
      assertion('first keyboard target is visible skip link', keyboard.visible && /skip to main content/i.test(keyboard.text || ''), keyboard)
    );

    await client.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    const reducedMotion = await client.evaluate(`(() => {
      const probe = document.createElement('div');
      probe.className = 'animate-pulse';
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const result = { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, animationDuration: style.animationDuration };
      probe.remove();
      return result;
    })()`);
    evidence.assertions.push(
      assertion(
        'reduced motion disables animation',
        reducedMotion.matches && Number.parseFloat(reducedMotion.animationDuration) <= 0.00001,
        reducedMotion
      )
    );

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await client.navigate(BASE_URL);
    await wait(1500);
    const mobile = await client.evaluate(`({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content || null
    })`);
    evidence.viewport.mobile = mobile;
    evidence.screenshots.mobile = await client.screenshot('mobile-home');
    evidence.assertions.push(
      assertion('mobile has no horizontal overflow', mobile.scrollWidth <= mobile.width, `${mobile.scrollWidth}/${mobile.width}`),
      assertion('mobile viewport is configured', /width=device-width/i.test(mobile.viewportMeta || ''), mobile.viewportMeta)
    );
    evidence.consoleErrors = [...client.consoleErrors];
    evidence.assertions.push(
      assertion('online browser run produced no runtime errors', evidence.consoleErrors.length === 0, evidence.consoleErrors)
    );

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none'
    });
    await client.navigate(`${BASE_URL}/offline-verification-${Date.now()}`);
    await wait(2000);
    const offline = await client.evaluate(`({
      text: document.body?.innerText || '',
      url: location.href
    })`);
    evidence.assertions.push(
      assertion('offline navigation uses app fallback', /offline|connection/i.test(offline.text), offline.text.slice(0, 160))
    );
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'wifi'
    });

    await client.navigate(BASE_URL);
    await wait(1000);
    const cacheAudit = await client.evaluate(`(async () => {
      const entries = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) entries.push({ cacheName, url: request.url });
      }
      const sensitive = entries.filter(({ url }) => /\\/api\\/|\\/messages(?:\\/|$)|\\/medical-records(?:\\/|$)|\\/prescriptions(?:\\/|$)|token=/i.test(url));
      return { entries, sensitive };
    })()`);
    evidence.cacheAudit = cacheAudit;
    evidence.assertions.push(
      assertion('service-worker caches contain no protected URLs', cacheAudit.sensitive.length === 0, cacheAudit.sensitive)
    );

    evidence.finalResult = evidence.assertions.every((item) => item.pass) ? 'pass' : 'fail';
  } finally {
    if (chrome) {
      try { await chrome.client.send('Browser.close'); } catch {}
      if (!chrome.browser.killed) chrome.browser.kill();
      try { fs.rmSync(chrome.profileDir, { recursive: true, force: true }); } catch {}
    }
    if (!nextServer.killed) nextServer.kill();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'result.json'), JSON.stringify(evidence, null, 2));
  }

  console.log(`PWA_ACCESSIBILITY_E2E=${evidence.finalResult.toUpperCase()}`);
  console.log(`Evidence: ${path.join(ARTIFACT_DIR, 'result.json')}`);
  for (const item of evidence.assertions) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`);
  }
  if (evidence.finalResult !== 'pass') process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
