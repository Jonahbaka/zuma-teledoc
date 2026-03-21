'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Loader2, Pill, RefreshCw } from 'lucide-react';
import { clinicalEhrAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { toProviderPortalPath } from '@/lib/providerPortal';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-800',
  pending_erx: 'bg-yellow-100 text-yellow-800',
  sent_to_erx: 'bg-blue-100 text-blue-800',
  erx_confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  erx_error: 'bg-orange-100 text-orange-800'
};

export default function ProviderPrescriptionsPage() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [intents, setIntents] = useState([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await clinicalEhrAPI.listPrescriptionIntents();
      if (res.data?.success) setIntents(res.data.prescriptionIntents || []);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load external eRx intents', variant: 'destructive' });
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
      (i.patientFirstName || '').toLowerCase().includes(q) ||
      (i.patientLastName || '').toLowerCase().includes(q)
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
            External eRx (iPrescribe)
          </h1>
          <p className="text-muted-foreground mt-1">
            This portal stores **prescription intents** only. Final prescribing happens in an external eRx system.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href={toProviderPortalPath('/patients', { pathname })}>
            <Button className="bg-purple-600 hover:bg-purple-700">Start from Patient Chart</Button>
          </Link>
        </div>
      </div>

      <div className="relative min-w-[250px]">
        <Input placeholder="Search by patient or medication..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Pill className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-60" />
            <h3 className="text-lg font-semibold">No eRx Intents</h3>
            <p className="text-muted-foreground mt-1">Create an encounter and add an intent from the patient chart.</p>
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
                <div className="text-muted-foreground">
                  Patient: {i.patientFirstName} {i.patientLastName}
                </div>
                <div className="text-muted-foreground">Created: {i.createdAt ? format(new Date(i.createdAt), 'MMM d, yyyy') : '—'}</div>
                <Link href={toProviderPortalPath(`/encounters/${i.encounterId}`, { pathname })}>
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    Open Encounter <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
