'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  FileJson,
  FileText,
  FlaskConical,
  HeartPulse,
  LineChart as LineChartIcon,
  Loader2,
  Lock,
  MapPin,
  Pill,
  RefreshCw,
  Settings,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  UploadCloud,
  Users,
  Video,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const tabs = [
  ['executive', 'Executive Intelligence'],
  ['overview', 'Overview'],
  ['areas', 'Programme Areas'],
  ['patient-access', 'Patient Access'],
  ['teleconsultation', 'Teleconsultation'],
  ['referrals', 'Referrals'],
  ['pharmacy-lab', 'Pharmacy & Lab'],
  ['facilities', 'Facilities'],
  ['analytics', 'Analytics'],
  ['forecasting', 'Forecasting'],
  ['reports', 'Reports'],
  ['dhis2', 'DHIS2 Readiness'],
  ['competitive', 'Competitive Coverage'],
  ['settings', 'Settings'],
  ['audit', 'Audit Logs'],
];

const competitiveCoverageGroups = [
  {
    title: 'Patient and Access Features',
    items: [
      ['Patient registration', 'ready'],
      ['Patient portal', 'ready'],
      ['Mobile-first interface', 'ready'],
      ['Facility discovery', 'ready'],
      ['Provider discovery', 'ready'],
      ['Appointment booking', 'ready'],
      ['Teleconsultation booking', 'ready'],
      ['Follow-up booking', 'ready'],
      ['Push/SMS/WhatsApp notification hooks', 'ready'],
      ['QR code access', 'ready'],
      ['Low-bandwidth access considerations', 'ready'],
    ],
  },
  {
    title: 'Telemedicine Features',
    items: [
      ['Video consultations', 'ready'],
      ['Audio fallback', 'ready'],
      ['Secure consultation notes', 'ready'],
      ['Provider workflow', 'ready'],
      ['Consultation status tracking', 'ready'],
      ['Failed call tracking', 'ready'],
      ['Follow-up scheduling', 'ready'],
      ['Specialist referral support', 'ready'],
    ],
  },
  {
    title: 'Pharmacy, Medication, Lab, and Diagnostics',
    items: [
      ['Prescription records', 'ready'],
      ['Prescription coordination', 'ready'],
      ['Pharmacy referral/routing', 'ready'],
      ['Medicine availability workflow placeholder', 'data-dependent'],
      ['Medicine demand tracking', 'ready'],
      ['Medication category reporting', 'ready'],
      ['Medicine demand forecasting', 'ready'],
      ['Lab referral workflow', 'ready'],
      ['Diagnostic request tracking', 'data-dependent'],
      ['Lab utilization reporting', 'ready'],
      ['Lab demand forecasting', 'ready'],
    ],
  },
  {
    title: 'Care Coordination and Operations',
    items: [
      ['PHC-to-hospital referrals', 'ready'],
      ['Hospital-to-specialist referrals', 'ready'],
      ['Pharmacy referrals', 'ready'],
      ['Lab referrals', 'ready'],
      ['Referral status tracking', 'ready'],
      ['Referral completion time', 'data-dependent'],
      ['Referral dashboard', 'ready'],
      ['Care navigation support', 'data-dependent'],
      ['Follow-up reminders', 'ready'],
      ['Facility dashboard', 'ready'],
      ['Provider dashboard', 'ready'],
      ['Facility utilization metrics', 'ready'],
      ['Provider activity metrics', 'ready'],
      ['Workload visibility', 'ready'],
    ],
  },
  {
    title: 'Public-Sector Differentiators',
    items: [
      ['NHMIS/DHIS2-ready aggregate reporting', 'ready'],
      ['Indicator mapping', 'ready'],
      ['Facility/org-unit mapping placeholders', 'ready'],
      ['Report approval workflow', 'ready'],
      ['Audit logs', 'ready'],
      ['Dry-run DHIS2 preview', 'ready'],
      ['CSV/JSON export', 'ready'],
      ['Executive dashboards', 'ready'],
      ['Maps or map-ready heatmaps', 'ready'],
      ['Trend forecasting', 'ready'],
      ['Demand forecasting', 'ready'],
      ['Operational prediction', 'ready'],
      ['Early signal detection', 'ready'],
      ['Planning intelligence', 'ready'],
      ['Data-supported decision-making', 'ready'],
      ['Public-health visibility', 'ready'],
    ],
  },
  {
    title: 'Government Inputs Still Required',
    items: [
      ['Official DHIS2 dataset IDs', 'pending'],
      ['Official organisation-unit IDs', 'pending'],
      ['Official data-element IDs', 'pending'],
      ['Government reporting approval', 'pending'],
      ['API credentials', 'pending'],
      ['Data-sharing agreement', 'pending'],
      ['NDPR/privacy review sign-off', 'pending'],
    ],
  },
];

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function formatExecutiveValue(item) {
  if (!item?.available) return 'Not configured';
  if (item.unit === 'percent') return `${number(item.value)}%`;
  if (item.unit === 'minutes') return `${number(item.value)} min`;
  if (item.unit === 'hours') return `${number(item.value)} hrs`;
  if (item.unit === 'ngn') return `NGN ${number(item.value)}`;
  if (item.unit === 'ratio') return number(item.value);
  if (item.unit === 'signal' || item.unit === 'summary') return item.value || 'Review';
  return number(item.value);
}

function statusClass(status) {
  if (['ready', 'approved', 'configured', 'active', 'generated', 'exported', 'synced', 'high'].includes(String(status))) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (['pending', 'dry_run_only', 'data-dependent', 'low', 'medium', 'government_and_mapping_pending'].includes(String(status))) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (['missing', 'critical', 'sync_failed', 'rejected'].includes(String(status))) {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function StatusPill({ status }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(status)}`}>
      {String(status || 'not configured').replace(/_/g, ' ')}
    </span>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-700">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-2 leading-6">{body}</p>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon = Activity }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="flex items-start gap-4 p-5">
        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{number(value)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, description, data, type = 'line' }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!data?.length ? (
          <EmptyState title="No chart data yet" body="This chart will populate from real operational activity as records are captured." />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {type === 'bar' ? (
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#047857" strokeWidth={2} dot={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutiveKpiSection({ section }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{section.title}</CardTitle>
        {section.emptyState && <CardDescription>{section.emptyState}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(section.items || []).map((item) => (
          <div
            key={`${section.key}-${item.label}`}
            className={`rounded-lg border p-3 ${item.available ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className={`mt-2 text-lg font-bold ${item.available ? 'text-slate-950' : 'text-amber-900'}`}>{formatExecutiveValue(item)}</p>
            {item.emptyState && !item.available && <p className="mt-2 text-xs leading-5 text-amber-800">{item.emptyState}</p>}
            {item.description && <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function IntelligenceMap({ mapData }) {
  const points = mapData?.facilityPoints || [];
  if (!points.length) {
    return (
      <EmptyState
        title="Map data needs facility coordinates"
        body="Add PHC, public hospital, LGA, ward, latitude, and longitude mappings to show real facility workload and referral maps. No fake map points are generated."
      />
    );
  }
  const latitudes = points.map((point) => Number(point.latitude));
  const longitudes = points.map((point) => Number(point.longitude));
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const scale = (value, min, max) => {
    if (max === min) return 50;
    return 8 + ((value - min) / (max - min)) * 84;
  };
  return (
    <div className="relative h-80 overflow-hidden rounded-xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,#d1fae5,transparent_35%),linear-gradient(135deg,#f8fafc,#ecfeff)]">
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)', backgroundSize: '42px 42px' }} />
      {points.map((point) => {
        const left = scale(Number(point.longitude), minLng, maxLng);
        const top = 100 - scale(Number(point.latitude), minLat, maxLat);
        return (
          <div
            key={point.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-600 p-1 shadow-lg"
            style={{ left: `${left}%`, top: `${top}%` }}
            title={`${point.name} (${point.lga || point.city || 'unmapped'})`}
          >
            <MapPin className="h-4 w-4 text-white" />
          </div>
        );
      })}
      <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-white/70 bg-white/90 p-3 text-xs text-slate-700 shadow-sm">
        <p className="font-semibold text-slate-950">{points.length} mapped facility point(s)</p>
        <p className="mt-1">Map uses configured facility coordinates only. Workload overlays appear when facility-linked activity exists.</p>
      </div>
    </div>
  );
}

function CompactTable({ title, rows, columns, empty }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows?.length ? (
          <EmptyState title="No data yet" body={empty || 'This table will populate from real operational records as data is captured.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>{columns.map((column) => <th key={column.key} className="px-3 py-2">{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id || row.provider_id || row.category || row.destination || row.status || index} className="border-t border-slate-200">
                    {columns.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-slate-700">
                        {column.render ? column.render(row) : (row[column.key] ?? 'N/A')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ForecastCard({ title, forecast }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{title}</CardTitle>
        <CardDescription>{forecast?.method ? `Method: ${String(forecast.method).replace(/_/g, ' ')}` : 'Forecasting uses aggregate operational history only.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-slate-950">{number(forecast?.predictedValue)}</p>
        <div className="mt-3">
          <StatusPill status={forecast?.confidenceLabel || 'insufficient_data'} />
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {forecast?.explanation || 'Not enough historical data yet. Forecasting will improve as more completed consultations and facility activity are captured.'}
        </p>
      </CardContent>
    </Card>
  );
}

function CompetitiveCoverageGroup({ group }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{group.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(group.items || []).map(([label, status]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="font-medium text-slate-800">{label}</span>
            <StatusPill status={status} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProgrammeAreaCard({ area }) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-lg text-slate-950">{area.title}</CardTitle>
        <CardDescription className="leading-6">{area.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {(area.metrics || []).map((metric) => (
          <div key={metric.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
            <p className="mt-2 text-lg font-bold text-slate-950">{typeof metric.value === 'number' ? number(metric.value) : metric.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function PublicHealthProgrammeDashboard({ initialTab = 'overview' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [period, setPeriod] = useState(currentPeriod());
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    facilityId: '',
    facilityType: '',
    lga: '',
    ward: '',
    providerId: '',
    programmeArea: '',
  });
  const [executive, setExecutive] = useState(null);
  const [overview, setOverview] = useState(null);
  const [areas, setAreas] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [reports, setReports] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dhis2Settings, setDhis2Settings] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    environment: 'disabled',
    datasetId: '',
    orgUnitId: '',
    attributeOptionComboId: '',
    governmentApprovalStatus: 'pending',
    apiCredentialsStatus: 'pending',
    dataSharingAgreementStatus: 'pending',
    ndprReviewStatus: 'pending',
    enabled: false,
    dryRunOnly: true,
  });

  const metrics = overview?.metrics || {};
  const readiness = overview?.dhis2Readiness || {};
  const charts = analytics?.charts || {};
  const executiveCharts = executive?.charts || {};
  const executiveForecasts = executive?.forecasts || {};
  const executiveTables = executive?.tables || {};
  const executiveMaps = executive?.maps || {};

  const metricIcons = useMemo(() => ({
    total_consultations: Stethoscope,
    teleconsultations: Video,
    completed_consultations: CheckCircle2,
    cancelled_consultations: Activity,
    failed_video_sessions: Video,
    audio_fallback_sessions: Activity,
    active_patients: Users,
    new_patient_registrations: Users,
    patient_access_requests: HeartPulse,
    appointment_bookings: ClipboardList,
    followup_appointments: ClipboardList,
    referrals_created: UploadCloud,
    referrals_completed: CheckCircle2,
    pending_referrals: ClipboardList,
    prescriptions_created: Pill,
    pharmacy_referrals: Pill,
    lab_referrals: FlaskConical,
    active_providers: Stethoscope,
    active_facilities: Building2,
    notifications_sent: Activity,
    reports_generated: FileText,
    cancer_related_referrals: HeartPulse,
  }), []);

  function buildQuery(extra = {}) {
    return Object.fromEntries(
      Object.entries({ period, ...filters, ...extra }).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const query = buildQuery();
      const [executiveRes, overviewRes, areasRes, analyticsRes, reportsRes, indicatorsRes, forecastRes, auditRes, settingsRes] = await Promise.all([
        api.get('/ng/public-health/programme/executive-dashboard', { params: query }),
        api.get('/ng/public-health/programme/overview', { params: query }),
        api.get('/ng/public-health/programme/areas', { params: query }),
        api.get('/ng/public-health/analytics', { params: query }),
        api.get('/ng/public-health/reports', { params: { limit: 10 } }),
        api.get('/ng/public-health/indicators'),
        api.get('/ng/public-health/forecast', { params: buildQuery({ metric: 'consultations', range: 7 }) }),
        api.get('/ng/public-health/audit-logs', { params: { limit: 20 } }),
        api.get('/ng/integrations/dhis2/settings'),
      ]);
      setExecutive(executiveRes.data || {});
      setOverview(overviewRes.data || {});
      setAreas(areasRes.data?.areas || []);
      setAnalytics(analyticsRes.data || {});
      setReports(reportsRes.data?.reports || []);
      setIndicators(indicatorsRes.data?.indicators || []);
      setForecast(forecastRes.data || null);
      setAuditLogs(auditRes.data?.logs || []);
      const settings = settingsRes.data?.settings || {};
      setDhis2Settings(settings);
      setSettingsForm((current) => ({
        ...current,
        ...settings,
        enabled: settings.enabled === true,
        dryRunOnly: settings.dryRunOnly !== false,
      }));
    } catch (loadError) {
      setError(loadError.response?.data?.error || loadError.message || 'Could not load public-health programme data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function runAction(action) {
    setWorking(true);
    setMessage('');
    setError('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError.response?.data?.error || actionError.message || 'Action failed.');
    } finally {
      setWorking(false);
    }
  }

  const generateReport = () => runAction(async () => {
    const res = await api.post('/ng/public-health/reports/generate', { period, reportType: 'monthly_aggregate' });
    setSelectedReport(res.data);
    setMessage('Aggregate public-health report generated from real operational data.');
    await loadAll();
  });

  const approveReport = (id) => runAction(async () => {
    await api.post(`/ng/public-health/reports/${id}/approve`, { notes: 'Approved for aggregate export review.' });
    setMessage('Report approved for export workflow.');
    await loadAll();
  });

  const exportJson = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/json`);
    setSelectedReport(res.data);
    setMessage('JSON aggregate export generated. No patient identifiers are included.');
  });

  const exportCsv = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/csv`, {}, { responseType: 'text' });
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `doctarx-ng-public-health-${period}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage('CSV aggregate export generated. No patient identifiers are included.');
  });

  const previewDhis2 = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/dhis2-preview`);
    setPreview(res.data);
    setMessage('DHIS2 dataValueSet preview generated in dry-run mode only.');
  });

  const dryRunDhis2 = (id) => runAction(async () => {
    const res = await api.post(`/ng/integrations/dhis2/dry-run/${id}`);
    setPreview(res.data);
    setMessage('Dry-run preview logged. No data was sent to government systems.');
    await loadAll();
  });

  const saveSettings = () => runAction(async () => {
    const payload = {
      environment: settingsForm.environment,
      datasetId: settingsForm.datasetId,
      orgUnitId: settingsForm.orgUnitId,
      attributeOptionComboId: settingsForm.attributeOptionComboId,
      governmentApprovalStatus: settingsForm.governmentApprovalStatus,
      apiCredentialsStatus: settingsForm.apiCredentialsStatus,
      dataSharingAgreementStatus: settingsForm.dataSharingAgreementStatus,
      ndprReviewStatus: settingsForm.ndprReviewStatus,
      enabled: settingsForm.enabled,
      dryRunOnly: settingsForm.dryRunOnly,
    };
    await api.post('/ng/integrations/dhis2/settings', payload);
    setMessage('DHIS2 readiness settings saved. Secrets are not exposed in the admin UI.');
    await loadAll();
  });

  const testConnection = () => runAction(async () => {
    const res = await api.post('/ng/integrations/dhis2/test-connection');
    setPreview(res.data);
    setMessage('Readiness check completed. No live government API call was attempted.');
  });

  const executiveForecastCards = [
    ['7-day consultation demand', executiveForecasts.consultations7Day],
    ['14-day consultation demand', executiveForecasts.consultations14Day],
    ['30-day consultation demand', executiveForecasts.consultations30Day],
    ['14-day referral demand', executiveForecasts.referrals14Day],
    ['14-day prescription demand', executiveForecasts.prescriptions14Day],
    ['14-day lab demand', executiveForecasts.labReferrals14Day],
    ['14-day follow-up demand', executiveForecasts.followups14Day],
  ];

  const comprehensiveChartSections = [
    {
      title: 'Patient Access Charts',
      charts: [
        ['New patient registrations over time', 'Registration growth from Nigeria patient accounts.', executiveCharts.registrations],
        ['Total patients served over time', 'Patient service reach from real consultation activity.', executiveCharts.consultations],
        ['Appointment bookings over time', 'Booked care demand over time.', executiveCharts.consultations],
        ['Completed vs missed appointments', 'Requires captured missed/no-show appointment status.', []],
        ['Follow-up completion trend', 'Follow-up demand and completion signal from appointment records.', executiveCharts.followups],
        ['Patient access by facility', 'Requires facility-linked appointment or access request records.', []],
        ['Patient access by LGA/ward', 'Requires LGA/ward mapping on facility or patient access records.', []],
      ],
    },
    {
      title: 'Telemedicine Charts',
      charts: [
        ['Teleconsultations over time', 'Digital care demand over time.', executiveCharts.teleconsultations],
        ['Completed vs failed teleconsultations', 'Requires completed/failed call status capture.', []],
        ['Video success vs audio fallback', 'Uses video failure and audio fallback tracking where available.', []],
        ['Teleconsultation demand by facility', 'Requires facility linkage on virtual visits.', []],
        ['Teleconsultation demand by LGA/ward', 'Requires facility or patient location mapping.', []],
        ['Teleconsultation adoption trend', 'Teleconsultations as a share of consultation demand.', executiveCharts.teleconsultations],
      ],
    },
    {
      title: 'Consultation and Referral Charts',
      charts: [
        ['Total consultations over time', 'Consultation demand trend.', executiveCharts.consultations],
        ['Completed vs cancelled consultations', 'Requires appointment status capture.', []],
        ['Consultation status breakdown', 'Status distribution appears when appointment status data is available.', []],
        ['Consultation by facility type', 'Requires facility type mapping.', []],
        ['Consultation by provider', 'Provider-linked consultation volume.', []],
        ['Referrals over time', 'Referral coordination volume.', executiveCharts.referrals],
        ['Referrals by destination', 'Top referral destinations are listed in the executive tables.', []],
        ['Referral completion trend', 'Requires referral completed_at/status data.', executiveCharts.referrals],
        ['Referral leakage/drop-off trend', 'Requires cancellation/drop-off status capture.', []],
      ],
    },
    {
      title: 'Pharmacy, Lab, Facility, Provider, and Complaint Charts',
      charts: [
        ['Prescriptions over time', 'Medication demand signal from prescriptions.', executiveCharts.prescriptions],
        ['Prescriptions by category', 'Requires medication category mapping.', []],
        ['Pharmacy referrals over time', 'Dispense/pharmacy request trend.', executiveCharts.pharmacyReferrals],
        ['Medicine demand trend', 'Medication demand signal from prescriptions and requests.', executiveCharts.prescriptions],
        ['Lab referrals over time', 'Diagnostic coordination demand.', executiveCharts.labReferrals],
        ['Diagnostic requests by category', 'Requires diagnostic category mapping.', []],
        ['Facility utilization over time', 'Requires facility-linked activity records.', []],
        ['Provider activity over time', 'Requires provider-linked operational records.', []],
        ['Top symptoms/complaints', 'Requires complaint or reason-for-visit category capture.', []],
        ['Early signal trend chart', 'Shown when aggregate complaint/service signals have enough history.', []],
      ],
    },
    {
      title: 'Forecasting Charts',
      charts: [
        ['7-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations7Day?.historicalPoints],
        ['14-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations14Day?.historicalPoints],
        ['30-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations30Day?.historicalPoints],
        ['Expected referrals forecast', 'Referral demand projection.', executiveForecasts.referrals14Day?.historicalPoints],
        ['Expected prescriptions forecast', 'Medicine demand planning signal.', executiveForecasts.prescriptions14Day?.historicalPoints],
        ['Expected lab referrals forecast', 'Diagnostic demand planning signal.', executiveForecasts.labReferrals14Day?.historicalPoints],
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-950 via-slate-950 to-teal-900 p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-200">DoctaRx Nigeria</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Public Health Intelligence Programme</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-emerald-50">
              Executive-ready care delivery visibility, referral coordination, pharmacy/lab coordination, aggregate reporting,
              operational forecasting, and DHIS2/NHMIS readiness for FCTA and public-health stakeholder review.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">No fake live DHIS2 integration</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">Local Aggregate Mode</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">Aggregate reporting only</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">Awaiting official credentials</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">Government approval pending</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">Dry-run exports until approval</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-emerald-50">NDPR-aware</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 p-4 text-sm text-emerald-50">
            <p className="font-semibold text-white">Reporting period</p>
            <Input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="mt-2 border-white/20 bg-white text-slate-950"
            />
            <Button onClick={loadAll} variant="secondary" className="mt-3 w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh data
            </Button>
          </div>
        </div>
      </section>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div>}

      <Card className="border-slate-200 bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-slate-950">Executive filters</CardTitle>
          <CardDescription>Filters are passed to the public-health APIs. If a field is not mapped yet, the dashboard keeps a clear empty state instead of inventing data.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['dateFrom', 'Date from', 'date', ''],
            ['dateTo', 'Date to', 'date', ''],
            ['facilityId', 'Facility ID', 'text', 'Optional facility UUID'],
            ['facilityType', 'Facility type', 'text', 'PHC, public hospital, lab'],
            ['lga', 'LGA', 'text', 'AMAC, Bwari, etc.'],
            ['ward', 'Ward', 'text', 'Optional ward'],
            ['providerId', 'Provider ID', 'text', 'Optional provider UUID'],
            ['programmeArea', 'Programme area', 'text', 'referrals, teleconsultation'],
          ].map(([key, label, type, placeholder]) => (
            <div key={key} className="space-y-2">
              <Label>{label}</Label>
              <Input
                type={type}
                value={filters[key] || ''}
                placeholder={placeholder}
                onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
              />
            </div>
          ))}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button onClick={loadAll} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Apply filters
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilters({ dateFrom: '', dateTo: '', facilityId: '', facilityType: '', lga: '', ward: '', providerId: '', programmeArea: '' })}
            >
              Clear filters
            </Button>
          </div>
          {(executive?.filterState?.limitations || []).length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 sm:col-span-2 lg:col-span-4">
              <p className="font-semibold">Filter mapping notice</p>
              <ul className="mt-1 list-disc pl-5">
                {executive.filterState.limitations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
          <TabsList className="flex h-auto min-w-max flex-wrap justify-start gap-2 bg-transparent p-0">
            {tabs.map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="rounded-lg border border-slate-200 px-3 py-2 data-[state=active]:border-emerald-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-800">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-slate-600">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading public-health intelligence...
          </div>
        ) : (
          <>
            <TabsContent value="executive" className="space-y-6">
              <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-950">Executive Public Health Intelligence Dashboard</h2>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                      A leadership view for FCTA/HSES, FMOH, AMAC, public hospitals, PHCs, and programme directors: what is happening now,
                      what is changing over time, where demand is rising, and which operational actions need review.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill status={executive?.governance?.dhis2Status || readiness.status} />
                    <StatusPill status={executive?.governance?.forecastStatus || overview?.forecastStatus || 'insufficient_data'} />
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                {(executive?.kpiSections || []).map((section) => (
                  <ExecutiveKpiSection key={section.key} section={section} />
                ))}
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <ChartCard title="Consultations over time" description="Operational demand trend from real consultation records." data={executiveCharts.consultations || []} />
                <ChartCard title="Teleconsultations over time" description="Digital access and video/audio care trend where captured." data={executiveCharts.teleconsultations || []} />
                <ChartCard title="Referrals over time" description="PHC, public hospital, specialist, lab, and pharmacy referral movement." data={executiveCharts.referrals || []} type="bar" />
                <ChartCard title="Patient registration growth" description="Public access growth from Nigeria patient registration records." data={executiveCharts.registrations || []} />
                <ChartCard title="Prescription demand trend" description="Medication demand signal from prescription records, not live stock claims." data={executiveCharts.prescriptions || []} />
                <ChartCard title="Lab and pharmacy referral trend" description="Referral coordination pressure for diagnostic and medication fulfilment planning." data={[...(executiveCharts.labReferrals || []), ...(executiveCharts.pharmacyReferrals || [])]} type="bar" />
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl text-slate-950"><MapPin className="h-5 w-5 text-emerald-700" /> Public-health visibility map</CardTitle>
                    <CardDescription>Facility and referral map points are shown only when real facility/LGA/ward coordinates are configured.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <IntelligenceMap mapData={executiveMaps} />
                  </CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="text-xl text-slate-950">Early signal detection</CardTitle>
                    <CardDescription>Generated from aggregate operational metrics only. No disease diagnosis or outbreak prediction is claimed.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(executive?.earlyPlanningSignals || []).length ? executive.earlyPlanningSignals.map((signal) => (
                      <div key={signal.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-slate-950">{signal.title}</p>
                          <StatusPill status={signal.severity || 'info'} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{signal.message}</p>
                      </div>
                    )) : (
                      <EmptyState title="No early signals yet" body="Signals will appear when aggregate trends show enough operational change to support planning review." />
                    )}
                  </CardContent>
                </Card>
              </section>

              <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {executiveForecastCards.map(([title, cardForecast]) => (
                  <ForecastCard key={title} title={title} forecast={cardForecast} />
                ))}
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <CompactTable
                  title="Top referral destinations"
                  rows={executiveTables.topReferralDestinations || []}
                  columns={[
                    { key: 'destination', label: 'Destination' },
                    { key: 'destination_type', label: 'Type' },
                    { key: 'count', label: 'Referrals' },
                  ]}
                  empty="Referral destination intelligence will populate when provider and facility referrals are recorded."
                />
                <CompactTable
                  title="Provider workload"
                  rows={executiveTables.topProviders || []}
                  columns={[
                    { key: 'provider_name', label: 'Provider' },
                    { key: 'consultations', label: 'Consultations' },
                    { key: 'teleconsultations', label: 'Teleconsultations' },
                    { key: 'referrals', label: 'Referrals' },
                  ]}
                  empty="Provider workload visibility appears after consultation records are linked to providers."
                />
                <CompactTable
                  title="Complaint and service demand patterns"
                  rows={executiveTables.complaintCategories || []}
                  columns={[
                    { key: 'category', label: 'Category' },
                    { key: 'count', label: 'Count' },
                  ]}
                  empty="Complaint/category patterns require captured reason-for-visit, complaint, diagnosis category, or service tags."
                />
                <CompactTable
                  title="Medicine demand categories"
                  rows={executiveTables.medicineCategories || []}
                  columns={[
                    { key: 'category', label: 'Medication class/category' },
                    { key: 'count', label: 'Demand signal' },
                  ]}
                  empty="Medicine demand categories will populate from prescription or medicine-request records. No pharmacy stock is inferred."
                />
                <CompactTable
                  title="Facility type breakdown"
                  rows={executiveTables.facilityTypeBreakdown || []}
                  columns={[
                    { key: 'facility_type', label: 'Facility type' },
                    { key: 'count', label: 'Facilities' },
                  ]}
                  empty="Facility type breakdown requires configured public-health facilities, PHCs, hospitals, or partner facilities."
                />
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="text-lg text-slate-950">Leadership actions to consider</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(executive?.leadershipActions || []).length ? executive.leadershipActions.map((action) => (
                      <div key={action.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-950">{action.title}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{action.message}</p>
                      </div>
                    )) : (
                      <EmptyState title="No leadership actions yet" body="Planning recommendations will appear when aggregate utilization, referral, teleconsultation, pharmacy, or lab signals justify review." />
                    )}
                  </CardContent>
                </Card>
              </section>

              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="text-xl text-slate-950">Financial and contract justification</CardTitle>
                  <CardDescription>Supports pilot value summaries only when payment, sponsorship, or service-value configuration exists.</CardDescription>
                </CardHeader>
                <CardContent>
                  {executive?.financial?.emptyState ? (
                    <EmptyState title="Financial reporting is not configured" body={executive.financial.emptyState} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {(executive?.financial?.items || []).map((item) => (
                        <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                          <p className="mt-2 text-lg font-bold text-slate-950">{formatExecutiveValue(item)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="overview" className="space-y-6">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(overview?.metricCards || []).slice(0, 12).map((metric) => (
                  <MetricCard key={metric.key} label={metric.label} value={metric.value} icon={metricIcons[metric.key] || Activity} />
                ))}
              </section>
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="text-xl text-slate-950">FCTA Programme Participation Readiness</CardTitle>
                    <CardDescription>Configured for serious stakeholder review while official DHIS2/NHMIS inputs remain pending.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill status={readiness.status} />
                      <StatusPill status={readiness.syncStatus} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(readiness.checklist || []).slice(0, 8).map((item) => (
                        <div key={item.key} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-slate-950">{item.label}</p>
                            <StatusPill status={item.status} />
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="text-xl text-slate-950">Market Baseline Coverage</CardTitle>
                    <CardDescription>DoctaRx matches Nigerian telemedicine basics and adds public-health intelligence.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {competitiveCoverageGroups.flatMap((group) => group.items.map(([label, status]) => ({ label, status }))).slice(0, 12).map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">{item.label}</span>
                        <StatusPill status={item.status} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="areas" className="grid gap-4 lg:grid-cols-2">
              {areas.map((area) => <ProgrammeAreaCard key={area.key} area={area} />)}
            </TabsContent>

            <TabsContent value="patient-access" className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Active patients" value={metrics.active_patients} icon={Users} />
                <MetricCard label="New registrations" value={metrics.new_patient_registrations} icon={Users} />
                <MetricCard label="Appointment bookings" value={metrics.appointment_bookings} icon={ClipboardList} />
                <MetricCard label="Patient access requests" value={metrics.patient_access_requests} icon={HeartPulse} />
              </section>
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>Patient access model</CardTitle>
                  <CardDescription>Mobile-first public pages, QR-code-ready URLs, low-bandwidth access, reminders, and patient portal activity feed aggregate reports.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {['Patient registration', 'Facility discovery', 'Provider discovery', 'Teleconsultation booking', 'Follow-up booking', 'SMS/WhatsApp notification hooks', 'QR-ready public routes', 'Low-bandwidth-friendly access'].map((item) => (
                    <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-800">{item}</div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="teleconsultation" className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Teleconsultations" value={metrics.teleconsultations} icon={Video} />
                <MetricCard label="Completed consultations" value={metrics.completed_consultations} icon={CheckCircle2} />
                <MetricCard label="Audio fallback sessions" value={metrics.audio_fallback_sessions} icon={Activity} />
                <MetricCard label="Failed video sessions" value={metrics.failed_video_sessions} icon={Video} />
              </section>
              <ChartCard title="Teleconsultations over time" description="Counts are pulled from real appointment records where available." data={charts.consultations || []} />
            </TabsContent>

            <TabsContent value="referrals" className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Referrals created" value={metrics.referrals_created} icon={UploadCloud} />
                <MetricCard label="Completed referrals" value={metrics.referrals_completed} icon={CheckCircle2} />
                <MetricCard label="Pending referrals" value={metrics.pending_referrals} icon={ClipboardList} />
                <MetricCard label="Lab referrals" value={metrics.lab_referrals} icon={FlaskConical} />
              </section>
              <ChartCard title="Referrals over time" description="PHC, hospital, specialist, pharmacy, and lab referrals populate this trend when captured." data={charts.referrals || []} type="bar" />
            </TabsContent>

            <TabsContent value="pharmacy-lab" className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Prescriptions created" value={metrics.prescriptions_created} icon={Pill} />
                <MetricCard label="Pharmacy referrals" value={metrics.pharmacy_referrals} icon={Pill} />
                <MetricCard label="Lab referrals" value={metrics.lab_referrals} icon={FlaskConical} />
                <MetricCard label="Follow-up appointments" value={metrics.followup_appointments} icon={ClipboardList} />
              </section>
              <ChartCard title="Prescription demand trend" description="Uses prescription records only. No fake pharmacy stock or lab API integration is claimed." data={charts.prescriptions || []} />
            </TabsContent>

            <TabsContent value="facilities" className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Active facilities" value={metrics.active_facilities} icon={Building2} />
                <MetricCard label="Active providers" value={metrics.active_providers} icon={Stethoscope} />
                <MetricCard label="Total consultations" value={metrics.total_consultations} icon={Activity} />
                <MetricCard label="Provider workload signal" value={metrics.teleconsultations + metrics.appointment_bookings} icon={TrendingUp} />
              </section>
              <EmptyState title="Facility utilization details depend on mapped facilities" body="Add PHC, public hospital, and organisation-unit mappings as FCTA/FMOH identifiers become available. Until then, DoctaRx shows operational aggregate counts without fake government IDs." />
            </TabsContent>

            <TabsContent value="analytics" className="space-y-4">
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="text-xl text-slate-950">Full analytics coverage</CardTitle>
                  <CardDescription>
                    Required public-health charts are represented here. Where the current data model lacks mapped fields, DoctaRx shows an empty state and the data requirement instead of mock production values.
                  </CardDescription>
                </CardHeader>
              </Card>
              {comprehensiveChartSections.map((section) => (
                <section key={section.title} className="space-y-3">
                  <h3 className="text-lg font-bold text-slate-950">{section.title}</h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {section.charts.map(([title, description, data]) => (
                      <ChartCard key={`${section.title}-${title}`} title={title} description={description} data={data || []} type={title.toLowerCase().includes(' by ') || title.toLowerCase().includes('breakdown') ? 'bar' : 'line'} />
                    ))}
                  </div>
                </section>
              ))}
            </TabsContent>

            <TabsContent value="forecasting" className="space-y-4">
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><LineChartIcon className="h-5 w-5 text-emerald-700" /> Explainable operational forecast</CardTitle>
                  <CardDescription>No disease outbreak prediction, no diagnosis, no randomized numbers. Forecasts use moving average or simple trend projection from aggregate activity.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-700">7-day expected consultations</p>
                    <p className="mt-3 text-4xl font-bold text-slate-950">{number(forecast?.predictedValue)}</p>
                    <div className="mt-3"><StatusPill status={forecast?.confidenceLabel || 'insufficient_data'} /></div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{forecast?.explanation || 'Forecasting requires more historical activity.'}</p>
                  </div>
                  <ChartCard title="Historical activity used for forecast" description="The forecast is based only on available aggregate operational activity." data={forecast?.historicalPoints || []} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reports" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-slate-950">Monthly aggregate reports</h2>
                  <p className="text-sm text-slate-600">Generate reports from real aggregate data. Exports contain no patient identifiers.</p>
                </div>
                <Button onClick={generateReport} disabled={working}>
                  {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Generate {period} report
                </Button>
              </div>
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="p-4 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">AI narrative generation is disabled until a provider is explicitly configured.</p>
                  <p className="mt-1">
                    The module uses deterministic executive summaries and planning signals from aggregate metrics. If an AI provider is enabled later,
                    only aggregate metrics may be sent and the generation event must be audit logged.
                  </p>
                </CardContent>
              </Card>
              <Card className="border-slate-200 bg-white">
                <CardContent className="p-0">
                  {!reports.length ? (
                    <div className="p-6"><EmptyState title="No public-health report has been generated" body="Generate a monthly aggregate report when operational records are available. Empty reports are allowed but clearly show zero values." /></div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Period</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Generated by</th>
                            <th className="px-4 py-3">Created</th>
                            <th className="px-4 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.map((report) => (
                            <tr key={report.id} className="border-t border-slate-200">
                              <td className="px-4 py-3 font-semibold text-slate-950">{report.report_period}</td>
                              <td className="px-4 py-3 text-slate-700">{report.report_type}</td>
                              <td className="px-4 py-3"><StatusPill status={report.status} /></td>
                              <td className="px-4 py-3 text-slate-700">{report.generated_by_name || 'Admin'}</td>
                              <td className="px-4 py-3 text-slate-700">{report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {report.status !== 'approved' && <Button size="sm" variant="outline" onClick={() => approveReport(report.id)}>Approve</Button>}
                                  <Button size="sm" variant="outline" onClick={() => exportCsv(report.id)}><Download className="mr-1 h-4 w-4" /> CSV</Button>
                                  <Button size="sm" variant="outline" onClick={() => exportJson(report.id)}><FileJson className="mr-1 h-4 w-4" /> JSON</Button>
                                  <Button size="sm" variant="outline" onClick={() => previewDhis2(report.id)}>DHIS2 preview</Button>
                                  <Button size="sm" variant="outline" onClick={() => dryRunDhis2(report.id)}>Dry run</Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
              {selectedReport && (
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle>Latest export/result</CardTitle>
                    <CardDescription>Aggregate JSON output preview. Patient names, phone numbers, emails, addresses, and DOB are not included.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify(selectedReport, null, 2)}</pre>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="dhis2" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700" /> DHIS2/NHMIS readiness</CardTitle>
                    <CardDescription>This is an integration-ready readiness layer. It does not claim live government integration.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(readiness.checklist || []).map((item) => (
                      <div key={item.key} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="font-semibold text-slate-950">{item.label}</p>
                          <StatusPill status={item.status} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle>Governance notes</CardTitle>
                    <CardDescription>Displayed to admins to prevent overclaiming.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(readiness.governanceNotes || []).map((note) => (
                      <div key={note} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                        <Lock className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
                        <span>{note}</span>
                      </div>
                    ))}
                    {preview && (
                      <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify(preview, null, 2)}</pre>
                    )}
                  </CardContent>
                </Card>
              </div>
              <CompactTable
                title="Indicator mapping status"
                rows={indicators || []}
                columns={[
                  { key: 'display_name', label: 'Indicator' },
                  { key: 'programme_area', label: 'Programme area' },
                  { key: 'internal_key', label: 'Internal key' },
                  { key: 'dhis2_data_element_id', label: 'DHIS2 data element', render: (row) => row.dhis2_data_element_id ? 'Configured' : 'Pending official ID' },
                  { key: 'active', label: 'Status', render: (row) => row.active === false ? 'Inactive' : 'Active' },
                ]}
                empty="No public-health indicators are configured yet. Run the migration and configure indicators before DHIS2 preview exports."
              />
            </TabsContent>

            <TabsContent value="competitive" className="space-y-4">
              <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <h2 className="text-2xl font-bold text-slate-950">Competitive Coverage and Public-Sector Differentiation</h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                  DoctaRx covers the Nigerian telemedicine baseline and exceeds it with public-health intelligence, NHMIS/DHIS2-ready aggregate reporting,
                  executive visibility, explainable forecasting, dry-run exports, and governance controls.
                </p>
              </section>
              <div className="grid gap-4 lg:grid-cols-2">
                {competitiveCoverageGroups.map((group) => (
                  <CompetitiveCoverageGroup key={group.title} group={group} />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-emerald-700" /> DHIS2 configuration readiness</CardTitle>
                  <CardDescription>Store official IDs and approval status when received. API token fields are write-only and never displayed.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Environment</Label>
                    <select value={settingsForm.environment} onChange={(event) => setSettingsForm({ ...settingsForm, environment: event.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                      <option value="disabled">Disabled</option>
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Dataset ID</Label>
                    <Input value={settingsForm.datasetId || ''} onChange={(event) => setSettingsForm({ ...settingsForm, datasetId: event.target.value })} placeholder="Official DHIS2 dataset ID pending" />
                  </div>
                  <div className="space-y-2">
                    <Label>Organisation-unit ID</Label>
                    <Input value={settingsForm.orgUnitId || ''} onChange={(event) => setSettingsForm({ ...settingsForm, orgUnitId: event.target.value })} placeholder="Official org-unit ID pending" />
                  </div>
                  <div className="space-y-2">
                    <Label>Attribute option combo ID</Label>
                    <Input value={settingsForm.attributeOptionComboId || ''} onChange={(event) => setSettingsForm({ ...settingsForm, attributeOptionComboId: event.target.value })} placeholder="Optional official value" />
                  </div>
                  {['governmentApprovalStatus', 'apiCredentialsStatus', 'dataSharingAgreementStatus', 'ndprReviewStatus'].map((key) => (
                    <div key={key} className="space-y-2">
                      <Label>{key.replace(/([A-Z])/g, ' $1')}</Label>
                      <select value={settingsForm[key] || 'pending'} onChange={(event) => setSettingsForm({ ...settingsForm, [key]: event.target.value })} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                        <option value="pending">Pending</option>
                        <option value={key === 'apiCredentialsStatus' ? 'configured' : 'approved'}>{key === 'apiCredentialsStatus' ? 'Configured' : 'Approved'}</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                  ))}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 md:col-span-2">
                    <p className="font-semibold text-amber-900">Live sync safety</p>
                    <p className="mt-2 text-sm leading-6 text-amber-800">Keep dry-run enabled until official credentials, approval, mappings, data-sharing agreement, and server safety flag are configured.</p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={settingsForm.enabled === true} onChange={(event) => setSettingsForm({ ...settingsForm, enabled: event.target.checked })} /> Integration enabled</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={settingsForm.dryRunOnly !== false} onChange={(event) => setSettingsForm({ ...settingsForm, dryRunOnly: event.target.checked })} /> Dry-run only</label>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <Button onClick={saveSettings} disabled={working}>Save settings</Button>
                    <Button onClick={testConnection} variant="outline" disabled={working}>Readiness check</Button>
                  </div>
                </CardContent>
              </Card>
              {dhis2Settings && (
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle>Current DHIS2 readiness status</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-xs text-slate-500">Base URL</p><StatusPill status={dhis2Settings.hasBaseUrl ? 'configured' : 'pending'} /></div>
                    <div><p className="text-xs text-slate-500">Username</p><StatusPill status={dhis2Settings.hasUsername ? 'configured' : 'pending'} /></div>
                    <div><p className="text-xs text-slate-500">API token</p><StatusPill status={dhis2Settings.hasApiToken ? 'configured' : 'pending'} /></div>
                    <div><p className="text-xs text-slate-500">Mode</p><StatusPill status={dhis2Settings.dryRunOnly ? 'dry_run_only' : 'live_ready_flag_required'} /></div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="audit" className="space-y-4">
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>Public-health audit logs</CardTitle>
                  <CardDescription>Report generation, approvals, exports, dry-run previews, and settings updates are logged.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!auditLogs.length ? (
                    <EmptyState title="No public-health audit logs yet" body="Audit logs will appear after reports, exports, approvals, dry-runs, and settings updates." />
                  ) : (
                    <div className="space-y-3">
                      {auditLogs.map((log) => (
                        <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="font-semibold text-slate-950">{log.action}</p>
                            <span className="text-slate-500">{log.created_at ? new Date(log.created_at).toLocaleString() : 'N/A'}</span>
                          </div>
                          <p className="mt-1 text-slate-600">Actor: {log.actor_name || log.actor_email || 'System/Admin'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
