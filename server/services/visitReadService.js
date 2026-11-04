'use strict';

const db = require('../db');
const { references, denied } = require('./clinicalPatientAccessService');
const { readClinicalField } = require('./clinicalContentService');

const accessDenied = () => denied(403, 'CLINICAL_ACCESS_DENIED', 'This visit is unavailable in your current care context.');

async function reader(client, session) {
  const actor = (await client.query(`SELECT id,role,is_active,market_scope,provider_status
    FROM users WHERE id=$1 FOR SHARE`, [session.id])).rows[0];
  if (!actor?.is_active || actor.role !== session.role || !['US', 'NG'].includes(actor.market_scope)
    || actor.role === 'provider' && actor.provider_status !== 'approved') throw accessDenied();
  if (actor.role === 'provider' && actor.market_scope === 'NG'
    && !(await client.query("SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' FOR SHARE", [actor.id])).rows.length) throw accessDenied();
  return actor;
}

async function authorize(client, actor, record, { appointmentOnly = false } = {}) {
  if (actor.role === 'patient') {
    if (record.patient_id !== actor.id) throw accessDenied();
    return;
  }
  if (record.provider_id === actor.id) return;
  // Appointment lookup is the author's editing workflow, not a chart search.
  if (appointmentOnly) throw accessDenied();
  const relationship = await client.query(`SELECT id FROM provider_patient_relationships
    WHERE provider_id=$1 AND patient_id=$2 AND is_active=TRUE FOR SHARE`, [actor.id, record.patient_id]);
  if (relationship.rows.length) return;
  const appointment = await client.query(`SELECT id FROM appointments WHERE provider_id=$1 AND patient_id=$2
    AND status IN ('scheduled','confirmed','in_progress') FOR SHARE`, [actor.id, record.patient_id]);
  if (!appointment.rows.length) throw accessDenied();
}

function format(visit) {
  const vitals = readClinicalField(visit, 'vitals');
  let parsedVitals = null;
  if (vitals !== null) {
    try {
      parsedVitals = JSON.parse(vitals);
      if (parsedVitals !== null && (typeof parsedVitals !== 'object' || Array.isArray(parsedVitals))) throw new Error('Invalid vitals');
    } catch (_error) {
      throw denied(503, 'CLINICAL_DECRYPTION_UNAVAILABLE', 'Protected clinical content could not be opened.');
    }
  }
  // Never return database encryption envelopes to an editor or to a patient.
  return {
    id: visit.id, appointmentId: visit.appointment_id, patientId: visit.patient_id, providerId: visit.provider_id,
    patient: { firstName: visit.patient_first_name, lastName: visit.patient_last_name, dateOfBirth: visit.patient_dob },
    provider: { firstName: visit.provider_first_name, lastName: visit.provider_last_name, credentials: visit.provider_credentials },
    appointment: { scheduledAt: visit.scheduled_at, type: visit.appointment_type, reasonForVisit: visit.reason_for_visit },
    subjective: readClinicalField(visit, 'subjective'), objective: readClinicalField(visit, 'objective'),
    assessment: readClinicalField(visit, 'assessment'), plan: readClinicalField(visit, 'plan'), vitals: parsedVitals,
    icdCodes: visit.icd_codes, cptCodes: visit.cpt_codes, isSigned: visit.is_signed, signedAt: visit.signed_at,
    isLocked: visit.is_locked, followUpRequired: visit.follow_up_required, followUpNotes: visit.follow_up_notes,
    createdAt: visit.created_at, updatedAt: visit.updated_at,
  };
}

async function read(session, { id, appointmentId } = {}, { ipAddress = null, userAgent = null } = {}) {
  references(session?.id, id || appointmentId);
  if (!['patient', 'provider'].includes(session?.role)) throw accessDenied();
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const actor = await reader(client, session);
    let appointment;
    if (appointmentId) {
      appointment = (await client.query(`SELECT a.id,a.patient_id,a.provider_id FROM appointments a
        JOIN users p ON p.id=a.patient_id AND p.role='patient' AND p.is_active=TRUE AND p.market_scope=$2
        JOIN users pr ON pr.id=a.provider_id AND pr.role='provider' AND pr.market_scope=$2
        WHERE a.id=$1 FOR SHARE OF a,p,pr`, [appointmentId, actor.market_scope])).rows[0];
      if (!appointment) throw accessDenied();
      await authorize(client, actor, appointment, { appointmentOnly: true });
    }
    const visit = (await client.query(`SELECT v.*,a.scheduled_at,a.type AS appointment_type,a.reason_for_visit,
        p.first_name AS patient_first_name,p.last_name AS patient_last_name,p.date_of_birth AS patient_dob,
        pr.first_name AS provider_first_name,pr.last_name AS provider_last_name,pr.credentials AS provider_credentials
      FROM visits v
      JOIN appointments a ON a.id=v.appointment_id AND a.patient_id=v.patient_id AND a.provider_id=v.provider_id
      JOIN users p ON p.id=v.patient_id AND p.role='patient' AND p.is_active=TRUE AND p.market_scope=$2
      JOIN users pr ON pr.id=v.provider_id AND pr.role='provider' AND pr.market_scope=$2
      WHERE ${appointmentId ? 'v.appointment_id' : 'v.id'}=$1 FOR SHARE OF v,a,p,pr`,
    [appointmentId || id, actor.market_scope])).rows[0];
    if (!visit && appointmentId && (await client.query('SELECT id FROM visits WHERE appointment_id=$1 FOR SHARE', [appointmentId])).rows.length) throw accessDenied();
    if (!visit && !appointmentId) throw denied(404, 'CLINICAL_VISIT_NOT_FOUND', 'Visit not found.');
    if (visit) await authorize(client, actor, visit, { appointmentOnly: Boolean(appointmentId) });
    const result = visit ? format(visit) : null;
    // Do not release plaintext unless a metadata-only audit commits with the
    // account, care-relationship and record locks still held.
    await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,patient_id,description,phi_accessed,success,ip_address,user_agent)
      VALUES($1,'read','visit',$2,$3,'Current authorized visit read',TRUE,TRUE,$4,$5)`,
    [actor.id, visit?.id || null, visit?.patient_id || appointment.patient_id, ipAddress, userAgent]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { read };
