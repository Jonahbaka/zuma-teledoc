#!/usr/bin/env node
'use strict';
// Standalone local developer tool. Never imported by the application server.
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const webpack = require('webpack');
const ROOT = path.join(__dirname, 'voice-local-demo');
async function buildDemoAssets() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'doctarx-generated-voice-'));
  try {
    await new Promise((resolve, reject) => {
      const compiler = webpack({ mode: 'development', target: 'web', devtool: false, cache: false, entry: path.join(ROOT, 'browser.cjs'),
        output: { path: directory, filename: 'client.js' }, optimization: { minimize: false }, performance: { hints: false } });
      compiler.run((error, stats) => compiler.close(closeError => {
        if (error || closeError || stats?.hasErrors()) reject(new Error('Local voice demo bundle could not be built.'));
        else resolve();
      }));
    });
    return new Map(await Promise.all([
      ['/', path.join(ROOT, 'index.html'), 'text/html; charset=utf-8'], ['/style.css', path.join(ROOT, 'style.css'), 'text/css; charset=utf-8'],
      ['/client.js', path.join(directory, 'client.js'), 'text/javascript; charset=utf-8'],
      ['/voice/pcm-capture-worklet.js', path.join(__dirname, '../public/voice/pcm-capture-worklet.js'), 'text/javascript; charset=utf-8']
    ].map(async ([url, file, type]) => [url, { body: await fs.readFile(file), type }])));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function createLocalVoiceDemoServer({ port = 0, env = process.env, assets } = {}) {
  if (env.NODE_ENV === 'production' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('This developer demo requires a non-production loopback environment.');
  const files = assets || await buildDemoAssets(); let expectedHost;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(), camera=(), geolocation=(), display-capture=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)
      || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const file = files.get(req.url);
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length }); res.end(req.method === 'HEAD' ? undefined : file.body);
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxHeadersCount = 30;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  expectedHost = `127.0.0.1:${server.address().port}`;
  let closing;
  const close = () => { if (!closing) { closing = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); } return closing; };
  return Object.freeze({ url: `http://${expectedHost}`, close });
}
async function main() {
  if (process.argv.length !== 2) throw new Error('This local demo accepts no arguments. It always binds a random loopback port.');
  const demo = await createLocalVoiceDemoServer();
  process.stdout.write(`Generated-tone demo only. No microphone or provider connection.\nOpen on this computer: ${demo.url}\nPress Ctrl+C to stop. The server closes after 20 minutes.\n`);
  const timeout = setTimeout(() => { void demo.close(); }, 20 * 60 * 1000); timeout.unref();
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { clearTimeout(timeout); void demo.close(); });
}
if (require.main === module) main().catch(() => { process.stderr.write('The local generated-tone demo could not start. Use a non-production checkout with its existing dependencies installed.\n'); process.exitCode = 1; });
module.exports = { buildDemoAssets, createLocalVoiceDemoServer };
