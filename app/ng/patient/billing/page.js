'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, CreditCard, Receipt, AlertCircle } from 'lucide-react';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

export default function PatientBilling() {
  const [billing, setBilling] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setLoading(false); return; }
    fetch('/api/ng/subscriptions/billing-history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setBilling(d.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (s) => ({
    paid: 'bg-green-500/10 text-green-600 border-green-500/20',
    pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    failed: 'bg-red-500/10 text-red-600 border-red-500/20',
    refunded: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  }[s] || 'bg-muted text-muted-foreground border-border');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-3xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center gap-3">
          <Link href="/ng/patient/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing & Payments</h1>
            <p className="text-muted-foreground text-sm">Your subscription and consultation payment history</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/ng/patient/subscription" className="flex-1 bg-card border border-border rounded-2xl p-4 hover:border-green-500/30 transition-all">
            <CreditCard size={20} className="text-green-500 mb-2" />
            <p className="font-bold text-foreground text-sm">Manage Subscription</p>
            <p className="text-xs text-muted-foreground mt-0.5">Upgrade, downgrade or cancel your plan</p>
          </Link>
          <Link href="/ng/patient/appointments" className="flex-1 bg-card border border-border rounded-2xl p-4 hover:border-green-500/30 transition-all">
            <Receipt size={20} className="text-green-500 mb-2" />
            <p className="font-bold text-foreground text-sm">Pay-as-you-go</p>
            <p className="text-xs text-muted-foreground mt-0.5">Book a single consultation</p>
          </Link>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="font-bold text-foreground">Payment History</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : billing.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Receipt size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No payment history yet.</p>
              <p className="text-xs mt-1">Payments will appear here after your first subscription or consultation.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {billing.map(b => (
                <div key={b.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{b.description || 'Subscription payment'}</p>
                    <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatNaira(b.amount)}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(b.status)}`}>{b.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
