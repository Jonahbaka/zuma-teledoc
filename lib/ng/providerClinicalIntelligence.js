function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(value, reference = new Date()) {
  const date = toDate(value);
  if (!date) return false;
  return date.toDateString() === reference.toDateString();
}

function isWithinDays(value, days, reference = new Date()) {
  const date = toDate(value);
  if (!date) return false;
  const diffMs = date.getTime() - reference.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

function normalizeStatus(value, fallback = 'unknown') {
  return String(value || fallback).trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function levelForScore(score) {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 35) return 'moderate';
  return 'routine';
}

function formatForecast(value, unit) {
  return `${Math.max(0, Math.round(value))} ${unit}`;
}

function countPrescriptionItems(prescriptions) {
  return toArray(prescriptions).reduce((total, prescription) => {
    const items = toArray(prescription.items);
    return total + (items.length || 1);
  }, 0);
}

function collectMedicationNames(prescriptions) {
  return toArray(prescriptions)
    .flatMap((prescription) => {
      const items = toArray(prescription.items);
      if (items.length) return items;
      return [prescription];
    })
    .map((item) => String(item.medication_name || item.medicationName || item.generic_name || item.genericName || '').trim())
    .filter(Boolean);
}

function deriveProviderClinicalIntelligence(snapshot = {}) {
  const now = snapshot.now ? new Date(snapshot.now) : new Date();
  const appointments = toArray(snapshot.appointments);
  const visits = toArray(snapshot.visits);
  const prescriptions = toArray(snapshot.prescriptions);
  const referrals = toArray(snapshot.referrals);
  const patients = toArray(snapshot.patients);

  const todaysAppointments = appointments.filter((appointment) => isSameDay(appointment.scheduledAt || appointment.scheduled_at, now));
  const videoConsultations = appointments.filter((appointment) => {
    const type = normalizeStatus(appointment.type || appointment.appointment_type, '');
    return ['video', 'telemedicine', 'telehealth'].includes(type);
  });
  const activeConsultations = videoConsultations.filter((appointment) =>
    ['confirmed', 'in_progress', 'scheduled'].includes(normalizeStatus(appointment.status))
      && isWithinDays(appointment.scheduledAt || appointment.scheduled_at, 1, now)
  );
  const unsignedNotes = visits.filter((visit) => !visit.isSigned && !visit.is_signed);
  const followUpDue = visits.filter((visit) => visit.followUpRequired || visit.follow_up_required);
  const openPrescriptions = prescriptions.filter((prescription) =>
    ['created', 'sent', 'accepted_by_pharmacy'].includes(normalizeStatus(prescription.lifecycle_status || prescription.status))
  );
  const pharmacyBlocked = prescriptions.filter((prescription) =>
    ['declined_by_pharmacy', 'cancelled', 'expired'].includes(normalizeStatus(prescription.lifecycle_status || prescription.status))
  );
  const dispensedPrescriptions = prescriptions.filter((prescription) =>
    normalizeStatus(prescription.lifecycle_status || prescription.status) === 'dispensed'
  );
  const pendingReferrals = referrals.filter((referral) =>
    ['draft', 'sent', 'accepted'].includes(normalizeStatus(referral.status || referral.referral_status))
  );
  const urgentReferrals = pendingReferrals.filter((referral) =>
    ['urgent', 'emergency'].includes(normalizeStatus(referral.priority, 'routine'))
  );
  const medicationNames = collectMedicationNames(prescriptions);

  const riskScore = clamp(
    activeConsultations.length * 8
      + unsignedNotes.length * 9
      + pharmacyBlocked.length * 12
      + urgentReferrals.length * 14
      + followUpDue.length * 7
      + Math.max(0, patients.length - 20),
    0,
    100
  );

  const noShowRisk = clamp(
    todaysAppointments.filter((appointment) => normalizeStatus(appointment.status) === 'scheduled').length * 8
      + appointments.filter((appointment) => normalizeStatus(appointment.status) === 'no_show').length * 15,
    0,
    100
  );

  const medicationWarnings = [];
  if (medicationNames.some((name) => /artemether|lumefantrine|artesunate|amodiaquine/i.test(name))) {
    medicationWarnings.push({
      severity: 'review',
      title: 'Antimalarial safety review',
      detail: 'Confirm age, weight, pregnancy status, allergy history, and prior antimalarial exposure before dispense.',
    });
  }
  if (medicationNames.some((name) => /metformin|insulin|amlodipine|lisinopril|losartan/i.test(name))) {
    medicationWarnings.push({
      severity: 'monitor',
      title: 'Chronic medication monitoring',
      detail: 'Check recent vitals, renal function, adherence, and follow-up interval.',
    });
  }
  if (pharmacyBlocked.length > 0) {
    medicationWarnings.push({
      severity: 'action',
      title: 'Pharmacy lifecycle blocker',
      detail: `${pharmacyBlocked.length} prescription order(s) need provider or pharmacy follow-up.`,
    });
  }

  const careGaps = [
    unsignedNotes.length ? `${unsignedNotes.length} unsigned SOAP note(s)` : null,
    followUpDue.length ? `${followUpDue.length} follow-up task(s) due` : null,
    pendingReferrals.length ? `${pendingReferrals.length} referral(s) not completed` : null,
    openPrescriptions.length ? `${openPrescriptions.length} prescription(s) still in lifecycle` : null,
  ].filter(Boolean);

  const referralRecommendations = [];
  if (urgentReferrals.length) {
    referralRecommendations.push('Escalate urgent referral queue before routine consults.');
  }
  if (medicationNames.some((name) => /artesunate injection|quinine/i.test(name))) {
    referralRecommendations.push('Consider facility escalation for severe malaria treatment monitoring.');
  }
  if (followUpDue.length > 2) {
    referralRecommendations.push('Assign referral coordinator to follow-up backlog.');
  }

  const forecasts = {
    consultationsNext7Days: {
      value: appointments.filter((appointment) => isWithinDays(appointment.scheduledAt || appointment.scheduled_at, 7, now)).length,
      label: '7 day consultations',
      display: formatForecast(appointments.filter((appointment) => isWithinDays(appointment.scheduledAt || appointment.scheduled_at, 7, now)).length, 'visits'),
    },
    pharmacyLoad: {
      value: openPrescriptions.length + countPrescriptionItems(openPrescriptions) * 0.35,
      label: 'Pharmacy load',
      display: formatForecast(openPrescriptions.length + countPrescriptionItems(openPrescriptions) * 0.35, 'work units'),
    },
    referralEscalation: {
      value: urgentReferrals.length,
      label: 'Referral escalation',
      display: formatForecast(urgentReferrals.length, 'urgent cases'),
    },
    noShowRisk: {
      value: noShowRisk,
      label: 'No-show risk',
      display: `${Math.round(noShowRisk)}%`,
    },
  };

  return {
    generatedAt: now.toISOString(),
    operationalRisk: {
      score: riskScore,
      level: levelForScore(riskScore),
      drivers: [
        activeConsultations.length ? `${activeConsultations.length} active consultation(s)` : null,
        unsignedNotes.length ? `${unsignedNotes.length} unsigned SOAP note(s)` : null,
        pharmacyBlocked.length ? `${pharmacyBlocked.length} pharmacy blocker(s)` : null,
        urgentReferrals.length ? `${urgentReferrals.length} urgent referral(s)` : null,
      ].filter(Boolean),
    },
    counts: {
      patients: patients.length,
      todayAppointments: todaysAppointments.length,
      activeConsultations: activeConsultations.length,
      unsignedNotes: unsignedNotes.length,
      openPrescriptions: openPrescriptions.length,
      dispensedPrescriptions: dispensedPrescriptions.length,
      pendingReferrals: pendingReferrals.length,
      urgentReferrals: urgentReferrals.length,
    },
    forecasts,
    medicationWarnings,
    careGaps,
    referralRecommendations,
    careModelCoverage: {
      longitudinalRecords: patients.length > 0 || visits.length > 0,
      chronicDiseaseTracking: medicationNames.some((name) => /metformin|insulin|amlodipine|lisinopril|losartan/i.test(name)),
      medicationHistory: prescriptions.length > 0,
      referralChains: referrals.length > 0,
      outcomeTracking: visits.some((visit) => visit.isSigned || visit.is_signed || visit.followUpRequired || visit.follow_up_required),
      populationHealthSignals: appointments.length > 0 || prescriptions.length > 0 || referrals.length > 0,
    },
  };
}

module.exports = {
  deriveProviderClinicalIntelligence,
  levelForScore,
};
