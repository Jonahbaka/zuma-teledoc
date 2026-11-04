'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace, formatNaira, getNigeriaStatusTone } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

export default function NigeriaPharmacyPrescriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notice, setNotice] = useState('');
  const [edits, setEdits] = useState({});

  const loadPrescriptions = async () => {
    const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
    setWorkspace(pharmacyWorkspace);

    if (!pharmacyWorkspace?.id) {
      setPrescriptions([]);
      setLoading(false);
      return;
    }

    const response = await api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/prescriptions`).catch((error) => {
      setNotice(error.response?.data?.error || 'Unable to load routed prescriptions.');
      return { data: [] };
    });
    setPrescriptions(Array.isArray(response.data) ? response.data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadPrescriptions();
  }, []);

  const updateEdit = (id, field, value) => {
    setEdits((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [field]: value },
    }));
  };

  const updateStatus = async (prescriptionId, status) => {
    if (!workspace?.id) return;
    setNotice('');
    try {
      await api.patch(`/ng/pharmacy/${workspace.id}/prescriptions/${prescriptionId}`, {
        status,
        pharmacyNotes: edits[prescriptionId]?.pharmacyNotes || null,
        confirmedPriceNgn: edits[prescriptionId]?.confirmedPriceNgn || null,
        clarificationRequest: edits[prescriptionId]?.clarificationRequest || null,
      });
      setNotice('Prescription status updated.');
      await loadPrescriptions();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update prescription status.');
    }
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Prescriptions</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Routed prescription queue</h1>
          <p className="mt-2 text-sm text-slate-700">Review prescriptions sent by DoctaRx providers and update fulfillment status without claiming fake stock or price.</p>
        </section>

        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {loading ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading prescriptions...</CardContent></Card>
        ) : !workspace ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Complete pharmacy onboarding to receive routed prescriptions.</CardContent></Card>
        ) : prescriptions.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No provider prescriptions are routed to this pharmacy yet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {prescriptions.map((prescription) => {
              const items = Array.isArray(prescription.items) ? prescription.items : [];
              const status = prescription.pharmacy_response_status || prescription.dispense_status || prescription.status;
              return (
                <Card key={prescription.id} className="border-border/70 bg-white text-slate-950">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">{prescription.prescription_number || 'DoctaRx prescription'}</p>
                        <p className="mt-1 text-sm text-slate-700">Patient: {[prescription.patient_first_name, prescription.patient_last_name].filter(Boolean).join(' ') || 'DoctaRx patient'}</p>
                        <p className="mt-1 text-sm text-slate-700">Provider: {prescription.provider_name || 'DoctaRx provider'}</p>
                      </div>
                      <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${getNigeriaStatusTone(status)}`}>
                        {String(status || '').replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Medication items</p>
                      <div className="mt-3 space-y-2">
                        {items.length === 0 ? (
                          <p className="text-sm text-slate-600">No medication item details were provided.</p>
                        ) : items.map((item, index) => (
                          <div key={`${prescription.id}-${index}`} className="text-sm text-slate-800">
                            <span className="font-semibold">{item.drug_name || item.medicationName || item.name || 'Medication'}</span>
                            {[item.dosage, item.strength, item.quantity, item.instructions].filter(Boolean).length ? (
                              <span className="text-slate-600"> - {[item.dosage, item.strength, item.quantity, item.instructions].filter(Boolean).join(', ')}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        value={edits[prescription.id]?.confirmedPriceNgn || ''}
                        onChange={(event) => updateEdit(prescription.id, 'confirmedPriceNgn', event.target.value)}
                        placeholder="Confirmed price, if available"
                        inputMode="decimal"
                        className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                      />
                      <input
                        value={edits[prescription.id]?.clarificationRequest || ''}
                        onChange={(event) => updateEdit(prescription.id, 'clarificationRequest', event.target.value)}
                        placeholder="Clarification needed"
                        className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm md:col-span-2"
                      />
                    </div>
                    {prescription.confirmed_price_ngn ? (
                      <p className="text-sm font-medium text-slate-700">Current confirmed price: {formatNaira(prescription.confirmed_price_ngn)}</p>
                    ) : null}
                    <textarea
                      value={edits[prescription.id]?.pharmacyNotes || ''}
                      onChange={(event) => updateEdit(prescription.id, 'pharmacyNotes', event.target.value)}
                      placeholder="Pharmacy notes for DoctaRx care coordination"
                      className="min-h-[92px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm"
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => updateStatus(prescription.id, 'pharmacy_reviewing')}>Review</Button>
                      <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => updateStatus(prescription.id, 'accepted')}>Accept</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(prescription.id, 'ready_for_pickup')}>Ready for Pickup</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(prescription.id, 'out_for_delivery')}>Out for Delivery</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(prescription.id, 'fulfilled')}>Fulfilled</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(prescription.id, 'clarification_requested')}>Request Clarification</Button>
                      <Button size="sm" variant="outline" className="text-rose-700" onClick={() => updateStatus(prescription.id, 'unavailable')}>Unavailable</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
