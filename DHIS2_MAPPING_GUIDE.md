# DHIS2 Mapping Guide

DoctaRx must use Board-approved NHMIS/DHIS2 datasets, organisation units, data elements, category option combos and periods. Internal keys are not official identifiers.

## Workflow

1. Configure encrypted sandbox endpoint/credential material through the protected settings API.
2. Record formal government, data-sharing and API credential approval status.
3. Map each approved facility to the authorized DHIS2 organisation unit.
4. Map a versioned approved indicator definition to a data element and category option combo.
5. Generate a dry-run preview and inspect period, org unit, dataset, values and warnings.
6. Resolve every missing mapping and unavailable source value. `NULL` values are omitted and block live sync; they are never exported as zero.
7. Obtain report approval and export authority.
8. Test against an authorized sandbox, including duplicate prevention, retry, error and reconciliation.
9. Enable `DHIS2_ALLOW_LIVE_SYNC=true` only for the approved change window; disable it afterward if policy requires.
10. Reconcile the remote response and retain hashes/status summaries without patient identifiers or credentials.

## Current controls and gaps

Dry-run/readiness, encrypted settings, approval gates, mapping warnings, scoped MFA/RBAC and sync logs exist. Authorized sandbox proof, realistic contract server, idempotency keys, retry/backoff/reconciliation and complete indicator/facility mappings remain blockers.

Never add credentials, payloads containing patient identifiers, or unofficial mappings to Git or documentation.
