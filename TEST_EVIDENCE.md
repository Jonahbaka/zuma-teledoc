# Test Evidence

Evidence date: 2026-08-21. Authoritative evidence is produced from a clean GitHub checkout by `.github/workflows/ci.yml`; failure artifacts are retained for diagnosis and successful runs are linked from PR checks.

| Gate | Evidence contract |
|---|---|
| Dependency and source validation | Clean `npm ci`; high-severity audit; lint; functional, regression, portal, deployment-guard, state-machine, and simulation suites. |
| Production frontend | Next.js 15.5.23 production build; 224 application routes; bundle credential scan; PWA/mobile/accessibility browser gate. |
| Real browser media/chat | Two isolated Chromium actors establish peer media, receive remote audio/video, exchange in-call chat, exercise controls, and finish without console/network failures. |
| PostgreSQL migrations | Core and Nigeria migrations run twice and the migration checksum ledger is verified. |
| Government data workflows | Real PostgreSQL source registration, import preview/staging, validation/quarantine, duplicate/idempotency handling, approval/commit, scoped search/export, jurisdiction isolation, rollback, and audit/lineage assertions. |
| Backup and restore | A populated `pg_dump` is restored into a separate database; source/restored rows and entity checksums reconcile; migrations and government workflow proof rerun on the restored database. |
| Authenticated role browsers | Patient, provider, pharmacy, government, and executive workflows run at desktop and mobile viewports. Government roles complete real TOTP authentication. Each run captures screenshots, accessibility output, console errors, and failed API requests; serious/critical accessibility findings and HTTP/API failures are hard failures. |

## Local release-head checks

- `node --check tests/e2e/government-role-matrix.spec.cjs`: passed.
- Targeted ESLint for modified role dashboards and government workspace: passed.
- `npm run build`: passed; 224 routes generated.
- `git diff --check`: passed for release changes.

## Evidence limits

- Automated records use fictional accounts and test observations; they are not institutional UAT and are never mixed with production users.
- DHIS2 live sync, medical imaging, and optional external providers are not reported as active without their authorized credentials and approvals.
- Production deployment evidence is the merge-commit deployment run plus live health/static-asset verification, not a local HTTP probe.
