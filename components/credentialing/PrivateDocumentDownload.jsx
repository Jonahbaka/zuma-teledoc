'use client';
import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

export default function PrivateDocumentDownload({ documentId }) {
  const [state, setState] = useState('');
  const active = useRef(null);
  useEffect(() => {
    setState('');
    return () => { active.current?.abort(); active.current = null; };
  }, [documentId]);
  async function download() {
    if (active.current) return;
    const request = new AbortController(); active.current = request; setState('Downloading…');
    try {
      const result = await api.get(`/credentialing/documents/${encodeURIComponent(documentId)}/content`, { responseType: 'blob', signal: request.signal });
      if (active.current !== request || request.signal.aborted) return;
      const url = URL.createObjectURL(result.data), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'credential-document'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setState('Download ready.');
    } catch { if (active.current === request) setState('Document unavailable. Refresh and try again.'); }
    finally { if (active.current === request) active.current = null; }
  }
  return <div><button className="rounded border px-3 py-2" type="button" onClick={download} disabled={state === 'Downloading…'}>Download document</button><span role="status" className="block text-sm">{state}</span></div>;
}
