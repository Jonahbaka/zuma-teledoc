# Nigeria Discovery Pipeline

This repo now includes a Nigeria-specific provider, payer, and medicine discovery layer that is seeded from the real data pack committed under [`ng/data/doctarx_nigeria_data_pack`](C:\Users\One Stop\Documents\New project\ng\data\doctarx_nigeria_data_pack).

## What it loads

- `provider_seed_reliance.csv` into provider match groups and source rows
- `nhia_hmo_seed.csv` into payer networks
- `nhia_sshia_seed.csv` into state insurance agencies
- `nhia_meds_seed.csv` into the shared `ng_drug_catalog`
- `featured_meds.csv` into featured medicine categories and access logic

## Commands

Run the Nigeria migrations:

```bash
npm run ng:migrate
```

Ingest or refresh the committed Nigeria discovery pack:

```bash
npm run ng:seed:pack
```

## Production deploy behavior

The deploy command now runs both:

```bash
node ng/migrations/migrate.js
node ng/scripts/ingest-doctarx-nigeria-pack.js
```

That keeps the production server idempotent after each deploy and ensures the discovery experience is backed by the committed seed files instead of local-only workstation data.

## Current discovery routes

- `GET /api/ng/discovery/home`
- `GET /api/ng/discovery/providers`
- `GET /api/ng/discovery/medicines`
- `GET /api/ng/discovery/payers`
- `POST /api/ng/discovery/events`
- `POST /api/ng/discovery/fallback`

## Notes

- Provider ranking prefers GPS when available, then falls back to city and state matching when addresses are incomplete.
- Internal Nigeria telehealth providers and approved pharmacies are blended into the search results alongside the seeded provider directory.
- NHIA provider rows are not yet imported because the official HCP page still needs a cleaner extraction path. The schema and search layer are prepared for that future seed.
