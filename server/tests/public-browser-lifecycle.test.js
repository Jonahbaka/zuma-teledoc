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
const names = ['waitFor', 'availablePort', 'stopOwnedPreview'];
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source));
assert.equal(functions.length, names.length);
const isolated = { exports: {} };
vm.runInNewContext(functions.join('\n') + '\nmodule.exports={waitFor,availablePort,stopOwnedPreview};', {
  module: isolated, assert, fetch, AbortSignal, Buffer, URL, Date, setTimeout, clearTimeout, process, net,
  spawn() { throw new Error('Tests must explicitly scope their simulated owned process.'); },
});
const { waitFor, availablePort, stopOwnedPreview } = isolated.exports;
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
