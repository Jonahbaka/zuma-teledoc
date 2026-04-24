# Data Quality Report

Generated: 2026-04-23T08:51:41.746Z

## Row Counts
- provider_seed_reliance.csv: 1909
- nhia_hmo_seed.csv: 83
- nhia_sshia_seed.csv: 37
- nhia_meds_seed.csv: 1020
- featured_meds.csv: 15
- provider_seed_nhia_hcp.csv: 1662
- pharmacy_seed_base.csv: 76

## Quality Notes
- NHIA HMO, SSHIA, and medicine rows were parsed from public NHIA HTML tables.
- Reliance/Alafia provider rows are larger than the supplied starter seed, but still need verification and geocoding.
- The NHIA HCP landing page does not consistently expose facility rows in accessible public HTML; provider_seed_nhia_hcp.csv now uses Integrated Health Care HMO's public NHIA provider directory and includes 181 FCT/Abuja rows.
- The medicine list is a catalog/reference, not inventory.
