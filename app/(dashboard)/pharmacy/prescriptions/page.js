'use client';

import { useState } from 'react';
import {
  Pill, CheckCircle, XCircle, Clock, AlertCircle,
  Search, Filter, RefreshCw, Banknote, Package,
  MessageSquare, User, ChevronDown, Truck, Phone
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const PRESCRIPTIONS = [
  {
    id: 'RX-2026-001', patient: 'Chioma Adebayo', patientPhone: '+234 803 xxx xxxx',
    doctor: 'Dr. Adaeze Okafor', doctorSpecialty: 'General Practice',
    medications: [
      { name: 'Amoxicillin 500mg', qty: 21, dosage: '1 capsule 3x daily', inStock: true, price: 2100 },
      { name: 'Paracetamol 500mg', qty: 10, dosage: '2 tablets as needed', inStock: true, price: 350 },
    ],
    status: 'pending', createdAt: '2026-03-17T09:30:00', fulfillment: 'pickup',
    notes: 'Patient has penicillin sensitivity — confirmed amoxicillin is appropriate.'
  },
  {
    id: 'RX-2026-002', patient: 'Emeka Okonkwo', patientPhone: '+234 812 xxx xxxx',
    doctor: 'Dr. Ibrahim Yusuf', doctorSpecialty: 'Internal Medicine',
    medications: [
      { name: 'Metformin 850mg', qty: 60, dosage: '1 tablet 2x daily', inStock: true, price: 3600 },
      { name: 'Glimepiride 2mg', qty: 30, dosage: '1 tablet daily before breakfast', inStock: false, price: 2800 },
    ],
    status: 'pending', createdAt: '2026-03-17T09:05:00', fulfillment: 'delivery',
    notes: 'Chronic patient — ensure refill reminders.'
  },
  {
    id: 'RX-2026-003', patient: 'Fatima Musa', patientPhone: '+234 708 xxx xxxx',
    doctor: 'Dr. Nkechi Adaeze', doctorSpecialty: 'Cardiology',
    medications: [
      { name: 'Amlodipine 5mg', qty: 30, dosage: '1 tablet daily', inStock: true, price: 1500 },
    ],
    status: 'confirmed', createdAt: '2026-03-17T08:15:00', fulfillment: 'pickup',
    notes: ''
  },
  {
    id: 'RX-2026-004', patient: 'Blessing Eze', patientPhone: '+234 905 xxx xxxx',
    doctor: 'Dr. Chukwu Obi', doctorSpecialty: 'General Practice',
    medications: [
      { name: 'Augmentin 625mg', qty: 14, dosage: '1 tablet 2x daily', inStock: true, price: 4200 },
      { name: 'Ibuprofen 400mg', qty: 12, dosage: '1 tablet 3x daily after meals', inStock: true, price: 450 },
      { name: 'Omeprazole 20mg', qty: 14, dosage: '1 capsule daily before breakfast', inStock: true, price: 1400 },
    ],
    status: 'ready', createdAt: '2026-03-17T07:30:00', fulfillment: 'delivery',
    notes: 'Patient prefers delivery to Victoria Island office.'
  },
];

const STATUS_MAP = {
  pending: { label: 'Pending Review', color: 'bg-yellow-500', textColor: 'text-yellow-600', bgLight: 'bg-yellow-500/10' },
  confirmed: { label: 'Stock Confirmed', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-500/10' },
  priced: { label: 'Priced', color: 'bg-indigo-500', textColor: 'text-indigo-600', bgLight: 'bg-indigo-500/10' },
  ready: { label: 'Ready', color: 'bg-emerald-500', textColor: 'text-emerald-600', bgLight: 'bg-emerald-500/10' },
  dispatched: { label: 'Dispatched', color: 'bg-purple-500', textColor: 'text-purple-600', bgLight: 'bg-purple-500/10' },
  delivered: { label: 'Delivered', color: 'bg-slate-400', textColor: 'text-slate-600', bgLight: 'bg-slate-100' },
  rejected: { label: 'Rejected', color: 'bg-red-500', textColor: 'text-red-600', bgLight: 'bg-red-500/10' },
};

export default function PharmacyPrescriptionsPage() {
  const [search, setSearch] = useState('');
  const [selectedRx, setSelectedRx] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = PRESCRIPTIONS.filter(rx => {
    const matchSearch = !search || rx.patient.toLowerCase().includes(search.toLowerCase()) || rx.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || rx.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const detail = selectedRx ? PRESCRIPTIONS.find(r => r.id === selectedRx) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Prescriptions</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage incoming prescriptions from doctors</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by patient name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'pending', 'confirmed', 'ready'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${statusFilter === f ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20' : 'text-muted-foreground hover:bg-accent border border-border'}`}>
              {f === 'all' ? 'All' : STATUS_MAP[f]?.label || f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Prescription List */}
        <div className="lg:col-span-2 space-y-3">
          {filtered.map(rx => {
            const st = STATUS_MAP[rx.status];
            return (
              <button key={rx.id} onClick={() => setSelectedRx(rx.id)}
                className={`w-full text-left bg-card rounded-xl border p-4 transition-all ${selectedRx === rx.id ? 'border-purple-500 shadow-lg shadow-purple-500/10' : 'border-border hover:border-purple-500/20'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground">{rx.id}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bgLight} ${st.textColor}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${st.color}`} />
                    {st.label}
                  </span>
                </div>
                <div className="text-sm font-bold text-foreground">{rx.patient}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rx.doctor} &bull; {rx.medications.length} item{rx.medications.length > 1 ? 's' : ''}</div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {rx.fulfillment === 'delivery' ? <Truck size={10} /> : <Package size={10} />}
                    {rx.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">&bull;</span>
                  <span className="text-[10px] text-muted-foreground">
                    ₦{rx.medications.reduce((s, m) => s + m.price, 0).toLocaleString()}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-3">
          {!detail ? (
            <Card className="h-full flex items-center justify-center min-h-[400px]">
              <CardContent className="text-center">
                <Pill className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-muted-foreground">Select a prescription to view details</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{detail.patient}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{detail.id} &bull; {detail.doctor} ({detail.doctorSpecialty})</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_MAP[detail.status].bgLight} ${STATUS_MAP[detail.status].textColor}`}>
                    <div className={`w-2 h-2 rounded-full ${STATUS_MAP[detail.status].color}`} />
                    {STATUS_MAP[detail.status].label}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Medications */}
                <div>
                  <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2"><Pill size={16} className="text-purple-500" /> Medications</h4>
                  <div className="space-y-3">
                    {detail.medications.map((med, idx) => (
                      <div key={idx} className="bg-muted/50 rounded-xl p-4 border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-foreground">{med.name}</span>
                          <div className="flex items-center gap-2">
                            {med.inStock ? (
                              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> In Stock</span>
                            ) : (
                              <span className="text-[10px] font-semibold text-red-600 bg-red-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"><XCircle size={10} /> Out of Stock</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">Qty: {med.qty} &bull; {med.dosage}</div>
                        <div className="text-sm font-bold text-foreground mt-2">₦{med.price.toLocaleString()}</div>
                        {!med.inStock && (
                          <Button size="sm" variant="outline" className="mt-2 text-xs h-7">
                            <RefreshCw className="w-3 h-3 mr-1" /> Suggest Substitute
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <span className="text-sm font-bold text-foreground">Total</span>
                    <span className="text-lg font-bold text-foreground">₦{detail.medications.reduce((s, m) => s + m.price, 0).toLocaleString()}</span>
                  </div>
                </div>

                {/* Patient & Fulfillment */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-muted/50 rounded-xl p-4 border border-border">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Patient</h4>
                    <div className="text-sm font-medium text-foreground">{detail.patient}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Phone size={10} /> {detail.patientPhone}</div>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-4 border border-border">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Fulfillment</h4>
                    <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      {detail.fulfillment === 'delivery' ? <Truck size={14} /> : <Package size={14} />}
                      {detail.fulfillment === 'delivery' ? 'Delivery Requested' : 'Patient Pickup'}
                    </div>
                  </div>
                </div>

                {detail.notes && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Doctor&apos;s Notes</h4>
                    <p className="text-sm text-foreground">{detail.notes}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-3 pt-2">
                  {detail.status === 'pending' && (
                    <>
                      <Button className="bg-emerald-600 hover:bg-emerald-500 text-white flex-1">
                        <CheckCircle className="w-4 h-4 mr-2" /> Confirm Stock &amp; Price
                      </Button>
                      <Button variant="outline" className="border-red-500/20 text-red-500 hover:bg-red-500/10">
                        <XCircle className="w-4 h-4 mr-2" /> Reject
                      </Button>
                    </>
                  )}
                  {detail.status === 'confirmed' && (
                    <Button className="bg-blue-600 hover:bg-blue-500 text-white flex-1">
                      <Package className="w-4 h-4 mr-2" /> Mark as Ready
                    </Button>
                  )}
                  {detail.status === 'ready' && (
                    <Button className="bg-purple-600 hover:bg-purple-500 text-white flex-1">
                      <Truck className="w-4 h-4 mr-2" /> Mark as Dispatched
                    </Button>
                  )}
                  <Button variant="outline">
                    <MessageSquare className="w-4 h-4 mr-2" /> Message Patient
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
