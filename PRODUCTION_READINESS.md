# Production Readiness

Classification: **Ready for automated production deployment** (2026-08-21), subject to the required PR checks and the existing deployment workflow completing successfully for the merge commit.

This classification covers the implemented DoctaRx and Nigeria government-data release. It does not represent legal, clinical, NDPR, or government approval. Integrations that lack an authorized production credential or institutional approval remain fail-closed and disabled rather than being simulated with production users.

## Completed release scope

- PostgreSQL-backed source registry, CSV/XLSX/JSON staging, field mapping, validation, quarantine, checksum idempotency, duplicate prevention, maker-checker approval, atomic commit, reconciliation, rollback, and lineage.
- Scoped government search, autocomplete, recent searches, saved views, filtered export, and approved-record executive aggregates. Missing observations remain null and are never presented as measured zero.
- Mandatory real TOTP login plus short-lived MFA session verification for government APIs, active expiring jurisdiction assignments, granular action permissions, object-scope checks, and audited access.
- Transactional governance transitions and fail-closed audit/lineage behavior.
- DHIS2 readiness, dry-run, mapping, approval, and live-sync safety gates. Live synchronization remains disabled until authorized configuration is complete.
- Nigeria medical imaging remains server-authorized and disabled by default.
- The merged Nursing Education release is pinned by immutable commit in `.github/workflows/deploy-aux-platforms.yml`.

## Required automated evidence

| Gate | Required result |
|---|---|
| Clean checkout | `npm ci`, high-severity audit, lint, functional/regression/portal suites, deploy guards, simulations, production build, PWA/mobile/accessibility, and two-party browser media/chat all pass. |
| PostgreSQL recovery | Core and Nigeria migrations run twice, checksums are recorded, government DB workflows pass, a populated backup restores into a separate database, row/entity checksums reconcile, and the restored workflow passes again. |
| Authenticated role matrix | Patient, provider, pharmacy, government, and executive workflows pass on desktop and mobile with no serious/critical accessibility violations, console errors, or failed API requests. Government and executive actors use real TOTP verification. |
| Deployment | The merge commit is built in CI, deployed through `.github/workflows/deploy.yml`, and verified by `/api/health` with `nextReady=true` and the expected commit. |
| Auxiliary deployment | The established auxiliary workflow deploys the exact pinned Nursing Education commit and verifies its isolated route and static assets. |

## Controlled activation boundaries

- Do not enable live DHIS2/NHMIS synchronization until the owning institution supplies approved mappings, organization units, credentials, and data-sharing approval.
- Keep Nigeria medical imaging authorization flags unset until formally approved.
- Keep optional SFU/TURN, payment, communication, delivery, and AI providers fail-closed when their production credentials or readiness checks are absent.
- Use fictional or formally de-identified data for automated validation. Never mix presentation/demo records with real user or government data.
