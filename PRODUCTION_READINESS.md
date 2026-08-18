# Production Readiness

Classification: **Not Ready** (2026-08-18).

The candidate builds and its local unit/contract suite passes, but the production gates are intentionally not declared complete. The government import/search platform is missing, mutable PostgreSQL tests were not run, LiveKit/TURN media-plane proof is unavailable, DHIS2 has no authorized sandbox evidence, browser/accessibility/mobile matrices were not completed, and backup/restore has not been demonstrated.

## Remediation completed on this branch

- Removed an outer admin gate that prevented legitimate scoped government roles from reaching granular authorization.
- Made government operational roles depend on active database-backed jurisdiction assignments; scope lookup and audit writes fail closed.
- Added mandatory enrolled and session-verified MFA to public-health, governance, DHIS2, and executive APIs.
- Enforced jurisdiction/facility/programme object scope on governance reads and state transitions.
- Replaced string-role approval/reviewer bypasses with scoped middleware gates.
- Made governance submission creation and state transition plus workflow logging transactional.
- Restricted scoped executive summaries to accessible jurisdictions.
- Added granular DHIS2 route authorization and audit events.
- Preserved unavailable aggregate metrics as null/blank, omitted them from DHIS2 previews, and blocked live sync rather than exporting zero.
- Made the Nigeria health endpoint derive readiness from schema/provider configuration and remain degraded while import/quarantine/data-quality capabilities are absent.
- Hid medical imaging routes and referral specialties by default behind explicit server and client authorization flags.
- Fixed high-risk dependency findings; clean full and production audits report zero known vulnerabilities.

## Gate summary

| Gate | Result | Evidence / blocker |
|---|---|---|
| Clean install | Pass | `npm ci --prefer-offline --no-audit --no-fund`, 897 packages |
| Dependency audit | Pass | full and `--omit=dev`: 0 vulnerabilities |
| Lint | Pass with debt | 0 errors, 38 pre-existing hook/font warnings |
| Unit/contract suite | Pass with explicit skips | Final run: 135 passed, 8 DB-backed tests skipped; regression 12/12 and portal contract 14/14 passed |
| Production build | Pass | Next.js 15.5.23, 222 static pages generated |
| PostgreSQL migrations/read-write | Blocked | no isolated `SIMULATION_DATABASE_URL` supplied |
| LiveKit/TURN media | Blocked | no authorized SFU/TURN credentials |
| DHIS2 sandbox | Blocked | no authorized sandbox credentials/mappings/approval |
| Government import/reconciliation | Fail | subsystem is absent; readiness endpoint remains degraded |
| Browser/mobile/accessibility | Blocked/incomplete | no authenticated fictional staging environment |
| Backup/restore | Blocked | no disposable production-like database target |
| CI from pushed commit | Pending | branch/PR publication is a separate release step |

## Release decision

Do not deploy this branch to production. It is suitable for code review and for constructing a controlled staging environment. Reclassification requires closing every P0/P1 entry in `OPEN_BLOCKERS.md`, running the database and external-provider gates, and recording institutional approvals without treating technical controls as legal or government approval.
