'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), WebSocket = require('ws');
const { Server } = require('socket.io'), { io } = require('socket.io-client');
const { claimBoundedUpgrade, installBoundedUpgradeCleanup } = require('../services/boundedUpgradeRouting');
const { initOpenClawAdapter } = require('../routes/openclawAdapter');
test('actual Socket.IO and OpenClaw remain functional with bounded foreign upgrade cleanup', { timeout: 6000 }, async t => {
  const server = http.createServer((_req, res) => res.end('fictional'));
  const sockets = new Server(server, { destroyUpgrade: false }), adapter = initOpenClawAdapter(server); installBoundedUpgradeCleanup(server);
  sockets.on('connection', socket => socket.emit('fixture:ready', true));
  let client, raw;
  t.after(async () => { client?.disconnect(); raw?.terminate(); for (const ws of adapter.clients) ws.terminate(); await new Promise(resolve => adapter.close(resolve)); await new Promise(resolve => sockets.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  client = io(base, { transports: ['websocket'], reconnection: false, timeout: 2000 });
  assert.equal(await new Promise((resolve, reject) => { client.once('fixture:ready', resolve); client.once('connect_error', reject); }), true);
  raw = new WebSocket(base.replace('http:', 'ws:') + '/openclaw'); raw.on('error', () => {});
  assert.ok((await new Promise((resolve, reject) => { raw.once('message', value => resolve(JSON.parse(value))); raw.once('error', reject); })).nonce);
  raw.send(JSON.stringify({ type: 'req', id: 'fictional', method: 'connect', params: {} })); assert.equal((await new Promise(resolve => raw.once('message', value => resolve(JSON.parse(value))))).ok, false);
});
test('bounded owner cannot exempt a socket forever and duplicate claims are rejected', async () => {
  const request = {}, socket = { destroyed: 0, on() {}, destroy() { this.destroyed++; } };
  const release = claimBoundedUpgrade(request, socket, 20); assert.throws(() => claimBoundedUpgrade(request, socket, 20));
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(socket.destroyed, 1); release();
  for (const timeout of [0, 5001, Infinity]) assert.throws(() => claimBoundedUpgrade({}, socket, timeout));
});
test('released bounded ownership cannot later destroy an accepted socket', async () => {
  const socket = { destroyed: 0, on() {}, destroy() { this.destroyed++; } }, release = claimBoundedUpgrade({}, socket, 20);
  release(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(socket.destroyed, 0);
});
test('application installs both coordinated cleanup and disabled-default PCM runtime', () => {
  const fs = require('node:fs'), service = fs.readFileSync(require.resolve('../services/socketService'), 'utf8'), index = fs.readFileSync(require.resolve('../index'), 'utf8');
  assert.match(service, /destroyUpgrade: false/); assert.match(service, /installBoundedUpgradeCleanup\(httpServer\)/);
  assert.match(index, /createVoicePcmRuntime\(\{[\s\S]*?httpServer: server[\s\S]*?env: process.env\s*\}\)/);
  const configured = index.slice(index.indexOf('voicePcmRuntime = require'), index.indexOf('Voice PCM evaluation is unavailable.'));
  assert.doesNotMatch(configured, /composition:|readCredential|createClient|readApprovalSnapshot/);
  assert.match(index, /if \(voicePcmRuntime\) await voicePcmRuntime.close\(\);[\s\S]*?if \(db\) await db.close\(\)/);
});
