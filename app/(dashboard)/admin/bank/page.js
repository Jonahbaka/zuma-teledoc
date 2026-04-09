'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Landmark, DollarSign, ArrowUpRight, ArrowDownRight, CreditCard,
  FileText, BarChart3, PieChart, TrendingUp, TrendingDown,
  Building2, Receipt, Calculator, Scale, Wallet, BookOpen,
  RefreshCw, ChevronRight, Eye, Plus, Clock, AlertTriangle,
  CheckCircle2, Banknote, ArrowRightLeft, Shield, Target,
  Briefcase, Users, Zap
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// ═══ TABS ═══
const TABS = [
  { id: 'dashboard', label: 'Treasury', icon: Landmark },
  { id: 'bank', label: 'Bank Accounts', icon: Building2 },
  { id: 'ledger', label: 'General Ledger', icon: BookOpen },
  { id: 'ar', label: 'Receivables', icon: ArrowUpRight },
  { id: 'ap', label: 'Payables', icon: ArrowDownRight },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'roi', label: 'ROI', icon: Target },
  { id: 'coa', label: 'Chart of Accounts', icon: FileText },
];

export default function BankPage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [journalEntries, setJournalEntries] = useState([]);
  const [coa, setCoa] = useState([]);
  const [ar, setAr] = useState([]);
  const [ap, setAp] = useState([]);
  const [roi, setRoi] = useState([]);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [loading, setLoading] = useState(true);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const apiCall = useCallback(async (endpoint, options = {}) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/financial${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
      });
      return await res.json();
    } catch (err) {
      console.error('API Error:', err);
      return { success: false, error: err.message };
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    const [dashRes, bankRes] = await Promise.all([
      apiCall('/dashboard'),
      apiCall('/bank/accounts')
    ]);
    if (dashRes.success) setDashboard(dashRes.data);
    if (bankRes.success) setBankAccounts(bankRes.data);
    setLoading(false);
  }

  async function loadTab(tab) {
    setActiveTab(tab);
    switch (tab) {
      case 'ledger':
        const jeRes = await apiCall('/journal');
        if (jeRes.success) setJournalEntries(jeRes.data);
        break;
      case 'coa':
        const coaRes = await apiCall('/coa');
        if (coaRes.success) setCoa(coaRes.data);
        break;
      case 'ar':
        const arRes = await apiCall('/ar');
        if (arRes.success) setAr(arRes.data);
        break;
      case 'ap':
        const apRes = await apiCall('/ap');
        if (apRes.success) setAp(apRes.data);
        break;
      case 'roi':
        const roiRes = await apiCall('/roi');
        if (roiRes.success) setRoi(roiRes.data);
        break;
      case 'reports':
        const [bsRes, isRes] = await Promise.all([
          apiCall('/reports/balance-sheet'),
          apiCall('/reports/income-statement')
        ]);
        if (bsRes.success) setBalanceSheet(bsRes.data);
        if (isRes.success) setIncomeStatement(isRes.data);
        break;
    }
  }

  async function loadTransactions(accountId) {
    setSelectedAccount(accountId);
    const res = await apiCall(`/bank/transactions/${accountId}`);
    if (res.success) setTransactions(res.data);
  }

  const fmt = (n) => {
    const num = parseFloat(n) || 0;
    return num < 0 ? `-$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `$${num.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <Landmark className="w-12 h-12 text-emerald-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400">Loading Corporate Treasury...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen contrast-dark bg-gray-950 text-white p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <Landmark className="w-5 h-5 text-white" />
            </div>
            DoctaRx Corporate Treasury
          </h1>
          <p className="text-gray-500 text-sm mt-1">Double-Entry Accounting &bull; Revenue-Funded Operations &bull; Live Stripe</p>
        </div>
        <button onClick={loadDashboard} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => loadTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white'
                : 'ui-dark-chip-action-soft'
            }`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TREASURY DASHBOARD ═══ */}
      {activeTab === 'dashboard' && dashboard && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard icon={Wallet} label="Total Cash" value={fmt(dashboard.cash?.total)} color="emerald" />
            <MetricCard icon={TrendingUp} label="MTD Revenue" value={fmt(dashboard.monthly?.revenue)} color="blue" />
            <MetricCard icon={TrendingDown} label="MTD Expenses" value={fmt(dashboard.monthly?.expenses)} color="red" />
            <MetricCard icon={Calculator} label="Net Income" value={fmt(dashboard.monthly?.net_income)} color={dashboard.monthly?.net_income >= 0 ? 'green' : 'red'} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard icon={Clock} label="Runway" value={`${dashboard.monthly?.runway_months || '∞'} mo`} color="amber" />
            <MetricCard icon={Banknote} label="Monthly Burn" value={fmt(dashboard.monthly?.burn_rate)} color="orange" />
            <MetricCard icon={CreditCard} label="Stripe Processed" value={fmt(dashboard.stripe?.total_processed)} color="purple" />
            <MetricCard icon={Target} label="Avg ROI" value={`${(dashboard.roi?.avg_roi || 0).toFixed(1)}%`} color="cyan" />
          </div>

          {/* Bank Accounts Overview */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-400" /> Bank Accounts
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {(dashboard.cash?.accounts || []).map((acc, i) => (
                <div key={i} className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
                  <p className="text-xs text-gray-500 truncate">{acc.account_number}</p>
                  <p className="text-sm font-medium text-gray-300 mt-1">{acc.account_name?.replace('DoctaRx ', '')}</p>
                  <p className={`text-lg font-bold mt-2 ${parseFloat(acc.current_balance) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmt(acc.current_balance)}
                  </p>
                  <span className="ui-dark-chip text-[10px] px-2 py-0.5 mt-2 inline-block rounded uppercase">{acc.account_type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AR/AP Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-blue-400" /> Accounts Receivable
              </h3>
              <p className="text-2xl font-bold text-blue-400">{fmt(dashboard.ar?.total_outstanding)}</p>
              <p className="text-xs text-gray-500 mt-1">Outstanding invoices</p>
              {(dashboard.ar?.summary || []).map((s, i) => (
                <div key={i} className="flex justify-between text-sm mt-2">
                  <span className="text-gray-400 capitalize">{s.status}</span>
                  <span className="text-gray-300">{s.count} &bull; {fmt(s.total)}</span>
                </div>
              ))}
            </div>
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4 text-red-400" /> Accounts Payable
              </h3>
              <p className="text-2xl font-bold text-red-400">{fmt(dashboard.ap?.total_outstanding)}</p>
              <p className="text-xs text-gray-500 mt-1">Outstanding bills</p>
              {(dashboard.ap?.summary || []).map((s, i) => (
                <div key={i} className="flex justify-between text-sm mt-2">
                  <span className="text-gray-400 capitalize">{s.status}</span>
                  <span className="text-gray-300">{s.count} &bull; {fmt(s.total)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-gray-400" /> Recent Transactions
            </h3>
            {(dashboard.recent_transactions || []).length === 0 ? (
              <p className="text-gray-500 text-sm">No transactions yet. Revenue flows here when enrollments happen via Stripe.</p>
            ) : (
              <div className="space-y-2">
                {dashboard.recent_transactions.map((txn, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        ['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'
                      }`}>
                        {['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm text-gray-300">{txn.description}</p>
                        <p className="text-xs text-gray-500">{txn.counterparty} &bull; {new Date(txn.posted_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <span className={`font-mono text-sm font-semibold ${
                      ['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? '+' : '-'}{fmt(txn.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ REAL STRIPE ACCOUNT (Live) ═══ */}
          {dashboard.stripe_live && (
            <div className="bg-gradient-to-r from-indigo-900/40 via-violet-900/30 to-purple-900/40 rounded-xl border border-indigo-500/40 p-5 relative overflow-hidden">
              <div className="absolute top-3 right-4 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${dashboard.stripe_live?.live ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                <span className="text-[10px] font-mono text-gray-400">
                  {dashboard.stripe_live?.live ? (dashboard.stripe_live?.test_mode ? 'TEST MODE' : 'LIVE') : 'OFFLINE'}
                </span>
              </div>
              <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" /> Stripe Account — Real Balance
              </h3>
              <p className="text-xs text-gray-400 mb-4">Live data from Stripe API &bull; Not simulated</p>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
                <div className="bg-black/30 rounded-lg p-3 border border-indigo-700/30">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Available</p>
                  <p className="text-xl font-bold text-green-400">{fmt(dashboard.stripe_live?.available_balance)}</p>
                </div>
                <div className="bg-black/30 rounded-lg p-3 border border-indigo-700/30">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Pending</p>
                  <p className="text-xl font-bold text-yellow-400">{fmt(dashboard.stripe_live?.pending_balance)}</p>
                </div>
                <div className="bg-black/30 rounded-lg p-3 border border-indigo-700/30">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total Balance</p>
                  <p className="text-xl font-bold text-indigo-300">{fmt(dashboard.stripe_live?.total_balance)}</p>
                </div>
                <div className="bg-black/30 rounded-lg p-3 border border-indigo-700/30">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">MRR</p>
                  <p className="text-xl font-bold text-blue-400">{fmt(dashboard.stripe_live?.mrr)}</p>
                </div>
                <div className="bg-black/30 rounded-lg p-3 border border-indigo-700/30">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">ARR</p>
                  <p className="text-xl font-bold text-purple-400">{fmt(dashboard.stripe_live?.arr)}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-5">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{dashboard.stripe_live?.active_subscriptions || 0}</p>
                  <p className="text-xs text-gray-500">Active Subscriptions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{dashboard.stripe_live?.total_customers || 0}</p>
                  <p className="text-xs text-gray-500">Customers</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{fmt(dashboard.stripe_live?.charges_total)}</p>
                  <p className="text-xs text-gray-500">Total Charges</p>
                </div>
              </div>

              {/* Recent Real Stripe Charges */}
              {(dashboard.stripe_live?.recent_charges || []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent Stripe Charges</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {dashboard.stripe_live.recent_charges.map((charge, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded bg-black/20 border border-gray-800/50 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${charge.status === 'succeeded' ? 'bg-green-400' : charge.status === 'pending' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                          <span className="text-gray-300 truncate max-w-[200px]">{charge.description}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">{new Date(charge.created).toLocaleDateString()}</span>
                          <span className="font-mono font-semibold text-green-400">{fmt(charge.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!dashboard.stripe_live?.live && dashboard.stripe_live?.error && (
                <div className="mt-3 p-3 rounded bg-red-900/20 border border-red-700/30 text-xs text-red-400">
                  <AlertTriangle className="w-3 h-3 inline mr-1" /> Stripe connection issue: {dashboard.stripe_live.error}
                </div>
              )}
            </div>
          )}

          {/* Stripe Revenue Bridge (Ledger) */}
          <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 rounded-xl border border-purple-700/30 p-5">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-purple-400" /> Stripe Revenue Bridge (Ledger)
            </h3>
            <p className="text-xs text-gray-400 mb-3">Links Stripe payments to our double-entry accounting ledger</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Total Processed</p>
                <p className="text-xl font-bold text-purple-300">{fmt(dashboard.stripe?.total_processed)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Net (After Fees)</p>
                <p className="text-xl font-bold text-purple-300">{fmt(dashboard.stripe?.total_net)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Transactions</p>
                <p className="text-xl font-bold text-purple-300">{dashboard.stripe?.transaction_count || 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BANK ACCOUNTS ═══ */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bankAccounts.map(acc => (
              <div 
                key={acc.id}
                onClick={() => loadTransactions(acc.id)}
                className={`bg-gray-900/50 rounded-xl border p-5 cursor-pointer transition-all hover:border-emerald-600/50 ${
                  selectedAccount === acc.id ? 'border-emerald-500' : 'border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Landmark className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm font-medium">{acc.account_name}</span>
                  </div>
                  {acc.stripe_connected && <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-700/30">STRIPE</span>}
                </div>
                <p className="text-xs text-gray-500 font-mono">{acc.account_number}</p>
                <p className="text-xs text-gray-500 mt-1">Routing: {acc.routing_number}</p>
                <div className="mt-4 pt-3 border-t border-gray-800">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Current Balance</span>
                    <span className={`font-bold font-mono ${parseFloat(acc.current_balance) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(acc.current_balance)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Available</span>
                    <span className="text-gray-300 font-mono">{fmt(acc.available_balance)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Type</span>
                    <span className="text-gray-400 uppercase text-xs">{acc.account_type}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Transactions</span>
                    <span className="text-gray-400">{acc.transaction_count || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Transactions for selected account */}
          {selectedAccount && (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
              <h3 className="text-sm font-semibold mb-3">Transaction History</h3>
              {transactions.length === 0 ? (
                <p className="text-gray-500 text-sm">No transactions for this account yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2 font-medium">Date</th>
                        <th className="text-left py-2 font-medium">Type</th>
                        <th className="text-left py-2 font-medium">Description</th>
                        <th className="text-left py-2 font-medium">Counterparty</th>
                        <th className="text-right py-2 font-medium">Amount</th>
                        <th className="text-right py-2 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((txn, i) => (
                        <tr key={i} className="border-b border-gray-800/30">
                          <td className="py-2 text-gray-400">{new Date(txn.posted_date).toLocaleDateString()}</td>
                          <td className="py-2">
                            <span className="ui-dark-chip text-xs px-2 py-0.5 rounded">{txn.transaction_type}</span>
                          </td>
                          <td className="py-2 text-gray-300 max-w-xs truncate">{txn.description}</td>
                          <td className="py-2 text-gray-400">{txn.counterparty || '—'}</td>
                          <td className={`py-2 text-right font-mono ${['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? 'text-emerald-400' : 'text-red-400'}`}>
                            {['deposit', 'stripe_charge', 'interest'].includes(txn.transaction_type) ? '+' : '-'}{fmt(txn.amount)}
                          </td>
                          <td className="py-2 text-right font-mono text-gray-300">{fmt(txn.running_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ GENERAL LEDGER ═══ */}
      {activeTab === 'ledger' && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" /> General Ledger — Journal Entries
          </h3>
          {journalEntries.length === 0 ? (
            <p className="text-gray-500 text-sm">No journal entries yet. Entries are created automatically when revenue flows in via Stripe or when agents record financial events.</p>
          ) : (
            <div className="space-y-3">
              {journalEntries.map((je, i) => (
                <div key={i} className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs text-gray-500">#{je.entry_number}</span>
                      <span className="text-xs text-gray-400 ml-2">{new Date(je.entry_date).toLocaleDateString()}</span>
                      <span className="ui-dark-chip text-xs px-2 py-0.5 rounded ml-2">{je.source}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${je.is_posted ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'}`}>
                      {je.is_posted ? 'Posted' : 'Draft'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mb-2">{je.description}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span className="text-gray-500 font-medium">Account</span>
                    <span className="text-gray-500 font-medium text-right">Debit</span>
                    <span className="text-gray-500 font-medium text-right">Credit</span>
                    {(je.lines || []).map((line, li) => (
                      <React.Fragment key={li}>
                        <span className="text-gray-400">{line.account_number}</span>
                        <span className="text-right font-mono text-emerald-400">{parseFloat(line.debit) > 0 ? fmt(line.debit) : ''}</span>
                        <span className="text-right font-mono text-blue-400">{parseFloat(line.credit) > 0 ? fmt(line.credit) : ''}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ ACCOUNTS RECEIVABLE ═══ */}
      {activeTab === 'ar' && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-blue-400" /> Accounts Receivable
          </h3>
          {ar.length === 0 ? (
            <p className="text-gray-500 text-sm">No outstanding receivables. Invoices appear here as patients and providers enroll.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2">Invoice #</th>
                    <th className="text-left py-2">Customer</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-right py-2">Amount</th>
                    <th className="text-right py-2">Paid</th>
                    <th className="text-right py-2">Balance</th>
                    <th className="text-left py-2">Due Date</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ar.map((inv, i) => (
                    <tr key={i} className="border-b border-gray-800/30">
                      <td className="py-2 text-gray-300 font-mono text-xs">{inv.invoice_number}</td>
                      <td className="py-2 text-gray-300">{inv.customer_name}</td>
                      <td className="py-2"><span className="ui-dark-chip text-xs px-2 py-0.5 rounded capitalize">{inv.customer_type}</span></td>
                      <td className="py-2 text-right font-mono">{fmt(inv.amount)}</td>
                      <td className="py-2 text-right font-mono text-emerald-400">{fmt(inv.amount_paid)}</td>
                      <td className="py-2 text-right font-mono text-amber-400">{fmt(inv.balance_due)}</td>
                      <td className="py-2 text-gray-400">{new Date(inv.due_date).toLocaleDateString()}</td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          inv.status === 'paid' ? 'bg-emerald-900/40 text-emerald-400' :
                          inv.status === 'overdue' ? 'bg-red-900/40 text-red-400' :
                          'bg-amber-900/40 text-amber-400'
                        }`}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ ACCOUNTS PAYABLE ═══ */}
      {activeTab === 'ap' && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowDownRight className="w-5 h-5 text-red-400" /> Accounts Payable
          </h3>
          {ap.length === 0 ? (
            <p className="text-gray-500 text-sm">No outstanding payables. Bills and vendor payments appear here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2">Bill #</th>
                    <th className="text-left py-2">Vendor</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-right py-2">Amount</th>
                    <th className="text-right py-2">Balance</th>
                    <th className="text-left py-2">Due Date</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ap.map((bill, i) => (
                    <tr key={i} className="border-b border-gray-800/30">
                      <td className="py-2 text-gray-300 font-mono text-xs">{bill.bill_number}</td>
                      <td className="py-2 text-gray-300">{bill.vendor_name}</td>
                      <td className="py-2"><span className="ui-dark-chip text-xs px-2 py-0.5 rounded">{bill.vendor_type}</span></td>
                      <td className="py-2 text-right font-mono">{fmt(bill.amount)}</td>
                      <td className="py-2 text-right font-mono text-red-400">{fmt(bill.balance_due)}</td>
                      <td className="py-2 text-gray-400">{new Date(bill.due_date).toLocaleDateString()}</td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          bill.status === 'paid' ? 'bg-emerald-900/40 text-emerald-400' :
                          bill.status === 'overdue' ? 'bg-red-900/40 text-red-400' :
                          'bg-amber-900/40 text-amber-400'
                        }`}>{bill.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ REPORTS ═══ */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Balance Sheet */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-400" /> Balance Sheet
              {balanceSheet && (
                <span className={`text-xs px-2 py-0.5 rounded ml-2 ${balanceSheet.is_balanced ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                  {balanceSheet.is_balanced ? 'BALANCED' : 'OUT OF BALANCE'}
                </span>
              )}
            </h3>
            {balanceSheet ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-emerald-400 mb-2">Assets</h4>
                  {(balanceSheet.assets?.items || []).map((a, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-gray-400">{a.account_name}</span>
                      <span className="font-mono text-gray-300">{fmt(a.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm py-2 border-t border-gray-700 mt-2 font-bold">
                    <span className="text-emerald-400">Total Assets</span>
                    <span className="font-mono text-emerald-400">{fmt(balanceSheet.assets?.total)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-red-400 mb-2">Liabilities</h4>
                  {(balanceSheet.liabilities?.items || []).map((l, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-gray-400">{l.account_name}</span>
                      <span className="font-mono text-gray-300">{fmt(l.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm py-2 border-t border-gray-700 mt-2 font-bold">
                    <span className="text-red-400">Total Liabilities</span>
                    <span className="font-mono text-red-400">{fmt(balanceSheet.liabilities?.total)}</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-blue-400 mb-2">Equity</h4>
                  {(balanceSheet.equity?.items || []).map((e, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-gray-400">{e.account_name}</span>
                      <span className="font-mono text-gray-300">{fmt(e.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm py-2 border-t border-gray-700 mt-2 font-bold">
                    <span className="text-blue-400">Total Equity</span>
                    <span className="font-mono text-blue-400">{fmt(balanceSheet.equity?.total)}</span>
                  </div>
                </div>
              </div>
            ) : <p className="text-gray-500 text-sm">Loading balance sheet...</p>}
          </div>

          {/* Income Statement */}
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" /> Income Statement (P&L)
            </h3>
            {incomeStatement ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-3 bg-gray-800/40 rounded-lg">
                    <p className="text-xs text-gray-500">Net Revenue</p>
                    <p className="text-lg font-bold text-emerald-400">{fmt(incomeStatement.net_revenue)}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/40 rounded-lg">
                    <p className="text-xs text-gray-500">Gross Profit</p>
                    <p className="text-lg font-bold text-blue-400">{fmt(incomeStatement.gross_profit)}</p>
                    <p className="text-xs text-gray-600">{incomeStatement.gross_margin}% margin</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/40 rounded-lg">
                    <p className="text-xs text-gray-500">Operating Exp</p>
                    <p className="text-lg font-bold text-amber-400">{fmt(incomeStatement.operating_expenses?.total)}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/40 rounded-lg">
                    <p className="text-xs text-gray-500">Operating Income</p>
                    <p className="text-lg font-bold text-purple-400">{fmt(incomeStatement.operating_income)}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/40 rounded-lg">
                    <p className="text-xs text-gray-500">Net Income</p>
                    <p className={`text-lg font-bold ${incomeStatement.net_income >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(incomeStatement.net_income)}</p>
                    <p className="text-xs text-gray-600">{incomeStatement.net_margin}% margin</p>
                  </div>
                </div>
              </div>
            ) : <p className="text-gray-500 text-sm">Loading income statement...</p>}
          </div>
        </div>
      )}

      {/* ═══ ROI ═══ */}
      {activeTab === 'roi' && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-400" /> ROI Tracking
          </h3>
          {roi.length === 0 ? (
            <p className="text-gray-500 text-sm">No ROI initiatives tracked yet. The Accounting Agent tracks return on every investment — marketing, agent ops, CRM outreach.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roi.map((r, i) => (
                <div key={i} className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">{r.initiative_name}</span>
                    <span className="ui-dark-chip text-xs px-2 py-0.5 rounded capitalize">{r.category}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center mt-3">
                    <div>
                      <p className="text-xs text-gray-500">Invested</p>
                      <p className="text-sm font-bold text-gray-300">{fmt(r.investment_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Revenue</p>
                      <p className="text-sm font-bold text-emerald-400">{fmt(r.revenue_generated)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">ROI</p>
                      <p className={`text-sm font-bold ${parseFloat(r.calculated_roi || r.roi_percentage) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(parseFloat(r.calculated_roi || r.roi_percentage) || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ CHART OF ACCOUNTS ═══ */}
      {activeTab === 'coa' && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" /> Chart of Accounts (GAAP-Aligned)
          </h3>
          {coa.length === 0 ? (
            <p className="text-gray-500 text-sm">Loading chart of accounts...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2">Acct #</th>
                    <th className="text-left py-2">Name</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Sub-Type</th>
                    <th className="text-left py-2">Normal Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {coa.map((acc, i) => (
                    <tr key={i} className="border-b border-gray-800/30">
                      <td className="py-2 text-gray-300 font-mono">{acc.account_number}</td>
                      <td className="py-2 text-gray-300">{acc.account_name}</td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          acc.account_type === 'asset' ? 'bg-emerald-900/30 text-emerald-400' :
                          acc.account_type === 'liability' ? 'bg-red-900/30 text-red-400' :
                          acc.account_type === 'equity' ? 'bg-blue-900/30 text-blue-400' :
                          acc.account_type === 'revenue' ? 'bg-purple-900/30 text-purple-400' :
                          'bg-amber-900/30 text-amber-400'
                        }`}>{acc.account_type}</span>
                      </td>
                      <td className="py-2 text-gray-500 text-xs">{acc.sub_type || '—'}</td>
                      <td className="py-2 text-gray-400 text-xs uppercase">{acc.normal_balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ Metric Card Component ═══
function MetricCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    emerald: 'from-emerald-900/30 to-emerald-900/10 border-emerald-700/30 text-emerald-400',
    blue: 'from-blue-900/30 to-blue-900/10 border-blue-700/30 text-blue-400',
    red: 'from-red-900/30 to-red-900/10 border-red-700/30 text-red-400',
    green: 'from-green-900/30 to-green-900/10 border-green-700/30 text-green-400',
    amber: 'from-amber-900/30 to-amber-900/10 border-amber-700/30 text-amber-400',
    orange: 'from-orange-900/30 to-orange-900/10 border-orange-700/30 text-orange-400',
    purple: 'from-purple-900/30 to-purple-900/10 border-purple-700/30 text-purple-400',
    cyan: 'from-cyan-900/30 to-cyan-900/10 border-cyan-700/30 text-cyan-400',
    gray: 'from-gray-900/30 to-gray-900/10 border-gray-700/30 text-gray-400'
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-xl border p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 opacity-70" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
