'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Calendar, Plus, Filter, Search, Video, Phone, 
  Clock, ChevronRight, X
} from 'lucide-react';
import { appointmentsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatDate } from '@/lib/utils';

export default function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      
      const params = {};
      if (filter && filter !== 'all') {
        params.status = filter;
      }
      
      const response = await appointmentsAPI.getAll(params);
      
      // Use the same simple pattern as the dashboard (which works)
      if (response?.data?.success && Array.isArray(response.data.appointments)) {
        setAppointments(response.data.appointments);
      } else {
        setAppointments([]);
      }
    } catch (error) {
      // Production-safe error handling - set empty array on error
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Also refresh when page becomes visible (e.g., after redirect from booking)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAppointments();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchAppointments]);

  const filteredAppointments = (() => {
    try {
      const apps = appointments || [];
      if (!Array.isArray(apps)) return [];
      
      if (!searchQuery || !searchQuery.trim()) {
        return apps.filter(apt => apt != null);
      }
      
      const search = String(searchQuery).toLowerCase().trim();
      if (!search) return apps.filter(apt => apt != null);
      
      return apps.filter(apt => {
        if (!apt || typeof apt !== 'object') return false;
        
        try {
          const firstName = String(apt.providerFirstName || '').toLowerCase();
          const lastName = String(apt.providerLastName || '').toLowerCase();
          const reason = String(apt.reasonForVisit || '').toLowerCase();
          
          return firstName.includes(search) || 
                 lastName.includes(search) || 
                 reason.includes(search);
        } catch (filterError) {
          // If filtering fails for this item, exclude it
          return false;
        }
      });
    } catch (error) {
      // If filtering completely fails, return empty array
      return [];
    }
  })();

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Upcoming' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif">My Appointments</h1>
          <p className="text-gray-600">Manage your healthcare visits</p>
        </div>
        <Link href="/patient/appointments/book">
          <Button className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Book Appointment
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search appointments..."
                value={searchQuery || ''}
                onChange={(e) => {
                  try {
                    setSearchQuery(e?.target?.value || '');
                  } catch (e) {
                    // Silently fail if state update fails
                  }
                }}
                className="pl-10"
              />
            </div>
            
            {/* Filter buttons */}
            <div className="flex gap-2">
              {filters.map((f) => (
                <Button
                  key={f.value}
                  variant={filter === f.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    try {
                      setFilter(f.value);
                    } catch (e) {
                      // Silently fail if state update fails
                    }
                  }}
                  className={filter === f.value ? 'bg-purple-500' : ''}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appointments List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-32 bg-gray-100 rounded-xl"></div>
            </div>
          ))}
        </div>
      ) : filteredAppointments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No appointments found</h3>
            <p className="text-gray-500 mb-6">
              {filter !== 'all' 
                ? `You don't have any ${filter} appointments`
                : "You haven't booked any appointments yet"
              }
            </p>
            <Link href="/patient/appointments/book">
              <Button>Book Your First Appointment</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.isArray(filteredAppointments) && filteredAppointments.map((apt) => {
            if (!apt || !apt.id) return null;
            
            try {
              const aptId = String(apt.id || '');
              const firstName = String(apt.providerFirstName || '');
              const lastName = String(apt.providerLastName || '');
              const specialty = String(apt.providerSpecialty || 'General Practice');
              const status = String(apt.status || 'scheduled');
              
              let scheduledAt = 'TBD';
              try {
                if (apt.scheduledAt) {
                  scheduledAt = formatDateTime(apt.scheduledAt);
                }
              } catch (dateError) {
                // If date formatting fails, use TBD
                scheduledAt = 'TBD';
              }
              
              const reason = String(apt.reasonForVisit || '');
              
              return (
                <Card key={aptId} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-0">
                    <Link href={`/patient/appointments/${aptId}`}>
                      <div className="p-6">
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                          {/* Provider Info */}
                          <div className="flex items-center gap-4 flex-1">
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-lg font-medium">
                              {firstName?.[0] || ''}{lastName?.[0] || ''}
                            </div>
                            <div>
                              <h3 className="font-semibold">
                                Dr. {firstName} {lastName}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {specialty}
                              </p>
                            </div>
                          </div>

                          {/* Date & Time */}
                          <div className="flex items-center gap-6 text-sm">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-gray-400" />
                              <span>{scheduledAt}</span>
                            </div>
                            
                            {/* Type */}
                            <div className="flex items-center gap-1">
                              {apt.type === 'video' ? (
                                <>
                                  <Video className="w-4 h-4 text-blue-500" />
                                  <span>Video</span>
                                </>
                              ) : apt.type === 'phone' ? (
                                <>
                                  <Phone className="w-4 h-4 text-green-500" />
                                  <span>Phone</span>
                                </>
                              ) : (
                                <span>In-person</span>
                              )}
                            </div>

                            {/* Status */}
                            <span className={`px-3 py-1 rounded-full text-xs font-medium status-${status}`}>
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </span>

                            <ChevronRight className="w-5 h-5 text-gray-400" />
                          </div>
                        </div>

                        {/* Reason */}
                        {reason && (
                          <div className="mt-4 pt-4 border-t">
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Reason: </span>
                              {reason}
                            </p>
                          </div>
                        )}
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              );
            } catch (renderError) {
              // If rendering this appointment fails, skip it
              return null;
            }
          })}
        </div>
      )}
    </div>
  );
}

