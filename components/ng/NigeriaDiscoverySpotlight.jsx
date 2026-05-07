'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, Pill, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BLOCKED_PROVIDER_TERMS = [
  'test',
  'qa',
  'demo',
  'sample',
  'fake',
  'internal',
  'jonah baka',
  'apollos goodnews',
  'goodnews.appolos@gmail.com',
  'abugail simon',
  'abigail simon',
];

function toDistance(provider) {
  if (provider?.distanceKm === null || provider?.distanceKm === undefined) {
    return 'City/state ranked';
  }

  return `${provider.distanceKm.toFixed(1)} km`;
}

function visiblePublicProviders(providers) {
  return (providers || [])
    .filter((provider) => {
      const haystack = [
        provider?.canonicalName,
        provider?.email,
        provider?.providerType,
        provider?.providerSubtype,
        provider?.sourceType,
        provider?.kind,
      ].filter(Boolean).join(' ').toLowerCase();

      if (BLOCKED_PROVIDER_TERMS.some((term) => haystack.includes(term))) {
        return false;
      }

      if (provider?.kind === 'telehealth_provider') {
        return provider.publicCredentialed === true || provider.credentialingStatus === 'approved';
      }

      return true;
    })
    .map((provider) => ({
      ...provider,
      sourceBadges: (provider.sourceBadges || []).filter((badge) => {
        if (String(badge).toLowerCase() === 'doctarx verified') {
          return provider.publicCredentialed === true ||
            (provider.kind === 'pharmacy' && provider.sourceType === 'internal_pharmacy');
        }
        return true;
      }),
    }));
}

export default function NigeriaDiscoverySpotlight({ embeddedInPortal = false }) {
  const [featuredCategories, setFeaturedCategories] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.get('/api/ng/discovery/home');
        if (cancelled) {
          return;
        }

        setFeaturedCategories(response.data?.featuredCategories || []);
        setProviders(visiblePublicProviders(response.data?.nearestProviders || []));
      } catch (error) {
        console.error('[NG Discovery Spotlight] Failed to load', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Featured medicine categories</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {loading
            ? Array.from({ length: 4 }, (_, index) => (
                <div key={`category-${index}`} className="h-24 animate-pulse rounded-2xl bg-muted/50" />
              ))
            : featuredCategories.slice(0, 6).map((item) => (
                <Link
                  key={item.category}
                  href={embeddedInPortal ? '/ng/patient/search' : '/ng/medicines'}
                  className="rounded-2xl border border-border px-4 py-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60"
                >
                  <div className="inline-flex rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                    <Pill className="h-5 w-5" />
                  </div>
                  <p className="mt-3 font-semibold text-foreground">{item.category}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.medicineExamples?.slice(0, 3).join(', ')}</p>
                </Link>
              ))}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Nearest trusted providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading
            ? Array.from({ length: 3 }, (_, index) => (
                <div key={`provider-${index}`} className="h-28 animate-pulse rounded-2xl bg-muted/50" />
              ))
            : providers.slice(0, 4).map((provider) => (
                <div key={provider.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{provider.canonicalName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[provider.city, provider.state].filter(Boolean).join(', ')}
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {toDistance(provider)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {(provider.sourceBadges || []).map((badge) => (
                      <span key={badge} className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700">
                        {badge}
                      </span>
                    ))}
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                      <MapPin className="mr-1 inline h-3 w-3" />
                      {provider.addressConfidence || 'city_only'}
                    </span>
                  </div>
                </div>
              ))}

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Manual fallback remains available
            </div>
            <p className="mt-2">
              If precise location is weak, the Nigeria flow still continues with city, area, and landmark ranking instead of stopping at permission errors.
            </p>
          </div>

          <Link href={embeddedInPortal ? '/ng/patient/search' : '/ng/find-care'}>
            <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
              Explore care discovery
            </Button>
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
