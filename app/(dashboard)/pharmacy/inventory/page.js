'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle, Pill, ShieldCheck, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function PharmacyInventoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">Inventory remains empty until live catalog and stock feeds are connected to this account.</p>
        </div>
        <Button className="bg-purple-600 hover:bg-purple-500 text-white">Prepare Catalog</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600">In Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">0</div>
        </div>
        <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-yellow-500" />
            <span className="text-xs font-medium text-yellow-600">Low Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">0</div>
        </div>
        <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
          <div className="flex items-center gap-2 mb-1">
            <XCircle size={16} className="text-red-500" />
            <span className="text-xs font-medium text-red-600">Out of Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">0</div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-purple-500" />
            Live Inventory Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Pill className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
            <p className="font-semibold text-foreground">No live inventory items are connected.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Seeded medications, placeholder stock counts, and regional pricing have been removed. This page is ready for real catalog data only.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/pharmacy/dashboard">
              <Button variant="outline" className="w-full justify-between">
                Back to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/pharmacy/settings">
              <Button variant="outline" className="w-full justify-between">
                Review Settings
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
