'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CreditCard, Search, ChevronLeft, Download, TrendingUp, Users, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNaira } from '../../lib/ngUtils';

const statusBadge = (s) => ({
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  trial: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  expired: 'bg-red-500/10 text-red-600 border-red-500/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
  past_due: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
}[s] || 'bg-muted text-muted-foreground border-border');

export default function AdminSubscriptions() {
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState({ total: 0, active: 0, mrr: 0 });

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  useEffect(() => {
    fetch('/api/ng/subscriptions/plans', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: 100 });
    if (tab !== 'all') params.set('status', tab);
    fetch(`/api/ng/subscriptions?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setSubs(d.subscriptions || []);
        setSummary({ total: d.total || 0, active: d.active || 0, mrr: d.mrr || 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const handleCancel = async (id) => {
    if (!confirm('Cancel this subscription?')) return;
    await fetch(`/api/ng/subscriptions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    setSubs(s => s.filter(x => x.id !== id));
  };

  const filtered = subs.filter(s =>
    s.user_id?.toString().includes(search) ||
    s.plan_id?.toLowerCase().includes(search.toLowerCase()) ||
    s.entity_type?.toLowerCase().includes(search.toLowerCase())
  );

  const planLabel = (pid) => plans.find(p => p.id === pid)?.name || pid;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ng/admin" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Subscription Management</h1>
          <p className="text-muted-foreground text-sm">All patient, organisation, provider and pharmacy subscriptions</p>
        </div>
      </div>

      {/* MRR summary */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Subscriptions', value: summary.total, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: summary.active, icon: CreditCard, color: 'text-green-500', bg: 'bg-green-500/10' },
          { label: 'Est. MRR', value: formatNaira(summary.mrr), icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-500/10' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <div className={`w-8 h-8 rounded-xl ${s.bg} flex items-center justify-center`}><Icon size={15} className={s.color} /></div>
              </div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit flex-wrap">
        {['all', 'active', 'trial', 'past_due', 'expired', 'cancelled'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 max-w-md">
        <Search size={15} className="text-muted-foreground shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by user ID, plan, or type…"
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground text-sm">Subscriptions ({filtered.length})</h3>
          <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline"><Download size={12} /> Export CSV</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CreditCard size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No subscriptions found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(s => (
              <div key={s.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground capitalize">{s.entity_type || 'patient'}</span>
                    <span className="text-xs text-muted-foreground">#{s.entity_id || s.user_id}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(s.status)}`}>{s.status?.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Plan: <strong className="text-foreground">{planLabel(s.plan_id)}</strong> • {s.billing_cycle || 'monthly'}</p>
                  <p className="text-xs text-muted-foreground">
                    Started: {s.started_at ? new Date(s.started_at).toLocaleDateString('en-NG') : '—'} •
                    Expires: {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString('en-NG') : '—'}
                  </p>
                  {s.amount && <p className="text-xs font-medium text-foreground">{formatNaira(s.amount)}/mo</p>}
                </div>
                {s.status === 'active' && (
                  <Button size="sm" onClick={() => handleCancel(s.id)}
                    variant="outline" className="text-red-500 border-red-500/30 text-xs h-7 px-3 shrink-0">
                    <XCircle size={12} className="mr-1" /> Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
