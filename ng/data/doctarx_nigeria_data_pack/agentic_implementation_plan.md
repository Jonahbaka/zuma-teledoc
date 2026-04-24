# DoctaRx Nigeria Provider And Medicines Implementation Plan

## Goal
Populate the Nigeria experience with real seed data for HMOs, SSHIAs, partner providers, medicines, featured medicines, and a privacy-aware nearest-provider search that works on mobile devices and weak networks.

## Phase 0 - Guardrails
- Do not treat Nigeria discovery like a US provider directory. Addresses can be incomplete, geocoding coverage varies, and phone/WhatsApp confirmation matters.
- Keep location permission optional. Patients must still be able to search by state, city, LGA, area, or landmark.
- Store source_url, extracted_at, verification_status, and confidence on every imported row.
- Do not persist raw patient GPS history unless it is required for a care workflow and consented.

## Phase 1 - Database Foundation
- Add tables for ng_providers, ng_provider_locations, ng_hmos, ng_sshias, ng_medicines, ng_featured_medicines, ng_provider_medicine_availability, ng_location_search_events, and ng_data_sources.
- Use PostGIS if available; otherwise implement latitude/longitude columns with a Haversine fallback.
- Add indexes for provider_type/state/LGA, medicine search text, and coordinate columns.

## Phase 2 - Data Ingestion
- Import nhia_hmo_seed.csv and nhia_sshia_seed.csv as official coverage entities.
- Import provider_seed_reliance.csv as a large Reliance/Alafia partner provider seed, but still treat it as seed data that needs verification.
- Import provider_seed_nhia_hcp.csv only if it has rows. This run produced 0 parsed rows.
- Import nhia_meds_seed.csv as a medicines reference catalog, not stock availability.
- Import featured_meds.csv as homepage/search cards with clear safety labels.

## Phase 3 - Location
- Add a browser/mobile geolocation prompt only after the patient taps a location action.
- If permission is denied, show state/city/LGA/landmark manual search.
- Add a server-side geocoding queue with caching by normalized address hash.
- Keep the geocoder provider configurable. Public Nominatim can be used only within policy limits and must be swappable.

## Phase 4 - Ranking
- Rank by proximity, provider type, payer compatibility, verification, hours/response speed, and medicine/service availability.
- Label location confidence as exact, street, city, state-only, or call-to-confirm.
- Always show phone/WhatsApp/callback actions for low-bandwidth contexts.

## Phase 5 - Medicines UX
- Separate OTC/pharmacist-review candidates, prescription-required medicines, and controlled/high-risk medicines.
- Route prescription-required and controlled/high-risk medicines through consult-first and pharmacist confirmation.
- Never imply the NHIA drug list means real-time pharmacy stock.

## Phase 6 - Verification
- Add seed import tests for required columns, duplicate handling, and row-count sanity checks.
- Add API tests for discovery home, GPS nearest-provider search, manual LGA fallback, and medicine search.
- Add UI tests for empty-state prevention on Nigeria homepage/find-care/medicines.
- Run npm run lint and npm run build before commit/deploy.
