'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import NgNav from '../../components/NgNav';
import { FeatureGate } from '../../components/FeatureGate';

export default function HospitalBilling() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/ng/hospital/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing & Insurance</h1>
            <p className="text-muted-foreground text-sm">Invoicing, NHIA/HMO billing and payments</p>
          </div>
        </div>
        <FeatureGate type="nigeria_pending" available={false}><div /></FeatureGate>
      </div>
    </div>
  );
}
