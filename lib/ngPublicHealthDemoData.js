/*
 * DoctaRx Nigeria — Public-Health Programme (Ministry) demo dataset.
 * -------------------------------------------------------------------
 * SYNTHETIC / FICTIONAL "Sample Pilot Data" for the Abuja pilot demo ONLY.
 * No real patient data, no real medical records, no real government data.
 *
 * Used as a graceful fallback so the Ministry / public-health dashboard is never
 * empty during a pilot demonstration. Real API data always takes precedence; this
 * only fills gaps and is clearly labelled "Sample Pilot Data" in the UI.
 */

export const PUBLIC_HEALTH_DEMO_LABEL = 'Sample Pilot Data — Fictional Data for Presentation';

function series(values) {
  // Build a {date,value} sparkline series from raw values across a sample period.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  return values.map((value, i) => ({ date: months[i] || `P${i + 1}`, value }));
}

const COMPLAINT_CATEGORIES = [
  { name: 'Fever', count: 31 },
  { name: 'Malaria-like symptoms', count: 27 },
  { name: 'Hypertension follow-up', count: 22 },
  { name: 'Maternal health inquiry', count: 16 },
  { name: 'Respiratory symptoms', count: 14 },
];

const FACILITY_TYPE_BREAKDOWN = [
  { name: 'Primary Healthcare Centre', count: 3 },
  { name: 'General Hospital', count: 2 },
];

const FACILITY_POINTS = [
  { name: 'Demo PHC Garki', location: 'Garki', lga: 'AMAC', city: 'Abuja', facility_count: 38, latitude: 9.033, longitude: 7.491 },
  { name: 'Demo PHC Wuse', location: 'Wuse', lga: 'AMAC', city: 'Abuja', facility_count: 31, latitude: 9.073, longitude: 7.486 },
  { name: 'Demo PHC Lugbe', location: 'Lugbe', lga: 'AMAC', city: 'Abuja', facility_count: 24, latitude: 8.949, longitude: 7.378 },
  { name: 'Demo General Hospital Maitama', location: 'Maitama', lga: 'AMAC', city: 'Abuja', facility_count: 21, latitude: 9.087, longitude: 7.501 },
  { name: 'Demo General Hospital Asokoro', location: 'Asokoro', lga: 'AMAC', city: 'Abuja', facility_count: 14, latitude: 9.043, longitude: 7.531 },
];

const TOP_PROVIDERS = [
  { name: 'Dr. Musa Ibrahim', count: 23 },
  { name: 'Dr. Ada Okonkwo', count: 19 },
  { name: 'Dr. Fatima Bello', count: 17 },
  { name: 'Dr. Samuel Danjuma', count: 14 },
];

const MEDICINE_CATEGORIES = [
  { name: 'Antimalarials', count: 24 },
  { name: 'Analgesics / antipyretics', count: 20 },
  { name: 'Antihypertensives', count: 18 },
  { name: 'Antibiotics', count: 12 },
  { name: 'Prenatal vitamins', count: 9 },
];

const REFERRAL_DESTINATIONS = [
  { name: 'Demo General Hospital Maitama', count: 13 },
  { name: 'Demo General Hospital Asokoro', count: 8 },
  { name: 'Demo PHC Garki', count: 7 },
  { name: 'Demo PHC Wuse', count: 6 },
];

function forecastBlock(predicted, label) {
  return {
    predictedValue: predicted,
    confidenceLabel: label,
    explanation:
      'Sample trend only: fever and malaria-like presentations rise into the rainy season. ' +
      'Forecasting support helps facilities and the Ministry plan staffing and medicine supply ahead of demand. ' +
      'This is planning insight, not a clinical or surveillance prediction.',
    historicalPoints: series([12, 14, 19, 26, 33, 41]),
  };
}

export function buildPublicHealthExecutiveDemo() {
  return {
    charts: {
      consultations: series([9, 12, 14, 17, 19, 21]),
      teleconsultations: series([4, 6, 7, 8, 9, 8]),
      referrals: series([3, 5, 6, 6, 7, 7]),
      prescriptions: series([6, 8, 9, 10, 9, 10]),
      registrations: series([8, 10, 11, 12, 12, 11]),
      followups: series([3, 4, 5, 5, 6, 5]),
      labReferrals: series([1, 2, 2, 2, 2, 2]),
      pharmacyReferrals: series([3, 4, 4, 4, 4, 4]),
    },
    tables: {
      complaintCategories: COMPLAINT_CATEGORIES,
      facilityTypeBreakdown: FACILITY_TYPE_BREAKDOWN,
      medicineCategories: MEDICINE_CATEGORIES,
      topMedicationClasses: MEDICINE_CATEGORIES,
      topProviders: TOP_PROVIDERS,
      topReferralDestinations: REFERRAL_DESTINATIONS,
    },
    forecasts: {
      consultations7Day: forecastBlock(41, 'moderate'),
      consultations14Day: forecastBlock(47, 'moderate'),
    },
    maps: { points: FACILITY_POINTS },
  };
}

export function buildPublicHealthOverviewDemo() {
  return {
    metrics: {
      patient_access_requests: 128,
      appointment_bookings: 110,
      new_patient_registrations: 64,
      total_consultations: 92,
      completed_consultations: 86,
      teleconsultations: 42,
      referrals_created: 34,
      referrals_completed: 21,
      pending_referrals: 13,
      prescriptions_created: 52,
      pharmacy_referrals: 23,
      lab_referrals: 11,
      followup_appointments: 28,
      active_patients: 96,
      active_facilities: 5,
      active_providers: 8,
      audio_fallback_sessions: 6,
      failed_video_sessions: 3,
    },
    dhis2Readiness: {
      status: 'ready',
      syncStatus: 'dry-run-ready',
      governanceNotes:
        'Aggregate, non-identifiable reporting views aligned with NHMIS/DHIS2-oriented requirements. ' +
        'DoctaRx supports reporting readiness; it does not replace existing government systems and does not auto-submit official reports.',
      checklist: [
        { label: 'Aggregate reporting views prepared', status: 'ready' },
        { label: 'Facility-level activity summarised', status: 'ready' },
        { label: 'Indicator fields mapped to reporting needs', status: 'ready' },
        { label: 'CSV / JSON export available for review', status: 'ready' },
        { label: 'DHIS2 dry-run preview', status: 'ready' },
        { label: 'Official automatic submission', status: 'not-configured' },
      ],
    },
  };
}

export function buildPublicHealthAnalyticsDemo() {
  return {
    charts: {
      consultations: series([9, 12, 14, 17, 19, 21]),
      teleconsultations: series([4, 6, 7, 8, 9, 8]),
      referrals: series([3, 5, 6, 6, 7, 7]),
      prescriptions: series([6, 8, 9, 10, 9, 10]),
      map: FACILITY_POINTS,
    },
  };
}

export function buildPublicHealthAreasDemo() {
  const area = (key, title, description, metrics) => ({ key, title, description, metrics });
  return [
    area('teleconsultation', 'Teleconsultation', 'Remote doctor consultation support for selected PHCs and patients.', [
      { label: 'Video consultations', value: 42 },
      { label: 'Audio fallback', value: 6, unit: 'ratio' },
      { label: 'Completed', value: 86 },
    ]),
    area('referrals', 'Referral Coordination', 'Referral creation, acceptance, scheduling, completion and follow-up.', [
      { label: 'Created', value: 34 },
      { label: 'Completed', value: 21 },
      { label: 'Completion', value: 62, unit: 'percent' },
    ]),
    area('pharmacy', 'Pharmacy Visibility', 'Prescription visibility and medicine availability coordination.', [
      { label: 'Prescriptions', value: 52 },
      { label: 'Pharmacy referrals', value: 23 },
    ]),
    area('maternal', 'Maternal Health', 'Antenatal inquiries logged and referred where appropriate.', [
      { label: 'Inquiries', value: 16 },
      { label: 'Referred', value: 7 },
    ]),
  ];
}

export function buildPublicHealthIndicatorsDemo() {
  const ind = (label, value, unit) => ({
    label, title: label, name: label, value, unit, configured: true,
    dhis2DataElement: label.replace(/\s+/g, '_').toUpperCase(),
  });
  return [
    ind('Follow-up visibility', 74, 'percent'),
    ind('Average response time', 18, 'minutes'),
    ind('Referral completion rate', 62, 'percent'),
    ind('Reporting completeness', 91, 'percent'),
    ind('Completed consultations', 86, 'count'),
    ind('Video consultation usage', 42, 'count'),
    ind('Prescriptions issued', 52, 'count'),
    ind('Active facilities', 5, 'count'),
  ];
}

export function buildPublicHealthReportsDemo() {
  const now = Date.now();
  const iso = (d) => new Date(now - d * 86400000).toISOString();
  return [
    { id: 'DEMO-RPT-001', period: '2026-05', reportType: 'monthly_aggregate', report_type: 'monthly_aggregate', status: 'approved', createdAt: iso(20), created_at: iso(20), title: 'Aggregate monthly facility activity — May (Sample)' },
    { id: 'DEMO-RPT-002', period: '2026-06', reportType: 'monthly_aggregate', report_type: 'monthly_aggregate', status: 'draft', createdAt: iso(2), created_at: iso(2), title: 'Aggregate monthly facility activity — June (Sample)' },
  ];
}

export function buildPublicHealthForecastDemo() {
  return forecastBlock(41, 'moderate');
}

export function buildPublicHealthAuditDemo() {
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  const log = (action, actor, t) => ({ id: `DEMO-AUD-${t}`, action, actor, actorRole: 'ministry_admin', createdAt: iso(t), created_at: iso(t) });
  return [
    log('Viewed executive dashboard', 'Ministry reviewer (demo)', 4),
    log('Generated monthly aggregate report', 'Reporting officer (demo)', 35),
    log('Ran DHIS2 dry-run preview', 'Reporting officer (demo)', 90),
    log('Exported aggregate CSV for review', 'Ministry reviewer (demo)', 220),
  ];
}

export function buildPublicHealthDemoBundle() {
  return {
    executive: buildPublicHealthExecutiveDemo(),
    overview: buildPublicHealthOverviewDemo(),
    areas: buildPublicHealthAreasDemo(),
    analytics: buildPublicHealthAnalyticsDemo(),
    reports: buildPublicHealthReportsDemo(),
    indicators: buildPublicHealthIndicatorsDemo(),
    forecast: buildPublicHealthForecastDemo(),
    auditLogs: buildPublicHealthAuditDemo(),
  };
}

/** Whether the Ministry demo fallback should be allowed to fill empty data. */
export function publicHealthDemoEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage?.getItem('DOCTARX_PRESENTATION_DEMO') === 'true') return true;
    const q = new URLSearchParams(window.location.search);
    if (q.get('demo') === '1' || q.has('demo')) return true;
  } catch {
    /* ignore */
  }
  return false;
}
