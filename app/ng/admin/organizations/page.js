'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Users, Search, CheckCircle, XCircle, ChevronLeft, Download, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNaira } from '../../lib/ngUtils';

const statusBadge = (s) => ({
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
}[s] || 'bg-muted text-muted-foreground border-border');

export default function AdminOrganizations() {
  const [orgs, setOrgs] = useState([]);
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
    fetch(`/api/ng/organizations?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setOrgs(d.organizations || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(tab); }, [tab]);

  const handleVerify = async (id, approve) => {
    setActing(id);
    try {
      await fetch(`/api/ng/organizations/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approved: approve }),
      });
      load(tab);
    } catch (e) {}
    finally { setActing(null); }
  };

  const filtered = orgs.filter(o =>
    o.name?.toLowerCase().includes(search.toLowerCase()) ||
    o.type?.toLowerCase().includes(search.toLowerCase()) ||
    o.admin_email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ng/admin" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organisation Accounts</h1>
          <p className="text-muted-foreground text-sm">Verify corporate registrations, NGOs, churches, schools and associations</p>
        </div>
      </div>

      <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit">
        {['all', 'pending', 'verified', 'suspended'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 max-w-md">
        <Search size={15} className="text-muted-foreground shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, type, or admin email…"
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground text-sm">Organisations ({total})</h3>
          <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline"><Download size={12} /> Export</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No organisations found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(o => (
              <div key={o.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground text-sm">{o.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(o.status)}`}>{o.status}</span>
                    <span className="text-[10px] bg-accent text-muted-foreground px-2 py-0.5 rounded-full capitalize">{o.type}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Admin: {o.admin_name} • {o.admin_email}</p>
                  <p className="text-xs text-muted-foreground">{o.city}, {o.state}{o.rc_number ? ` • RC: ${o.rc_number}` : ''}</p>
                  {o.member_count !== undefined && (
                    <p className="text-xs text-muted-foreground">Members: {o.member_count} • Plan: {o.plan_id || 'None'}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Registered: {new Date(o.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === 'pending' && (
                    <>
                      <Button size="sm" disabled={acting === o.id} onClick={() => handleVerify(o.id, true)}
                        className="bg-green-600 hover:bg-green-500 text-white text-xs h-7 px-3">
                        <CheckCircle size={12} className="mr-1" /> Approve
                      </Button>
                      <Button size="sm" disabled={acting === o.id} onClick={() => handleVerify(o.id, false)}
                        variant="outline" className="text-red-500 border-red-500/30 text-xs h-7 px-3">
                        <XCircle size={12} className="mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {o.status === 'verified' && (
                    <Button size="sm" onClick={() => handleVerify(o.id, false)}
                      variant="outline" className="text-amber-500 border-amber-500/30 text-xs h-7 px-3">Suspend</Button>
                  )}
                  {o.status === 'suspended' && (
                    <Button size="sm" onClick={() => handleVerify(o.id, true)}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-7 px-3">Reinstate</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
