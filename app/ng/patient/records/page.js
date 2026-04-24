'use client';

import Link from 'next/link';
import { ChevronLeft, FileText, Activity, Pill, TestTube, Heart } from 'lucide-react';
import NgNav from '../../components/NgNav';
import { FeatureGate } from '../../components/FeatureGate';

export default function PatientRecords() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center gap-3">
          <Link href="/ng/patient/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Health Records</h1>
            <p className="text-muted-foreground text-sm">Your personal health history</p>
          </div>
        </div>

        <FeatureGate type="nigeria_pending" available={false}>
          <div />
        </FeatureGate>

        <div className="grid sm:grid-cols-2 gap-4 opacity-40 pointer-events-none">
          {[
            { label: 'Consultations', desc: 'All past doctor consultations', icon: Activity },
            { label: 'Prescriptions', desc: 'Issued and filled prescriptions', icon: Pill },
            { label: 'Lab Results', desc: 'Blood tests, urinalysis, etc.', icon: TestTube },
            { label: 'Vitals History', desc: 'BP, weight, blood sugar logs', icon: Heart },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="bg-card border border-border rounded-2xl p-5">
                <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center mb-3">
                  <Icon size={18} className="text-green-500" />
                </div>
                <h4 className="font-bold text-foreground text-sm">{item.label}</h4>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
