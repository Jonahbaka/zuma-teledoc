'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle, ClipboardList, Clock, Package, Pill, Settings, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const STATS = [
  { label: 'Queued Prescriptions', value: '0', icon: ClipboardList, color: 'text-purple-500', bg: 'bg-purple-500/10', trend: 'Live data only' },
  { label: 'Ready for Pickup', value: '0', icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10', trend: 'Awaiting routed orders' },
  { label: 'Inventory Alerts', value: '0', icon: Pill, color: 'text-emerald-500', bg: 'bg-emerald-500/10', trend: 'No seeded items shown' },
  { label: 'Compliance Flags', value: '0', icon: ShieldCheck, color: 'text-amber-500', bg: 'bg-amber-500/10', trend: 'No unresolved issues' },
];

export default function PharmacyDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Good morning</h1>
          <p className="text-muted-foreground mt-1">This workspace now shows live pharmacy operations only. Seeded records and cross-market demo data have been removed.</p>
        </div>
        <Link href="/pharmacy/prescriptions">
          <Button className="bg-purple-600 hover:bg-purple-500 text-white">
            <ClipboardList className="w-4 h-4 mr-2" /> Open Prescription Queue
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((stat, idx) => (
          <Card key={idx} className="hover:border-primary/20 transition-colors">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <stat.icon size={20} className={stat.color} />
                </div>
              </div>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              <div className="text-xs text-emerald-500 font-medium mt-1">{stat.trend}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
        <Card className="border-purple-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-500" />
              Production-Safe Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
              <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
              <p className="font-semibold text-foreground">No live pharmacy records are loaded for this account yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                This portal now blocks fake prescriptions, seeded patients, seeded prescribers, and market-specific pricing. Only routed live data should appear here.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Link href="/pharmacy/prescriptions">
                <Button variant="outline" className="w-full justify-between">
                  Prescriptions
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/pharmacy/inventory">
                <Button variant="outline" className="w-full justify-between">
                  Inventory
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/pharmacy/settings">
                <Button variant="outline" className="w-full justify-between">
                  Settings
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-500" />
              Activation Checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              'Verify the pharmacy account can authenticate and hold an access token.',
              'Connect only live prescription-routing records to this workspace.',
              'Populate inventory and fulfillment data from verified operational sources.',
              'Keep all audit, privacy, and access controls enforced before enabling edits.',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
            <Link href="/pharmacy/settings">
              <Button className="mt-2 w-full bg-purple-600 hover:bg-purple-500 text-white">
                <Settings className="w-4 h-4 mr-2" />
                Review Workspace Settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
