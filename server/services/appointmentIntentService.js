'use strict';
const { encrypt, decrypt } = require('../../lib/encryption');
const { patientMarketSql } = require('../middleware/financialRecordScope');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function bookingError(message, statusCode, code) { return Object.assign(new Error(message), { statusCode, code }); }
function canonicalIntent(data) {
  return JSON.stringify({
    category: data.category.trim(),
    specialties: (Array.isArray(data.specialties) ? data.specialties : String(data.specialties || '').split(',')).map(value => value.trim()).filter(Boolean),
    providerId: data.providerId?.toLowerCase() || null,
    scheduledAt: new Date(data.scheduledAt).toISOString(), type: data.type || 'video',
    reasonForVisit: data.reasonForVisit.trim(), patientNotes: data.patientNotes || null,
    durationMinutes: data.durationMinutes || 30,
    intake: { historyReviewed: data.intake.historyReviewed, medicationStatus: data.intake.medicationStatus, allergyStatus: data.intake.allergyStatus },
  });
}
async function withBookingIntent(database, { actor, marketScope, data }, operation) {
  const key = data.clientRequestId?.toLowerCase();
  if (key && !uuid.test(key)) throw bookingError('A valid booking request identifier is required.', 400, 'BOOKING_INTENT_INVALID');
  const canonical = canonicalIntent(data);
  return database.transaction(async client => {
    const current = await client.query(`SELECT id FROM users WHERE id=$1 AND role='patient' AND is_active=TRUE
      AND ${patientMarketSql('users')}=$2 FOR SHARE`, [actor.id, marketScope]);
    if (actor.role !== 'patient' || !current.rows.length) throw bookingError('Current patient access is required.', 403, 'BOOKING_SCOPE_DENIED');
    if (key) {
      // Serialize this actor/key even before its first row exists. A hash
      // collision only adds contention; ownership is checked by exact columns.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`appointment-intent:${actor.id}:${key}`]);
      const existing = (await client.query(`SELECT intent_envelope,appointment_id,market_scope FROM appointment_booking_intents
        WHERE actor_id=$1 AND client_request_id=$2 FOR UPDATE`, [actor.id, key])).rows[0];
      if (existing) {
        if (existing.market_scope !== marketScope) throw bookingError('The saved booking belongs to a different clinical market.', 403, 'BOOKING_SCOPE_DENIED');
        const envelope = existing.intent_envelope;
        if (decrypt(envelope.encrypted, envelope.iv, envelope.tag) !== canonical) throw bookingError('This booking request identifier already belongs to different details.', 409, 'BOOKING_INTENT_CONFLICT');
        const rows = (await client.query('SELECT * FROM appointments WHERE id=$1 AND patient_id=$2', [existing.appointment_id, actor.id])).rows;
        if (!rows.length) throw bookingError('The saved booking requires reconciliation.', 409, 'BOOKING_RECONCILIATION_REQUIRED');
        return { rows, providerId: rows[0].provider_id, provider: null, deduplicated: true };
      }
    }
    // Provider selection and reservation are in this same transaction; nested
    // reservation work uses the checked-out client rather than a second pool.
    const result = await operation({ query: (...args) => client.query(...args), transaction: fn => fn(client) });
    if (!result.rows?.[0]?.id || result.rows[0].patient_id !== actor.id) throw bookingError('Booking persistence could not be confirmed.', 500, 'BOOKING_RESULT_INVALID');
    if (key) {
      const protectedIntent = encrypt(canonical);
      await client.query(`INSERT INTO appointment_booking_intents(actor_id,client_request_id,appointment_id,intent_envelope,market_scope)
        VALUES($1,$2,$3,$4::jsonb,$5)`, [actor.id, key, result.rows[0].id, JSON.stringify(protectedIntent), marketScope]);
    }
    return { ...result, deduplicated: false };
  });
}
async function readBookingIntent(database, { actor, marketScope, clientRequestId }) {
  if (!uuid.test(String(clientRequestId || ''))) throw bookingError('A valid booking request identifier is required.', 400, 'BOOKING_INTENT_INVALID');
  return database.transaction(async client => {
    const current = await client.query(`SELECT id FROM users WHERE id=$1 AND role='patient' AND is_active=TRUE
      AND ${patientMarketSql('users')}=$2 FOR SHARE`, [actor.id, marketScope]);
    if (actor.role !== 'patient' || !current.rows.length) throw bookingError('Current patient access is required.', 403, 'BOOKING_SCOPE_DENIED');
    const row = (await client.query(`SELECT a.id,a.status,a.scheduled_at,a.provider_id FROM appointment_booking_intents i
      JOIN appointments a ON a.id=i.appointment_id AND a.patient_id=i.actor_id
      WHERE i.actor_id=$1 AND i.client_request_id=$2 AND i.market_scope=$3`, [actor.id, clientRequestId.toLowerCase(), marketScope])).rows[0];
    if (!row) throw bookingError('No saved booking was found for this request.', 404, 'BOOKING_REQUEST_NOT_FOUND');
    return { id: row.id, status: row.status, scheduledAt: row.scheduled_at, providerId: row.provider_id };
  });
}
module.exports = { withBookingIntent, readBookingIntent, canonicalIntent, bookingError };
