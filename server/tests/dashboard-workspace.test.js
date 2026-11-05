const test = require('node:test');
const assert = require('node:assert/strict');
const { selectWorkspaceAppointments, noteSigningStatus, workspaceCount } = require('../../lib/dashboard-workspace.cjs');
const now = Date.parse('2026-11-05T12:00:00Z');
const { appointmentSeries, appointmentStatuses, documentationDistribution, consultationDistribution } = require('../../lib/workspace-charts.cjs');
const visit = (id, minutes, extra = {}) => ({ id, status: 'confirmed', scheduledAt: new Date(now + minutes * 60000).toISOString(), ...extra });

test('dashboard preserves late shared arrivals and prioritizes active visits before future visits', () => {
  const rows = [visit('future', 30), visit('late', -15), visit('active', -60, { status: 'in_progress' }), visit('cancelled', 10, { status: 'cancelled' })];
  assert.deepEqual(selectWorkspaceAppointments(rows, now).map(row => row.id), ['active', 'late', 'future']);
  assert.equal(rows[0].id, 'future', 'selection must not mutate API state');
});
test('shared visibility remains server-owned while legacy lists have a bounded arrival window', () => {
  const rows = [visit('server-visible', -150), visit('legacy-old', -150, { legacy: true }), visit('legacy-late', -90, { legacy: true }), visit('legacy-active', -180, { legacy: true, status: 'in_progress' })];
  assert.deepEqual(selectWorkspaceAppointments(rows, now).map(row => row.id), ['legacy-active', 'legacy-late', 'server-visible']);
});
test('malformed rows, closed statuses and display limits cannot create phantom appointments', () => {
  assert.deepEqual(selectWorkspaceAppointments([null, {}, visit('closed', 1, { status: 'completed' })], now), []);
  assert.equal(selectWorkspaceAppointments([visit('a', 1), visit('b', 2)], now, 1).length, 1);
});
test('documentation uses the actual API signing boolean and does not infer unsigned from missing data', () => {
  assert.equal(noteSigningStatus({ isSigned: true }), 'Signed');
  assert.equal(noteSigningStatus({ isSigned: false }), 'Unsigned');
  assert.equal(noteSigningStatus({ isSigned: false, status: 'signed' }), 'Unsigned');
  assert.equal(noteSigningStatus({ is_signed: true }), 'Signed');
  assert.equal(noteSigningStatus({ signedAt: '2026-11-05' }), 'Signed');
  assert.equal(noteSigningStatus({}), 'Status not recorded');
});
test('loaded summaries distinguish zero results from failures or pending requests', () => {
  assert.equal(workspaceCount({ rows: [] }, false), 0);
  assert.equal(workspaceCount({ rows: [{ id: 'a' }] }, false), 1);
  assert.equal(workspaceCount({ error: true, rows: [] }, false), 'Unavailable');
  assert.equal(workspaceCount(undefined, false), 'Unavailable');
  assert.equal(workspaceCount({ rows: [] }, true), '…');
});

test('charts count authorized rows once and preserve separate shared and legacy records', () => {
  const a = visit('one', 0, { type: 'video' });
  const result = appointmentSeries([a, a, { ...a, legacy: true }, null, {}], new Date(now));
  assert.equal(result.total, 2);
  assert.equal(result.series.reduce((sum, day) => sum + day.count, 0), 2);
  assert.equal(consultationDistribution([a, a])[0].count, 1);
});

test('chart ranges use calendar boundaries, report missing dates and do not invent history', () => {
  const anchor = new Date(2026, 10, 1, 12);
  const date = days => { const d = new Date(anchor); d.setDate(d.getDate() + days); return d.toISOString(); };
  const rows = [{ id: 'today', scheduledAt: date(0) }, { id: 'tomorrow', scheduledAt: date(1) }, { id: 'later', scheduledAt: date(8) }, { id: 'past', scheduledAt: date(-1) }, { id: 'undated' }];
  const week = appointmentSeries(rows, anchor, 7);
  assert.equal(week.total, 2); assert.equal(week.outsideRange, 2); assert.equal(week.undated, 1);
  assert.equal(new Set(week.series.map(day => day.key)).size, 7);
  assert.equal(week.series[0].key, '2026-11-01'); assert.equal(week.series[6].key, '2026-11-07');
  assert.equal(appointmentSeries(rows, anchor, 14).total, 3);
  assert.throws(() => appointmentSeries(rows, anchor, 100), RangeError);
  assert.equal(appointmentSeries([], anchor).total, 0);
});

test('automatic distributions retain unknown values without assigning a clinical interpretation', () => {
  const notes = [{ id: 'a', isSigned: true }, { id: 'b', isSigned: false }, { id: 'c' }];
  assert.deepEqual(documentationDistribution(notes).map(item => item.count), [1, 1, 1]);
  assert.equal(appointmentStatuses([{ id: 'unknown', status: 'unexpected' }]).find(item => item.key === 'other').count, 1);
  assert.equal(consultationDistribution([{ id: 'unknown' }]).find(item => item.key === 'other').count, 1);
  assert.equal(notes.length, 3);
});
