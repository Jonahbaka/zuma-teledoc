'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, Loader2, Navigation, CheckCircle, MessageCircle, FileText } from 'lucide-react';
import { DoctaService } from '@/lib/doctaService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

function inferCountryFromLocale() {
  if (typeof navigator === 'undefined') return 'US';
  const lang = String(navigator.language || '').trim();
  const parts = lang.split('-');
  if (parts.length >= 2) return parts[1].toUpperCase();
  return 'US';
}

export default function PharmacyLocator({ onSelect }) {
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);

  const [manual, setManual] = useState({
    name: '',
    address: '',
    emailOrFax: '',
    whatsapp: ''
  });

  const country = useMemo(() => inferCountryFromLocale(), []);
  const usesManualRouting = useMemo(() => ['NG', 'IN'].includes(country), [country]);
  const usesUkRouting = useMemo(() => country === 'GB', [country]);

  const requestLocation = async () => {
    setIsLocating(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            long: position.coords.longitude,
            source: 'GPS'
          });
          setIsLocating(false);
          toast({ title: 'Location acquired', description: 'Searching nearby pharmacies.' });
        },
        async () => {
          // No GPS; allow manual entry only.
          setIsLocating(false);
          toast({ title: 'Location unavailable', description: 'Use manual pharmacy details.', variant: 'destructive' });
        },
        { timeout: 7000 }
      );
    } else {
      setIsLocating(false);
      toast({ title: 'No GPS support', description: 'Use manual pharmacy details.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!userLocation) return;
      setLoading(true);
      try {
        const results = await DoctaService.findRealPharmacies(userLocation.lat, userLocation.long);
        setPharmacies(results || []);
      } catch (e) {
        setPharmacies([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userLocation]);

  const handleSelectPharmacy = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    onSelect?.({ mode: 'geo', pharmacy });
    toast({ title: 'Pharmacy selected', description: pharmacy.name });
  };

  const handleSaveManual = () => {
    if (!manual.name || !manual.address) {
      toast({ title: 'Missing details', description: 'Pharmacy name and address are required.', variant: 'destructive' });
      return;
    }
    const payload = { mode: 'manual', pharmacy: manual };
    setSelectedPharmacy(null);
    onSelect?.(payload);
    toast({ title: 'Saved', description: 'Manual pharmacy routing saved.' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-purple-500" />
            Find Pharmacy (Global)
          </CardTitle>
          {!userLocation && (
            <Button onClick={requestLocation} disabled={isLocating} variant="outline">
              {isLocating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Locating...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4 mr-2" /> Locate me
                </>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {usesUkRouting && (
            <div className="mb-2 flex items-start gap-2">
              <FileText className="w-4 h-4 mt-0.5 text-blue-500" />
              <p>
                UK detected. If an NHS-integrated eRx endpoint is not configured, use manual pharmacy email/fax routing.
              </p>
            </div>
          )}
          {usesManualRouting && (
            <div className="mb-2 flex items-start gap-2">
              <MessageCircle className="w-4 h-4 mt-0.5 text-emerald-500" />
              <p>
                Country detected ({country}). Manual pharmacy details or WhatsApp routing is supported for delivery workflows.
              </p>
            </div>
          )}
          <p>
            Nearby results use OpenStreetMap/Overpass when location is available. Manual entry always works globally.
          </p>
        </CardContent>
      </Card>

      {userLocation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nearby pharmacies</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
              </div>
            ) : pharmacies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No nearby pharmacies found. Use manual entry.</p>
            ) : (
              <div className="space-y-2">
                {pharmacies.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPharmacy(p)}
                    className={`w-full text-left rounded-lg border px-4 py-3 hover:bg-accent transition-colors ${
                      selectedPharmacy?.id === p.id ? 'border-purple-500 bg-purple-500/5' : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{p.address}</p>
                      </div>
                      {selectedPharmacy?.id === p.id && <CheckCircle className="w-5 h-5 text-purple-600" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual pharmacy details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Pharmacy name</Label>
            <Input value={manual.name} onChange={(e) => setManual(m => ({ ...m, name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Pharmacy address</Label>
            <Input value={manual.address} onChange={(e) => setManual(m => ({ ...m, address: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Email or fax (optional)</Label>
            <Input value={manual.emailOrFax} onChange={(e) => setManual(m => ({ ...m, emailOrFax: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp number (optional)</Label>
            <Input placeholder="+234..." value={manual.whatsapp} onChange={(e) => setManual(m => ({ ...m, whatsapp: e.target.value }))} />
          </div>
          <Button type="button" onClick={handleSaveManual}>
            Save manual pharmacy
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

