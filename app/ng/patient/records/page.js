'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, FileText, Pill, RefreshCw } from 'lucide-react';
import api, { appointmentsAPI, medicalRecordsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/utils';

export default function NigeriaPatientRecordsPage() {
  const { user } = useAuth();
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [viewing, setViewing] = useState(false);
  const [viewError, setViewError] = useState('');
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setLoading(true); setSections({});
    const requests = [
      ['documents', () => medicalRecordsAPI.getByPatient(user.id), (data) => data.success ? data.records : null],
      ['visits', () => appointmentsAPI.getAll({ status: 'completed', limit: 20 }), (data) => data.success ? data.appointments : null],
      ['prescriptions', () => api.get('/ng/patient/prescriptions', { params: { limit: 20 } }), (data) => data],
    ];
    Promise.all(requests.map(async ([key, fetch, extract]) => {
      try { const { data } = await fetch(); const rows = extract(data); if (!Array.isArray(rows)) throw new Error('Unavailable'); return [key, { rows }]; }
      catch { return [key, { error: true }]; }
    })).then((results) => { if (!cancelled) { setSections(Object.fromEntries(results)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user?.id, revision]);
  async function openRecord(id) {
    setViewing(true); setViewError('');
    try { const { data } = await medicalRecordsAPI.getById(id); if (!data.success || !data.record) throw new Error(); setSelected(data.record); }
    catch { setViewError('This record could not be opened. Please try again.'); }
    finally { setViewing(false); }
  }
  const content = (key, empty, render) => loading ? <p role="status">Loading health records…</p> : sections[key]?.error ? <p role="alert" className="portal-error">This part of your health record could not be loaded. Select Refresh to try again.</p> : sections[key]?.rows?.length ? render(sections[key].rows) : <p className="portal-empty">{empty}</p>;
  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Your health information" title="Health records" description="Review your documents, completed visits, and prescription history.">
      <Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
    </PortalPageHeader>
    {viewError && <p role="alert" className="portal-error">{viewError}</p>}
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="portal-surface"><h2 className="mb-5 flex items-center gap-3 text-xl font-semibold"><FileText className="h-6 w-6 text-blue-800" aria-hidden="true" />Documents</h2>{content('documents', 'No documents have been added to this account.', (rows) => <ul className="divide-y divide-slate-200">{rows.map((row) => <li key={row.id} className="py-4"><h3 className="font-medium">{row.title || 'Health document'}</h3><p className="mt-2 text-slate-600">{row.recordType || 'Medical record'}</p><Button variant="outline" className="mt-3" disabled={viewing} onClick={() => openRecord(row.id)}>View record</Button></li>)}</ul>)}</section>
      <section className="portal-surface"><h2 className="mb-5 flex items-center gap-3 text-xl font-semibold"><Calendar className="h-6 w-6 text-blue-800" aria-hidden="true" />Completed visits</h2>{content('visits', 'Completed visits will appear here after your consultation.', (rows) => <ul className="divide-y divide-slate-200">{rows.map((row) => <li key={row.id} className="py-4"><h3 className="font-medium">{row.reasonForVisit || 'Consultation'}</h3><p className="mt-2 text-slate-600">{formatDateTime(row.scheduledAt)}</p><Link href={`/ng/patient/appointments/${row.id}`} className="mt-3 inline-flex min-h-12 items-center font-medium text-blue-800">Visit details</Link></li>)}</ul>)}</section>
      <section className="portal-surface xl:col-span-2"><h2 className="mb-5 flex items-center gap-3 text-xl font-semibold"><Pill className="h-6 w-6 text-blue-800" aria-hidden="true" />Prescription history</h2>{content('prescriptions', 'No prescriptions are listed for this account.', (rows) => <ul className="divide-y divide-slate-200">{rows.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-3 py-4"><div><p className="font-medium">{row.prescription_number || row.prescriber_name || 'Prescription'}</p><p className="mt-2 text-slate-600">{formatDateTime(row.created_at)}</p></div><p className="capitalize text-slate-600">{String(row.status || 'Status not recorded').replaceAll('_', ' ')}</p></li>)}</ul>)}<Link href="/ng/patient/prescriptions" className="mt-4 inline-flex min-h-12 items-center font-medium text-blue-800">View prescriptions</Link></section>
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto text-base sm:max-w-2xl"><DialogHeader><DialogTitle>{selected?.title || 'Health record'}</DialogTitle><DialogDescription>DoctaRx · Your medical document</DialogDescription></DialogHeader><p className="whitespace-pre-wrap break-words text-base leading-7">{selected?.content || 'No readable text is available for this record. Contact your care team for the original document.'}</p></DialogContent></Dialog>
  </div>;
}
