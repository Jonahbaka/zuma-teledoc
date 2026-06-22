'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Send } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  PRESENTATION_DEMO_LABEL,
  buildProviderDemoData,
  shouldShowPresentationDemoData,
} from '@/lib/ngPresentationDemoData';

const emptyItem = { drug_name: '', dosage: '', quantity: '', instructions: '' };

export default function NigeriaProviderPrescriptionsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pharmacies, setPharmacies] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    patientUserId: '',
    preferredPharmacyId: '',
    diagnosis: '',
    notes: '',
    fulfillmentPreference: 'pickup_or_delivery',
    items: [{ ...emptyItem }],
  });
  const presentationDemoData = useMemo(() => buildProviderDemoData(), []);

  const loadData = async () => {
    const [pharmacyResponse, prescriptionResponse] = await Promise.all([
      api.get('/ng/providers/pharmacies').catch(() => ({ data: { pharmacies: [] } })),
      api.get('/ng/providers/prescriptions').catch(() => ({ data: { prescriptions: [] } })),
    ]);
    setPharmacies(pharmacyResponse.data?.pharmacies || []);
    setPrescriptions(prescriptionResponse.data?.prescriptions || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const showDemoData = shouldShowPresentationDemoData(user);
  const visiblePharmacies = showDemoData && pharmacies.length === 0 ? presentationDemoData.pharmacies : pharmacies;
  const visiblePrescriptions = showDemoData && prescriptions.length === 0 ? presentationDemoData.prescriptions : prescriptions;
  const usingDemoData = showDemoData && (pharmacies.length === 0 || prescriptions.length === 0);

  const updateItem = (index, field, value) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }));
  };

  const submitPrescription = async (event) => {
    event.preventDefault();
    setNotice('');
    try {
      const items = form.items
        .map((item) => ({
          ...item,
          drug_name: item.drug_name.trim(),
          dosage: item.dosage.trim(),
          quantity: item.quantity.trim(),
          instructions: item.instructions.trim(),
        }))
        .filter((item) => item.drug_name);

      if (!form.patientUserId || items.length === 0) {
        setNotice('Patient ID and at least one medication are required.');
        return;
      }

      await api.post('/ng/providers/prescriptions', {
        patientUserId: form.patientUserId,
        preferredPharmacyId: form.preferredPharmacyId || null,
        routedPharmacyId: form.preferredPharmacyId || null,
        diagnosis: form.diagnosis || null,
        notes: form.notes || null,
        fulfillmentPreference: form.fulfillmentPreference,
        items,
      });

      setNotice('Prescription created and routed for pharmacy confirmation.');
      setForm({
        patientUserId: '',
        preferredPharmacyId: '',
        diagnosis: '',
        notes: '',
        fulfillmentPreference: 'pickup_or_delivery',
        items: [{ ...emptyItem }],
      });
      await loadData();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to create prescription.');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Provider Prescriptions</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Send prescriptions to pharmacies</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-700">
              Create a provider prescription and route it to a DoctaRx Nigeria pharmacy for availability, price, pickup, or delivery confirmation.
            </p>
          </div>
          <Link href="/ng/provider/dashboard">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </header>

        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {usingDemoData ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            {PRESENTATION_DEMO_LABEL}: sample provider prescriptions and participating pharmacies are shown for this walkthrough.
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>New prescription</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitPrescription} className="space-y-4">
                <input
                  value={form.patientUserId}
                  onChange={(event) => setForm((current) => ({ ...current, patientUserId: event.target.value }))}
                  placeholder="Patient user ID"
                  className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                  required
                />
                <select
                  value={form.preferredPharmacyId}
                  onChange={(event) => setForm((current) => ({ ...current, preferredPharmacyId: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">No pharmacy selected yet</option>
                  {visiblePharmacies.map((pharmacy) => (
                    <option key={pharmacy.id} value={pharmacy.id}>
                      {pharmacy.name} - {[pharmacy.city, pharmacy.state].filter(Boolean).join(', ')}
                    </option>
                  ))}
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={form.diagnosis}
                    onChange={(event) => setForm((current) => ({ ...current, diagnosis: event.target.value }))}
                    placeholder="Diagnosis or reason, if appropriate"
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                  />
                  <select
                    value={form.fulfillmentPreference}
                    onChange={(event) => setForm((current) => ({ ...current, fulfillmentPreference: event.target.value }))}
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="pickup_or_delivery">Pickup or delivery</option>
                    <option value="pickup">Pickup</option>
                    <option value="delivery">Delivery</option>
                  </select>
                </div>

                <div className="space-y-3">
                  {form.items.map((item, index) => (
                    <div key={index} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                      <input value={item.drug_name} onChange={(event) => updateItem(index, 'drug_name', event.target.value)} placeholder="Medication name" className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                      <input value={item.dosage} onChange={(event) => updateItem(index, 'dosage', event.target.value)} placeholder="Dosage/strength if known" className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                      <input value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} placeholder="Quantity" className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                      <input value={item.instructions} onChange={(event) => updateItem(index, 'instructions', event.target.value)} placeholder="Instructions summary" className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm((current) => ({ ...current, items: [...current.items, { ...emptyItem }] }))}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Medication
                  </Button>
                </div>

                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Pharmacy notes or clarification context"
                  className="min-h-[88px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm"
                />
                <Button type="submit" className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                  <Send className="mr-2 h-4 w-4" /> Send to Pharmacy
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent prescriptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <p className="text-sm text-slate-600">Loading prescriptions...</p>
              ) : visiblePrescriptions.length === 0 ? (
                <p className="text-sm text-slate-600">No Nigeria prescriptions created yet.</p>
              ) : visiblePrescriptions.map((prescription) => (
                <div key={prescription.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                  <p className="font-semibold">{prescription.prescription_number || 'Prescription'}</p>
                  <p className="mt-1 text-slate-600">Patient: {[prescription.patient_first_name, prescription.patient_last_name].filter(Boolean).join(' ') || prescription.patient_email}</p>
                  <p className="mt-1 text-slate-600">Pharmacy: {prescription.pharmacy_name || 'Not routed'}</p>
                  <p className="mt-1 text-slate-600">Status: {String(prescription.pharmacy_response_status || prescription.dispense_status || prescription.status || '').replace(/_/g, ' ')}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
