'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const patientId = '00000000-0000-4000-8000-000000000002';
const providerId = '00000000-0000-4000-8000-000000000003';
function fixture({ status = 'scheduled', enrichmentFails = false, notification, persistenceFails = false, scopeDenied = false } = {}) {
  const filename = path.resolve(__dirname, '../routes/appointments.js'), actual = createRequire(filename), routes = new Map();
  const router = {}; for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) router[method] = (p, ...handlers) => routes.set(`${method} ${p}`, handlers.at(-1));
  const state = { row: { id: '00000000-0000-4000-8000-000000000001', patient_id: patientId, provider_id: providerId, status, scheduled_at: new Date('2030-01-01T12:00:00Z'), duration_minutes: 30, reservation_revision: '1' }, writes: 0, notifications: 0, notificationValues: [], warnings: 0 };
  const db = { async query(sql, values = []) {
    if (/SELECT \*, xmin|SELECT \* FROM appointments WHERE id/.test(sql)) return { rows: [{ ...state.row }] };
    if (/SELECT id, first_name, last_name FROM users/.test(sql)) return { rows: [{ id: providerId }] };
    if (/SELECT id FROM appointments/.test(sql)) return { rows: [] };
    if (/SELECT id, email, first_name, last_name, role FROM users/.test(sql)) {
      if (enrichmentFails) throw new Error('Synthetic enrichment outage');
      return { rows: [] };
    }
    if (/INSERT INTO appointments/.test(sql)) { if (persistenceFails) throw new Error('Synthetic persistence failure'); state.writes++; return { rows: [{ ...state.row }] }; }
    if (/UPDATE appointments/.test(sql)) {
      if (persistenceFails) throw new Error('Synthetic persistence failure');
      state.writes++; state.row = { ...state.row, status: /status = 'cancelled'/.test(sql) ? 'cancelled' : values[0], cancellation_reason: /status = 'cancelled'/.test(sql) ? values[1] : state.row.cancellation_reason };
      return { rows: [{ ...state.row }] };
    }
    if (/INSERT INTO notifications/.test(sql)) { state.notifications++; state.notificationValues.push(values); if (notification) return notification(); throw new Error('Synthetic notification outage'); }
    throw new Error(`Unexpected synthetic SQL: ${sql}`);
  } };
  const dependencies = {
    express: { Router: () => router }, '../db': db,
    '../middleware/logger': { info() {}, error() {}, warn() { state.warnings++; } },
    '../middleware/auth': { authenticate() {}, requireRole: () => () => {} },
    '../middleware/accessControl': { requirePaidAccess() {} }, '../middleware/audit': { auditMiddleware: () => () => {} },
    '../middleware/financialRecordScope': { patientFinancialAccess: async (_user, id) => !scopeDenied && id === patientId },
    '../services/notifications': { sendAppointmentNotification: async () => { state.notifications++; throw new Error('Synthetic notification outage'); } },
    '../services/testingAccessService': { getUserTestingAccess: async () => ({ testingBypassActive: false }) },
    '../services/telehealthSessionService': {}, '../services/email': { sendAppointmentNotification: async () => {} },
    // Reservation itself is separately DB-tested. This fixture executes the real
    // HTTP handler after a synthetic successful reservation callback.
    '../services/appointmentReservationService': { withProviderReservation: async (_db, _input, operation) => operation(db) },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => dependencies[name] || actual(name), module: mod, exports: mod.exports, console, process });
  async function call(key, body, role = 'patient') {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await routes.get(key)({ params: { id: state.row.id }, body, user: { id: role === 'patient' ? patientId : providerId, role, marketScope: 'NG' } }, res);
    return res;
  }
  return { state, call };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('actual cancel handler returns saved cancellation despite notification outage; replay does not notify again', async () => {
  const f = fixture(); const saved = await f.call('post /:id/cancel', { reason: 'Synthetic cancellation' });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.appointment.status, 'cancelled'); assert.equal(saved.body.dispatch.status, 'scheduled');
  await flush(); assert.equal(f.state.warnings, 1);
  const retry = await f.call('post /:id/cancel', { reason: 'Synthetic cancellation' });
  assert.equal(retry.statusCode, 200); assert.equal(retry.body.deduplicated, true); assert.equal(retry.body.dispatch.status, 'not_repeated');
  assert.equal(f.state.writes, 1); assert.equal(f.state.notifications, 1); assert.equal(retry.body.refunded, undefined);
  const conflict = await f.call('post /:id/cancel', { reason: 'Different intent' }); assert.equal(conflict.statusCode, 409);
});
test('saved cancellation does not wait for pending notification; late failure is contained', async () => {
  let reject; const pending = new Promise((_resolve, fail) => { reject = fail; });
  const f = fixture({ notification: () => pending });
  const result = await f.call('post /:id/cancel', {});
  assert.equal(result.statusCode, 200); reject(new Error('Synthetic late outage')); await flush(); assert.equal(f.state.warnings, 1);
});
test('actual status update preserves saved response and unchanged status retry leaves timestamp and notifications alone', async () => {
  const f = fixture(); const saved = await f.call('put /:id', { status: 'confirmed' }, 'provider');
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.appointment.status, 'confirmed'); await flush();
  const retry = await f.call('put /:id', { status: 'confirmed' }, 'provider');
  assert.equal(retry.body.deduplicated, true); assert.equal(f.state.writes, 1); assert.equal(f.state.notifications, 1);
});
test('actual create handler preserves 201 saved appointment when postcommit enrichment fails', async () => {
  const f = fixture({ enrichmentFails: true });
  const result = await f.call('post /', { providerId, scheduledAt: '2030-01-01T12:00:00Z', durationMinutes: 30, type: 'video', reasonForVisit: 'Synthetic appointment' });
  assert.equal(result.statusCode, 201); assert.equal(result.body.success, true); assert.equal(result.body.dispatch.status, 'scheduled');
  await flush(); assert.equal(f.state.writes, 1); assert.equal(f.state.warnings, 1);
});

test('persistence failure still returns failure and schedules no notification', async () => {
  const f = fixture({ persistenceFails: true });
  const result = await f.call('post /:id/cancel', {});
  assert.equal(result.statusCode, 500); assert.equal(result.body.success, false);
  await flush(); assert.equal(f.state.writes, 0); assert.equal(f.state.notifications, 0);
});
test('patient clinical-status changes and completed cancellation remain denied', async () => {
  const f = fixture();
  assert.equal((await f.call('put /:id', { status: 'confirmed' })).statusCode, 403);
  assert.equal(f.state.writes, 0);
  const completed = fixture({ status: 'completed' });
  assert.equal((await completed.call('post /:id/cancel', {})).statusCode, 400);
  assert.equal(completed.state.writes, 0); assert.equal(completed.state.notifications, 0);
});

test('same-status replay still enforces current patient/market scope before returning a saved record', async () => {
  const f = fixture({ status: 'confirmed', scopeDenied: true });
  const response = await f.call('put /:id', { status: 'confirmed' }, 'admin');
  assert.equal(response.statusCode, 403); assert.equal(response.body.appointment, undefined);
  assert.equal(f.state.writes, 0); assert.equal(f.state.notifications, 0);
});

test('cancellation preserves clinical reason in appointment but never copies it to routine notification', async () => {
  const secret = 'SYNTHETIC private clinical cancellation narrative';
  const f = fixture({ notification: async () => ({ rows: [] }) });
  const result = await f.call('post /:id/cancel', { reason: secret });
  await flush();
  assert.equal(result.statusCode, 200);
  assert.equal(f.state.row.cancellation_reason, secret);
  assert.equal(f.state.notificationValues.length, 1);
  assert.ok(!JSON.stringify(f.state.notificationValues).includes(secret));
  assert.match(f.state.notificationValues[0][1], /cancelled/);
});
