'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Pill, RefreshCw } from 'lucide-react';
import { clinicalEhrAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-800',
  pending_erx: 'bg-yellow-100 text-yellow-800',
  sent_to_erx: 'bg-blue-100 text-blue-800',
  erx_confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  erx_error: 'bg-orange-100 text-orange-800'
};

export default function PatientPrescriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [intents, setIntents] = useState([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await clinicalEhrAPI.listPrescriptionIntents();
      if (res.data?.success) setIntents(res.data.prescriptionIntents || []);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load prescription intents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return intents;
    return intents.filter((i) =>
      (i.medicationName || '').toLowerCase().includes(q) ||
      (i.indication || '').toLowerCase().includes(q)
    );
  }, [intents, search]);

  if (loading && intents.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Pill className="w-6 h-6 text-white" />
            </div>
            My Prescription Activity (External eRx)
          </h1>
          <p className="text-muted-foreground mt-1">
            You’ll see prescription intents and external status updates here. Prescriptions are completed in an external eRx system.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="relative min-w-[250px]">
        <Input placeholder="Search by medication or indication..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Pill className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold">No Prescription Intents</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              After a visit, your provider may create a prescription intent and complete prescribing in their external eRx system.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((i) => (
            <Card key={i.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{i.medicationName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {i.dosageStrength} {i.dosageForm}
                    </p>
                  </div>
                  <Badge className={STATUS_COLORS[i.status] || 'bg-slate-100 text-slate-800'}>{i.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="text-muted-foreground">Indication: {i.indication || '—'}</div>
                <div className="text-muted-foreground">
                  Created: {i.createdAt ? format(new Date(i.createdAt), 'MMM d, yyyy') : '—'}
                </div>
                {i.encounterId && (
                  <Link href={`/patient/records`}>
                    <Button variant="outline" size="sm" className="w-full mt-2">
                      View in Health Records <ExternalLink className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

