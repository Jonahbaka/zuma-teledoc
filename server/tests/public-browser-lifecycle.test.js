'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

// Load the actual harness lifecycle functions without running a browser,
// importing its database, or changing environment/account data.
const filename = path.resolve(__dirname, '../../scripts/e2e-public-platform.cjs');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ['waitFor', 'availablePort', 'stopOwnedPreview', 'waitForRenderedPage', 'boundedOperation', 'settle', 'closeBrowserContext', 'closeOwnedBrowser'];
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source));
assert.equal(functions.length, names.length);
const isolated = { exports: {} };
vm.runInNewContext(functions.join('\n') + '\nmodule.exports={' + names.join(',') + '};', {
  module: isolated, assert, fetch, AbortSignal, Buffer, URL, Date, setTimeout, clearTimeout, process, net,
  spawn() { throw new Error('Tests must explicitly scope their simulated owned process.'); },
});
const { waitFor, availablePort, stopOwnedPreview, waitForRenderedPage, boundedOperation, settle, closeBrowserContext, closeOwnedBrowser } = isolated.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('cold preview readiness drains the real streamed HTML rather than returning at response headers', async () => {
  let finish; let sent;
  const headers = new Promise(resolve => { sent = resolve; });
  const { server, url } = await listen((_req, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.write('<html><body><main>Compiling');
    finish = () => response.end('</main></body></html>'); sent();
  });
  let ready = false;
  try {
    const waiting = waitFor(url, { timeoutMs: 3000, requireMain: true }).then(result => { ready = true; return result; });
    await headers; await turn(); assert.equal(ready, false, 'Headers and a partial main cannot release the browser');
    finish(); const result = await waiting;
    assert.equal(result.status, 200); assert.ok(result.bytes > 0); assert.equal(ready, true);
  } finally { finish?.(); await close(server); }
});

test('late Next error documents and HTTP compilation failures fail preparation once without hiding errors in retries', async () => {
  for (const status of [200, 500]) {
    let calls = 0;
    const { server, url } = await listen((_req, response) => {
      calls++; response.writeHead(status, { 'Content-Type': 'text/html' });
      response.write('<html id="__next_error__"><body>');
      setImmediate(() => response.end('Unexpected end of JSON input</body></html>'));
    });
    try {
      await assert.rejects(waitFor(url, { timeoutMs: 3000 }), status === 200 ? /Next error document/ : /HTTP 500/);
      assert.equal(calls, 1, 'A compile failure is retained, not retried until it disappears');
    } finally { await close(server); }
  }
});

test('incomplete HTML, malformed metadata and an already occupied preview port cannot be treated as ready', async () => {
  const { server, url } = await listen((request, response) => { response.writeHead(200); response.end(request.url === '/metadata' ? '{' : '<html><main>Incomplete'); });
  try {
    await assert.rejects(waitFor(url, { timeoutMs: 3000, requireMain: true }), /did not finish/);
    await assert.rejects(waitFor(url + '/metadata', { timeoutMs: 3000, format: 'json' }), /JSON/);
    await assert.rejects(availablePort(url), { code: 'EADDRINUSE' });
    await assert.rejects(waitFor(url, { child: { exitCode: 1, signalCode: null } }), /Owned Next preview exited/);
  } finally { await close(server); }
});

test('POSIX cleanup targets the owned process group and waits for close before releasing preview resources', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 43210, exitCode: null, signalCode: null });
  const signals = []; let stopped = false; let alive = true;
  const pending = stopOwnedPreview(child, { platform: 'linux', graceMs: 1000, signalGroup: (pid, signal) => {
    if (!alive) throw Object.assign(new Error('Owned group exited'), { code: 'ESRCH' });
    if (signal !== 0) signals.push([pid, signal]);
  } }).then(() => { stopped = true; });
  await turn(); assert.equal(stopped, false); assert.deepEqual(signals, [[-43210, 'SIGTERM']]);
  alive = false; child.emit('close', 0); await pending; assert.equal(stopped, true);
});

test('a slow owned group is forcibly closed only after the graceful bound and Windows targets only its owned PID tree', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 43211, exitCode: null, signalCode: null });
  const signals = []; let alive = true;
  await stopOwnedPreview(child, { platform: 'linux', graceMs: 5, signalGroup: (pid, signal) => {
    if (!alive) throw Object.assign(new Error('Owned group exited'), { code: 'ESRCH' });
    if (signal !== 0) signals.push([pid, signal]);
    if (signal === 'SIGKILL') { alive = false; setImmediate(() => child.emit('close', 0)); }
  } });
  assert.deepEqual(signals, [[-43211, 'SIGTERM'], [-43211, 'SIGKILL']]);
  const windowsChild = Object.assign(new EventEmitter(), { pid: 43212, exitCode: null, signalCode: null });
  const commands = [];
  await stopOwnedPreview(windowsChild, { platform: 'win32', graceMs: 1000, spawnImpl: (command, args, options) => {
    commands.push({ command, args: [...args], hidden: options.windowsHide }); const killer = new EventEmitter();
    setImmediate(() => { windowsChild.emit('close', 0); killer.emit('close', 0); }); return killer;
  } });
  assert.deepEqual(commands, [{ command: 'taskkill', args: ['/PID', '43212', '/T', '/F'], hidden: true }]);
});

test('an exited or closed POSIX launcher does not hide a surviving owned Next worker group', async () => {
  for (const leaderExited of [true, false]) {
    const child = Object.assign(new EventEmitter(), { pid: 43213, exitCode: leaderExited ? 1 : null, signalCode: null });
    let alive = true; let probes = 0; const signals = [];
    await stopOwnedPreview(child, { platform: 'linux', graceMs: 5, signalGroup: (pid, signal) => {
      assert.equal(pid, -43213);
      if (!alive) throw Object.assign(new Error('Owned worker group exited'), { code: 'ESRCH' });
      if (signal === 0) { probes++; return; }
      signals.push(signal);
      if (signal === 'SIGTERM') { child.exitCode = 0; child.emit('close', 0); }
      if (signal === 'SIGKILL') alive = false;
    } });
    assert.equal(alive, false); assert.ok(probes > 1); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  }
});

function renderedDocument(pathname = '/pharmacies') {
  const state = { title: '', titles: [], titleParent: 'BODY', animations: [], frames: 0, resourceFrames: 0, fontsReady: Promise.resolve(), images: [], mainWaits: [], evaluations: 0, scroll: { left: 0, top: 0 }, scrollRestores: [] };
  const document = {
    get title() { return state.title; },
    fonts: { get ready() { return state.fontsReady; } },
    get images() { return state.images; },
    querySelectorAll(selector) { assert.equal(selector, 'title'); return state.titles.map(textContent => ({ textContent, namespaceURI: 'http://www.w3.org/1999/xhtml', parentElement: { tagName: state.titleParent } })); },
    getAnimations() { return state.animations; },
  };
  const page = {
    url: () => 'http://127.0.0.1' + pathname,
    async waitForFunction(callback, argument, options) { state.mainWaits.push({ callback, argument, options }); },
    evaluate(callback, argument) {
      state.evaluations++;
      return vm.runInNewContext('(' + callback.toString() + ')(argument)', {
        document, location: { pathname }, argument, setTimeout, clearTimeout,
        get scrollX() { return state.scroll.left; }, get scrollY() { return state.scroll.top; },
        window: { scrollTo(options) { state.scroll = { left: options.left, top: options.top }; state.scrollRestores.push({ ...state.scroll, behavior: options.behavior }); } },
        requestAnimationFrame(callback) { return setTimeout(() => { if (argument?.expectedTitle) state.frames++; else state.resourceFrames++; callback(); }, 5); },
        cancelAnimationFrame: clearTimeout,
      });
    },
  };
  return { state, page };
}

test('render readiness waits for independent route metadata and naturally completed finite motion before its single audit', async () => {
  const { state, page } = renderedDocument();
  const animation = { playState: 'running', pending: false, effect: { getComputedTiming: () => ({ endTime: 200 }) }, cancel() { assert.fail('Motion must not be disabled'); }, finish() { assert.fail('Motion must complete naturally'); } };
  state.animations = [animation];
  let ready = false;
  const waiting = waitForRenderedPage(page, { timeoutMs: 1000 }).then(value => { ready = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ready, false, 'Rendered content cannot stand in for its missing streamed metadata');
  state.title = 'Pharmacy directory | DoctaRx | DoctaRx'; state.titles = [state.title];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ready, false, 'An active finite transition must still finish');
  animation.playState = 'finished';
  const result = await waiting;
  assert.equal(result.title, state.title); assert.equal(result.titles[0].parent, 'BODY'); assert.equal(result.finiteAnimations.length, 0); assert.ok(state.frames >= 3);
  assert.equal(animation.playState, 'finished');
});

test('permanently absent or wrong route titles fail bounded readiness without creating metadata or suppressing Axe', async () => {
  for (const initialTitle of ['', 'United States Telehealth | DoctaRx']) {
    const { state, page } = renderedDocument();
    state.title = initialTitle; state.titles = initialTitle ? [initialTitle] : [];
    await assert.rejects(waitForRenderedPage(page, { timeoutMs: 45 }), /Rendered-page readiness timed out:.*titles/);
    assert.equal(state.title, initialTitle, 'The harness must never manufacture a passing title');
  }
  await assert.rejects(waitForRenderedPage(renderedDocument('/unlisted-route').page), /explicit rendered-page title contract/);
});

test('stuck finite transitions fail rather than being skipped while unchanged infinite decorative motion remains allowed', async () => {
  const { state, page } = renderedDocument();
  state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title];
  state.animations = [{ playState: 'running', effect: { getComputedTiming: () => ({ endTime: 200 }) } }];
  await assert.rejects(waitForRenderedPage(page, { timeoutMs: 45 }), /Rendered-page readiness timed out:.*finiteAnimations.*running/);
  state.animations = [{ playState: 'running', effect: { getComputedTiming: () => ({ endTime: Infinity }) } }];
  const result = await waitForRenderedPage(page, { timeoutMs: 1000 });
  assert.equal(result.finiteAnimations.length, 0); assert.equal(state.animations[0].playState, 'running');
});

test('both ordinary head metadata and Next 15 streamed body metadata are valid while duplicate titles remain a failure', async () => {
  const { state, page } = renderedDocument('/');
  state.title = 'DoctaRx | Connected Virtual Care'; state.titles = [state.title]; state.titleParent = 'HEAD';
  assert.equal((await waitForRenderedPage(page, { timeoutMs: 1000 })).titles[0].parent, 'HEAD');
  state.titleParent = 'BODY';
  assert.equal((await waitForRenderedPage(page, { timeoutMs: 1000 })).titles[0].parent, 'BODY');
  state.titles.push(state.title);
  await assert.rejects(waitForRenderedPage(page, { timeoutMs: 45 }), /Rendered-page readiness timed out:.*titles/);
  assert.equal(state.titles.length, 2, 'Duplicate metadata must be retained as failure evidence, never removed by the harness');
});

test('bounded operations execute once, retain successful results and preserve the failing operation as the labelled cause', async () => {
  let calls = 0;
  const value = { rendered: true };
  assert.equal(await boundedOperation('Healthy resource preparation', async () => { calls++; return value; }, { timeoutMs: 100 }), value);
  assert.equal(calls, 1);
  const original = new Error('Original browser protocol failure');
  await assert.rejects(boundedOperation('Provider context preparation', async () => { calls++; throw original; }, { timeoutMs: 100 }), error => {
    assert.match(error.message, /Provider context preparation/);
    assert.match(error.message, /Original browser protocol failure/);
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(calls, 2, 'A failed operation must never be retried until its failure disappears');
});

test('a never-resolving context close fails within its explicit bound without calling close twice', async () => {
  let calls = 0;
  const context = { close() { calls++; return new Promise(() => {}); } };
  const started = Date.now();
  await assert.rejects(closeBrowserContext(context, 'US desktop', { timeoutMs: 20 }), error => {
    assert.match(error.message, /US desktop context close/);
    assert.match(error.message, /20|timed?\s*out|timeout/i);
    assert.equal(error.contextCleanupFailed, true);
    return true;
  });
  assert.equal(calls, 1); assert.ok(Date.now() - started < 1000, 'A hung browser context must not stall the entire validation run');
});

test('an immediate context-close failure retains its route label and original failure evidence', async () => {
  const original = new Error('Context transport disconnected');
  await assert.rejects(closeBrowserContext({ close: async () => { throw original; } }, 'NG mobile', { timeoutMs: 100 }), error => {
    assert.match(error.message, /NG mobile context close/);
    assert.match(error.message, /Context transport disconnected/);
    assert.equal(error.cause, original);
    return true;
  });
});

test('context cleanup cannot replace an earlier page failure with only its shutdown error', async () => {
  const priorError = new Error('Original page render failure'); const closeError = new Error('Context shutdown failure');
  await assert.rejects(closeBrowserContext({ close: async () => { throw closeError; } }, 'US desktop', { timeoutMs: 100, priorError }), error => {
    assert.equal(error.contextCleanupFailed, true); assert.equal(error.name, 'AggregateError');
    assert.ok(error.errors.includes(priorError));
    assert.ok(error.errors.some(failure => failure.cause === closeError || failure === closeError));
    return true;
  });
});

test('fonts and image decoding have independent bounded failure evidence without skipping rendered-page checks', async () => {
  for (const pendingResource of ['fonts', 'image']) {
    const { state, page } = renderedDocument();
    state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title];
    if (pendingResource === 'fonts') state.fontsReady = new Promise(() => {});
    let decodeCalls = 0;
    state.images = [{ scrollIntoView() {}, getAttribute: () => '/pending-resource.png', decode() { decodeCalls++; return pendingResource === 'image' ? new Promise(() => {}) : Promise.resolve(); } }];
    const started = Date.now();
    await assert.rejects(settle(page, { resourceTimeoutMs: 20 }), error => {
      assert.match(error.message, /font|image|resource/i);
      assert.match(error.message, /20|timed?\s*out|timeout/i);
      return true;
    });
    assert.ok(Date.now() - started < 1000, 'Resource preparation must terminate with a recorded failure');
    assert.equal(state.mainWaits.length, 1); assert.equal(state.mainWaits[0].options.timeout, 90000);
    assert.equal(state.frames, 0, 'Timed-out resources must not advance into an allegedly rendered capture');
    assert.equal(state.evaluations, 1, 'A hanging resource operation must run once rather than be retried');
    assert.equal(decodeCalls, pendingResource === 'fonts' ? 0 : 1);
    assert.equal(state.title, 'Pharmacy directory | DoctaRx'); assert.equal(state.titles.length, 1);
  }
});

test('healthy resource preparation preserves the ordinary main, title and natural-motion render contract', async () => {
  const { state, page } = renderedDocument();
  state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title];
  let decodeCalls = 0;
  state.images = [{ scrollIntoView() {}, getAttribute: () => '/healthy-resource.png', decode: async () => { decodeCalls++; } }];
  const result = await settle(page, { resourceTimeoutMs: 1000 });
  assert.equal(result.title, state.title); assert.equal(result.finiteAnimations.length, 0);
  assert.equal(decodeCalls, 1); assert.equal(state.mainWaits.length, 1);
  assert.equal(state.mainWaits[0].argument, null); assert.equal(state.mainWaits[0].options.timeout, 90000);
  assert.match(state.mainWaits[0].callback.toString(), /Finding your device location/);
  assert.ok(state.frames >= 3); assert.equal(state.evaluations, 2);
});

test('offscreen lazy images decode after ordinary scrolling and restore the original position without attribute changes', async () => {
  const { state, page } = renderedDocument();
  state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title]; state.scroll = { left: 31, top: 417 };
  let visible = false; let decodeCalls = 0; let eagerMutations = 0; let releaseOffscreen; let decodedOffscreen = false;
  const scrolls = [];
  const image = Object.freeze({
    currentSrc: 'https://images.example.invalid/below-fold.png',
    get loading() { return 'lazy'; }, set loading(_value) { eagerMutations++; assert.fail('Native image loading must remain unchanged'); },
    setAttribute() { eagerMutations++; assert.fail('The harness must not rewrite image attributes'); },
    removeAttribute() { eagerMutations++; assert.fail('The harness must not remove image attributes'); },
    scrollIntoView(options) { visible = true; scrolls.push({ ...options }); state.scroll = { left: 0, top: 1900 }; releaseOffscreen?.(); },
    decode() { decodeCalls++; return visible ? Promise.resolve() : new Promise(resolve => { releaseOffscreen = resolve; }); },
  });
  const pending = image.decode().then(() => { decodedOffscreen = true; });
  await turn(); assert.equal(decodedOffscreen, false, 'The original offscreen decode must remain pending before scrolling');
  state.images = [image];
  const rendered = await settle(page, { resourceTimeoutMs: 1000 }); await pending;
  assert.equal(decodedOffscreen, true); assert.equal(decodeCalls, 2); assert.equal(eagerMutations, 0); assert.equal(image.loading, 'lazy');
  assert.deepEqual(scrolls, [{ block: 'center', inline: 'nearest', behavior: 'instant' }]);
  assert.deepEqual(state.scroll, { left: 31, top: 417 }); assert.deepEqual(state.scrollRestores, [{ left: 31, top: 417, behavior: 'instant' }]);
  assert.equal(state.resourceFrames, 1); assert.ok(state.frames >= 3); assert.equal(rendered.title, state.title); assert.equal(state.titles.length, 1);
});

test('a pending image decode retains the exact resource diagnostic and restores scroll before its bounded failure', async () => {
  const { state, page } = renderedDocument();
  state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title]; state.scroll = { left: 11, top: 512 };
  const currentSrc = 'https://images.example.invalid/stalled-lazy-image.png'; let decodeCalls = 0;
  state.images = [Object.freeze({ currentSrc,
    scrollIntoView() { state.scroll = { left: 0, top: 2400 }; },
    setAttribute() { assert.fail('The harness must preserve lazy loading'); },
    decode() { decodeCalls++; return new Promise(() => {}); },
  })];
  await assert.rejects(settle(page, { resourceTimeoutMs: 100 }), error => {
    assert.ok(error.message.includes(currentSrc)); assert.match(error.message, /timed out/);
    assert.ok(error.cause.message.includes(currentSrc), 'Original resource diagnostics must remain available as the cause');
    return true;
  });
  assert.equal(decodeCalls, 1); assert.equal(state.evaluations, 1); assert.equal(state.frames, 0);
  assert.deepEqual(state.scroll, { left: 11, top: 512 }); assert.deepEqual(state.scrollRestores, [{ left: 11, top: 512, behavior: 'instant' }]);
});

test('an immediate decode API failure preserves its original error and restores scroll without manufacturing a rendered page', async () => {
  const { state, page } = renderedDocument();
  state.title = 'Pharmacy directory | DoctaRx'; state.titles = [state.title]; state.scroll = { left: 7, top: 91 };
  const original = new Error('Image decoder transport failed before returning a promise');
  state.images = [Object.freeze({ currentSrc: '/broken-decoder.png',
    scrollIntoView() { state.scroll = { left: 0, top: 3000 }; },
    decode() { throw original; },
  })];
  await assert.rejects(settle(page, { resourceTimeoutMs: 1000 }), error => {
    assert.equal(error.cause, original); assert.match(error.message, /Image decoder transport failed/); return true;
  });
  assert.deepEqual(state.scroll, { left: 7, top: 91 }); assert.equal(state.scrollRestores.length, 1);
  assert.equal(state.frames, 0); assert.equal(state.evaluations, 1); assert.equal(state.title, 'Pharmacy directory | DoctaRx');
});

test('browser shutdown failure kills only the explicitly owned BrowserServer and still reports the close failure', async () => {
  let closeCalls = 0; let killCalls = 0;
  const browser = { close() { closeCalls++; return new Promise(() => {}); } };
  const ownedServer = { async kill() { assert.equal(this, ownedServer); killCalls++; } };
  const started = Date.now();
  await assert.rejects(closeOwnedBrowser(browser, ownedServer, { timeoutMs: 20 }), error => {
    const failures = error.name === 'AggregateError' ? [...error.errors] : [error];
    assert.ok(failures.some(failure => /browser.*(?:close|shutdown)/i.test(failure.message)));
    assert.ok(failures.some(failure => failure.code === 'PUBLIC_BROWSER_PHASE_TIMEOUT'));
    return true;
  });
  assert.equal(closeCalls, 1); assert.equal(killCalls, 1); assert.ok(Date.now() - started < 1000);
});

test('failed owned-browser termination retains both close and kill failures instead of swallowing either', async () => {
  const closeError = new Error('Owned browser close transport failed');
  const killError = new Error('Owned BrowserServer termination failed');
  await assert.rejects(closeOwnedBrowser({ close: async () => { throw closeError; } }, { kill: async () => { throw killError; } }, { timeoutMs: 100 }), error => {
    assert.equal(error.name, 'AggregateError'); assert.equal(error.errors.length, 2);
    assert.ok(error.errors.some(failure => failure.cause === closeError || failure === closeError));
    assert.ok(error.errors.some(failure => failure.cause === killError || failure === killError));
    return true;
  });
});

test('ordinary browser shutdown succeeds once without forcing a kill', async () => {
  let closes = 0; let serverCloses = 0; let kills = 0;
  await closeOwnedBrowser({ async close() { closes++; } }, { async close() { serverCloses++; }, async kill() { kills++; } }, { timeoutMs: 100 });
  assert.equal(closes, 1); assert.equal(serverCloses, 1); assert.equal(kills, 0);
});

test('a connected browser that closes normally cannot hide a surviving owned browser server', async () => {
  let closes = 0; let serverCloses = 0; let kills = 0;
  const server = { close() { serverCloses++; return new Promise(() => {}); }, async kill() { assert.equal(this, server); kills++; } };
  await assert.rejects(closeOwnedBrowser({ async close() { closes++; } }, server, { timeoutMs: 20 }), error => {
    const failures = error.name === 'AggregateError' ? [...error.errors] : [error];
    assert.ok(failures.some(failure => /server/i.test(failure.message) && failure.code === 'PUBLIC_BROWSER_PHASE_TIMEOUT'));
    return true;
  });
  assert.equal(closes, 1); assert.equal(serverCloses, 1); assert.equal(kills, 1);
});
