'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { resolveProviderMarket, toProviderPortalPath } from '@/lib/providerPortal';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-800',
  pending_erx: 'bg-yellow-100 text-yellow-800',
  sent_to_erx: 'bg-blue-100 text-blue-800',
  erx_confirmed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  erx_error: 'bg-orange-100 text-orange-800'
};

export default function ProviderPrescriptionsPage() {
  const pathname = usePathname();
  const market = resolveProviderMarket({ pathname });
  const [loading, setLoading] = useState(true);
  const [intents, setIntents] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [patientContext, setPatientContext] = useState('');

  useEffect(() => {
    const patientId = new URLSearchParams(window.location.search).get('patientId') || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId)) setPatientContext(patientId);
  }, [pathname]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await clinicalEhrAPI.listPrescriptionIntents();
      if (!res.data?.success || !Array.isArray(res.data.prescriptionIntents)) throw new Error();
      setIntents(res.data.prescriptionIntents);
    } catch (e) {
      setError('Prescription activity could not be loaded. Select Refresh to try again.');
      toast({
        title: 'Error',
        description: market === 'NG'
          ? 'Failed to load prescription activity'
          : 'Failed to load external eRx intents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    load();
  }, [load]);

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
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Prescriptions" description="Review recorded prescription intents and continue prescribing from the patient encounter.">
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
        <Link href={toProviderPortalPath(patientContext ? `/patients/${patientContext}/ehr` : '/patients', { pathname })}><Button className="bg-blue-600 hover:bg-blue-700">{patientContext ? 'Continue patient chart' : 'Patient charts'}</Button></Link>
      </PortalPageHeader>
      {patientContext && <p className="portal-surface">Continue the consultation in the patient chart. Review medications, allergies, and the encounter before creating an intent. Final external prescribing requires an activated prescribing service.</p>}
      {error && <p role="alert" className="portal-error">{error}</p>}

      <div className="relative min-w-[250px]">
        <Input aria-label="Search prescriptions by patient or medication" placeholder="Search by patient or medication..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {!error && filtered.length === 0 ? (
          <Card>
          <CardContent className="py-12 text-center">
            <Pill className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-60" />
            <h3 className="text-lg font-semibold">
              {market === 'NG' ? 'No prescription activity yet' : 'No eRx Intents'}
            </h3>
            <p className="text-muted-foreground mt-1">
              {market === 'NG'
                ? 'Start from a patient chart to create the next prescription intent.'
                : 'Create an encounter and add an intent from the patient chart.'}
            </p>
          </CardContent>
        </Card>
      ) : error ? null : (
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
