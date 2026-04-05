'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaAdminPharmaciesPage() {
  const [loading, setLoading] = useState(true);
  const [pharmacies, setPharmacies] = useState([]);
  const [notice, setNotice] = useState('');

  const loadPharmacies = async () => {
    try {
      const response = await api.get('/api/ng/admin/pharmacies');
      setPharmacies(Array.isArray(response.data) ? response.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPharmacies();
  }, []);

  const updatePharmacy = async (pharmacyId, action, approved = true) => {
    setNotice('');
    try {
      if (action === 'verify') {
        await api.post(`/api/ng/admin/pharmacies/${pharmacyId}/verify`, {
          approved,
          rejectionReason: approved ? null : 'Rejected from admin operations portal review',
        });
      } else {
        await api.post(`/api/ng/admin/pharmacies/${pharmacyId}/suspend`, {
          reason: 'Suspended from admin operations portal',
        });
      }
      setNotice(`Pharmacy ${action === 'verify' ? (approved ? 'approved' : 'rejected') : 'suspended'}.`);
      await loadPharmacies();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update pharmacy status.');
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Administration</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Pharmacy approvals and marketplace status</h1>
        <p className="mt-2 text-sm text-muted-foreground">Verify, reject, or suspend Nigeria pharmacy operators from the admin portal.</p>
      </section>

      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

      {loading ? (
        <Card className="border-border/70">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading pharmacies...</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pharmacies.map((pharmacy) => (
            <Card key={pharmacy.id} className="border-border/70">
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-foreground">{pharmacy.name}</h2>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {String(pharmacy.status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{pharmacy.city}, {pharmacy.state}</p>
                    <p className="text-sm text-muted-foreground">PCN: {pharmacy.pcn_license_number || 'Missing'}</p>
                    <p className="text-sm text-muted-foreground">Revenue: {formatNaira(pharmacy.total_revenue)}</p>
                    <p className="text-sm text-muted-foreground">Orders: {pharmacy.order_count || 0}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => updatePharmacy(pharmacy.id, 'verify', true)} className="bg-emerald-600 text-white hover:bg-emerald-500">Approve</Button>
                    <Button variant="outline" onClick={() => updatePharmacy(pharmacy.id, 'verify', false)}>Reject</Button>
                    <Button variant="outline" onClick={() => updatePharmacy(pharmacy.id, 'suspend')} className="text-rose-600">Suspend</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
