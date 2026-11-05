'use strict';
function exactEncounter(row, context) {
  return row && row.appointmentId === context.appointmentId && row.patientId === context.patientId &&
    row.providerId === context.providerId && row.status === 'in_progress';
}
async function resolveContext(api, context) {
  if (!context.appointmentId || !context.patientId || !context.providerId) throw new Error('Open an assigned appointment before using Clinical Assist.');
  const response = await api.appointments.getById(context.appointmentId);
  const appointment = response.data?.appointment;
  if (!response.data?.success || appointment?.id !== context.appointmentId || appointment.patientId !== context.patientId || appointment.providerId !== context.providerId) {
    throw new Error('This appointment is unavailable in your current clinical context.');
  }
  const records = await api.clinical.getPatientEncounters(context.patientId, { status: 'in_progress', limit: 200 });
  if (!records.data?.success || !Array.isArray(records.data.encounters)) throw new Error('The encounter record could not be loaded.');
  const exact = records.data.encounters.filter(row => exactEncounter(row, context));
  if (exact.length !== 1) return { appointment, encounter: null };
  return { appointment, encounter: exact[0] };
}
async function prepareDraft(api, context, encounterId, suggestionType) {
  const response = await api.getEncounter(encounterId);
  if (!response.data?.success || response.data.encounter?.id !== encounterId || !exactEncounter(response.data.encounter, context)) {
    throw new Error('The encounter changed. Refresh before preparing a draft.');
  }
  // No free text, microphone stream, patient name or client-owned programme
  // context is passed to a general agent. Source records resolve on the server.
  const created = await api.createEncounterAiDraft(encounterId, suggestionType);
  const draft = created.data?.suggestion;
  if (!created.data?.success || !draft?.id || draft.status !== 'drafted' || draft.patient_user_id !== context.patientId) {
    throw new Error('A verified clinical draft was not returned.');
  }
  return draft;
}
module.exports = { exactEncounter, resolveContext, prepareDraft };
