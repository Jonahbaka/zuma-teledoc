'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Pill, Package, ClipboardList, CheckCircle, Clock,
  AlertCircle, TrendingUp, Users, ArrowRight, Truck,
  XCircle, RefreshCw, Banknote
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const STATS = [
  { label: 'New Prescriptions', value: '12', icon: ClipboardList, color: 'text-purple-500', bg: 'bg-purple-500/10', trend: '+3 today' },
  { label: 'Ready for Pickup', value: '5', icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10', trend: '2 urgent' },
  { label: 'Out for Delivery', value: '3', icon: Truck, color: 'text-emerald-500', bg: 'bg-emerald-500/10', trend: 'On track' },
  { label: 'Revenue Today', value: '₦87,500', icon: Banknote, color: 'text-amber-500', bg: 'bg-amber-500/10', trend: '+15% vs yesterday' },
];

const MOCK_PRESCRIPTIONS = [
  { id: 'RX001', patient: 'Chioma Adebayo', doctor: 'Dr. Okafor', medications: ['Amoxicillin 500mg x 21', 'Paracetamol 500mg x 10'], status: 'pending', time: '10 min ago', priority: 'normal' },
  { id: 'RX002', patient: 'Emeka Okonkwo', doctor: 'Dr. Ibrahim', medications: ['Metformin 850mg x 60', 'Glimepiride 2mg x 30'], status: 'pending', time: '25 min ago', priority: 'normal' },
  { id: 'RX003', patient: 'Fatima Musa', doctor: 'Dr. Adaeze', medications: ['Amlodipine 5mg x 30'], status: 'confirmed', time: '1 hr ago', priority: 'normal' },
  { id: 'RX004', patient: 'Blessing Eze', doctor: 'Dr. Obi', medications: ['Augmentin 625mg x 14', 'Ibuprofen 400mg x 12', 'Omeprazole 20mg x 14'], status: 'ready', time: '2 hrs ago', priority: 'urgent' },
  { id: 'RX005', patient: 'Tunde Balogun', doctor: 'Dr. Nwosu', medications: ['Ciprofloxacin 500mg x 10'], status: 'delivered', time: '3 hrs ago', priority: 'normal' },
];

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-yellow-500', badge: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  confirmed: { label: 'Confirmed', color: 'bg-blue-500', badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  ready: { label: 'Ready', color: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  delivered: { label: 'Delivered', color: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  rejected: { label: 'Rejected', color: 'bg-red-500', badge: 'bg-red-500/10 text-red-600 border-red-500/20' },
};

export default function PharmacyDashboardPage() {
  const [prescriptions] = useState(MOCK_PRESCRIPTIONS);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? prescriptions : prescriptions.filter(p => p.status === filter);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Good morning</h1>
          <p className="text-muted-foreground mt-1">Here&apos;s what&apos;s happening at your pharmacy today.</p>
        </div>
        <Link href="/pharmacy/prescriptions">
          <Button className="bg-purple-600 hover:bg-purple-500 text-white">
            <ClipboardList className="w-4 h-4 mr-2" /> View All Prescriptions
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
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

      {/* Prescription Queue */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-purple-500" />
              Prescription Queue
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              {['all', 'pending', 'confirmed', 'ready'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20' : 'text-muted-foreground hover:bg-accent border border-transparent'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No prescriptions in this category</p>
            </div>
          ) : (
            filtered.map((rx) => {
              const statusCfg = STATUS_CONFIG[rx.status];
              return (
                <div key={rx.id} className="bg-background rounded-xl border border-border p-4 hover:border-purple-500/20 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                        <Pill size={18} className="text-purple-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-foreground">{rx.patient}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCfg.badge}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                            {statusCfg.label}
                          </span>
                          {rx.priority === 'urgent' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
                              <AlertCircle size={10} /> Urgent
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">Prescribed by {rx.doctor} &bull; {rx.time}</div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {rx.medications.map((med, i) => (
                            <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded-md text-foreground">{med}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {rx.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" className="text-xs h-8 border-red-500/20 text-red-500 hover:bg-red-500/10">
                            <XCircle className="w-3 h-3 mr-1" /> Reject
                          </Button>
                          <Button size="sm" className="text-xs h-8 bg-emerald-600 hover:bg-emerald-500 text-white">
                            <CheckCircle className="w-3 h-3 mr-1" /> Confirm Stock
                          </Button>
                        </>
                      )}
                      {rx.status === 'confirmed' && (
                        <Button size="sm" className="text-xs h-8 bg-blue-600 hover:bg-blue-500 text-white">
                          <Package className="w-3 h-3 mr-1" /> Mark Ready
                        </Button>
                      )}
                      {rx.status === 'ready' && (
                        <Button size="sm" className="text-xs h-8 bg-purple-600 hover:bg-purple-500 text-white">
                          <Truck className="w-3 h-3 mr-1" /> Dispatch
                        </Button>
                      )}
                      {rx.status === 'delivered' && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle size={14} className="text-emerald-500" /> Complete</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="hover:border-purple-500/20 transition-colors cursor-pointer group">
          <CardContent className="p-6 text-center">
            <div className="w-14 h-14 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <RefreshCw size={24} className="text-purple-500" />
            </div>
            <h3 className="font-bold text-foreground mb-1">Drug Substitution</h3>
            <p className="text-xs text-muted-foreground">Suggest alternatives for unavailable medications</p>
          </CardContent>
        </Card>
        <Card className="hover:border-blue-500/20 transition-colors cursor-pointer group">
          <CardContent className="p-6 text-center">
            <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Banknote size={24} className="text-blue-500" />
            </div>
            <h3 className="font-bold text-foreground mb-1">Price Confirmation</h3>
            <p className="text-xs text-muted-foreground">Send pricing to patients for approval</p>
          </CardContent>
        </Card>
        <Card className="hover:border-emerald-500/20 transition-colors cursor-pointer group">
          <CardContent className="p-6 text-center">
            <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Truck size={24} className="text-emerald-500" />
            </div>
            <h3 className="font-bold text-foreground mb-1">Delivery Management</h3>
            <p className="text-xs text-muted-foreground">Track and coordinate medication deliveries</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
