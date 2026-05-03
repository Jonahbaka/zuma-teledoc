'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

function formatList(value) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.join(', ') : value;
    } catch (_) {
      return value;
    }
  }

  return '';
}

function formatStatus(value) {
  return String(value || 'pending').replace(/_/g, ' ');
}

export default function NigeriaAdminPharmaciesPage() {
  const [loading, setLoading] = useState(true);
  const [pharmacies, setPharmacies] = useState([]);
  const [whatsappLogs, setWhatsappLogs] = useState([]);
  const [notice, setNotice] = useState('');

  const loadPharmacies = async () => {
    try {
      const [pharmacyResponse, whatsappResponse] = await Promise.all([
        api.get('/ng/admin/pharmacies'),
        api.get('/ng/admin/whatsapp-notifications', { params: { limit: 20 } }).catch(() => ({ data: [] })),
      ]);
      setPharmacies(Array.isArray(pharmacyResponse.data) ? pharmacyResponse.data : []);
      setWhatsappLogs(Array.isArray(whatsappResponse.data) ? whatsappResponse.data : []);
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
        await api.post(`/ng/admin/pharmacies/${pharmacyId}/verify`, {
          approved,
          rejectionReason: approved ? null : 'Rejected from admin operations portal review',
        });
      } else {
        await api.post(`/ng/admin/pharmacies/${pharmacyId}/suspend`, {
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
        <p className="mt-2 text-sm text-muted-foreground">Verify, reject, or suspend Nigeria pharmacy operators, including onboarding details, WhatsApp receiving preferences, and fulfillment readiness.</p>
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
                        {formatStatus(pharmacy.status)}
                      </span>
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                        {formatStatus(pharmacy.onboarding_status)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {formatStatus(pharmacy.account_status)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{pharmacy.legal_business_name || pharmacy.name}</p>
                    <p className="text-sm text-muted-foreground">{pharmacy.branch_name ? `${pharmacy.branch_name} - ` : ''}{pharmacy.city}, {pharmacy.state}</p>
                    <p className="text-sm text-muted-foreground">Owner email: {pharmacy.owner_email || pharmacy.email || 'Unavailable'}</p>
                    <p className="text-sm text-muted-foreground">Phone: {pharmacy.phone || 'Missing'} | WhatsApp: {pharmacy.whatsapp_business_number || pharmacy.whatsapp || 'Missing'}</p>
                    <p className="text-sm text-muted-foreground">Receiving: {formatStatus(pharmacy.preferred_prescription_receiving_method || 'dashboard')}</p>
                    <p className="text-sm text-muted-foreground">PCN: {pharmacy.pcn_license_number || 'Missing'}</p>
                    <p className="text-sm text-muted-foreground">Pickup: {pharmacy.pickup_enabled === false ? 'No' : 'Yes'} | Delivery: {pharmacy.delivery_enabled === false ? 'No' : 'Yes'}</p>
                    {formatList(pharmacy.service_categories) ? (
                      <p className="text-sm text-muted-foreground">Coverage: {formatList(pharmacy.service_categories)}</p>
                    ) : null}
                    {pharmacy.onboarding_notes ? (
                      <p className="max-w-3xl text-sm text-muted-foreground">Notes: {pharmacy.onboarding_notes}</p>
                    ) : null}
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

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>WhatsApp/manual notification log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {whatsappLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pharmacy WhatsApp notification logs are available yet.</p>
              ) : (
                whatsappLogs.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-border px-4 py-4 text-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{log.pharmacy_name || 'Pharmacy'}</p>
                        <p className="mt-1 text-muted-foreground">{log.message_preview || 'Prepared notification'}</p>
                        <p className="mt-1 text-muted-foreground">Phone: {log.recipient_phone || log.whatsapp_business_number || log.whatsapp || 'Missing'}</p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        {formatStatus(log.status)}
                      </span>
                    </div>
                    {log.secure_action_url ? (
                      <p className="mt-2 text-xs text-muted-foreground">Dashboard link: {log.secure_action_url}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
