'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const { isLegacyCreatorAssetPath } = require('../../lib/legacyCreatorAssets.cjs');
const creatorAssetGuard = require('../middleware/creatorAssetGuard');

const root = path.resolve(__dirname, '../..');
const endpoints = [
  ['POST', '/submit-video'], ['POST', '/auto-generate'], ['POST', '/publish'],
  ['POST', '/schedule'], ['GET', '/content'], ['GET', '/analytics'], ['GET', '/queue'],
];

function loadCreatorRoute() {
  const isolated = { exports: {} }, dependencies = [], actors = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server/routes/creator.js'), 'utf8'), {
    module: isolated, exports: isolated.exports,
    // No process, filesystem, timers, DB, credentials or publisher is available.
    require(name) {
      dependencies.push(name);
      if (name === 'express') return express;
      if (name === '../middleware/auth') return { authenticate(req, res, next) {
        const token = req.headers.authorization;
        if (!['Bearer fictional-owner', 'Bearer fictional-other-owner'].includes(token)) {
          return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
        }
        req.user = { id: token.slice(7) };
        actors.push(req.user.id);
        return next();
      } };
      assert.fail('Creator must not access storage, providers, secrets, paths or background jobs: ' + name);
    },
  }, { filename: 'server/routes/creator.js' });
  return { router: isolated.exports, dependencies, actors };
}

async function serve(t, app) {
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (method, requestPath, { body, token, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port, method, path: requestPath,
      headers: { ...headers, ...(token ? { Authorization: token } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text,
        json: () => JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(data);
  });
}

test('every creator operation requires authentication, then reports unavailable without private data or fake receipts', async t => {
  const fixture = loadCreatorRoute();
  const app = express(); app.use(express.json()); app.use('/api/creator', fixture.router);
  const request = await serve(t, app);
  for (const [method, endpoint] of endpoints) {
    for (const token of [undefined, 'Bearer invalid', 'Bearer expired', 'Bearer fictional-owner', 'Bearer fictional-other-owner']) {
      const response = await request(method, '/api/creator' + endpoint, {
        token, body: { videoId: 'video_another_user', fileName: 'fictional.mp4', title: 'FICTIONAL_PRIVATE_TITLE',
          description: 'FICTIONAL_PRIVATE_DESCRIPTION', transcription: 'FICTIONAL_PRIVATE_TRANSCRIPT',
          platforms: ['linkedin'], scheduledTime: '2099-01-01T00:00:00Z', userId: 'forged-owner' },
      });
      const authenticated = token?.startsWith('Bearer fictional-');
      assert.equal(response.status, authenticated ? 503 : 401, `${method} ${endpoint} (${token})`);
      assert.equal(response.json().success, false);
      assert.equal(response.json().code, authenticated ? 'CREATOR_UNAVAILABLE' : 'AUTH_REQUIRED');
      assert.match(response.headers['cache-control'], /no-store/);
      assert.doesNotMatch(response.text, /FICTIONAL_PRIVATE|postId|publishedTo|https:\/\/|videoId|totalViews|content":|queue":/);
    }
  }
  assert.deepEqual(fixture.dependencies, ['express', '../middleware/auth']);
  assert.equal(fixture.actors.length, endpoints.length * 2);
});

test('missing, malformed and traversal inputs cannot cause metadata IO or false successful operations', async t => {
  const fixture = loadCreatorRoute();
  const app = express(); app.use(express.json()); app.use('/api/creator', fixture.router);
  const request = await serve(t, app);
  const bodies = [undefined, {}, { videoId: '../../victim' }, { videoId: '/etc/fictional' },
    { videoId: '..\\..\\victim' }, { videoId: '%2e%2e%2f%2e%2e%2fvictim' },
    { videoId: { toString: 'malformed' }, platforms: 'linkedin' },
    { videoId: ['../../victim'], platforms: [null, {}], scheduledTime: 'not-a-date' }];
  for (const endpoint of ['/submit-video', '/auto-generate', '/publish', '/schedule']) {
    for (const body of bodies) {
      const response = await request('POST', '/api/creator' + endpoint, { body, token: 'Bearer fictional-owner' });
      assert.equal(response.status, 503);
      assert.equal(response.json().code, 'CREATOR_UNAVAILABLE');
      assert.doesNotMatch(response.text, /victim|etc|ENOENT|EACCES|TypeError|SyntaxError/);
    }
  }
  // Future/unknown endpoints and methods cannot fall through to a live writer.
  for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await request(method, '/api/creator/future-operation', { token: 'Bearer fictional-owner' })).status, 503);
  }
});

const blockedPaths = [
  '/uploads/creator', '/uploads/creator/', '/uploads/creator/video_owner.json',
  '/uploads/creator/video_owner.json?download=1', '/uploads/creator/video_owner.mp4',
  '/uploads/creator/missing.json', '/uploads/CREATOR/video_owner.json',
  '/uploads/%63reator/video_owner.json', '/%75ploads/creator/video_owner.json',
  '/uploads%2fcreator%2fvideo_owner.json', '/%75ploads%2f%63reator/video_owner.json',
  '/uploads/%2563reator/video_owner.json', '/uploads/creator%2fvideo_owner.json',
  '/uploads/other/../creator/video_owner.json', '/uploads/other/%2e%2e/creator/video_owner.json',
  '//uploads//creator/video_owner.json', '/uploads\\creator\\video_owner.json',
  '/uploads/creator/%invalid',
  'http://localhost/uploads/creator/video_owner.json',
  'https://localhost/uploads/%63reator/video_owner.json',
  'http://localhost/other/../uploads/creator/video_owner.json',
];
const allowedPaths = ['/health', '/api/creator/content', '/uploads/credentialing/fictional.pdf',
  '/uploads/creator-other/video_owner.json', '/uploads/other.json?file=/uploads/creator/video_owner.json', '/favicon.ico'];

test('legacy creator asset path policy covers normalized, encoded, malformed-suffix and sibling paths', () => {
  for (const value of blockedPaths) assert.equal(isLegacyCreatorAssetPath(value), true, value);
  for (const value of allowedPaths) assert.equal(isLegacyCreatorAssetPath(value), false, value);
});

test('custom server denies historical public/Express creator files before static reads and does not delete them', async t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-creator-safety-'));
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  const publicRoot = path.join(fixtureRoot, 'public'), uploadsRoot = path.join(fixtureRoot, 'uploads');
  const payload = 'FICTIONAL_HISTORICAL_PRIVATE_METADATA';
  for (const directory of [path.join(publicRoot, 'uploads/creator'), path.join(uploadsRoot, 'creator')]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'video_owner.json'), payload);
  }
  fs.writeFileSync(path.join(uploadsRoot, 'ordinary.txt'), 'ordinary-upload');
  const app = express(); let downstream = 0;
  app.use(creatorAssetGuard);
  app.use((_req, _res, next) => { downstream += 1; next(); });
  app.use('/uploads', express.static(uploadsRoot)); app.use(express.static(publicRoot));
  const request = await serve(t, app);
  for (const requestPath of blockedPaths) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(method, requestPath, { headers: { Range: 'bytes=0-8' } });
      assert.equal(response.status, 404, `${method} ${requestPath}`);
      assert.equal(response.text, '');
      assert.match(response.headers['cache-control'], /no-store/);
    }
  }
  assert.equal(downstream, 0, 'no static handler may inspect a blocked request');
  const ordinary = await request('GET', '/uploads/ordinary.txt');
  assert.equal(ordinary.status, 200); assert.equal(ordinary.text, 'ordinary-upload');
  for (const directory of [path.join(publicRoot, 'uploads/creator'), path.join(uploadsRoot, 'creator')]) {
    assert.equal(fs.readFileSync(path.join(directory, 'video_owner.json'), 'utf8'), payload);
  }
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  const guardAt = server.indexOf("app.use(require('./middleware/creatorAssetGuard'))");
  assert.ok(guardAt > 0 && guardAt < server.indexOf('app.listen('), 'guard is installed before listening or initialization');
  assert.ok(guardAt < server.indexOf("app.use('/uploads'"));
  assert.ok(guardAt < server.indexOf('return handle(req, res)'));
});

test('standalone Next middleware enforces the same denial before public files while preserving other requests', async () => {
  const ts = require('typescript');
  const nextServer = require('next/server');
  const source = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const isolated = { exports: {} };
  vm.runInNewContext(compiled, { module: isolated, exports: isolated.exports, require(name) {
    if (name === 'next/server') return nextServer;
    if (name === './lib/legacyCreatorAssets.cjs') return { isLegacyCreatorAssetPath };
    if (name === './lib/seo/public-seo-config.cjs') return require('../../lib/seo/public-seo-config.cjs');
    assert.fail('Unexpected Next middleware dependency: ' + name);
  } });
  assert.equal(isolated.exports.config.matcher, '/:path*', 'encoded protected prefixes must still invoke middleware');
  for (const requestPath of blockedPaths) {
    const result = isolated.exports.middleware({ url: 'https://doctarx.com' + requestPath, nextUrl: { pathname: requestPath.split('?')[0] } });
    assert.equal(result.status, 404, requestPath);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(await result.text(), '');
  }
  for (const requestPath of allowedPaths) {
    assert.equal(isolated.exports.middleware({ url: 'https://doctarx.com' + requestPath, nextUrl: { pathname: requestPath.split('?')[0] } }).headers.get('x-middleware-next'), '1');
  }
});
