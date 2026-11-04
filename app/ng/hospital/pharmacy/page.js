'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, Pill, ClipboardList, CheckCircle2, Clock, XCircle,
  Search, RefreshCw, AlertTriangle, ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';

const STATUS_STYLE = {
  pending:    { label: 'Pending',    cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20', Icon: Clock },
  confirmed:  { label: 'Confirmed',  cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20',   Icon: CheckCircle2 },
  ready:      { label: 'Ready',      cls: 'bg-green-500/10 text-green-600 border-green-500/20', Icon: CheckCircle2 },
  dispensed:  { label: 'Dispensed',  cls: 'bg-muted text-muted-foreground border-border',       Icon: CheckCircle2 },
  rejected:   { label: 'Rejected',   cls: 'bg-red-500/10 text-red-600 border-red-500/20',       Icon: XCircle },
};

const TABS = ['all', 'pending', 'confirmed', 'ready', 'dispensed', 'rejected'];

export default function HospitalPharmacy() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [hospitalId, setHospitalId] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const id = localStorage.getItem('ng_hospital_id');
    setHospitalId(id);
    if (id) fetchOrders(id);
  }, []);

  async function fetchOrders(id) {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/ng/hospitals/${id}/pharmacy/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setOrders(data.orders || []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(orderId, newStatus) {
    setProcessing(orderId);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/ng/pharmacy/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      showToast(`Order marked as ${newStatus}`);
    } catch {
      showToast('Could not update order status', true);
    } finally {
      setProcessing(null);
    }
  }

  function showToast(msg, error = false) {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = orders.filter((o) => {
    const matchTab = tab === 'all' || o.status === tab;
    const matchSearch =
      !search ||
      o.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.rx_code?.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const counts = TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? orders.length : orders.filter((o) => o.status === t).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/ng/hospital/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <ChevronLeft size={16} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">In-House Pharmacy</h1>
            <p className="text-muted-foreground text-sm">Manage prescription orders for your facility's pharmacy</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: counts.pending, color: 'text-amber-600' },
            { label: 'Ready', value: counts.ready, color: 'text-green-600' },
            { label: 'Dispensed Today', value: orders.filter((o) => {
              if (o.status !== 'dispensed') return false;
              const d = new Date(o.updated_at);
              const now = new Date();
              return d.toDateString() === now.toDateString();
            }).length, color: 'text-foreground' },
            { label: 'Total Orders', value: counts.all, color: 'text-foreground' },
          ].map((c) => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Search + refresh */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient name or Rx code…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => hospitalId && fetchOrders(hospitalId)}>
            <RefreshCw size={14} />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize transition-colors ${
                tab === t
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-accent text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {t === 'all' ? 'All' : t} {counts[t] > 0 && <span className="ml-1 opacity-70">{counts[t]}</span>}
            </button>
          ))}
        </div>

        {/* Orders */}
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            Loading orders…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <ShoppingBag size={32} className="mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">No orders found</p>
            {tab !== 'all' && (
              <button onClick={() => setTab('all')} className="text-sm text-foreground underline">
                View all orders
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => {
              const s = STATUS_STYLE[order.status] || STATUS_STYLE.pending;
              const StatusIcon = s.Icon;
              const isPending = order.status === 'pending';
              const isConfirmed = order.status === 'confirmed';
              const isReady = order.status === 'ready';

              return (
                <div key={order.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{order.patient_name || 'Unknown Patient'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${s.cls}`}>
                          <StatusIcon size={10} />
                          {s.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs font-mono text-muted-foreground">{order.rx_code || '—'}</span>
                        {order.created_at && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString('en-NG', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {order.items && order.items.length > 0 && (
                    <div className="space-y-1">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Pill size={12} className="shrink-0" />
                          <span>{item.drug_name}</span>
                          {item.dosage && <span>— {item.dosage}</span>}
                          {item.frequency && <span className="text-xs">({item.frequency})</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap pt-1">
                    {isPending && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => updateStatus(order.id, 'confirmed')}
                          disabled={processing === order.id}
                          className="text-xs"
                        >
                          {processing === order.id ? <RefreshCw size={12} className="animate-spin" /> : 'Confirm Order'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus(order.id, 'rejected')}
                          disabled={processing === order.id}
                          className="text-xs text-red-600 border-red-500/30 hover:bg-red-500/10"
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {isConfirmed && (
                      <Button
                        size="sm"
                        onClick={() => updateStatus(order.id, 'ready')}
                        disabled={processing === order.id}
                        className="text-xs"
                      >
                        {processing === order.id ? <RefreshCw size={12} className="animate-spin" /> : 'Mark Ready for Pickup'}
                      </Button>
                    )}
                    {isReady && (
                      <Button
                        size="sm"
                        onClick={() => updateStatus(order.id, 'dispensed')}
                        disabled={processing === order.id}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white"
                      >
                        {processing === order.id ? <RefreshCw size={12} className="animate-spin" /> : 'Mark Dispensed'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info note */}
        <div className="flex items-start gap-2 p-3 bg-accent rounded-xl border border-border">
          <AlertTriangle size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Orders shown here are from digital prescriptions issued by your facility's providers.
            For WhatsApp-based dispensing, enable the WhatsApp integration in{' '}
            <Link href="/ng/hospital/settings" className="underline">Settings</Link>.
          </p>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.error ? 'bg-red-600 text-white' : 'bg-foreground text-background'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
