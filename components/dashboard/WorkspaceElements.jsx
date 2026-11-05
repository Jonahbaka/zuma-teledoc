import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';

export function WorkspaceDate({ value, fallback = 'Date not recorded' }) {
  const valid = value && Number.isFinite(new Date(value).getTime());
  return valid ? <time dateTime={new Date(value).toISOString()}>{formatDateTime(value)}</time> : <span>{fallback}</span>;
}

export function WorkspaceHeader({ eyebrow, title, description, children, loading, onRefresh, updatedAt }) {
  return <header className="workspace-heading">
    <div className="workspace-heading-row"><div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="workspace-intro">{description}</p></div>
      <Button variant="outline" disabled={loading} onClick={onRefresh} aria-label="Refresh" className="workspace-refresh"><RefreshCw className="h-5 w-5" aria-hidden="true" /><span className="hidden sm:inline">Refresh</span></Button>
    </div>
    <div className="workspace-toolbar"><div className="flex flex-wrap gap-3">{children}</div><p className="workspace-freshness" role="status">{loading ? 'Updating your workspace…' : updatedAt ? <>Last checked <WorkspaceDate value={updatedAt} /></> : 'Waiting for your account'}</p></div>
  </header>;
}

export function WorkspaceLink({ href, children, primary = false, className = '' }) {
  return <Link href={href} className={'workspace-button ' + (primary ? 'workspace-button-primary ' : 'workspace-button-secondary ') + className}>{children}</Link>;
}

export function WorkspaceAction({ href, icon: Icon, title, children, compact = false, tone = 'violet' }) {
  return <Link href={href} className={'workspace-action workspace-tone-' + tone}>
    <div className="flex items-center justify-between gap-3"><span className="workspace-action-icon"><Icon className="h-6 w-6" aria-hidden="true" /></span><ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" /></div><h2>{title}</h2><p className={compact ? 'hidden sm:block' : ''}>{children}</p>
  </Link>;
}

export function WorkspaceMetric({ title, value, detail, icon: Icon, tone = 'blue' }) {
  return <section className={'workspace-metric workspace-tone-' + tone}><div className="workspace-metric-top"><h2>{title}</h2><Icon className="h-6 w-6 shrink-0" aria-hidden="true" /></div><p className={'workspace-metric-value' + (typeof value === 'number' ? '' : ' workspace-metric-message')}>{value}</p><p className="workspace-metric-detail">{detail}</p></section>;
}

export function WorkspaceStatus({ children }) {
  const value = String(children || 'Status unavailable').replaceAll('_', ' ');
  const tone = /unsigned|scheduled|pending/i.test(value) ? 'amber' : /cancel|no show/i.test(value) ? 'rose' : /signed|confirmed|completed/i.test(value) ? 'blue' : /progress/i.test(value) ? 'violet' : 'slate';
  return <span className={'workspace-status workspace-tone-' + tone}><span aria-hidden="true" />{value}</span>;
}

export function WorkspaceSection({ title, description, action, children, tone = 'violet' }) {
  return <section className={'workspace-section workspace-tone-' + tone}><div className="workspace-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}

export function WorkspaceState({ loading, error, onRetry, empty }) {
  if (loading) return <p role="status" className="workspace-empty">Loading your care information…</p>;
  if (error) return <div className="workspace-error"><p role="alert">This information could not be loaded.</p><Button variant="outline" className="mt-3 bg-white" onClick={onRetry}>Try again</Button></div>;
  return <p className="workspace-empty">{empty}</p>;
}
