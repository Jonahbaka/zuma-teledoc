'use client';

import Link from 'next/link';
import {
  Network, Pill, NotebookPen, Video, BarChart3, QrCode, Sparkles,
  ArrowRight, ShieldCheck,
} from 'lucide-react';

const STATIONS = [
  {
    href: '/ng/referral-network',
    icon: Network,
    title: 'Referral Network',
    sub: 'Marketplace · Compose · Inbox · Outbox · Agents · Heatmap · Commissions',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  },
  {
    href: '/ng/medications/search',
    icon: Pill,
    title: 'Medication Search',
    sub: 'Nigerian brand-aware fuzzy search with live interaction checker',
    tone: 'bg-violet-50 border-violet-200 text-violet-900',
  },
  {
    href: '/ng/soap',
    icon: NotebookPen,
    title: 'SOAP Composer',
    sub: 'Templates: malaria · HTN · antenatal · diabetes · URTI · ORS · mental health',
    tone: 'bg-blue-50 border-blue-200 text-blue-900',
  },
  {
    href: '/ng/telehealth/diagnostics',
    icon: Video,
    title: 'Pre-call Diagnostics',
    sub: 'Bandwidth probe · device check · adaptive profile · audio-only fallback',
    tone: 'bg-cyan-50 border-cyan-200 text-cyan-900',
  },
  {
    href: '/ng/conference',
    icon: Video,
    title: 'Multi-Party Conferencing',
    sub: 'Case conferences · teaching rounds · board reviews · role permissions · invites',
    tone: 'bg-green-50 border-green-200 text-green-900',
  },
  {
    href: '/ng/executive-view',
    icon: BarChart3,
    title: 'Executive Command Centre',
    sub: 'FMOH / FCT / area-council scoped KPIs, signals, forecasts, governance',
    tone: 'bg-slate-50 border-slate-300 text-slate-900',
  },
];

export default function DemoHub() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/40 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">DoctaRx Nigeria — Presentation Demo</h1>
              <p className="text-xs text-slate-500">
                Live, database-backed walkthrough of the platform for senior healthcare stakeholders
              </p>
            </div>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Open the tabs in order</h2>
              <p className="mt-1 text-sm text-slate-700">
                The walkthrough script in <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">ng/docs/DEMO_MODE_WALKTHROUGH.md</code>{' '}
                runs through these stations in ~7 minutes. Each station is live — every number is real database state, not a mock.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Before going live, seed fixtures with:{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5">DEMO_MODE=true node ng/scripts/seed-demo-mode.js</code>
              </p>
            </div>
          </div>
        </section>

        <ol className="space-y-3">
          {STATIONS.map((s, i) => (
            <li key={s.href}>
              <Link href={s.href}
                className={`flex items-center gap-4 rounded-2xl border p-4 shadow-sm transition hover:scale-[1.005] hover:shadow-md ${s.tone}`}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      Station {i + 1}
                    </span>
                    <span className="text-base font-bold">{s.title}</span>
                  </div>
                  <p className="mt-1 text-xs opacity-80">{s.sub}</p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0" />
              </Link>
            </li>
          ))}
        </ol>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <QrCode className="mt-1 h-5 w-5 shrink-0 text-slate-500" />
            <div className="text-sm">
              <h3 className="text-base font-bold text-slate-900">Patient-facing slip</h3>
              <p className="mt-1 text-slate-700">
                After composing a referral and minting a QR slip in Station 1, paste the resulting URL into a new tab:{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5">/ng/referral-network/verify/&#123;token&#125;</code>
                — that's what the patient sees on their phone when reception scans the slip.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
