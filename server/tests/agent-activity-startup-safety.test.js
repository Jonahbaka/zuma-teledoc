'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { Server: SocketIOServer } = require('socket.io');
const { backgroundWorkAllowed } = require('../utils/backgroundWorkPolicy');

const servicePath = require.resolve('../services/agentSocialService');
const originalLoad = Module._load;
let queries = [];
let missing = [];
let unavailable = false;
let service;
try {
  Module._load = function isolateDatabase(request, parent) {
    if (parent?.filename === servicePath && request === '../db') {
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          assert.match(sql, /^\s*SELECT\b/);
          assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
          if (unavailable) throw new Error('Private database connection detail');
          return { rows: missing.map(relation => ({ relation })) };
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  service = require(servicePath);
} finally {
  Module._load = originalLoad;
}

test('server restarts only check activity schema and never recreate posts or profiles', async () => {
  queries = []; missing = []; unavailable = false;
  assert.equal(await service.initialize(), true);
  assert.equal(await service.initialize(), true);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params[0], [
    'agora_profiles', 'agora_posts', 'agora_reactions', 'agora_comments',
    'agora_topics', 'agora_follows', 'agora_polls', 'agora_poll_votes',
    'agora_brainstorms', 'agora_achievements', 'agora_daily_digest',
  ]);
});

test('missing schema and connection failure never trigger a seed or delayed migration retry', async () => {
  queries = []; missing = ['agora_posts']; unavailable = false;
  assert.equal(await service.initialize(), false);
  unavailable = true;
  assert.equal(await service.initialize(), false);
  assert.equal(queries.length, 2);
});

test('candidate checks cannot start optional background initializers', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const start = source.indexOf("  if (process.env.DOCTARX_DEPLOY_CHECK !== 'true') {");
  const end = source.indexOf('  // 404 for API', start);
  assert.ok(start >= 0 && end > start);
  const startup = source.slice(start, end);
  for (const name of ['predictiveEngine.initialize', 'agentOrchestrator.initialize', 'startAgentWorker', 'financialService.initialize', 'agentSocialService.initialize', 'nemoClawService.initialize', 'crmService.initialize']) {
    assert.ok(startup.includes(name), 'startup guard must cover ' + name);
  }
  for (const env of [{ DOCTARX_DEPLOY_CHECK: 'true' }]) {
    assert.equal(backgroundWorkAllowed(env), false);
    await vm.runInNewContext(`(async () => { ${startup} })()`, {
      process: { env }, backgroundWorkAllowed: () => backgroundWorkAllowed(env),
      console: { log() {} },
      require() { assert.fail('disabled startup must not load any optional initializer'); },
    });
  }
  assert.equal(backgroundWorkAllowed({}), true, 'ordinary deployment behavior is preserved');
  assert.match(source, /DOCTARX_DEPLOY_CHECK === 'true'[\s\S]*Deployment readiness check only/);
  assert.match(source, /const HOST = process\.env\.DOCTARX_DEPLOY_CHECK === 'true' \? '127\.0\.0\.1' : '0\.0\.0\.0'/);
});

test('discovery bootstrap does not schedule work in a candidate check process', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../ng/routes/index.js'), 'utf8');
  const start = source.indexOf('function scheduleDiscoverySeed()');
  const end = source.indexOf('\nscheduleDiscoverySeed();', start);
  assert.ok(start >= 0 && end > start);
  for (const env of [{ DOCTARX_DEPLOY_CHECK: 'true' }, { DISABLE_SCHEDULERS: 'true' }]) {
    vm.runInNewContext(`let discoverySeedScheduled = false; ${source.slice(start, end)}; scheduleDiscoverySeed();`, {
      process: { env }, backgroundWorkAllowed: () => backgroundWorkAllowed(env),
      setTimeout() { assert.fail('candidate bootstrap must not schedule seed work'); },
      require() { assert.fail('candidate bootstrap must not load a seed'); },
    });
  }
});

test('candidate middleware permits readiness probes and refuses application traffic', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const start = source.indexOf('// Early warmup guard:');
  const end = source.indexOf('/**\n * Initialize all services', start);
  assert.ok(start >= 0 && end > start);
  let middleware;
  vm.runInNewContext(source.slice(start, end), {
    app: { use(handler) { middleware = handler; } },
    process: { env: { DOCTARX_DEPLOY_CHECK: 'true' } },
    initialized: true, nextReady: true, handle() {},
  });
  for (const requestPath of ['/health', '/readyz', '/api/health', '/api/ng/health', '/', '/api/social/queue', '/api/deploy']) {
    let next = false, status = null;
    const response = { status(code) { status = code; return this; }, json() { return this; } };
    middleware({ path: requestPath }, response, () => { next = true; });
    const readiness = ['/health', '/readyz', '/api/health', '/api/ng/health'].includes(requestPath);
    assert.equal(next, readiness, requestPath);
    assert.equal(status, readiness ? null : 503, requestPath);
  }
});

test('candidate startup does not expose Engine.IO or attach OpenClaw or voice PCM upgrade handlers', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const start = source.indexOf('// Initialize Socket.io for real-time chat');
  const end = source.indexOf('// Minimal health check', start);
  assert.ok(start >= 0 && end > start);
  for (const candidate of [true, false]) {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Deployment readiness check only' }));
    });
    let io, socketInitializations = 0, adapterInitializations = 0, voiceInitializations = 0;
    const realtimeContext = {
      server, process: { env: { DOCTARX_DEPLOY_CHECK: String(candidate) } },
      console: { log() {}, error() {} },
      require(name) {
        if (name === './services/socketService') return { initializeSocket(target) {
          socketInitializations += 1;
          io = new SocketIOServer(target, { serveClient: false });
        } };
        if (name === './routes/openclawAdapter') return { initOpenClawAdapter(target) {
          adapterInitializations += 1;
          target.on('upgrade', () => {});
        } };
        if (name === './middleware/auth') return { authenticate() {} };
        if (name === './services/voice/voicePcmRuntime') return { createVoicePcmRuntime({ httpServer }) {
          voiceInitializations += 1;
          assert.equal(httpServer, server);
          httpServer.on('upgrade', () => {});
          return { close: async () => {} };
        } };
        assert.fail('Unexpected realtime startup dependency: ' + name);
      },
    };
    vm.runInNewContext(source.slice(start, end), realtimeContext);
    assert.equal(socketInitializations + adapterInitializations + voiceInitializations, 0,
      'defining realtime startup must not attach handlers before migration verification');
    vm.runInNewContext('initializeRealtime()', realtimeContext);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=polling`);
      const body = await response.text();
      assert.equal(response.status, candidate ? 503 : 200);
      assert.equal(socketInitializations, candidate ? 0 : 1);
      assert.equal(adapterInitializations, candidate ? 0 : 1);
      assert.equal(voiceInitializations, candidate ? 0 : 1);
      if (candidate) {
        assert.equal(server.listenerCount('upgrade'), 0);
        assert.doesNotMatch(body, /"sid"/);
      } else {
        assert.match(body, /^0\{"sid"/);
      }
    } finally {
      if (io) await new Promise(resolve => io.close(resolve));
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
});

test('agent runtime worker refuses candidate and scheduler-disabled starts before timer creation', () => {
  const filename = path.resolve(__dirname, '../services/agent-runtime/runtime.js');
  const source = fs.readFileSync(filename, 'utf8');
  for (const env of [{ DOCTARX_DEPLOY_CHECK: 'true' }, { DISABLE_SCHEDULERS: 'true' }]) {
    const isolated = { exports: {} };
    vm.runInNewContext(source, {
      module: isolated, exports: isolated.exports, process: { env },
      setInterval() { assert.fail('disabled agent must not allocate a poll timer'); },
      require(name) {
        if (name === '../../utils/backgroundWorkPolicy') return { backgroundWorkAllowed: () => backgroundWorkAllowed(env) };
        if (name === '../../utils/workAdmissionBarrier') return require('../utils/workAdmissionBarrier');
        if (name === '../../utils/runtimeStatePolicy') return { immutableRuntime: () => false };
        return {};
      },
    }, { filename });
    assert.equal(isolated.exports.startAgentWorker().running, false);
  }
});

test('candidate route loading cannot trigger billed LLM verification even with configured credentials', async () => {
  const filename = path.resolve(__dirname, '../services/agent-orchestrator/gemini-llm.js');
  const source = fs.readFileSync(filename, 'utf8');
  const isolated = { exports: {} };
  let constructed = 0, providerCalls = 0;
  class FictionalProvider {
    constructor() {
      constructed += 1;
      this.messages = { async create() { providerCalls += 1; return { content: [{ text: 'online' }] }; } };
    }
    getGenerativeModel() { return { async generateContent() { providerCalls += 1; return { response: { text: () => 'online' } }; } }; }
  }
  vm.runInNewContext(source, {
    module: isolated, exports: isolated.exports,
    process: { env: { DOCTARX_DEPLOY_CHECK: 'true', ANTHROPIC_API_KEY: 'sk-ant-fictional-test', GEMINI_API_KEY: 'fictional-test' } },
    console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (name === '@google/generative-ai') return { GoogleGenerativeAI: FictionalProvider };
      if (name === '@anthropic-ai/sdk') return FictionalProvider;
      assert.fail('Unexpected dependency: ' + name);
    },
  }, { filename });
  assert.equal(isolated.exports.initialize(), false);
  await Promise.resolve();
  assert.equal(constructed, 0);
  assert.equal(providerCalls, 0);
});

test('social publisher preserves queued records and refuses fabricated receipts without IO', async () => {
  const filename = path.resolve(__dirname, '../services/socialSchedulerService.js');
  const source = fs.readFileSync(filename, 'utf8');
  const isolated = { exports: {} };
  vm.runInNewContext(source, {
    module: isolated, exports: isolated.exports, console: { log() {}, error() {} },
    setInterval() { assert.fail('unavailable publisher must not poll'); },
    require() { assert.fail('unavailable publisher must not access storage or a provider'); },
  }, { filename });
  const scheduler = isolated.exports;
  assert.equal(scheduler.start().isRunning, false);
  assert.equal(scheduler.getStatus().publishingAvailable, false);
  await scheduler.checkQueue();
  await assert.rejects(scheduler.publishPost({ id: 'fictional-post', platforms: ['linkedin'] }), { code: 'SOCIAL_PUBLISHING_UNAVAILABLE', status: 503 });
  for (const platform of ['tiktok', 'instagram', 'youtube', 'twitter', 'facebook', 'linkedin']) {
    await assert.rejects(scheduler.callPlatformPublisher(platform, { id: 'fictional-post' }, {}), { code: 'SOCIAL_PUBLISHING_UNAVAILABLE', status: 503 });
  }
});

async function socialRouteFixture() {
  const filename = path.resolve(__dirname, '../routes/social.js');
  const sourceModule = { exports: {} }, routes = new Map(), middleware = [], sqlCalls = [];
  const router = { use(handler) { middleware.push(handler); } };
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (route, ...handlers) => routes.set(`${method} ${route}`, [...middleware, ...handlers]);
  }
  const db = { pool: { async query(sql, params) {
    sqlCalls.push({ sql, params });
    if (sql.includes('SELECT * FROM social_posts')) return { rowCount: 1, rows: [{
      id: 'fictional-post', title: 'FICTIONAL_PRIVATE_TEXT', platforms: ['linkedin'], retry_count: 0,
    }] };
    if (sql.includes('SELECT * FROM social_accounts')) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ title: 'FICTIONAL_PRIVATE_TEXT', scheduled_time: '2099-01-01' }] };
  } } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sourceModule, exports: sourceModule.exports, process: { env: {} },
    console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../db') return db;
      if (name === '../db/verifyRouteSchema') return require('../db/verifyRouteSchema');
      if (name === '../services/socialSchedulerService') return require('../services/socialSchedulerService');
      if (name === '../middleware/auth') return { authenticate(req, res, next) {
        return req.user ? next() : res.status(401).json({ success: false, error: 'Authentication required' });
      } };
      assert.fail('Unexpected route dependency or provider: ' + name);
    },
  }, { filename });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sqlCalls, [], 'importing a route must not access or mutate the database');
  return { sqlCalls, async invoke(route, authenticated = true) {
    let result;
    const request = { user: authenticated ? { id: 'fictional-user' } : undefined,
      params: { id: 'fictional-post' }, body: { scheduledTime: '2099-01-01', platforms: ['linkedin'] } };
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { result = { status: this.statusCode, body }; return this; } };
    const handlers = routes.get(`post ${route}`);
    assert.ok(handlers?.length, 'actual route must be registered');
    let position = 0;
    const next = async () => { if (position < handlers.length) await handlers[position++](request, response, next); };
    await next();
    return result;
  } };
}

for (const route of ['/post/:id/publish-now', '/post/:id/schedule', '/post/:id/retry']) {
  test(`unavailable social action ${route} refuses before account/target access or record changes`, async () => {
    const fixture = await socialRouteFixture();
    const result = await fixture.invoke(route);
    assert.equal(result.status, 503);
    assert.equal(result.body.success, false);
    assert.equal(result.body.code, 'SOCIAL_PUBLISHING_UNAVAILABLE');
    assert.deepEqual(fixture.sqlCalls, []);
    assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_PRIVATE_TEXT|https:|platform_post_id|published_at/);
  });
  test(`unavailable social action ${route} retains authentication before refusal`, async () => {
    const fixture = await socialRouteFixture();
    const result = await fixture.invoke(route, false);
    assert.equal(result.status, 401);
    assert.deepEqual(fixture.sqlCalls, []);
  });
}
