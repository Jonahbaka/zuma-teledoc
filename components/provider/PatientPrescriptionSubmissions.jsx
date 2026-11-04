'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/utils';

export default function PatientPrescriptionSubmissions({ patientId }) {
  const [rows, setRows] = useState({ patientId: null, revision: null, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [viewing, setViewing] = useState(false);
  const documentRequest = useRef(0);
  const currentContext = useRef({ patientId, revision });
  currentContext.current = { patientId, revision };
  useEffect(() => {
    let cancelled = false;
    documentRequest.current += 1;
    setLoading(true); setError(''); setRows({ patientId, revision, items: [] }); setSelected(null); setViewing(false);
    api.get(`/clinical-encounters/patient/${patientId}/prescription-submissions`).then(({ data }) => {
      if (!data.success || !Array.isArray(data.submissions)) throw new Error();
      if (!cancelled) setRows({ patientId, revision, items: data.submissions });
    }).catch(() => { if (!cancelled) setError('Patient submissions could not be loaded.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; documentRequest.current += 1; };
  }, [patientId, revision]);
  async function open(id) {
    const requestId = ++documentRequest.current;
    const isCurrent = () => requestId === documentRequest.current
      && currentContext.current.patientId === patientId
      && currentContext.current.revision === revision;
    setViewing(true); setError(''); setSelected(null);
    try {
      const { data } = await api.get(`/clinical-encounters/patient/${patientId}/prescription-submissions/${id}`);
      if (!isCurrent()) return;
      if (!data.success || !data.submission) throw new Error();
      setSelected({ patientId, revision, submission: data.submission });
    } catch { if (isCurrent()) setError('This submission could not be opened.'); }
    finally { if (isCurrent()) setViewing(false); }
  }
  const visibleRows = rows.patientId === patientId && rows.revision === revision ? rows.items : [];
  const visibleSelected = selected?.patientId === patientId && selected.revision === revision ? selected.submission : null;
  return <section className="portal-surface"><h2 className="text-xl font-semibold">Patient prescription submissions</h2><p className="mt-2 text-slate-600">Review the original instructions and confirm their authenticity before prescribing or pharmacy routing.</p>
    {error && <div className="portal-error mt-4"><p role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div>}
    {loading ? <p role="status" className="mt-4">Loading submissions…</p> : !error && !visibleRows.length ? <p className="mt-4 text-slate-600">No patient submissions are available.</p> : <ul className="mt-4 divide-y divide-slate-200">{visibleRows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{row.has_image ? 'Prescription image' : 'Prescription text'}</p><p className="mt-2 text-slate-600">{formatDateTime(row.created_at)} · {row.status === 'uploaded' ? 'Awaiting review' : row.status}</p></div><Button variant="outline" onClick={() => open(row.id)} disabled={viewing}>View submission</Button></li>)}</ul>}
    <Dialog open={Boolean(visibleSelected)} onOpenChange={(open) => { if (!open) { documentRequest.current += 1; setSelected(null); setViewing(false); } }}><DialogContent className="max-h-[90vh] overflow-y-auto text-base sm:max-w-3xl"><DialogHeader><DialogTitle>Patient-submitted prescription</DialogTitle><DialogDescription>This document has not been verified by opening it. Use the normal clinical review and prescribing workflow.</DialogDescription></DialogHeader>{visibleSelected?.imageBase64 && <Image src={`data:image/png;base64,${visibleSelected.imageBase64}`} width={1400} height={1800} unoptimized alt="Patient-submitted prescription" className="h-auto w-full" />}{visibleSelected?.text && <p className="whitespace-pre-wrap text-base leading-7">{visibleSelected.text}</p>}</DialogContent></Dialog>
  </section>;
}
