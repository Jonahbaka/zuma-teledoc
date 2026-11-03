'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { scheduleNotificationRows, PROVIDER_SCHEDULE_QUERY } = require('../services/appointmentOperationalData');
const id = '00000000-0000-4000-8000-000000000001';
const secret = 'SYNTHETIC CLINICAL NARRATIVE';
const row = { id, provider_id: id, scheduled_at: '2030-01-01T12:00:00Z', duration_minutes: 30, status: 'confirmed', patient_notes: secret, reason_for_visit: secret, cancellation_reason: secret, protected_payload: secret, metadata: { intake: secret } };
function load(relative, deps, environment = process.env) {
  const filename = path.resolve(__dirname, relative), actual = createRequire(filename), mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => deps[name] || actual(name), module: mod, exports: mod.exports, process: { env: environment }, console, setTimeout, clearTimeout, setInterval, clearInterval });
  return mod.exports;
}
test('scheduling projection rejects narratives, nested data and malformed fields', () => {
  assert.deepEqual(scheduleNotificationRows([row]), [{ id, provider_id: id, scheduled_at: '2030-01-01T12:00:00.000Z', duration_minutes: 30, status: 'confirmed' }]);
  assert.deepEqual(scheduleNotificationRows(secret), []);
  assert.deepEqual(scheduleNotificationRows({ [id]: [row] }), []);
  assert.deepEqual(scheduleNotificationRows([{ ...row, provider_id: secret, scheduled_at: secret, duration_minutes: secret, status: secret }]), [{ id }]);
});
test('real workflow runtime overrides persisted clinical SQL and sanitizes historical notify input', async () => {
  const calls = [];
  const { WorkflowPipeline, DEFAULT_WORKFLOWS } = load('../services/agent-orchestrator/run-loop.js', { '../../db': { query: async (...args) => { calls.push(args); return { rows: [row] }; } }, './persistent-memory': {} });
  for (const name of ['provider.schedule.prep', 'provider.schedule.reminder']) {
    const workflow = new WorkflowPipeline({ name });
    const fetched = await workflow.executeQuery({ query: 'SELECT * FROM appointments', params: [secret] });
    assert.equal(calls.at(-1)[0], PROVIDER_SCHEDULE_QUERY);
    assert.equal(JSON.stringify(calls.at(-1)[1]), '[]');
    assert.ok(!JSON.stringify(fetched).includes(secret));
    await workflow.executeNotify({ name: 'Schedule' }, [row]);
    assert.ok(!JSON.stringify(calls.at(-1)[1]).includes(secret));
    assert.ok(calls.at(-1)[1][1].includes(id));
  }
  const builtIn = DEFAULT_WORKFLOWS.find(w => w.name === 'provider.schedule.prep');
  assert.equal(builtIn.steps[0].query, PROVIDER_SCHEDULE_QUERY);
  const skill = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../services/agent-orchestrator/skills-library/provider-schedule-reminder.skill.json')));
  assert.equal(skill.steps[0].query, PROVIDER_SCHEDULE_QUERY);
});
test('actual response bridge emits cancellation IDs without narrative or false booking/replay', async () => {
  const events = [];
  const bridge = load('../services/agent-orchestrator/app-nerve-bridge.js', { './index': { eventBus: { emit: async (...args) => events.push(args) } } });
  function respond(method, body, url = "/api/appointments/" + id + "/cancel") {
    const req = { method, originalUrl: url, user: { id, role: 'patient' } };
    const res = { statusCode: 200, json: value => value };
    bridge.middleware()(req, res, () => {}); res.json(body);
  }
  const body = { success: true, appointment: { id, patientId: id, status: 'cancelled', cancellationReason: secret } };
  respond('POST', body); respond('PUT', body);
  assert.equal(events.filter(e => e[0] === 'patient.appointment.cancelled').length, 2);
  assert.equal(events.filter(e => e[0] === 'patient.appointment.booked').length, 0);
  assert.ok(!JSON.stringify(events).includes(secret));
  respond('POST', { ...body, deduplicated: true });
  assert.equal(events.length, 2);
  respond('POST', { appointment: { id, status: 'confirmed' } }, '/api/appointments/' + id + '/join');
  assert.equal(events.filter(e => e[0] === 'patient.appointment.booked').length, 0);
  respond('POST', { appointment: { id, status: 'confirmed' } }, '/api/appointments?source=test');
  respond('POST', { appointment: { id, status: 'confirmed' } }, '/api/appointments/smart-book');
  assert.equal(events.filter(e => e[0] === 'patient.appointment.booked').length, 2);
});
test('Nova appointment reminder never calls a model or copies clinical/profile narratives', async () => {
  const notifications = []; let modelCalls = 0;
  const api = load('../services/agentNotificationService.js', {
    '@anthropic-ai/sdk': class { constructor() { this.messages = { create: async () => { modelCalls++; throw new Error('Model must not be called'); } }; } },
    '../db': { query: async sql => ({ rows: /SELECT u.first_name/.test(sql) ? [{ first_name: 'Test', role: 'patient' }] : /SELECT known_facts/.test(sql) ? [{ known_facts: [secret] }] : [] }) },
    '../middleware/logger': { info() {}, warn() {} },
    './notifications': { createNotification: async value => notifications.push(value) }
  }, { ANTHROPIC_API_KEY: 'synthetic-not-a-real-key' });
  await api.sendAppointmentReminderFromNova(row, id);
  assert.equal(modelCalls, 0); assert.equal(notifications.length, 1);
  assert.ok(!JSON.stringify(notifications).includes(secret));
  assert.match(notifications[0].message, /Sign in/);
});
