'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace, formatNaira } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

export default function NigeriaPharmacyWalletPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [wallet, setWallet] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [notice, setNotice] = useState('');

  const loadWallet = async () => {
    const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
    setWorkspace(pharmacyWorkspace);

    if (!pharmacyWorkspace?.id) {
      setLoading(false);
      return;
    }

    const [walletResponse, transactionsResponse] = await Promise.all([
      api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/wallet`).catch(() => ({ data: {} })),
      api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/wallet/transactions`).catch(() => ({ data: [] })),
    ]);

    setWallet(walletResponse.data || {});
    setTransactions(Array.isArray(transactionsResponse.data) ? transactionsResponse.data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadWallet();
  }, []);

  const requestSettlement = async () => {
    if (!workspace?.id) return;
    setNotice('');
    try {
      await api.post(`/ng/pharmacy/${workspace.id}/wallet/settle`);
      setNotice('Settlement request submitted.');
      await loadWallet();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to request settlement.');
    }
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Wallet</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Balances and settlement</h1>
            <p className="mt-2 text-sm text-muted-foreground">Review confirmed pharmacy earnings, pending balance, and wallet transactions.</p>
          </div>
          <Button onClick={requestSettlement} className="bg-emerald-600 text-white hover:bg-emerald-500">Request Settlement</Button>
        </section>

        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading wallet...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Complete pharmacy onboarding to activate wallet settlement.</CardContent>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Available Balance', value: formatNaira(wallet.balance) },
                { label: 'Pending Balance', value: formatNaira(wallet.pending_balance) },
                { label: 'Today Earnings', value: formatNaira(wallet.todayEarnings) },
              ].map((item) => (
                <Card key={item.label} className="border-border/70">
                  <CardContent className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <p className="mt-3 text-2xl font-bold text-foreground">{item.value}</p>
                  </CardContent>
                </Card>
              ))}
            </section>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Wallet transactions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No wallet transactions recorded yet.</p>
                ) : (
                  transactions.map((transaction) => (
                    <div key={transaction.id} className="rounded-2xl border border-border px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{transaction.description || transaction.type}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{transaction.reference || 'No reference available'}</p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-foreground">{formatNaira(transaction.amount)}</p>
                          <p className="text-muted-foreground">{transaction.type}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
