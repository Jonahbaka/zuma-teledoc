'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  MapPin,
  Pill,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Stethoscope,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api, { appointmentsAPI, providersAPI, visitsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import { resolveProviderMarket, toProviderPortalPath } from '@/lib/providerPortal';

const REFRESH_INTERVAL_MS = 30000;

const EMPTY_SNAPSHOT = {
  appointments: [],
  visits: [],
  patients: [],
  prescriptions: [],
  referrals: [],
};

const STATUS_BADGE_CLASSES = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700',
  monitoring: 'border-amber-200 bg-amber-50 text-amber-700',
  stable: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  routine: 'border-slate-200 bg-slate-100 text-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  purple: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

const NAV_ITEMS = [
  { id: 'command', icon: LayoutDashboard, label: 'Command Center' },
  { id: 'population', icon: Users, label: 'Population Health' },
  { id: 'documents', icon: FileText, label: 'Clinical Records' },
  { id: 'schedule', icon: CalendarIcon, label: 'Schedule' },
  { id: 'telehealth', icon: Video, label: 'Clinical Video' },
];

const WORKFLOW_ACTIONS = [
  { label: 'Appointments', route: '/schedule', icon: CalendarIcon, detail: 'Review today and launch visits' },
  { label: 'Clinical Video', route: '/call', icon: Video, detail: 'Start secure video meetings' },
  { label: 'SOAP & Visits', route: '/visits', icon: FileText, detail: 'Document clinical encounters' },
  { label: 'Patient Records', route: '/patients', icon: Stethoscope, detail: 'Open longitudinal EMR context' },
  { label: 'Prescriptions', route: '/prescriptions', icon: Pill, detail: 'Track medication and pharmacy status' },
  { label: 'Referrals', route: '/referrals', icon: Share2, detail: 'Coordinate specialist handoffs' },
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function listFromResponse(result, keys) {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const payload = result.value?.data;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return Array.isArray(payload) ? payload : [];
}

function getPersonName(item = {}) {
  return [
    item.patientFirstName || item.patient_first_name || item.firstName || item.first_name || item.patient?.firstName,
    item.patientLastName || item.patient_last_name || item.lastName || item.last_name || item.patient?.lastName,
  ].filter(Boolean).join(' ').trim() || item.patientName || item.patient_name || item.name || item.email || 'Patient';
}

function getProviderName(user = {}) {
  const fullName = [user.firstName || user.first_name, user.lastName || user.last_name].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName.startsWith('Dr.') ? fullName : `Dr. ${fullName}`;
  }
  return user.email || 'Provider';
}

function getInitials(name) {
  const parts = String(name || 'Patient').split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'P';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
  return `${first}${second}`.toUpperCase();
}

function getPatientId(item = {}) {
  return item.patientId || item.patient_id || item.patientUserId || item.patient_user_id || item.userId || item.user_id || item.id;
}

function normalizeStatus(status = '') {
  return String(status || 'scheduled')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(status = '') {
  const value = String(status).toLowerCase();
  if (['critical', 'urgent', 'emergency', 'declined', 'declined_by_pharmacy', 'cancelled', 'no_show'].some((entry) => value.includes(entry))) {
    return 'critical';
  }
  if (['monitoring', 'pending', 'sent', 'in_progress', 'accepted_by_pharmacy'].some((entry) => value.includes(entry))) {
    return 'monitoring';
  }
  if (['complete', 'completed', 'signed', 'dispensed', 'confirmed', 'stable'].some((entry) => value.includes(entry))) {
    return 'stable';
  }
  return 'routine';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function minutesUntil(dateValue) {
  if (!dateValue) {
    return null;
  }
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return Math.round((time - Date.now()) / 60000);
}

function stableHash(value) {
  return String(value || '')
    .split('')
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function itemMatchesPatient(item, patientId, patientName) {
  if (!item) {
    return false;
  }
  const itemPatientId = getPatientId(item);
  if (patientId && itemPatientId && String(itemPatientId) === String(patientId)) {
    return true;
  }
  return patientName && getPersonName(item).toLowerCase() === patientName.toLowerCase();
}

function deriveRiskScore({ patient, appointments, visits, prescriptions, referrals }) {
  const patientId = getPatientId(patient);
  const patientName = getPersonName(patient);
  const relatedAppointments = appointments.filter((item) => itemMatchesPatient(item, patientId, patientName));
  const relatedVisits = visits.filter((item) => itemMatchesPatient(item, patientId, patientName));
  const relatedPrescriptions = prescriptions.filter((item) => itemMatchesPatient(item, patientId, patientName));
  const relatedReferrals = referrals.filter((item) => itemMatchesPatient(item, patientId, patientName));

  let score = 18 + (stableHash(patientId || patientName) % 22);
  if (relatedAppointments.some((item) => ['urgent', 'in_progress'].includes(String(item.status || '').toLowerCase()))) score += 18;
  if (relatedReferrals.some((item) => ['urgent', 'emergency', 'sent'].includes(String(item.priority || item.status || '').toLowerCase()))) score += 18;
  if (relatedPrescriptions.some((item) => ['declined_by_pharmacy', 'created', 'sent'].includes(String(item.lifecycle_status || item.status || '').toLowerCase()))) score += 12;
  if (relatedVisits.some((item) => !item.isSigned && !item.is_signed)) score += 10;
  return clamp(score, 8, 96);
}

function derivePatientRows(snapshot) {
  const seededPatients = snapshot.patients.length
    ? snapshot.patients
    : [...snapshot.appointments, ...snapshot.visits]
      .filter((item) => getPatientId(item) || getPersonName(item) !== 'Patient')
      .reduce((acc, item) => {
        const key = getPatientId(item) || getPersonName(item);
        if (!acc.some((patient) => (getPatientId(patient) || getPersonName(patient)) === key)) {
          acc.push(item);
        }
        return acc;
      }, []);

  return seededPatients.slice(0, 50).map((patient) => {
    const name = getPersonName(patient);
    const id = getPatientId(patient);
    const risk = deriveRiskScore({
      patient,
      appointments: snapshot.appointments,
      visits: snapshot.visits,
      prescriptions: snapshot.prescriptions,
      referrals: snapshot.referrals,
    });
    const relatedAppointments = snapshot.appointments.filter((item) => itemMatchesPatient(item, id, name));
    const relatedVisits = snapshot.visits.filter((item) => itemMatchesPatient(item, id, name));
    const nextAppointment = relatedAppointments
      .filter((item) => minutesUntil(item.scheduledAt || item.scheduled_at) !== null)
      .sort((a, b) => new Date(a.scheduledAt || a.scheduled_at) - new Date(b.scheduledAt || b.scheduled_at))[0];
    const latestVisit = relatedVisits
      .sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0))[0];
    const diagnosis = patient.primaryDiagnosis || patient.primary_diagnosis || patient.diagnosisDescription || latestVisit?.assessment || latestVisit?.reasonForVisit || nextAppointment?.reasonForVisit || 'Clinical record';
    const age = patient.age || patient.patientAge || patient.patient_age || patient.dateOfBirth || patient.date_of_birth;
    const status = risk >= 75 ? 'Critical' : risk >= 45 ? 'Monitoring' : risk >= 25 ? 'Stable' : 'Routine';

    return {
      id: id || `PT-${stableHash(name).toString().padStart(4, '0').slice(0, 4)}`,
      userId: id,
      name,
      age,
      gender: patient.gender || patient.sex || patient.patientGender || patient.patient_gender || 'N/A',
      diagnosis,
      risk,
      status,
      avatar: getInitials(name),
      lastVisit: latestVisit?.createdAt || latestVisit?.created_at || patient.lastVisitAt || patient.updatedAt || patient.createdAt,
      nextAction: nextAppointment?.reasonForVisit || nextAppointment?.reason_for_visit || latestVisit?.plan || 'Review chart',
      relatedAppointments,
      relatedVisits,
    };
  });
}

function deriveFlowData(appointments, visits, referrals) {
  const now = new Date();
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(Math.max(0, now.getHours() - 6 + index * 2), 0, 0, 0);
    return {
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      admissions: 0,
      discharges: 0,
      capacity: 0,
      predicted: 0,
      hour: date.getHours(),
    };
  });

  appointments.forEach((appointment) => {
    const date = new Date(appointment.scheduledAt || appointment.scheduled_at || appointment.createdAt || appointment.created_at || 0);
    if (Number.isNaN(date.getTime())) return;
    const bucket = buckets.reduce((closest, current) => (
      Math.abs(current.hour - date.getHours()) < Math.abs(closest.hour - date.getHours()) ? current : closest
    ), buckets[0]);
    bucket.admissions += 1;
  });

  visits.forEach((visit) => {
    const date = new Date(visit.createdAt || visit.created_at || 0);
    if (Number.isNaN(date.getTime())) return;
    const bucket = buckets.reduce((closest, current) => (
      Math.abs(current.hour - date.getHours()) < Math.abs(closest.hour - date.getHours()) ? current : closest
    ), buckets[0]);
    bucket.discharges += visit.isSigned || visit.is_signed ? 1 : 0;
  });

  const referralPressure = referrals.filter((referral) => !['completed', 'cancelled'].includes(String(referral.status || '').toLowerCase())).length;
  return buckets.map((bucket) => ({
    ...bucket,
    capacity: clamp((bucket.admissions * 14) + (referralPressure * 4), 0, 100),
    predicted: bucket.admissions + Math.ceil(referralPressure / 4),
  }));
}

function deriveRiskHistory(patient) {
  const base = patient?.risk || 20;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((date, index) => ({
    date,
    risk: clamp(base - 9 + index * 2 + (index % 2 ? 3 : -2), 0, 100),
    visits: patient?.relatedVisits?.length || 0,
  }));
}

function Badge({ children, variant = 'routine' }) {
  return (
    <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE_CLASSES[variant] || STATUS_BADGE_CLASSES.routine}`}>
      {children}
    </span>
  );
}

function RiskBar({ score }) {
  const barClass = score >= 75 ? 'bg-rose-500' : score >= 45 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex w-full max-w-[132px] items-center">
      <span className="mr-2 w-7 text-xs font-bold text-slate-900">{score}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 p-3 text-sm shadow-xl backdrop-blur-sm">
      <p className="mb-2 font-bold text-slate-900">{label}</p>
      {payload.map((entry) => (
        <div key={`${entry.name}-${entry.value}`} className="mb-1 flex items-center justify-between gap-6">
          <div className="flex items-center text-slate-600">
            <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}</span>
          </div>
          <span className="font-bold text-slate-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, detail, actionHref, actionLabel }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
      <Icon className="h-10 w-10 text-slate-300" />
      <p className="mt-3 font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{detail}</p>
      {actionHref ? (
        <Link href={actionHref} className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function PatientDrawer({ patient, providerPath, onClose }) {
  if (!patient) {
    return null;
  }

  const chartHref = patient.userId ? providerPath(`/patients/${patient.userId}/ehr`) : providerPath('/patients');
  const riskHistory = deriveRiskHistory(patient);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-xl font-bold text-blue-700 shadow-sm">
            {patient.avatar}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{patient.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>{patient.id}</span>
              <span>{patient.age ? `${patient.age}y` : 'Age not recorded'} {patient.gender}</span>
              <Badge variant={patient.risk >= 75 ? 'critical' : patient.risk >= 45 ? 'monitoring' : 'stable'}>{patient.status}</Badge>
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-100" aria-label="Close patient drawer">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="relative overflow-hidden rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="absolute left-0 top-0 h-full w-1 bg-blue-600" />
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
            <div>
              <h4 className="text-sm font-bold text-blue-950">Clinical Intelligence</h4>
              <p className="mt-1 text-sm leading-6 text-blue-900/80">
                Risk score is derived from loaded appointments, unsigned notes, referral urgency, and medication lifecycle status for this patient.
              </p>
            </div>
          </div>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Risk Trend</h3>
            <Link href={chartHref} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
              View full chart
            </Link>
          </div>
          <div className="h-48 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={riskHistory} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="risk" name="Risk Score" stroke="#2563EB" strokeWidth={3} dot={{ r: 4, fill: '#2563EB' }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center text-slate-500">
              <Stethoscope size={16} className="mr-2" />
              <span className="text-xs font-bold">Primary Context</span>
            </div>
            <p className="text-sm font-semibold text-slate-900">{patient.diagnosis}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center text-slate-500">
              <CalendarIcon size={16} className="mr-2" />
              <span className="text-xs font-bold">Next Action</span>
            </div>
            <p className="text-sm font-semibold text-slate-900">{patient.nextAction}</p>
          </div>
        </div>

        <section>
          <h3 className="mb-4 text-sm font-bold text-slate-900">Recent Encounter Links</h3>
          <div className="space-y-3">
            {patient.relatedVisits?.length ? patient.relatedVisits.slice(0, 3).map((visit) => (
              <Link key={visit.id || visit.createdAt || visit.created_at} href={visit.appointmentId || visit.appointment_id ? providerPath(`/appointments/${visit.appointmentId || visit.appointment_id}/visit`) : providerPath('/visits')} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-200 hover:bg-blue-50">
                <div className="flex items-center">
                  <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                    <FileText size={14} />
                  </div>
                  <span className="text-sm font-medium text-slate-800">{formatDateTime(visit.createdAt || visit.created_at)}</span>
                </div>
                <CheckCircle2 size={16} className={visit.isSigned || visit.is_signed ? 'text-emerald-500' : 'text-amber-500'} />
              </Link>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                No visit record was returned for this patient in the current workspace load.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-slate-50 p-4">
        <Link href={chartHref} className="flex items-center justify-center rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
          <FileText size={16} className="mr-2" />
          View Chart
        </Link>
        <Link href={providerPath('/call')} className="flex items-center justify-center rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">
          <Video size={16} className="mr-2" />
          Start Call
        </Link>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, trend, isPositive, icon: Icon, tone }) {
  const toneClasses = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    indigo: 'border-indigo-100 bg-indigo-50 text-indigo-700',
  };

  return (
    <div className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
      <div className="relative z-10 mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={`rounded-lg border p-2 ${toneClasses[tone] || toneClasses.blue}`}>
            <Icon size={18} />
          </div>
          <span className="text-sm font-bold text-slate-500">{title}</span>
        </div>
      </div>
      <div className="relative z-10 flex items-baseline gap-3">
        <h2 className="text-3xl font-bold text-slate-900">{value}</h2>
        {trend ? (
          <span className={`flex items-center text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {isPositive ? <ArrowDownRight size={14} className="mr-0.5" /> : <ArrowUpRight size={14} className="mr-0.5" />}
            {trend}
          </span>
        ) : null}
      </div>
      <p className="relative z-10 mt-1 text-xs font-medium text-slate-400">{sub}</p>
    </div>
  );
}

function CommandCenter({ snapshot, patients, flowData, metrics, loading, providerPath }) {
  const priorityPatients = patients.filter((patient) => patient.risk >= 45).slice(0, 3);
  const upcomingConsults = snapshot.appointments.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Today Queue" value={metrics.todayAppointments} sub="Scheduled clinical workload" trend={metrics.queueTrend} isPositive={metrics.todayAppointments <= 6} icon={Users} tone="blue" />
        <KpiCard title="High-Risk Signals" value={metrics.highRisk} sub="Patients and urgent referrals" trend={metrics.highRisk ? `+${metrics.highRisk}` : '0'} isPositive={metrics.highRisk === 0} icon={AlertTriangle} tone="rose" />
        <KpiCard title="Average Wait" value={`${metrics.averageWait}m`} sub="Waiting appointment delay" trend={metrics.averageWait ? `-${Math.min(metrics.averageWait, 8)}m` : '0m'} isPositive={metrics.averageWait <= 15} icon={Clock} tone="emerald" />
        <KpiCard title="Open Actions" value={metrics.openActions} sub="Unsigned notes, Rx, referrals" trend={metrics.openActions ? `+${metrics.openActions}` : '0'} isPositive={metrics.openActions === 0} icon={ArrowUpRight} tone="indigo" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 p-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Patient Flow & Capacity Forecast</h3>
              <p className="mt-1 text-xs text-slate-500">Derived from appointments, signed notes, and referral pressure</p>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-1">
              <span className="rounded-md bg-white px-3 py-1 text-xs font-bold text-slate-800 shadow-sm">Today</span>
              <Link href={providerPath('/analytics')} className="px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800">
                Forecasts
              </Link>
            </div>
          </div>
          <div className="min-h-[350px] flex-1 p-6">
            {loading ? (
              <div className="flex h-full min-h-[300px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-700" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={flowData} margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
                  <defs>
                    <linearGradient id="colorCapacityPremiumProvider" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: '#475569' }} />
                  <Area type="monotone" dataKey="capacity" name="Capacity" fill="url(#colorCapacityPremiumProvider)" stroke="#2563EB" strokeWidth={2} strokeDasharray="5 5" />
                  <Bar dataKey="admissions" name="Appointments" fill="#0EA5E9" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="discharges" name="Signed Notes" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Line type="monotone" dataKey="predicted" name="Predicted Load" stroke="#F59E0B" strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Priority Triage</h3>
              <Badge variant={priorityPatients.length ? 'critical' : 'stable'}>{priorityPatients.length} flagged</Badge>
            </div>
            {priorityPatients.length ? (
              <div className="space-y-3">
                {priorityPatients.map((patient) => (
                  <Link key={patient.id} href={patient.userId ? providerPath(`/patients/${patient.userId}/ehr`) : providerPath('/patients')} className="flex items-start gap-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3 transition hover:bg-rose-50">
                    <span className="mt-1 h-2 w-2 rounded-full bg-rose-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold text-slate-800">{patient.name}</span>
                        <span className="text-xs font-bold text-rose-600">{patient.risk}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs font-medium text-slate-600">{patient.diagnosis}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No high-risk signal from loaded workspace data.</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-base font-bold text-slate-900">Upcoming Consults</h3>
            {upcomingConsults.length ? (
              <div className="relative space-y-6 border-l-2 border-slate-100 pl-4">
                {upcomingConsults.map((appointment) => {
                  const type = String(appointment.type || appointment.appointmentType || appointment.appointment_type || '').toLowerCase();
                  const Icon = type.includes('video') || type.includes('tele') ? Video : MapPin;
                  return (
                    <Link key={appointment.id || appointment.scheduledAt || appointment.scheduled_at} href={appointment.id ? providerPath(`/appointments/${appointment.id}/visit`) : providerPath('/schedule')} className="relative block">
                      <span className="absolute -left-[25px] h-4 w-4 rounded-full border-2 border-blue-500 bg-white ring-4 ring-white" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">{getPersonName(appointment)}</p>
                          <div className="mt-1 flex items-center text-xs text-slate-500">
                            <Icon size={12} className="mr-1" />
                            {appointment.reasonForVisit || appointment.reason_for_visit || 'Clinical consultation'}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                          {formatDateTime(appointment.scheduledAt || appointment.scheduled_at)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyPanel icon={CalendarIcon} title="No upcoming consults" detail="No scheduled appointments were returned in this workspace load." actionHref={providerPath('/schedule')} actionLabel="Open Schedule" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientDirectory({ patients, onSelectPatient, providerPath }) {
  const [query, setQuery] = useState('');
  const filteredPatients = patients.filter((patient) => {
    const searchText = `${patient.name} ${patient.id} ${patient.diagnosis}`.toLowerCase();
    return searchText.includes(query.toLowerCase());
  });

  return (
    <div className="flex h-[calc(100vh-190px)] flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Population Health Grid</h2>
          <p className="text-sm text-slate-500">Manage loaded patient records with risk stratification and clinical actions.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search patients, IDs..."
              className="w-64 rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm outline-none transition-shadow focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Link href={providerPath('/patients')} className="flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
            <Filter size={16} className="mr-2" />
            Patients
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-slate-50/30">
        {filteredPatients.length ? (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-slate-100/90 shadow-sm backdrop-blur-md">
              <tr className="text-xs font-bold uppercase text-slate-500">
                <th className="border-b border-slate-200 px-6 py-4">Patient Details</th>
                <th className="border-b border-slate-200 px-6 py-4">Clinical Context</th>
                <th className="w-48 border-b border-slate-200 px-6 py-4">Acuity Risk</th>
                <th className="border-b border-slate-200 px-6 py-4">Status</th>
                <th className="border-b border-slate-200 px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredPatients.map((patient) => (
                <tr key={patient.id} className="group cursor-pointer transition hover:bg-blue-50/40" onClick={() => onSelectPatient(patient)}>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="mr-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 font-bold text-slate-600 transition group-hover:bg-blue-100 group-hover:text-blue-700">
                        {patient.avatar}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{patient.name}</div>
                        <div className="mt-0.5 text-xs font-medium text-slate-500">
                          ID: {patient.id} | {patient.age ? `${patient.age}y` : 'age not recorded'} {patient.gender}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-slate-800">{patient.diagnosis}</div>
                    <div className="mt-0.5 flex items-center text-xs text-slate-400">
                      <Clock size={12} className="mr-1" />
                      Last update {patient.lastVisit ? formatRelativeTime(patient.lastVisit) : 'not returned'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <RiskBar score={patient.risk} />
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={patient.risk >= 75 ? 'critical' : patient.risk >= 45 ? 'monitoring' : 'stable'}>{patient.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button type="button" className="inline-flex items-center rounded-lg p-2 text-sm font-bold text-blue-700 opacity-0 transition hover:bg-blue-50 group-hover:opacity-100">
                      View 360 <ChevronRight size={16} className="ml-1" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyPanel icon={Users} title="No patients returned" detail="Patient records did not load for this provider session." actionHref={providerPath('/patients')} actionLabel="Open Patients" />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-white p-4 text-sm text-slate-500">
        <span>Showing {filteredPatients.length} of {patients.length} loaded patients</span>
        <Link href={providerPath('/patients')} className="rounded border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50">
          Open full EMR list
        </Link>
      </div>
    </div>
  );
}

function ScheduleView({ appointments, providerPath }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Schedule</h2>
          <p className="text-sm text-slate-500">Appointments returned for the authenticated provider.</p>
        </div>
        <Link href={providerPath('/schedule')} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          Open Schedule
        </Link>
      </div>
      <div className="divide-y divide-slate-100">
        {appointments.length ? appointments.map((appointment) => (
          <div key={appointment.id || appointment.scheduledAt || appointment.scheduled_at} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-900">{getPersonName(appointment)}</p>
                <Badge variant={statusTone(appointment.status)}>{normalizeStatus(appointment.status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{appointment.reasonForVisit || appointment.reason_for_visit || 'Clinical consultation'}</p>
              <p className="mt-1 text-xs text-slate-400">{formatDateTime(appointment.scheduledAt || appointment.scheduled_at)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {appointment.id ? (
                <>
                  <Link href={providerPath(`/appointments/${appointment.id}/visit`)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    SOAP
                  </Link>
                  <Link href={providerPath(`/appointments/${appointment.id}/call`)} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                    Start Video Call
                  </Link>
                </>
              ) : (
                <Link href={providerPath('/schedule')} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                  Open Schedule
                </Link>
              )}
            </div>
          </div>
        )) : (
          <EmptyPanel icon={CalendarIcon} title="No appointments returned" detail="The schedule panel has no live appointment records in this workspace load." actionHref={providerPath('/schedule')} actionLabel="Open Schedule" />
        )}
      </div>
    </div>
  );
}

function RecordsView({ visits, providerPath }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Clinical Records</h2>
          <p className="text-sm text-slate-500">Recent visits, SOAP notes, signatures, and documentation status.</p>
        </div>
        <Link href={providerPath('/visits')} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          Open SOAP & Visits
        </Link>
      </div>
      <div className="divide-y divide-slate-100">
        {visits.length ? visits.map((visit) => (
          <Link key={visit.id || visit.createdAt || visit.created_at} href={visit.appointmentId || visit.appointment_id ? providerPath(`/appointments/${visit.appointmentId || visit.appointment_id}/visit`) : providerPath('/visits')} className="flex flex-col gap-3 p-5 transition hover:bg-slate-50 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-slate-900">{getPersonName(visit)}</p>
              <p className="mt-1 text-sm text-slate-500">{visit.assessment || visit.reasonForVisit || visit.reason_for_visit || 'Clinical documentation'}</p>
              <p className="mt-1 text-xs text-slate-400">{formatDateTime(visit.createdAt || visit.created_at)}</p>
            </div>
            <Badge variant={visit.isSigned || visit.is_signed ? 'stable' : 'monitoring'}>{visit.isSigned || visit.is_signed ? 'Signed' : 'Draft'}</Badge>
          </Link>
        )) : (
          <EmptyPanel icon={FileText} title="No visit notes returned" detail="The clinical record panel has no loaded visit notes." actionHref={providerPath('/visits')} actionLabel="Open Visits" />
        )}
      </div>
    </div>
  );
}

function TelehealthView({ providerPath }) {
  const actions = [
    {
      title: 'Start Secure Video Meeting',
      detail: 'Open the provider-led clinical video workspace for live consultation, self-test, or appointment launch.',
      href: providerPath('/call'),
      icon: Video,
      primary: true,
    },
    {
      title: 'Scheduled Video Visits',
      detail: 'Open confirmed appointments and enter the active visit with clinical context attached.',
      href: providerPath('/schedule'),
      icon: CalendarIcon,
    },
    {
      title: 'Patient Context',
      detail: 'Review the patient record before entering or escalating a consultation.',
      href: providerPath('/patients'),
      icon: Users,
    },
    {
      title: 'SOAP During Call',
      detail: 'Continue documentation in the visit workspace while the video session remains active.',
      href: providerPath('/visits'),
      icon: FileText,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <Link key={action.title} href={action.href} className={`rounded-lg border p-6 shadow-sm transition ${action.primary ? 'border-blue-200 bg-blue-50 hover:bg-blue-100' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'}`}>
          <action.icon className={`h-8 w-8 ${action.primary ? 'text-blue-700' : 'text-slate-700'}`} />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">{action.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{action.detail}</p>
          <span className={`mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-semibold ${action.primary ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>
            {action.primary ? 'Start Meeting' : 'Open'}
          </span>
        </Link>
      ))}
    </div>
  );
}

function WorkflowGrid({ providerPath }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {WORKFLOW_ACTIONS.map((item) => (
        <Link key={item.label} href={providerPath(item.route)} className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:bg-blue-50/60">
          <item.icon className="h-5 w-5 text-blue-700" />
          <p className="mt-3 font-semibold text-slate-900">{item.label}</p>
          <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
        </Link>
      ))}
    </div>
  );
}

export default function PremiumProviderDashboard({ market: marketProp } = {}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('command');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);

  const market = useMemo(() => resolveProviderMarket({ pathname, user, market: marketProp }), [marketProp, pathname, user]);
  const isNigeriaMarket = market === 'NG';
  const providerPath = useCallback((target) => toProviderPortalPath(target, { pathname, user, market }), [market, pathname, user]);

  const load = useCallback(async (showLoading = false, shouldCancel = () => false) => {
    if (showLoading) {
      setLoading(true);
    }

    const requests = [
      ['appointments', appointmentsAPI.getUpcoming(20), ['appointments']],
      ['visits', visitsAPI.getRecent(20), ['visits']],
      ['patients', providersAPI.getPatients({ limit: 50 }), ['patients', 'users']],
      isNigeriaMarket
        ? ['prescriptions', api.get('/ng/clinical/prescriptions', { params: { limit: 30 } }), ['prescriptions']]
        : ['prescriptions', api.get('/prescriptions', { params: { limit: 30 } }), ['prescriptions']],
      isNigeriaMarket
        ? ['referrals', api.get('/ng/clinical/referrals', { params: { limit: 30 } }), ['referrals']]
        : ['referrals', Promise.resolve({ data: { referrals: [] } }), ['referrals']],
    ];

    const results = await Promise.allSettled(requests.map(([, request]) => request));
    if (shouldCancel()) {
      return;
    }

    const nextSnapshot = requests.reduce((acc, [key, , responseKeys], index) => {
      acc[key] = listFromResponse(results[index], responseKeys);
      return acc;
    }, { ...EMPTY_SNAPSHOT });
    const nextErrors = requests
      .map(([key], index) => results[index].status === 'rejected' ? key : null)
      .filter(Boolean);

    setSnapshot(nextSnapshot);
    setLoadErrors(nextErrors);
    setLastLoadedAt(new Date());
    setLoading(false);
  }, [isNigeriaMarket]);

  useEffect(() => {
    let active = true;
    const shouldCancel = () => !active;
    load(true, shouldCancel);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(false, shouldCancel);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [load]);

  const patientRows = useMemo(() => derivePatientRows(snapshot), [snapshot]);
  const flowData = useMemo(() => deriveFlowData(snapshot.appointments, snapshot.visits, snapshot.referrals), [snapshot.appointments, snapshot.referrals, snapshot.visits]);

  const metrics = useMemo(() => {
    const today = new Date().toDateString();
    const todayAppointments = snapshot.appointments.filter((appointment) => new Date(appointment.scheduledAt || appointment.scheduled_at).toDateString() === today);
    const unsignedNotes = snapshot.visits.filter((visit) => !visit.isSigned && !visit.is_signed);
    const openPrescriptions = snapshot.prescriptions.filter((prescription) => !['dispensed', 'cancelled', 'completed'].includes(String(prescription.lifecycle_status || prescription.status || '').toLowerCase()));
    const openReferrals = snapshot.referrals.filter((referral) => !['completed', 'cancelled'].includes(String(referral.status || '').toLowerCase()));
    const waitingMinutes = todayAppointments
      .map((appointment) => minutesUntil(appointment.scheduledAt || appointment.scheduled_at))
      .filter((value) => value !== null && value < 0)
      .map((value) => Math.abs(value));
    const averageWait = waitingMinutes.length ? Math.round(waitingMinutes.reduce((sum, value) => sum + value, 0) / waitingMinutes.length) : 0;

    return {
      todayAppointments: todayAppointments.length,
      highRisk: patientRows.filter((patient) => patient.risk >= 75).length + snapshot.referrals.filter((referral) => ['urgent', 'emergency'].includes(String(referral.priority || '').toLowerCase())).length,
      averageWait,
      openActions: unsignedNotes.length + openPrescriptions.length + openReferrals.length,
      queueTrend: todayAppointments.length ? `+${todayAppointments.length}` : '0',
    };
  }, [patientRows, snapshot.appointments, snapshot.prescriptions, snapshot.referrals, snapshot.visits]);

  const activeTitle = useMemo(() => {
    const item = NAV_ITEMS.find((navItem) => navItem.id === activeTab);
    return item?.label || 'Command Center';
  }, [activeTab]);

  const providerName = getProviderName(user);
  const providerSubtitle = isNigeriaMarket ? 'Nigeria provider workspace' : 'United States provider workspace';

  return (
    <div className="min-h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-900 shadow-sm">
      {selectedPatient ? (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm" onClick={() => setSelectedPatient(null)} aria-label="Close patient drawer overlay" />
          <PatientDrawer patient={selectedPatient} providerPath={providerPath} onClose={() => setSelectedPatient(null)} />
        </>
      ) : null}

      <div className="flex min-h-[calc(100vh-7rem)]">
        <aside className="hidden w-[250px] shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm lg:flex">
          <div className="flex h-20 items-center border-b border-slate-100 px-6">
            <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-700 shadow-lg shadow-blue-200">
              <Activity size={24} className="text-white" />
            </div>
            <div>
              <span className="block text-xl font-bold leading-none text-slate-900">DoctaRx OS</span>
              <span className="mt-1 block text-[10px] font-bold uppercase text-blue-700">{isNigeriaMarket ? 'Nigeria' : 'Provider'}</span>
            </div>
          </div>

          <div className="mt-2 flex-1 space-y-1.5 p-4">
            <div className="mb-2 px-4 text-xs font-bold uppercase text-slate-400">Dashboards</div>
            {NAV_ITEMS.slice(0, 3).map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setSelectedPatient(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition ${active ? 'bg-blue-700 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  <item.icon size={20} className={active ? 'text-white' : 'text-slate-400'} />
                  <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
                </button>
              );
            })}

            <div className="mb-2 mt-6 px-4 text-xs font-bold uppercase text-slate-400">Workspace</div>
            {NAV_ITEMS.slice(3).map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setSelectedPatient(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition ${active ? 'bg-blue-700 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  <item.icon size={20} className={active ? 'text-white' : 'text-slate-400'} />
                  <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="m-4 flex items-center rounded-lg border bg-slate-50 p-4">
            <div className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-200 font-bold text-slate-600 shadow-sm">
              {getInitials(providerName)}
            </div>
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-sm font-bold text-slate-900">{providerName}</p>
              <p className="truncate text-xs font-medium text-slate-500">{providerSubtitle}</p>
            </div>
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex min-h-20 shrink-0 flex-col gap-4 border-b border-slate-200 bg-white/80 px-5 py-4 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between xl:px-8">
            <div className="flex items-center">
              <h1 className="mr-4 text-xl font-bold text-slate-800">{activeTitle}</h1>
              {activeTab === 'command' ? (
                <span className="flex items-center rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live Workspace
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search patients, visits, tasks..."
                  className="w-full rounded-full border border-transparent bg-slate-100 py-2 pl-10 pr-4 text-sm font-medium outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 sm:w-72"
                />
              </div>
              <button type="button" className="relative rounded-full p-2 text-slate-400 transition hover:bg-slate-100" aria-label="Notifications">
                <Bell size={20} />
                {metrics.openActions ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-rose-500" /> : null}
              </button>
              <button type="button" onClick={() => router.push(providerPath(isNigeriaMarket ? '/prescriptions' : '/prescriptions'))} className="flex items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600">
                <Plus size={16} className="mr-2" />
                New Order
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-5 xl:p-8">
            {loadErrors.length ? (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <span>Some live panels could not load: {loadErrors.join(', ')}.</span>
              </div>
            ) : null}

            {activeTab === 'command' ? (
              <>
                <CommandCenter snapshot={snapshot} patients={patientRows} flowData={flowData} metrics={metrics} loading={loading} providerPath={providerPath} />
                <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Healthcare Operating Workspace</h2>
                      <p className="text-sm text-slate-500">Clinical operations are exposed from one dashboard surface and route into existing provider workflows.</p>
                    </div>
                    <ShieldCheck className="h-6 w-6 text-blue-700" />
                  </div>
                  <WorkflowGrid providerPath={providerPath} />
                </section>
              </>
            ) : null}
            {activeTab === 'population' ? <PatientDirectory patients={patientRows} onSelectPatient={setSelectedPatient} providerPath={providerPath} /> : null}
            {activeTab === 'documents' ? <RecordsView visits={snapshot.visits} providerPath={providerPath} /> : null}
            {activeTab === 'schedule' ? <ScheduleView appointments={snapshot.appointments} providerPath={providerPath} /> : null}
            {activeTab === 'telehealth' ? <TelehealthView providerPath={providerPath} /> : null}
          </div>

          <div className="border-t border-slate-200 bg-white px-5 py-3 text-xs text-slate-500 xl:px-8">
            Last refreshed: {lastLoadedAt ? lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'loading'}
          </div>
        </main>
      </div>
    </div>
  );
}
