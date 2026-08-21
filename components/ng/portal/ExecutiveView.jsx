'use client';

/**
 * components/ng/portal/ExecutiveView.jsx
 * Executive Command Center — ministry-grade read-only aggregate dashboard.
 *
 * Data source: /api/ng/executive-view/*
 * Auth: executive_read_only or higher
 * Privacy: zero patient identifiers — aggregate only
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Building2, Users, Video, ArrowRightLeft,
  Pill, FlaskConical, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Clock, BarChart3, MapPin,
  Shield, RefreshCw, Download, ChevronRight,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  PRESENTATION_DEMO_LABEL,
  buildMinistryDemoData,
  shouldShowPresentationDemoData,
} from '@/lib/ngPresentationDemoData';
import api from '@/lib/api';

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch(path, query = {}) {
  const response = await api.get(`/ng/executive-view${path}`, { params: query });
  return response.data;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, unit, trend, trendLabel, color = 'blue' }) {
  const colorMap = {
    blue:    'from-blue-50 to-blue-100/60 border-blue-200 text-blue-700',
    emerald: 'from-emerald-50 to-emerald-100/60 border-emerald-200 text-emerald-700',
    violet:  'from-violet-50 to-violet-100/60 border-violet-200 text-violet-700',
    amber:   'from-amber-50 to-amber-100/60 border-amber-200 text-amber-700',
    rose:    'from-rose-50 to-rose-100/60 border-rose-200 text-rose-700',
    cyan:    'from-cyan-50 to-cyan-100/60 border-cyan-200 text-cyan-700',
  };
  const cls = colorMap[color] || colorMap.blue;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendCls  = trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-500' : 'text-slate-400';

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-5 shadow-sm ${cls}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold opacity-80">{label}</span>
        <Icon className="h-5 w-5 opacity-60" />
      </div>
      <div className="text-3xl font-black tracking-tight">
        {value != null ? value.toLocaleString() : '—'}
        {unit && <span className="ml-1 text-base font-semibold opacity-60">{unit}</span>}
      </div>
      {trendLabel && (
        <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${trendCls}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {trendLabel}
        </div>
      )}
    </div>
  );
}

function SignalBadge({ severity, title, message }) {
  const map = {
    warning:  { bg: 'bg-amber-50 border-amber-200',  icon: AlertTriangle, iconCls: 'text-amber-500' },
    critical: { bg: 'bg-rose-50 border-rose-200',    icon: AlertTriangle, iconCls: 'text-rose-500' },
    info:     { bg: 'bg-blue-50 border-blue-200',    icon: Activity,      iconCls: 'text-blue-400' },
  };
  const { bg, icon: Icon, iconCls } = map[severity] || map.info;
  return (
    <div className={`flex gap-3 rounded-xl border p-3 ${bg}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconCls}`} />
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-600">{message}</p>
      </div>
    </div>
  );
}

function GovernanceStatusRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-amber-600' : 'text-slate-800'}`}>
        {value}
      </span>
    </div>
  );
}

function WorkflowStatusPill({ status }) {
  const map = {
    submitted:           'bg-slate-100 text-slate-700',
    area_council_review: 'bg-amber-100 text-amber-700',
    fcta_review:         'bg-blue-100 text-blue-700',
    approved:            'bg-emerald-100 text-emerald-700',
    dhis2_ready:         'bg-violet-100 text-violet-700',
    exported:            'bg-cyan-100 text-cyan-700',
    rejected:            'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] || 'bg-slate-100 text-slate-600'}`}>
      {status?.replace(/_/g, ' ') || 'unknown'}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PERIODS = [
  { label: 'Current month', value: '' },
  ...Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i - 1);
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { label: p, value: p };
  }),
];

export default function ExecutiveView() {
  const [period, setPeriod]         = useState('');
  const [dashboard, setDashboard]   = useState(null);
  const [signals, setSignals]       = useState(null);
  const [forecasts, setForecasts]   = useState(null);
  const [govStatus, setGovStatus]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [activeTab, setActiveTab]   = useState('overview');
  const [usingDemoData, setUsingDemoData] = useState(false);
  const demoData = useMemo(() => buildMinistryDemoData(), []);

  const applyDemoData = useCallback(() => {
    setDashboard(demoData.dashboard);
    setSignals(demoData.signals);
    setForecasts(demoData.forecasts);
    setGovStatus(demoData.govStatus);
    setUsingDemoData(true);
    setError('');
  }, [demoData]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (shouldShowPresentationDemoData()) {
      applyDemoData();
      setLoading(false);
      return;
    }
    try {
      const q = period ? { period } : {};
      const [db, sig, fc, gov] = await Promise.all([
        apiFetch('/dashboard', q),
        apiFetch('/signals', q),
        apiFetch('/forecasts', q),
        apiFetch('/governance-status', q),
      ]);
      setDashboard(db);
      setSignals(sig);
      setForecasts(fc);
      setGovStatus(gov);
      setUsingDemoData(false);
    } catch (err) {
      setUsingDemoData(false);
      setError([401, 403].includes(err.response?.status)
        ? 'Your account is not authorized to load executive aggregate data.'
        : err.message);
    } finally {
      setLoading(false);
    }
  }, [period, applyDemoData]);

  useEffect(() => { load(); }, [load]);

  const exec = dashboard?.executive;
  const gov  = dashboard?.governance || govStatus;

  const tabs = [
    { key: 'overview',    label: 'Overview' },
    { key: 'trends',      label: 'Trends' },
    { key: 'signals',     label: 'Signals' },
    { key: 'forecasts',   label: 'Forecasts' },
    { key: 'governance',  label: 'Governance' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              <h1 className="text-xl font-black text-slate-900">Executive Command Center</h1>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              DoctaRx Nigeria — public-health aggregate intelligence
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              aria-label="Reporting period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Privacy notice */}
      <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-2">
        <p className="mx-auto max-w-7xl text-center text-xs font-medium text-emerald-700">
          All data is aggregate. No patient identifiers are included in this view.
        </p>
      </div>

      {usingDemoData && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2">
          <p className="mx-auto max-w-7xl text-center text-xs font-semibold text-amber-800">
            {PRESENTATION_DEMO_LABEL} - Abuja pilot aggregate sample for presentation only; no real patient data.
          </p>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-8 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-xl px-5 py-2 text-sm font-semibold transition-all ${
                activeTab === t.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="py-24 text-center text-sm text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-400" />
            Loading intelligence data…
          </div>
        )}

        {!loading && exec && activeTab === 'overview' && (
          <OverviewTab exec={exec} gov={gov} />
        )}

        {!loading && exec && activeTab === 'trends' && (
          <TrendsTab exec={exec} />
        )}

        {!loading && signals && activeTab === 'signals' && (
          <SignalsTab signals={signals} />
        )}

        {!loading && forecasts && activeTab === 'forecasts' && (
          <ForecastsTab forecasts={forecasts} />
        )}

        {!loading && gov && activeTab === 'governance' && (
          <GovernanceTab gov={gov} />
        )}

        {!loading && !exec && !error && (
          <div className="py-24 text-center text-sm text-slate-400">
            No data available for this period.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function OverviewTab({ exec, gov }) {
  const m = exec?.metrics || {};
  const kpis = [
    { icon: Users,         label: 'Total consultations',   value: m.total_consultations,       color: 'blue'    },
    { icon: Video,         label: 'Teleconsultations',     value: m.teleconsultations,         color: 'cyan'    },
    { icon: Users,         label: 'Active patients',       value: m.active_patients,           color: 'emerald' },
    { icon: ArrowRightLeft,label: 'Referrals created',     value: m.referrals_created,         color: 'violet'  },
    { icon: Pill,          label: 'Prescriptions',         value: m.prescriptions_created,     color: 'amber'   },
    { icon: FlaskConical,  label: 'Lab referrals',         value: m.lab_referrals,             color: 'rose'    },
    { icon: Building2,     label: 'Active facilities',     value: m.active_facilities,         color: 'blue'    },
    { icon: Activity,      label: 'Active providers',      value: m.active_providers,          color: 'emerald' },
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Complaint intelligence */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-black text-slate-900">Top Complaint Categories</h3>
          {(exec.complaint?.complaintCategories || []).length === 0 ? (
            <p className="text-sm text-slate-400">No complaint data for this period.</p>
          ) : (
            <div className="space-y-2">
              {(exec.complaint?.complaintCategories || []).slice(0, 8).map((row) => (
                <div key={row.category} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{row.category}</span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                    {row.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provider intelligence */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-black text-slate-900">Provider Intelligence</h3>
          <div className="space-y-3">
            <GovernanceStatusRow label="Consultations per provider" value={exec.provider?.consultationsPerProvider ?? '—'} />
            <GovernanceStatusRow label="Teleconsultations per provider" value={exec.provider?.teleconsultationsPerProvider ?? '—'} />
            <GovernanceStatusRow label="Provider workload score" value={exec.provider?.providerWorkloadScore ?? '—'} />
            <GovernanceStatusRow
              label="Capacity warnings"
              value={exec.provider?.providerCapacityWarnings ?? 'Data unavailable'}
              highlight={Number(exec.provider?.providerCapacityWarnings) > 0}
            />
          </div>
          <h4 className="mb-2 mt-5 text-sm font-bold text-slate-700">Top Providers</h4>
          {(exec.provider?.topProviders || []).slice(0, 5).map((p) => (
            <div key={p.provider_id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
              <span className="text-sm text-slate-700">{p.provider_name || '(unnamed)'}</span>
              <span className="text-sm font-semibold text-slate-900">{p.consultations} consults</span>
            </div>
          ))}
        </div>
      </div>

      {/* Governance snapshot */}
      {gov && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-black text-slate-900">Governance Snapshot</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total submissions',  value: gov.governance?.totalSubmissions ?? 'Data unavailable' },
              { label: 'Pending review',     value: gov.governance?.pendingReview ?? 'Data unavailable',    hl: true },
              { label: 'Pending approval',   value: gov.governance?.pendingApproval ?? 'Data unavailable',  hl: true },
              { label: 'Approved / ready',   value: gov.governance?.approved ?? 'Data unavailable' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className={`text-2xl font-black ${item.hl && item.value > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendsTab({ exec }) {
  const charts = exec?.charts || {};
  const consultationData = (charts.consultations || []).map((p) => ({
    date: p.date || p.name,
    consultations: Number(p.value || 0),
  }));
  const referralData = (charts.referrals || []).map((p) => ({
    date: p.date || p.name,
    referrals: Number(p.value || 0),
  }));

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-base font-black text-slate-900">Consultation Trend (90-day)</h3>
        <p className="mb-5 text-xs text-slate-400">Aggregate operational activity — no patient identifiers.</p>
        {!consultationData.length ? (
          <p className="py-12 text-center text-sm text-slate-400">Consultation trend data will populate as records are captured.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={consultationData}>
                <defs>
                  <linearGradient id="execConsult" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 0, boxShadow: '0 8px 30px rgba(0,0,0,.1)' }} />
                <Area type="monotone" dataKey="consultations" stroke="#2563eb" strokeWidth={2.5} fill="url(#execConsult)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-base font-black text-slate-900">Referral Trend (90-day)</h3>
        {!referralData.length ? (
          <p className="py-12 text-center text-sm text-slate-400">Referral trend data will populate as records are captured.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={referralData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 0, boxShadow: '0 8px 30px rgba(0,0,0,.1)' }} />
                <Bar dataKey="referrals" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function SignalsTab({ signals }) {
  const early  = signals?.earlySignals      || [];
  const planning = signals?.planningSignals || [];
  const actions  = signals?.leadershipActions || [];

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-base font-black text-slate-900">Early Operational Signals</h3>
        <p className="mb-4 text-xs text-slate-400">
          Complaint pattern changes vs. prior period. These are planning signals — not outbreak predictions.
        </p>
        {!early.length ? (
          <p className="py-8 text-center text-sm text-slate-400">Signals will populate as historical data accumulates.</p>
        ) : (
          <div className="space-y-3">
            {early.map((s, i) => (
              <SignalBadge key={i} severity={s.severity} title={s.category} message={s.message} />
            ))}
          </div>
        )}
      </div>

      {actions.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6">
          <h3 className="mb-4 text-base font-black text-slate-900">Leadership Action Items</h3>
          <div className="space-y-3">
            {actions.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.title || a}</p>
                  {a.detail && <p className="text-xs text-slate-600">{a.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ForecastsTab({ forecasts }) {
  const fc = forecasts?.forecasts || [];

  const byMetric = {};
  for (const f of fc) {
    if (!byMetric[f.metric]) byMetric[f.metric] = {};
    byMetric[f.metric][f.range] = f;
  }

  const metrics = Object.keys(byMetric);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        {forecasts?.disclaimer || 'Forecasts are operational planning signals only — not outbreak predictions.'}
      </div>

      {!metrics.length ? (
        <p className="py-12 text-center text-sm text-slate-400">Forecasts will populate as operational data accumulates (minimum 7 data points).</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="mb-3 text-sm font-bold text-slate-700 capitalize">{metric.replace(/_/g, ' ')}</h4>
              {[7, 14, 30].map((range) => {
                const f = byMetric[metric]?.[range];
                if (!f) return null;
                return (
                  <div key={range} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                    <span className="text-xs text-slate-500">{range}d forecast</span>
                    <div className="text-right">
                      <span className="text-sm font-bold text-slate-800">
                        {f.predicted_value != null ? Math.round(f.predicted_value) : '—'}
                      </span>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        f.confidence_label === 'high'   ? 'bg-emerald-100 text-emerald-700' :
                        f.confidence_label === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {f.confidence_label || 'insufficient_data'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GovernanceTab({ gov }) {
  const g = gov?.governance || {};
  const recent = gov?.recentAuditActivity || [];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total submissions',  value: g.totalSubmissions ?? 'Data unavailable' },
          { label: 'Pending review',     value: g.pendingReview ?? 'Data unavailable', hl: Number(g.pendingReview) > 0 },
          { label: 'Pending approval',   value: g.pendingApproval ?? 'Data unavailable', hl: Number(g.pendingApproval) > 0 },
          { label: 'Approved / DHIS2 ready', value: g.approved ?? 'Data unavailable' },
        ].map((item) => (
          <div key={item.label} className={`rounded-2xl border p-5 ${item.hl ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className={`text-3xl font-black ${item.hl ? 'text-amber-600' : 'text-slate-800'}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* Jurisdiction breakdown */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-black text-slate-900">Jurisdiction Breakdown</h3>
        <div className="space-y-2">
          {Object.entries(gov?.governance?.jurisdictionByTier || {}).map(([tier, count]) => (
            <div key={tier} className="flex items-center justify-between">
              <span className="text-sm capitalize text-slate-600">{tier.replace(/_/g, ' ')}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent audit activity */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-black text-slate-900">Recent Audit Activity</h3>
        {!recent.length ? (
          <p className="text-sm text-slate-400">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {recent.slice(0, 10).map((log, i) => (
              <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{log.action}</span>
                  {log.resource_type && (
                    <span className="ml-1 text-xs text-slate-400">on {log.resource_type}</span>
                  )}
                  {log.actor_name && (
                    <span className="ml-1 text-xs text-slate-400">by {log.actor_name}</span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(log.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
