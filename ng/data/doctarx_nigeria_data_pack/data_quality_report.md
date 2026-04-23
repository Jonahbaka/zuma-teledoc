# Data Quality Report

Generated: 2026-04-23T08:51:41.746Z

## Row Counts
- provider_seed_reliance.csv: 1909
- nhia_hmo_seed.csv: 83
- nhia_sshia_seed.csv: 37
- nhia_meds_seed.csv: 1020
- featured_meds.csv: 15
- provider_seed_nhia_hcp.csv: 0
- pharmacy_seed_base.csv: 76

## Quality Notes
- NHIA HMO, SSHIA, and medicine rows were parsed from public NHIA HTML tables.
- Reliance/Alafia provider rows are larger than the supplied starter seed, but still need verification and geocoding.
- The NHIA HCP page may not expose facility rows through accessible public HTML; treat provider_seed_nhia_hcp.csv as opportunistic and verify before import.
- The medicine list is a catalog/reference, not inventory.
