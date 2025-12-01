'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Calendar, Clock, User, Video, Phone, MapPin, 
  ChevronLeft, ChevronRight, Search, Loader2
} from 'lucide-react';
import { providersAPI, appointmentsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { formatDate, formatTime } from '@/lib/utils';

export default function NewAppointment() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [appointmentType, setAppointmentType] = useState('video');
  const [reasonForVisit, setReasonForVisit] = useState('');
  const [patientNotes, setPatientNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [specialty, setSpecialty] = useState('');

  useEffect(() => {
    fetchProviders();
  }, [specialty]);

  useEffect(() => {
    if (selectedProvider && selectedDate) {
      fetchAvailability();
    }
  }, [selectedProvider, selectedDate]);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const params = specialty ? { specialty } : {};
      const response = await providersAPI.getAll(params);
      if (response.data.success) {
        setProviders(response.data.providers);
      }
    } catch (error) {
      console.error('Error fetching providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailability = async () => {
    try {
      setSlotsLoading(true);
      const dateStr = selectedDate.toISOString().split('T')[0];
      const response = await providersAPI.getAvailability(selectedProvider.id, dateStr);
      if (response.data.success) {
        setAvailableSlots(response.data.availableSlots);
      }
    } catch (error) {
      console.error('Error fetching availability:', error);
    } finally {
      setSlotsLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      
      const response = await appointmentsAPI.create({
        providerId: selectedProvider.id,
        scheduledAt: selectedSlot.startTime,
        type: appointmentType,
        reasonForVisit,
        patientNotes,
        durationMinutes: 30
      });

      if (response.data.success) {
        toast({
          title: 'Appointment Booked!',
          description: 'Your appointment has been scheduled successfully.',
          variant: 'success'
        });
        router.push(`/patient/appointments/${response.data.appointment.id}`);
      }
    } catch (error) {
      toast({
        title: 'Booking Failed',
        description: error.response?.data?.error || 'Failed to book appointment',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Generate dates for the next 14 days
  const getNextDays = () => {
    const days = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      days.push(date);
    }
    return days;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-serif">Book an Appointment</h1>
          <p className="text-gray-600">Step {step} of 4</p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div 
            key={s}
            className={`flex-1 h-2 rounded-full transition-colors ${
              s <= step ? 'bg-purple-500' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Select Provider */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select a Provider</CardTitle>
            <CardDescription>Choose a healthcare provider for your visit</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search/Filter */}
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  placeholder="Search by specialty..."
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Provider List */}
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse"></div>
                ))}
              </div>
            ) : providers.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No providers found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider)}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedProvider?.id === provider.id
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white font-medium">
                        {provider.firstName?.[0]}{provider.lastName?.[0]}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">
                          Dr. {provider.firstName} {provider.lastName}
                          {provider.credentials && `, ${provider.credentials}`}
                        </h3>
                        <p className="text-sm text-gray-500">{provider.specialty}</p>
                        {provider.city && (
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" />
                            {provider.city}, {provider.state}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button 
                onClick={() => setStep(2)}
                disabled={!selectedProvider}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select Date & Time */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Date & Time</CardTitle>
            <CardDescription>
              Choose an available time slot with Dr. {selectedProvider?.lastName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Date Selection */}
            <div>
              <Label className="mb-3 block">Select a Date</Label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {getNextDays().map((date) => {
                  const isSelected = selectedDate?.toDateString() === date.toDateString();
                  const isToday = date.toDateString() === new Date().toDateString();
                  
                  return (
                    <button
                      key={date.toISOString()}
                      onClick={() => {
                        setSelectedDate(date);
                        setSelectedSlot(null);
                      }}
                      className={`flex-shrink-0 w-16 p-3 rounded-xl text-center transition-all ${
                        isSelected
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      <div className="text-xs font-medium">
                        {isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })}
                      </div>
                      <div className="text-lg font-bold">{date.getDate()}</div>
                      <div className="text-xs">
                        {date.toLocaleDateString('en-US', { month: 'short' })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time Slots */}
            {selectedDate && (
              <div>
                <Label className="mb-3 block">Available Times</Label>
                {slotsLoading ? (
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                      <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-xl">
                    <Clock className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">No available times on this date</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.startTime}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-2 rounded-lg text-sm font-medium transition-all ${
                          selectedSlot?.startTime === slot.startTime
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                      >
                        {formatTime(slot.startTime)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button 
                onClick={() => setStep(3)}
                disabled={!selectedSlot}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Visit Details */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Visit Details</CardTitle>
            <CardDescription>Tell us about your visit</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Appointment Type */}
            <div>
              <Label className="mb-3 block">Visit Type</Label>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { value: 'video', label: 'Video Call', icon: Video },
                  { value: 'phone', label: 'Phone Call', icon: Phone },
                  { value: 'in_person', label: 'In Person', icon: MapPin }
                ].map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setAppointmentType(type.value)}
                    className={`p-4 rounded-xl border-2 text-center transition-all ${
                      appointmentType === type.value
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <type.icon className={`w-6 h-6 mx-auto mb-2 ${
                            appointmentType === type.value ? 'text-purple-600' : 'text-gray-400'
                    }`} />
                    <span className="text-sm font-medium">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Reason for Visit */}
            <div>
              <Label htmlFor="reason">Reason for Visit</Label>
              <Input
                id="reason"
                placeholder="Brief description of your symptoms or concern"
                value={reasonForVisit}
                onChange={(e) => setReasonForVisit(e.target.value)}
                className="mt-2"
              />
            </div>

            {/* Additional Notes */}
            <div>
              <Label htmlFor="notes">Additional Notes (optional)</Label>
              <textarea
                id="notes"
                placeholder="Any additional information for your provider"
                value={patientNotes}
                onChange={(e) => setPatientNotes(e.target.value)}
                className="mt-2 w-full p-3 border rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button 
                onClick={() => setStep(4)}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Review Appointment
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirmation */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Your Appointment</CardTitle>
            <CardDescription>Review the details before booking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <div className="bg-gray-50 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-4 pb-4 border-b">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white font-medium">
                  {selectedProvider?.firstName?.[0]}{selectedProvider?.lastName?.[0]}
                </div>
                <div>
                  <h3 className="font-semibold">
                    Dr. {selectedProvider?.firstName} {selectedProvider?.lastName}
                  </h3>
                  <p className="text-sm text-gray-500">{selectedProvider?.specialty}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{formatDate(selectedSlot?.startTime)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Time</p>
                  <p className="font-medium">{formatTime(selectedSlot?.startTime)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Visit Type</p>
                  <p className="font-medium capitalize">{appointmentType.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Duration</p>
                  <p className="font-medium">30 minutes</p>
                </div>
              </div>

              {reasonForVisit && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500">Reason for Visit</p>
                  <p className="font-medium">{reasonForVisit}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={loading}
                className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Booking...
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4 mr-2" />
                    Confirm Booking
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

