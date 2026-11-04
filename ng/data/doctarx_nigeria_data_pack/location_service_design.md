# Location Service Design For Nigeria

## Patient Flow
1. Ask for browser location only when the patient taps Find nearest provider.
2. If permission is granted, send latitude/longitude to the server search endpoint for that request.
3. If permission is denied or unavailable, show manual fields for state, city/LGA, area/landmark, and provider type.
4. Return provider cards with distance when exact coordinates exist; otherwise show approximate location confidence.

## Server Ranking
- 35% proximity or manual location match
- 20% requested provider/service type
- 15% payer/HMO/SSHIA compatibility
- 10% verification and source confidence
- 10% operating status/response speed
- 10% medicine/lab/service availability when relevant

## Geocoding
- Normalize address components before geocoding.
- Cache every geocode result by normalized query hash.
- Use a background queue, not client-side bulk requests.
- Keep geocoder provider configurable with GEOCODER_PROVIDER and GEOCODER_ENDPOINT.
- For public Nominatim, identify the app, keep traffic low, cache results, avoid autocomplete, and avoid systematic downloads.
