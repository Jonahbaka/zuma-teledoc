'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function amountText(amount, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount / 100);
}

export default function ConsultationBilling() {
  const [invoices, setInvoices] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [appointmentId, setAppointmentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/ng/billing/invoices');
      setInvoices(data.invoices || []);
      const appointmentResponse = await api.get('/appointments');
      if (!appointmentResponse.data?.success) throw new Error('Appointment list is unavailable.');
      setAppointments((appointmentResponse.data.appointments || []).filter((item) => item.paymentRequired && !item.paymentCompleted && !['cancelled', 'completed', 'no_show'].includes(item.status)));
    } catch (failure) { setError(failure.response?.data?.error || 'Consultation invoices could not be loaded.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(invoice, operation) {
    setBusy(invoice.id); setError(''); setNotice('');
    try {
      const { data } = await api.post(`/ng/billing/invoices/${invoice.id}/${operation}`);
      if (operation === 'checkout' && data.authorizationUrl) { window.location.assign(data.authorizationUrl); return; }
      setNotice(operation === 'refund-request' ? 'Refund requested for review. Funds have not been returned.' : data.status === 'paid' ? 'Payment confirmed by the server.' : 'Payment is awaiting verification or reconciliation.');
      await load();
    } catch (failure) { setError(failure.response?.data?.error || 'The billing request could not be completed.'); }
    finally { setBusy(''); }
  }

  async function createInvoice(event) {
    event.preventDefault(); if (!appointmentId) return;
    setBusy('create'); setError('');
    try {
      await api.post('/ng/billing/invoices', { appointmentId });
      setNotice('Invoice created using the approved consultation tariff.');
      await load();
    } catch (failure) { setError(failure.response?.data?.error || 'Invoice could not be created.'); }
    finally { setBusy(''); }
  }

  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 text-base">
    <div><h1 className="text-2xl font-semibold">Consultation payments</h1><p className="mt-2 text-slate-600">Review your invoice and payment status. Returning from checkout does not confirm payment.</p></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><Button className="mt-3" variant="outline" onClick={load}>Retry loading</Button></div>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
    {appointments.length > 0 && <form onSubmit={createInvoice} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <label htmlFor="invoice-appointment" className="block font-medium">Request an invoice for your consultation</label>
      <select id="invoice-appointment" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} required>
        <option value="">Choose an appointment</option>{appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{new Date(appointment.scheduledAt).toLocaleString('en-NG')} · {appointment.type}</option>)}
      </select>
      <p className="text-slate-600">The server checks whether payment is required and whether an approved tariff is available.</p>
      <Button type="submit" disabled={busy === 'create'}>{busy === 'create' ? 'Checking tariff…' : 'Request invoice'}</Button>
    </form>}
    {loading ? <p role="status">Loading invoices…</p> : invoices.length === 0 ? <Card><CardContent className="p-6"><p>{error ? 'Invoice data is unavailable.' : 'No consultation invoices are available.'}</p><p className="mt-2 text-slate-600">Sponsored care and insurance arrangements are handled separately. A patient invoice requires an approved tariff and activated checkout.</p><Link href="/ng/patient/appointments" className="mt-4 inline-flex min-h-11 items-center font-medium text-emerald-700">View appointments</Link></CardContent></Card> : invoices.map((invoice) => <Card key={invoice.id}>
      <CardHeader><CardTitle className="text-xl">{amountText(invoice.amountMinor, invoice.currency)}</CardTitle><p className="text-slate-600">{invoice.fundingSource === 'patient_copay' ? 'Patient contribution' : 'Consultation fee'} · {invoice.status.replaceAll('_', ' ')}</p></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-slate-600">Invoice reference: {invoice.id}</p>
        {invoice.attemptStatus === 'reconciliation' && <p role="status" className="text-amber-800">The existing payment attempt needs reconciliation. Do not start another payment.</p>}
        {invoice.paidAt && <p>Recorded paid: {new Date(invoice.paidAt).toLocaleString('en-NG')}</p>}
        {invoice.receipt && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-medium">Payment receipt</summary><dl className="mt-3 space-y-2"><div><dt className="font-medium">Transaction reference</dt><dd className="break-all">{invoice.receipt.reference}</dd></div><div><dt className="font-medium">Amount received</dt><dd>{amountText(invoice.receipt.amountMinor, invoice.receipt.currency)}</dd></div><div><dt className="font-medium">Provider</dt><dd>Paystack</dd></div></dl></details>}
        <div className="flex flex-wrap gap-3">
          {invoice.status === 'open' && !['initializing', 'reconciliation', 'confirmed'].includes(invoice.attemptStatus) && <Button onClick={() => act(invoice, 'checkout')} disabled={busy === invoice.id}>Pay securely</Button>}
          {invoice.attemptStatus && invoice.status === 'open' && <Button variant="outline" onClick={() => act(invoice, 'verify')} disabled={busy === invoice.id}>Verify payment</Button>}
          {invoice.status === 'paid' && <Button variant="outline" onClick={() => act(invoice, 'refund-request')} disabled={busy === invoice.id}>Request a refund review</Button>}
        </div>
      </CardContent>
    </Card>)}
  </div>;
}
