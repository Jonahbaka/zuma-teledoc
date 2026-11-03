'use strict';

// A PostgreSQL DATE is a civil date, not an instant. Callers must project DATE
// fields as YYYY-MM-DD (to_char) before they cross the pg date parser boundary.
// Keep the existing inclusive-date, next-midnight-UTC expiry policy unchanged.
function sqlDateEndUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return NaN;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
  return date.getTime() + 24 * 60 * 60 * 1000;
}
module.exports = { sqlDateEndUtc };
