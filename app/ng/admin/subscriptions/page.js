'use client';

import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ActionNotice, AdminPageHeader, ResourceState, StatusBadge, useAdminAction, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { countValue, formatCount, formatDate, formatMoney, numericValue, requireRows, requireSuccess } from '@/lib/ng/adminWorkspaceData';

const initialForm = { subjectType: 'provider', userId: '', organizationId: '', planKey: '', amountNgn: '', paymentMethod: 'bank_transfer', paymentReference: '', periodEnd: '', notes: '' };
const statuses = ['all', 'active', 'trial', 'pending', 'past_due', 'expired', 'canceled', 'failed_payment'];

export default function AdminSubscriptions() {
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(initialForm);
  const activationAttempt = useRef(null);
  const [cancelId, setCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const subscriptions = useAdminResource('/ng/subscriptions', { limit: 100, ...(status === 'all' ? {} : { status }) }, data => ({ rows: requireRows(data, 'subscriptions'), total: data.total, active: data.active }));
  const plans = useAdminResource('/ng/subscriptions/plans', {}, data => requireRows(data, 'plans'));
  const providers = useAdminResource('/ng/providers', { limit: 100, status: 'verified' }, data => requireRows(data, 'providers'));
  const organizations = useAdminResource('/ng/organizations', { limit: 100, status: 'active' }, data => requireRows(data, 'organizations'));
  const action = useAdminAction(subscriptions.key);
  useEffect(() => { setSearch(''); setCancelId(null); setCancelReason(''); }, [subscriptions.key]);
  useEffect(() => { setForm(initialForm); activationAttempt.current = null; }, [providers.key, organizations.key]);
  const eligiblePlans = plans.data?.filter(plan => plan.target_role === form.subjectType) || [];
  const selectedSubjects = form.subjectType === 'provider' ? providers : organizations;
  const rows = subscriptions.data?.rows || [];
  const visible = rows.filter(row => [row.user_email, row.subscriber_user_id, row.subscriber_org_id, row.plan_key, row.plan_name].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const activate = async event => {
    event.preventDefault();
    const snapshot = { ...form };
    const amount = numericValue(snapshot.amountNgn);
    if (amount === null || !snapshot.planKey || !snapshot.paymentReference.trim() || !snapshot.periodEnd) return;
    const payload = { ...snapshot, userId: snapshot.subjectType === 'provider' ? snapshot.userId : null, organizationId: snapshot.subjectType === 'organization' ? snapshot.organizationId : null, amountNgn: amount, paymentReference: snapshot.paymentReference.trim() };
    const content = JSON.stringify(payload);
    if (activationAttempt.current?.content !== content) activationAttempt.current = { content, key: crypto.randomUUID() };
    const idempotencyKey = activationAttempt.current.key;
    const saved = await action.run('activation', async isCurrent => {
      const { data } = await api.post('/ng/subscriptions/admin/manual-activation', { ...payload, idempotencyKey });
      if (!data?.subscription?.id || data.subscription.status !== 'active') throw new Error('The server did not confirm subscription activation.');
      if (!isCurrent()) return { message: 'Subscription activation recorded.' };
      const refreshed = await subscriptions.refresh();
      if (!refreshed.ok) throw new Error('Subscription activation was recorded. The latest list could not be loaded; refresh to review it.');
      return { message: 'Subscription activated and payment confirmation recorded.' };
    });
    if (saved) { setForm(initialForm); activationAttempt.current = null; }
  };

  const cancel = async event => {
    event.preventDefault();
    const id = cancelId;
    if (!id || !cancelReason.trim()) return;
    const saved = await action.run(id, async isCurrent => {
      const { data } = await api.post('/ng/subscriptions/admin/' + id + '/cancel', { reason: cancelReason.trim() });
      requireSuccess(data);
      if (data.subscription?.id !== id || data.subscription?.status !== 'canceled') throw new Error('Cancellation was not confirmed in the subscription records. Refresh the account before retrying.');
      if (!isCurrent()) return { message: 'Subscription cancelled.' };
      const refreshed = await subscriptions.refresh();
      if (!refreshed.ok) throw new Error('Cancellation was confirmed. The current list could not be loaded; refresh to review it.');
      return { message: 'Subscription cancellation confirmed.' };
    });
    if (saved) setCancelId(null);
  };

  return <div className="space-y-6">
    <AdminPageHeader title="Subscription management" description="Review subscription records, record an already confirmed manual payment, and manage ongoing access." resource={subscriptions} />
    <ActionNotice action={action} />
    <div className="grid gap-4 sm:grid-cols-3">{[['Matching subscriptions', subscriptions.loading || subscriptions.error ? '—' : formatCount(subscriptions.data?.total)], ['Active in this status filter', subscriptions.loading || subscriptions.error ? '—' : formatCount(subscriptions.data?.active)], ['Loaded records', subscriptions.loading || subscriptions.error ? '—' : formatCount(rows.length)]].map(([label, value]) => <Card key={label}><CardContent className="p-6"><p className="text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Record confirmed payment and activate access</CardTitle><CardDescription>Use a payment reference your operations team has already confirmed. This records the supplied confirmation and activates the selected monthly plan.</CardDescription></CardHeader><CardContent>
      <ResourceState resource={plans} empty={plans.data?.length === 0} emptyMessage="No active subscription plans are available."><form onSubmit={activate} className="space-y-5"><fieldset disabled={action.pending} className="grid gap-5 md:grid-cols-2">
        <label className="font-medium text-slate-800">Account type<select value={form.subjectType} onChange={event => setForm(current => ({ ...current, subjectType: event.target.value, userId: '', organizationId: '', planKey: '', amountNgn: '' }))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4"><option value="provider">Provider</option><option value="organization">Organization</option></select></label>
        <ResourceState resource={selectedSubjects} empty={selectedSubjects.data?.length === 0} emptyMessage="No approved accounts are available for this account type."><label className="font-medium text-slate-800">{form.subjectType === 'provider' ? 'Verified provider' : 'Active organization'}<select required value={form.subjectType === 'provider' ? form.userId : form.organizationId} onChange={event => update(form.subjectType === 'provider' ? 'userId' : 'organizationId', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4"><option value="">Select an account</option>{selectedSubjects.data?.map(subject => <option key={subject.id} value={form.subjectType === 'provider' ? subject.user_id : subject.id}>{subject.full_name || subject.name || 'Name not recorded'}{subject.user_email ? ' · ' + subject.user_email : ''}</option>)}</select></label></ResourceState>
        <label className="font-medium text-slate-800">Monthly plan<select required value={form.planKey} onChange={event => { const plan = eligiblePlans.find(item => item.plan_key === event.target.value); setForm(current => ({ ...current, planKey: event.target.value, amountNgn: numericValue(plan?.price_monthly) === null ? '' : String(plan.price_monthly) })); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4"><option value="">Select a plan</option>{eligiblePlans.map(plan => <option key={plan.plan_key} value={plan.plan_key}>{plan.name}</option>)}</select></label>
        <label className="font-medium text-slate-800">Confirmed payment amount (NGN)<input required type="number" min="0" step="0.01" value={form.amountNgn} onChange={event => update('amountNgn', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" /></label>
        <label className="font-medium text-slate-800">Payment method<select value={form.paymentMethod} onChange={event => update('paymentMethod', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4"><option value="bank_transfer">Bank transfer</option><option value="pos">Point of sale</option><option value="cash">Cash</option><option value="manual_invoice">Manual invoice</option></select></label>
        <label className="font-medium text-slate-800">Confirmed payment reference<input required maxLength={200} value={form.paymentReference} onChange={event => update('paymentReference', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" /></label>
        <label className="font-medium text-slate-800">Access period end<input required type="date" value={form.periodEnd} onChange={event => update('periodEnd', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" /></label>
        <label className="font-medium text-slate-800">Confirmation notes<textarea maxLength={2000} value={form.notes} onChange={event => update('notes', event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-4" /></label>
      </fieldset><Button type="submit" disabled={action.pending || selectedSubjects.loading || Boolean(selectedSubjects.error) || !selectedSubjects.data?.length || !eligiblePlans.length} className="bg-blue-700 hover:bg-blue-800">{action.pending ? 'Recording activation…' : 'Activate confirmed subscription'}</Button></form></ResourceState>
    </CardContent></Card>
    <div className="flex flex-wrap gap-2" aria-label="Subscription status filters">{statuses.map(value => <Button key={value} variant={status === value ? 'default' : 'outline'} aria-pressed={status === value} onClick={() => setStatus(value)} className={status === value ? 'bg-blue-700 hover:bg-blue-800' : ''}>{value === 'all' ? 'All statuses' : value.replace(/_/g, ' ')}</Button>)}</div>
    <label className="block max-w-xl font-medium text-slate-800">Search loaded subscriptions<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Account, email, or plan" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal" /></label>
    <Card><CardHeader><CardTitle>Subscription records</CardTitle><CardDescription>Up to 100 records in the selected status filter</CardDescription></CardHeader><CardContent><ResourceState resource={subscriptions} empty={visible.length === 0} emptyMessage={search.trim() ? 'No loaded subscriptions match your search.' : 'No subscriptions match this status.'}><div className="space-y-4">{visible.map(row => <article key={row.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">{row.plan_name || row.plan_key || 'Plan name unavailable'}</h2><p className="mt-2 break-words text-slate-600">{row.user_email || (row.subscriber_org_id ? 'Organization account' : 'Account email unavailable')}</p></div><StatusBadge status={row.status} /></div><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-slate-600">Period charge</dt><dd className="mt-2 font-medium text-slate-950">{formatMoney(row.amount_per_period)} · {row.billing_cycle || 'Cycle unavailable'}</dd></div><div><dt className="text-slate-600">Access period end</dt><dd className="mt-2 font-medium text-slate-950">{formatDate(row.current_period_end)}</dd></div></dl>{['active', 'trial', 'past_due'].includes(row.status) && <Button disabled={action.pending} onClick={() => { setCancelId(row.id); setCancelReason(''); }} variant="outline" className="mt-5">Review cancellation</Button>}</article>)}</div></ResourceState></CardContent></Card>
    <Dialog open={Boolean(cancelId)} onOpenChange={open => { if (!open && !action.pending) setCancelId(null); }}><DialogContent className="rounded-2xl bg-white text-slate-950"><DialogHeader><DialogTitle>Cancel subscription</DialogTitle><DialogDescription>Cancellation stops platform access immediately for this subscription. Review the financial records before proceeding.</DialogDescription></DialogHeader><form onSubmit={cancel} className="space-y-5"><label className="block font-medium">Cancellation reason<textarea required maxLength={1000} value={cancelReason} disabled={action.pending} onChange={event => setCancelReason(event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-4 font-normal" /></label><ActionNotice action={action} /><div className="flex flex-wrap gap-3"><Button type="submit" disabled={action.pending} className="min-h-12 bg-blue-700 hover:bg-blue-800">{action.pending ? 'Confirming cancellation…' : 'Confirm cancellation'}</Button><Button type="button" onClick={() => setCancelId(null)} disabled={action.pending} variant="outline" className="min-h-12">Keep subscription</Button></div></form></DialogContent></Dialog>
  </div>;
}
