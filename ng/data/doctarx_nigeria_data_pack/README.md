# DoctaRx Nigeria data pack for agentic coding

This pack is designed to be dropped into a Codex/Cursor/Claude Code workflow.

Contents:
- `README.md` — overview and implementation notes
- `sources.json` — source registry with scraping status and intended use
- `db_schema.sql` — suggested Postgres schema
- `provider_seed_reliance.csv` — extracted Reliance provider seed rows from public state pages
- `nhia_hmo_seed.csv` — extracted NHIA HMO seed rows from the official directory
- `nhia_sshia_seed.csv` — extracted NHIA SSHIA seed rows from the official directory
- `featured_meds.csv` — practical featured medicines/categories for UI merchandising
- `nhia_meds_seed.csv` — selected NHIA formulary rows for initial meds catalog
- `codex_prompt_doctarx_nigeria.md` — production prompt for an agentic coding model
- `implementation_notes.md` — architecture logic and Nigeria-specific UX patterns

Important:
- NHIA HCP page is official but not exposed as a clean parsed table in this environment, so it is represented as a source + extraction strategy rather than a full CSV dump.
- NHIA drug list is large; this pack includes a starter seed plus schema. Extend by scraping the full official resource.
- Reliance provider directory publicly exposes state pages. This seed is a starter extraction, not guaranteed exhaustive nationwide coverage.
