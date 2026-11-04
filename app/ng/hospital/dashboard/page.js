'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2, Users, Calendar, Activity, CreditCard,
  CheckCircle, AlertCircle, Clock, ChevronRight,
  Stethoscope, FileText, Package, Settings,
  TrendingUp, Plus, ArrowRight, Pill, BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '../../components/FeatureGate';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

export default function HospitalDashboard() {
  const [hospital, setHospital] = useState(null);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('Good day');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    const token = localStorage.getItem('accessToken');
    const hospitalId = localStorage.getItem('ng_hospital_id');
    if (token && hospitalId) {
      fetch(`/api/ng/hospitals/${hospitalId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setHospital(d.hospital))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const statusConfig = {
    pending: { label: 'Pending Review', color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    verified: { label: 'Verified', color: 'text-green-600', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    under_review: { label: 'Under Review', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    suspended: { label: 'Suspended', color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  };
  const hStatus = statusConfig[hospital?.status] || statusConfig.pending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900/40 via-slate-900 to-indigo-900/30 border-b border-border px-6 py-8">
          <div className="max-w-5xl mx-auto flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-muted-foreground text-sm">{greeting}</p>
              <h1 className="text-3xl font-bold text-foreground mt-1">
                {hospital?.name || 'Hospital Dashboard'}
              </h1>
              {hospital && (
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${hStatus.bg} ${hStatus.color} ${hStatus.border}`}>
                    {hStatus.label}
                  </span>
                  <span className="text-muted-foreground text-sm capitalize">{hospital.facility_type?.replace(/_/g, ' ')}</span>
                  {hospital.city && <span className="text-muted-foreground text-sm">{hospital.city}, {hospital.state}</span>}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Link href="/ng/hospital/staff">
                <Button className="bg-purple-600 hover:bg-purple-500 text-white">
                  <Plus size={16} className="mr-1.5" /> Add Staff
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

          {/* Verification notice */}
          {hospital?.status === 'pending' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong className="text-foreground">Verification pending.</strong>{' '}
                <span className="text-muted-foreground">Your facility is under review. Once verified, you can onboard staff and access all features. This typically takes 2–5 business days.</span>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Staff Members', value: hospital?.staff_count || 0, icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10' },
              { label: 'Bed Capacity', value: hospital?.bed_count || '—', icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Departments', value: (hospital?.departments || []).length || '—', icon: Building2, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
              { label: 'Monthly Billing', value: formatNaira(0), icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10' },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      <Icon size={16} className={stat.color} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                </div>
              );
            })}
          </div>

          {/* Main grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              {/* Departments */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Building2 size={18} className="text-purple-500" /> Departments
                  </h3>
                </div>
                {hospital?.departments?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {hospital.departments.map(d => (
                      <span key={d} className="text-xs bg-purple-500/10 text-purple-600 border border-purple-500/20 px-3 py-1.5 rounded-full font-medium">{d}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <Building2 size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No departments added yet.</p>
                  </div>
                )}
              </div>

              {/* Appointments */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Calendar size={18} className="text-purple-500" /> Appointments
                  </h3>
                  <Link href="/ng/hospital/appointments" className="text-sm text-purple-500 font-medium hover:underline">View all</Link>
                </div>
                <FeatureGate type="nigeria_pending" available={false}>
                  <div />
                </FeatureGate>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              {/* Integrations */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-4 text-sm">Integrations</h3>
                <div className="space-y-3">
                  {[
                    { label: 'NHIA/NHIS', desc: 'Insurance verification', available: false },
                    { label: 'FHIR R4', desc: 'Health data exchange', available: false },
                    { label: 'Lab Systems', desc: 'Lab order integration', available: false },
                  ].map(i => (
                    <div key={i.label} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{i.label}</p>
                        <p className="text-xs text-muted-foreground">{i.desc}</p>
                      </div>
                      <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold">Soon</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Capabilities */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-3 text-sm">Capabilities</h3>
                <div className="space-y-2">
                  {[
                    { label: 'In-house Pharmacy', on: hospital?.has_pharmacy },
                    { label: 'Laboratory', on: hospital?.has_lab },
                  ].map(cap => (
                    <div key={cap.label} className="flex items-center gap-2">
                      {cap.on
                        ? <CheckCircle size={14} className="text-green-500" />
                        : <Clock size={14} className="text-muted-foreground" />}
                      <span className="text-sm text-foreground">{cap.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Portal navigation */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-4">Hospital Portal</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Staff Management', desc: 'Add and manage doctors & nurses', href: '/ng/hospital/staff', icon: Users, available: true },
                { label: 'Appointments', desc: 'Patient scheduling & calendar', href: '/ng/hospital/appointments', icon: Calendar, available: false },
                { label: 'Patient Records', desc: 'Electronic health records', href: '/ng/hospital/records', icon: FileText, available: false },
                { label: 'Pharmacy', desc: 'In-house dispensing & inventory', href: '/ng/hospital/pharmacy', icon: Pill, available: false },
                { label: 'Billing', desc: 'Invoicing, insurance & billing', href: '/ng/hospital/billing', icon: CreditCard, available: false },
                { label: 'Settings', desc: 'Facility profile & integrations', href: '/ng/hospital/settings', icon: Settings, available: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="group bg-card border border-border rounded-2xl p-5 hover:border-purple-500/20 transition-all hover:shadow-md">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                        <Icon size={18} className="text-purple-500" />
                      </div>
                      {!item.available && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold">Soon</span>
                      )}
                    </div>
                    <h4 className="font-bold text-foreground text-sm">{item.label}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                  </Link>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
