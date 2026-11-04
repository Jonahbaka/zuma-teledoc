'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNaira } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

const pageSize = 50;
const validRow = (row) => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && row.id.trim();
const recordedNumber = (value, integer = false) => {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && (!integer || Number.isInteger(number)) ? number : null;
};
const quantityLabel = (value) => recordedNumber(value, true) ?? 'Not recorded';

export default function NigeriaPharmacyInventoryPage() {
  const { user, loading, isAuthenticated } = useAuth();
  const actorId = user?.id || user?.userId;
  const market = user?.marketScope || user?.market_scope;
  const ready = !loading && isAuthenticated && actorId && user.role === 'pharmacy' && market === 'NG';
  const accountKey = ready ? JSON.stringify([actorId, user.role, market]) : null;
  const session = useRef(accountKey);
  session.current = accountKey;
  if (!ready) return <NigeriaPharmacyPortalShell><p role="status">{loading ? 'Checking pharmacy inventory access…' : 'Sign in with your Nigeria pharmacy account to view inventory.'}</p></NigeriaPharmacyPortalShell>;
  return <NigeriaPharmacyInventoryWorkspace key={accountKey} session={session} accountKey={accountKey} />;
}

export function NigeriaPharmacyInventoryWorkspace({ session, accountKey } = {}) {
  const [workspaceState, setWorkspaceState] = useState('loading');
  const [inventory, setInventory] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);
  const [alertsError, setAlertsError] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const workspaceId = useRef(null);
  const workspaceRequest = useRef(null), inventoryRequest = useRef(null), alertsRequest = useRef(null);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => mounted.current && (!session || session.current === accountKey), [session, accountKey]);

  const loadInventory = useCallback(async (page = 1, pharmacyId = workspaceId.current) => {
    if (!isCurrent() || !pharmacyId || pharmacyId !== workspaceId.current || inventoryRequest.current) return;
    const controller = new AbortController(); inventoryRequest.current = controller;
    const current = () => isCurrent() && !controller.signal.aborted && inventoryRequest.current === controller && workspaceId.current === pharmacyId;
    setInventoryLoading(true); setInventoryError(null);
    if (page === 1) setInventory(null);
    try {
      const { data } = await api.get(`/ng/pharmacy/${encodeURIComponent(pharmacyId)}/inventory`, { signal: controller.signal, params: { page, limit: pageSize } });
      if (!current()) return;
      if (!data || !Array.isArray(data.items) || !data.items.every(validRow)
        || data.page !== page || !Number.isSafeInteger(data.total) || data.total < data.items.length
        || !Number.isSafeInteger(data.totalPages) || data.totalPages !== Math.ceil(data.total / pageSize)) throw new Error('Unconfirmed inventory');
      setInventory((existing) => page === 1 ? data.items : [...(existing || []), ...data.items.filter(item => !(existing || []).some(known => known.id === item.id))]);
      setPagination({ page, total: data.total, totalPages: data.totalPages });
    } catch {
      if (current()) setInventoryError(page);
    } finally {
      if (inventoryRequest.current === controller) {
        inventoryRequest.current = null;
        if (isCurrent()) setInventoryLoading(false);
      }
    }
  }, [isCurrent]);

  const loadAlerts = useCallback(async (pharmacyId = workspaceId.current) => {
    if (!isCurrent() || !pharmacyId || pharmacyId !== workspaceId.current || alertsRequest.current) return;
    const controller = new AbortController(); alertsRequest.current = controller;
    const current = () => isCurrent() && !controller.signal.aborted && alertsRequest.current === controller && workspaceId.current === pharmacyId;
    setAlertsLoading(true); setAlertsError(false); setAlerts(null);
    try {
      const { data } = await api.get(`/ng/pharmacy/${encodeURIComponent(pharmacyId)}/inventory/alerts`, { signal: controller.signal });
      if (!current()) return;
      if (!Array.isArray(data) || !data.every(validRow)) throw new Error('Unconfirmed alerts');
      setAlerts(data);
    } catch {
      if (current()) setAlertsError(true);
    } finally {
      if (alertsRequest.current === controller) {
        alertsRequest.current = null;
        if (isCurrent()) setAlertsLoading(false);
      }
    }
  }, [isCurrent]);

  const loadWorkspace = useCallback(async () => {
    if (!isCurrent()) return;
    workspaceRequest.current?.abort(); inventoryRequest.current?.abort(); alertsRequest.current?.abort();
    inventoryRequest.current = null; alertsRequest.current = null; workspaceId.current = null;
    const controller = new AbortController(); workspaceRequest.current = controller;
    const current = () => isCurrent() && !controller.signal.aborted && workspaceRequest.current === controller;
    setWorkspaceState('loading'); setInventory(null); setAlerts(null);
    setInventoryError(null); setAlertsError(false); setInventoryLoading(false); setAlertsLoading(false);
    setPagination({ page: 1, total: 0, totalPages: 0 });
    try {
      const { data } = await api.get('/ng/pharmacy/me', { signal: controller.signal });
      if (!current()) return;
      if (data === null) { setWorkspaceState('missing'); return; }
      if (!validRow(data)) throw new Error('Unconfirmed pharmacy workspace');
      workspaceId.current = data.id;
      setWorkspaceState('ready');
      await Promise.all([loadInventory(1, data.id), loadAlerts(data.id)]);
    } catch {
      if (current()) setWorkspaceState('error');
    } finally {
      if (workspaceRequest.current === controller) workspaceRequest.current = null;
    }
  }, [isCurrent, loadInventory, loadAlerts]);

  useEffect(() => {
    mounted.current = true; loadWorkspace();
    return () => { mounted.current = false; workspaceId.current = null; workspaceRequest.current?.abort(); inventoryRequest.current?.abort(); alertsRequest.current?.abort(); };
  }, [loadWorkspace]);

  return <NigeriaPharmacyPortalShell><div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Inventory</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Inventory and stock alerts</h1><p className="mt-2 text-sm text-muted-foreground">Review recorded stock, pricing and reorder alerts. These records do not confirm current dispensable stock.</p></div>
      <Button variant="outline" disabled={workspaceState === 'loading'} onClick={loadWorkspace}>Refresh inventory records</Button>
    </section>
    {workspaceState === 'loading' && <p role="status">Loading pharmacy inventory access…</p>}
    {workspaceState === 'error' && <div role="alert" className="rounded-2xl border border-amber-200 p-5"><p>Pharmacy access could not be confirmed. Try again before relying on inventory records.</p><Button variant="outline" onClick={loadWorkspace}>Retry pharmacy access</Button></div>}
    {workspaceState === 'missing' && <p>Complete pharmacy onboarding to manage inventory.</p>}
    {workspaceState === 'ready' && <>
      <Card className="border-border/70"><CardHeader><CardTitle>Low-stock alerts</CardTitle></CardHeader><CardContent className="space-y-3">
        {alertsLoading && <p role="status">Loading stock alerts…</p>}
        {alertsError && <div role="alert"><p>Stock alerts could not be loaded. Their absence has not been confirmed.</p><Button variant="outline" disabled={alertsLoading} onClick={() => loadAlerts()}>Retry stock alerts</Button></div>}
        {alerts?.length === 0 && <p className="text-sm text-muted-foreground">No active low-stock alerts were returned.</p>}
        {alerts?.map(alert => <div key={alert.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800"><p className="font-semibold">{alert.drug_name || 'Medicine name not recorded'}</p><p className="mt-1">Recorded quantity {quantityLabel(alert.quantity_available)} · Reorder at {quantityLabel(alert.reorder_level)}</p></div>)}
      </CardContent></Card>
      <Card className="border-border/70"><CardHeader><CardTitle>Inventory records</CardTitle></CardHeader><CardContent className="space-y-3">
        {inventoryLoading && <p role="status">Loading inventory records…</p>}
        {inventoryError && <div role="alert"><p>Inventory could not be loaded. {inventory ? 'Earlier loaded records are preserved; this list is incomplete.' : 'An empty inventory has not been confirmed.'}</p><Button variant="outline" disabled={inventoryLoading} onClick={() => loadInventory(inventoryError)}>Retry inventory</Button></div>}
        {inventory?.length === 0 && <p className="text-sm text-muted-foreground">No inventory items were returned for this pharmacy.</p>}
        {inventory && <p className="text-sm text-muted-foreground">Loaded {inventory.length} inventory records. Reported total: {pagination.total}.</p>}
        {inventory?.map(item => <div key={item.id} className="rounded-2xl border border-border px-4 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-foreground">{item.drug_name || item.name || 'Medicine name not recorded'}</p><p className="mt-1 text-sm text-muted-foreground">Batch {item.batch_number || 'Not recorded'}</p></div><div className="text-right text-sm"><p className="font-semibold text-foreground">{recordedNumber(item.selling_price) === null ? 'Price not recorded' : formatNaira(item.selling_price)}</p><p className="text-muted-foreground">Recorded quantity {quantityLabel(item.quantity_available)}</p><p className="text-muted-foreground">Reserved quantity {quantityLabel(item.quantity_reserved)}</p></div></div></div>)}
        {inventory && pagination.page < pagination.totalPages && !inventoryError && <Button variant="outline" disabled={inventoryLoading} onClick={() => loadInventory(pagination.page + 1)}>Load more inventory</Button>}
      </CardContent></Card>
    </>}
  </div></NigeriaPharmacyPortalShell>;
}
