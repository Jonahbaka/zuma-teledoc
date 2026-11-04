'use strict';

const { patientMarketSql } = require('../middleware/financialRecordScope');

function schedulingError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

async function withProviderReservation(database, input, operation) {
  const { providerId, patientId, marketScope, scheduledAt, durationMinutes, excludeId = null, status = 'scheduled' } = input;
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 120) {
    throw schedulingError('Invalid appointment date or duration', 400, 'INVALID_APPOINTMENT');
  }
  return database.transaction(async (client) => {
    // All creation/rescheduling paths share this lock. The conflict read runs
    // after the lock, so concurrent requests recheck the committed reservation.
    const provider = await client.query(
      `SELECT u.id FROM users u WHERE u.id = $1 AND u.role = 'provider'
         AND u.provider_status = 'approved' AND u.is_active = true
         AND ${patientMarketSql('u')} = $2 FOR UPDATE`,
      [providerId, marketScope]
    );
    const patient = await client.query(
      `SELECT u.id FROM users u WHERE u.id = $1 AND u.role = 'patient' AND u.is_active = true
         AND ${patientMarketSql('u')} = $2`, [patientId, marketScope]
    );
    if (!provider.rows.length || !patient.rows.length) {
      throw schedulingError('Patient or provider is not available in this market', 404, 'APPOINTMENT_SCOPE_DENIED');
    }
    if (excludeId) {
      const current = await client.query('SELECT patient_id, provider_id, xmin::text AS reservation_revision FROM appointments WHERE id=$1 FOR UPDATE', [excludeId]);
      const row = current.rows[0];
      if (!row || row.patient_id !== patientId || row.provider_id !== providerId ||
        (input.expectedRevision && row.reservation_revision !== input.expectedRevision)) {
        throw schedulingError('The appointment changed. Refresh before making another change.', 409, 'APPOINTMENT_CHANGED');
      }
    }
    if (!['cancelled', 'completed', 'no_show'].includes(status)) {
      const conflicts = await client.query(
        `SELECT id FROM appointments WHERE provider_id = $1
           AND status NOT IN ('cancelled', 'completed', 'no_show')
           AND ($4::uuid IS NULL OR id <> $4::uuid)
           AND scheduled_at < $3
           AND scheduled_at + duration_minutes * interval '1 minute' > $2 LIMIT 1`,
        [providerId, date, new Date(date.getTime() + durationMinutes * 60000), excludeId]
      );
      if (conflicts.rows.length) throw schedulingError('Time slot is not available', 409, 'APPOINTMENT_CONFLICT');
    }
    return operation(client);
  });
}

module.exports = { withProviderReservation };
