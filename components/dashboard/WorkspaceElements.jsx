import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';

export function WorkspaceDate({ value, fallback = 'Date not recorded' }) {
  const valid = value && Number.isFinite(new Date(value).getTime());
  return valid ? <time dateTime={new Date(value).toISOString()}>{formatDateTime(value)}</time> : <span>{fallback}</span>;
}

export function WorkspaceHeader({ eyebrow, title, description, children, loading, onRefresh, updatedAt }) {
  return <header className="space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 max-w-2xl"><p className="text-sm font-semibold uppercase tracking-widest text-teal-800">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1></div>
      <Button variant="outline" disabled={loading} onClick={onRefresh} aria-label="Refresh" className="min-h-12 shrink-0 rounded-xl bg-white px-3 sm:px-4"><RefreshCw className="h-4 w-4 sm:mr-2" aria-hidden="true" /><span className="hidden sm:inline">Refresh</span></Button>
    </div>
    <p className="max-w-2xl leading-7 text-slate-600">{description}</p>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-3">{children}</div><p className="text-sm text-slate-600" role="status">{loading ? 'Updating your workspace…' : updatedAt ? <>Last checked <WorkspaceDate value={updatedAt} /></> : 'Waiting for your account'}</p></div>
  </header>;
}

export function WorkspaceLink({ href, children, primary = false, className = '' }) {
  return <Link href={href} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 py-3 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 ${primary ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'} ${className}`}>{children}</Link>;
}

export function WorkspaceAction({ href, icon: Icon, title, children, compact = false }) {
  return <Link href={href} className="group rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-teal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
    <div className="flex items-center justify-between gap-3"><span className="rounded-xl bg-teal-50 p-3 text-teal-800"><Icon className="h-5 w-5" aria-hidden="true" /></span><ArrowRight className="h-5 w-5 shrink-0 text-slate-500 group-hover:text-teal-800" aria-hidden="true" /></div><h2 className="mt-4 font-semibold text-slate-950">{title}</h2><p className={`mt-2 text-sm leading-6 text-slate-600 ${compact ? 'hidden sm:block' : ''}`}>{children}</p>
  </Link>;
}

export function WorkspaceStatus({ children }) {
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium capitalize text-slate-700">{String(children || 'Status unavailable').replaceAll('_', ' ')}</span>;
}

export function WorkspaceSection({ title, description, action, children }) {
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-950">{title}</h2>{description && <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>}</div>{action}</div>{children}</section>;
}

export function WorkspaceState({ loading, error, onRetry, empty }) {
  if (loading) return <p role="status" className="rounded-xl bg-slate-50 p-5 leading-7 text-slate-600">Loading your care information…</p>;
  if (error) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><p role="alert" className="text-amber-950">This information could not be loaded.</p><Button variant="outline" className="mt-3 bg-white" onClick={onRetry}>Try again</Button></div>;
  return <p className="rounded-xl bg-slate-50 p-5 leading-7 text-slate-600">{empty}</p>;
}
