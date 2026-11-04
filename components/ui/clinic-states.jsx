'use client';

/**
 * components/ui/clinic-states.jsx
 *
 * Shared clinical UI states, built for primary-care conditions: unreliable
 * connectivity, small tablets, bright sunlight, and staff who need to see state
 * at a glance.
 *
 * Rules these components enforce:
 *   - Status is never communicated by colour alone: every status carries an icon
 *     and a text label.
 *   - Loading placeholders reserve the space the real content will occupy, so
 *     the layout does not jump when data arrives.
 *   - Every state offers a next action, including a "no data" state.
 *   - Touch targets are at least 44px and focus is always visible.
 */

import { AlertTriangle, CheckCircle2, CloudOff, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';

/* ------------------------------------------------------------------ Skeleton */

/** Loading placeholder. `lines` reserves vertical space up front. */
export function Skeleton({ className = '', lines = 0, label = 'Loading' }) {
  if (lines > 0) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={`h-3 animate-pulse rounded bg-slate-200 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200 ${className}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Card placeholder that matches the height of a real record card. */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`} role="status" aria-busy="true">
      <span className="sr-only">Loading record</span>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton lines={3} label="Loading record details" />
    </div>
  );
}

/* --------------------------------------------------------------- Empty state */

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  tone = 'neutral',
  className = '',
}) {
  const toneClasses = {
    neutral: 'bg-slate-50 text-slate-700',
    success: 'bg-emerald-50 text-emerald-800',
    warning: 'bg-amber-50 text-amber-900',
  };
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center ${toneClasses[tone] || toneClasses.neutral} ${className}`}
    >
      <Icon className="mb-3 h-8 w-8 opacity-70" aria-hidden="true" />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-6 opacity-90">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Error state */

export function ErrorState({
  title = 'Something went wrong',
  description = 'The information could not be loaded. Your work is not lost.',
  onRetry,
  retryLabel = 'Try again',
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-6 py-8 text-center text-rose-900 ${className}`}
      role="alert"
    >
      <AlertTriangle className="mb-3 h-7 w-7" aria-hidden="true" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-900 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}


/* ---------------------------------------------------------------- Status pill */

const STATUS_TONES = {
  active: { classes: 'bg-emerald-100 text-emerald-900 border-emerald-300', icon: CheckCircle2 },
  connected: { classes: 'bg-emerald-100 text-emerald-900 border-emerald-300', icon: CheckCircle2 },
  signed: { classes: 'bg-emerald-100 text-emerald-900 border-emerald-300', icon: CheckCircle2 },
  completed: { classes: 'bg-emerald-100 text-emerald-900 border-emerald-300', icon: CheckCircle2 },
  draft: { classes: 'bg-slate-100 text-slate-800 border-slate-300', icon: Inbox },
  queued: { classes: 'bg-slate-100 text-slate-800 border-slate-300', icon: Inbox },
  waiting: { classes: 'bg-slate-100 text-slate-800 border-slate-300', icon: Inbox },
  pending: { classes: 'bg-amber-100 text-amber-900 border-amber-300', icon: AlertTriangle },
  degraded: { classes: 'bg-amber-100 text-amber-900 border-amber-300', icon: AlertTriangle },
  urgent: { classes: 'bg-amber-100 text-amber-900 border-amber-300', icon: AlertTriangle },
  emergency: { classes: 'bg-rose-200 text-rose-950 border-rose-400', icon: AlertTriangle },
  offline: { classes: 'bg-rose-200 text-rose-950 border-rose-400', icon: WifiOff },
  failed: { classes: 'bg-rose-200 text-rose-950 border-rose-400', icon: AlertTriangle },
  cancelled: { classes: 'bg-slate-100 text-slate-700 border-slate-300 line-through', icon: Inbox },
  resolved: { classes: 'bg-sky-100 text-sky-900 border-sky-300', icon: CheckCircle2 },
  amended: { classes: 'bg-sky-100 text-sky-900 border-sky-300', icon: AlertTriangle },
};

/**
 * Clinical status indicator. Colour is never the only signal: every pill shows an
 * icon and a readable label, which keeps it usable in bright sunlight and for
 * colour-blind users.
 */
export function StatusPill({ status, label, size = 'sm', className = '' }) {
  const key = String(status || '').toLowerCase();
  const tone = STATUS_TONES[key] || { classes: 'bg-slate-100 text-slate-800 border-slate-300', icon: Inbox };
  const Icon = tone.icon;
  const sizing = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${tone.classes} ${sizing} ${className}`}
      data-status={key || 'unknown'}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label || key || 'Unknown'}
    </span>
  );
}


/* -------------------------------------------------------- Connectivity banner */

/**
 * Persistent connectivity state. At PHCs where power and network drop without
 * warning, staff are told whether their work is saved locally and whether it has
 * reached the server.
 */
export function ConnectivityBanner({
  state = 'online',
  pendingChanges = 0,
  lastSyncedAt = null,
  className = '',
}) {
  if (state === 'online' && pendingChanges === 0) return null;

  const offline = state === 'offline';
  const content = offline
    ? {
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        Icon: WifiOff,
        title: 'You are offline',
        body: pendingChanges > 0
          ? `${pendingChanges} record${pendingChanges === 1 ? '' : 's'} saved on this device. They will sync when the connection returns.`
          : 'Records you create now are saved on this device and will sync automatically.',
      }
    : {
        classes: 'border-sky-300 bg-sky-50 text-sky-950',
        Icon: CloudOff,
        title: 'Syncing',
        body: `${pendingChanges} record${pendingChanges === 1 ? '' : 's'} waiting to reach the server.`,
      };

  const { classes, Icon, title, body } = content;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${classes} ${className}`}
      role="status"
      aria-live="polite"
      data-connectivity={state}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm leading-5 opacity-90">{body}</p>
        {lastSyncedAt && (
          <p className="mt-1 text-xs opacity-75">Last synced {new Date(lastSyncedAt).toLocaleString()}</p>
        )}
      </div>
      {!offline && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-label="Syncing" />}
    </div>
  );
}

export const _test = { STATUS_TONES };
