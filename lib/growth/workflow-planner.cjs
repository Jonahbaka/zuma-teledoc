// A local planning calculation, not a claim about measured product outcomes.
function estimateAdministrativeTime({ enquiries, minutes, targetPercent }) {
  for (const value of [enquiries, minutes, targetPercent]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  }
  if (!Number.isInteger(enquiries) || enquiries < 0 || enquiries > 10000 || minutes < 0 || minutes > 120 || targetPercent < 0 || targetPercent > 100) return null;
  const baselineHours = enquiries * minutes / 60;
  return { baselineHours, targetHours: baselineHours * targetPercent / 100 };
}
module.exports = { estimateAdministrativeTime };
