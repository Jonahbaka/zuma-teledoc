'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, FileText, Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';

const initial = { owner: null, generation: -1, loading: true, reports: [], error: '' };
const emptyDetail = { owner: null, generation: -1, loading: false, report: null, values: [], deliveries: [], error: '' };
const states = { queued: 'Scheduled', submitting: 'Submission in progress', reconciliation: 'Reconciliation needed', confirmed: 'Remote values confirmed', rejected: 'Rejected', failed: 'Operator review needed' };
const reportStates = {draft:'Draft',generated:'Awaiting review',approved:'Approved',sync_pending:'Delivery scheduled',synced:'Remote values confirmed',sync_failed:'Delivery needs review'};
function date(value) { const parsed = value && new Date(value); return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Not recorded'; }
function actionNotice(delivery, workerEnabled) {
  if (delivery?.status === 'confirmed') return 'The retained delivery is confirmed against remote DHIS2 values.';
  if (delivery?.status === 'queued') return workerEnabled === false
    ? 'The approved report is scheduled. Automatic delivery is disabled; your integration administrator must activate the worker.'
    : 'The approved report is scheduled for delivery. Remote acceptance has not been confirmed.';
  return 'A delivery record already exists. Review its retained evidence and use an operator command when appropriate.';
}
function reconciliationNotice(delivery) {
  if (delivery?.status === 'confirmed') return 'The retained delivery is confirmed against remote DHIS2 values. No additional check is scheduled by this reply.';
  if (delivery?.resolution?.code === 'closed_unresolved') return 'The retained delivery is closed. Review the recorded operator decision; no further check is scheduled.';
  if (delivery?.operatorRetryBudget === 1) return 'One reconciliation check is scheduled. It will read retained task evidence and remote values; it will not submit the report again.';
  return 'The retained reconciliation result has changed. Review the current delivery evidence before another command; this reply does not schedule another check.';
}

export default function DeliveryPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const owner = user?.id ? JSON.stringify([user.id, user.role, user.marketScope, user.ngRole || user.ng_role,
    user.authorizationVersion, user.permissions, user.jurisdictionRoles]) : null;
  const ready = Boolean(owner && !authLoading && isAuthenticated && user.marketScope === 'NG');
  const [resource, setResource] = useState(initial);
  const [detail, setDetail] = useState(emptyDetail);
  const [action, setAction] = useState({ owner: null, generation: -1, busy: false, error: '', notice: '' });
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState('');
  const mounted = useRef(false);
  const listing = useRef(null); const inspection = useRef(null); const command = useRef(null); const retry = useRef(null);
  const latestDetail = useRef(null);
  const context = useRef({ owner, ready, generation: 0 });
  if (context.current.owner !== owner || context.current.ready !== ready) context.current = { owner, ready, generation: context.current.generation + 1 };
  const generation = context.current.generation;
  const currentAccount = () => mounted.current && context.current.owner === owner && context.current.ready && context.current.generation === generation;
  const scoped = ready && resource.owner === owner && resource.generation === generation;
  const scopedDetail = ready && detail.owner === owner && detail.generation === generation;
  const active = ready && action.owner === owner && action.generation === generation ? action : { busy: false, error: '', notice: '' };
  const selected = scopedDetail ? detail.report : null;
  latestDetail.current = selected;
  const reports = scoped ? resource.reports : [];
  const loading = authLoading || ready && (!scoped || resource.loading);
  const canApprove = selected?.permissions?.approve === true;
  const canDeliver = canApprove && selected?.permissions?.export === true;
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listing.current?.abort(); inspection.current?.abort(); command.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    listing.current?.abort(); inspection.current?.abort(); command.current?.controller.abort(); command.current = null; retry.current = null;
    setReviewed(false); setReason(''); setDetail({ ...emptyDetail, owner, generation });
    setAction({ owner, generation, busy: false, error: '', notice: '' });
    setResource({ ...initial, owner, generation });
    if (ready) load();
    return () => { listing.current?.abort(); inspection.current?.abort(); command.current?.controller.abort(); };
    // Context includes current account, market, role and available authorization revision hints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ready]);

  async function inspect(report, parentCurrent = () => true) {
    if (!currentAccount()) return;
    inspection.current?.abort(); const controller = new AbortController(); inspection.current = controller;
    const current = () => !controller.signal.aborted && inspection.current === controller && currentAccount() && parentCurrent();
    setReviewed(false); setReason(''); setDetail({ ...emptyDetail, owner, generation, loading: true }); latestDetail.current = null;
    try {
      const [evidence, content] = await Promise.all([
        api.get(`/ng/public-health/reports/${report.id}/delivery`, { signal: controller.signal }),
        api.get(`/ng/public-health/reports/${report.id}`, { signal: controller.signal }),
      ]);
      if (!Array.isArray(evidence.data?.deliveries) || !Array.isArray(content.data?.values) || content.data?.report?.id !== report.id ||
          evidence.data.deliveries.some(item => item.reportId !== report.id)) throw new Error('Invalid delivery response');
      if (current()) setDetail({ owner, generation, loading: false, report: { ...report, ...content.data.report, permissions: report.permissions }, values: content.data.values, deliveries: evidence.data.deliveries, error: '' });
    } catch {
      if (current()) setDetail({ ...emptyDetail, owner, generation, error: 'Report values and delivery evidence could not be loaded. Reload reports and review the current record.' });
    } finally { if (inspection.current === controller) inspection.current = null; }
  }

  async function load(focusId = null) {
    if (!currentAccount()) return;
    listing.current?.abort(); inspection.current?.abort(); const controller = new AbortController(); listing.current = controller;
    const current = () => !controller.signal.aborted && listing.current === controller && currentAccount();
    setResource({ ...initial, owner, generation }); setDetail({ ...emptyDetail, owner, generation }); latestDetail.current = null;
    setReviewed(false); setReason('');
    try {
      const response = await api.get('/ng/public-health/reports', { params: { limit: 100 }, signal: controller.signal });
      if (!Array.isArray(response.data?.reports)) throw new Error('Invalid report response');
      if (current()) {
        setResource({ owner, generation, loading: false, reports: response.data.reports, error: '' });
        const focus = response.data.reports.find(report => report.id === focusId);
        if (focus) await inspect(focus, current);
      }
    } catch {
      if (current()) setResource({ ...initial, owner, generation, loading: false, error: 'Reports could not be loaded. Your reporting scope and delivery state have not been confirmed.' });
    } finally { if (listing.current === controller) listing.current = null; }
  }

  function refresh() { if (!command.current && currentAccount()) load(selected?.id); }
  function reviewReport(report) { if (!command.current && currentAccount()) { retry.current = null; setAction({ owner, generation, busy: false, error: '', notice: '' }); inspect(report); } }
  async function act(kind, job = null) {
    if (!currentAccount() || command.current || !selected || latestDetail.current !== selected || detail.loading) return;
    if (kind === 'approve' ? !canApprove || !reviewed || !reasonValid || !detail.values.length || !['draft', 'generated'].includes(selected.status)
      : !canDeliver || !reviewed) return;
    if (kind === 'sync' && (!['approved', 'sync_pending'].includes(selected.status) || !detail.values.length || detail.deliveries.length)) return;
    const isOperator = kind === 'reconcile' || kind === 'close';
    if (isOperator && (!job || !detail.deliveries.includes(job) || !Number.isInteger(job.version) || job.version < 1 || !reasonValid ||
      job.resolution?.code === 'closed_unresolved' || kind === 'reconcile' && (!['reconciliation', 'failed', 'rejected'].includes(job.status) || job.operatorRetryBudget !== 0) ||
      kind === 'close' && !['queued', 'reconciliation', 'failed', 'rejected'].includes(job.status))) return;
    const report = selected;
    const controller = new AbortController(); const pending = { controller, owner, generation }; command.current = pending;
    const current = () => !controller.signal.aborted && command.current === pending && currentAccount();
    const body = isOperator ? { action: kind, expectedVersion: job.version, reason: reason.trim() } : kind === 'approve' ? { notes: reason.trim() } : {};
    const identity = JSON.stringify([owner, generation, report.id, job?.id, kind, body]);
    if (isOperator && retry.current?.identity !== identity) retry.current = { identity, key: crypto.randomUUID() };
    setAction({ owner, generation, busy: true, error: '', notice: '' });
    try {
      const response = await api.post(isOperator ? `/ng/integrations/dhis2/deliveries/${job.id}/commands`
        : kind === 'approve' ? `/ng/public-health/reports/${report.id}/approve` : `/ng/integrations/dhis2/sync/${report.id}`, body,
      { signal: controller.signal, ...(isOperator ? { headers: { 'Idempotency-Key': retry.current.key } } : {}) });
      if (!current()) return;
      if (kind === 'approve' && (response.data?.report?.id !== report.id || response.data.report.status !== 'approved')) throw new Error('Unconfirmed report approval');
      if (isOperator && (response.data?.success !== true || response.data?.delivery?.id !== job.id || response.data.delivery.reportId !== report.id)) throw new Error('Unconfirmed operator command');
      if (kind === 'sync' && response.data?.delivery?.reportId !== report.id) throw new Error('Unconfirmed delivery scheduling');
      const notice = kind === 'approve' ? 'Report approval was recorded. Delivery remains a separate action.'
        : kind === 'reconcile' ? reconciliationNotice(response.data.delivery)
        : kind === 'close' && response.data.delivery.resolution?.code === 'closed_unresolved' ? 'The delivery was closed with your recorded reason. This does not cancel or remove data already received by DHIS2.'
        : actionNotice(response.data.delivery, response.data.workerEnabled);
      retry.current = null;
      setAction({ owner, generation, busy: true, error: '', notice });
      await load(report.id);
    } catch (failure) {
      if (current()) {
        const status = failure.response?.status;
        if ([401, 403, 404].includes(status)) { setDetail({ ...emptyDetail, owner, generation }); latestDetail.current = null; }
        setAction({ owner, generation, busy: true, notice: '', error: status === 409
          ? 'The report, delivery version, or lease changed. Refresh the evidence and review the current state before another command.'
          : [401, 403, 404].includes(status) ? 'This action is not available in your current reporting scope. Reload reports or sign in again.'
          : 'The action could not be confirmed. Reload delivery evidence before deciding whether to retry. A failed response does not prove that no change occurred.' });
      }
    } finally {
      if (current()) setAction(previous => ({ ...previous, busy: false }));
      if (command.current === pending) command.current = null;
    }
  }

  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 text-base sm:px-6">
    <PortalPageHeader eyebrow="DoctaRx CareOps · Public health" title="Reports and DHIS2 delivery" description="Review aggregate values, independent approvals, and delivery evidence within your assigned reporting scope.">
      <Button variant="outline" onClick={refresh} disabled={!ready || loading || active.busy} className="min-h-12 gap-2 text-base"><RefreshCw size={20} aria-hidden="true" />Refresh reports</Button>
    </PortalPageHeader>
    {!ready && !authLoading && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">An authenticated Nigeria public-health account and current reporting authority are required. Sign in again if your account context is unavailable.</p>}
    {active.error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 leading-7 text-red-900">{active.error}</p>}
    {active.notice && <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-950">{active.notice}</p>}
    {loading && <p role="status" className="flex items-center gap-3 rounded-2xl border bg-white p-6"><Loader2 className="animate-spin text-blue-700" aria-hidden="true" />Loading authorized reports…</p>}
    {scoped && resource.error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900"><h2 className="text-xl font-semibold">Reports unavailable</h2><p className="mt-2 leading-7">{resource.error}</p><Button variant="outline" className="mt-4 min-h-12 text-base" disabled={active.busy} onClick={refresh}>Try again</Button></div>}
    {scoped && !resource.loading && !resource.error && <section aria-label="Reports" className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="flex items-center gap-3"><FileText className="text-blue-700" aria-hidden="true" /><h2 className="text-2xl font-semibold">Authorized reports</h2></div>
      {!reports.length ? <p className="mt-4 leading-7 text-slate-600">No reports are available in your assigned scope.</p> : reports.map(report => <div key={report.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 py-5 last:border-0">
        <div className="min-w-0"><h3 className="text-lg font-semibold">{report.facility_name || 'Aggregate report'} · {report.report_period}</h3><p className="mt-1 text-slate-600">Report status: {reportStates[report.status] || 'Unavailable'}</p></div>
        <Button variant="outline" className="min-h-12 text-base" disabled={active.busy} onClick={() => reviewReport(report)} aria-label={`Review ${report.facility_name || 'aggregate report'} for ${report.report_period}`}>Review delivery</Button>
      </div>)}
    </section>}
    {scopedDetail && detail.loading && <p role="status" className="rounded-2xl border bg-white p-6">Loading report values and retained delivery evidence…</p>}
    {scopedDetail && detail.error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">{detail.error}</p>}
    {selected && <section aria-label="Delivery evidence" className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <div><div className="flex items-start gap-3"><ClipboardCheck className="mt-1 shrink-0 text-blue-700" aria-hidden="true" /><h2 className="text-2xl font-semibold">{selected.report_period} · {selected.facility_name || 'Aggregate report'}</h2></div><p className="mt-3 leading-7 text-slate-600">Report status: {reportStates[selected.status] || 'Unavailable'}. Author: {selected.generated_by_name || 'Name not returned in this record'}.</p></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[32rem] text-left text-base"><caption className="sr-only">Aggregate values for independent report review</caption><thead className="bg-slate-50"><tr><th className="p-4">Indicator</th><th className="p-4">Programme</th><th className="p-4">Value</th></tr></thead><tbody>{detail.values.map((value, index) => <tr key={value.id || value.indicator_id || index} className="border-t border-slate-200"><td className="p-4">{value.display_name || value.internal_key || 'Indicator unavailable'}</td><td className="p-4">{value.programme_area || 'Not recorded'}</td><td className="p-4">{value.value === null || value.value === undefined ? 'Unavailable' : value.value}</td></tr>)}</tbody></table></div>
      {!detail.values.length && <p className="text-slate-600">This report has no returned aggregate values. Delivery remains blocked.</p>}
      {!detail.deliveries.length ? <p className="rounded-xl bg-slate-50 p-5 leading-7 text-slate-600">No retained delivery job exists for this report. Scheduling is available after independent approval and export authorization.</p> : detail.deliveries.map(job => <article key={job.id} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-xl font-semibold">{states[job.status] || 'Delivery state unavailable'}</h3>
        <p className="break-all text-slate-600">Delivery reference: {job.id}</p>
        <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="font-medium">Recorded attempts</dt><dd>{Number.isInteger(job.attempts) ? job.attempts : 'Unavailable'}</dd></div><div><dt className="font-medium">Evidence version</dt><dd>{Number.isInteger(job.version) ? job.version : 'Unavailable'}</dd></div><div><dt className="font-medium">Last result</dt><dd className="break-words">{job.result?.code || job.lastErrorCode || 'No result recorded'}</dd></div><div><dt className="font-medium">Last updated</dt><dd>{date(job.updatedAt)}</dd></div>{job.nextAttemptAt && <div><dt className="font-medium">Next scheduled check</dt><dd>{date(job.nextAttemptAt)}</dd></div>}{job.remoteTask && <div><dt className="font-medium">Remote task</dt><dd className="break-all">{job.remoteTask.id} · {job.remoteTask.type} · API {job.remoteTask.apiVersion}</dd></div>}</dl>
        {job.operatorRetryBudget > 0 && <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">An explicit reconciliation check is already scheduled. It will not submit the report again.</p>}
        {job.resolution && <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-medium">Operator decision: {job.resolution.code}</p><p className="mt-2 whitespace-pre-wrap break-words">{job.resolution.reason}</p><p className="mt-2 text-slate-600">Recorded {date(job.resolution.resolvedAt)}</p></div>}
        {canDeliver && job.resolution?.code !== 'closed_unresolved' && <div className="flex flex-wrap gap-3 pt-2">
          {['reconciliation', 'failed', 'rejected'].includes(job.status) && <Button variant="outline" className="min-h-12 whitespace-normal text-base" disabled={active.busy || !reviewed || !reasonValid || !Number.isInteger(job.version) || job.operatorRetryBudget !== 0} onClick={() => act('reconcile', job)}>Schedule one reconciliation check</Button>}
          {['queued', 'reconciliation', 'failed', 'rejected'].includes(job.status) && <Button variant="outline" className="min-h-12 text-base" disabled={active.busy || !reviewed || !reasonValid || !Number.isInteger(job.version)} onClick={() => act('close', job)}>Close delivery with reason</Button>}
        </div>}
      </article>)}
      {canApprove && <div className="space-y-4 border-t border-slate-200 pt-6"><h3 className="text-xl font-semibold">Review and operator actions</h3><label className="flex min-h-12 items-start gap-3 leading-7"><input type="checkbox" className="mt-1.5 h-5 w-5 shrink-0 accent-blue-600" checked={reviewed} disabled={active.busy} onChange={event => setReviewed(event.target.checked)} />I reviewed these aggregate values, reporting scope, and retained delivery evidence.</label><div><label htmlFor="delivery-reason" className="font-medium">Review notes or operator reason</label><textarea id="delivery-reason" className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 bg-white p-3 text-base leading-7" maxLength={500} value={reason} disabled={active.busy} onChange={event => setReason(event.target.value)} aria-describedby="delivery-reason-help" /><p id="delivery-reason-help" className="mt-2 leading-7 text-slate-600">Enter 3–500 characters for approval or an operator command. Reconciliation reads the existing destination; it never repeats the submission.</p></div><div className="flex flex-wrap gap-3">
        {['draft', 'generated'].includes(selected.status) && <Button className="min-h-12 whitespace-normal bg-blue-600 text-base hover:bg-blue-700" disabled={active.busy || !reviewed || !reasonValid || !detail.values.length} onClick={() => act('approve')}>Approve after independent review</Button>}
        {canDeliver && ['approved', 'sync_pending'].includes(selected.status) && !detail.deliveries.length && <Button className="min-h-12 whitespace-normal bg-blue-600 text-base hover:bg-blue-700" disabled={active.busy || !reviewed || !detail.values.length} onClick={() => act('sync')}>Schedule approved report delivery</Button>}
      </div>{active.busy && <p role="status" className="text-slate-600">Confirming the action and refreshing retained evidence…</p>}</div>}
    </section>}
  </main>;
}
