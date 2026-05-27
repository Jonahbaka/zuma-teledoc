'use client';

/**
 * components/ng/provider/OperationsHub.jsx
 * NG-region provider operations workspace — the "mini healthcare OS"
 * hub described in the master prompt directive. Consolidates the live
 * NG modules into one screen so a doctor / consultant / clinic admin
 * can run the day from here.
 *
 * Pure aggregation — no new endpoints. Surfaces:
 *   /api/ng/providers/me/access      → subscription + trial + usage
 *   /api/ng/conference/rooms         → live + scheduled rooms
 *   /api/ng/prescriptions            → active / awaiting pharmacy
 *   /api/ng/referral-network/kpis    → referrals last 30d
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Stethoscope, Video, Pill, Network, NotebookPen, Search, Building2,
  ShieldCheck, BarChart3, Users, Calendar, Activity, ArrowRight,
  AlertCircle, RefreshCw, Sparkles,
} from 'lucide-react';

const TOOL_GROUPS = [
  {
    title: 'Clinical work',
    items: [
      { href: '/ng/prescriptions',         icon: Pill,        title: 'Prescriptions',        sub: 'Compose · sign · send · dispense · refills' },
      { href: '/ng/soap',                  icon: NotebookPen, title: 'SOAP composer',        sub: '8 Nigerian clinical presets' },
      { href: '/ng/medications/search',    icon: Search,      title: 'Medication search',    sub: 'Brand-aware fuzzy + interaction checker' },
    ],
  },
  {
    title: 'Collaboration',
    items: [
      { href: '/ng/conference',            icon: Video,       title: 'Conferencing',         sub: 'Case conferences · teaching rounds · boards' },
      { href: '/ng/telehealth/diagnostics',icon: Activity,    title: 'Pre-call diagnostics', sub: 'Bandwidth probe · device check · adaptive' },
      { href: '/ng/referral-network',      icon: Network,     title: 'Referral network',     sub: 'Marketplace · compose · inbox · heatmap' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/ng/provider/appointments', icon: Calendar,    title: 'Appointments',         sub: 'Schedule + queue' },
      { href: '/ng/provider/patients',     icon: Users,       title: 'Patients',             sub: 'Longitudinal records' },
      { href: '/ng/provider/analytics',    icon: BarChart3,   title: 'Analytics',            sub: 'Volume · revenue · outcomes' },
      { href: '/ng/provider/profile',      icon: Building2,   title: 'Profile / facility',   sub: 'Facility, staff, hours' },
    ],
  },
];

export default function OperationsHub() {
  const [snap, setSnap]       = useState({ access: null, conf: null, rx: null, drn: null });
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr('');
    const fetchJson = async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      return r.json().catch(() => null);
    };
    try {
      const [access, conf, rx, drn] = await Promise.all([
        fetchJson('/api/ng/providers/me/access'),
        fetchJson('/api/ng/conference/rooms?limit=50'),
        fetchJson('/api/ng/prescriptions?limit=50'),
        fetchJson('/api/ng/referral-network/kpis'),
      ]);
      setSnap({ access: access?.providerAccess || null, conf, rx, drn });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const rooms        = snap.conf?.rooms || [];
  const liveRooms    = rooms.filter(r => r.status === 'live').length;
  const scheduledRm  = rooms.filter(r => r.status === 'scheduled').length;
  const rxs          = snap.rx?.prescriptions || [];
  const rxDrafts     = rxs.filter(r => r.lifecycle_status === 'drafted').length;
  const rxAwaiting   = rxs.filter(r => ['sent_to_pharmacy', 'received', 'partially_dispensed'].includes(r.lifecycle_status)).length;
  const drnKpi       = snap.drn?.kpis || {};
  const access       = snap.access?.access || {};
  const trial        = snap.access?.trial || {};
  const usage        = snap.access?.usage || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">Provider Operations Hub</h1>
              <p className="text-xs text-slate-500">
                One screen for every NG-region tool — your clinic's mini operating system
              </p>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-900">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {err && <p className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="h-4 w-4" />{err}</p>}

        {/* Access banner */}
        <AccessBanner access={access} trial={trial} usage={usage} loading={loading} />

        {/* Live stat tiles */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Live rooms"           value={liveRooms}                hint={`${scheduledRm} scheduled`}    icon={Video}    tone="emerald" loading={loading} />
          <Tile label="Rx drafts"            value={rxDrafts}                 hint="awaiting your signature"        icon={Pill}     tone="amber"   loading={loading} />
          <Tile label="Rx in pharmacy"       value={rxAwaiting}               hint="sent, ack'd, or dispensing"     icon={Pill}     tone="blue"    loading={loading} />
          <Tile label="Referrals (30d)"      value={drnKpi.total ?? 0}        hint={`${drnKpi.completed ?? 0} completed · ${drnKpi.emergencies ?? 0} emerg`} icon={Network} tone="violet" loading={loading} />
        </section>

        {/* Tool launcher */}
        {TOOL_GROUPS.map(g => (
          <section key={g.title}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map(it => (
                <Link key={it.href} href={it.href}
                      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-green-300 hover:shadow-md">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-50 text-green-700">
                    <it.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{it.title}</p>
                    <p className="truncate text-xs text-slate-500">{it.sub}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-green-600" />
                </Link>
              ))}
            </div>
          </section>
        ))}

        {/* Recent prescriptions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Recent prescriptions</h2>
            <Link href="/ng/prescriptions" className="text-xs font-semibold text-green-700 hover:underline">View all →</Link>
          </div>
          {rxs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
              No prescriptions yet. <Link href="/ng/prescriptions" className="text-green-700 underline">Compose one</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {rxs.slice(0, 6).map(p => (
                <li key={p.id} className="px-4 py-2 text-sm">
                  <Link href={`/ng/prescriptions/${p.id}`} className="flex items-center justify-between gap-2 hover:text-green-700">
                    <span className="truncate"><span className="font-mono text-xs text-slate-500">{p.prescription_number}</span> — {p.diagnosis || '(no diagnosis)'}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{p.lifecycle_status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent rooms */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Recent rooms</h2>
            <Link href="/ng/conference" className="text-xs font-semibold text-green-700 hover:underline">View all →</Link>
          </div>
          {rooms.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
              No rooms scheduled. <Link href="/ng/conference" className="text-green-700 underline">Schedule one</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {rooms.slice(0, 6).map(r => (
                <li key={r.id} className="px-4 py-2 text-sm">
                  <Link href={`/ng/conference/${r.id}`} className="flex items-center justify-between gap-2 hover:text-green-700">
                    <span className="truncate"><span className="font-mono text-xs text-slate-500">{r.room_code}</span> — {r.title || 'Untitled'}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{r.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="pt-4 text-center text-[11px] text-slate-400">
          <Sparkles className="mr-1 inline h-3 w-3" />
          Every tile is wired to a real backend. No mocks.
        </footer>
      </main>
    </div>
  );
}

function Tile({ label, value, hint, icon: Icon, tone = 'slate', loading }) {
  const tones = {
    slate:   'bg-white border-slate-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    amber:   'bg-amber-50 border-amber-200',
    blue:    'bg-blue-50 border-blue-200',
    violet:  'bg-violet-50 border-violet-200',
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <p className="text-2xl font-black text-slate-900">{loading ? '…' : value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function AccessBanner({ access, trial, usage, loading }) {
  if (loading && !access?.accessStatus) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Loading access status…</div>;
  }
  const allowed = access?.allowed;
  const tone = allowed ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  const label =
    access?.accessStatus === 'subscribed' ? 'Provider subscription active'
      : access?.accessStatus === 'trial_access' ? `Provider trial: ${trial?.daysRemaining ?? access?.daysRemaining ?? 0} day(s) remaining`
      : access?.blockReason || 'Provider onboarding access status';

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${tone}`}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-xs">
          {usage.appointmentsCount || 0} appts · {usage.videoCallsCount || 0} video · {usage.prescriptionsCount || 0} Rx · {usage.messagesCount || 0} msgs
        </p>
      </div>
    </div>
  );
}
