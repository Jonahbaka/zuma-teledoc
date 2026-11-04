# DoctaRx Nigeria Agentic Data Pack

Start here so another Codex/ChatGPT agent does not guess which files matter.

## Primary Files
- codex_prompt_only.md
- agentic_implementation_plan.md
- db_schema.sql
- ingestion_manifest.json
- source_registry.json

## Seed Files
- provider_seed_reliance.csv: Reliance/Alafia partner provider seed parsed from the public provider page.
- provider_seed_nhia_hcp.csv: parsed NHIA HCP output if public facility rows are exposed.
- pharmacy_seed_base.csv: pharmacy subset if parsed.
- nhia_hmo_seed.csv: official NHIA HMO extract.
- nhia_sshia_seed.csv: official NHIA SSHIA extract.
- nhia_meds_seed.csv: official NHIA medicines list extract.
- featured_meds.csv: curated storefront/search cards.

## What Not To Do
- Do not claim all seed providers are verified.
- Do not promise medicine stock from the NHIA medicine list.
- Do not call public Nominatim from client autocomplete or bulk jobs.
- Do not store unnecessary patient raw GPS history.
