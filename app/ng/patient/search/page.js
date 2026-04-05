'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaPatientMedicationSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrugs, setSelectedDrugs] = useState([]);
  const [pharmacyResults, setPharmacyResults] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [location, setLocation] = useState(null);
  const [strategy, setStrategy] = useState('best_match');

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => setLocation({ latitude: 6.5244, longitude: 3.3792 })
      );
    }
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await api.get('/api/ng/patient/drugs/search', { params: { q: query } });
      setResults(response.data?.results || []);
    } finally {
      setLoading(false);
    }
  };

  const toggleDrugSelection = (drug) => {
    setSelectedDrugs((current) => {
      const exists = current.some((item) => item.id === drug.id);
      return exists ? current.filter((item) => item.id !== drug.id) : [...current, drug];
    });
  };

  const comparePharmacies = async () => {
    if (!selectedDrugs.length || !location) return;

    setComparing(true);
    setPharmacyResults(null);
    try {
      const response = await api.post('/api/ng/patient/drugs/compare', {
        items: selectedDrugs.map((drug) => ({
          drug_name: drug.name,
          generic_name: drug.generic_name,
          quantity: 1,
        })),
        latitude: location.latitude,
        longitude: location.longitude,
        strategy,
        allowSubstitution: true,
      });

      setPharmacyResults(response.data);
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Medication Search</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Search drugs and compare nearby pharmacies</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              This is one feature inside the Nigeria patient portal. Use it to compare availability and pricing after reviewing prescriptions or when making a self-pay medication request.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/ng/patient/prescriptions">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Open Prescriptions</Button>
            </Link>
            <Link href="/ng/patient/orders">
              <Button variant="outline">Track Orders</Button>
            </Link>
          </div>
        </div>
      </section>

      <Card className="border-border/70">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search medications..."
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <Button onClick={handleSearch} disabled={loading} className="bg-emerald-600 text-white hover:bg-emerald-500">
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle>{results.length > 0 ? `${results.length} medication matches` : 'Search results'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Search for a medication to compare pharmacy options.
              </div>
            ) : (
              results.map((drug) => {
                const isSelected = selectedDrugs.some((item) => item.id === drug.id);

                return (
                  <button
                    key={drug.id}
                    type="button"
                    onClick={() => toggleDrugSelection(drug)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                      isSelected ? 'border-emerald-300 bg-emerald-50' : 'border-border hover:border-emerald-200 hover:bg-emerald-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{drug.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{drug.generic_name || 'Generic details not available'}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {drug.dosage_form ? <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{drug.dosage_form}</span> : null}
                          {drug.strength ? <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{drug.strength}</span> : null}
                          {drug.requires_prescription ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700">Prescription required</span> : null}
                        </div>
                      </div>
                      {drug.reference_price ? <span className="text-sm font-semibold text-emerald-700">{formatNaira(drug.reference_price)}</span> : null}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle>Compare Pharmacies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {selectedDrugs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select one or more medications from the search results.</p>
              ) : (
                selectedDrugs.map((drug) => (
                  <div key={drug.id} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    <span className="font-medium text-emerald-800">{drug.name}</span>
                    <button type="button" onClick={() => toggleDrugSelection(drug)} className="text-emerald-700">
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Sort by</label>
              <select value={strategy} onChange={(event) => setStrategy(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                <option value="best_match">Best match</option>
                <option value="cheapest">Cheapest</option>
                <option value="nearest">Nearest</option>
                <option value="fastest">Fastest delivery</option>
              </select>
            </div>

            <Button onClick={comparePharmacies} disabled={!selectedDrugs.length || comparing || !location} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
              {comparing ? 'Comparing...' : 'Find Best Pharmacies'}
            </Button>

            {!location ? <p className="text-xs text-amber-700">Location access improves nearby pharmacy matching. Lagos is used as a fallback.</p> : null}

            {pharmacyResults ? (
              pharmacyResults.success ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                    {pharmacyResults.totalFound} pharmacy match{pharmacyResults.totalFound === 1 ? '' : 'es'} found for your selected medication list.
                  </div>
                  {(pharmacyResults.results || []).map((result, index) => (
                    <div key={`${result.pharmacy?.id || 'pharmacy'}-${index}`} className="rounded-2xl border border-border px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{result.pharmacy?.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {result.pharmacy?.city}, {result.pharmacy?.state} • {result.distance} km away
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-700">{formatNaira(result.subtotal)}</span>
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        {(result.items || []).map((item, itemIndex) => (
                          <p key={`${item.fulfilledBy?.drugName || 'item'}-${itemIndex}`}>
                            {item.fulfilledBy?.drugName}
                            {item.isSubstitution ? ' (substitute)' : ''} • {formatNaira(item.totalPrice)}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                    To complete fulfillment, continue to the prescription or order workspace with your care team.
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  {pharmacyResults.message || 'No pharmacy could fully fulfill the selected medications right now.'}
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
