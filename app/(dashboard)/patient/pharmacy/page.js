'use client';

import { useState, useEffect } from 'react';
import {
  MapPin, Loader2, Navigation, CheckCircle, Search,
  Pill, Truck, Package, Phone, Star, Clock,
  ArrowRight, Building2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';

const MOCK_PHARMACIES = [
  { id: 1, name: 'HealthPlus Pharmacy', address: '24 Admiralty Way, Lekki Phase 1', city: 'Lagos', distance: '1.2 km', rating: 4.8, reviews: 124, delivery: true, pickup: true, hours: '8am - 9pm', deliveryFee: 1500 },
  { id: 2, name: 'MedPlus Pharmacy', address: '5 Allen Avenue, Ikeja', city: 'Lagos', distance: '3.8 km', rating: 4.6, reviews: 89, delivery: true, pickup: true, hours: '7am - 10pm', deliveryFee: 1000 },
  { id: 3, name: 'Alpha Pharmacy', address: '12 Adeola Odeku St, Victoria Island', city: 'Lagos', distance: '2.1 km', rating: 4.9, reviews: 203, delivery: true, pickup: true, hours: '24 Hours', deliveryFee: 2000 },
  { id: 4, name: 'Greenlife Pharmacy', address: '7 Ogunlana Drive, Surulere', city: 'Lagos', distance: '5.4 km', rating: 4.5, reviews: 67, delivery: false, pickup: true, hours: '8am - 8pm', deliveryFee: 0 },
  { id: 5, name: 'PharmServ', address: '33 Bode Thomas St, Surulere', city: 'Lagos', distance: '6.1 km', rating: 4.3, reviews: 45, delivery: true, pickup: true, hours: '8am - 9pm', deliveryFee: 1200 },
];

const MOCK_PRESCRIPTIONS = [
  { id: 'RX-001', doctor: 'Dr. Adaeze Okafor', date: '17 Mar 2026', items: ['Amoxicillin 500mg x 21', 'Paracetamol 500mg x 10'], status: 'pending_pharmacy', pharmacy: null },
  { id: 'RX-002', doctor: 'Dr. Ibrahim Yusuf', date: '15 Mar 2026', items: ['Metformin 850mg x 60'], status: 'ready', pharmacy: 'HealthPlus Pharmacy' },
  { id: 'RX-003', doctor: 'Dr. Nkechi Adaeze', date: '10 Mar 2026', items: ['Amlodipine 5mg x 30'], status: 'delivered', pharmacy: 'MedPlus Pharmacy' },
];

const STATUS_CONFIG = {
  pending_pharmacy: { label: 'Choose Pharmacy', color: 'bg-yellow-500', textColor: 'text-yellow-600', bgLight: 'bg-yellow-500/10' },
  sent: { label: 'Sent to Pharmacy', color: 'bg-blue-500', textColor: 'text-blue-600', bgLight: 'bg-blue-500/10' },
  confirmed: { label: 'Confirmed', color: 'bg-indigo-500', textColor: 'text-indigo-600', bgLight: 'bg-indigo-500/10' },
  ready: { label: 'Ready for Pickup', color: 'bg-emerald-500', textColor: 'text-emerald-600', bgLight: 'bg-emerald-500/10' },
  dispatched: { label: 'Out for Delivery', color: 'bg-purple-500', textColor: 'text-purple-600', bgLight: 'bg-purple-500/10' },
  delivered: { label: 'Delivered', color: 'bg-slate-400', textColor: 'text-slate-600', bgLight: 'bg-slate-100' },
};

export default function PatientPharmacyPage() {
  const [tab, setTab] = useState('prescriptions');
  const [search, setSearch] = useState('');
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [selectingFor, setSelectingFor] = useState(null);

  const filteredPharmacies = MOCK_PHARMACIES.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.address.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectPharmacy = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    if (selectingFor) {
      toast({
        title: 'Prescription Sent',
        description: `Your prescription has been sent to ${pharmacy.name}. They will confirm availability and pricing shortly.`
      });
      setSelectingFor(null);
      setTab('prescriptions');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Pharmacy &amp; Medications</h1>
        <p className="text-muted-foreground mt-1">Choose a pharmacy, track prescriptions, and manage medication delivery.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-0">
        {[
          { key: 'prescriptions', label: 'My Prescriptions', icon: Pill },
          { key: 'find', label: 'Find Pharmacy', icon: MapPin }
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${tab === t.key ? 'border-purple-600 text-purple-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* Prescriptions Tab */}
      {tab === 'prescriptions' && (
        <div className="space-y-4">
          {MOCK_PRESCRIPTIONS.map(rx => {
            const st = STATUS_CONFIG[rx.status] || STATUS_CONFIG.sent;
            return (
              <Card key={rx.id} className="hover:border-purple-500/20 transition-colors">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center shrink-0">
                        <Pill size={18} className="text-purple-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-foreground">{rx.id}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bgLight} ${st.textColor}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${st.color}`} /> {st.label}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{rx.doctor} &bull; {rx.date}</div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {rx.items.map((item, i) => (
                            <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded-md text-foreground">{item}</span>
                          ))}
                        </div>
                        {rx.pharmacy && (
                          <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                            <Building2 size={10} /> {rx.pharmacy}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {rx.status === 'pending_pharmacy' && (
                        <Button size="sm" className="bg-purple-600 hover:bg-purple-500 text-white" onClick={() => { setSelectingFor(rx.id); setTab('find'); }}>
                          <MapPin className="w-3.5 h-3.5 mr-1.5" /> Choose Pharmacy
                        </Button>
                      )}
                      {rx.status === 'ready' && (
                        <Button size="sm" variant="outline" className="text-xs">
                          <Phone className="w-3.5 h-3.5 mr-1.5" /> Call Pharmacy
                        </Button>
                      )}
                      {rx.status === 'dispatched' && (
                        <div className="flex items-center gap-1.5 text-purple-600 text-xs font-semibold">
                          <Truck size={14} className="animate-pulse" /> Tracking...
                        </div>
                      )}
                      {rx.status === 'delivered' && (
                        <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold">
                          <CheckCircle size={14} /> Complete
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Find Pharmacy Tab */}
      {tab === 'find' && (
        <div className="space-y-4">
          {selectingFor && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 flex items-center gap-3">
              <Pill size={18} className="text-purple-500 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-bold text-foreground">Sending prescription {selectingFor}</div>
                <div className="text-xs text-muted-foreground">Select a pharmacy below to receive your prescription</div>
              </div>
              <button onClick={() => { setSelectingFor(null); setTab('prescriptions'); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search pharmacies near you..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>

          <div className="space-y-3">
            {filteredPharmacies.map(pharmacy => (
              <Card key={pharmacy.id} className={`hover:border-purple-500/30 transition-all cursor-pointer ${selectedPharmacy?.id === pharmacy.id ? 'border-purple-500 shadow-lg shadow-purple-500/10' : ''}`}
                onClick={() => handleSelectPharmacy(pharmacy)}>
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center shrink-0">
                        <Building2 size={22} className="text-purple-500" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-foreground">{pharmacy.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <MapPin size={10} /> {pharmacy.address}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Navigation size={10} /> {pharmacy.distance}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Star size={10} className="text-yellow-500 fill-yellow-500" /> {pharmacy.rating} ({pharmacy.reviews})</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} /> {pharmacy.hours}</span>
                        </div>
                        <div className="flex gap-2 mt-2">
                          {pharmacy.pickup && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600">
                              <Package size={10} /> Pickup
                            </span>
                          )}
                          {pharmacy.delivery && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-600">
                              <Truck size={10} /> Delivery (₦{pharmacy.deliveryFee.toLocaleString()})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {selectingFor ? (
                        <Button size="sm" className="bg-purple-600 hover:bg-purple-500 text-white">
                          Send Prescription <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline">
                          <Phone className="w-3.5 h-3.5 mr-1.5" /> Contact
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
