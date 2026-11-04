'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Building2, FileText, RefreshCw, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { formatDateTime } from '@/lib/utils';

export default function HospitalNetworkPage() {
  const { user, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const base = pathname?.startsWith('/ng/') ? '/ng/provider' : '/provider';
  const canReadRegistry = ['admin', 'super_admin'].includes(user?.role);
  const [registry, setRegistry] = useState({ status: 'loading', organizations: [], actorId: null });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return () => { cancelled = true; };
    if (!canReadRegistry) {
      setRegistry({ status: 'restricted', organizations: [], actorId: user?.id });
      return () => { cancelled = true; };
    }
    setRegistry({ status: 'loading', organizations: [], actorId: user.id });
    api.get('/interop/organizations').then(({ data }) => {
      if (!data.success || !Array.isArray(data.organizations)
        || data.organizations.some((organization) => typeof organization?.id !== 'string' || typeof organization.name !== 'string' || typeof organization.status !== 'string')) throw new Error();
      if (!cancelled) setRegistry({ status: 'ready', organizations: data.organizations, actorId: user.id });
    }).catch(() => {
      if (!cancelled) setRegistry({ status: 'error', organizations: [], actorId: user.id });
    });
    return () => { cancelled = true; };
  }, [authLoading, canReadRegistry, user?.id, revision]);

  const status = authLoading ? 'loading' : !canReadRegistry ? 'restricted' : registry.actorId === user?.id ? registry.status : 'loading';
  const organizations = status === 'ready' && canReadRegistry ? registry.organizations : [];

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Hospital connections" description="Coordinate referrals and patient records with your care team.">
      <Link href={base + '/referrals'}><Button variant="outline"><FileText className="mr-2 h-5 w-5" aria-hidden="true" />Referrals</Button></Link>
      <Link href={base + '/patients'}><Button variant="outline"><Users className="mr-2 h-5 w-5" aria-hidden="true" />Patient charts</Button></Link>
    </PortalPageHeader>

    <section className="portal-surface">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Organization connection registry</h2><p className="mt-2 text-base text-slate-600">Registry configuration does not confirm successful record exchange or a hospital partnership.</p></div>
        {canReadRegistry && <Button variant="outline" disabled={status === 'loading'} onClick={() => setRevision((value) => value + 1)}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>}
      </div>

      {status === 'loading' && <p role="status" className="mt-5 text-base">Loading organization connection information…</p>}
      {status === 'restricted' && <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-6">
        <Building2 className="h-10 w-10 text-blue-600" aria-hidden="true" />
        <h3 className="mt-4 text-lg font-semibold text-slate-900">Connection status is unavailable in this clinician workspace</h3>
        <p className="mt-3 text-base leading-7 text-slate-700">Your organization administrator manages external hospital connections. You can continue using DoctaRx patient charts and referral workflows.</p>
      </div>}
      {status === 'error' && <div className="portal-error mt-5"><p role="alert">Organization connection information could not be loaded. Use Refresh to try again.</p></div>}
      {status === 'ready' && !organizations.length && <p className="portal-empty mt-5">No organizations were returned by the connection registry.</p>}
      {status === 'ready' && organizations.length > 0 && <ul className="mt-5 divide-y divide-slate-200">{organizations.map((organization) => <li key={organization.id} className="space-y-3 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">{organization.name}</h3><span className="rounded-full bg-slate-100 px-3 py-2 text-base text-slate-700">Configuration: {organization.status.replace(/_/g, ' ')}</span></div>
        {organization.ehr_system && <p className="text-base text-slate-600">Recorded EHR system: {organization.ehr_system}</p>}
        <p className="text-base text-slate-600">{organization.last_sync_at && Number.isFinite(Date.parse(organization.last_sync_at)) ? 'Last recorded synchronization: ' + formatDateTime(organization.last_sync_at) : 'No synchronization result is recorded.'}</p>
      </li>)}</ul>}
    </section>
  </div>;
}
