# DoctaRx Nigeria Full Agentic Data Pack

Generated: 2026-04-23T08:51:41.746Z

This pack is for implementing populated Nigeria providers, pharmacies/hospitals, HMOs/SSHIAs, medicines, featured medicines, and location-aware nearest-provider search.

## Use First
- README_FOR_CODEX_AGENT.md
- codex_prompt_only.md
- agentic_implementation_plan.md
- ingestion_manifest.json

## Seed Files
- provider_seed_reliance.csv
- provider_seed_nhia_hcp.csv
- pharmacy_seed_base.csv
- nhia_hmo_seed.csv
- nhia_sshia_seed.csv
- nhia_meds_seed.csv
- featured_meds.csv

## Design Files
- db_schema.sql
- implementation_notes.md
- location_service_design.md
- data_quality_report.md
- source_registry.json

## Import Order
1. db_schema.sql
2. nhia_hmo_seed.csv
3. nhia_sshia_seed.csv
4. provider_seed_reliance.csv
5. provider_seed_nhia_hcp.csv if rows exist
6. pharmacy_seed_base.csv if rows exist
7. nhia_meds_seed.csv
8. featured_meds.csv
