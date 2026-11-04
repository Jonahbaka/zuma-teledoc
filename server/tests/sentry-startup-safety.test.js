'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const sentryPath = path.join(root, 'server/middleware/sentry.js');

function loadWithStub(env = { SENTRY_DSN: 'https://public@example.invalid/1' }) {
  const calls = { init: [], setup: [], sdkLoads: 0 };
  const sdk = {
    init: (options) => calls.init.push(options),
    httpIntegration: (options) => ({ name: 'Http', options }),
    expressIntegration: () => ({ name: 'Express' }),
    onUncaughtExceptionIntegration: () => ({ name: 'OnUncaughtException' }),
    onUnhandledRejectionIntegration: () => ({ name: 'OnUnhandledRejection' }),
    setupExpressErrorHandler: (app) => calls.setup.push(app)
  };
  const context = { module: { exports: {} }, process: { env }, require: (id) => {
    if (id === '@sentry/node') { calls.sdkLoads++; return sdk; }
    return require(require.resolve(id, { paths: [path.dirname(sentryPath)] }));
  } };
  vm.runInNewContext(fs.readFileSync(sentryPath, 'utf8'), context, { filename: sentryPath });
  return { ...context.module.exports, calls, sdk };
}

test('DSN absent leaves Sentry disabled and installs no middleware', () => {
  const { initSentry, sentryErrorHandler, calls } = loadWithStub({});
  const app = { use: () => assert.fail('disabled Sentry must not add middleware') };
  assert.equal(initSentry(app).enabled, false);
  sentryErrorHandler(app);
  assert.equal(calls.init.length, 0);
  assert.equal(calls.sdkLoads, 0);
  assert.equal(calls.setup.length, 0);
});

test('installed Sentry SDK starts and captures a redacted Express error without network delivery', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Sentry = require('@sentry/node');
    const envelopes = [];
    // Intercept the underlying transport, preserving SDK and privacy filtering.
    Sentry.makeNodeTransport = () => ({
      send: (envelope) => { envelopes.push(envelope); return Promise.resolve({ statusCode: 200 }); },
      flush: () => Promise.resolve(true)
    });
    const middleware = require('./server/middleware/sentry');
    async function main() {
      const state = middleware.initSentry({ use() {} });
      assert.equal(state.enabled, true);
      const express = require('express');
      const http = require('node:http');
      const app = express();
      app.use(express.json());
      app.post('/synthetic/:patient', (req, res, next) => {
        Sentry.setUser({ id: 'synthetic-patient', email: 'synthetic-private@example.invalid' });
        Sentry.setContext('clinical', { note: 'SYNTHETIC_SECRET_NOTE' });
        Sentry.setExtra('record', 'SYNTHETIC_SECRET_NOTE');
        Sentry.addBreadcrumb({ message: 'SYNTHETIC_SECRET_NOTE' });
        Sentry.getCurrentScope().addAttachment({ filename: 'SYNTHETIC_SECRET_NOTE.txt', data: 'SYNTHETIC_SECRET_NOTE' });
        const error = new TypeError('SYNTHETIC_SECRET_NOTE');
        next(error);
      });
      app.get('/isolation/:marker', async (req, res) => {
        Sentry.getIsolationScope().setTag('synthetic-request-marker', req.params.marker);
        await new Promise(resolve => setTimeout(resolve, 20));
        res.json({ isolated: Sentry.getIsolationScope().getScopeData().tags['synthetic-request-marker'] === req.params.marker });
      });
      app.get('/expected', (req, res, next) => next(Object.assign(new Error('expected 401'), { status: 401 })));
      middleware.sentryErrorHandler(app);
      app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'safe error' }));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const request = (method, url) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: url,
          headers: { 'Content-Type': 'application/json', authorization: 'Bearer SYNTHETIC_SECRET_NOTE', cookie: 'session=SYNTHETIC_SECRET_NOTE' } }, res => {
          let body = ''; res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? JSON.stringify({ narrative: 'SYNTHETIC_SECRET_NOTE' }) : undefined);
      });
      try {
        const concurrent = await Promise.all([request('GET', '/isolation/first'), request('GET', '/isolation/second')]);
        for (const response of concurrent) assert.equal(JSON.parse(response.body).isolated, true);
        const response = await request('POST', '/synthetic/synthetic-patient?note=SYNTHETIC_SECRET_NOTE');
        assert.equal(response.status, 500);
        assert.deepEqual(JSON.parse(response.body), { error: 'safe error' });
        assert.equal((await request('GET', '/expected')).status, 401);
        assert.equal(await Sentry.flush(2000), true);
        const items = envelopes.flatMap(envelope => envelope[1]);
        assert.equal(items.filter(([headers]) => headers.type === 'event').length, 1);
        assert.equal(items.filter(([headers]) => headers.type === 'attachment').length, 0);
        const serialized = JSON.stringify(envelopes);
        for (const secret of ['SYNTHETIC_SECRET_NOTE', 'synthetic-patient', 'synthetic-private@example.invalid']) {
          assert.ok(!serialized.includes(secret), 'outgoing envelope contains ' + secret);
        }
        assert.equal(items.find(([headers]) => headers.type === 'event')[1].exception.values[0].type, 'TypeError');
        console.log('Sentry ' + require('@sentry/node/package.json').version + ': one redacted 500 event, no 401 event or attachments');
      } finally {
        await new Promise(resolve => server.close(resolve));
        await Sentry.close(2000);
      }
    }
    main().catch(async error => { console.error(error); await Sentry.close(2000); process.exitCode = 1; });
  `], { cwd: root, encoding: 'utf8', timeout: 15000, env: {
    ...process.env, SENTRY_DSN: 'https://public@example.invalid/1', SENTRY_TRACES_SAMPLE_RATE: '1', NODE_ENV: 'test'
  } });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}\n${child.error || ''}`);
  assert.match(child.stdout, /one redacted 500 event/);
});

test('SDK is initialized before Express import and captures errors before terminal JSON handler', () => {
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  assert.ok(server.indexOf('initSentry()') < server.indexOf("require('express')"));
  assert.ok(server.indexOf('initSentry()') > -1);
  assert.ok(server.indexOf('sentryErrorHandler(app)') < server.indexOf('// Global error handler'));
});

test('configuration uses current SDK handlers and disables unreviewed telemetry channels', () => {
  const { initSentry, sentryErrorHandler, calls } = loadWithStub({ SENTRY_DSN: 'https://public@example.invalid/1', SENTRY_TRACES_SAMPLE_RATE: '1' });
  assert.equal(initSentry({ use() {} }).enabled, true);
  const app = {};
  sentryErrorHandler(app);
  assert.equal(calls.setup[0], app);
  const config = calls.init[0];
  assert.equal(config.debug, false);
  assert.equal(config.sendDefaultPii, false);
  assert.equal(config.defaultIntegrations, false);
  assert.equal(config.tracesSampleRate, 0);
  assert.equal(config.enableLogs, false);
  assert.equal(config.autoSessionTracking, false);
  assert.equal(config.sendClientReports, false);
  assert.equal(config.beforeBreadcrumb({ message: 'private' }), null);
  assert.equal(config.beforeSendTransaction({ transaction: 'private' }), null);
  assert.equal(config.beforeSendLog({ body: 'private' }), null);
  assert.equal(typeof config.beforeSend, 'function');
});

const { scrubSentryEvent, createSentryPrivacyTransport } = require('../utils/sentryPrivacy');
const PRIVATE = 'SYNTHETIC_PRIVATE_NARRATIVE';
function privateEvent() {
  return {
    event_id: 'a'.repeat(32), timestamp: 1234567890, environment: PRIVATE,
    message: PRIVATE, logentry: { message: PRIVATE }, request: { url: `/patient/${PRIVATE}`, data: PRIVATE, headers: { authorization: PRIVATE }, cookies: PRIVATE },
    user: { id: PRIVATE, email: PRIVATE, ip_address: PRIVATE }, tags: { patient: PRIVATE }, extra: { note: PRIVATE },
    contexts: { clinical: { narrative: PRIVATE }, trace: { data: { note: PRIVATE } } }, breadcrumbs: [{ message: PRIVATE }],
    transaction: PRIVATE, fingerprint: [PRIVATE], server_name: PRIVATE, release: PRIVATE,
    sdkProcessingMetadata: { dynamicSamplingContext: { transaction: PRIVATE } },
    exception: { values: [{ type: 'TypeError', value: PRIVATE, mechanism: { data: { note: PRIVATE } }, stacktrace: { frames: [{
      filename: __filename, function: PRIVATE, context_line: PRIVATE, vars: { note: PRIVATE }, lineno: 7, colno: 3, in_app: true
    }, { filename: `/patient/${PRIVATE}.js`, function: PRIVATE, lineno: 1 }] } }] }
  };
}

test('PHI scrubber allows only error type and loaded relative source locations, without mutating the event', () => {
  const original = privateEvent();
  const snapshot = JSON.stringify(original);
  const hint = { attachments: [{ filename: PRIVATE, data: PRIVATE }] };
  const result = scrubSentryEvent(original, hint);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(hint.attachments, []);
  assert.equal(result.event_id, 'a'.repeat(32));
  assert.equal(result.timestamp, 1234567890);
  assert.equal(result.exception.values[0].type, 'TypeError');
  assert.deepEqual(result.exception.values[0].stacktrace.frames, [{
    filename: 'server/tests/sentry-startup-safety.test.js', lineno: 7, colno: 3, in_app: true
  }]);
  assert.deepEqual(scrubSentryEvent(result), result, 'last-mile scrub must retain already sanitized stack locations');
});

test('custom exception names, malformed events and non-error payloads fail closed', () => {
  const custom = privateEvent();
  custom.exception.values[0].type = PRIVATE;
  assert.equal(scrubSentryEvent(custom).exception.values[0].type, 'Error');
  for (const input of [null, {}, { message: PRIVATE }, { type: 'transaction', exception: { values: [{}] } }, { exception: { values: [] } }]) {
    assert.equal(scrubSentryEvent(input), null);
  }
  const hostile = { get exception() { throw new Error(PRIVATE); } };
  assert.equal(scrubSentryEvent(hostile), null);
  const event = privateEvent();
  event.event_id = PRIVATE;
  event.timestamp = PRIVATE;
  const clean = scrubSentryEvent(event);
  assert.equal(clean.event_id, undefined);
  assert.equal(clean.timestamp, undefined);
});

test('last-mile transport removes private envelope headers and all non-error payloads', async () => {
  const sent = [];
  let flushed;
  const transport = createSentryPrivacyTransport(() => ({
    send: async envelope => { sent.push(envelope); return { statusCode: 200 }; },
    flush: async timeout => { flushed = timeout; return true; }
  }))({});
  await transport.send([{ event_id: PRIVATE, trace: { transaction: PRIVATE }, arbitrary: PRIVATE }, [
    [{ type: 'event', filename: PRIVATE }, privateEvent()],
    ...['attachment', 'transaction', 'span', 'log', 'session', 'sessions', 'profile', 'profile_chunk', 'replay_event', 'replay_recording', 'check_in', 'client_report', 'feedback', 'future_type']
      .map(type => [{ type }, { data: PRIVATE }])
  ]]);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(PRIVATE));
  assert.equal(sent[0][1].length, 1);
  assert.deepEqual(Object.keys(sent[0][0]).sort(), ['event_id', 'sent_at']);
  assert.deepEqual(sent[0][1][0][0], { type: 'event' });
  assert.equal(await transport.flush(10), true);
  assert.equal(flushed, 10);
  await transport.send([{}, [[{ type: 'attachment' }, PRIVATE]]]);
  await transport.send([{}, [null]]);
  assert.equal(sent.length, 1, 'empty and malformed envelopes must not be transmitted');
});

test('transport still redacts events that bypass beforeSend', async () => {
  const sent = [];
  const transport = createSentryPrivacyTransport(() => ({ send: async envelope => { sent.push(envelope); return {}; }, flush: async () => true }))({});
  const internalError = privateEvent();
  internalError.level = 'fatal';
  internalError.exception.values[0].mechanism = { type: 'internal', handled: false, data: { note: PRIVATE } };
  await transport.send([{}, [[{ type: 'event' }, internalError]]]);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(PRIVATE));
  assert.equal(sent[0][1][0][1].exception.values[0].type, 'TypeError');
  assert.equal(sent[0][1][0][1].level, 'fatal');
  assert.deepEqual(sent[0][1][0][1].exception.values[0].mechanism, { type: 'generic', handled: false });
});

function changingProperty(target, key, safe, unsafe = PRIVATE, safeReads = 1) {
  let reads = 0;
  Object.defineProperty(target, key, { configurable: true, get: () => ++reads <= safeReads ? safe : unsafe });
  return () => reads;
}

test('transport validates and copies one snapshot of accessor-backed scalar fields', async () => {
  const event = privateEvent();
  const exception = event.exception.values[0];
  const frame = exception.stacktrace.frames[0];
  const reads = [
    changingProperty(event, 'event_id', 'b'.repeat(32), PRIVATE, 2),
    changingProperty(event, 'timestamp', 12345),
    changingProperty(exception, 'type', 'TypeError'),
    changingProperty(exception.mechanism, 'handled', false),
    changingProperty(frame, 'lineno', 3, PRIVATE, 2),
    changingProperty(frame, 'colno', 2, PRIVATE, 2),
    changingProperty(frame, 'in_app', true)
  ];
  const sent = [];
  const transport = createSentryPrivacyTransport(() => ({ send: async envelope => { sent.push(envelope); return {}; }, flush: async () => true }))({});
  await transport.send([{}, [[{ type: 'event' }, event]]]);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(PRIVATE), 'later getter results must not bypass scalar validation');
  for (const count of reads) assert.equal(count(), 1, 'each source property is read once');
  assert.equal(sent[0][1][0][1].event_id, 'b'.repeat(32));
  assert.equal(sent[0][1][0][1].exception.values[0].type, 'TypeError');
});

test('transport snapshots nested containers and does not trust source array methods', async () => {
  const event = privateEvent();
  const exception = event.exception.values[0];
  const frames = exception.stacktrace.frames;
  const values = [exception];
  const items = [[{ type: 'event' }, event]];
  const envelope = [{}, items];
  const exceptionGroup = {};
  const stacktrace = {};
  const reads = [
    changingProperty(exceptionGroup, 'values', values),
    changingProperty(stacktrace, 'frames', frames),
    changingProperty(event, 'exception', exceptionGroup),
    changingProperty(exception, 'mechanism', { handled: false }),
    changingProperty(exception, 'stacktrace', stacktrace),
    changingProperty(frames[0], 'filename', __filename),
    changingProperty(envelope, 1, items)
  ];
  values.slice = () => { throw new Error('untrusted array slice must not execute'); };
  frames.slice = () => { throw new Error('untrusted array slice must not execute'); };
  items.flatMap = () => [[{ type: 'attachment' }, PRIVATE]];
  const sent = [];
  const transport = createSentryPrivacyTransport(() => ({ send: async clean => { sent.push(clean); return {}; }, flush: async () => true }))({});
  await transport.send(envelope);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(PRIVATE));
  assert.equal(sent[0][1][0][0].type, 'event');
  for (const count of reads) assert.equal(count(), 1, 'each source container is read once');
});

test('an overridden envelope array method cannot inject an unsanitized attachment', async () => {
  const sent = [];
  const items = [[{ type: 'event' }, privateEvent()]];
  items.flatMap = () => [[{ type: 'attachment' }, PRIVATE]];
  const transport = createSentryPrivacyTransport(() => ({ send: async envelope => { sent.push(envelope); return {}; }, flush: async () => true }))({});
  await transport.send([{}, items]);
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(PRIVATE));
  assert.equal(sent[0][1][0][0].type, 'event');
});
