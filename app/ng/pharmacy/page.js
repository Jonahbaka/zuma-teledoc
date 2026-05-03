import Link from 'next/link';
import { ArrowRight, Building2, ClipboardCheck, LockKeyhole, MessageCircle, PackageCheck, ShieldCheck } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { Button } from '@/components/ui/button';

const portalFeatures = [
  {
    icon: ClipboardCheck,
    title: 'Prescription requests',
    body: 'Receive routed prescriptions and update fulfillment status from the pharmacy dashboard.',
  },
  {
    icon: PackageCheck,
    title: 'Availability confirmation',
    body: 'Confirm medicine availability and pricing only after pharmacy review. No fake stock is shown.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp-assisted workflow',
    body: 'Store pharmacy WhatsApp preferences and use manual fallback when automated messaging is not configured.',
  },
];

export default function NigeriaPharmacyPortalEntryPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(14,165,233,0.12),transparent_26%),linear-gradient(160deg,#ecfdf5,#f8fafc_55%,#ecfeff)] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/ng" className="inline-flex min-w-0 items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 shadow-[0_0_24px_rgba(16,185,129,0.2)]">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-950">DoctaRx Nigeria</span>
              <span className="block text-xs text-slate-600">Pharmacy operations portal</span>
            </span>
          </Link>

          <nav className="flex flex-wrap gap-2">
            <Link href="/ng/pharmacy/login">
              <Button variant="outline" className="border-emerald-700/30 bg-white/80 text-emerald-800 hover:bg-emerald-50">
                Pharmacy Login
              </Button>
            </Link>
            <Link href="/ng/pharmacy/register">
              <Button className="bg-emerald-700 text-white hover:bg-emerald-600">
                Register Pharmacy
              </Button>
            </Link>
          </nav>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="rounded-[2rem] border border-white/80 bg-white/82 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-8 lg:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Building2 className="h-4 w-4" />
              Nigeria Pharmacy Portal
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">
              Login or register your pharmacy for DoctaRx Nigeria fulfillment.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
              Pharmacies can receive prescription requests, update availability, manage pickup or delivery status, and keep profile, branch, and WhatsApp receiving details current.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/ng/pharmacy/login" className="w-full sm:w-auto">
                <Button className="h-12 w-full bg-emerald-700 px-6 text-base text-white hover:bg-emerald-600 sm:w-auto">
                  Pharmacy Login
                  <LockKeyhole className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/ng/pharmacy/register" className="w-full sm:w-auto">
                <Button variant="outline" className="h-12 w-full border-emerald-700/30 bg-white px-6 text-base text-emerald-800 hover:bg-emerald-50 sm:w-auto">
                  Register Pharmacy
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900">
              <ShieldCheck className="mr-2 inline h-4 w-4" />
              Pharmacy accounts are part of the DoctaRx Nigeria platform. Dispensing tools activate according to onboarding, account status, and compliance review.
            </div>
          </div>

          <div className="grid gap-4">
            {portalFeatures.map((feature) => (
              <article key={feature.title} className="rounded-[1.5rem] border border-white/80 bg-white/90 p-5 shadow-sm">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-950">{feature.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{feature.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
