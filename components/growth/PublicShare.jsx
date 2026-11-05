'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { getPublicShare } from '@/lib/growth/public-share.cjs';

const controlClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';

export default function PublicShare({ destination, heading = 'Know a team this could help?' }) {
  const share = getPublicShare(destination);
  const id = useId();
  const input = useRef(null);
  const [status, setStatus] = useState('');
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNativeAvailable(typeof navigator.share === 'function'); }, []);
  if (!share) return null;

  const manualCopy = () => {
    input.current?.focus();
    input.current?.select();
    setStatus('Automatic sharing is unavailable. Copy the selected public link to share it.');
  };
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) { manualCopy(); return; }
      await navigator.clipboard.writeText(share.url);
      setStatus('Public link copied. Paste it wherever you want to share.');
    } catch { manualCopy(); }
  };
  const nativeShare = async () => {
    setBusy(true);
    try {
      await navigator.share({ title: share.title, text: share.text, url: share.url });
      setStatus('Public link handed to your selected sharing app.');
    } catch (error) {
      if (error?.name === 'AbortError') setStatus('Sharing cancelled. You can still copy the public link.');
      else manualCopy();
    } finally { setBusy(false); }
  };

  return <section lang="en" dir="ltr" aria-labelledby={id + '-heading'} className="rounded-2xl border border-border bg-muted/40 p-6 md:p-8">
    <h2 id={id + '-heading'} className="text-2xl font-semibold">{heading}</h2>
    <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Share this public introduction with a colleague. Only the public page link is shared; account and patient information are never included.</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <a className={controlClass} href={share.whatsapp} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp<span className="sr-only"> (opens a new tab)</span></a>
      <a className={controlClass} href={share.linkedin} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">LinkedIn<span className="sr-only"> (opens a new tab)</span></a>
      <button className={controlClass} onClick={copy} type="button"><Copy aria-hidden="true" size={16} />Copy link</button>
      {nativeAvailable && <button className={controlClass} onClick={nativeShare} disabled={busy} type="button"><Share2 aria-hidden="true" size={16} />{busy ? 'Opening share options…' : 'More share options'}</button>}
    </div>
    <label htmlFor={id + '-link'} className="mt-5 block text-sm font-medium">Public link</label>
    <input ref={input} id={id + '-link'} readOnly value={share.url} onFocus={event => event.target.select()} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
    <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 min-h-6 text-sm">{status}</p>
  </section>;
}
