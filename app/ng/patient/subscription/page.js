'use client';

import Link from 'next/link';
import { Building2, CheckCircle2, CreditCard, ShieldCheck, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

const consultationPrices = [
  { label: 'General consultation', price: `${formatNaira(2000)} - ${formatNaira(5000)}` },
  { label: 'Specialist consultation', price: `${formatNaira(5000)} - ${formatNaira(15000)}` },
];

export default function NgPatientSubscription() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <main className="pt-14">
        <section className="border-b border-border bg-card/40 px-6 py-8">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-3xl font-bold text-foreground">Coverage and consultation payments</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              DoctaRx Nigeria patient accounts are free. You only pay when booking a consultation, unless an approved organisation covers your care.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-5 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold">Free patient account</h2>
              <p className="mt-2 text-sm leading-6">
                Registration, dashboard access, profile, appointment history, prescriptions, medication requests, and care records are available without a monthly patient subscription.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  'Search medicines and pharmacies',
                  'Book consultations when needed',
                  'Track prescriptions and fulfillment',
                  'Use organisation coverage when assigned',
                ].map((item) => (
                  <div key={item} className="flex gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <Stethoscope className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-bold">Pay per consultation</h2>
              </div>
              <div className="space-y-3">
                {consultationPrices.map((item) => (
                  <div key={item.label} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-4">
                    <span className="font-medium">{item.label}</span>
                    <span className="font-bold text-emerald-700">{item.price}</span>
                  </div>
                ))}
              </div>
              <Link href="/ng/patient/appointments/book" className="mt-5 inline-flex">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Book Consultation</Button>
              </Link>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-3xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <Building2 className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-bold">Organisation coverage</h2>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Companies, schools, churches, NGOs, associations, and other groups can cover consultation access for members through DoctaRx organisation plans.
              </p>
              <div className="mt-4 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                If you are attached to an organisation, your patient portal will show coverage status, expiration date, and whether the organisation or patient pays for each consultation.
              </div>
              <Link href="/ng/pricing" className="mt-5 inline-flex">
                <Button variant="outline">View Organisation Plans</Button>
              </Link>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-bold">Payment options</h2>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Nigeria payments can be confirmed through supported gateway checkout when available, or through admin-confirmed bank transfer, POS, cash, or invoice workflows.
              </p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
