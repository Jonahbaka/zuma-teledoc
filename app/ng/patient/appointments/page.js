'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Calendar, Stethoscope, Video, Phone, MessageSquare,
  Clock, Star, MapPin, ArrowRight, Filter, Search,
  ChevronRight, CheckCircle, AlertCircle, Plus, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '../../components/FeatureGate';
import NgNav from '../../components/NgNav';

const SPECIALTIES = [
  'All Specialties', 'General Practice', 'Internal Medicine', 'Pediatrics',
  'Obstetrics & Gynecology', 'Cardiology', 'Dermatology', 'Psychiatry',
  'Orthopedics', 'ENT', 'Urology', 'Neurology',
];

const MOCK_PROVIDERS = [
  {
    id: '1', name: 'Dr. Adaeze Okonkwo', specialty: 'General Practice',
    city: 'Lagos', state: 'Lagos', years: 8, rating: 4.9, reviews: 142,
    fee_general: 3000, available: true, photo: null,
    bio: 'Specialist in primary care, preventive medicine and chronic disease management.',
  },
  {
    id: '2', name: 'Dr. Emeka Nwosu', specialty: 'Internal Medicine',
    city: 'Abuja', state: 'FCT - Abuja', years: 12, rating: 4.8, reviews: 89,
    fee_general: 5000, available: true, photo: null,
    bio: 'Board-certified internist with expertise in diabetes and hypertension management.',
  },
  {
    id: '3', name: 'Dr. Funmi Adeleke', specialty: 'Pediatrics',
    city: 'Ibadan', state: 'Oyo', years: 6, rating: 4.7, reviews: 67,
    fee_general: 4000, available: false, photo: null,
    bio: 'Dedicated pediatrician focused on child development and immunization.',
  },
];

function ProviderCard({ provider, onBook }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 hover:border-green-500/20 transition-all hover:shadow-md group">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/20 flex items-center justify-center shrink-0">
          <User size={24} className="text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-foreground">{provider.name}</h3>
              <p className="text-sm text-muted-foreground">{provider.specialty}</p>
            </div>
            <div className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              provider.available
                ? 'bg-green-500/10 text-green-600 border-green-500/20'
                : 'bg-muted text-muted-foreground border-border'
            }`}>
              {provider.available ? '● Available' : '○ Unavailable'}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><MapPin size={10} /> {provider.city}, {provider.state}</span>
            <span className="flex items-center gap-1"><Star size={10} className="text-yellow-500 fill-yellow-500" /> {provider.rating} ({provider.reviews})</span>
            <span>{provider.years} yrs experience</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{provider.bio}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div>
          <div className="text-lg font-bold text-foreground">₦{provider.fee_general.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">per consultation</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => onBook(provider, 'video')}
            disabled={!provider.available}
          >
            <Video size={14} className="mr-1.5" /> Video
          </Button>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-500 text-white rounded-xl"
            onClick={() => onBook(provider, 'general')}
            disabled={!provider.available}
          >
            Book Now
          </Button>
        </div>
      </div>
    </div>
  );
}

function BookingModal({ provider, mode, onClose }) {
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [complaint, setComplaint] = useState('');

  const times = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-background border border-border rounded-3xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground">Book Consultation</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">✕</button>
        </div>

        <div className="bg-card rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
            <User size={18} className="text-green-500" />
          </div>
          <div>
            <div className="font-semibold text-foreground text-sm">{provider.name}</div>
            <div className="text-xs text-muted-foreground">{provider.specialty} · ₦{provider.fee_general.toLocaleString()}</div>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground block mb-2">Select Date</span>
              <input
                type="date"
                value={selectedDate}
                min={today}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-green-500/50"
              />
            </label>

            {selectedDate && (
              <div>
                <span className="text-sm font-medium text-foreground block mb-2">Select Time (WAT)</span>
                <div className="grid grid-cols-3 gap-2">
                  {times.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTime(t)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                        selectedTime === t
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-card border-border text-muted-foreground hover:border-green-500/30'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={() => setStep(2)}
              disabled={!selectedDate || !selectedTime}
              className="w-full bg-green-600 hover:bg-green-500 text-white rounded-xl"
            >
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground block mb-2">Chief Complaint / Reason for Visit</span>
              <textarea
                value={complaint}
                onChange={e => setComplaint(e.target.value)}
                placeholder="Briefly describe your symptoms or reason for the consultation…"
                rows={4}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-green-500/50 resize-none"
              />
            </label>

            <div className="bg-card border border-border rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between text-muted-foreground"><span>Consultation fee</span><span className="text-foreground font-semibold">₦{provider.fee_general.toLocaleString()}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Date & Time</span><span className="text-foreground">{selectedDate} at {selectedTime} WAT</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Mode</span><span className="text-foreground capitalize">{mode === 'video' ? '📹 Video' : '🎥 Video'}</span></div>
            </div>

            <FeatureGate type="nigeria_pending" available={false}>
              <div className="bg-green-600 text-white rounded-xl py-3 text-center font-bold">Pay & Confirm Booking</div>
            </FeatureGate>

            <button onClick={() => setStep(1)} className="w-full text-sm text-muted-foreground hover:text-foreground">← Go back</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NgPatientAppointments() {
  const [selectedSpecialty, setSelectedSpecialty] = useState('All Specialties');
  const [search, setSearch] = useState('');
  const [bookingProvider, setBookingProvider] = useState(null);
  const [bookingMode, setBookingMode] = useState('general');

  const filtered = MOCK_PROVIDERS.filter(p => {
    const matchSpecialty = selectedSpecialty === 'All Specialties' || p.specialty === selectedSpecialty;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.specialty.toLowerCase().includes(search.toLowerCase());
    return matchSpecialty && matchSearch;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="border-b border-border bg-card/40 px-6 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link href="/ng/patient/dashboard" className="hover:text-foreground">Dashboard</Link>
              <ChevronRight size={14} /> <span>Appointments</span>
            </div>
            <h1 className="text-3xl font-bold text-foreground">Book a Consultation</h1>
            <p className="text-muted-foreground mt-1">Browse verified Nigerian doctors and book a video or audio consultation.</p>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Video consult notice */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3 mb-6">
            <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="text-foreground">Live video consultations launching soon.</strong>{' '}
              <span className="text-muted-foreground">You can browse and book appointments now. Confirmed appointments will begin when the video consultation feature goes live in your area.</span>
            </div>
          </div>

          {/* Search & filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2.5 flex-1 min-w-[200px]">
              <Search size={16} className="text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search doctors or specialties…"
                className="bg-transparent text-foreground text-sm outline-none flex-1 placeholder:text-muted-foreground"
              />
            </div>
            <select
              value={selectedSpecialty}
              onChange={e => setSelectedSpecialty(e.target.value)}
              className="bg-card border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none"
            >
              {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Provider cards */}
          <div className="space-y-4">
            {filtered.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onBook={(p, mode) => { setBookingProvider(p); setBookingMode(mode); }}
              />
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Stethoscope size={40} className="mx-auto mb-4 opacity-30" />
                <p>No providers found for your search.</p>
              </div>
            )}
          </div>

          {/* My appointments section */}
          <div className="mt-12">
            <h2 className="text-xl font-bold text-foreground mb-4">My Appointments</h2>
            <FeatureGate type="nigeria_pending" available={false}>
              <div />
            </FeatureGate>
          </div>
        </div>
      </div>

      {bookingProvider && (
        <BookingModal
          provider={bookingProvider}
          mode={bookingMode}
          onClose={() => setBookingProvider(null)}
        />
      )}
    </div>
  );
}
