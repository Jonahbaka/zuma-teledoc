'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2, CreditCard, Search, ChevronLeft, Download, TrendingUp, Users, XCircle } from 'lucide-react';
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
  const [manualNotice, setManualNotice] = useState('');
  const [manualActivation, setManualActivation] = useState({
    subjectType: 'provider',
    userId: '',
    organizationId: '',
    planKey: '',
    amountNgn: '',
    paymentMethod: 'bank_transfer',
    paymentReference: '',
    periodEnd: '',
    notes: '',
  });

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const loadSubscriptions = async () => {
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
  };

  useEffect(() => {
    fetch('/api/ng/subscriptions/plans', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [tab]);

  const handleCancel = async (id) => {
    if (!confirm('Cancel this subscription?')) return;
    await fetch(`/api/ng/subscriptions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    setSubs(s => s.filter(x => x.id !== id));
  };

  const handleManualActivation = async (event) => {
    event.preventDefault();
    setManualNotice('');

    if (!manualActivation.planKey) {
      setManualNotice('Select a plan before activating a subscription.');
      return;
    }

    if (manualActivation.subjectType === 'provider' && !manualActivation.userId) {
      setManualNotice('Provider user ID is required for provider subscription activation.');
      return;
    }

    if (manualActivation.subjectType === 'organization' && !manualActivation.organizationId) {
      setManualNotice('Organisation ID is required for bulk subscription activation.');
      return;
    }

    const response = await fetch('/api/ng/subscriptions/admin/manual-activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...manualActivation,
        userId: manualActivation.subjectType === 'provider' ? manualActivation.userId : null,
        organizationId: manualActivation.subjectType === 'organization' ? manualActivation.organizationId : null,
        amountNgn: manualActivation.amountNgn ? Number(manualActivation.amountNgn) : undefined,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setManualNotice(payload.error || 'Unable to activate subscription.');
      return;
    }

    setManualNotice('Subscription activated from admin-confirmed payment.');
    setManualActivation({
      subjectType: 'provider',
      userId: '',
      organizationId: '',
      planKey: '',
      amountNgn: '',
      paymentMethod: 'bank_transfer',
      paymentReference: '',
      periodEnd: '',
      notes: '',
    });
    loadSubscriptions();
  };

  const filtered = subs.filter(s =>
    [
      s.subscriber_user_id,
      s.subscriber_org_id,
      s.user_email,
      s.plan_key,
      s.plan_name,
      s.plan_id,
    ].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const planLabel = (subscription) => {
    if (typeof subscription === 'string') {
      return plans.find(p => p.id === subscription)?.name || subscription;
    }
    return subscription.plan_name || plans.find(p => p.id === subscription.plan_id)?.name || subscription.plan_key || subscription.plan_id;
  };
  const eligibleManualPlans = plans.filter((plan) => plan.target_role === manualActivation.subjectType);

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

      <form onSubmit={handleManualActivation} className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Admin-confirmed subscription activation
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use this when Nigeria payment is confirmed by bank transfer, POS, cash, invoice, or operations review.
            </p>
          </div>
          {manualNotice ? <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{manualNotice}</span> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={manualActivation.subjectType}
            onChange={(e) => setManualActivation({
              ...manualActivation,
              subjectType: e.target.value,
              planKey: '',
              userId: e.target.value === 'provider' ? manualActivation.userId : '',
              organizationId: e.target.value === 'organization' ? manualActivation.organizationId : '',
            })}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="provider">Provider subscription</option>
            <option value="organization">Organisation bulk subscription</option>
          </select>

          {manualActivation.subjectType === 'provider' ? (
            <input
              value={manualActivation.userId}
              onChange={(e) => setManualActivation({ ...manualActivation, userId: e.target.value })}
              placeholder="Provider user ID"
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          ) : (
            <input
              value={manualActivation.organizationId}
              onChange={(e) => setManualActivation({ ...manualActivation, organizationId: e.target.value })}
              placeholder="Organisation ID"
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          )}

          <select
            value={manualActivation.planKey}
            onChange={(e) => {
              const selected = plans.find((plan) => plan.plan_key === e.target.value);
              setManualActivation({
                ...manualActivation,
                planKey: e.target.value,
                amountNgn: selected?.price_monthly ? String(selected.price_monthly) : manualActivation.amountNgn,
              });
            }}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Select plan</option>
            {eligibleManualPlans.map((plan) => (
              <option key={plan.plan_key} value={plan.plan_key}>{plan.name}</option>
            ))}
          </select>

          <input
            value={manualActivation.amountNgn}
            onChange={(e) => setManualActivation({ ...manualActivation, amountNgn: e.target.value })}
            placeholder="Amount confirmed, ₦"
            inputMode="decimal"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <select
            value={manualActivation.paymentMethod}
            onChange={(e) => setManualActivation({ ...manualActivation, paymentMethod: e.target.value })}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="bank_transfer">Bank transfer</option>
            <option value="pos">POS</option>
            <option value="cash">Cash</option>
            <option value="manual_invoice">Manual invoice</option>
          </select>
          <input
            value={manualActivation.paymentReference}
            onChange={(e) => setManualActivation({ ...manualActivation, paymentReference: e.target.value })}
            placeholder="Payment reference"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <input
            type="date"
            value={manualActivation.periodEnd}
            onChange={(e) => setManualActivation({ ...manualActivation, periodEnd: e.target.value })}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          />
          <input
            value={manualActivation.notes}
            onChange={(e) => setManualActivation({ ...manualActivation, notes: e.target.value })}
            placeholder="Admin notes"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground md:col-span-2"
          />
          <Button type="submit" className="h-10 bg-emerald-600 text-white hover:bg-emerald-500">
            Activate Subscription
          </Button>
        </div>
      </form>

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
                    <span className="text-xs font-bold text-foreground capitalize">{s.subscriber_org_id ? 'organisation' : 'user'}</span>
                    <span className="text-xs text-muted-foreground">#{s.subscriber_org_id || s.subscriber_user_id}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(s.status)}`}>{s.status?.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Plan: <strong className="text-foreground">{planLabel(s.plan_id)}</strong> • {s.billing_cycle || 'monthly'}</p>
                  <p className="text-xs text-muted-foreground">
                    Started: {s.started_at ? new Date(s.started_at).toLocaleDateString('en-NG') : '—'} •
                    Expires: {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString('en-NG') : '—'}
                  </p>
                  {s.amount_per_period && <p className="text-xs font-medium text-foreground">{formatNaira(s.amount_per_period)}/mo</p>}
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
