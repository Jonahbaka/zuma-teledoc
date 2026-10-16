'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, Mail } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ActionNotice, AdminPageHeader, ResourceState, StatusBadge, useAdminAction, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { formatCount, formatDate, requireRows } from '@/lib/ng/adminWorkspaceData';

const categories = ['cold_outreach', 'follow_up', 'investor_pitch', 'partnership', 'provider_invite', 'nurse_invite', 'social_intro'];
const campaignTypes = ['cold_email', 'follow_up', 'newsletter', 'social_engage', 'investor_pitch', 'partnership'];
const blank = { name: '', category: 'provider_invite', campaignType: 'newsletter', subject: '', body: '' };
const field = 'mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-950';

export default function AdminCampaignsPage() {
  const [tab, setTab] = useState('campaigns');
  const [create, setCreate] = useState(null);
  const [form, setForm] = useState(blank);
  const campaigns = useAdminResource('/crm/campaigns', {}, data => requireRows(data, 'data'));
  const templates = useAdminResource('/crm/templates', {}, data => requireRows(data, 'data'));
  const resource = tab === 'campaigns' ? campaigns : templates;
  const action = useAdminAction(campaigns.key + templates.key);
  useEffect(() => { setCreate(null); setForm(blank); }, [campaigns.key, templates.key]);

  async function saveDraft(event) {
    event.preventDefault();
    const type = create;
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
    if (!values.name || !values.subject || !values.body) return;
    const saved = await action.run(type, async isCurrent => {
      const payload = type === 'campaign'
        ? { name: values.name, campaignType: values.campaignType, subjectLine: values.subject, emailTemplate: values.body }
        : { name: values.name, category: values.category, subject: values.subject, body: values.body };
      const { data } = await api.post(type === 'campaign' ? '/crm/campaigns' : '/crm/templates', payload);
      if (!data?.success || !data.data?.id || (type === 'campaign' && data.data.status !== 'draft')) throw new Error('The server did not confirm a saved draft. Refresh the records before retrying.');
      if (!isCurrent()) return { message: 'Draft saved.' };
      const refresh = await (type === 'campaign' ? campaigns : templates).refresh();
      if (!refresh.ok) throw new Error('The draft was saved. Refresh to load the latest records.');
      return { message: type === 'campaign' ? 'Campaign draft saved. No messages have been sent.' : 'Email template saved.' };
    });
    if (saved) { setCreate(null); setForm(blank); }
  }

  return <div className="clinical-readable space-y-6">
    <AdminPageHeader title="Email campaigns" description="Manage saved campaign drafts and message templates. Review the content and recipients before approving delivery." resource={resource}>
      <Button onClick={() => { setCreate(tab === 'campaigns' ? 'campaign' : 'template'); setForm(blank); }} className="bg-blue-700 hover:bg-blue-800">Create {tab === 'campaigns' ? 'campaign draft' : 'template'}</Button>
      <Link href="/admin/crm" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900">Relationship management <ArrowRight size={20} /></Link>
    </AdminPageHeader>
    <ActionNotice action={action} />
    {create && <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="text-2xl font-semibold text-slate-950">{create === 'campaign' ? 'New campaign draft' : 'New email template'}</h2><form onSubmit={saveDraft} className="mt-6 space-y-5"><fieldset disabled={action.pending} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2"><label className="block font-medium text-slate-800" htmlFor="campaign-name">Name<input id="campaign-name" required maxLength={255} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className={field} /></label><label className="block font-medium text-slate-800" htmlFor="campaign-category">{create === 'campaign' ? 'Campaign type' : 'Template category'}<select id="campaign-category" value={create === 'campaign' ? form.campaignType : form.category} onChange={event => setForm(current => ({ ...current, [create === 'campaign' ? 'campaignType' : 'category']: event.target.value }))} className={field}>{(create === 'campaign' ? campaignTypes : categories).map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label></div>
      <label htmlFor="campaign-subject" className="block font-medium text-slate-800">Subject<input id="campaign-subject" required maxLength={500} value={form.subject} onChange={event => setForm(current => ({ ...current, subject: event.target.value }))} className={field} /></label>
      <label htmlFor="campaign-body" className="block font-medium text-slate-800">Message body<textarea id="campaign-body" required maxLength={20000} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} className={field + ' min-h-64'} /></label>
      <p className="leading-7 text-slate-600">Use DoctaRx branding and verified service information. Saving a draft does not approve or send a campaign.</p>
    </fieldset><div className="flex flex-wrap gap-3"><Button disabled={action.pending} className="bg-blue-700 hover:bg-blue-800">{action.pending ? 'Saving draft…' : 'Save draft'}</Button><Button type="button" variant="outline" disabled={action.pending} onClick={() => setCreate(null)}>Cancel</Button></div></form></section>}
    <div className="flex gap-3" aria-label="Campaign workspace tabs">{[['campaigns', 'Campaigns', Mail], ['templates', 'Templates', FileText]].map(([value, label, Icon]) => <Button key={value} variant={tab === value ? 'default' : 'outline'} aria-pressed={tab === value} onClick={() => setTab(value)} className={tab === value ? 'bg-blue-700 hover:bg-blue-800' : ''}><Icon size={20} className="mr-2" />{label}</Button>)}</div>
    <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="mb-6 text-2xl font-semibold text-slate-950">{tab === 'campaigns' ? 'Saved campaigns' : 'Message templates'}</h2>
      <ResourceState resource={resource} empty={resource.data?.length === 0} emptyMessage={tab === 'campaigns' ? 'No saved campaigns.' : 'No saved email templates.'}>
        <div className="grid items-start gap-5 xl:grid-cols-2">{(resource.data || []).map(record => <article key={record.id} className="min-w-0 rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="break-words text-xl font-semibold text-slate-950">{record.name || 'Name unavailable'}</h3><StatusBadge status={tab === 'campaigns' ? record.status : record.category} /></div><p className="mt-4 break-words font-medium text-slate-800">{record.subject_line || record.subject || 'Subject unavailable'}</p><details className="mt-4"><summary className="min-h-12 cursor-pointer py-3 font-semibold text-blue-700">Read saved message</summary><p className="whitespace-pre-wrap break-words leading-7 text-slate-600">{record.email_template || record.body || 'Message body unavailable'}</p></details>{tab === 'campaigns' && <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5">{[['Sent messages', record.emails_sent], ['Recorded replies', record.emails_replied]].map(([label, value]) => <div key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-2 font-semibold text-slate-950">{formatCount(value)}</dd></div>)}</dl>}<p className="mt-5 text-slate-600">Created {formatDate(record.created_at)}</p></article>)}</div>
      </ResourceState>
    </section>
  </div>;
}

