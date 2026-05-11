'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AreaChart as AreaChartIcon,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Database,
  Download,
  FileJson,
  FileText,
  FlaskConical,
  Gauge,
  Globe2,
  HeartPulse,
  Layers3,
  LineChart as LineChartIcon,
  Loader2,
  Lock,
  MapPin,
  Network,
  Pill,
  PieChart as PieChartIcon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  UploadCloud,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
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
  ['executive', 'Executive'],
  ['overview', 'Overview'],
  ['areas', 'Programmes'],
  ['patient-access', 'Patients'],
  ['teleconsultation', 'Teleconsult'],
  ['referrals', 'Referrals'],
  ['pharmacy-lab', 'Pharmacy & Lab'],
  ['facilities', 'Facilities'],
  ['analytics', 'Analytics'],
  ['forecasting', 'Forecasting'],
  ['reports', 'Reports'],
  ['dhis2', 'DHIS2'],
  ['competitive', 'Coverage'],
  ['settings', 'Settings'],
  ['audit', 'Audit'],
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

const CARD_GRADIENTS = [
  { bg: 'from-blue-600 via-blue-500 to-cyan-500', shadow: 'shadow-blue-500/30', icon: 'bg-white/20', chart: '#2563eb', soft: '#93c5fd' },
  { bg: 'from-emerald-600 via-emerald-500 to-teal-400', shadow: 'shadow-emerald-500/30', icon: 'bg-white/20', chart: '#059669', soft: '#6ee7b7' },
  { bg: 'from-violet-600 via-purple-500 to-indigo-500', shadow: 'shadow-violet-500/30', icon: 'bg-white/20', chart: '#7c3aed', soft: '#c4b5fd' },
  { bg: 'from-amber-500 via-orange-400 to-yellow-400', shadow: 'shadow-amber-400/30', icon: 'bg-white/20', chart: '#d97706', soft: '#fcd34d' },
  { bg: 'from-rose-600 via-pink-500 to-red-400', shadow: 'shadow-rose-500/30', icon: 'bg-white/20', chart: '#e11d48', soft: '#fda4af' },
  { bg: 'from-cyan-600 via-sky-500 to-blue-400', shadow: 'shadow-cyan-500/30', icon: 'bg-white/20', chart: '#0891b2', soft: '#67e8f9' },
];

const LIGHT_ACCENTS = [
  { border: 'border-blue-100', header: 'from-blue-50 via-white to-cyan-50', icon: 'bg-blue-100 text-blue-700', text: 'text-blue-700', chart: '#2563eb', soft: '#93c5fd' },
  { border: 'border-emerald-100', header: 'from-emerald-50 via-white to-teal-50', icon: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700', chart: '#059669', soft: '#6ee7b7' },
  { border: 'border-violet-100', header: 'from-violet-50 via-white to-indigo-50', icon: 'bg-violet-100 text-violet-700', text: 'text-violet-700', chart: '#7c3aed', soft: '#c4b5fd' },
  { border: 'border-amber-100', header: 'from-amber-50 via-white to-orange-50', icon: 'bg-amber-100 text-amber-700', text: 'text-amber-700', chart: '#d97706', soft: '#fcd34d' },
  { border: 'border-rose-100', header: 'from-rose-50 via-white to-pink-50', icon: 'bg-rose-100 text-rose-700', text: 'text-rose-700', chart: '#e11d48', soft: '#fda4af' },
  { border: 'border-cyan-100', header: 'from-cyan-50 via-white to-sky-50', icon: 'bg-cyan-100 text-cyan-700', text: 'text-cyan-700', chart: '#0891b2', soft: '#67e8f9' },
];

const accentStyles = [
  { panel: 'bg-gradient-to-r from-blue-50 to-cyan-50', text: 'text-blue-700', iconBg: 'bg-blue-100', icon: 'text-blue-700', chart: '#2563eb', border: 'border-blue-100', glow: 'shadow-blue-100/40', softChart: '#93c5fd' },
  { panel: 'bg-gradient-to-r from-emerald-50 to-teal-50', text: 'text-emerald-700', iconBg: 'bg-emerald-100', icon: 'text-emerald-700', chart: '#059669', border: 'border-emerald-100', glow: 'shadow-emerald-100/40', softChart: '#6ee7b7' },
  { panel: 'bg-gradient-to-r from-violet-50 to-indigo-50', text: 'text-violet-700', iconBg: 'bg-violet-100', icon: 'text-violet-700', chart: '#7c3aed', border: 'border-violet-100', glow: 'shadow-violet-100/40', softChart: '#c4b5fd' },
  { panel: 'bg-gradient-to-r from-amber-50 to-orange-50', text: 'text-amber-700', iconBg: 'bg-amber-100', icon: 'text-amber-700', chart: '#d97706', border: 'border-amber-100', glow: 'shadow-amber-100/40', softChart: '#fcd34d' },
  { panel: 'bg-gradient-to-r from-rose-50 to-pink-50', text: 'text-rose-700', iconBg: 'bg-rose-100', icon: 'text-rose-700', chart: '#e11d48', border: 'border-rose-100', glow: 'shadow-rose-100/40', softChart: '#fda4af' },
  { panel: 'bg-gradient-to-r from-cyan-50 to-sky-50', text: 'text-cyan-700', iconBg: 'bg-cyan-100', icon: 'text-cyan-700', chart: '#0891b2', border: 'border-cyan-100', glow: 'shadow-cyan-100/40', softChart: '#67e8f9' },
];

const chartPalette = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#e11d48', '#0891b2'];

const tabIcons = {
  executive: Sparkles,
  overview: Activity,
  areas: Layers3,
  'patient-access': Users,
  teleconsultation: Video,
  referrals: Network,
  'pharmacy-lab': Pill,
  facilities: Building2,
  analytics: BarChart3,
  forecasting: LineChartIcon,
  reports: FileText,
  dhis2: Database,
  competitive: Globe2,
  settings: Settings,
  audit: ShieldCheck,
};

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
  const s = String(status || '');
  if (['ready', 'approved', 'configured', 'active', 'generated', 'exported', 'synced', 'high'].includes(s))
    return 'bg-emerald-500 text-white border-emerald-600';
  if (['pending', 'dry_run_only', 'data-dependent', 'low', 'medium', 'warning', 'government_and_mapping_pending'].includes(s))
    return 'bg-amber-400 text-amber-950 border-amber-500';
  if (['info', 'review', 'review_demand_trend', 'coordinates_pending'].includes(s))
    return 'bg-blue-500 text-white border-blue-600';
  if (['missing', 'critical', 'sync_failed', 'rejected'].includes(s))
    return 'bg-rose-500 text-white border-rose-600';
  return 'bg-slate-200 text-slate-700 border-slate-300';
}

function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold capitalize shadow-sm ${statusClass(status)}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {String(status || 'not configured').replace(/_/g, ' ')}
    </span>
  );
}

function EmptyState({ title, body, icon: Icon = CircleDot }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-6 text-sm text-slate-600">
      <div className="flex items-start gap-4">
        <div className="flex-none rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100 p-3 text-blue-600 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-bold text-slate-900">{title}</p>
          <p className="mt-1.5 leading-6">{body}</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon = Activity, accentIndex = 0, hint }) {
  const g = CARD_GRADIENTS[accentIndex % CARD_GRADIENTS.length];
  return (
    <div className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${g.bg} p-5 shadow-lg ${g.shadow} transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/15 transition-transform duration-500 group-hover:scale-125" />
      <div className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/80 truncate">{label}</p>
          <p className="mt-2 text-4xl font-black tracking-tight text-white">{number(value)}</p>
          {hint && <p className="mt-1.5 text-xs font-medium text-white/65">{hint}</p>}
        </div>
        <div className={`flex-none rounded-2xl ${g.icon} p-3 text-white backdrop-blur-sm ring-1 ring-white/20`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="relative mt-4 flex items-center gap-1 text-xs font-semibold text-white/65">
        <ArrowUpRight className="h-3 w-3" />
        <span>Live aggregate signal</span>
      </div>
    </div>
  );
}

function ChartCard({ title, description, data, type = 'line', accentIndex = 0 }) {
  const a = LIGHT_ACCENTS[accentIndex % LIGHT_ACCENTS.length];
  const gradientId = `cg-${title.replace(/[^a-zA-Z0-9]/g, '')}-${accentIndex}`;
  return (
    <Card className={`overflow-hidden border ${a.border} bg-white shadow-xl shadow-slate-100/80`}>
      <CardHeader className={`bg-gradient-to-r ${a.header} border-b border-slate-100`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-black text-slate-950">{title}</CardTitle>
            <CardDescription className="mt-1 text-xs leading-5">{description}</CardDescription>
          </div>
          <div className={`flex-none rounded-xl ${a.icon} p-2`}>
            {type === 'bar' ? <BarChart3 className="h-4 w-4" /> : <AreaChartIcon className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {!data?.length ? (
          <EmptyState title="No chart data yet" body="This chart will populate from real operational activity as records are captured." icon={BarChart3} />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {type === 'bar' ? (
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ border: '0', borderRadius: 14, boxShadow: '0 20px 50px rgba(15,23,42,.15)', fontSize: 12 }} />
                  <Bar dataKey="value" fill={a.chart} radius={[8, 8, 2, 2]} />
                </BarChart>
              ) : (
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={a.chart} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={a.chart} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ border: '0', borderRadius: 14, boxShadow: '0 20px 50px rgba(15,23,42,.15)', fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke={a.chart} strokeWidth={2.5} fill={`url(#${gradientId})`} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionBanner({ eyebrow, title, body, icon: Icon = Sparkles, accentIndex = 0, children }) {
  const gradients = [
    'from-blue-600/12 via-blue-50 to-cyan-50 border-blue-100',
    'from-emerald-600/12 via-emerald-50 to-teal-50 border-emerald-100',
    'from-violet-600/12 via-violet-50 to-indigo-50 border-violet-100',
    'from-amber-600/12 via-amber-50 to-orange-50 border-amber-100',
    'from-rose-600/12 via-rose-50 to-pink-50 border-rose-100',
    'from-cyan-600/12 via-cyan-50 to-sky-50 border-cyan-100',
  ];
  const iconStyles = ['bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-violet-100 text-violet-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700','bg-cyan-100 text-cyan-700'];
  const eyebrowStyles = ['text-blue-700','text-emerald-700','text-violet-700','text-amber-700','text-rose-700','text-cyan-700'];
  const g = gradients[accentIndex % gradients.length];
  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-gradient-to-r ${g} p-5 shadow-md`}>
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-white/50 blur-2xl" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-5xl">
          {eyebrow && <p className={`text-xs font-black uppercase tracking-[0.2em] ${eyebrowStyles[accentIndex % eyebrowStyles.length]}`}>{eyebrow}</p>}
          <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950 md:text-2xl">{title}</h2>
          {body && <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-700">{body}</p>}
        </div>
        <div className={`flex-none rounded-2xl ${iconStyles[accentIndex % iconStyles.length]} p-3 shadow-sm ring-1 ring-white/80`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </section>
  );
}

function ExecutiveKpiSection({ section }) {
  const idx = Math.abs(String(section.key || section.title || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0)) % LIGHT_ACCENTS.length;
  const a = LIGHT_ACCENTS[idx];
  return (
    <Card className={`overflow-hidden border ${a.border} bg-white shadow-xl shadow-slate-100/60`}>
      <CardHeader className={`bg-gradient-to-r ${a.header} border-b border-slate-100`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-black text-slate-950">{section.title}</CardTitle>
            {section.emptyState && <CardDescription className="mt-1 text-xs leading-5">{section.emptyState}</CardDescription>}
          </div>
          <div className={`flex-none rounded-xl ${a.icon} p-2`}><Gauge className="h-4 w-4" /></div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {(section.items || []).map((item, index) => {
          const c = LIGHT_ACCENTS[index % LIGHT_ACCENTS.length];
          return (
            <div
              key={`${section.key}-${item.label}`}
              className={`relative overflow-hidden rounded-xl border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${item.available ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/60'}`}
            >
              <div className={`absolute right-0 top-0 h-14 w-14 translate-x-5 -translate-y-5 rounded-full ${c.icon} opacity-50`} />
              <p className="relative text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className={`relative mt-2 text-xl font-black tracking-tight ${item.available ? 'text-slate-950' : 'text-amber-900'}`}>{formatExecutiveValue(item)}</p>
              {item.emptyState && !item.available && <p className="mt-1.5 text-xs leading-5 text-amber-700">{item.emptyState}</p>}
              {item.description && <p className="mt-1.5 text-xs leading-5 text-slate-500">{item.description}</p>}
            </div>
          );
        })}
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
        icon={MapPin}
      />
    );
  }
  const latitudes = points.map((p) => Number(p.latitude));
  const longitudes = points.map((p) => Number(p.longitude));
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes);
  const scale = (v, mn, mx) => (mx === mn ? 50 : 8 + ((v - mn) / (mx - mn)) * 84);
  return (
    <div className="relative h-96 overflow-hidden rounded-2xl border border-cyan-100 bg-[radial-gradient(circle_at_18%_20%,#cffafe,transparent_32%),radial-gradient(circle_at_82%_18%,#ddd6fe,transparent_28%),linear-gradient(135deg,#f8fafc,#ecfeff_55%,#f5f3ff)] shadow-inner">
      <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(#cbd5e1 1px,transparent 1px),linear-gradient(90deg,#cbd5e1 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
      <div className="absolute left-4 top-4 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-xs font-bold uppercase tracking-widest text-cyan-800 shadow-sm backdrop-blur">
        FCT visibility layer
      </div>
      {points.map((point) => {
        const left = scale(Number(point.longitude), minLng, maxLng);
        const top = 100 - scale(Number(point.latitude), minLat, maxLat);
        return (
          <div
            key={point.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-gradient-to-br from-emerald-500 to-cyan-500 p-2 shadow-xl shadow-cyan-400/30 ring-4 ring-cyan-200/50"
            style={{ left: `${left}%`, top: `${top}%` }}
            title={`${point.name} (${point.lga || point.city || 'unmapped'})`}
          >
            <MapPin className="h-4 w-4 text-white" />
          </div>
        );
      })}
      <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/80 bg-white/92 p-3 text-xs text-slate-600 shadow-lg backdrop-blur">
        <p className="font-bold text-slate-950">{points.length} mapped facility point(s)</p>
        <p className="mt-0.5">Map uses configured facility coordinates only.</p>
      </div>
    </div>
  );
}

function CompactTable({ title, rows, columns, empty, accentIndex = 0 }) {
  const a = LIGHT_ACCENTS[accentIndex % LIGHT_ACCENTS.length];
  return (
    <Card className={`overflow-hidden border ${a.border} bg-white shadow-xl shadow-slate-100/60`}>
      <CardHeader className={`bg-gradient-to-r ${a.header} border-b border-slate-100`}>
        <CardTitle className="text-base font-black text-slate-950">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {!rows?.length ? (
          <EmptyState title="No data yet" body={empty || 'This table will populate from real operational records.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  {columns.map((col) => <th key={col.key} className="px-3 py-2.5 font-bold">{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id || row.provider_id || row.category || row.destination || i} className="border-t border-slate-50 transition-colors hover:bg-blue-50/30">
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2.5 text-slate-700">
                        {col.render ? col.render(row) : (row[col.key] ?? 'N/A')}
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
    <Card className="group overflow-hidden border-0 bg-gradient-to-br from-violet-600 via-purple-500 to-indigo-600 shadow-xl shadow-violet-500/25 transition-all hover:-translate-y-1 hover:shadow-2xl">
      <CardContent className="relative p-5">
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15 transition-transform group-hover:scale-125" />
        <div className="relative flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-white/80">{title}</p>
          <div className="flex-none rounded-xl bg-white/20 p-2 text-white"><TrendingUp className="h-4 w-4" /></div>
        </div>
        <p className="relative mt-3 text-4xl font-black tracking-tight text-white">{number(forecast?.predictedValue)}</p>
        <div className="relative mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            {String(forecast?.confidenceLabel || 'insufficient data').replace(/_/g, ' ')}
          </span>
        </div>
        <p className="relative mt-3 text-xs leading-5 text-white/70">
          {forecast?.explanation || 'Not enough historical data yet.'}
        </p>
      </CardContent>
    </Card>
  );
}

function CompetitiveCoverageGroup({ group }) {
  return (
    <Card className="overflow-hidden border-blue-100 bg-white shadow-xl shadow-blue-100/40">
      <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-emerald-50 border-b border-slate-100">
        <CardTitle className="text-base font-black text-slate-950">{group.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-4">
        {(group.items || []).map(([label, status]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-sm shadow-sm hover:bg-blue-50/30 transition-colors">
            <span className="font-medium text-slate-800">{label}</span>
            <StatusPill status={status} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProgrammeAreaCard({ area, idx = 0 }) {
  const a = LIGHT_ACCENTS[idx % LIGHT_ACCENTS.length];
  return (
    <Card className={`overflow-hidden border ${a.border} bg-white shadow-xl shadow-slate-100/60 transition-all hover:-translate-y-0.5 hover:shadow-2xl`}>
      <CardHeader className={`bg-gradient-to-r ${a.header} border-b border-slate-100`}>
        <CardTitle className="text-base font-black text-slate-950">{area.title}</CardTitle>
        <CardDescription className="text-xs leading-5">{area.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
        {(area.metrics || []).map((metric, mi) => {
          const mg = CARD_GRADIENTS[mi % CARD_GRADIENTS.length];
          return (
            <div key={metric.key} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${mg.bg} p-4 shadow-sm ${mg.shadow}`}>
              <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/15" />
              <p className="relative text-xs font-bold text-white/75 uppercase tracking-wide">{metric.label}</p>
              <p className="relative mt-2 text-2xl font-black text-white">
                {typeof metric.value === 'number' ? number(metric.value) : metric.value}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function compactNumber(value) {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) >= 1000000) return `${(numeric / 1000000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1000) return `${(numeric / 1000).toFixed(1)}K`;
  return number(numeric);
}

function Sparkline({ data, color = '#2563eb', gradientId }) {
  if (!data?.length) {
    return <div className="h-12 rounded-xl bg-gradient-to-r from-slate-100 to-white" />;
  }

  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.28} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#${gradientId})`} dot={false} activeDot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CommandStatCard({ label, value, icon: Icon = Activity, accentIndex = 0, trendData, detail }) {
  const accent = accentStyles[accentIndex % accentStyles.length];
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(37,99,235,0.16)]">
      <div className={`absolute inset-x-0 bottom-0 h-20 ${accent.panel} opacity-80`} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-2 text-3xl font-black tracking-tight ${accent.text}`}>{compactNumber(value)}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">{detail || 'Live aggregate signal'}</p>
        </div>
        <div className={`rounded-2xl ${accent.iconBg} p-2.5 ${accent.icon} shadow-sm ring-1 ring-white`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="relative mt-3">
        <Sparkline data={trendData || []} color={accent.chart} gradientId={`spark-${label.replace(/[^a-zA-Z0-9]/g, '')}-${accentIndex}`} />
      </div>
    </div>
  );
}

function CommandTrendPanel({ consultations, teleconsultations }) {
  const seriesMap = new Map();
  (consultations || []).forEach((point) => {
    const key = point.date || point.name || point.period;
    if (!key) return;
    seriesMap.set(key, { date: key, consultations: Number(point.value || 0), teleconsultations: 0 });
  });
  (teleconsultations || []).forEach((point) => {
    const key = point.date || point.name || point.period;
    if (!key) return;
    const row = seriesMap.get(key) || { date: key, consultations: 0, teleconsultations: 0 };
    row.teleconsultations = Number(point.value || 0);
    seriesMap.set(key, row);
  });
  const data = Array.from(seriesMap.values());

  return (
    <Card className="overflow-hidden border-blue-100 bg-white shadow-[0_24px_70px_rgba(37,99,235,0.11)]">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white via-blue-50/80 to-cyan-50/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg font-black text-slate-950">Consultations Trend</CardTitle>
            <CardDescription>Onsite and teleconsultation demand from real operational records.</CardDescription>
          </div>
          <div className="flex rounded-2xl border border-blue-100 bg-white p-1 text-xs font-bold text-slate-600 shadow-sm">
            <span className="rounded-xl bg-blue-600 px-3 py-1.5 text-white">Weekly</span>
            <span className="px-3 py-1.5">90-day</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <EmptyState title="No consultation trend yet" body="This chart populates when consultation and teleconsultation records are captured." icon={AreaChartIcon} />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="commandConsultations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="commandTeleconsultations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip contentStyle={{ border: '0', borderRadius: 16, boxShadow: '0 18px 45px rgba(15,23,42,.14)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="consultations" name="Consultations" stroke="#2563eb" strokeWidth={3} fill="url(#commandConsultations)" dot={false} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="teleconsultations" name="Teleconsultations" stroke="#06b6d4" strokeWidth={3} fill="url(#commandTeleconsultations)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HorizontalBarPanel({ title, rows, labelKey, valueKey, empty, accentIndex = 0, limit = 8 }) {
  const accent = accentStyles[accentIndex % accentStyles.length];
  const visibleRows = (rows || []).slice(0, limit);
  const maxValue = Math.max(...visibleRows.map((row) => Number(row[valueKey] || 0)), 0);
  return (
    <Card className={`overflow-hidden border ${accent.border} bg-white shadow-lg ${accent.glow}`}>
      <CardHeader className={`${accent.panel} border-b border-white/70`}>
        <CardTitle className="text-lg font-black text-slate-950">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!visibleRows.length ? (
          <EmptyState title="Mapping data needed" body={empty || 'This panel will populate when mapped operational records exist.'} icon={BarChart3} />
        ) : visibleRows.map((row, index) => {
          const value = Number(row[valueKey] || 0);
          const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 6) : 0;
          return (
            <div key={`${row[labelKey] || index}-${value}`} className="grid grid-cols-[minmax(7rem,1fr)_2fr_auto] items-center gap-3 text-sm">
              <span className="truncate font-semibold text-slate-700">{row[labelKey] || 'Unmapped'}</span>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: `linear-gradient(90deg, ${accent.softChart}, ${accent.chart})` }} />
              </div>
              <span className="min-w-12 text-right font-black text-slate-950">{number(value)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CategoryDonutPanel({ rows, total }) {
  const data = (rows || []).slice(0, 5).map((row, index) => ({
    name: row.category || row.facility_type || row.status || `Category ${index + 1}`,
    value: Number(row.count || row.value || 0),
    color: chartPalette[index % chartPalette.length],
  })).filter((row) => row.value > 0);
  const totalValue = total || data.reduce((sum, row) => sum + row.value, 0);

  return (
    <Card className="overflow-hidden border-purple-100 bg-white shadow-lg shadow-purple-100/60">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-purple-50 via-white to-cyan-50">
        <CardTitle className="text-lg font-black text-slate-950">Consultations by Category</CardTitle>
        <CardDescription>Complaint, service, or facility categories where captured.</CardDescription>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <EmptyState title="Category mapping needed" body="Add reason-for-visit, service category, diagnosis category, or facility type mappings to populate this panel." icon={PieChartIcon} />
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_1.1fr] md:items-center">
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                    {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ border: '0', borderRadius: 16, boxShadow: '0 18px 45px rgba(15,23,42,.14)' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="text-2xl font-black text-slate-950">{compactNumber(totalValue)}</p>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Total</p>
              </div>
            </div>
            <div className="space-y-2">
              {data.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="font-black text-slate-950">{number(row.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReferralFlowPanel({ metrics }) {
  const flow = [
    { label: 'Created', value: metrics.referrals_created, icon: UploadCloud, color: 'from-emerald-50 to-white text-emerald-700 border-emerald-100' },
    { label: 'Completed', value: metrics.referrals_completed, icon: CheckCircle2, color: 'from-blue-50 to-white text-blue-700 border-blue-100' },
    { label: 'Pending', value: metrics.pending_referrals, icon: ClipboardList, color: 'from-purple-50 to-white text-purple-700 border-purple-100' },
  ];
  const completion = Number(metrics.referrals_created || 0) > 0
    ? Math.round((Number(metrics.referrals_completed || 0) / Number(metrics.referrals_created || 0)) * 100)
    : 0;

  return (
    <Card className="overflow-hidden border-blue-100 bg-white shadow-lg shadow-blue-100/60">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <CardTitle className="text-lg font-black text-slate-950">Referral Flow</CardTitle>
        <CardDescription>PHC, hospital, specialist, pharmacy, and lab coordination state.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {flow.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className={`rounded-3xl border bg-gradient-to-br p-4 text-center shadow-sm ${item.color}`}>
                <Icon className="mx-auto h-6 w-6" />
                <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-500">{item.label}</p>
                <p className="mt-1 text-2xl font-black">{number(item.value)}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-slate-700">Referral completion rate</span>
            <span className="font-black text-slate-950">{completion}%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500" style={{ width: `${completion}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PrescriptionDemandPanel({ metrics, rows, chartData }) {
  const visibleRows = (rows || []).slice(0, 5);
  return (
    <Card className="overflow-hidden border-amber-100 bg-white shadow-lg shadow-amber-100/60">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-amber-50 via-white to-orange-50">
        <CardTitle className="text-lg font-black text-slate-950">Prescription Demand</CardTitle>
        <CardDescription>Medication demand signal from prescription and request records only.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Total items requested</p>
            <p className="mt-1 text-3xl font-black text-slate-950">{number(metrics.prescriptions_created)}</p>
            <div className="mt-3">
              <Sparkline data={chartData || []} color="#d97706" gradientId="prescriptionDemandSpark" />
            </div>
          </div>
          <div className="space-y-2">
            {!visibleRows.length ? (
              <EmptyState title="No medication categories yet" body="Medication category reporting appears when prescription or pharmacy request categories are captured." icon={Pill} />
            ) : visibleRows.map((row, index) => (
              <div key={`${row.category}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-amber-50/60 px-3 py-2 text-sm">
                <span className="truncate font-semibold text-slate-700">{index + 1}. {row.category || 'Unmapped category'}</span>
                <span className="font-black text-slate-950">{number(row.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DiseaseSignalPanel({ rows, signals }) {
  const signalLookup = new Map((signals || []).map((signal) => [String(signal.title || '').toLowerCase(), signal]));
  const visibleRows = (rows || []).slice(0, 6);
  return (
    <Card className="overflow-hidden border-rose-100 bg-white shadow-lg shadow-rose-100/60">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-rose-50 via-white to-amber-50">
        <CardTitle className="text-lg font-black text-slate-950">Disease / Complaint Surveillance</CardTitle>
        <CardDescription>Planning signals from aggregate complaint and service-demand categories only.</CardDescription>
      </CardHeader>
      <CardContent>
        {!visibleRows.length ? (
          <EmptyState title="No complaint categories yet" body="Capture complaint or diagnosis categories to show aggregate disease-pattern planning signals. This is not clinical diagnosis or outbreak declaration." icon={HeartPulse} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Cases</th>
                  <th className="px-3 py-2">Planning signal</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const signal = signalLookup.get(String(row.category || '').toLowerCase());
                  return (
                    <tr key={`${row.category}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-3 font-semibold text-slate-800">{row.category || 'Unmapped'}</td>
                      <td className="px-3 py-3 font-black text-slate-950">{number(row.count)}</td>
                      <td className="px-3 py-3"><StatusPill status={signal?.severity || 'info'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadinessStatusPanel({ badges, indicators }) {
  const configuredIndicators = (indicators || []).filter((indicator) => indicator.dhis2_data_element_id || indicator.dhis2DataElementId).length;
  return (
    <Card className="overflow-hidden border-emerald-100 bg-white shadow-lg shadow-emerald-100/60">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50">
        <CardTitle className="text-lg font-black text-slate-950">Government Readiness Status</CardTitle>
        <CardDescription>Aggregate reporting readiness without claiming live government submission.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {badges.map(([label, status]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
              <div className="mt-2"><StatusPill status={status} /></div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-emerald-900">Mapped DHIS2 indicators</span>
            <span className="font-black text-emerald-900">{configuredIndicators}/{number((indicators || []).length)}</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-cyan-500"
              style={{ width: `${(indicators || []).length ? (configuredIndicators / indicators.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertsPanel({ signals, actions }) {
  const items = [
    ...(signals || []).map((signal) => ({ title: signal.title, message: signal.message, status: signal.severity || 'info' })),
    ...(actions || []).slice(0, 3).map((action) => ({
      title: typeof action === 'string' ? 'Leadership action' : action.title,
      message: typeof action === 'string' ? action : action.message,
      status: 'info',
    })),
  ].slice(0, 6);

  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-lg shadow-slate-100">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-white via-blue-50 to-purple-50">
        <CardTitle className="text-lg font-black text-slate-950">Alerts & Notifications</CardTitle>
        <CardDescription>Planning notices from real aggregate metrics and readiness state.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!items.length ? (
          <EmptyState title="No alerts yet" body="Alerts appear when aggregate trends, readiness gaps, or operational patterns need leadership review." icon={CircleDot} />
        ) : items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold text-slate-950">{item.title}</p>
              <StatusPill status={item.status} />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.message}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Dhis2ConsolePanel({ readiness, settings, indicators, preview, onValidate, onDryRun, canDryRun, working }) {
  const mappedIndicators = (indicators || []).filter((indicator) => indicator.dhis2_data_element_id || indicator.dhis2DataElementId).length;
  const consoleRows = [
    ['Local aggregate mode', 'OK'],
    ['NHMIS/DHIS2 status', settings?.enabled ? 'Configured' : 'Dry run only'],
    ['Dataset ID', settings?.datasetId ? 'Configured' : 'Pending'],
    ['Org unit ID', settings?.orgUnitId ? 'Configured' : 'Pending'],
    ['Mapped indicators', `${mappedIndicators}/${(indicators || []).length}`],
    ['Government approval', settings?.governmentApprovalStatus || 'pending'],
    ['API credentials', settings?.apiCredentialsStatus || 'pending'],
    ['Data sharing agreement', settings?.dataSharingAgreementStatus || 'pending'],
    ['Sync mode', settings?.dryRunOnly === false ? 'live disabled until approval checks pass' : 'dry run only'],
    ['No patient identifiers', readiness?.noPatientIdentifiers === false ? 'Review' : 'OK'],
  ];

  return (
    <Card className="overflow-hidden border-slate-800 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-900/20">
      <CardHeader className="border-b border-slate-800 bg-slate-900">
        <CardTitle className="flex items-center gap-2 text-lg font-black text-white"><Database className="h-5 w-5 text-cyan-300" /> DHIS2 / NHMIS Reporting Preview</CardTitle>
        <CardDescription className="text-slate-300">Dry-run readiness console. No government API submission is made without official credentials, mappings, approval, and dry-run disabled.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-slate-800 bg-[#0f172a] p-4 font-mono text-xs leading-6 text-emerald-300 shadow-inner">
          {consoleRows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[1fr_auto] gap-3">
              <span>&gt; {label}</span>
              <span className={String(value).toLowerCase().includes('pending') ? 'text-amber-300' : 'text-emerald-300'}>{String(value).replace(/_/g, ' ')}</span>
            </div>
          ))}
          {preview?.payload && (
            <div className="mt-4 border-t border-slate-700 pt-3 text-cyan-200">
              &gt; Preview payload ready: {preview.payload.dataValues?.length || 0} aggregate value(s)
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={onValidate} disabled={working} className="h-11 rounded-xl border-slate-600 bg-slate-900 font-bold text-white hover:bg-slate-800">
            {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Validate readiness
          </Button>
          <Button type="button" onClick={onDryRun} disabled={!canDryRun || working} className="h-11 rounded-xl bg-blue-600 font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Push dry run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ExecutiveCommandCenter({
  metrics,
  executiveCharts,
  executiveTables,
  executiveMaps,
  executiveForecastCards,
  readinessBadges,
  readiness,
  dhis2Settings,
  indicators,
  preview,
  earlyPlanningSignals,
  leadershipActions,
  testConnection,
  dryRunDhis2,
  reports,
  working,
}) {
  const commandStats = [
    { label: 'Consultations', value: metrics.total_consultations, icon: Users, accentIndex: 0, trendData: executiveCharts.consultations, detail: 'Aggregate care volume' },
    { label: 'Teleconsultations', value: metrics.teleconsultations, icon: Video, accentIndex: 5, trendData: executiveCharts.teleconsultations, detail: 'Digital access volume' },
    { label: 'Referrals', value: metrics.referrals_created, icon: Network, accentIndex: 2, trendData: executiveCharts.referrals, detail: 'Coordination load' },
    { label: 'Prescription Demand', value: metrics.prescriptions_created, icon: Pill, accentIndex: 3, trendData: executiveCharts.prescriptions, detail: 'Medication signal' },
    { label: 'PHC Utilization', value: metrics.active_facilities, icon: Building2, accentIndex: 1, trendData: executiveCharts.consultations, detail: 'Active facilities' },
    { label: 'Provider Workload', value: metrics.active_providers, icon: Stethoscope, accentIndex: 4, trendData: executiveCharts.teleconsultations, detail: 'Active providers' },
    { label: 'Patient Access', value: metrics.active_patients, icon: HeartPulse, accentIndex: 0, trendData: executiveCharts.registrations, detail: 'Active patients' },
  ];
  const lgaRows = executiveMaps?.lgaFacilityBreakdown || [];
  const latestReport = (reports || [])[0];

  return (
    <section className="space-y-4 rounded-[2rem] border border-white bg-white/70 p-3 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur md:p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {commandStats.map((stat) => <CommandStatCard key={stat.label} {...stat} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr_1.05fr]">
        <CommandTrendPanel consultations={executiveCharts.consultations || []} teleconsultations={executiveCharts.teleconsultations || []} />
        <HorizontalBarPanel
          title="Facilities by LGA / Location"
          rows={lgaRows}
          labelKey="location"
          valueKey="facility_count"
          accentIndex={0}
          empty="LGA rankings will populate after PHC, public hospital, patient access, or referral records are mapped to LGA/ward."
        />
        <CategoryDonutPanel rows={executiveTables.complaintCategories || executiveTables.facilityTypeBreakdown || []} total={metrics.total_consultations} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden border-cyan-100 bg-white shadow-lg shadow-cyan-100/60">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-cyan-50 via-white to-blue-50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg font-black text-slate-950">LGA Ward Public-Health Visibility</CardTitle>
                <CardDescription>Map-ready public-health visibility from configured facility coordinates and LGA/ward mappings.</CardDescription>
              </div>
              <StatusPill status={executiveMaps?.mapReadiness || 'coordinates_pending'} />
            </div>
          </CardHeader>
          <CardContent>
            <IntelligenceMap mapData={executiveMaps} />
          </CardContent>
        </Card>
        <Dhis2ConsolePanel
          readiness={readiness}
          settings={dhis2Settings}
          indicators={indicators}
          preview={preview}
          onValidate={testConnection}
          onDryRun={() => latestReport && dryRunDhis2(latestReport.id)}
          canDryRun={Boolean(latestReport?.id)}
          working={working}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.8fr]">
        <DiseaseSignalPanel rows={executiveTables.complaintCategories || []} signals={earlyPlanningSignals || []} />
        <ReferralFlowPanel metrics={metrics} />
        <PrescriptionDemandPanel metrics={metrics} rows={executiveTables.medicineCategories || executiveTables.topMedicationClasses || []} chartData={executiveCharts.prescriptions || []} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr_0.95fr]">
        <Card className="overflow-hidden border-purple-100 bg-white shadow-lg shadow-purple-100/60">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-purple-50 via-white to-blue-50">
            <CardTitle className="text-lg font-black text-slate-950">Forecasting & Planning Intelligence</CardTitle>
            <CardDescription>Explainable operational forecasts only. No clinical diagnosis or outbreak prediction.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {executiveForecastCards.slice(0, 4).map(([title, cardForecast]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-purple-50/50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{number(cardForecast?.predictedValue)}</p>
                <div className="mt-2"><StatusPill status={cardForecast?.confidenceLabel || 'insufficient_data'} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <ReadinessStatusPanel badges={readinessBadges} indicators={indicators} />
        <AlertsPanel signals={earlyPlanningSignals || []} actions={leadershipActions || []} />
      </div>
    </section>
  );
}

export default function PublicHealthProgrammeDashboard({ initialTab = 'overview' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [period, setPeriod] = useState(currentPeriod());
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', facilityId: '', facilityType: '', lga: '', ward: '', providerId: '', programmeArea: '' });
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
    environment: 'disabled', datasetId: '', orgUnitId: '', attributeOptionComboId: '',
    governmentApprovalStatus: 'pending', apiCredentialsStatus: 'pending',
    dataSharingAgreementStatus: 'pending', ndprReviewStatus: 'pending',
    enabled: false, dryRunOnly: true,
  });

  const metrics = overview?.metrics || {};
  const readiness = overview?.dhis2Readiness || {};
  const charts = analytics?.charts || {};
  const executiveCharts = executive?.charts || {};
  const executiveForecasts = executive?.forecasts || {};
  const executiveTables = executive?.tables || {};
  const executiveMaps = executive?.maps || {};

  const metricIcons = useMemo(() => ({
    total_consultations: Stethoscope, teleconsultations: Video,
    completed_consultations: CheckCircle2, cancelled_consultations: Activity,
    failed_video_sessions: Video, audio_fallback_sessions: Activity,
    active_patients: Users, new_patient_registrations: Users,
    patient_access_requests: HeartPulse, appointment_bookings: ClipboardList,
    followup_appointments: ClipboardList, referrals_created: UploadCloud,
    referrals_completed: CheckCircle2, pending_referrals: ClipboardList,
    prescriptions_created: Pill, pharmacy_referrals: Pill,
    lab_referrals: FlaskConical, active_providers: Stethoscope,
    active_facilities: Building2, notifications_sent: Activity,
    reports_generated: FileText, cancer_related_referrals: HeartPulse,
  }), []);

  function buildQuery(extra = {}) {
    return Object.fromEntries(
      Object.entries({ period, ...filters, ...extra }).filter(([, v]) => v !== undefined && v !== null && v !== '')
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
      const s = settingsRes.data?.settings || {};
      setDhis2Settings(s);
      setSettingsForm((cur) => ({ ...cur, ...s, enabled: s.enabled === true, dryRunOnly: s.dryRunOnly !== false }));
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Could not load public-health programme data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAction(action) {
    setWorking(true); setMessage(''); setError('');
    try { await action(); } catch (e) { setError(e.response?.data?.error || e.message || 'Action failed.'); } finally { setWorking(false); }
  }

  const generateReport = () => runAction(async () => {
    const res = await api.post('/ng/public-health/reports/generate', { period, reportType: 'monthly_aggregate' });
    setSelectedReport(res.data);
    setMessage('Aggregate public-health report generated from real operational data.');
    await loadAll();
  });
  const approveReport = (id) => runAction(async () => {
    await api.post(`/ng/public-health/reports/${id}/approve`, { notes: 'Approved for aggregate export review.' });
    setMessage('Report approved for export workflow.'); await loadAll();
  });
  const exportJson = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/json`);
    setSelectedReport(res.data); setMessage('JSON aggregate export generated.');
  });
  const exportCsv = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/csv`, {}, { responseType: 'text' });
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `doctarx-ng-public-health-${period}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setMessage('CSV export generated.');
  });
  const previewDhis2 = (id) => runAction(async () => {
    const res = await api.post(`/ng/public-health/reports/${id}/export/dhis2-preview`);
    setPreview(res.data); setMessage('DHIS2 dataValueSet preview generated in dry-run mode only.');
  });
  const dryRunDhis2 = (id) => runAction(async () => {
    const res = await api.post(`/ng/integrations/dhis2/dry-run/${id}`);
    setPreview(res.data); setMessage('Dry-run preview logged. No data was sent to government systems.'); await loadAll();
  });
  const saveSettings = () => runAction(async () => {
    await api.post('/ng/integrations/dhis2/settings', {
      environment: settingsForm.environment, datasetId: settingsForm.datasetId,
      orgUnitId: settingsForm.orgUnitId, attributeOptionComboId: settingsForm.attributeOptionComboId,
      governmentApprovalStatus: settingsForm.governmentApprovalStatus, apiCredentialsStatus: settingsForm.apiCredentialsStatus,
      dataSharingAgreementStatus: settingsForm.dataSharingAgreementStatus, ndprReviewStatus: settingsForm.ndprReviewStatus,
      enabled: settingsForm.enabled, dryRunOnly: settingsForm.dryRunOnly,
    });
    setMessage('DHIS2 readiness settings saved.'); await loadAll();
  });
  const testConnection = () => runAction(async () => {
    const res = await api.post('/ng/integrations/dhis2/test-connection');
    setPreview(res.data); setMessage('Readiness check completed.');
  });

  const heroStats = [
    { label: 'Total Consultations', value: metrics.total_consultations, icon: Stethoscope, g: 'from-blue-600 to-cyan-500', sh: 'shadow-blue-400/40' },
    { label: 'Teleconsults', value: metrics.teleconsultations, icon: Video, g: 'from-emerald-600 to-teal-400', sh: 'shadow-emerald-400/40' },
    { label: 'Referrals', value: metrics.referrals_created, icon: Network, g: 'from-violet-600 to-indigo-500', sh: 'shadow-violet-400/40' },
    { label: 'Prescriptions', value: metrics.prescriptions_created, icon: Pill, g: 'from-amber-500 to-orange-400', sh: 'shadow-amber-400/40' },
    { label: 'Active Patients', value: metrics.active_patients, icon: Users, g: 'from-rose-500 to-pink-400', sh: 'shadow-rose-400/40' },
    { label: 'Active Facilities', value: metrics.active_facilities, icon: Building2, g: 'from-cyan-600 to-sky-400', sh: 'shadow-cyan-400/40' },
  ];

  const readinessBadges = [
    ['Local Aggregate', 'ready'],
    ['DHIS2 Dry Run', readiness.syncStatus || 'dry_run_only'],
    ['Gov Approval', dhis2Settings?.governmentApprovalStatus || 'pending'],
    ['API Credentials', dhis2Settings?.apiCredentialsStatus || 'pending'],
    ['NDPR Review', dhis2Settings?.ndprReviewStatus || 'pending'],
  ];

  const serviceMix = [
    { name: 'Consultations', value: Number(metrics.total_consultations || 0), color: chartPalette[0] },
    { name: 'Teleconsultations', value: Number(metrics.teleconsultations || 0), color: chartPalette[1] },
    { name: 'Referrals', value: Number(metrics.referrals_created || 0), color: chartPalette[2] },
    { name: 'Prescriptions', value: Number(metrics.prescriptions_created || 0), color: chartPalette[3] },
  ].filter((i) => i.value > 0);

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
      title: 'Patient Access Charts', accentIndex: 0,
      charts: [
        ['New patient registrations over time', 'Registration growth from Nigeria patient accounts.', executiveCharts.registrations],
        ['Total patients served over time', 'Patient service reach from real consultation activity.', executiveCharts.consultations],
        ['Appointment bookings over time', 'Booked care demand over time.', executiveCharts.consultations],
        ['Follow-up completion trend', 'Follow-up demand from appointment records.', executiveCharts.followups],
        ['Patient access by facility', 'Requires facility-linked appointment records.', []],
        ['Patient access by LGA/ward', 'Requires LGA/ward mapping on records.', []],
      ],
    },
    {
      title: 'Telemedicine Charts', accentIndex: 1,
      charts: [
        ['Teleconsultations over time', 'Digital care demand over time.', executiveCharts.teleconsultations],
        ['Video success vs audio fallback', 'Uses video failure and audio fallback tracking.', []],
        ['Teleconsultation demand by facility', 'Requires facility linkage on virtual visits.', []],
        ['Teleconsultation adoption trend', 'Teleconsultations as a share of consultation demand.', executiveCharts.teleconsultations],
      ],
    },
    {
      title: 'Consultation and Referral Charts', accentIndex: 2,
      charts: [
        ['Total consultations over time', 'Consultation demand trend.', executiveCharts.consultations],
        ['Referrals over time', 'Referral coordination volume.', executiveCharts.referrals],
        ['Referral completion trend', 'Requires referral completed_at/status data.', executiveCharts.referrals],
        ['Consultation by facility type', 'Requires facility type mapping.', []],
      ],
    },
    {
      title: 'Pharmacy, Lab and Facility Charts', accentIndex: 3,
      charts: [
        ['Prescriptions over time', 'Medication demand signal from prescriptions.', executiveCharts.prescriptions],
        ['Pharmacy referrals over time', 'Dispense/pharmacy request trend.', executiveCharts.pharmacyReferrals],
        ['Lab referrals over time', 'Diagnostic coordination demand.', executiveCharts.labReferrals],
        ['Early signal trend chart', 'Shown when aggregate signals have enough history.', []],
      ],
    },
    {
      title: 'Forecasting Charts', accentIndex: 4,
      charts: [
        ['7-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations7Day?.historicalPoints],
        ['14-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations14Day?.historicalPoints],
        ['30-day demand forecast', 'Explainable operational demand projection.', executiveForecasts.consultations30Day?.historicalPoints],
        ['Expected prescriptions forecast', 'Medicine demand planning signal.', executiveForecasts.prescriptions14Day?.historicalPoints],
      ],
    },
  ];

  return (
    <div className="relative min-h-screen space-y-6 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/50 p-3 sm:p-5">
      {/* ambient background blobs */}
      <div className="pointer-events-none fixed -left-32 top-20 h-96 w-96 rounded-full bg-blue-200/25 blur-3xl" />
      <div className="pointer-events-none fixed -right-32 top-64 h-96 w-96 rounded-full bg-violet-200/20 blur-3xl" />
      <div className="pointer-events-none fixed bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-200/15 blur-3xl" />

      {/* ─── HERO HEADER ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_10%_18%,rgba(34,211,238,.42),transparent_28%),radial-gradient(circle_at_85%_8%,rgba(139,92,246,.40),transparent_28%),radial-gradient(circle_at_50%_95%,rgba(16,185,129,.25),transparent_30%),linear-gradient(135deg,#060d20,#0d1f5c_42%,#083344)] p-6 text-white shadow-2xl shadow-blue-950/30 md:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="pointer-events-none absolute -right-24 top-0 h-64 w-64 rounded-full bg-cyan-400/12 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            {/* badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100 shadow backdrop-blur">
                <ShieldCheck className="h-3.5 w-3.5" /> DoctaRx Nigeria
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/15 px-3 py-1.5 text-xs font-bold text-emerald-100">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live intelligence
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-bold text-blue-100">
                <Sparkles className="h-3.5 w-3.5" /> Executive command center
              </span>
            </div>

            <h1 className="mt-5 text-4xl font-black tracking-tight text-white md:text-5xl lg:text-6xl">
              Public Health<br />
              <span className="bg-gradient-to-r from-cyan-300 via-blue-200 to-violet-300 bg-clip-text text-transparent">
                Intelligence Programme
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-100/85 md:text-base">
              DoctaRx helps AMAC and public-health leaders see consultations, disease trends, referrals,
              prescription demand, PHC utilization, and forecasted health-service needs in real time through
              executive dashboards, programme analytics, DHIS2/NHMIS-ready reporting, and planning intelligence.
            </p>

            {/* readiness badges */}
            <div className="mt-5 flex flex-wrap gap-2">
              {readinessBadges.map(([label, status]) => {
                const isReady = status === 'ready';
                return (
                  <span key={label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${isReady ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-100' : 'border-white/15 bg-white/8 text-white/75'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {label}: {String(status || 'pending').replace(/_/g, ' ')}
                  </span>
                );
              })}
            </div>
          </div>

          {/* period + service mix */}
          <div className="grid gap-4 sm:grid-cols-2 xl:w-[22rem] xl:grid-cols-1">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-bold text-white"><CalendarDays className="h-4 w-4 text-cyan-300" /> Reporting period</p>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-3 h-10 border-white/20 bg-white text-slate-950" />
              <Button onClick={loadAll} variant="secondary" disabled={loading} className="mt-3 h-10 w-full rounded-xl font-bold">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh intelligence
              </Button>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-bold text-white"><PieChartIcon className="h-4 w-4 text-violet-300" /> Service mix</p>
              {serviceMix.length ? (
                <div className="mt-2 h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={serviceMix} dataKey="value" nameKey="name" innerRadius={28} outerRadius={46} paddingAngle={3}>
                        {serviceMix.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ border: '0', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,.2)', background: '#1e293b', color: '#f1f5f9', fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-blue-100/70">Service mix appears when aggregate activity is captured.</p>
              )}
            </div>
          </div>
        </div>

        {/* hero stat grid */}
        <div className="relative mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {heroStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${stat.g} p-4 shadow-lg ${stat.sh} transition-all hover:-translate-y-0.5 hover:shadow-xl`}>
                <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/15 transition-transform group-hover:scale-150" />
                <div className="relative flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white/80">{stat.label}</p>
                  <div className="flex-none rounded-xl bg-white/20 p-1.5 text-white"><Icon className="h-4 w-4" /></div>
                </div>
                <p className="relative mt-2 text-3xl font-black tracking-tight text-white">{number(stat.value)}</p>
                <p className="relative mt-1 text-xs text-white/55">Period aggregate</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── ALERTS ─────────────────────────────────────────────── */}
      {message && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 shadow-sm">
          <Zap className="mt-0.5 h-4 w-4 flex-none text-rose-500" />
          {error}
        </div>
      )}

      {/* ─── FILTER PANEL ───────────────────────────────────────── */}
      <Card className="overflow-hidden border-blue-100 bg-white/95 shadow-xl shadow-blue-100/40 backdrop-blur">
        <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-violet-50 border-b border-slate-100">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base font-black text-slate-950">Executive control surface</CardTitle>
              <CardDescription className="text-xs leading-5">Filter intelligence by period, facility, LGA, ward, provider, and programme area.</CardDescription>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> Real data mode
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <div key={key} className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</Label>
              <Input
                type={type}
                value={filters[key] || ''}
                placeholder={placeholder}
                onChange={(e) => setFilters((cur) => ({ ...cur, [key]: e.target.value }))}
                className="h-10 rounded-xl border-slate-200 bg-slate-50/60 text-sm"
              />
            </div>
          ))}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button onClick={loadAll} disabled={loading} className="h-10 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 font-bold text-white hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-200">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Apply filters
            </Button>
            <Button type="button" variant="outline" onClick={() => setFilters({ dateFrom: '', dateTo: '', facilityId: '', facilityType: '', lga: '', ward: '', providerId: '', programmeArea: '' })} className="h-10 rounded-xl font-bold">
              Clear
            </Button>
          </div>
          {(executive?.filterState?.limitations || []).length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 sm:col-span-2 lg:col-span-4">
              <p className="font-bold">Filter mapping notice</p>
              <ul className="mt-1 list-disc pl-5">
                {executive.filterState.limitations.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── TABS ───────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-xl shadow-slate-100/60 backdrop-blur">
          <TabsList className="flex h-auto min-w-max flex-nowrap gap-1.5 bg-transparent p-0">
            {tabs.map(([value, label]) => {
              const TabIcon = tabIcons[value] || Activity;
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-none rounded-xl border border-transparent px-3 py-2 text-xs font-bold text-slate-600 transition-all hover:border-slate-200 hover:bg-slate-50 data-[state=active]:border-blue-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-200/50"
                >
                  <TabIcon className="mr-1.5 h-3.5 w-3.5" />
                  {label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-blue-100 bg-white p-16 shadow-xl">
            <div className="rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100 p-5">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-sm font-bold text-slate-700">Loading public-health intelligence...</p>
            <p className="text-xs text-slate-500">Fetching executive data, analytics, and forecasts</p>
          </div>
        ) : (
          <>
            {/* ══ EXECUTIVE TAB ═══════════════════════════════════ */}
            <TabsContent value="executive" className="space-y-6">
              <SectionBanner
                eyebrow="Executive intelligence"
                title="Real-time public-health command center"
                body="A leadership view for FCTA/HSES, FMOH, AMAC, public hospitals, PHCs, and programme directors: what is happening now, what is changing over time, where demand is rising, and which operational actions need review."
                icon={Sparkles}
                accentIndex={0}
              >
                <div className="flex flex-wrap gap-2">
                  <StatusPill status={executive?.governance?.dhis2Status || readiness.status} />
                  <StatusPill status={executive?.governance?.forecastStatus || overview?.forecastStatus || 'insufficient_data'} />
                </div>
              </SectionBanner>

              <ExecutiveCommandCenter
                metrics={metrics}
                executiveCharts={executiveCharts}
                executiveTables={executiveTables}
                executiveMaps={executiveMaps}
                executiveForecastCards={executiveForecastCards}
                readinessBadges={readinessBadges}
                readiness={readiness}
                dhis2Settings={dhis2Settings}
                indicators={indicators}
                preview={preview}
                earlyPlanningSignals={executive?.earlyPlanningSignals || []}
                leadershipActions={executive?.leadershipActions || []}
                testConnection={testConnection}
                dryRunDhis2={dryRunDhis2}
                reports={reports}
                working={working}
              />

              <section className="grid gap-4 lg:grid-cols-2">
                {(executive?.kpiSections || []).map((section) => (
                  <ExecutiveKpiSection key={section.key} section={section} />
                ))}
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <ChartCard title="Consultations over time" description="Operational demand trend from real consultation records." data={executiveCharts.consultations || []} accentIndex={0} />
                <ChartCard title="Teleconsultations over time" description="Digital access and video/audio care trend." data={executiveCharts.teleconsultations || []} accentIndex={1} />
                <ChartCard title="Referrals over time" description="PHC, hospital, specialist, lab, and pharmacy referral movement." data={executiveCharts.referrals || []} type="bar" accentIndex={2} />
                <ChartCard title="Patient registration growth" description="Public access growth from Nigeria patient registration records." data={executiveCharts.registrations || []} accentIndex={3} />
                <ChartCard title="Prescription demand trend" description="Medication demand signal from prescription records." data={executiveCharts.prescriptions || []} accentIndex={4} />
                <ChartCard title="Lab and pharmacy referral trend" description="Referral coordination pressure for diagnostic and medication planning." data={[...(executiveCharts.labReferrals || []), ...(executiveCharts.pharmacyReferrals || [])]} type="bar" accentIndex={5} />
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Card className="overflow-hidden border-cyan-100 bg-white shadow-xl shadow-cyan-100/40">
                  <CardHeader className="bg-gradient-to-r from-cyan-50 via-white to-blue-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><MapPin className="h-4 w-4 text-cyan-600" /> Public-health visibility map</CardTitle>
                    <CardDescription className="text-xs">Facility and referral map points shown only when real facility coordinates are configured.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4"><IntelligenceMap mapData={executiveMaps} /></CardContent>
                </Card>
                <Card className="overflow-hidden border-amber-100 bg-white shadow-xl shadow-amber-100/40">
                  <CardHeader className="bg-gradient-to-r from-amber-50 via-white to-rose-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Gauge className="h-4 w-4 text-amber-600" /> Early signal detection</CardTitle>
                    <CardDescription className="text-xs">Generated from aggregate operational metrics only. No disease diagnosis claimed.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    {(executive?.earlyPlanningSignals || []).length ? executive.earlyPlanningSignals.map((signal) => (
                      <div key={signal.title} className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-amber-50/50 p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-slate-950 text-sm">{signal.title}</p>
                          <StatusPill status={signal.severity || 'info'} />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{signal.message}</p>
                      </div>
                    )) : (
                      <EmptyState title="No early signals yet" body="Signals appear when aggregate trends show enough operational change to support planning review." icon={Gauge} />
                    )}
                  </CardContent>
                </Card>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {executiveForecastCards.map(([title, fc]) => (
                  <ForecastCard key={title} title={title} forecast={fc} />
                ))}
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <CompactTable title="Top referral destinations" rows={executiveTables.topReferralDestinations || []} columns={[{ key: 'destination', label: 'Destination' }, { key: 'destination_type', label: 'Type' }, { key: 'count', label: 'Referrals' }]} empty="Referral destination intelligence populates when provider and facility referrals are recorded." accentIndex={2} />
                <CompactTable title="Provider workload" rows={executiveTables.topProviders || []} columns={[{ key: 'provider_name', label: 'Provider' }, { key: 'consultations', label: 'Consults' }, { key: 'teleconsultations', label: 'Teleconsults' }, { key: 'referrals', label: 'Referrals' }]} empty="Provider workload visibility appears after consultation records are linked to providers." accentIndex={0} />
                <CompactTable title="Complaint and service demand patterns" rows={executiveTables.complaintCategories || []} columns={[{ key: 'category', label: 'Category' }, { key: 'count', label: 'Count' }]} empty="Complaint patterns require captured reason-for-visit or service tags." accentIndex={3} />
                <CompactTable title="Medicine demand categories" rows={executiveTables.medicineCategories || []} columns={[{ key: 'category', label: 'Medication class' }, { key: 'count', label: 'Demand signal' }]} empty="Medicine demand categories populate from prescription records." accentIndex={4} />
                <CompactTable title="Facility type breakdown" rows={executiveTables.facilityTypeBreakdown || []} columns={[{ key: 'facility_type', label: 'Facility type' }, { key: 'count', label: 'Facilities' }]} empty="Facility type breakdown requires configured public-health facilities." accentIndex={5} />
                <Card className="overflow-hidden border-violet-100 bg-white shadow-xl shadow-violet-100/40">
                  <CardHeader className="bg-gradient-to-r from-violet-50 via-white to-blue-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Sparkles className="h-4 w-4 text-violet-600" /> Leadership actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    {(executive?.leadershipActions || []).length ? executive.leadershipActions.map((action) => (
                      <div key={action.title} className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-violet-50/40 p-4 shadow-sm">
                        <p className="font-bold text-slate-950 text-sm">{action.title}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{action.message}</p>
                      </div>
                    )) : (
                      <EmptyState title="No leadership actions yet" body="Planning recommendations appear when aggregate utilization signals justify review." icon={Sparkles} />
                    )}
                  </CardContent>
                </Card>
              </section>

              {/* financial */}
              <Card className="overflow-hidden border-emerald-100 bg-white shadow-xl shadow-emerald-100/40">
                <CardHeader className="bg-gradient-to-r from-emerald-50 via-white to-teal-50 border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><FileText className="h-4 w-4 text-emerald-600" /> Financial and contract justification</CardTitle>
                  <CardDescription className="text-xs">Supports pilot value summaries only when payment or service-value configuration exists.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {executive?.financial?.emptyState ? (
                    <EmptyState title="Financial reporting is not configured" body={executive.financial.emptyState} icon={FileText} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {(executive?.financial?.items || []).map((item, i) => {
                        const g = CARD_GRADIENTS[i % CARD_GRADIENTS.length];
                        return (
                          <div key={item.label} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${g.bg} p-4 shadow-md ${g.shadow}`}>
                            <div className="pointer-events-none absolute -right-4 -top-4 h-14 w-14 rounded-full bg-white/15" />
                            <p className="relative text-xs font-semibold text-white/75 uppercase tracking-wide">{item.label}</p>
                            <p className="relative mt-2 text-xl font-black text-white">{formatExecutiveValue(item)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ══ OVERVIEW TAB ════════════════════════════════════ */}
            <TabsContent value="overview" className="space-y-6">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(overview?.metricCards || []).slice(0, 12).map((metric, i) => (
                  <MetricCard key={metric.key} label={metric.label} value={metric.value} icon={metricIcons[metric.key] || Activity} accentIndex={i} />
                ))}
              </section>
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <Card className="overflow-hidden border-emerald-100 bg-white shadow-xl shadow-emerald-100/40">
                  <CardHeader className="bg-gradient-to-r from-emerald-50 via-white to-cyan-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><ShieldCheck className="h-4 w-4 text-emerald-600" /> FCTA Programme Participation Readiness</CardTitle>
                    <CardDescription className="text-xs">Configured for serious stakeholder review while official DHIS2/NHMIS inputs remain pending.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill status={readiness.status} />
                      <StatusPill status={readiness.syncStatus} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(readiness.checklist || []).slice(0, 8).map((item) => (
                        <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-bold text-slate-950 text-sm">{item.label}</p>
                            <StatusPill status={item.status} />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-blue-100 bg-white shadow-xl shadow-blue-100/40">
                  <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-violet-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Globe2 className="h-4 w-4 text-blue-600" /> Market Baseline Coverage</CardTitle>
                    <CardDescription className="text-xs">DoctaRx matches Nigerian telemedicine basics and adds public-health intelligence.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5 pt-4">
                    {competitiveCoverageGroups.flatMap((g) => g.items.map(([label, status]) => ({ label, status }))).slice(0, 12).map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs shadow-sm hover:bg-blue-50/30 transition-colors">
                        <span className="font-medium text-slate-800">{item.label}</span>
                        <StatusPill status={item.status} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ══ PROGRAMME AREAS ═════════════════════════════════ */}
            <TabsContent value="areas" className="grid gap-4 lg:grid-cols-2">
              {areas.map((area, i) => <ProgrammeAreaCard key={area.key} area={area} idx={i} />)}
              {!areas.length && <div className="lg:col-span-2"><EmptyState title="No programme areas configured" body="Programme areas will populate from the API when areas data is available." icon={Layers3} /></div>}
            </TabsContent>

            {/* ══ PATIENT ACCESS ══════════════════════════════════ */}
            <TabsContent value="patient-access" className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Active patients" value={metrics.active_patients} icon={Users} accentIndex={0} />
                <MetricCard label="New registrations" value={metrics.new_patient_registrations} icon={Users} accentIndex={1} />
                <MetricCard label="Appointment bookings" value={metrics.appointment_bookings} icon={ClipboardList} accentIndex={2} />
                <MetricCard label="Patient access requests" value={metrics.patient_access_requests} icon={HeartPulse} accentIndex={3} />
              </section>
              <Card className="overflow-hidden border-blue-100 bg-white shadow-xl shadow-blue-100/40">
                <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-cyan-50 border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Users className="h-4 w-4 text-blue-600" /> Patient access model</CardTitle>
                  <CardDescription className="text-xs">Mobile-first public pages, QR-code-ready URLs, low-bandwidth access, reminders, and patient portal activity.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
                  {['Patient registration', 'Facility discovery', 'Provider discovery', 'Teleconsultation booking', 'Follow-up booking', 'SMS/WhatsApp notification hooks', 'QR-ready public routes', 'Low-bandwidth-friendly access'].map((item, i) => {
                    const g = CARD_GRADIENTS[i % CARD_GRADIENTS.length];
                    return (
                      <div key={item} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${g.bg} p-4 shadow-sm ${g.shadow}`}>
                        <div className="pointer-events-none absolute -right-3 -top-3 h-12 w-12 rounded-full bg-white/15" />
                        <p className="relative text-sm font-bold text-white">{item}</p>
                        <span className="relative mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white/70"><CheckCircle2 className="h-3 w-3" /> Ready</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ══ TELECONSULTATION ════════════════════════════════ */}
            <TabsContent value="teleconsultation" className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Teleconsultations" value={metrics.teleconsultations} icon={Video} accentIndex={0} />
                <MetricCard label="Completed consultations" value={metrics.completed_consultations} icon={CheckCircle2} accentIndex={1} />
                <MetricCard label="Audio fallback sessions" value={metrics.audio_fallback_sessions} icon={Activity} accentIndex={2} />
                <MetricCard label="Failed video sessions" value={metrics.failed_video_sessions} icon={Video} accentIndex={4} />
              </section>
              <ChartCard title="Teleconsultations over time" description="Counts are pulled from real appointment records where available." data={charts.consultations || []} accentIndex={0} />
            </TabsContent>

            {/* ══ REFERRALS ═══════════════════════════════════════ */}
            <TabsContent value="referrals" className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Referrals created" value={metrics.referrals_created} icon={UploadCloud} accentIndex={2} />
                <MetricCard label="Completed referrals" value={metrics.referrals_completed} icon={CheckCircle2} accentIndex={1} />
                <MetricCard label="Pending referrals" value={metrics.pending_referrals} icon={ClipboardList} accentIndex={3} />
                <MetricCard label="Lab referrals" value={metrics.lab_referrals} icon={FlaskConical} accentIndex={5} />
              </section>
              <ChartCard title="Referrals over time" description="PHC, hospital, specialist, pharmacy, and lab referrals populate this trend when captured." data={charts.referrals || []} type="bar" accentIndex={2} />
            </TabsContent>

            {/* ══ PHARMACY & LAB ══════════════════════════════════ */}
            <TabsContent value="pharmacy-lab" className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Prescriptions created" value={metrics.prescriptions_created} icon={Pill} accentIndex={3} />
                <MetricCard label="Pharmacy referrals" value={metrics.pharmacy_referrals} icon={Pill} accentIndex={1} />
                <MetricCard label="Lab referrals" value={metrics.lab_referrals} icon={FlaskConical} accentIndex={5} />
                <MetricCard label="Follow-up appointments" value={metrics.followup_appointments} icon={ClipboardList} accentIndex={2} />
              </section>
              <ChartCard title="Prescription demand trend" description="Uses prescription records only. No pharmacy stock or live lab integration claimed." data={charts.prescriptions || []} accentIndex={3} />
            </TabsContent>

            {/* ══ FACILITIES ══════════════════════════════════════ */}
            <TabsContent value="facilities" className="space-y-5">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Active facilities" value={metrics.active_facilities} icon={Building2} accentIndex={5} />
                <MetricCard label="Active providers" value={metrics.active_providers} icon={Stethoscope} accentIndex={1} />
                <MetricCard label="Total consultations" value={metrics.total_consultations} icon={Activity} accentIndex={0} />
                <MetricCard label="Provider workload signal" value={Number(metrics.teleconsultations || 0) + Number(metrics.appointment_bookings || 0)} icon={TrendingUp} accentIndex={2} />
              </section>
              <EmptyState title="Facility utilization details depend on mapped facilities" body="Add PHC, public hospital, and organisation-unit mappings as FCTA/FMOH identifiers become available. DoctaRx shows operational aggregate counts without fake government IDs." icon={Building2} />
            </TabsContent>

            {/* ══ ANALYTICS ═══════════════════════════════════════ */}
            <TabsContent value="analytics" className="space-y-6">
              <SectionBanner eyebrow="Analytics grid" title="Full public-health visibility coverage" body="Required public-health charts are represented here. Where the current data model lacks mapped fields, DoctaRx shows an empty state and the data requirement instead of mock values." icon={BarChart3} accentIndex={2} />
              {comprehensiveChartSections.map((section) => (
                <section key={section.title} className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-950">
                    <span className={`rounded-lg ${LIGHT_ACCENTS[section.accentIndex].icon} p-1.5`}><BarChart3 className="h-4 w-4" /></span>
                    {section.title}
                  </h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {section.charts.map(([title, description, data], i) => (
                      <ChartCard key={`${section.title}-${title}`} title={title} description={description} data={data || []} type={title.toLowerCase().includes(' by ') || title.toLowerCase().includes('breakdown') ? 'bar' : 'line'} accentIndex={(section.accentIndex + i) % LIGHT_ACCENTS.length} />
                    ))}
                  </div>
                </section>
              ))}
            </TabsContent>

            {/* ══ FORECASTING ═════════════════════════════════════ */}
            <TabsContent value="forecasting" className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-purple-500 to-indigo-600 p-6 shadow-2xl shadow-violet-500/30 text-white">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-xl" />
                  <div className="pointer-events-none absolute bottom-0 left-0 h-28 w-28 rounded-full bg-white/8 blur-2xl" />
                  <p className="relative flex items-center gap-2 text-sm font-bold text-white/80"><LineChartIcon className="h-4 w-4" /> Explainable forecast</p>
                  <p className="relative mt-2 text-xs text-white/60">No disease outbreak prediction, no diagnosis, no randomized numbers.</p>
                  <p className="relative mt-5 text-xs font-semibold uppercase tracking-widest text-violet-200">7-day expected consultations</p>
                  <p className="relative mt-2 text-6xl font-black tracking-tight text-white">{number(forecast?.predictedValue)}</p>
                  <div className="relative mt-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      {String(forecast?.confidenceLabel || 'insufficient data').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="relative mt-4 text-sm leading-6 text-violet-100">{forecast?.explanation || 'Forecasting requires more historical activity to generate reliable projections.'}</p>
                </div>
                <ChartCard title="Historical activity used for forecast" description="The forecast is based only on available aggregate operational activity." data={forecast?.historicalPoints || []} accentIndex={2} />
              </div>
            </TabsContent>

            {/* ══ REPORTS ═════════════════════════════════════════ */}
            <TabsContent value="reports" className="space-y-5">
              <SectionBanner eyebrow="Reports and exports" title="Monthly aggregate reports" body="Generate reports from real aggregate data. Exports contain no patient identifiers and remain DHIS2/NHMIS dry-run until official credentials, mappings, and approvals are configured." icon={FileText} accentIndex={5}>
                <Button onClick={generateReport} disabled={working} className="h-10 rounded-xl bg-white font-bold text-cyan-800 hover:bg-white/90 shadow-sm">
                  {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Generate {period} report
                </Button>
              </SectionBanner>
              <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 p-4 text-sm leading-6 text-amber-900 shadow-sm">
                <p className="font-bold">AI narrative generation is disabled until a provider is explicitly configured.</p>
                <p className="mt-1 text-xs">The module uses deterministic executive summaries and planning signals from aggregate metrics only.</p>
              </div>
              <Card className="overflow-hidden border-slate-200 bg-white shadow-xl shadow-slate-100/60">
                <CardContent className="p-0">
                  {!reports.length ? (
                    <div className="p-6"><EmptyState title="No public-health report has been generated" body="Generate a monthly aggregate report when operational records are available. Empty reports are allowed but clearly show zero values." icon={FileText} /></div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-blue-50 text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-3 font-bold">Period</th>
                            <th className="px-4 py-3 font-bold">Type</th>
                            <th className="px-4 py-3 font-bold">Status</th>
                            <th className="px-4 py-3 font-bold">Generated by</th>
                            <th className="px-4 py-3 font-bold">Created</th>
                            <th className="px-4 py-3 font-bold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.map((report) => (
                            <tr key={report.id} className="border-t border-slate-100 transition-colors hover:bg-blue-50/30">
                              <td className="px-4 py-3 font-bold text-slate-950">{report.report_period}</td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{report.report_type}</td>
                              <td className="px-4 py-3"><StatusPill status={report.status} /></td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{report.generated_by_name || 'Admin'}</td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {report.status !== 'approved' && <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => approveReport(report.id)}>Approve</Button>}
                                  <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => exportCsv(report.id)}><Download className="mr-1 h-3 w-3" /> CSV</Button>
                                  <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => exportJson(report.id)}><FileJson className="mr-1 h-3 w-3" /> JSON</Button>
                                  <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => previewDhis2(report.id)}>DHIS2</Button>
                                  <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => dryRunDhis2(report.id)}>Dry run</Button>
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
                <Card className="overflow-hidden border-slate-200 bg-white shadow-xl shadow-slate-100/60">
                  <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-100">
                    <CardTitle className="text-base font-black text-slate-950">Latest export result</CardTitle>
                    <CardDescription className="text-xs">Aggregate JSON preview. No patient identifiers included.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify(selectedReport, null, 2)}</pre>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ══ DHIS2 ═══════════════════════════════════════════ */}
            <TabsContent value="dhis2" className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Card className="overflow-hidden border-emerald-100 bg-white shadow-xl shadow-emerald-100/40">
                  <CardHeader className="bg-gradient-to-r from-emerald-50 via-white to-cyan-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><ShieldCheck className="h-4 w-4 text-emerald-600" /> DHIS2/NHMIS readiness</CardTitle>
                    <CardDescription className="text-xs">Integration-ready readiness layer. Does not claim live government integration.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    {(readiness.checklist || []).map((item) => (
                      <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-slate-950 text-sm">{item.label}</p>
                          <StatusPill status={item.status} />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p>
                      </div>
                    ))}
                    {!readiness.checklist?.length && <EmptyState title="No readiness checklist" body="DHIS2 readiness checklist will appear once the system is configured." icon={Database} />}
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-blue-100 bg-white shadow-xl shadow-blue-100/40">
                  <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-violet-50 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Lock className="h-4 w-4 text-blue-600" /> Governance notes</CardTitle>
                    <CardDescription className="text-xs">Displayed to prevent overclaiming.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    {(readiness.governanceNotes || []).map((note) => (
                      <div key={note} className="flex gap-3 rounded-xl border border-slate-200 bg-gradient-to-br from-white to-blue-50/30 p-3 text-xs leading-5 text-slate-700 shadow-sm">
                        <Lock className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                        <span>{note}</span>
                      </div>
                    ))}
                    {preview && <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100">{JSON.stringify(preview, null, 2)}</pre>}
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
                  { key: 'active', label: 'Status', render: (row) => <StatusPill status={row.active === false ? 'missing' : 'ready'} /> },
                ]}
                empty="No public-health indicators configured. Run the migration and configure indicators before DHIS2 preview exports."
                accentIndex={1}
              />
            </TabsContent>

            {/* ══ COMPETITIVE COVERAGE ════════════════════════════ */}
            <TabsContent value="competitive" className="space-y-5">
              <SectionBanner eyebrow="Market baseline coverage" title="Competitive coverage and public-sector differentiation" body="DoctaRx covers the Nigerian telemedicine baseline and exceeds it with public-health intelligence, NHMIS/DHIS2-ready aggregate reporting, executive visibility, explainable forecasting, dry-run exports, and governance controls." icon={Globe2} accentIndex={1} />
              <div className="grid gap-4 lg:grid-cols-2">
                {competitiveCoverageGroups.map((group) => (
                  <CompetitiveCoverageGroup key={group.title} group={group} />
                ))}
              </div>
            </TabsContent>

            {/* ══ SETTINGS ════════════════════════════════════════ */}
            <TabsContent value="settings" className="space-y-5">
              <Card className="overflow-hidden border-violet-100 bg-white shadow-xl shadow-violet-100/40">
                <CardHeader className="bg-gradient-to-r from-violet-50 via-white to-cyan-50 border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><Settings className="h-4 w-4 text-violet-600" /> DHIS2 configuration readiness</CardTitle>
                  <CardDescription className="text-xs">Store official IDs and approval status when received. API token fields are write-only and never displayed.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Environment</Label>
                    <select value={settingsForm.environment} onChange={(e) => setSettingsForm({ ...settingsForm, environment: e.target.value })} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                      <option value="disabled">Disabled</option>
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Dataset ID</Label>
                    <Input value={settingsForm.datasetId || ''} onChange={(e) => setSettingsForm({ ...settingsForm, datasetId: e.target.value })} placeholder="Official DHIS2 dataset ID pending" className="h-10 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Organisation-unit ID</Label>
                    <Input value={settingsForm.orgUnitId || ''} onChange={(e) => setSettingsForm({ ...settingsForm, orgUnitId: e.target.value })} placeholder="Official org-unit ID pending" className="h-10 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Attribute option combo ID</Label>
                    <Input value={settingsForm.attributeOptionComboId || ''} onChange={(e) => setSettingsForm({ ...settingsForm, attributeOptionComboId: e.target.value })} placeholder="Optional official value" className="h-10 rounded-xl" />
                  </div>
                  {['governmentApprovalStatus', 'apiCredentialsStatus', 'dataSharingAgreementStatus', 'ndprReviewStatus'].map((key) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</Label>
                      <select value={settingsForm[key] || 'pending'} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                        <option value="pending">Pending</option>
                        <option value={key === 'apiCredentialsStatus' ? 'configured' : 'approved'}>{key === 'apiCredentialsStatus' ? 'Configured' : 'Approved'}</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 p-4 shadow-sm md:col-span-2">
                    <p className="font-bold text-amber-900 text-sm">Live sync safety</p>
                    <p className="mt-1.5 text-xs leading-5 text-amber-700">Keep dry-run enabled until official credentials, approval, mappings, data-sharing agreement, and server safety flag are configured.</p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2 text-slate-800"><input type="checkbox" checked={settingsForm.enabled === true} onChange={(e) => setSettingsForm({ ...settingsForm, enabled: e.target.checked })} className="rounded" /> Integration enabled</label>
                      <label className="flex items-center gap-2 text-slate-800"><input type="checkbox" checked={settingsForm.dryRunOnly !== false} onChange={(e) => setSettingsForm({ ...settingsForm, dryRunOnly: e.target.checked })} className="rounded" /> Dry-run only</label>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <Button onClick={saveSettings} disabled={working} className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 font-bold text-white shadow-md shadow-violet-200 hover:from-violet-700 hover:to-indigo-700">
                      {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save settings
                    </Button>
                    <Button onClick={testConnection} variant="outline" disabled={working} className="rounded-xl font-bold">Readiness check</Button>
                  </div>
                </CardContent>
              </Card>
              {dhis2Settings && (
                <Card className="overflow-hidden border-slate-200 bg-white shadow-xl shadow-slate-100/60">
                  <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-100">
                    <CardTitle className="text-base font-black text-slate-950">Current DHIS2 readiness status</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['Base URL', dhis2Settings.hasBaseUrl ? 'configured' : 'pending'],
                      ['Username', dhis2Settings.hasUsername ? 'configured' : 'pending'],
                      ['API token', dhis2Settings.hasApiToken ? 'configured' : 'pending'],
                      ['Mode', dhis2Settings.dryRunOnly ? 'dry_run_only' : 'active'],
                    ].map(([label, status]) => (
                      <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                        <div className="mt-2 flex justify-center"><StatusPill status={status} /></div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ══ AUDIT LOGS ══════════════════════════════════════ */}
            <TabsContent value="audit" className="space-y-5">
              <Card className="overflow-hidden border-slate-200 bg-white shadow-xl shadow-slate-100/60">
                <CardHeader className="bg-gradient-to-r from-slate-50 via-white to-emerald-50 border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-base font-black text-slate-950"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Public-health audit logs</CardTitle>
                  <CardDescription className="text-xs">Report generation, approvals, exports, dry-run previews, and settings updates are logged.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {!auditLogs.length ? (
                    <EmptyState title="No public-health audit logs yet" body="Audit logs will appear after reports, exports, approvals, dry-runs, and settings updates." icon={ShieldCheck} />
                  ) : (
                    <div className="space-y-2">
                      {auditLogs.map((log) => (
                        <div key={log.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white p-4 text-sm shadow-sm hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex-none rounded-lg bg-gradient-to-br from-blue-100 to-violet-100 p-1.5 text-blue-600">
                              <Activity className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="font-bold text-slate-950">{log.action}</p>
                              <p className="text-xs text-slate-500 mt-0.5">Actor: {log.actor_name || log.actor_email || 'System/Admin'}</p>
                            </div>
                          </div>
                          <span className="flex-none text-xs text-slate-400">{log.created_at ? new Date(log.created_at).toLocaleString() : 'N/A'}</span>
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
