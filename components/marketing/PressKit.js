'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function PressKit({ label, text }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('Copied. Ready to paste.');
    } catch {
      setStatus('Copy is unavailable in this browser. Select the description above and copy it manually.');
    }
  }
  return <article className="rounded-2xl border border-border p-6">
    <h3 className="text-xl font-semibold">{label}</h3>
    <p className="mt-4 select-text leading-8">{text}</p>
    <button type="button" onClick={copy} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-current px-4 py-2 font-semibold">
      {status.startsWith('Copied') ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}Copy {label.toLowerCase()}
    </button>
    <p role="status" className="mt-3 min-h-6 text-sm text-muted-foreground">{status}</p>
  </article>;
}
