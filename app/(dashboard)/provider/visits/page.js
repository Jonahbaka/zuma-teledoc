'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FileText, Calendar, Clock, User, Search, Filter,
  ChevronRight, Eye, Loader2, AlertCircle
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

export default function ProviderVisitsPage() {
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchVisits();
  }, []);

  const fetchVisits = async () => {
    try {
      const response = await api.get('/visits/provider/recent', {
        params: { limit: 100 }
      });
      
      if (response.data.success) {
        setVisits(response.data.visits || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load visit notes',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredVisits = visits.filter(visit => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      visit.patientFirstName?.toLowerCase().includes(query) ||
      visit.patientLastName?.toLowerCase().includes(query) ||
      visit.appointmentId?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" />
            Visit Notes
          </h1>
          <p className="text-slate-500 mt-1">
            View and manage your clinical documentation
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by patient name or appointment ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Visits List */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : filteredVisits.length === 0 ? (
        <Card className="py-16">
          <div className="text-center">
            <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700">No Visit Notes</h3>
            <p className="text-sm text-slate-500 mt-1">
              {searchQuery ? 'No visits match your search' : 'You haven\'t created any visit notes yet'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredVisits.map((visit) => (
            <Link key={visit.id} href={`/provider/appointments/${visit.appointmentId}/visit`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold">
                        {visit.patientFirstName?.[0]}{visit.patientLastName?.[0]}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">
                          {visit.patientFirstName} {visit.patientLastName}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {formatDateTime(visit.createdAt)}
                          </span>
                          {visit.appointmentId && (
                            <span className="text-xs">
                              Apt: {visit.appointmentId.substring(0, 8)}...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        {visit.isSigned ? (
                          <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                            Signed
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
                            Draft
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}



