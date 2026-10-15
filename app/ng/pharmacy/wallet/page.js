'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { fetchNigeriaPharmacyWorkspace } from '@/lib/ngPharmacyPortal';
import { deliveryDate, deliveryError, formatKobo, legacyWalletAmount, readMedicationPharmacyStatement, statusLabel } from '@/lib/ngDeliveryApi';
import { DeliveryLoading, DeliveryNotice, deliveryButtonClass, deliveryCardClass } from '@/components/ng/delivery/DeliveryPresentation';
import api from '@/lib/api';

function PharmacyWalletWorkspace() {
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState(null); const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState(null); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [historyError, setHistoryError] = useState('');
  const active = useRef(false); const controller = useRef(null); const sequence = useRef(0); const writeLock = useRef(false);
  const loadWallet = useCallback(async () => {
    if (writeLock.current) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const current = ++sequence.current;
    setLoading(true); setError(''); setHistoryError(''); setWallet(null); setTransactions(null);
    try {
      const pharmacy = await fetchNigeriaPharmacyWorkspace();
      if (!active.current || abort.signal.aborted || current !== sequence.current) return;
      setWorkspace(pharmacy); if (!pharmacy?.id) return;
      const responses = await Promise.allSettled([api.get(`/ng/pharmacy/${pharmacy.id}/wallet`, { signal: abort.signal }), api.get(`/ng/pharmacy/${pharmacy.id}/wallet/transactions`, { signal: abort.signal })]);
      if (!active.current || abort.signal.aborted || current !== sequence.current) return;
      try { if (responses[0].status !== 'fulfilled') throw responses[0].reason; const data = responses[0].value.data; if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Wallet records could not be confirmed.'); readMedicationPharmacyStatement(data.medicationStatement); setWallet(data); } catch (failure) { setError(deliveryError(failure)); }
      try { if (responses[1].status !== 'fulfilled') throw responses[1].reason; const rows = responses[1].value.data; if (!Array.isArray(rows)) throw new Error('Wallet transaction history could not be confirmed.'); setTransactions(rows); } catch (failure) { setHistoryError(deliveryError(failure)); }
    } catch (failure) { if (active.current && !abort.signal.aborted && current === sequence.current) setError(deliveryError(failure)); }
    finally { if (active.current && !abort.signal.aborted && current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { active.current = true; loadWallet(); return () => { active.current = false; controller.current?.abort(); }; }, [loadWallet]);
  const requestSettlement = async () => {
    if (!workspace?.id || !wallet || writeLock.current || !active.current) return;
    let accepted = false;
    writeLock.current = true; setBusy(true); setNotice(''); setError('');
    try { await api.post(`/ng/pharmacy/${workspace.id}/wallet/settle`, {}, { signal: controller.current?.signal }); if (!active.current || controller.current?.signal.aborted) return; accepted = true; setNotice('The legacy wallet settlement request returned. Refresh the records to check its verified transfer status. Medication-order payables are settled separately.'); }
    catch (failure) { if (active.current && !controller.current?.signal.aborted) setError(deliveryError(failure)); }
    finally { writeLock.current = false; if (active.current) { setBusy(false); if (accepted) loadWallet(); } }
  };
  return <NigeriaPharmacyPortalShell><div className="space-y-6 text-base">
    <PortalPageHeader title="Balances & settlements" description="Review medication-order payables, verified settlements and the separate legacy pharmacy wallet."><Button className={deliveryButtonClass} variant="outline" onClick={loadWallet} disabled={loading || busy}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh financial records</Button></PortalPageHeader>
    <DeliveryNotice>{notice}</DeliveryNotice><DeliveryNotice error>{error}</DeliveryNotice>
    {loading ? <DeliveryLoading>Loading pharmacy financial records…</DeliveryLoading> : !workspace ? <DeliveryNotice>Complete pharmacy onboarding to access this pharmacy’s financial records.</DeliveryNotice> : <>
      {wallet && <><section className={`${deliveryCardClass} space-y-5 border-blue-200 bg-gradient-to-br from-white to-blue-50/60`} aria-label="Medication order settlement statement"><div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-blue-700" aria-hidden="true" /><div><h2 className="text-2xl font-semibold tracking-tight text-slate-950">Medication-order statement</h2><p className="mt-3 max-w-3xl leading-7 text-slate-600">These amounts belong to the medication ledger. They are separate from the legacy wallet’s available cash and are never added to it automatically.</p></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[['Outstanding pharmacy payable', formatKobo(wallet.medicationStatement.outstandingMinor)], ['Verified medication settlements', formatKobo(wallet.medicationStatement.settledMinor)], ['Orders in this statement', String(wallet.medicationStatement.orderCount)]].map(([label, value]) => <div key={label} className="rounded-2xl border border-blue-100 bg-white p-5"><p className="font-medium text-slate-600">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums text-slate-950">{value}</p></div>)}</div><p className="leading-7 text-slate-700">Medication payment-processing costs are borne by DoctaRx. A payable is an amount owed to the pharmacy; only a verified settlement is recorded as paid.</p></section>
      <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-2xl font-semibold tracking-tight text-slate-950">Legacy pharmacy wallet</h2><Button onClick={requestSettlement} variant="outline" className={deliveryButtonClass} disabled={busy || loading}>{busy ? 'Submitting legacy request…' : 'Request legacy wallet settlement'}</Button></div><div className="grid gap-4 sm:grid-cols-3">{[['Available wallet cash', wallet.balance], ['Pending wallet balance', wallet.pending_balance], ['Today’s wallet credits', wallet.todayEarnings]].map(([label, value]) => <article key={label} className={deliveryCardClass}><h3 className="font-medium text-slate-600">{label}</h3><p className="mt-3 text-2xl font-semibold tabular-nums text-slate-950">{legacyWalletAmount(value)}</p></article>)}</div></section></>}
      <section className={`${deliveryCardClass} space-y-4`}><h2 className="text-2xl font-semibold tracking-tight text-slate-950">Legacy wallet transaction history</h2><DeliveryNotice error>{historyError}</DeliveryNotice>{transactions?.length ? transactions.map(transaction => <article key={transaction.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold text-slate-950">{transaction.description || statusLabel(transaction.type)}</h3><p className="mt-2 break-all leading-7 text-slate-600">{transaction.reference || 'Reference not recorded'}</p><p className="mt-2 leading-7 text-slate-600">{deliveryDate(transaction.created_at)}</p></div><div><p className="font-semibold tabular-nums text-slate-950">{legacyWalletAmount(transaction.amount)}</p><p className="mt-2 text-slate-600">{statusLabel(transaction.type)}</p></div></div></article>) : transactions && <p className="leading-7 text-slate-600">No legacy wallet transactions are recorded.</p>}</section>
    </>}
  </div></NigeriaPharmacyPortalShell>;
}

export default function NigeriaPharmacyWalletPage() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading || !isAuthenticated || !user?.id || user.role !== 'pharmacy') return <DeliveryLoading>Checking authorized pharmacy financial access…</DeliveryLoading>;
  return <PharmacyWalletWorkspace key={`${user.id}:${user.role}:${user.marketScope || user.market_scope || ''}`} />;
}
