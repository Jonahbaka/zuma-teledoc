'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, Search, CheckCircle, XCircle, ChevronLeft, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const statusBadge = (s) => ({
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  under_review: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
}[s] || 'bg-muted text-muted-foreground border-border');

export default function AdminHospitals() {
  const [hospitals, setHospitals] = useState([]);
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
    fetch(`/api/ng/hospitals?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setHospitals(d.hospitals || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(tab); }, [tab]);

  const handleVerify = async (id, approve) => {
    setActing(id);
    try {
      await fetch(`/api/ng/hospitals/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approved: approve }),
      });
      load(tab);
    } catch (e) {}
    finally { setActing(null); }
  };

  const filtered = hospitals.filter(h =>
    h.name?.toLowerCase().includes(search.toLowerCase()) ||
    h.city?.toLowerCase().includes(search.toLowerCase()) ||
    h.facility_type?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ng/admin" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hospital Registrations</h1>
          <p className="text-muted-foreground text-sm">Verify hospitals, clinics, and healthcare facilities</p>
        </div>
      </div>

      <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit">
        {['all', 'pending', 'verified', 'under_review', 'suspended'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 max-w-md">
        <Search size={15} className="text-muted-foreground shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, city, or type…"
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground text-sm">Facilities ({total})</h3>
          <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline"><Download size={12} /> Export</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No facilities found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(h => (
              <div key={h.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground text-sm">{h.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(h.status)}`}>{h.status?.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">{h.facility_type?.replace(/_/g, ' ')} • {h.city}, {h.state}</p>
                  <p className="text-xs text-muted-foreground">{h.contact_name} • {h.contact_phone}</p>
                  {h.nhis_code && <p className="text-xs text-muted-foreground">NHIS: {h.nhis_code} • Beds: {h.bed_count || 'N/A'}</p>}
                  <p className="text-xs text-muted-foreground">Registered: {new Date(h.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(h.status === 'pending' || h.status === 'under_review') && (
                    <>
                      <Button size="sm" disabled={acting === h.id} onClick={() => handleVerify(h.id, true)}
                        className="bg-green-600 hover:bg-green-500 text-white text-xs h-7 px-3">
                        <CheckCircle size={12} className="mr-1" /> Approve
                      </Button>
                      <Button size="sm" disabled={acting === h.id} onClick={() => handleVerify(h.id, false)}
                        variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 text-xs h-7 px-3">
                        <XCircle size={12} className="mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {h.status === 'verified' && (
                    <Button size="sm" onClick={() => handleVerify(h.id, false)}
                      variant="outline" className="text-amber-500 border-amber-500/30 text-xs h-7 px-3">Suspend</Button>
                  )}
                  {h.status === 'suspended' && (
                    <Button size="sm" onClick={() => handleVerify(h.id, true)}
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
