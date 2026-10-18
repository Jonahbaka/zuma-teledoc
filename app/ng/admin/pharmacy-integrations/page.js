'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { deliveryError, formatKobo, koboInput, nairaInputToKobo, statusLabel } from '@/lib/ngDeliveryApi';
import { DeliveryNotice, deliveryButtonClass, deliveryCardClass, deliveryInputClass } from '@/components/ng/delivery/DeliveryPresentation';

const approvals = [
  ['nda', 'Executed confidentiality agreement'], ['commercialAgreement', 'Executed commercial agreement'],
  ['dataSharing', 'Approved data-sharing and processing terms'], ['catalogueRights', 'Catalogue and pricing permission'],
  ['paymentArrangement', 'Approved payment and settlement arrangement'], ['feeSchedule', 'Agreed patient fee schedule'],
  ['operationalAcceptance', 'Completed operational acceptance'], ['publicity', 'Public name and branding permission · optional'],
];
const blank = { code: '', displayName: '', status: 'draft', orderFee: '', deliveryFee: '', quoteSeconds: '', stockSeconds: '', approvals: {} };

function ProfileForm({ profile, busy, onSave }) {
  const [form, setForm] = useState(profile ? {
    code: profile.code, displayName: profile.display_name, status: profile.status,
    orderFee: koboInput(profile.fees.orderServiceMinor), deliveryFee: koboInput(profile.fees.deliverySupportMinor),
    quoteSeconds: profile.settings.quoteValiditySeconds ?? '', stockSeconds: profile.settings.inventoryMaxAgeSeconds ?? '', approvals: profile.approvals,
  } : blank);
  const [error, setError] = useState('');
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = event => {
    event.preventDefault(); setError('');
    try {
      onSave(profile?.id, {
        code: form.code.trim(), displayName: form.displayName.trim(), status: form.status, version: profile?.version,
        fees: { currency: 'NGN', orderServiceMinor: nairaInputToKobo(form.orderFee), deliverySupportMinor: nairaInputToKobo(form.deliveryFee) },
        approvals: form.approvals,
        settings: { mode: 'pharmacist_portal', quoteValiditySeconds: form.quoteSeconds === '' ? null : Number(form.quoteSeconds), inventoryMaxAgeSeconds: form.stockSeconds === '' ? null : Number(form.stockSeconds) },
      });
    } catch (failure) { setError(failure.message); }
  };
  return <form onSubmit={save} className={`${deliveryCardClass} space-y-5`}>
    <h2 className="text-2xl font-semibold text-slate-950">{profile ? 'Review commercial configuration' : 'New pharmacy integration'}</h2>
    <p className="leading-7 text-slate-600">Record private evidence references, not agreement files, credentials or patient information. Activation requires all mandatory approvals and agreed quote and stock validity periods.</p>
    <DeliveryNotice error>{error}</DeliveryNotice>
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2 font-medium"><span>Integration code</span><input required pattern="[a-z0-9][a-z0-9_-]{2,79}" disabled={!!profile} className={deliveryInputClass} value={form.code} onChange={event => change('code', event.target.value)} /></label>
        <label className="space-y-2 font-medium"><span>Private integration name</span><input required maxLength={500} className={deliveryInputClass} value={form.displayName} onChange={event => change('displayName', event.target.value)} /></label>
        <label className="space-y-2 font-medium"><span>Order service fee · NGN</span><input required inputMode="decimal" className={deliveryInputClass} value={form.orderFee} onChange={event => change('orderFee', event.target.value)} /></label>
        <label className="space-y-2 font-medium"><span>Delivery support fee · NGN</span><input required inputMode="decimal" className={deliveryInputClass} value={form.deliveryFee} onChange={event => change('deliveryFee', event.target.value)} /></label>
        <label className="space-y-2 font-medium"><span>Agreed pharmacy quote validity · seconds</span><input type="number" min="60" max="86400" step="1" className={deliveryInputClass} value={form.quoteSeconds} onChange={event => change('quoteSeconds', event.target.value)} /></label>
        <label className="space-y-2 font-medium"><span>Agreed verified stock validity · seconds</span><input type="number" min="60" max="86400" step="1" className={deliveryInputClass} value={form.stockSeconds} onChange={event => change('stockSeconds', event.target.value)} /></label>
      </div>
      <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
        <h3 className="text-xl font-semibold text-slate-950">Agreement and acceptance evidence</h3>
        {approvals.map(([key, label]) => <label key={key} className="block space-y-2 font-medium"><span>{label}</span><input maxLength={500} className={deliveryInputClass} value={form.approvals[key] || ''} onChange={event => change('approvals', { ...form.approvals, [key]: event.target.value })} autoComplete="off" /></label>)}
      </div>
      <label className="block space-y-2 font-medium"><span>Status</span><select className={deliveryInputClass} value={form.status} onChange={event => change('status', event.target.value)}>{['draft', 'testing', 'active', 'suspended'].map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <p className="leading-7 text-slate-600">The approved pharmacist portal is the available integration mode. External APIs, catalogue feeds, insurer funding, savings and memberships require separate validated activation. Existing orders keep their accepted fee schedule.</p>
      <Button type="submit" className={`${deliveryButtonClass} bg-blue-700 hover:bg-blue-800`}>{busy ? 'Saving configuration…' : 'Save configuration'}</Button>
    </fieldset>
  </form>;
}

function BranchForm({ profile, pharmacies, busy, onBind }) {
  const [pharmacyId, setPharmacyId] = useState('');
  const [branchReference, setBranchReference] = useState('');
  const [approvalReference, setApprovalReference] = useState('');
  return <form className="space-y-4 border-t border-slate-200 pt-5" onSubmit={event => { event.preventDefault(); onBind(profile.id, { pharmacyId, branchReference, approvalReference }); }}>
    <h3 className="text-xl font-semibold text-slate-950">Authorize a pharmacy branch</h3>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block space-y-2 font-medium"><span>Approved pharmacy</span><select required className={deliveryInputClass} value={pharmacyId} onChange={event => setPharmacyId(event.target.value)}><option value="">Select a licensed pharmacy</option>{pharmacies.map(pharmacy => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name} · {[pharmacy.city, pharmacy.state].filter(Boolean).join(', ')}</option>)}</select></label>
      <label className="block space-y-2 font-medium"><span>Partner branch reference</span><input required maxLength={500} className={deliveryInputClass} value={branchReference} onChange={event => setBranchReference(event.target.value)} /></label>
      <label className="block space-y-2 font-medium"><span>Branch authorization evidence reference</span><input required maxLength={500} className={deliveryInputClass} value={approvalReference} onChange={event => setApprovalReference(event.target.value)} /></label>
      <Button type="submit" variant="outline" className={deliveryButtonClass}>Authorize branch</Button>
    </fieldset>
  </form>;
}

export default function PharmacyIntegrationsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(undefined);
  const active = useRef(false); const controller = useRef(null); const lock = useRef(false);
  const load = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const response = await api.get('/ng/admin/pharmacy-integrations', { signal: abort.signal });
      if (!Array.isArray(response.data?.profiles) || !Array.isArray(response.data?.pharmacies)) throw new Error('The integration register could not be confirmed.');
      if (active.current && !abort.signal.aborted) setData(response.data);
    } catch (failure) { if (active.current && !abort.signal.aborted) { setData(null); setError(deliveryError(failure)); } }
  }, []);
  useEffect(() => { active.current = true; load(); return () => { active.current = false; controller.current?.abort(); }; }, [load]);
  const mutate = async (url, body, method = 'post') => {
    if (lock.current || !active.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await api[method](url, body, { signal: controller.current?.signal });
      if (!active.current) return;
      setEditing(undefined); setNotice('Configuration saved with an audit record. Review the recorded status before enabling a branch.'); await load();
    } catch (failure) { if (active.current && !controller.current?.signal.aborted) setError(deliveryError(failure)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  const canWrite = user?.role === 'super_admin';
  return <div className="space-y-6 text-base text-slate-800">
    <PortalPageHeader eyebrow="DoctaRx administration" title="Pharmacy integrations" description="Control branch access, commercial terms and activation evidence in one private register." />
    <DeliveryNotice error>{error}</DeliveryNotice><DeliveryNotice>{notice}</DeliveryNotice>
    <section className={`${deliveryCardClass} flex items-start gap-4`}><ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-blue-700" aria-hidden="true" /><p className="leading-7">A proposal or confidentiality agreement alone does not activate a partnership. Public partner branding, clinical data exchange and live courier bookings each require their own authorization. General pharmacy and consultation pricing remain separate.</p></section>
    {canWrite && <Button variant="outline" disabled={busy} className={deliveryButtonClass} onClick={() => setEditing(null)}>Add pharmacy integration</Button>}
    {editing !== undefined && canWrite && <ProfileForm key={editing?.id || 'new'} profile={editing} busy={busy} onSave={(id, body) => mutate(`/ng/admin/pharmacy-integrations${id ? `/${id}` : ''}`, body, id ? 'patch' : 'post')} />}
    {!data && !error && <p role="status">Loading the private integration register…</p>}
    {data?.profiles.length === 0 && <p className={deliveryCardClass}>No commercial profiles are recorded. General pharmacy pricing applies to unassigned pharmacies.</p>}
    {data?.profiles.map(profile => <section key={profile.id} className={`${deliveryCardClass} space-y-5`}>
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold text-slate-950">{profile.display_name}</h2><p className="mt-2 leading-7 text-slate-600">{statusLabel(profile.status)} · Version {profile.version}</p></div>{canWrite && <Button variant="outline" className={deliveryButtonClass} disabled={busy} onClick={() => setEditing(profile)}>Review configuration</Button>}</div>
      <dl className="grid gap-4 sm:grid-cols-2"><div><dt>Order service · earned on fulfillment</dt><dd className="mt-1 text-xl font-semibold">{formatKobo(profile.fees.orderServiceMinor)}</dd></div><div><dt>Delivery support · earned on delivery</dt><dd className="mt-1 text-xl font-semibold">{formatKobo(profile.fees.deliverySupportMinor)}</dd></div></dl>
      <div className="space-y-3"><h3 className="text-xl font-semibold">Authorized branches</h3>{profile.branches.length ? profile.branches.map(branch => <p key={branch.pharmacyId} className="rounded-xl bg-slate-50 p-4 leading-7">{branch.pharmacyName} · {branch.branchReference}</p>) : <p className="leading-7 text-slate-600">No pharmacy branch is assigned.</p>}</div>
      {canWrite && profile.status === 'active' && <BranchForm profile={profile} pharmacies={data.pharmacies} busy={busy} onBind={(id, body) => mutate(`/ng/admin/pharmacy-integrations/${id}/branches`, body)} />}
    </section>)}
  </div>;
}
