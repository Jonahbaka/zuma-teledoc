'use strict';

// Native NG appointments use ng_providers.id, not the users.id stored in the
// shared appointment table. Keep the stores namespaced so their UUIDs cannot
// accidentally collapse and do not expose a different clinician's patients.
const appointmentsSql = `WITH clinician AS (
  SELECT u.id AS user_id,p.id AS provider_id
  FROM users u JOIN ng_providers p ON p.user_id=u.id
  WHERE u.id=$1 AND u.role='provider' AND u.is_active=TRUE
    AND u.market_scope='NG' AND u.provider_status='approved' AND p.status='verified'
), scoped_appointments AS (
  SELECT 'core:' || a.id::text AS appointment_key,a.patient_id,a.scheduled_at
  FROM appointments a JOIN clinician c ON c.user_id=a.provider_id
  UNION ALL
  SELECT 'ng:' || a.id::text AS appointment_key,a.patient_user_id AS patient_id,a.scheduled_at
  FROM ng_appointments a JOIN clinician c ON c.provider_id=a.provider_id
), patient_visits AS (
  SELECT p.id,p.first_name,p.last_name,p.email,p.phone,p.date_of_birth,p.city,p.state,
    MAX(a.scheduled_at) AS last_visit,COUNT(a.appointment_key) AS total_appointments
  FROM scoped_appointments a JOIN users p ON p.id=a.patient_id
  WHERE p.role='patient' AND p.is_active=TRUE AND p.market_scope='NG'
  GROUP BY p.id
)`;
async function listNgProviderPatients(db, actorId, { limit, offset, search = '' }) {
  if (typeof search !== 'string' || search.length > 100) throw Object.assign(new Error('Invalid patient search'), { status: 400 });
  const term = search.trim().replace(/\s+/g, ' ').toLowerCase();
  // Search only the already-authorized patient set, before count/pagination.
  // POSITION treats %, _ and apostrophes literally; user text is always bound.
  const filter = term ? " WHERE POSITION($2::text IN LOWER(CONCAT_WS(' ',first_name,last_name,email))) > 0" : '';
  const values = term ? [actorId, term] : [actorId];
  const count = await db.query(`${appointmentsSql} SELECT COUNT(*) AS count FROM patient_visits${filter}`, values);
  const result = await db.query(`${appointmentsSql} SELECT * FROM patient_visits${filter} ORDER BY id,last_visit DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
  return { rows: result.rows, total: Number(count.rows[0]?.count || 0) };
}
module.exports = { listNgProviderPatients };
