const { noteSigningStatus } = require('./dashboard-workspace.cjs');

function uniqueRecords(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row || !row.id) return false;
    const key = `${row.legacy ? 'legacy' : 'shared'}:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Calendar buckets use the viewer's local days, including DST boundaries.
// Aggregate only authorized rows returned to this account; never extrapolate.
function appointmentSeries(rows, now = new Date(), days = 7) {
  const start = new Date(now);
  if (!Number.isFinite(start.getTime())) throw new TypeError('A valid current date is required');
  if (![7, 14].includes(days)) throw new RangeError('Supported periods are 7 or 14 days');
  start.setHours(0, 0, 0, 0);
  const series = Array.from({ length: days }, (_, index) => {
    const date = new Date(start); date.setDate(date.getDate() + index);
    return { key: dayKey(date), day: date.getDate(), weekday: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date), label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date), count: 0 };
  });
  const buckets = new Map(series.map(item => [item.key, item]));
  let undated = 0, outsideRange = 0;
  for (const row of uniqueRecords(rows)) {
    const value = row.scheduledAt || row.scheduled_at;
    const date = value ? new Date(value) : new Date(NaN);
    if (!Number.isFinite(date.getTime())) { undated++; continue; }
    const bucket = buckets.get(dayKey(date));
    if (bucket) bucket.count++; else outsideRange++;
  }
  return { series, total: series.reduce((sum, item) => sum + item.count, 0), undated, outsideRange };
}

function appointmentStatuses(rows) {
  const labels = { scheduled: 'Scheduled', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', no_show: 'no show' };
  const tones = ['blue', 'violet', 'rose', 'blue', 'slate', 'amber'];
  const result = Object.entries(labels).map(([key, label], index) => ({ key, label, tone: tones[index], count: 0 }));
  result.push({ key: 'other', label: 'Other / not recorded', tone: 'slate', count: 0 });
  for (const row of uniqueRecords(rows)) (result.find(item => item.key === row.status) || result[result.length - 1]).count++;
  return result;
}

function documentationDistribution(rows) {
  const result = [{ label: 'Signed', tone: 'violet', count: 0 }, { label: 'Unsigned', tone: 'amber', count: 0 }, { label: 'Status not recorded', tone: 'slate', count: 0 }];
  for (const row of uniqueRecords(rows)) result.find(item => item.label === noteSigningStatus(row)).count++;
  return result;
}

function consultationDistribution(rows) {
  const result = [{ key: 'video', label: 'Video', tone: 'blue', count: 0 }, { key: 'phone', label: 'Phone', tone: 'violet', count: 0 }, { key: 'other', label: 'Other / not recorded', tone: 'slate', count: 0 }];
  for (const row of uniqueRecords(rows)) (result.find(item => item.key === row.type) || result[2]).count++;
  return result;
}

module.exports = { uniqueRecords, appointmentSeries, appointmentStatuses, documentationDistribution, consultationDistribution };
