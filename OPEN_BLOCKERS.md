# Activation Boundaries and Follow-up Work

There are no known code, database-migration, browser, backup/restore, or deployment-workflow blockers for the implemented release candidate. The following items are controlled activation prerequisites or post-release operating work; they must not be bypassed with placeholder credentials or demo data.

## External activation prerequisites

- Live DHIS2/NHMIS: institutional approval, approved indicator mappings, dataset and organisation-unit identifiers, authorized sandbox evidence, production credentials, and reconciliation sign-off.
- Nigeria medical imaging: explicit product, clinical, and government authorization before setting either server or public authorization flag.
- Optional LiveKit/TURN, payment, email/SMS, delivery, and AI providers: production credentials plus their existing readiness/health checks before enablement.
- Institutional operations: approved ownership, access-review, retention, legal-hold, incident-response, offboarding, and indicator-governance policies.

## Follow-up hardening

- Expand three-party SFU/TURN and physical mobile-device media evidence when the optional shared-media infrastructure is enabled.
- Conduct formal government user acceptance testing against an authorized de-identified dataset before institutional rollout.
- Continue performance/load characterization as facility, import, and observation volumes grow.
- Complete recurring access reviews, restore drills, dependency audits, monitoring tests, and incident exercises on the production cadence.

Technical completion does not imply NDPR, legal, clinical, or government approval.
