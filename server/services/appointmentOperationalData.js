'use strict';

// Operational summaries are not clinical records. Never forward whole appointment
// rows, including historical workflow output, into chat or notification storage.
const PROVIDER_SCHEDULE_QUERY = "SELECT a.id, a.provider_id, a.scheduled_at, a.duration_minutes, a.status FROM appointments a WHERE a.scheduled_at > NOW() AND a.scheduled_at < NOW() + INTERVAL '2 hours' AND a.status IN ('scheduled', 'confirmed')";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isProviderScheduleWorkflow = name => ['provider.schedule.prep', 'provider.schedule.reminder'].includes(name);

function scheduleNotificationRows(input) {
  // Unexpected/string/grouped historical data fails closed rather than being
  // serialized verbatim. The active query supplies a flat list of rows.
  if (!Array.isArray(input)) return [];
  return input.filter(row => row && UUID.test(row.id)).map(row => {
    const out = { id: row.id };
    if (UUID.test(row.provider_id)) out.provider_id = row.provider_id;
    const date = row.scheduled_at instanceof Date ? row.scheduled_at :
      (typeof row.scheduled_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row.scheduled_at) ? new Date(row.scheduled_at) : null);
    if (date && Number.isFinite(date.getTime())) out.scheduled_at = date.toISOString();
    if (Number.isInteger(row.duration_minutes) && row.duration_minutes > 0 && row.duration_minutes <= 1440) out.duration_minutes = row.duration_minutes;
    if (['scheduled', 'confirmed'].includes(row.status)) out.status = row.status;
    return out;
  });
}

module.exports = { PROVIDER_SCHEDULE_QUERY, isProviderScheduleWorkflow, scheduleNotificationRows };
