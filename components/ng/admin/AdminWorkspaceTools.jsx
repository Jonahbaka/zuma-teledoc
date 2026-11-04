'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { createRequestGate, currentResource } from '@/lib/ng/adminWorkspaceData';

export function useAdminResource(url, params = {}, select = data => data) {
  const { user } = useAuth();
  const key = JSON.stringify({ url, params, userId: user?.id || null });
  const selector = useRef(select); selector.current = select;
  const gate = useRef(null); if (!gate.current) gate.current = createRequestGate();
  const controller = useRef(null);
  const [state, setState] = useState({ key: null, data: null, loading: true, error: null });
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const ticket = gate.current.begin(key);
    setState({ key, data: null, loading: true, error: null });
    try {
      const context = JSON.parse(key);
      if (!context.userId) throw new Error('Sign in to load this workspace.');
      const { data } = await api.get(context.url, { params: context.params, signal: request.signal });
      const selected = selector.current(data);
      if (!gate.current.current(ticket)) return { ok: false, current: false };
      setState({ key, data: selected, loading: false, error: null });
      return { ok: true, current: true, data: selected };
    } catch (error) {
      if (!gate.current.current(ticket) || request.signal.aborted) return { ok: false, current: false };
      const message = error.response?.status === 403 ? 'Your account does not have access to these records.' : error.response?.status === 401 ? 'Sign in again to load these records.' : 'These records could not be loaded. Try again.';
      setState({ key, data: null, loading: false, error: message });
      return { ok: false, current: true, error: message };
    }
  }, [key]);
  useEffect(() => {
    void refresh();
    return () => { gate.current.cancel(); controller.current?.abort(); };
  }, [refresh]);
  return { ...currentResource(state, key), key, refresh };
}

export function useAdminAction(contextKey) {
  const context = useRef(contextKey); context.current = contextKey;
  const active = useRef(false); const busy = useRef(false);
  const [, rerender] = useState(0);
  const [state, setState] = useState({ key: contextKey, pending: null, notice: null });
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (id, operation) => {
    if (busy.current) return null;
    const key = context.current; busy.current = true;
    setState({ key, pending: id, notice: null });
    try {
      const result = await operation(() => active.current && context.current === key);
      if (!active.current || context.current !== key) return null;
      setState({ key, pending: null, notice: { type: 'success', message: result.message } });
      return result;
    } catch (error) {
      if (active.current && context.current === key) setState({ key, pending: null, notice: { type: 'error', message: error.response?.data?.error || error.message || 'The action could not be completed.' } });
      return null;
    } finally { busy.current = false; if (active.current) rerender(value => value + 1); }
  };
  return { pending: busy.current || (state.key === contextKey && state.pending !== null), notice: state.key === contextKey ? state.notice : null, run };
}

export function AdminPageHeader({ title, description, resource, children }) {
  return <PortalPageHeader eyebrow="DoctaRx · Administration" title={title} description={description}>
    {resource && <Button onClick={() => void resource.refresh()} disabled={resource.loading} variant="outline"><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />{resource.loading ? 'Refreshing…' : 'Refresh'}</Button>}{children}
  </PortalPageHeader>;
}

export function ResourceState({ resource, empty, emptyMessage, children }) {
  if (resource.loading) return <p role="status" className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading records…</p>;
  if (resource.error) return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-950"><p className="flex items-start gap-3"><AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />{resource.error}</p><Button onClick={() => void resource.refresh()} className="mt-4 bg-blue-700 hover:bg-blue-800">Try again</Button></div>;
  if (empty) return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-slate-600">{emptyMessage}</p>;
  return children;
}

export function ActionNotice({ action }) {
  if (!action.notice) return null;
  return <p role={action.notice.type === 'error' ? 'alert' : 'status'} className={'rounded-2xl border p-4 ' + (action.notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-blue-200 bg-blue-50 text-blue-900')}>{action.notice.message}</p>;
}

export function StatusBadge({ status }) {
  return <span className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium capitalize text-slate-800">{typeof status === 'string' && status ? status.replace(/_/g, ' ') : 'Status unavailable'}</span>;
}
