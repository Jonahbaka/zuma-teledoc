'use client';

import { useState, useEffect } from 'react';
import { MapPin, Loader2, Navigation, CheckCircle } from 'lucide-react';
import { DoctaService } from '@/lib/doctaService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function PharmacyLocatorPage() {
  const { user } = useAuth();
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);

  const requestLocation = async () => {
    setIsLocating(true);
    setLocationError(null);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            long: position.coords.longitude,
            source: 'GPS'
          });
          setIsLocating(false);
          toast({
            title: 'GPS Acquired',
            description: 'Location found successfully'
          });
        },
        async (error) => {
          await fetchIPLocation("GPS unavailable.");
        },
        { timeout: 7000 }
      );
    } else {
      await fetchIPLocation("No GPS support.");
    }
  };

  const fetchIPLocation = async (err) => {
    try {
      const response = await fetch('https://get.geojs.io/v1/ip/geo.json');
      if (!response.ok) throw new Error();
      const data = await response.json();
      setUserLocation({
        lat: parseFloat(data.latitude),
        long: parseFloat(data.longitude),
        source: 'IP'
      });
      setIsLocating(false);
      toast({
        title: 'Location Set',
        description: 'Location set via network'
      });
    } catch (error) {
      setUserLocation({
        lat: 40.7128,
        long: -74.0060,
        source: 'DEF'
      });
      setIsLocating(false);
      toast({
        title: 'Default Location',
        description: 'Using default location (NYC)'
      });
    }
  };

  useEffect(() => {
    if (userLocation && pharmacies.length === 0) {
      loadPharmacies();
    }
  }, [userLocation]);

  const loadPharmacies = async () => {
    if (!userLocation) return;
    
    setLoading(true);
    try {
      const results = await DoctaService.findRealPharmacies(
        userLocation.lat,
        userLocation.long
      );
      setPharmacies(results);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load pharmacies',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPharmacy = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    // In production, save to user preferences
    toast({
      title: 'Pharmacy Selected',
      description: `${pharmacy.name} has been set as your preferred pharmacy`
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-purple-500" />
            Pharmacy Locator
          </h1>
          <p className="text-slate-500 mt-1">Find nearby pharmacies</p>
        </div>
        {!userLocation && (
          <Button
            onClick={requestLocation}
            disabled={isLocating}
            className="bg-gradient-to-r from-purple-600 to-purple-800"
          >
            {isLocating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Locating...
              </>
            ) : (
              <>
                <Navigation className="w-4 h-4 mr-2" />
                Locate Me
              </>
            )}
          </Button>
        )}
      </div>

      {!userLocation ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Location Required</h3>
            <p className="text-gray-500 mb-6">
              Please allow location access to find nearby pharmacies
            </p>
            <Button onClick={requestLocation} disabled={isLocating}>
              {isLocating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Locating...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4 mr-2" />
                  Get My Location
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : pharmacies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Pharmacies Found</h3>
            <p className="text-gray-500 mb-6">
              Try adjusting your location or search area
            </p>
            <Button onClick={loadPharmacies} variant="outline">
              Retry Search
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pharmacies.map((pharmacy) => (
            <Card
              key={pharmacy.id}
              className={`cursor-pointer transition-all hover:shadow-lg ${
                selectedPharmacy?.id === pharmacy.id
                  ? 'border-purple-500 border-2 bg-purple-50'
                  : ''
              }`}
              onClick={() => handleSelectPharmacy(pharmacy)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-lg">{pharmacy.name}</h3>
                      {pharmacy.isPreferred && (
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-bold">
                          Preferred
                        </span>
                      )}
                      {selectedPharmacy?.id === pharmacy.id && (
                        <CheckCircle className="w-5 h-5 text-purple-600" />
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{pharmacy.address}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{pharmacy.distance}</span>
                      {pharmacy.isOpen && (
                        <span className="text-green-600 font-medium">Open Now</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={selectedPharmacy?.id === pharmacy.id ? "default" : "outline"}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectPharmacy(pharmacy);
                    }}
                  >
                    {selectedPharmacy?.id === pharmacy.id ? 'Selected' : 'Select'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedPharmacy && (
        <Card className="bg-purple-50 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-purple-600" />
              Preferred Pharmacy Set
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{selectedPharmacy.name}</p>
            <p className="text-sm text-gray-600 mt-1">{selectedPharmacy.address}</p>
            <p className="text-xs text-gray-500 mt-2">
              This pharmacy will be used for prescription delivery
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

