'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';
import api, { providersAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

const blankItem = () => ({ drug_name: '', dosage: '', quantity: '', instructions: '' });
const patientName = (row) => row.full_name || [row.firstName || row.first_name, row.lastName || row.last_name].filter(Boolean).join(' ') || 'Patient';

function PrescriptionWorkspace() {
  const { user } = useAuth();
  const query = useSearchParams();
  const requestedPatient = query.get('patientId') || '';
  const requestedAppointment = query.get('appointmentId') || '';
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [contextError, setContextError] = useState('');
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const [form, setForm] = useState({ patientUserId: '', appointmentId: '', preferredPharmacyId: '', diagnosis: '', notes: '', fulfillmentPreference: 'pickup_or_delivery', items: [blankItem()] });

  useEffect(() => {
    if (!user?.id) return undefined;
    const current = ++generation.current;
    setLoading(true); setSaving(false); setData({}); setContextError(''); setNotice(''); setSubmitError('');
    const patients = async () => {
      const [{ data: shared }, { data: access }] = await Promise.all([providersAPI.getPatients({ limit: 100 }), api.get('/ng/providers/me/access')]);
      if (!shared.success || !Array.isArray(shared.patients)) throw new Error();
      const providerId = access.providerAccess?.provider?.id || access.providerAccess?.providerId || access.providerAccess?.id;
      if (!providerId) throw new Error();
      const [{ data: native }, { data: appointments }] = await Promise.all([
        api.get(`/ng/providers/${providerId}/patients`),
        api.get(`/ng/providers/${providerId}/appointments`, { params: { limit: 100 } }),
      ]);
      if (!Array.isArray(native.patients) || !Array.isArray(appointments.appointments)) throw new Error();
      const rows = new Map([...shared.patients, ...native.patients].map((row) => [row.id, row]));
      for (const appointment of appointments.appointments) {
        if (appointment.patient_user_id && !rows.has(appointment.patient_user_id)) rows.set(appointment.patient_user_id, { id: appointment.patient_user_id, full_name: appointment.patient_name });
      }
      return { rows: [...rows.values()], appointments: appointments.appointments };
    };
    const requests = [
      ['patients', patients],
      ['pharmacies', async () => { const { data } = await api.get('/ng/providers/pharmacies'); if (!Array.isArray(data.pharmacies)) throw new Error(); return { rows: data.pharmacies.filter((row) => row.status === 'approved') }; }],
      ['prescriptions', async () => { const { data } = await api.get('/ng/providers/prescriptions'); if (!Array.isArray(data.prescriptions)) throw new Error(); return { rows: data.prescriptions }; }],
    ];
    Promise.all(requests.map(async ([key, load]) => { try { return [key, await load()]; } catch { return [key, { error: true }]; } })).then((results) => {
      if (generation.current !== current) return;
      const next = Object.fromEntries(results); setData(next); setLoading(false);
      const appointment = next.patients?.appointments?.find((row) => row.id === requestedAppointment);
      const patientId = requestedPatient || appointment?.patient_user_id || '';
      const linked = !requestedAppointment || (appointment && appointment.patient_user_id === patientId);
      const knownPatient = next.patients?.rows?.some((row) => row.id === patientId);
      if ((requestedPatient || requestedAppointment) && (!linked || !knownPatient)) {
        setContextError('The consultation context could not be confirmed. Open the patient chart or select an assigned patient before prescribing.');
        setForm((old) => ({ ...old, patientUserId: '', appointmentId: '' }));
      } else if (patientId) {
        setForm((old) => ({ ...old, patientUserId: patientId, appointmentId: requestedAppointment }));
      }
    });
    return () => { generation.current = current + 1; };
  }, [user?.id, requestedPatient, requestedAppointment, revision]);

  function updateItem(index, field, value) {
    setForm((old) => ({ ...old, items: old.items.map((item, position) => position === index ? { ...item, [field]: value } : item) }));
  }
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setNotice(''); setSubmitError('');
    const items = form.items.map((item) => Object.fromEntries(Object.entries(item).map(([key,value]) => [key,value.trim()]))).filter((item) => item.drug_name);
    if (!data.patients?.rows?.some((row) => row.id === form.patientUserId) || !items.length) { setSubmitError('Choose an assigned patient and enter at least one medication.'); return; }
    const current = generation.current; setSaving(true);
    try {
      const { data: response } = await api.post('/ng/providers/prescriptions', { ...form, items, appointmentId: form.appointmentId || null, preferredPharmacyId: form.preferredPharmacyId || null, routedPharmacyId: form.preferredPharmacyId || null });
      if (!response.prescription?.id) throw new Error();
      if (generation.current !== current) return;
      setData((old) => ({ ...old, prescriptions: { rows: [response.prescription, ...(old.prescriptions?.rows || [])] } }));
      setNotice(response.prescription.status === 'routed' ? 'Prescription created. The selected pharmacy has not yet confirmed fulfillment.' : 'Prescription created. Pharmacy fulfillment has not been requested.');
      setForm((old) => ({ ...old, items: [blankItem()], diagnosis: '', notes: '' }));
    } catch (error) { if (generation.current === current) setSubmitError(error.response?.data?.error || 'The prescription could not be confirmed. Check prescription activity before submitting again.'); }
    finally { if (generation.current === current) setSaving(false); }
  }
  const patients = data.patients?.rows || [];
  const prescriptions = data.prescriptions?.rows || [];
  const field = 'mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base';
  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Prescriptions" description="Prescribe for an assigned patient and follow the recorded pharmacy response.">
      <Link href="/ng/provider/patients"><Button variant="outline">Patient charts</Button></Link>
      <Button variant="outline" disabled={loading || saving} onClick={() => setRevision((value) => value + 1)}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
    </PortalPageHeader>
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-4 text-blue-900">{notice}</p>}
    {(submitError || contextError) && <p role="alert" className="portal-error">{submitError || contextError}</p>}
    {Object.entries(data).filter(([,value]) => value.error).map(([key]) => <p key={key} role="alert" className="portal-error">{key === 'patients' ? 'Assigned patients and consultation context' : key === 'pharmacies' ? 'Pharmacies' : 'Prescription activity'} could not be loaded. Select Refresh to try again.</p>)}
    <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
      <section className="portal-surface">
        <h2 className="text-xl font-semibold">New prescription</h2>
        {loading ? <p role="status" className="mt-4">Loading prescribing workspace…</p> : <form className="mt-5" onSubmit={submit}><fieldset disabled={saving} className="space-y-5">
          <label className="block font-medium" htmlFor="rx-patient">Patient<select id="rx-patient" className={field} value={form.patientUserId} required disabled={saving || data.patients?.error} onChange={(event) => { setContextError(''); setForm((old) => ({ ...old, patientUserId: event.target.value, appointmentId: '' })); }}><option value="">Choose an assigned patient</option>{patients.map((row) => <option key={row.id} value={row.id}>{patientName(row)}</option>)}</select></label>
          {!data.patients?.error && !patients.length && <p className="text-slate-600">No assigned patients are available. Start from a patient encounter.</p>}
          {form.appointmentId && <p className="text-slate-600">Linked to the selected consultation.</p>}
          <label className="block font-medium" htmlFor="rx-pharmacy">Preferred pharmacy<select id="rx-pharmacy" className={field} value={form.preferredPharmacyId} disabled={saving || data.pharmacies?.error} onChange={(event) => setForm((old) => ({ ...old, preferredPharmacyId: event.target.value }))}><option value="">Choose later</option>{(data.pharmacies?.rows || []).map((row) => <option key={row.id} value={row.id}>{row.name} · {[row.city,row.state].filter(Boolean).join(', ')}</option>)}</select></label>
          <label className="block font-medium" htmlFor="rx-diagnosis">Clinical indication<input id="rx-diagnosis" className={field} maxLength={255} value={form.diagnosis} onChange={(event) => setForm((old) => ({ ...old, diagnosis: event.target.value }))} /></label>
          {form.items.map((item,index) => <fieldset key={index} className="rounded-xl border border-slate-200 p-4"><legend className="px-2 font-semibold">Medication {index + 1}</legend><div className="grid gap-4 sm:grid-cols-2">{[['drug_name','Medication name'],['dosage','Dose and strength'],['quantity','Quantity'],['instructions','Directions']].map(([key,label]) => <label key={key} className="block" htmlFor={`rx-${index}-${key}`}>{label}<input id={`rx-${index}-${key}`} className={field} maxLength={key === 'instructions' ? 1000 : 255} required={key === 'drug_name'} value={item[key]} onChange={(event) => updateItem(index,key,event.target.value)} /></label>)}</div>{form.items.length > 1 && <Button type="button" className="mt-3" variant="outline" disabled={saving} onClick={() => setForm((old) => ({ ...old, items: old.items.filter((_,position) => position !== index) }))}>Remove medication {index + 1}</Button>}</fieldset>)}
          <Button type="button" variant="outline" disabled={saving || form.items.length >= 20} onClick={() => setForm((old) => ({ ...old, items: [...old.items, blankItem()] }))}><Plus className="mr-2 h-5 w-5" aria-hidden="true" />Add medication</Button>
          <label className="block font-medium" htmlFor="rx-fulfillment">Fulfillment preference<select id="rx-fulfillment" className={field} value={form.fulfillmentPreference} onChange={(event) => setForm((old) => ({ ...old, fulfillmentPreference: event.target.value }))}><option value="pickup_or_delivery">Pickup or delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
          <label className="block font-medium" htmlFor="rx-notes">Pharmacy instructions<textarea id="rx-notes" className={field} rows={3} maxLength={4000} value={form.notes} onChange={(event) => setForm((old) => ({ ...old, notes: event.target.value }))} /></label>
          <p className="text-slate-600">Confirm the patient's medication and allergy history in the chart before prescribing. Pharmacy acceptance and dispensing are separate recorded steps.</p>
          <Button type="submit" className="w-full bg-blue-600 text-white hover:bg-blue-700" disabled={saving || Boolean(data.patients?.error) || !form.patientUserId}>{saving ? 'Creating prescription…' : 'Create prescription'}</Button>
        </fieldset></form>}
      </section>
      <section className="portal-surface"><h2 className="text-xl font-semibold">Prescription activity</h2>{loading ? <p role="status" className="mt-4">Loading prescriptions…</p> : data.prescriptions?.error ? <p className="mt-4 text-slate-600">Activity is temporarily unavailable.</p> : !prescriptions.length ? <p className="portal-empty mt-4">No prescriptions have been recorded.</p> : <ul className="mt-4 divide-y divide-slate-200">{prescriptions.map((row) => <li key={row.id} className="space-y-2 py-4"><p className="font-semibold">{row.prescription_number || 'Prescription'}</p><p>{[row.patient_first_name,row.patient_last_name].filter(Boolean).join(' ') || patientName(patients.find((patient) => patient.id === row.patient_user_id) || {})}</p><p className="text-slate-600">Pharmacy: {row.pharmacy_name || 'No confirmed pharmacy response'}</p><p className="text-slate-600">Status: {String(row.pharmacy_response_status || row.dispense_status || row.status || 'Unknown').replace(/_/g,' ')}</p></li>)}</ul>}</section>
    </div>
  </div>;
}

export default function NigeriaProviderPrescriptionsPage() {
  return <Suspense fallback={<p role="status">Loading prescribing workspace…</p>}><PrescriptionWorkspace /></Suspense>;
}
