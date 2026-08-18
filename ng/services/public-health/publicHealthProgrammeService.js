const crypto = require('crypto');
const { getPool } = require('../../../server/db');
const { encrypt, decrypt } = require('../../../lib/encryption');

const REPORT_STATUSES = new Set(['draft', 'generated', 'approved', 'exported', 'sync_pending', 'synced', 'sync_failed']);
const FORECAST_RANGES = new Set([7, 14, 30]);

const PROGRAMME_AREAS = [
  {
    key: 'primary_healthcare',
    title: 'Primary Healthcare Strengthening',
    description: 'Support PHCs with patient access, follow-up, referral coordination, care continuity, and service utilization visibility.',
    metricKeys: ['appointment_bookings', 'teleconsultations', 'referrals_created', 'followup_appointments', 'active_facilities'],
  },
  {
    key: 'teleconsultation',
    title: 'Teleconsultation / Digital Access',
    description: 'Support digital access to care through telemedicine, remote follow-up, appointment booking, patient communication, and low-bandwidth-ready access.',
    metricKeys: ['teleconsultations', 'audio_fallback_sessions', 'failed_video_sessions', 'appointment_bookings'],
  },
  {
    key: 'referrals',
    title: 'Public Hospital & PHC Referral Coordination',
    description: 'Track referrals between PHCs, public hospitals, specialists, pharmacies, and laboratories.',
    metricKeys: ['referrals_created', 'referrals_completed', 'pending_referrals', 'lab_referrals', 'pharmacy_referrals'],
  },
  {
    key: 'pharmacy',
    title: 'Pharmacy & Medication Coordination',
    description: 'Support prescription records, pharmacy routing, medicine availability workflow, and medication demand visibility.',
    metricKeys: ['prescriptions_created', 'pharmacy_referrals'],
  },
  {
    key: 'laboratory',
    title: 'Laboratory & Diagnostic Coordination',
    description: 'Support lab referral tracking, diagnostic request workflows, and lab utilization reporting.',
    metricKeys: ['lab_referrals'],
  },
  {
    key: 'cancer_care',
    title: 'Cancer Care Support',
    description: 'Support cancer-care improvement efforts with reporting, referrals, appointment tracking, patient navigation, follow-up reminders, and specialist workflow visibility. DoctaRx supports coordination only and does not diagnose cancer.',
    metricKeys: ['cancer_related_referrals', 'followup_appointments'],
  },
  {
    key: 'dhis2_reporting',
    title: 'NHMIS/DHIS2-Ready Reporting',
    description: 'Generate structured aggregate reports that can later be mapped to official NHMIS/DHIS2 datasets.',
    metricKeys: ['reports_generated'],
  },
  {
    key: 'public_health_intelligence',
    title: 'Data-Driven Public Health',
    description: 'Provide dashboards, utilization trends, location trends, and executive summaries for decision-making.',
    metricKeys: ['total_consultations', 'new_patient_registrations', 'active_providers', 'active_facilities'],
  },
  {
    key: 'predictive_planning',
    title: 'Predictive Planning & Digital Health Alignment',
    description: 'Provide explainable operational forecasting for demand planning, medicine demand, staffing needs, facility workload, and early planning signals.',
    metricKeys: ['forecast_status'],
  },
];

const METRIC_LABELS = {
  total_consultations: 'Total consultations',
  teleconsultations: 'Teleconsultations',
  completed_consultations: 'Completed consultations',
  cancelled_consultations: 'Cancelled consultations',
  failed_video_sessions: 'Failed video sessions',
  audio_fallback_sessions: 'Audio fallback sessions',
  active_patients: 'Active patients',
  new_patient_registrations: 'New patient registrations',
  patient_access_requests: 'Patient access requests',
  appointment_bookings: 'Appointment bookings',
  followup_appointments: 'Follow-up appointments',
  referrals_created: 'Referrals created',
  referrals_completed: 'Referrals completed',
  pending_referrals: 'Pending referrals',
  prescriptions_created: 'Prescriptions created',
  pharmacy_referrals: 'Pharmacy referrals',
  lab_referrals: 'Lab referrals',
  active_providers: 'Active providers',
  active_facilities: 'Active facilities',
  notifications_sent: 'SMS/WhatsApp notifications sent',
  reports_generated: 'Public-health reports generated',
  cancer_related_referrals: 'Cancer-care support referrals',
};

function getActorId(user = {}) {
  return user.id || user.userId || user.sub || null;
}

function toNumber(value) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function percentage(numerator, denominator) {
  const bottom = toNumber(denominator);
  if (!bottom) return null;
  return Math.round((toNumber(numerator) / bottom) * 1000) / 10;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parsePeriod(period) {
  const raw = String(period || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));
  return {
    period: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    dhis2Period: `${year}${String(monthIndex + 1).padStart(2, '0')}`,
    start,
    end,
  };
}

function previousPeriod(period) {
  const parsed = parsePeriod(period);
  const date = new Date(parsed.start);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ngUserPredicate(alias) {
  return `(
    COALESCE(${alias}.market_scope, 'US') = 'NG'
    OR ${alias}.region::text = 'NG'
    OR UPPER(COALESCE(${alias}.country, '')) IN ('NG', 'NIGERIA')
  )`;
}

function isMissingDbObject(error) {
  return ['42P01', '42703', '42883', '22P02'].includes(error?.code);
}

async function safeScalar(pool, sql, params = [], field = 'count') {
  try {
    const result = await pool.query(sql, params);
    return toNumber(result.rows[0]?.[field]);
  } catch (error) {
    // A missing source table/column means the metric is unavailable, not zero.
    // Preserve that distinction through reporting and DHIS2 export validation.
    if (isMissingDbObject(error)) return null;
    throw error;
  }
}

async function safeRows(pool, sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (error) {
    if (isMissingDbObject(error)) return [];
    throw error;
  }
}

async function logAudit(action, actorUserId, resourceType, resourceId, metadata = {}) {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO public_health_audit_logs (actor_user_id, action, resource_type, resource_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorUserId || null, action, resourceType || null, resourceId || null, JSON.stringify(metadata || {})]
    );
  } catch (error) {
    if (!isMissingDbObject(error)) {
      console.warn('[NG Public Health] Audit log skipped:', error.message);
    }
  }
}

async function getMetrics({ period, facilityId, lga } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const params = [start, end];
  const dateFilter = (column) => `${column} >= $1 AND ${column} < $2`;
  const lgaFilter = lga ? ` AND LOWER(COALESCE(r.related_lga, r.lga, '')) = LOWER($3)` : '';
  const lgaParams = lga ? [...params, lga] : params;

  const appointmentNgScope = `EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = a.patient_id OR u.id = a.provider_id)
      AND ${ngUserPredicate('u')}
  )`;

  const [
    totalConsultations,
    teleconsultations,
    completedConsultations,
    cancelledConsultations,
    failedVideoSessions,
    audioFallbackSessions,
    activePatients,
    newPatientRegistrations,
    appointmentBookings,
    followupAppointments,
    referralsCreated,
    referralsCompleted,
    pendingReferrals,
    prescriptionsCreated,
    pharmacyReferrals,
    labReferrals,
    activeProviders,
    activeFacilitiesConfigured,
    activeHospitals,
    notificationsSent,
    reportsGenerated,
    cancerRelatedReferrals,
    patientAccessRequests,
  ] = await Promise.all([
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.scheduled_at, a.created_at)')} AND ${appointmentNgScope}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND LOWER(COALESCE(a.type, '')) IN ('video', 'telehealth', 'virtual', 'audio', 'phone')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('completed', 'complete', 'fulfilled')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.cancelled_at, a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('cancelled', 'canceled')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.updated_at, a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('failed', 'technical_failed', 'no_show') AND LOWER(COALESCE(a.type, '')) IN ('video', 'telehealth', 'virtual')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND LOWER(COALESCE(a.type, '')) IN ('audio', 'phone', 'voice')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM users u WHERE u.role = 'patient' AND COALESCE(u.is_active, true) = true AND ${ngUserPredicate('u')}`),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM users u WHERE ${dateFilter('u.created_at')} AND u.role = 'patient' AND ${ngUserPredicate('u')}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('a.created_at')} AND ${appointmentNgScope}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE ${dateFilter('COALESCE(a.scheduled_at, a.created_at)')} AND ${appointmentNgScope} AND (LOWER(COALESCE(a.type, '')) LIKE '%follow%' OR LOWER(COALESCE(a.reason_for_visit, '')) LIKE '%follow%')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals r WHERE ${dateFilter('r.created_at')}${lgaFilter}`, lgaParams),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals r WHERE ${dateFilter('COALESCE(r.completed_at, r.updated_at, r.created_at)')} AND LOWER(COALESCE(r.status, '')) = 'completed'${lgaFilter}`, lgaParams),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals r WHERE LOWER(COALESCE(r.status, '')) IN ('sent', 'accepted', 'pending', 'pending_clarification')${lgaFilter}`, lga ? [lga] : []),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_prescriptions p WHERE ${dateFilter('p.created_at')}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_dispense_requests d WHERE ${dateFilter('d.created_at')}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals r WHERE ${dateFilter('r.created_at')} AND LOWER(COALESCE(r.destination_type, r.referral_type, '')) LIKE '%lab%'${lgaFilter}`, lgaParams),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM users u WHERE u.role = 'provider' AND COALESCE(u.is_active, true) = true AND COALESCE(u.provider_status, 'pending') = 'approved' AND ${ngUserPredicate('u')}`),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM public_health_facilities f WHERE COALESCE(f.active, true) = true`),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_hospitals h WHERE COALESCE(h.active, true) = true`),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM notifications n WHERE ${dateFilter('n.created_at')}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM public_health_reports r WHERE ${dateFilter('r.created_at')}` , params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals r WHERE ${dateFilter('r.created_at')} AND (LOWER(COALESCE(r.reason, '')) LIKE '%cancer%' OR LOWER(COALESCE(r.reason, '')) LIKE '%oncolog%' OR LOWER(COALESCE(r.referral_type, '')) LIKE '%oncolog%' OR LOWER(COALESCE(r.target_name, '')) LIKE '%oncolog%')${lgaFilter}`, lgaParams),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_discovery_fallback_requests r WHERE ${dateFilter('r.created_at')}`, params),
  ]);

  return {
    total_consultations: totalConsultations,
    teleconsultations,
    completed_consultations: completedConsultations,
    cancelled_consultations: cancelledConsultations,
    failed_video_sessions: failedVideoSessions,
    audio_fallback_sessions: audioFallbackSessions,
    active_patients: activePatients,
    new_patient_registrations: newPatientRegistrations,
    patient_access_requests: patientAccessRequests,
    appointment_bookings: appointmentBookings,
    followup_appointments: followupAppointments,
    referrals_created: referralsCreated,
    referrals_completed: referralsCompleted,
    pending_referrals: pendingReferrals,
    prescriptions_created: prescriptionsCreated,
    pharmacy_referrals: pharmacyReferrals,
    lab_referrals: labReferrals,
    active_providers: activeProviders,
    active_facilities:
      activeFacilitiesConfigured === null || activeHospitals === null
        ? null
        : activeFacilitiesConfigured + activeHospitals,
    notifications_sent: notificationsSent,
    reports_generated: reportsGenerated,
    cancer_related_referrals: cancerRelatedReferrals,
  };
}

async function getSettingsRaw() {
  const pool = getPool();
  const rows = await safeRows(pool, `SELECT * FROM dhis2_integration_settings ORDER BY created_at ASC LIMIT 1`);
  if (rows[0]) return rows[0];
  return {
    environment: 'disabled',
    enabled: false,
    dry_run_only: true,
    government_approval_status: 'pending',
    api_credentials_status: 'pending',
    data_sharing_agreement_status: 'pending',
    ndpr_review_status: 'pending',
  };
}

function decryptSettingValue(row, field) {
  return decrypt(row?.[`${field}_encrypted`], row?.[`${field}_iv`], row?.[`${field}_tag`]);
}

function publicSettings(row) {
  return {
    id: row.id || null,
    environment: row.environment || 'disabled',
    enabled: row.enabled === true,
    dryRunOnly: row.dry_run_only !== false,
    datasetId: row.dataset_id || '',
    orgUnitId: row.org_unit_id || '',
    attributeOptionComboId: row.attribute_option_combo_id || '',
    governmentApprovalStatus: row.government_approval_status || 'pending',
    apiCredentialsStatus: row.api_credentials_status || 'pending',
    dataSharingAgreementStatus: row.data_sharing_agreement_status || 'pending',
    ndprReviewStatus: row.ndpr_review_status || 'pending',
    hasBaseUrl: Boolean(row.base_url_encrypted),
    hasUsername: Boolean(row.username_encrypted),
    hasApiToken: Boolean(row.api_token_encrypted),
    updatedAt: row.updated_at || null,
  };
}

function buildReadiness(settings, indicators = []) {
  const activeIndicators = indicators.filter((indicator) => indicator.active !== false);
  const missingMappings = activeIndicators.filter((indicator) => !indicator.dhis2_data_element_id);
  const checklist = [
    { key: 'facility_list_configured', label: 'Facility list configured', status: 'ready', detail: 'Public-health facility table is available for FCTA/PHC mapping.' },
    { key: 'programme_areas_configured', label: 'Programme areas configured', status: 'ready', detail: 'Core programme areas are configured in the admin module.' },
    { key: 'patient_access_workflow_enabled', label: 'Patient access workflow enabled', status: 'ready', detail: 'Patient registration, discovery, booking, and portal activity can feed aggregate reporting.' },
    { key: 'teleconsultation_workflow_enabled', label: 'Teleconsultation workflow enabled', status: 'ready', detail: 'Teleconsultation bookings and statuses are counted from operational records where present.' },
    { key: 'referral_workflow_enabled', label: 'Referral workflow enabled', status: 'ready', detail: 'Nigeria referral records are included in aggregate reporting when captured.' },
    { key: 'pharmacy_lab_coordination_enabled', label: 'Pharmacy/lab coordination enabled', status: 'ready', detail: 'Prescription, dispense, pharmacy, and lab referral counts are included where captured.' },
    { key: 'indicators_configured', label: 'Indicators configured', status: activeIndicators.length ? 'ready' : 'missing', detail: `${activeIndicators.length} aggregate indicator(s) configured.` },
    { key: 'aggregate_reporting_enabled', label: 'Aggregate reporting enabled', status: 'ready', detail: 'Monthly aggregate report generation is available without patient identifiers.' },
    { key: 'dashboard_metrics_available', label: 'Dashboard metrics available', status: 'ready', detail: 'Dashboards use live operational counts and clean empty states.' },
    { key: 'forecasting_module_enabled', label: 'Forecasting module enabled', status: 'ready', detail: 'Explainable moving-average and trend forecasts are available when enough history exists.' },
    { key: 'dhis2_mappings_pending', label: 'DHIS2 mappings pending', status: missingMappings.length ? 'pending' : 'ready', detail: `${missingMappings.length} active indicator mapping(s) missing official DHIS2 data element IDs.` },
    { key: 'government_approval_pending', label: 'Government approval pending', status: settings.governmentApprovalStatus === 'approved' ? 'ready' : 'pending', detail: 'Live submission requires formal FCTA/FMOH reporting approval.' },
    { key: 'api_credentials_pending', label: 'API credentials pending', status: settings.apiCredentialsStatus === 'configured' ? 'ready' : 'pending', detail: 'No government API call is made until credentials are configured and approved.' },
    { key: 'data_sharing_agreement_pending', label: 'Data-sharing agreement pending', status: settings.dataSharingAgreementStatus === 'approved' ? 'ready' : 'pending', detail: 'Patient-level integrations require separate authorization and NDPR review.' },
    { key: 'ndpr_privacy_review_pending', label: 'NDPR/privacy review pending', status: settings.ndprReviewStatus === 'approved' ? 'ready' : 'pending', detail: 'Aggregate reports exclude names, emails, phones, addresses, and DOB.' },
  ];

  const blockers = checklist.filter((item) => item.status === 'missing' || item.status === 'pending');
  return {
    status: blockers.length ? 'government_and_mapping_pending' : 'ready_for_configured_dry_run',
    syncStatus: settings.enabled && !settings.dryRunOnly ? 'live_sync_configured' : 'dry_run_only',
    missingMappings: missingMappings.map((indicator) => ({
      id: indicator.id,
      internalKey: indicator.internal_key,
      displayName: indicator.display_name,
      programmeArea: indicator.programme_area,
    })),
    checklist,
    governanceNotes: [
      'DoctaRx currently supports aggregate reporting readiness.',
      'Live NHMIS/DHIS2 submission requires official approval, credentials, configured dataset IDs, organisation-unit IDs, data-element IDs, and data-sharing agreement.',
      'Patient-level DHIS2 Tracker/Event integration requires explicit authorization, consent framework, NDPR review, and data-sharing agreement.',
      'No personal patient identifiers are included in aggregate reports.',
      'All exports, dry-runs, approvals, and sync attempts are logged.',
    ],
  };
}

function buildFilterState(params = {}) {
  const requested = Object.fromEntries(
    Object.entries({
      period: parsePeriod(params.period).period,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      facilityId: params.facilityId,
      facilityType: params.facilityType,
      lga: params.lga,
      ward: params.ward,
      providerId: params.providerId,
      programmeArea: params.programmeArea,
    }).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const applied = ['period'];
  if (params.lga) applied.push('lga_for_referral_tables');
  const mappingRequired = [];
  for (const [key, label] of [
    ['dateFrom', 'custom date range'],
    ['dateTo', 'custom date range'],
    ['facilityId', 'facility-linked appointments/referrals'],
    ['facilityType', 'facility type mapping'],
    ['ward', 'ward mapping'],
    ['providerId', 'provider-linked aggregate filters'],
    ['programmeArea', 'programme-area drilldown'],
  ]) {
    if (params[key]) mappingRequired.push(label);
  }
  return {
    requested,
    applied,
    mappingRequired,
    limitations: mappingRequired.length
      ? mappingRequired.map((item) => `${item} requires the related operational field or mapping to be configured before it can change aggregate counts.`)
      : [],
  };
}

async function listIndicators({ activeOnly = false } = {}) {
  const pool = getPool();
  const rows = await safeRows(
    pool,
    `SELECT * FROM public_health_indicators ${activeOnly ? 'WHERE active = TRUE' : ''} ORDER BY programme_area, display_name`
  );
  return rows;
}

async function getOverview(params = {}) {
  const period = parsePeriod(params.period).period;
  const [metrics, indicators, settingsRow, recentReports, recentInsights] = await Promise.all([
    getMetrics({ period }),
    listIndicators(),
    getSettingsRaw(),
    listReports({ limit: 5 }),
    getInsights({ period }),
  ]);
  const settings = publicSettings(settingsRow);
  const readiness = buildReadiness(settings, indicators);
  return {
    period,
    metrics,
    metricCards: Object.entries(METRIC_LABELS).map(([key, label]) => ({ key, label, value: metrics[key] || 0 })),
    filterState: buildFilterState(params),
    dhis2Readiness: readiness,
    settings,
    recentReports: recentReports.reports,
    insights: recentInsights.insights,
    forecastStatus: 'explainable_forecasting_ready',
    marketBaseline: {
      patientAccess: true,
      telemedicine: true,
      referralCoordination: true,
      pharmacyAndMedicationSupport: true,
      labDiagnosticSupport: true,
      facilityProviderOperations: true,
      publicHealthIntelligence: true,
      predictivePlanning: true,
      dhis2Readiness: true,
    },
  };
}

async function getProgrammeAreas(params = {}) {
  const metrics = await getMetrics({ period: params.period });
  return PROGRAMME_AREAS.map((area) => ({
    ...area,
    metrics: area.metricKeys.map((key) => ({
      key,
      label: METRIC_LABELS[key] || key.replace(/_/g, ' '),
      value: key === 'forecast_status' ? 'Enabled when history is available' : metrics[key] || 0,
    })),
  }));
}

function getMetricSql(metric, days = 30) {
  const sinceExpression = `NOW() - ($1::int || ' days')::interval`;
  const appointmentNgScope = `EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = a.patient_id OR u.id = a.provider_id)
      AND ${ngUserPredicate('u')}
  )`;
  const map = {
    consultations: `SELECT DATE(COALESCE(a.scheduled_at, a.created_at)) AS date, COUNT(*)::int AS value FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= ${sinceExpression} AND ${appointmentNgScope} GROUP BY 1 ORDER BY 1`,
    teleconsultations: `SELECT DATE(COALESCE(a.scheduled_at, a.created_at)) AS date, COUNT(*)::int AS value FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= ${sinceExpression} AND ${appointmentNgScope} AND LOWER(COALESCE(a.type, '')) IN ('video','telehealth','virtual','audio','phone') GROUP BY 1 ORDER BY 1`,
    registrations: `SELECT DATE(u.created_at) AS date, COUNT(*)::int AS value FROM users u WHERE u.created_at >= ${sinceExpression} AND u.role = 'patient' AND ${ngUserPredicate('u')} GROUP BY 1 ORDER BY 1`,
    referrals: `SELECT DATE(r.created_at) AS date, COUNT(*)::int AS value FROM ng_referrals r WHERE r.created_at >= ${sinceExpression} GROUP BY 1 ORDER BY 1`,
    prescriptions: `SELECT DATE(p.created_at) AS date, COUNT(*)::int AS value FROM ng_prescriptions p WHERE p.created_at >= ${sinceExpression} GROUP BY 1 ORDER BY 1`,
    followups: `SELECT DATE(COALESCE(a.scheduled_at, a.created_at)) AS date, COUNT(*)::int AS value FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= ${sinceExpression} AND ${appointmentNgScope} AND (LOWER(COALESCE(a.type, '')) LIKE '%follow%' OR LOWER(COALESCE(a.reason_for_visit, '')) LIKE '%follow%') GROUP BY 1 ORDER BY 1`,
    pharmacy_referrals: `SELECT DATE(d.created_at) AS date, COUNT(*)::int AS value FROM ng_dispense_requests d WHERE d.created_at >= ${sinceExpression} GROUP BY 1 ORDER BY 1`,
    lab_referrals: `SELECT DATE(r.created_at) AS date, COUNT(*)::int AS value FROM ng_referrals r WHERE r.created_at >= ${sinceExpression} AND LOWER(COALESCE(r.destination_type, r.referral_type, '')) LIKE '%lab%' GROUP BY 1 ORDER BY 1`,
  };
  return map[metric] || map.consultations;
}

async function getChartData({ metric = 'consultations', days = 30 } = {}) {
  const pool = getPool();
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);
  const rows = await safeRows(pool, getMetricSql(metric, safeDays), [safeDays]);
  return {
    metric,
    days: safeDays,
    points: rows.map((row) => ({ date: isoDate(new Date(row.date)), value: toNumber(row.value) })),
  };
}

async function getAnalytics(params = {}) {
  const period = parsePeriod(params.period).period;
  const [metrics, consultations, referrals, prescriptions, registrations] = await Promise.all([
    getMetrics({ period, facilityId: params.facilityId, lga: params.lga }),
    getChartData({ metric: 'consultations', days: 60 }),
    getChartData({ metric: 'referrals', days: 60 }),
    getChartData({ metric: 'prescriptions', days: 60 }),
    getChartData({ metric: 'registrations', days: 60 }),
  ]);
  return {
    period,
    metrics,
    filterState: buildFilterState(params),
    charts: {
      consultations: consultations.points,
      referrals: referrals.points,
      prescriptions: prescriptions.points,
      registrations: registrations.points,
    },
  };
}

function executiveKpi(label, value, options = {}) {
  return {
    label,
    value: value === undefined ? null : value,
    available: options.available !== undefined ? options.available : value !== null && value !== undefined,
    unit: options.unit || 'count',
    description: options.description || '',
    emptyState: options.emptyState || null,
  };
}

function buildExecutiveKpiSections(metrics, extra = {}) {
  return [
    {
      key: 'patient_access',
      title: 'Patient Access',
      items: [
        executiveKpi('Total patients served', extra.totalPatientsServed),
        executiveKpi('New patient registrations', metrics.new_patient_registrations),
        executiveKpi('Returning patients', extra.returningPatients),
        executiveKpi('Patient access requests', metrics.patient_access_requests),
        executiveKpi('Appointment bookings', metrics.appointment_bookings),
        executiveKpi('Missed appointments', extra.missedAppointments),
        executiveKpi('Completed appointments', metrics.completed_consultations),
        executiveKpi('Follow-up appointments', metrics.followup_appointments),
        executiveKpi('Follow-up completion rate', extra.followupCompletionRate, { unit: 'percent' }),
        executiveKpi('SMS/WhatsApp reminders sent', metrics.notifications_sent),
        executiveKpi('Patient engagement rate', extra.patientEngagementRate, {
          unit: 'percent',
          available: extra.patientEngagementRate !== null,
          emptyState: 'Patient engagement rate requires reliable reminder/open/response tracking.',
        }),
      ],
    },
    {
      key: 'telemedicine',
      title: 'Telemedicine',
      items: [
        executiveKpi('Total teleconsultations', metrics.teleconsultations),
        executiveKpi('Completed teleconsultations', extra.completedTeleconsultations),
        executiveKpi('Failed teleconsultations', metrics.failed_video_sessions),
        executiveKpi('Cancelled teleconsultations', extra.cancelledTeleconsultations),
        executiveKpi('Audio fallback sessions', metrics.audio_fallback_sessions),
        executiveKpi('Video success rate', extra.videoSuccessRate, { unit: 'percent' }),
        executiveKpi('Average consultation duration', extra.averageConsultationDuration, {
          unit: 'minutes',
          available: extra.averageConsultationDuration !== null,
          emptyState: 'Average duration requires reliable scheduled/ended consultation timing.',
        }),
        executiveKpi('Teleconsultation adoption rate', extra.teleconsultationAdoptionRate, { unit: 'percent' }),
        executiveKpi('Teleconsultation demand by facility', extra.teleconsultationFacilityCount, {
          available: extra.teleconsultationFacilityCount > 0,
          emptyState: 'Facility-level teleconsultation demand requires facility linkage on appointments.',
        }),
        executiveKpi('Teleconsultation demand by LGA/ward', extra.teleconsultationLocationCount, {
          available: extra.teleconsultationLocationCount > 0,
          emptyState: 'LGA/ward teleconsultation reporting requires captured facility or patient area mapping.',
        }),
      ],
    },
    {
      key: 'facility_utilization',
      title: 'PHC and Public Hospital Utilization',
      items: [
        executiveKpi('Active facilities', metrics.active_facilities),
        executiveKpi('Active PHCs', extra.activePhcs),
        executiveKpi('Active public hospitals', extra.activePublicHospitals),
        executiveKpi('Facility utilization rate', extra.facilityUtilizationRate, {
          unit: 'percent',
          available: extra.facilityUtilizationRate !== null,
          emptyState: 'Facility utilization rate requires facility-linked activity records.',
        }),
        executiveKpi('Facility workload score', extra.facilityWorkloadScore, {
          unit: 'score',
          available: extra.facilityWorkloadScore !== null,
          emptyState: 'Workload score appears when facility-linked consultation/referral activity exists.',
        }),
        executiveKpi('High-demand facilities', extra.highDemandFacilitiesCount),
        executiveKpi('Low-utilization facilities', extra.lowUtilizationFacilitiesCount),
        executiveKpi('PHC visits', extra.phcVisits, { available: extra.phcVisits !== null }),
        executiveKpi('Public hospital visits', extra.publicHospitalVisits, { available: extra.publicHospitalVisits !== null }),
        executiveKpi('Specialist clinic referrals', extra.specialistClinicReferrals),
        executiveKpi('Facility type breakdown', extra.facilityTypeBreakdownCount),
      ],
    },
    {
      key: 'referrals',
      title: 'Referrals',
      items: [
        executiveKpi('Total referrals created', metrics.referrals_created),
        executiveKpi('Referrals completed', metrics.referrals_completed),
        executiveKpi('Pending referrals', metrics.pending_referrals),
        executiveKpi('Cancelled referrals', extra.cancelledReferrals),
        executiveKpi('PHC-to-public-hospital referrals', extra.phcToHospitalReferrals),
        executiveKpi('Public-hospital-to-specialist referrals', extra.hospitalToSpecialistReferrals),
        executiveKpi('Pharmacy referrals', metrics.pharmacy_referrals),
        executiveKpi('Lab referrals', metrics.lab_referrals),
        executiveKpi('Referral completion rate', extra.referralCompletionRate, { unit: 'percent' }),
        executiveKpi('Average referral completion time', extra.averageReferralCompletionHours, {
          unit: 'hours',
          available: extra.averageReferralCompletionHours !== null,
          emptyState: 'Average completion time requires completed_at timestamps on referrals.',
        }),
        executiveKpi('Referral leakage/drop-off rate', extra.referralLeakageRate, { unit: 'percent' }),
        executiveKpi('Top referral destinations', extra.topReferralDestinationCount),
      ],
    },
    {
      key: 'prescriptions_pharmacy',
      title: 'Prescriptions and Pharmacy',
      items: [
        executiveKpi('Prescriptions created', metrics.prescriptions_created),
        executiveKpi('Prescriptions by category', extra.prescriptionCategoryCount),
        executiveKpi('Pharmacy referrals', metrics.pharmacy_referrals),
        executiveKpi('Pharmacy fulfilment status', extra.pharmacyFulfillmentStatusCount),
        executiveKpi('Pending pharmacy requests', extra.pendingPharmacyRequests),
        executiveKpi('Completed pharmacy requests', extra.completedPharmacyRequests),
        executiveKpi('Medicine demand by category', extra.medicineCategoryCount),
        executiveKpi('Top prescribed medication classes', extra.topMedicationClassCount),
        executiveKpi('Medicine demand trend', metrics.prescriptions_created),
        executiveKpi('Forecasted medicine demand', extra.forecastedMedicineDemand),
        executiveKpi('Medicine stock planning signal', extra.medicineStockPlanningSignal, { unit: 'signal' }),
      ],
    },
    {
      key: 'laboratory_diagnostics',
      title: 'Laboratory and Diagnostics',
      items: [
        executiveKpi('Lab referrals', metrics.lab_referrals),
        executiveKpi('Diagnostic requests', extra.diagnosticRequests),
        executiveKpi('Completed lab referrals', extra.completedLabReferrals),
        executiveKpi('Pending lab referrals', extra.pendingLabReferrals),
        executiveKpi('Lab utilization by facility', extra.labUtilizationFacilityCount, {
          available: extra.labUtilizationFacilityCount > 0,
          emptyState: 'Lab utilization by facility requires facility-linked lab referrals.',
        }),
        executiveKpi('Lab request category breakdown', extra.labCategoryCount),
        executiveKpi('Diagnostic demand trend', metrics.lab_referrals),
        executiveKpi('Forecasted lab demand', extra.forecastedLabDemand),
      ],
    },
    {
      key: 'provider_activity',
      title: 'Provider Activity',
      items: [
        executiveKpi('Active providers', metrics.active_providers),
        executiveKpi('Consultations per provider', extra.consultationsPerProvider, { unit: 'ratio' }),
        executiveKpi('Teleconsultations per provider', extra.teleconsultationsPerProvider, { unit: 'ratio' }),
        executiveKpi('Referrals created by provider', metrics.referrals_created),
        executiveKpi('Follow-ups completed by provider', extra.followupsCompletedByProvider),
        executiveKpi('Provider availability', extra.providerAvailabilityCount, {
          available: extra.providerAvailabilityCount > 0,
          emptyState: 'Provider availability requires schedule slots or availability records.',
        }),
        executiveKpi('Provider workload', extra.providerWorkloadScore, { unit: 'score' }),
        executiveKpi('Provider response time', extra.providerResponseTime, {
          unit: 'minutes',
          available: extra.providerResponseTime !== null,
          emptyState: 'Provider response time requires reliable response timestamp capture.',
        }),
        executiveKpi('Provider capacity warning', extra.providerCapacityWarnings),
      ],
    },
    {
      key: 'disease_complaint_service_demand',
      title: 'Disease / Complaint / Service Demand',
      items: [
        executiveKpi('Top symptoms', extra.topSymptomsCount),
        executiveKpi('Top complaint categories', extra.complaintCategoryCount),
        executiveKpi('Top diagnosis categories', extra.diagnosisCategoryCount, {
          available: extra.diagnosisCategoryCount > 0,
          emptyState: 'Diagnosis category reporting requires coded diagnosis capture.',
        }),
        executiveKpi('Disease-pattern trends', extra.complaintCategoryCount, { description: 'Aggregate complaint/service patterns only.' }),
        executiveKpi('Fever/malaria-like complaint trend', extra.feverMalariaTrend),
        executiveKpi('Respiratory complaint trend', extra.respiratoryTrend),
        executiveKpi('Hypertension/NCD-related visit trend', extra.ncdTrend),
        executiveKpi('Maternal and child health-related trend', extra.maternalChildTrend),
        executiveKpi('Cancer-related coordination/referral trend', metrics.cancer_related_referrals),
        executiveKpi('Mental health-related visit trend', extra.mentalHealthTrend),
        executiveKpi('Public-health early signals', extra.earlySignalCount),
      ],
    },
    {
      key: 'financial_contract',
      title: 'Financial / Contract Justification',
      emptyState: extra.financialConfigured ? null : 'Financial and subsidized service value reporting requires payment or service-value configuration.',
      items: [
        executiveKpi('Revenue value', extra.revenueValue, { unit: 'ngn', available: extra.revenueValue > 0 }),
        executiveKpi('Subsidized service value', extra.subsidizedServiceValue, { unit: 'ngn', available: extra.financialConfigured }),
        executiveKpi('Estimated value of services delivered', extra.estimatedServiceValue, { unit: 'ngn', available: extra.financialConfigured }),
        executiveKpi('Cost avoidance estimate', null, {
          unit: 'ngn',
          available: false,
          emptyState: 'Cost avoidance estimates require an approved economic model and service-value configuration.',
        }),
        executiveKpi('Free consultations delivered', extra.freeConsultations, { available: extra.financialConfigured }),
        executiveKpi('Sponsored consultations delivered', extra.sponsoredConsultations, { available: extra.financialConfigured }),
        executiveKpi('Corporate/organization consultations', extra.organizationConsultations, { available: extra.organizationConsultations !== null }),
        executiveKpi('Public-sector service value', extra.publicSectorServiceValue, { unit: 'ngn', available: extra.financialConfigured }),
        executiveKpi('Pilot value summary', extra.pilotValueSummary, { unit: 'summary', available: extra.financialConfigured }),
        executiveKpi('Contract justification summary', extra.contractJustificationSummary, { unit: 'summary', available: extra.financialConfigured }),
      ],
    },
  ];
}

function complaintCategoryCase(column = 'a.reason_for_visit') {
  return `CASE
    WHEN LOWER(COALESCE(${column}, '')) ~ '(fever|malaria|chills|body pain)' THEN 'Fever / malaria-like'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(cough|breath|asthma|respiratory|catarrh|chest)' THEN 'Respiratory'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(hypertension|blood pressure|diabetes|ncd|heart|stroke)' THEN 'NCD / hypertension / diabetes'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(pregnan|antenatal|maternal|child|pediatric|paediatric|immunization)' THEN 'Maternal and child health'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(mental|anxiety|depression|stress|sleep)' THEN 'Mental health'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(cancer|oncolog|screening|lump|tumor|tumour)' THEN 'Cancer-care coordination'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(stomach|ulcer|diarrhea|diarrhoea|vomit)' THEN 'Gastrointestinal'
    WHEN LOWER(COALESCE(${column}, '')) ~ '(skin|rash|itch|dermat)' THEN 'Skin / dermatology'
    ELSE 'Other / uncategorized'
  END`;
}

async function getAppointmentExtraMetrics({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const params = [start, end];
  const appointmentNgScope = `EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = a.patient_id OR u.id = a.provider_id)
      AND ${ngUserPredicate('u')}
  )`;

  const [
    totalPatientsServed,
    newPatientsWithAppointments,
    missedAppointments,
    completedTeleconsultations,
    cancelledTeleconsultations,
    averageConsultationDuration,
    followupsCompletedByProvider,
    organizationConsultations,
    freeConsultations,
    sponsoredConsultations,
  ] = await Promise.all([
    safeScalar(pool, `SELECT COUNT(DISTINCT a.patient_id) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope}`, params),
    safeScalar(pool, `SELECT COUNT(DISTINCT a.patient_id) AS count FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.created_at >= $1 AND a.created_at < $2 AND u.created_at >= $1 AND u.created_at < $2 AND ${ngUserPredicate('u')}`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('no_show', 'missed')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('completed', 'complete', 'fulfilled') AND LOWER(COALESCE(a.type, '')) IN ('video','telehealth','virtual','audio','phone')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.cancelled_at, a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.cancelled_at, a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('cancelled', 'canceled') AND LOWER(COALESCE(a.type, '')) IN ('video','telehealth','virtual','audio','phone')`, params),
    safeScalar(pool, `SELECT AVG(NULLIF(a.duration_minutes, 0)) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope}` , params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.status::text, '')) IN ('completed', 'complete', 'fulfilled') AND (LOWER(COALESCE(a.type, '')) LIKE '%follow%' OR LOWER(COALESCE(a.reason_for_visit, '')) LIKE '%follow%')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a JOIN users u ON u.id = a.patient_id WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${ngUserPredicate('u')} AND u.organization_id IS NOT NULL`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.payment_status::text, '')) IN ('free', 'waived')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM appointments a WHERE COALESCE(a.scheduled_at, a.created_at) >= $1 AND COALESCE(a.scheduled_at, a.created_at) < $2 AND ${appointmentNgScope} AND LOWER(COALESCE(a.payment_status::text, '')) IN ('sponsored', 'covered')`, params),
  ]);

  return {
    totalPatientsServed,
    returningPatients: Math.max(0, totalPatientsServed - newPatientsWithAppointments),
    missedAppointments,
    completedTeleconsultations,
    cancelledTeleconsultations,
    averageConsultationDuration: averageConsultationDuration ? round(averageConsultationDuration, 1) : null,
    followupsCompletedByProvider,
    organizationConsultations,
    freeConsultations,
    sponsoredConsultations,
  };
}

async function getFacilityIntelligence({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const [facilityRows, facilityTypeRows, activePhcs, activePublicHospitals] = await Promise.all([
    safeRows(
      pool,
      `SELECT id, name, facility_type, ownership_type, lga, ward, city, state, address,
              latitude, longitude, active
         FROM public_health_facilities
        WHERE COALESCE(active, true) = true
        ORDER BY name
        LIMIT 200`
    ),
    safeRows(
      pool,
      `SELECT facility_type, COUNT(*)::int AS count
         FROM public_health_facilities
        WHERE COALESCE(active, true) = true
        GROUP BY facility_type
        ORDER BY count DESC`
    ),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM public_health_facilities WHERE COALESCE(active, true) = true AND LOWER(COALESCE(facility_type, '')) IN ('phc', 'primary_health_centre', 'primary_health_center')`),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM public_health_facilities WHERE COALESCE(active, true) = true AND LOWER(COALESCE(facility_type, '')) IN ('public_hospital', 'hospital') AND LOWER(COALESCE(ownership_type, 'public')) = 'public'`),
  ]);

  const mapPoints = facilityRows
    .filter((row) => row.latitude !== null && row.longitude !== null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.facility_type,
      ownershipType: row.ownership_type,
      lga: row.lga,
      ward: row.ward,
      city: row.city,
      state: row.state,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      workloadScore: null,
      utilizationStatus: 'facility_linkage_pending',
    }));

  const lgaRows = await safeRows(
    pool,
    `SELECT COALESCE(lga, city, state, 'Unmapped') AS location, COUNT(*)::int AS facility_count
       FROM public_health_facilities
      WHERE COALESCE(active, true) = true
      GROUP BY COALESCE(lga, city, state, 'Unmapped')
      ORDER BY facility_count DESC
      LIMIT 20`
  );

  return {
    activePhcs,
    activePublicHospitals,
    facilityTypeBreakdown: facilityTypeRows,
    facilityTypeBreakdownCount: facilityTypeRows.length,
    mapPoints,
    mapReadiness: mapPoints.length ? 'ready' : 'coordinates_pending',
    lgaFacilityBreakdown: lgaRows,
    facilityUtilizationRate: null,
    facilityWorkloadScore: null,
    highDemandFacilities: [],
    lowUtilizationFacilities: [],
    highDemandFacilitiesCount: 0,
    lowUtilizationFacilitiesCount: 0,
    phcVisits: null,
    publicHospitalVisits: null,
    teleconsultationFacilityCount: 0,
    teleconsultationLocationCount: 0,
    periodStart: start,
    periodEnd: end,
  };
}

async function getReferralIntelligence({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const params = [start, end];
  const [
    cancelledReferrals,
    phcToHospitalReferrals,
    hospitalToSpecialistReferrals,
    averageReferralCompletionHours,
    topReferralDestinations,
    referralStatusBreakdown,
  ] = await Promise.all([
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(status, '')) IN ('cancelled', 'canceled', 'declined')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(destination_type, target_name, referral_type, '')) ~ '(hospital|public_hospital)'`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(destination_type, target_name, referral_type, '')) ~ '(specialist|specialty|clinic)'`, params),
    safeScalar(pool, `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND completed_at IS NOT NULL`, params),
    safeRows(pool, `SELECT COALESCE(NULLIF(target_name, ''), NULLIF(destination_type, ''), NULLIF(referral_type, ''), 'Unmapped destination') AS destination, COUNT(*)::int AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY count DESC LIMIT 10`, params),
    safeRows(pool, `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 GROUP BY status ORDER BY count DESC`, params),
  ]);
  return {
    cancelledReferrals,
    phcToHospitalReferrals,
    hospitalToSpecialistReferrals,
    averageReferralCompletionHours: averageReferralCompletionHours ? round(averageReferralCompletionHours, 1) : null,
    topReferralDestinations,
    topReferralDestinationCount: topReferralDestinations.length,
    referralStatusBreakdown,
  };
}

async function getPharmacyLabIntelligence({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const params = [start, end];
  const [
    pharmacyStatusRows,
    pendingPharmacyRequests,
    completedPharmacyRequests,
    medicineCategoryRows,
    topMedicationRows,
    labStatusRows,
    completedLabReferrals,
    pendingLabReferrals,
  ] = await Promise.all([
    safeRows(pool, `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count FROM ng_dispense_requests WHERE created_at >= $1 AND created_at < $2 GROUP BY status ORDER BY count DESC`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_dispense_requests WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(status, '')) IN ('routed', 'availability_requested', 'accepted', 'preparing')`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_dispense_requests WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(status, '')) IN ('dispensed', 'fulfilled', 'delivered')`, params),
    safeRows(pool, `SELECT COALESCE(item->>'category', item->>'medication_category', 'Uncategorized') AS category, COUNT(*)::int AS count FROM ng_prescriptions p, LATERAL jsonb_array_elements(COALESCE(p.items, '[]'::jsonb)) item WHERE p.created_at >= $1 AND p.created_at < $2 GROUP BY 1 ORDER BY count DESC LIMIT 10`, params),
    safeRows(pool, `SELECT COALESCE(item->>'class', item->>'drug_class', item->>'drug_name', item->>'medication', 'Uncategorized') AS medication_class, COUNT(*)::int AS count FROM ng_prescriptions p, LATERAL jsonb_array_elements(COALESCE(p.items, '[]'::jsonb)) item WHERE p.created_at >= $1 AND p.created_at < $2 GROUP BY 1 ORDER BY count DESC LIMIT 10`, params),
    safeRows(pool, `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(destination_type, referral_type, '')) LIKE '%lab%' GROUP BY status ORDER BY count DESC`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(destination_type, referral_type, '')) LIKE '%lab%' AND LOWER(COALESCE(status, '')) = 'completed'`, params),
    safeScalar(pool, `SELECT COUNT(*) AS count FROM ng_referrals WHERE created_at >= $1 AND created_at < $2 AND LOWER(COALESCE(destination_type, referral_type, '')) LIKE '%lab%' AND LOWER(COALESCE(status, '')) IN ('sent', 'accepted', 'pending', 'pending_clarification')`, params),
  ]);
  return {
    pharmacyFulfillmentStatus: pharmacyStatusRows,
    pharmacyFulfillmentStatusCount: pharmacyStatusRows.length,
    pendingPharmacyRequests,
    completedPharmacyRequests,
    medicineCategories: medicineCategoryRows,
    medicineCategoryCount: medicineCategoryRows.length,
    topMedicationClasses: topMedicationRows,
    topMedicationClassCount: topMedicationRows.length,
    labStatusBreakdown: labStatusRows,
    diagnosticRequests: labStatusRows.reduce((sum, row) => sum + toNumber(row.count), 0),
    completedLabReferrals,
    pendingLabReferrals,
    labCategoryCount: labStatusRows.length,
    labUtilizationFacilityCount: 0,
  };
}

async function getProviderIntelligence({ period, metrics } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const appointmentNgScope = `EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = a.patient_id OR u.id = a.provider_id)
      AND ${ngUserPredicate('u')}
  )`;
  const topProviders = await safeRows(
    pool,
    `SELECT a.provider_id,
            CONCAT_WS(' ', u.first_name, u.last_name) AS provider_name,
            COUNT(*)::int AS consultations,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(a.type, '')) IN ('video','telehealth','virtual','audio','phone'))::int AS teleconsultations
       FROM appointments a
       JOIN users u ON u.id = a.provider_id
      WHERE COALESCE(a.scheduled_at, a.created_at) >= $1
        AND COALESCE(a.scheduled_at, a.created_at) < $2
        AND ${appointmentNgScope}
      GROUP BY a.provider_id, provider_name
      ORDER BY consultations DESC
      LIMIT 10`,
    [start, end]
  );
  const activeProviders = toNumber(metrics.active_providers);
  const workload = activeProviders ? round(toNumber(metrics.total_consultations) / activeProviders, 1) : 0;
  return {
    topProviders,
    consultationsPerProvider: activeProviders ? round(toNumber(metrics.total_consultations) / activeProviders, 1) : 0,
    teleconsultationsPerProvider: activeProviders ? round(toNumber(metrics.teleconsultations) / activeProviders, 1) : 0,
    providerAvailabilityCount: 0,
    providerWorkloadScore: workload,
    providerResponseTime: null,
    providerCapacityWarnings: workload >= 20 ? 1 : 0,
  };
}

async function getComplaintIntelligence({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const prior = parsePeriod(previousPeriod(parsePeriod(period).period));
  const appointmentNgScope = `EXISTS (
    SELECT 1 FROM users u
    WHERE (u.id = a.patient_id OR u.id = a.provider_id)
      AND ${ngUserPredicate('u')}
  )`;
  const categorySql = `${complaintCategoryCase('a.reason_for_visit')} AS category`;
  const rows = await safeRows(
    pool,
    `SELECT ${categorySql}, COUNT(*)::int AS count
       FROM appointments a
      WHERE COALESCE(a.scheduled_at, a.created_at) >= $1
        AND COALESCE(a.scheduled_at, a.created_at) < $2
        AND ${appointmentNgScope}
      GROUP BY category
      ORDER BY count DESC
      LIMIT 12`,
    [start, end]
  );
  const priorRows = await safeRows(
    pool,
    `SELECT ${categorySql}, COUNT(*)::int AS count
       FROM appointments a
      WHERE COALESCE(a.scheduled_at, a.created_at) >= $1
        AND COALESCE(a.scheduled_at, a.created_at) < $2
        AND ${appointmentNgScope}
      GROUP BY category`,
    [prior.start, prior.end]
  );
  const byCategory = new Map(rows.map((row) => [row.category, toNumber(row.count)]));
  const priorByCategory = new Map(priorRows.map((row) => [row.category, toNumber(row.count)]));
  function trend(category) {
    return toNumber(byCategory.get(category)) - toNumber(priorByCategory.get(category));
  }
  const earlySignals = rows
    .map((row) => {
      const previous = toNumber(priorByCategory.get(row.category));
      const current = toNumber(row.count);
      const delta = current - previous;
      const percentChange = previous ? percentage(delta, previous) : null;
      const severity = previous && percentChange >= 50 && current >= 5 ? 'warning' : 'info';
      return {
        category: row.category,
        current,
        previous,
        delta,
        percentChange,
        severity,
        message: previous
          ? `${row.category} changed by ${delta >= 0 ? '+' : ''}${delta} vs previous period.`
          : `${row.category} has ${current} current-period record(s); no previous baseline yet.`,
      };
    })
    .filter((signal) => signal.current > 0)
    .slice(0, 8);

  return {
    complaintCategories: rows,
    topSymptoms: rows,
    topSymptomsCount: rows.length,
    complaintCategoryCount: rows.length,
    diagnosisCategoryCount: 0,
    feverMalariaTrend: trend('Fever / malaria-like'),
    respiratoryTrend: trend('Respiratory'),
    ncdTrend: trend('NCD / hypertension / diabetes'),
    maternalChildTrend: trend('Maternal and child health'),
    mentalHealthTrend: trend('Mental health'),
    earlySignals,
    earlySignalCount: earlySignals.length,
  };
}

async function getFinancialIntelligence({ period } = {}) {
  const pool = getPool();
  const { start, end } = parsePeriod(period);
  const revenueValue = await safeScalar(
    pool,
    `SELECT COALESCE(SUM(total_amount), 0) AS count
       FROM ng_orders
      WHERE created_at >= $1
        AND created_at < $2
        AND LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid', 'success')`,
    [start, end]
  );
  const financialConfigured = revenueValue > 0 || process.env.NG_PUBLIC_HEALTH_SERVICE_VALUE_CONFIGURED === 'true';
  return {
    financialConfigured,
    revenueValue,
    subsidizedServiceValue: null,
    estimatedServiceValue: null,
    publicSectorServiceValue: null,
    pilotValueSummary: financialConfigured ? 'Configured payment/service-value data can support pilot value summaries.' : null,
    contractJustificationSummary: financialConfigured ? 'Contract justification can combine service activity and configured value assumptions.' : null,
  };
}

async function getExecutiveDashboard(params = {}) {
  const period = parsePeriod(params.period).period;
  const [metrics, appointments, facility, referrals, pharmacyLab, complaint, financial, charts] = await Promise.all([
    getMetrics({ period, facilityId: params.facilityId, lga: params.lga }),
    getAppointmentExtraMetrics({ period }),
    getFacilityIntelligence({ period }),
    getReferralIntelligence({ period }),
    getPharmacyLabIntelligence({ period }),
    getComplaintIntelligence({ period }),
    getFinancialIntelligence({ period }),
    Promise.all([
      getChartData({ metric: 'consultations', days: 90 }),
      getChartData({ metric: 'teleconsultations', days: 90 }),
      getChartData({ metric: 'referrals', days: 90 }),
      getChartData({ metric: 'prescriptions', days: 90 }),
      getChartData({ metric: 'lab_referrals', days: 90 }),
      getChartData({ metric: 'pharmacy_referrals', days: 90 }),
      getChartData({ metric: 'registrations', days: 90 }),
    ]),
  ]);
  const provider = await getProviderIntelligence({ period, metrics });
  const [consultationForecast7, consultationForecast14, consultationForecast30, referralForecast, prescriptionForecast, labForecast, followupForecast] = await Promise.all([
    getForecast({ metric: 'consultations', range: 7, persist: false }),
    getForecast({ metric: 'consultations', range: 14, persist: false }),
    getForecast({ metric: 'consultations', range: 30, persist: false }),
    getForecast({ metric: 'referrals', range: 14, persist: false }),
    getForecast({ metric: 'prescriptions', range: 14, persist: false }),
    getForecast({ metric: 'lab_referrals', range: 14, persist: false }),
    getForecast({ metric: 'followups', range: 14, persist: false }),
  ]);

  const referralCompletionRate = percentage(metrics.referrals_completed, metrics.referrals_created);
  const referralLeakageRate = percentage(referrals.cancelledReferrals, metrics.referrals_created);
  const extra = {
    ...appointments,
    ...facility,
    ...referrals,
    ...pharmacyLab,
    ...provider,
    ...complaint,
    ...financial,
    videoSuccessRate: percentage(appointments.completedTeleconsultations, metrics.teleconsultations),
    teleconsultationAdoptionRate: percentage(metrics.teleconsultations, metrics.total_consultations),
    followupCompletionRate: percentage(appointments.followupsCompletedByProvider, metrics.followup_appointments),
    patientEngagementRate: null,
    referralCompletionRate,
    referralLeakageRate,
    forecastedMedicineDemand: prescriptionForecast.predictedValue,
    forecastedLabDemand: labForecast.predictedValue,
    medicineStockPlanningSignal: prescriptionForecast.confidenceLabel === 'insufficient_data' ? 'insufficient_data' : 'review_demand_trend',
  };

  const earlyPlanningSignals = [
    ...complaint.earlySignals.map((signal) => ({
      type: 'complaint_pattern',
      severity: signal.severity,
      title: signal.category,
      message: signal.message,
    })),
    provider.providerCapacityWarnings
      ? {
          type: 'provider_capacity',
          severity: 'warning',
          title: 'Provider capacity may need review',
          message: 'Consultations per active provider are rising enough to trigger a workload review signal.',
        }
      : null,
    prescriptionForecast.confidenceLabel !== 'insufficient_data' && prescriptionForecast.predictedValue > metrics.prescriptions_created
      ? {
          type: 'medicine_demand',
          severity: 'info',
          title: 'Medicine demand planning signal',
          message: 'Prescription demand forecast is above current-period prescription records. Review pharmacy readiness and medication categories.',
        }
      : null,
  ].filter(Boolean);

  const leadershipActions = [
    metrics.teleconsultations === 0
      ? 'Confirm teleconsultation capture and facility/provider workflow readiness before FCTA demos.'
      : 'Review teleconsultation growth against provider capacity and failed-call trends.',
    metrics.pending_referrals > 0
      ? 'Prioritize referral follow-up for pending PHC, hospital, specialist, pharmacy, and lab coordination records.'
      : 'Keep referral completion monitoring active as public-sector pilots expand.',
    facility.mapReadiness === 'coordinates_pending'
      ? 'Add PHC/public-hospital coordinates and LGA/ward mappings to enable map dashboards.'
      : 'Use mapped facility points for LGA/ward service visibility discussions.',
    financial.financialConfigured
      ? 'Use service activity and payment data to prepare contract value summaries.'
      : 'Configure approved service-value/payment assumptions before presenting financial value estimates.',
  ];

  return {
    period,
    filterState: buildFilterState(params),
    metrics,
    kpiSections: buildExecutiveKpiSections(metrics, extra),
    charts: {
      consultations: charts[0].points,
      teleconsultations: charts[1].points,
      referrals: charts[2].points,
      prescriptions: charts[3].points,
      labReferrals: charts[4].points,
      pharmacyReferrals: charts[5].points,
      registrations: charts[6].points,
    },
    forecasts: {
      consultations7Day: consultationForecast7,
      consultations14Day: consultationForecast14,
      consultations30Day: consultationForecast30,
      referrals14Day: referralForecast,
      prescriptions14Day: prescriptionForecast,
      labReferrals14Day: labForecast,
      followups14Day: followupForecast,
    },
    maps: {
      facilityPoints: facility.mapPoints,
      mapReadiness: facility.mapReadiness,
      lgaFacilityBreakdown: facility.lgaFacilityBreakdown,
      referralDirectionMap: referrals.topReferralDestinations,
    },
    tables: {
      facilityTypeBreakdown: facility.facilityTypeBreakdown,
      topReferralDestinations: referrals.topReferralDestinations,
      referralStatusBreakdown: referrals.referralStatusBreakdown,
      pharmacyFulfillmentStatus: pharmacyLab.pharmacyFulfillmentStatus,
      medicineCategories: pharmacyLab.medicineCategories,
      topMedicationClasses: pharmacyLab.topMedicationClasses,
      labStatusBreakdown: pharmacyLab.labStatusBreakdown,
      topProviders: provider.topProviders,
      complaintCategories: complaint.complaintCategories,
    },
    earlyPlanningSignals,
    leadershipActions,
    financial: {
      configured: financial.financialConfigured,
      emptyState: financial.financialConfigured ? null : 'Financial and subsidized service value reporting requires payment or service-value configuration.',
      revenueValue: financial.revenueValue,
    },
    governance: {
      aggregateOnly: true,
      noPatientIdentifiers: true,
      notClinicalDiagnosis: true,
      notOutbreakPrediction: true,
      dhis2LiveIntegrationClaimed: false,
    },
  };
}

async function upsertIndicator(input = {}) {
  const pool = getPool();
  const values = [
    input.programmeArea || input.programme_area || 'reporting',
    input.internalKey || input.internal_key,
    input.displayName || input.display_name,
    input.description || null,
    input.aggregationType || input.aggregation_type || 'count',
    input.dhis2DataElementId || input.dhis2_data_element_id || null,
    input.dhis2CategoryOptionComboId || input.dhis2_category_option_combo_id || null,
    input.active !== false,
  ];
  if (!values[1] || !values[2]) {
    const error = new Error('Indicator internalKey and displayName are required.');
    error.status = 400;
    throw error;
  }
  const result = await pool.query(
    `INSERT INTO public_health_indicators
      (programme_area, internal_key, display_name, description, aggregation_type, dhis2_data_element_id, dhis2_category_option_combo_id, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (internal_key) DO UPDATE SET
       programme_area = EXCLUDED.programme_area,
       display_name = EXCLUDED.display_name,
       description = EXCLUDED.description,
       aggregation_type = EXCLUDED.aggregation_type,
       dhis2_data_element_id = EXCLUDED.dhis2_data_element_id,
       dhis2_category_option_combo_id = EXCLUDED.dhis2_category_option_combo_id,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING *`,
    values
  );
  return result.rows[0];
}

async function patchIndicator(id, input = {}) {
  const pool = getPool();
  const updates = [];
  const values = [];
  const fields = [
    ['programmeArea', 'programme_area'],
    ['displayName', 'display_name'],
    ['description', 'description'],
    ['aggregationType', 'aggregation_type'],
    ['dhis2DataElementId', 'dhis2_data_element_id'],
    ['dhis2CategoryOptionComboId', 'dhis2_category_option_combo_id'],
    ['active', 'active'],
  ];
  for (const [camel, column] of fields) {
    if (Object.prototype.hasOwnProperty.call(input, camel) || Object.prototype.hasOwnProperty.call(input, column)) {
      values.push(input[camel] ?? input[column]);
      updates.push(`${column} = $${values.length}`);
    }
  }
  if (!updates.length) {
    const error = new Error('No indicator updates supplied.');
    error.status = 400;
    throw error;
  }
  updates.push('updated_at = NOW()');
  values.push(id);
  const result = await pool.query(
    `UPDATE public_health_indicators SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!result.rows[0]) {
    const error = new Error('Indicator not found.');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function generateReport({ period, reportType = 'monthly_aggregate', facilityId = null, lga = null, notes = null, actorUserId = null } = {}) {
  const pool = getPool();
  const parsed = parsePeriod(period);
  const [metrics, indicators] = await Promise.all([
    getMetrics({ period: parsed.period, facilityId, lga }),
    listIndicators({ activeOnly: true }),
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reportResult = await client.query(
      `INSERT INTO public_health_reports (report_period, report_type, facility_id, lga, status, generated_by, notes, metadata_json)
       VALUES ($1, $2, $3, $4, 'generated', $5, $6, $7::jsonb)
       RETURNING *`,
      [
        parsed.period,
        reportType,
        facilityId,
        lga,
        actorUserId,
        notes,
        JSON.stringify({
          generatedFrom: 'aggregate_operational_metrics',
          excludesPatientIdentifiers: true,
          governmentSubmissionStatus: 'not_submitted',
        }),
      ]
    );
    const report = reportResult.rows[0];
    for (const indicator of indicators) {
      const metricValue = Object.prototype.hasOwnProperty.call(metrics, indicator.internal_key)
        ? metrics[indicator.internal_key]
        : null;
      await client.query(
        `INSERT INTO public_health_report_values (report_id, indicator_id, value, metadata_json)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (report_id, indicator_id) DO UPDATE SET value = EXCLUDED.value, metadata_json = EXCLUDED.metadata_json`,
        [
          report.id,
          indicator.id,
          metricValue,
          JSON.stringify({
            source: 'DoctaRx aggregate operational data',
            noPatientIdentifiers: true,
            aggregationType: indicator.aggregation_type,
            dataStatus: metricValue === null ? 'unavailable' : 'observed',
          }),
        ]
      );
    }
    await client.query('COMMIT');
    await logAudit('public_health.report.generated', actorUserId, 'public_health_report', report.id, { period: parsed.period, indicatorCount: indicators.length });
    return getReport(report.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listReports({ limit = 25, page = 1, status, period } = {}) {
  const pool = getPool();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const where = [];
  const values = [];
  if (status && REPORT_STATUSES.has(status)) {
    values.push(status);
    where.push(`r.status = $${values.length}`);
  }
  if (period) {
    values.push(parsePeriod(period).period);
    where.push(`r.report_period = $${values.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await safeScalar(pool, `SELECT COUNT(*) AS count FROM public_health_reports r ${clause}`, values);
  values.push(safeLimit, (safePage - 1) * safeLimit);
  const rows = await safeRows(
    pool,
    `SELECT r.*, f.name AS facility_name,
            CONCAT_WS(' ', generated.first_name, generated.last_name) AS generated_by_name,
            CONCAT_WS(' ', approved.first_name, approved.last_name) AS approved_by_name
       FROM public_health_reports r
       LEFT JOIN public_health_facilities f ON f.id = r.facility_id
       LEFT JOIN users generated ON generated.id = r.generated_by
       LEFT JOIN users approved ON approved.id = r.approved_by
       ${clause}
      ORDER BY r.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return {
    reports: rows,
    pagination: { page: safePage, limit: safeLimit, total },
  };
}

async function getReport(id) {
  const pool = getPool();
  const reportRows = await safeRows(
    pool,
    `SELECT r.*, f.name AS facility_name,
            CONCAT_WS(' ', generated.first_name, generated.last_name) AS generated_by_name,
            CONCAT_WS(' ', approved.first_name, approved.last_name) AS approved_by_name
       FROM public_health_reports r
       LEFT JOIN public_health_facilities f ON f.id = r.facility_id
       LEFT JOIN users generated ON generated.id = r.generated_by
       LEFT JOIN users approved ON approved.id = r.approved_by
      WHERE r.id = $1`,
    [id]
  );
  const report = reportRows[0];
  if (!report) {
    const error = new Error('Public-health report not found.');
    error.status = 404;
    throw error;
  }
  const values = await safeRows(
    pool,
    `SELECT rv.*, i.internal_key, i.display_name, i.programme_area, i.aggregation_type,
            i.dhis2_data_element_id, i.dhis2_category_option_combo_id
       FROM public_health_report_values rv
       JOIN public_health_indicators i ON i.id = rv.indicator_id
      WHERE rv.report_id = $1
      ORDER BY i.programme_area, i.display_name`,
    [id]
  );
  return { report, values };
}

async function approveReport(id, actorUserId, notes) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE public_health_reports
        SET status = 'approved',
            approved_by = $2,
            approved_at = NOW(),
            notes = COALESCE($3, notes),
            updated_at = NOW()
      WHERE id = $1 AND status IN ('generated', 'draft')
      RETURNING *`,
    [id, actorUserId, notes || null]
  );
  if (!result.rows[0]) {
    const error = new Error('Report must exist and be in draft/generated status before approval.');
    error.status = 400;
    throw error;
  }
  await logAudit('public_health.report.approved', actorUserId, 'public_health_report', id);
  return getReport(id);
}

function reportToJson(reportBundle) {
  const { report, values } = reportBundle;
  const normalizeReportedValue = (rawValue) => {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  };
  const byKey = Object.fromEntries(values.map((row) => [row.internal_key, normalizeReportedValue(row.value)]));
  const value = (key) => (Object.prototype.hasOwnProperty.call(byKey, key) ? byKey[key] : null);
  const positiveMessage = (key, presentMessage, zeroMessage) => {
    const metricValue = value(key);
    if (metricValue === null) return `Data unavailable for ${key.replaceAll('_', ' ')}.`;
    return metricValue > 0 ? presentMessage(metricValue) : zeroMessage;
  };
  const sumWhenComplete = (...keys) => {
    const metricValues = keys.map(value);
    return metricValues.some((metricValue) => metricValue === null)
      ? null
      : metricValues.reduce((sum, metricValue) => sum + metricValue, 0);
  };
  const sections = {
    executiveSummary: {
      keyWins: [
        positiveMessage('completed_consultations', (count) => `${count} completed consultation(s) recorded.`, 'No completed consultations found for this period.'),
        positiveMessage('teleconsultations', (count) => `${count} teleconsultation(s) recorded.`, 'No teleconsultation activity found for this period.'),
        positiveMessage('referrals_completed', (count) => `${count} referral(s) completed.`, 'No completed referrals found for this period.'),
      ],
      keyRisks: [
        positiveMessage('pending_referrals', (count) => `${count} referral(s) remain pending and may need coordination review.`, 'No pending referral pressure detected from available data.'),
        positiveMessage('failed_video_sessions', (count) => `${count} failed video session(s) may affect digital access.`, 'No failed video sessions recorded from available data.'),
      ],
      recommendedNextActions: [
        'Review staffing and teleconsultation coverage where demand is rising.',
        'Review pending referrals and follow-up completion before the next reporting cycle.',
        'Complete DHIS2 indicator and facility mappings before official submission.',
      ],
    },
    serviceDeliverySummary: {
      consultations: value('total_consultations'),
      teleconsultations: value('teleconsultations'),
      appointments: value('appointment_bookings'),
      followUps: value('followup_appointments'),
      patientRegistrations: value('new_patient_registrations'),
      completedConsultations: value('completed_consultations'),
      cancelledConsultations: value('cancelled_consultations'),
    },
    referralSummary: {
      referralsCreated: value('referrals_created'),
      referralsCompleted: value('referrals_completed'),
      pendingReferrals: value('pending_referrals'),
      labReferrals: value('lab_referrals'),
      pharmacyReferrals: value('pharmacy_referrals'),
      bottleneckSignal: value('pending_referrals') === null
        ? 'data_unavailable'
        : value('pending_referrals') > 0
          ? 'pending_referrals_need_review'
          : 'no_pending_referral_signal',
    },
    facilityProviderSummary: {
      activeFacilities: value('active_facilities'),
      activeProviders: value('active_providers'),
      workloadSignal: sumWhenComplete('total_consultations', 'referrals_created', 'followup_appointments'),
    },
    pharmacyPrescriptionSummary: {
      prescriptionsCreated: value('prescriptions_created'),
      pharmacyReferrals: value('pharmacy_referrals'),
      medicineDemandSignal: value('prescriptions_created') === null
        ? 'data_unavailable'
        : value('prescriptions_created') > 0
          ? 'medicine_demand_visible'
          : 'no_prescription_demand_data',
    },
    labDiagnosticSummary: {
      labReferrals: value('lab_referrals'),
      diagnosticDemandSignal: value('lab_referrals') === null
        ? 'data_unavailable'
        : value('lab_referrals') > 0
          ? 'lab_referral_demand_visible'
          : 'no_lab_referral_data',
    },
    diseaseComplaintPatternSummary: {
      cancerCareCoordinationReferrals: value('cancer_related_referrals'),
      note: 'Complaint, symptom, and diagnosis category summaries require structured complaint/diagnosis category capture. No patient identifiers are included.',
    },
    geographicEquitySummary: {
      lga: report.lga || null,
      facilityName: report.facility_name || null,
      note: 'LGA, ward, underserved-area, and referral-flow details require mapped facility and location fields.',
    },
    forecastingSummary: {
      methods: ['simple_moving_average', 'weighted_moving_average', 'linear_trend_projection'],
      note: 'Forecast values are generated through the forecasting endpoint from aggregate operational history; no clinical diagnosis or outbreak prediction is claimed.',
    },
    planningIntelligence: {
      staffingSignal: value('total_consultations') === null ? 'data_unavailable' : value('total_consultations') > 0 ? 'review_provider_capacity_against_consultation_demand' : 'insufficient_service_data',
      medicinePlanningSignal: value('prescriptions_created') === null ? 'data_unavailable' : value('prescriptions_created') > 0 ? 'review_medicine_category_demand' : 'insufficient_prescription_data',
      referralPressureSignal: value('pending_referrals') === null ? 'data_unavailable' : value('pending_referrals') > 0 ? 'review_pending_referral_queue' : 'no_pending_referral_pressure',
      dataQualityIssues: values.filter((row) => !row.dhis2_data_element_id).map((row) => `Missing DHIS2 mapping: ${row.internal_key}`),
      unavailableIndicators: values.filter((row) => normalizeReportedValue(row.value) === null).map((row) => row.internal_key),
    },
    dhis2ReadinessSummary: {
      configuredIndicators: values.filter((row) => row.dhis2_data_element_id).length,
      missingIndicators: values.filter((row) => !row.dhis2_data_element_id).length,
      reportApprovalStatus: report.status,
      liveSubmissionStatus: 'not_submitted',
    },
    governanceAndAuditSummary: {
      generatedBy: report.generated_by_name || null,
      approvedBy: report.approved_by_name || null,
      approvedAt: report.approved_at || null,
      privacy: 'Aggregate only. No patient names, emails, phone numbers, addresses, DOB, or patient-level identifiers are included.',
    },
  };
  return {
    report: {
      id: report.id,
      reportPeriod: report.report_period,
      reportType: report.report_type,
      status: report.status,
      facilityId: report.facility_id,
      facilityName: report.facility_name,
      lga: report.lga,
      generatedBy: report.generated_by_name,
      approvedBy: report.approved_by_name,
      approvedAt: report.approved_at,
      notes: report.notes,
      governance: {
        aggregateOnly: true,
        excludesPatientIdentifiers: true,
        liveDhis2Integration: false,
      },
    },
    intelligenceReport: sections,
    values: values.map((row) => ({
      internalKey: row.internal_key,
      displayName: row.display_name,
      programmeArea: row.programme_area,
      value: normalizeReportedValue(row.value),
      dataStatus: normalizeReportedValue(row.value) === null ? 'unavailable' : 'observed',
      aggregationType: row.aggregation_type,
      dhis2Mapped: Boolean(row.dhis2_data_element_id),
    })),
  };
}

function reportToCsv(reportBundle) {
  const lines = [
    ['report_id', 'report_period', 'status', 'programme_area', 'internal_key', 'display_name', 'value', 'aggregation_type', 'dhis2_data_element_id'].join(','),
  ];
  for (const row of reportBundle.values) {
    lines.push([
      reportBundle.report.id,
      reportBundle.report.report_period,
      reportBundle.report.status,
      row.programme_area,
      row.internal_key,
      `"${String(row.display_name || '').replace(/"/g, '""')}"`,
      row.value === null || row.value === undefined ? '' : toNumber(row.value),
      row.aggregation_type,
      row.dhis2_data_element_id || '',
    ].join(','));
  }
  return lines.join('\n');
}

function assertNoPatientIdentifiers(payload) {
  const serialized = JSON.stringify(payload).toLowerCase();
  const blockedKeys = ['patient_name', 'first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'dob', 'address'];
  return !blockedKeys.some((key) => serialized.includes(key));
}

function prepareDhis2DataValues(values = []) {
  const dataValues = [];
  const missingMappings = [];
  const missingValues = [];

  for (const row of values) {
    if (!row.dhis2_data_element_id) {
      missingMappings.push({
        internalKey: row.internal_key,
        displayName: row.display_name,
      });
      continue;
    }
    if (row.value === null || row.value === undefined || row.value === '') {
      missingValues.push({
        internalKey: row.internal_key,
        displayName: row.display_name,
        dataElement: row.dhis2_data_element_id,
      });
      continue;
    }
    const numericValue = Number(row.value);
    if (!Number.isFinite(numericValue)) {
      missingValues.push({
        internalKey: row.internal_key,
        displayName: row.display_name,
        dataElement: row.dhis2_data_element_id,
      });
      continue;
    }
    dataValues.push({
      dataElement: row.dhis2_data_element_id,
      categoryOptionCombo: row.dhis2_category_option_combo_id || undefined,
      value: numericValue,
    });
  }

  return { dataValues, missingMappings, missingValues };
}

async function buildDhis2Preview(reportId) {
  const [reportBundle, settingsRow] = await Promise.all([getReport(reportId), getSettingsRaw()]);
  const settings = publicSettings(settingsRow);
  const warnings = [];

  if (!settings.datasetId) warnings.push('DHIS2 dataset ID is not configured.');
  if (!settings.orgUnitId && !reportBundle.report.facility_id) warnings.push('DHIS2 organisation-unit ID is not configured.');
  if (settings.governmentApprovalStatus !== 'approved') warnings.push('Government reporting approval is pending.');
  if (settings.apiCredentialsStatus !== 'configured') warnings.push('DHIS2 API credentials are pending.');
  if (settings.dataSharingAgreementStatus !== 'approved') warnings.push('Data-sharing agreement is pending.');

  const { dataValues, missingMappings, missingValues } = prepareDhis2DataValues(reportBundle.values);

  if (missingMappings.length) {
    warnings.push(`${missingMappings.length} indicator(s) are missing official DHIS2 data-element mappings.`);
  }
  if (missingValues.length) {
    warnings.push(`${missingValues.length} mapped indicator(s) have unavailable source data and were omitted.`);
  }

  const payload = {
    dataSet: settings.datasetId || null,
    completeDate: isoDate(new Date()),
    period: parsePeriod(reportBundle.report.report_period).dhis2Period,
    orgUnit: settings.orgUnitId || null,
    attributeOptionCombo: settings.attributeOptionComboId || undefined,
    dataValues,
  };

  if (!assertNoPatientIdentifiers(payload)) {
    const error = new Error('DHIS2 preview contains a blocked patient identifier key.');
    error.status = 500;
    throw error;
  }

  return {
    reportId,
    dryRunOnly: true,
    liveSubmissionEnabled: false,
    payload,
    warnings,
    missingMappings,
    missingValues,
    payloadHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

function validateDhis2Sync(reportBundle, settings, preview) {
  const blockers = [];
  if (!settings.enabled) blockers.push('DHIS2 integration is disabled.');
  if (settings.dryRunOnly) blockers.push('DHIS2 integration is configured for dry-run only.');
  if (process.env.DHIS2_ALLOW_LIVE_SYNC !== 'true') blockers.push('Server live sync safety flag DHIS2_ALLOW_LIVE_SYNC is not enabled.');
  if (reportBundle.report.status !== 'approved') blockers.push('Report must be approved before any sync attempt.');
  if (!settings.datasetId) blockers.push('Dataset ID is missing.');
  if (!settings.orgUnitId) blockers.push('Organisation-unit ID is missing.');
  if (preview.missingMappings.length) blockers.push('One or more report indicators are missing DHIS2 data-element mappings.');
  if (preview.missingValues.length) blockers.push('One or more mapped report indicators have unavailable source data.');
  if (settings.governmentApprovalStatus !== 'approved') blockers.push('Government reporting approval is pending.');
  if (settings.dataSharingAgreementStatus !== 'approved') blockers.push('Data-sharing agreement is pending.');
  if (settings.apiCredentialsStatus !== 'configured') blockers.push('API credentials are pending.');
  return blockers;
}

async function dryRunDhis2(reportId, actorUserId) {
  const preview = await buildDhis2Preview(reportId);
  const pool = getPool();
  await pool.query(
    `INSERT INTO dhis2_sync_logs (report_id, status, request_payload_hash, response_status, response_body_summary, attempted_by)
     VALUES ($1, 'dry_run_preview', $2, 'not_submitted', $3, $4)`,
    [reportId, preview.payloadHash, `Preview generated with ${preview.warnings.length} warning(s).`, actorUserId || null]
  );
  await logAudit('public_health.dhis2.dry_run', actorUserId, 'public_health_report', reportId, { warningCount: preview.warnings.length });
  return preview;
}

async function syncDhis2(reportId, actorUserId) {
  const [reportBundle, settingsRow, preview] = await Promise.all([
    getReport(reportId),
    getSettingsRaw(),
    buildDhis2Preview(reportId),
  ]);
  const settings = publicSettings(settingsRow);
  const blockers = validateDhis2Sync(reportBundle, settings, preview);
  const pool = getPool();
  if (blockers.length) {
    await pool.query(
      `INSERT INTO dhis2_sync_logs (report_id, status, request_payload_hash, response_status, response_body_summary, error_message, attempted_by)
       VALUES ($1, 'blocked', $2, 'not_submitted', 'Live sync blocked by readiness rules.', $3, $4)`,
      [reportId, preview.payloadHash, blockers.join(' '), actorUserId || null]
    );
    const error = new Error(blockers.join(' '));
    error.status = 409;
    error.blockers = blockers;
    error.preview = preview;
    throw error;
  }

  const baseUrl = decryptSettingValue(settingsRow, 'base_url');
  const username = decryptSettingValue(settingsRow, 'username');
  const apiToken = decryptSettingValue(settingsRow, 'api_token');
  if (!baseUrl || !apiToken) {
    const error = new Error('DHIS2 endpoint and API token are not configured.');
    error.status = 409;
    throw error;
  }

  const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/api/dataValueSets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: username ? `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}` : `ApiToken ${apiToken}`,
    },
    body: JSON.stringify(preview.payload),
  });
  const body = await response.text();
  await pool.query(
    `INSERT INTO dhis2_sync_logs (report_id, status, request_payload_hash, response_status, response_body_summary, attempted_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reportId, response.ok ? 'submitted' : 'failed', preview.payloadHash, String(response.status), body.slice(0, 1000), actorUserId || null]
  );
  await pool.query(
    `UPDATE public_health_reports SET status = $2, updated_at = NOW() WHERE id = $1`,
    [reportId, response.ok ? 'synced' : 'sync_failed']
  );
  await logAudit('public_health.dhis2.sync_attempt', actorUserId, 'public_health_report', reportId, { status: response.status });
  return { ok: response.ok, status: response.status, bodySummary: body.slice(0, 1000), preview };
}

async function getSyncLogs({ limit = 50 } = {}) {
  const pool = getPool();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const rows = await safeRows(
    pool,
    `SELECT l.*, r.report_period
       FROM dhis2_sync_logs l
       LEFT JOIN public_health_reports r ON r.id = l.report_id
      ORDER BY l.attempted_at DESC
      LIMIT $1`,
    [safeLimit]
  );
  return { logs: rows };
}

async function updateSettings(input = {}, actorUserId) {
  const pool = getPool();
  const current = await getSettingsRaw();
  const encrypted = {};
  for (const [inputKey, columnPrefix] of [
    ['baseUrl', 'base_url'],
    ['username', 'username'],
    ['apiToken', 'api_token'],
  ]) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey)) {
      const value = input[inputKey] ? String(input[inputKey]) : null;
      if (value) {
        const secret = encrypt(value);
        encrypted[`${columnPrefix}_encrypted`] = secret.encrypted;
        encrypted[`${columnPrefix}_iv`] = secret.iv;
        encrypted[`${columnPrefix}_tag`] = secret.tag;
      } else {
        encrypted[`${columnPrefix}_encrypted`] = null;
        encrypted[`${columnPrefix}_iv`] = null;
        encrypted[`${columnPrefix}_tag`] = null;
      }
    }
  }

  const payload = {
    environment: input.environment || current.environment || 'disabled',
    dataset_id: input.datasetId ?? input.dataset_id ?? current.dataset_id ?? null,
    org_unit_id: input.orgUnitId ?? input.org_unit_id ?? current.org_unit_id ?? null,
    attribute_option_combo_id: input.attributeOptionComboId ?? input.attribute_option_combo_id ?? current.attribute_option_combo_id ?? null,
    enabled: input.enabled === true,
    dry_run_only: input.dryRunOnly !== false,
    government_approval_status: input.governmentApprovalStatus || input.government_approval_status || current.government_approval_status || 'pending',
    api_credentials_status: input.apiCredentialsStatus || input.api_credentials_status || current.api_credentials_status || 'pending',
    data_sharing_agreement_status: input.dataSharingAgreementStatus || input.data_sharing_agreement_status || current.data_sharing_agreement_status || 'pending',
    ndpr_review_status: input.ndprReviewStatus || input.ndpr_review_status || current.ndpr_review_status || 'pending',
    ...encrypted,
  };

  const existingId = current.id || null;
  const columns = Object.keys(payload);
  const values = columns.map((column) => payload[column]);
  let row;
  if (existingId) {
    values.push(actorUserId || null, existingId);
    const updates = columns.map((column, index) => `${column} = $${index + 1}`);
    const result = await pool.query(
      `UPDATE dhis2_integration_settings
          SET ${updates.join(', ')}, updated_by = $${values.length - 1}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    row = result.rows[0];
  } else {
    values.push(actorUserId || null, actorUserId || null);
    const result = await pool.query(
      `INSERT INTO dhis2_integration_settings (${columns.join(', ')}, created_by, updated_by)
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}, $${values.length - 1}, $${values.length})
       RETURNING *`,
      values
    );
    row = result.rows[0];
  }
  await logAudit('public_health.dhis2.settings_updated', actorUserId, 'dhis2_integration_settings', row.id, { changedFields: Object.keys(input).filter((key) => key !== 'apiToken') });
  return publicSettings(row);
}

function movingAverage(values, range) {
  if (values.length < 7) {
    return {
      predictedValue: 0,
      confidenceLabel: 'insufficient_data',
      method: 'simple_moving_average',
      explanation: 'Not enough historical data yet. Forecasting will improve as more completed consultations and facility activity are captured.',
    };
  }
  const window = values.slice(-Math.min(values.length, 14));
  const average = window.reduce((sum, value) => sum + value, 0) / window.length;
  return {
    predictedValue: Math.max(0, Math.round(average * range)),
    confidenceLabel: values.length >= 45 ? 'high' : values.length >= 21 ? 'medium' : 'low',
    method: 'simple_moving_average',
    explanation: `Projected from the last ${window.length} day(s) of aggregate activity. This is operational demand planning, not clinical prediction.`,
  };
}

function weightedMovingAverage(values, range) {
  if (values.length < 7) {
    return {
      predictedValue: 0,
      confidenceLabel: 'insufficient_data',
      method: 'weighted_moving_average',
      explanation: 'Not enough historical data yet. Forecasting will improve as more completed consultations and facility activity are captured.',
    };
  }
  const window = values.slice(-Math.min(values.length, 14));
  const denominator = window.reduce((sum, _value, index) => sum + index + 1, 0);
  const weighted = window.reduce((sum, value, index) => sum + value * (index + 1), 0) / denominator;
  return {
    predictedValue: Math.max(0, Math.round(weighted * range)),
    confidenceLabel: values.length >= 45 ? 'high' : values.length >= 21 ? 'medium' : 'low',
    method: 'weighted_moving_average',
    explanation: `Recent days are weighted more heavily across the last ${window.length} day(s). This supports staffing and facility workload planning only.`,
  };
}

function linearTrendProjection(values, range) {
  if (values.length < 14) {
    return movingAverage(values, range);
  }
  const n = values.length;
  const xs = values.map((_value, index) => index + 1);
  const sumX = xs.reduce((sum, value) => sum + value, 0);
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + value * xs[index], 0);
  const sumX2 = xs.reduce((sum, value) => sum + value * value, 0);
  const slope = (n * sumXY - sumX * sumY) / Math.max(1, n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  let total = 0;
  for (let i = 1; i <= range; i += 1) {
    total += Math.max(0, intercept + slope * (n + i));
  }
  return {
    predictedValue: Math.max(0, Math.round(total)),
    confidenceLabel: values.length >= 45 ? 'high' : values.length >= 21 ? 'medium' : 'low',
    method: 'linear_trend_projection',
    explanation: 'Projected using a simple linear trend over aggregate historical activity. This is not outbreak prediction or clinical diagnosis.',
  };
}

async function getForecast({ metric = 'consultations', range = 7, method = 'weighted_moving_average', persist = true } = {}) {
  const days = 60;
  const safeRange = FORECAST_RANGES.has(Number(range)) ? Number(range) : 7;
  const chart = await getChartData({ metric, days });
  const values = chart.points.map((point) => toNumber(point.value));
  const forecast = method === 'linear_trend_projection'
    ? linearTrendProjection(values, safeRange)
    : method === 'simple_moving_average'
      ? movingAverage(values, safeRange)
      : weightedMovingAverage(values, safeRange);
  const start = new Date();
  const end = new Date(Date.now() + safeRange * 24 * 60 * 60 * 1000);
  if (persist) {
    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO public_health_forecasts
          (forecast_type, period_start, period_end, forecast_range_days, metric_key, predicted_value, confidence_label, method, metadata_json)
         VALUES ('operational_demand', $1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          isoDate(start),
          isoDate(end),
          safeRange,
          metric,
          forecast.predictedValue,
          forecast.confidenceLabel,
          forecast.method,
          JSON.stringify({ historicalPointCount: values.length, explanation: forecast.explanation }),
        ]
      );
    } catch (error) {
      if (!isMissingDbObject(error)) throw error;
    }
  }
  return {
    metric,
    rangeDays: safeRange,
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    historicalPoints: chart.points,
    ...forecast,
  };
}

async function getInsights({ period } = {}) {
  const currentPeriod = parsePeriod(period).period;
  const priorPeriod = previousPeriod(currentPeriod);
  const [current, prior] = await Promise.all([
    getMetrics({ period: currentPeriod }),
    getMetrics({ period: priorPeriod }),
  ]);
  const insights = [];
  function compare(key, title, noun) {
    const currentValue = current[key] || 0;
    const priorValue = prior[key] || 0;
    if (!currentValue && !priorValue) return;
    const delta = currentValue - priorValue;
    if (delta > 0) {
      insights.push({
        insightType: 'trend',
        severity: 'info',
        title,
        message: `${noun} increased compared with the previous period (${currentValue} vs ${priorValue}).`,
        metricKey: key,
        period: currentPeriod,
      });
    } else if (delta < 0) {
      insights.push({
        insightType: 'trend',
        severity: 'info',
        title,
        message: `${noun} decreased compared with the previous period (${currentValue} vs ${priorValue}). Review whether this reflects demand, staffing, or data capture changes.`,
        metricKey: key,
        period: currentPeriod,
      });
    }
  }
  compare('total_consultations', 'Consultation demand changed', 'Consultation demand');
  compare('referrals_created', 'Referral volume changed', 'Referral volume');
  compare('teleconsultations', 'Teleconsultation demand changed', 'Teleconsultation demand');
  compare('prescriptions_created', 'Prescription demand changed', 'Prescription demand');
  if (!insights.length) {
    insights.push({
      insightType: 'readiness',
      severity: 'info',
      title: 'Not enough data yet for reliable trend insights',
      message: 'Planning insights will improve as completed consultations, referrals, prescriptions, and facility activity are captured.',
      metricKey: 'insufficient_data',
      period: currentPeriod,
    });
  }
  return { period: currentPeriod, insights };
}

async function getAuditLogs({ limit = 50 } = {}) {
  const pool = getPool();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const logs = await safeRows(
    pool,
    `SELECT l.*, CONCAT_WS(' ', u.first_name, u.last_name) AS actor_name, u.email AS actor_email
       FROM public_health_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
      ORDER BY l.created_at DESC
      LIMIT $1`,
    [safeLimit]
  );
  return { logs };
}

async function testConnection() {
  const settings = publicSettings(await getSettingsRaw());
  const readiness = buildReadiness(settings, await listIndicators());
  return {
    status: settings.enabled ? 'configured_for_review' : 'disabled',
    liveConnectionAttempted: false,
    message: 'No live DHIS2/NHMIS connection was attempted. Official approval, credentials, dataset IDs, organisation-unit IDs, and mappings are required before live sync.',
    settings,
    readiness,
  };
}

module.exports = {
  PROGRAMME_AREAS,
  METRIC_LABELS,
  parsePeriod,
  movingAverage,
  weightedMovingAverage,
  linearTrendProjection,
  assertNoPatientIdentifiers,
  prepareDhis2DataValues,
  reportToJson,
  reportToCsv,
  buildReadiness,
  buildFilterState,
  validateDhis2Sync,
  getOverview,
  getExecutiveDashboard,
  getProgrammeAreas,
  getAnalytics,
  getChartData,
  listIndicators,
  upsertIndicator,
  patchIndicator,
  generateReport,
  listReports,
  getReport,
  approveReport,
  buildDhis2Preview,
  dryRunDhis2,
  syncDhis2,
  getSettings: async () => publicSettings(await getSettingsRaw()),
  updateSettings,
  testConnection,
  getSyncLogs,
  getForecast,
  getInsights,
  getAuditLogs,
  getActorId,
};
