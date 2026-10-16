'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { deliveryError, requestKey } from '@/lib/ngDeliveryApi';
import { Button } from '@/components/ui/button';
import { DeliveryNotice, deliveryButtonClass, deliveryCardClass, deliveryInputClass } from './DeliveryPresentation';

export default function MedicationOrderStart({ onCreated }) {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const active = useRef(false);
  const lock = useRef(false);
  const intent = useRef({});
  const abort = useRef(null);

  useEffect(() => {
    active.current = true; const controller = new AbortController(); abort.current = controller;
    api.get('/ng/patient/order-options', { signal: controller.signal }).then(response => {
      if (!Array.isArray(response.data?.prescriptions)) throw new Error('Eligible prescriptions could not be confirmed.');
      if (active.current && !controller.signal.aborted) setOptions(response.data.prescriptions.filter(option => option?.id && ['digital', 'uploaded'].includes(option.kind) && option.pharmacyId && Array.isArray(option.items) && option.items.length));
    }).catch(failure => { if (active.current && !controller.signal.aborted) setError(deliveryError(failure)); }).finally(() => { if (active.current && !controller.signal.aborted) setLoading(false); });
    return () => { active.current = false; controller.abort(); };
  }, []);

  const start = async event => {
    event.preventDefault();
    const option = options.find(row => `${row.kind}:${row.id}` === selected);
    if (!option || lock.current || !active.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (!intent.current[selected]) intent.current[selected] = requestKey();
      const response = await api.post('/ng/patient/orders', {
        ...(option.kind === 'digital' ? { digitalPrescriptionId: option.id } : { prescriptionId: option.id }),
        pharmacyId: option.pharmacyId, items: option.items.map(item => ({ drugId: item.drugId, quantity: item.quantity })),
        deliveryType: 'pickup', idempotencyKey: intent.current[selected],
      }, { signal: abort.current?.signal });
      const orderId = response.data?.order?.id;
      if (!orderId) throw new Error('The new order could not be confirmed. Refresh your order list before retrying.');
      if (!active.current || abort.current?.signal.aborted) return;
      setExpanded(false); onCreated(orderId);
    } catch (failure) {
      if (active.current && !abort.current?.signal.aborted) setError(deliveryError(failure));
    } finally { lock.current = false; if (active.current) setBusy(false); }
  };

  return <section className={deliveryCardClass} aria-label="Start a prescription order">
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-blue-700" aria-hidden="true" /><div><h2 className="text-xl font-semibold text-slate-950">Order from a verified prescription</h2><p className="mt-2 max-w-2xl leading-7 text-slate-600">Use a reviewed prescription routed to an approved pharmacy. The pharmacist confirms the final medicine price before you pay.</p></div></div><Button variant="outline" className={deliveryButtonClass} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><Plus className="mr-2 h-5 w-5" aria-hidden="true" />Start an order</Button></div>
    {expanded && <div className="mt-5 space-y-4"><DeliveryNotice error>{error}</DeliveryNotice>{loading ? <p role="status" className="text-slate-600">Checking eligible prescriptions…</p> : options.length ? <form onSubmit={start} className="space-y-4"><label className="block font-medium text-slate-900" htmlFor="eligible-prescription">Prescription and pharmacy</label><select id="eligible-prescription" value={selected} onChange={event => setSelected(event.target.value)} required disabled={busy} className={deliveryInputClass}><option value="">Choose a reviewed prescription</option>{options.map(option => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.pharmacyName} · {option.items.map(item => `${item.name} × ${item.quantity}`).join(', ')}</option>)}</select><Button type="submit" className={`${deliveryButtonClass} bg-blue-700 hover:bg-blue-800`} disabled={!selected || busy}>{busy ? 'Creating your order…' : 'Send to pharmacy for final confirmation'}</Button></form> : !error && <p className="leading-7 text-slate-600">No eligible prescription is ready to order. Your prescription must be reviewed and routed to a pharmacy with verified stock.</p>}</div>}
  </section>;
}
