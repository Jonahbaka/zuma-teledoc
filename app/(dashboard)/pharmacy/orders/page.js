'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck, Truck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function PharmacyOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Orders &amp; Fulfillment</h1>
        <p className="text-muted-foreground text-sm mt-1">Only verified live pickup and delivery activity should appear here.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Preparing', value: 0, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
          { label: 'Ready', value: 0, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'In Transit', value: 0, color: 'text-purple-500', bg: 'bg-purple-500/10' },
          { label: 'Delivered', value: 0, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.bg} rounded-xl p-4 border border-border`}>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-muted-foreground font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      <Card className="border-purple-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-purple-500" />
            Live Fulfillment Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Truck className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
            <p className="font-semibold text-foreground">No live fulfillment orders are present.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Demo customers, seeded delivery addresses, and placeholder pricing have been removed from this page.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/pharmacy/dashboard">
              <Button variant="outline" className="w-full justify-between">
                Back to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/pharmacy/prescriptions">
              <Button variant="outline" className="w-full justify-between">
                Review Prescription Queue
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
