'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { buildDemoAssets, createLocalVoiceDemoServer } = require('../../../scripts/voice-local-demo.cjs');
let assets;
test.before(async () => { assets = await buildDemoAssets(); });
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); req.end();
  });
}
test('actual loopback server serves bounded explicit assets with browser microphone and external connections denied', async t => {
  const demo = await createLocalVoiceDemoServer({ assets, env: { NODE_ENV: 'test' } }); t.after(demo.close);
  assert.match(demo.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const route of ['/', '/style.css', '/client.js', '/voice/pcm-capture-worklet.js']) {
    const res = await request(demo.url + route); assert.equal(res.status, 200); assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['content-security-policy'], /connect-src 'none'/); assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(res.headers['permissions-policy'], /microphone=\(\), camera=\(\)/); assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  const page = await request(demo.url); assert.match(page.text, /Generated tones, not an AI conversation/); assert.match(page.text, /not part of the deployed application/);
  const bundle = await request(demo.url + '/client.js'); assert.match(bundle.text, /createLocalDemoController/); assert.doesNotMatch(bundle.text, /sourceMappingURL=data:|eval\(/);
});
test('unknown paths, query variants, writes, other origins and rebinding hosts are rejected', async t => {
  const demo = await createLocalVoiceDemoServer({ assets, env: { NODE_ENV: 'test' } }); t.after(demo.close);
  for (const route of ['/secret', '/package.json', '/client.js?path=../../package.json', '/api/voice-pcm-evaluation']) assert.equal((await request(demo.url + route)).status, 404);
  for (const headers of [{ Host: 'example.com' }, { Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request(demo.url, { headers })).status, 403);
  assert.equal((await request(demo.url, { method: 'POST' })).status, 405); assert.equal((await request(demo.url, { method: 'HEAD' })).text, '');
  await demo.close(); await demo.close();
});
test('production and invalid ports cannot start the standalone demo', async () => {
  await assert.rejects(createLocalVoiceDemoServer({ assets, env: { NODE_ENV: 'production' } }));
  for (const port of [-1, 65536, '0', 0.5]) await assert.rejects(createLocalVoiceDemoServer({ assets, env: {}, port }));
});
test('the actual CLI serves loopback and terminates with the platform-supported SIGTERM outcome', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, [require.resolve('../../../scripts/voice-local-demo.cjs')], { env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const exited = once(child, 'exit');
  const url = await new Promise((resolve, reject) => {
    let text = ''; child.once('error', reject); child.once('exit', () => reject(new Error('Local demo exited before printing its URL.')));
    child.stdout.on('data', chunk => { text += chunk.toString(); const found = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (found) resolve(found[0]); });
  });
  assert.equal((await request(url)).status, 200); child.kill('SIGTERM');
  const [code, signal] = await exited;
  // Windows child.kill force-terminates instead of delivering a POSIX signal
  // handler. The explicit demo.close() tests above still verify graceful close.
  if (process.platform === 'win32') { assert.equal(code, null); assert.equal(signal, 'SIGTERM'); }
  else { assert.equal(code, 0); assert.equal(signal, null); }
  await assert.rejects(request(url), error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code));
});
