You are Codex working in the DoctaRx/zuma-teledoc repository. Implement the Nigeria provider, pharmacy, hospital, HMO, SSHIA, medicines, featured medicines, and nearest-provider discovery system using this data pack.

Critical constraints:
- Build context from code first. Trace existing Nigeria frontend routes, discovery APIs, seed loaders, migrations, and deployment scripts before editing.
- Preserve the existing app/, components/, lib/, server/, and database architecture.
- Treat auth, PHI, patient location, prescriptions, appointments, messages, audit logging, and admin/provider access as high-risk.
- Nigeria is not the US: assume inconsistent addresses, uneven geocoding, intermittent internet, phone/WhatsApp workflows, and manual pharmacy/lab confirmation.

Use these files in order:
1. db_schema.sql
2. nhia_hmo_seed.csv
3. nhia_sshia_seed.csv
4. provider_seed_reliance.csv
5. provider_seed_nhia_hcp.csv if it has rows
6. pharmacy_seed_base.csv if it has rows
7. nhia_meds_seed.csv
8. featured_meds.csv
9. source_registry.json and ingestion_manifest.json for provenance

Implementation tasks:
- Create or update migrations for Nigeria provider, location, payer, medicine, featured medicine, medicine availability, and source registry tables.
- Add idempotent seed scripts that run locally and in production without duplicating rows.
- Update /api/ng/discovery/home so it never returns empty featured medicine or provider category cards when seed data exists.
- Add or adapt a Nigeria provider search endpoint accepting latitude, longitude, state, city, lga, provider_type, payer, medication, and radius_km.
- Use server-side nearest-provider ranking based on distance, provider type, payer, availability, verification, hours, response speed, and address confidence.
- Implement browser/mobile geolocation on the patient-facing Nigeria find-care page with permission-denied fallback to state/city/LGA manual search.
- Do not bulk geocode from the browser. Use a queued server-side geocoding job with cache and attribution.
- Add medicine search and featured medicine display with safety labels: OTC/pharmacist-review candidate, prescription required, and controlled/high-risk Rx.
- Route prescription-required/controlled medicines to consult-first flows and pharmacist confirmation.
- Add low-bandwidth UX: WhatsApp/call-back actions, address confidence labels, call-to-confirm stock, and retry/save-resume patterns.
- Add verification for seed row counts, non-empty homepage cards, GPS ranking, manual fallback, and medicine search.
- Run npm run lint and npm run build before committing.
