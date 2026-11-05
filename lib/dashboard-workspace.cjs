const ACTIVE_APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed', 'in_progress']);
const LEGACY_ARRIVAL_WINDOW_MS = 2 * 60 * 60 * 1000;

// Shared appointments have already passed the server's visibility rules.
// Do not hide a late arrival by applying a second future-only filter here.
function selectWorkspaceAppointments(rows, now = Date.now(), limit = 8) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.id && ACTIVE_APPOINTMENT_STATUSES.has(row.status))
    .filter((row) => !row.legacy || row.status === 'in_progress' || new Date(row.scheduledAt).getTime() >= now - LEGACY_ARRIVAL_WINDOW_MS)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rank = (row) => row.status === 'in_progress' ? 0 : new Date(row.scheduledAt).getTime() <= now ? 1 : 2;
      const priority = rank(a.row) - rank(b.row);
      if (priority) return priority;
      const distance = Math.abs(new Date(a.row.scheduledAt).getTime() - now) - Math.abs(new Date(b.row.scheduledAt).getTime() - now);
      return Number.isFinite(distance) && distance !== 0 ? distance : a.index - b.index;
    })
    .slice(0, limit)
    .map(({ row }) => row);
}

function noteSigningStatus(note) {
  if (note?.isSigned === true || note?.is_signed === true) return 'Signed';
  if (note?.isSigned === false || note?.is_signed === false) return 'Unsigned';
  if (note?.signedAt || note?.signed_at || note?.status === 'signed') return 'Signed';
  if (['draft', 'unsigned'].includes(note?.status)) return 'Unsigned';
  return 'Status not recorded';
}

function workspaceCount(section, loading) {
  if (loading) return '…';
  if (section?.error || !Array.isArray(section?.rows)) return 'Unavailable';
  return section.rows.length;
}

module.exports = { selectWorkspaceAppointments, noteSigningStatus, workspaceCount };
