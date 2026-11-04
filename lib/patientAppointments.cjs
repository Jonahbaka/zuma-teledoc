'use strict';

// Navigation hints only. The call admission endpoint remains authoritative for
// current participant access, consent, coverage and appointment state.
const ACTIVE_APPOINTMENT_STATUSES = Object.freeze(['scheduled', 'confirmed', 'in_progress']);

function isActiveAppointment(appointment) {
  return ACTIVE_APPOINTMENT_STATUSES.includes(String(appointment?.status || '').toLowerCase());
}

function canOpenVideoVisit(appointment) {
  return appointment?.type === 'video' && isActiveAppointment(appointment);
}

module.exports = { isActiveAppointment, canOpenVideoVisit };
