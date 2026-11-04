'use client';
import { useEffect, useRef, useState } from 'react';
import { providerAPI } from '@/lib/api';

export default function PrivateDocumentUpload({ ownerId, onSaved }) {
  const [type, setType] = useState('medical_license');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const input = useRef(null);
  useEffect(() => {
    generation.current++;
    setFile(null); setMessage(''); setBusy(false);
    if (input.current) input.current.value = '';
    return () => { generation.current++; };
  }, [ownerId]);
  async function submit(event) {
    event.preventDefault();
    if (!file || pending.current || !ownerId) return;
    if (file.size > 10 * 1024 * 1024) { setMessage('Choose a document up to 10 MB.'); return; }
    const current = generation.current;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const data = new FormData(); data.append('document', file); data.append('documentType', type);
      const response = await providerAPI.uploadDocument(data);
      if (current !== generation.current) return;
      if (!response.data?.success || !response.data.document?.id) throw new Error('Upload not confirmed');
      setFile(null); if (input.current) input.current.value = '';
      setMessage('Document saved privately for credential review.');
      onSaved(response.data.document);
    } catch {
      if (current === generation.current) setMessage('The upload could not be confirmed. Refresh your document list before retrying.');
    } finally { pending.current = false; if (current === generation.current) setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3">
    <label className="block">Document type
      <select value={type} onChange={event => setType(event.target.value)} disabled={busy} className="block rounded border bg-background p-2">
        {['medical_license','dea_certificate','npi_certificate','board_certification','medical_degree','cv_resume','malpractice_insurance','photo_id','proof_of_address','other'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
    <label className="block">PDF, JPEG or PNG, up to 10 MB
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} className="block" />
    </label>
    <button className="rounded border px-4 py-2" disabled={busy || !file} type="submit">{busy ? 'Saving document…' : 'Upload private document'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
