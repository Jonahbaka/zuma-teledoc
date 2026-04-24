'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  TrendingUp, CreditCard, Clock, CheckCircle,
  ChevronLeft, DollarSign, BarChart3, Calendar,
  AlertCircle, ArrowRight, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

export default function ProviderEarnings() {
  const [earnings, setEarnings] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const providerId = localStorage.getItem('ng_provider_id');
    if (!token || !providerId) { setLoading(false); return; }
    fetch(`/api/ng/providers/${providerId}/earnings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setEarnings(d.summary);
        setTransactions(d.transactions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (s) => ({
    pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    paid: 'bg-green-500/10 text-green-600 border-green-500/20',
    failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  }[s] || 'bg-muted text-muted-foreground border-border');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-8">

        <div className="flex items-center gap-3">
          <Link href="/ng/provider/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Earnings</h1>
            <p className="text-muted-foreground text-sm">Track your consultations, commissions, and payouts</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Earned', value: formatNaira(earnings?.total_earned || 0), icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10' },
            { label: 'Pending Payout', value: formatNaira(earnings?.pending_payout || 0), icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { label: 'Total Paid Out', value: formatNaira(earnings?.total_paid_out || 0), icon: CreditCard, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Consultations', value: (earnings?.total_consultations || 0).toString(), icon: Calendar, color: 'text-purple-500', bg: 'bg-purple-500/10' },
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

        {/* Commission model info */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 text-sm">
          <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
            <DollarSign size={16} className="text-blue-500" /> Your Revenue Model
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 text-muted-foreground">
            <div>
              <p className="font-medium text-foreground text-xs mb-1">Commission Model</p>
              <p>DoctaRx takes <strong className="text-foreground">15%</strong> of each consultation fee. You keep <strong className="text-green-500">85%</strong>.</p>
            </div>
            <div>
              <p className="font-medium text-foreground text-xs mb-1">Payout Schedule</p>
              <p>Payouts are processed weekly every <strong className="text-foreground">Friday</strong> to your registered bank account.</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex gap-1 bg-accent rounded-xl p-1 mb-6 w-fit">
            {['overview', 'transactions', 'analytics'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-2xl p-6">
                <h3 className="font-bold text-foreground mb-4">Payout Details</h3>
                {earnings?.bank_name ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span className="font-medium">{earnings.bank_name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span className="font-medium">****{earnings.account_number?.slice(-4)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Account Name</span><span className="font-medium">{earnings.account_name}</span></div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <AlertCircle size={28} className="mx-auto mb-2 text-amber-500" />
                    <p className="text-sm text-muted-foreground mb-3">No payout account set up yet.</p>
                    <Link href="/ng/provider/profile#bank">
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white">Add Bank Account</Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'transactions' && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h3 className="font-bold text-foreground">Transaction History</h3>
                <button className="text-sm text-blue-500 flex items-center gap-1 hover:underline">
                  <Download size={14} /> Export
                </button>
              </div>
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <TrendingUp size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No transactions yet. Complete your first consultation to see earnings here.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.map(tx => (
                    <div key={tx.id} className="px-6 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{tx.description || 'Consultation fee'}</p>
                        <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-500">{formatNaira(tx.provider_amount)}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(tx.payout_status)}`}>
                          {tx.payout_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'analytics' && (
            <div className="bg-card border border-border rounded-2xl p-8 text-center">
              <BarChart3 size={40} className="mx-auto mb-3 text-muted-foreground opacity-30" />
              <h3 className="font-bold text-foreground mb-2">Analytics Coming Soon</h3>
              <p className="text-muted-foreground text-sm">Detailed performance charts, peak hours analysis, and patient retention metrics will be available here.</p>
              <div className="mt-4 inline-block text-xs bg-amber-500/10 text-amber-600 border border-amber-500/20 px-3 py-1.5 rounded-full font-bold">Pro Feature — Coming Soon</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
