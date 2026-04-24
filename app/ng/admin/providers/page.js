'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Stethoscope, Search, CheckCircle, XCircle, Clock,
  ChevronLeft, AlertCircle, Eye, Filter, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATUS_TABS = ['all', 'pending', 'verified', 'under_review', 'suspended'];

const statusBadge = (s) => ({
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  under_review: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
}[s] || 'bg-muted text-muted-foreground border-border');

export default function AdminProviders() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState(null);
  const [total, setTotal] = useState(0);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const load = (status = tab) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: 50 });
    if (status !== 'all') params.set('status', status);
    fetch(`/api/ng/providers?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setProviders(d.providers || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(tab); }, [tab]);

  const handleVerify = async (id, approve, reason = '') => {
    setActing(id);
    try {
      await fetch(`/api/ng/providers/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approved: approve, rejection_reason: reason }),
      });
      load(tab);
    } catch (e) {}
    finally { setActing(null); }
  };

  const filtered = providers.filter(p =>
    p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.mdcn_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.specialty?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ng/admin" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Provider Verifications</h1>
          <p className="text-muted-foreground text-sm">Review MDCN credentials and approve providers for the platform</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit flex-wrap">
        {STATUS_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 max-w-md">
        <Search size={15} className="text-muted-foreground shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, MDCN, or specialty…"
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground text-sm">Providers ({total})</h3>
          <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline"><Download size={12} /> Export</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Stethoscope size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No providers found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(p => (
              <div key={p.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground text-sm">{p.full_name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(p.status)}`}>{p.status?.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.specialty?.replace(/_/g, ' ')} • MDCN: {p.mdcn_number || 'Not provided'}</p>
                  <p className="text-xs text-muted-foreground">{p.email} • {p.phone}</p>
                  {p.practice_name && <p className="text-xs text-muted-foreground">{p.practice_name}, {p.practice_city}, {p.practice_state}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">Registered: {new Date(p.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.status === 'pending' || p.status === 'under_review' ? (
                    <>
                      <Button size="sm" disabled={acting === p.id} onClick={() => handleVerify(p.id, true)}
                        className="bg-green-600 hover:bg-green-500 text-white text-xs h-7 px-3">
                        <CheckCircle size={12} className="mr-1" /> Approve
                      </Button>
                      <Button size="sm" disabled={acting === p.id} onClick={() => handleVerify(p.id, false, 'MDCN verification failed')}
                        variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 text-xs h-7 px-3">
                        <XCircle size={12} className="mr-1" /> Reject
                      </Button>
                    </>
                  ) : p.status === 'verified' ? (
                    <Button size="sm" onClick={() => handleVerify(p.id, false, 'Suspended by admin')}
                      variant="outline" className="text-amber-500 border-amber-500/30 text-xs h-7 px-3">Suspend</Button>
                  ) : p.status === 'suspended' ? (
                    <Button size="sm" onClick={() => handleVerify(p.id, true)}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-7 px-3">Reinstate</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
