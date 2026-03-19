'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';

function DrugSearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrugs, setSelectedDrugs] = useState([]);
  const [pharmacyResults, setPharmacyResults] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [location, setLocation] = useState(null);
  const [strategy, setStrategy] = useState('best_match');

  useEffect(() => {
    if (initialQuery) handleSearch(initialQuery);
    requestLocation();
  }, []);

  function requestLocation() {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => setLocation({ latitude: 6.5244, longitude: 3.3792 })
      );
    }
  }

  async function handleSearch(q = query) {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/ng/patient/drugs/search?q=${encodeURIComponent(q)}`);
      setResults(res.data.results || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleDrugSelection(drug) {
    setSelectedDrugs(prev => {
      const exists = prev.find(d => d.id === drug.id);
      if (exists) return prev.filter(d => d.id !== drug.id);
      return [...prev, drug];
    });
  }

  async function comparePharmacies() {
    if (!selectedDrugs.length || !location) return;
    setComparing(true);
    setPharmacyResults(null);
    try {
      const res = await api.post('/api/ng/patient/drugs/compare', {
        items: selectedDrugs.map(d => ({
          drug_name: d.name,
          generic_name: d.generic_name,
          quantity: 1,
        })),
        latitude: location.latitude,
        longitude: location.longitude,
        strategy,
        allowSubstitution: true,
      });
      setPharmacyResults(res.data);
    } catch (err) {
      console.error('Compare error:', err);
    } finally {
      setComparing(false);
    }
  }

  const formatNaira = (amount) => `₦${Number(amount || 0).toLocaleString()}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/ng" className="flex items-center space-x-2 flex-shrink-0">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </div>
          </Link>
          <form onSubmit={e => { e.preventDefault(); handleSearch(); }} className="flex-1 flex gap-2">
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search medications..."
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">
              Search
            </button>
          </form>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="lg:flex lg:gap-6">
          <div className="lg:w-1/2">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {results.length > 0 ? `${results.length} drugs found` : 'Search for medications'}
            </h2>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full" />
              </div>
            )}

            <div className="space-y-2">
              {results.map(drug => {
                const isSelected = selectedDrugs.some(d => d.id === drug.id);
                return (
                  <div key={drug.id}
                    onClick={() => toggleDrugSelection(drug)}
                    className={`bg-white rounded-lg p-4 cursor-pointer border-2 transition-colors
                      ${isSelected ? 'border-green-500 bg-green-50' : 'border-transparent hover:border-gray-200'} shadow-sm`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-900">{drug.name}</p>
                        {drug.generic_name && (
                          <p className="text-sm text-gray-500">Generic: {drug.generic_name}</p>
                        )}
                        <div className="flex gap-2 mt-1">
                          {drug.dosage_form && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{drug.dosage_form}</span>
                          )}
                          {drug.strength && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{drug.strength}</span>
                          )}
                          {drug.requires_prescription && (
                            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Rx Required</span>
                          )}
                          {drug.is_generic && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">Generic</span>
                          )}
                        </div>
                      </div>
                      {drug.reference_price && (
                        <span className="text-sm font-medium text-gray-500">~{formatNaira(drug.reference_price)}</span>
                      )}
                    </div>
                    {drug.manufacturer && (
                      <p className="text-xs text-gray-400 mt-1">by {drug.manufacturer}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:w-1/2 mt-6 lg:mt-0">
            <div className="bg-white rounded-xl shadow-sm p-4 sticky top-20">
              <h3 className="font-bold text-gray-900 mb-3">
                Compare Pharmacies ({selectedDrugs.length} selected)
              </h3>

              {selectedDrugs.length > 0 && (
                <div className="mb-4 space-y-1">
                  {selectedDrugs.map(d => (
                    <div key={d.id} className="flex justify-between items-center text-sm bg-green-50 px-3 py-1.5 rounded">
                      <span className="text-green-800">{d.name}</span>
                      <button onClick={() => toggleDrugSelection(d)} className="text-green-600 hover:text-red-500">
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-4">
                <label className="text-xs text-gray-500">Sort by</label>
                <select value={strategy} onChange={e => setStrategy(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="best_match">Best Match</option>
                  <option value="cheapest">Cheapest</option>
                  <option value="nearest">Nearest</option>
                  <option value="fastest">Fastest Delivery</option>
                </select>
              </div>

              <button onClick={comparePharmacies}
                disabled={!selectedDrugs.length || comparing}
                className="w-full py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
                {comparing ? 'Searching pharmacies...' : 'Find Best Pharmacies'}
              </button>

              {!location && (
                <p className="text-xs text-yellow-600 mt-2">
                  Enable location to find pharmacies near you
                </p>
              )}

              {pharmacyResults && (
                <div className="mt-4 border-t pt-4">
                  {pharmacyResults.success ? (
                    <>
                      <p className="text-sm text-gray-600 mb-3">
                        {pharmacyResults.totalFound} pharmacies found
                      </p>
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {pharmacyResults.results?.map((result, i) => (
                          <div key={i} className="border rounded-lg p-3">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{result.pharmacy.name}</p>
                                <p className="text-xs text-gray-500">
                                  {result.pharmacy.city}, {result.pharmacy.state} — {result.distance}km
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-green-600">{formatNaira(result.subtotal)}</p>
                                {result.pharmacy.rating > 0 && (
                                  <p className="text-xs text-yellow-600">{result.pharmacy.rating}/5</p>
                                )}
                              </div>
                            </div>
                            <div className="text-xs space-y-1">
                              {result.items.map((item, j) => (
                                <div key={j} className="flex justify-between text-gray-600">
                                  <span>
                                    {item.fulfilledBy.drugName}
                                    {item.isSubstitution && <span className="text-blue-500 ml-1">(substitute)</span>}
                                  </span>
                                  <span>{formatNaira(item.totalPrice)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-2">
                              {result.canDeliver && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Delivers to you</span>
                              )}
                              <Link href={`/ng/patient/orders?pharmacyId=${result.pharmacy.id}`}
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded ml-auto hover:bg-green-700">
                                Order
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-gray-600">{pharmacyResults.message}</p>
                      {pharmacyResults.partialMatches?.length > 0 && (
                        <div className="mt-3 text-xs text-gray-500">
                          <p className="font-medium">Partial matches:</p>
                          {pharmacyResults.partialMatches.map((m, i) => (
                            <p key={i}>{m.name} — {m.itemsAvailable}/{m.totalRequested} items ({m.distance}km)</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DrugSearch() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    }>
      <DrugSearchContent />
    </Suspense>
  );
}
