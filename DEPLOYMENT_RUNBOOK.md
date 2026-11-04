# Deployment Runbook

This supplements `docs/DEPLOY_RUNBOOK.md`; it does not authorize production deployment.

## Preconditions

1. Use the reviewed commit SHA, Node 22.13+ and a clean checkout.
2. Confirm `OPEN_BLOCKERS.md` has an approved disposition for the target environment.
3. Verify secrets are supplied by the deployment secret store, never files committed to Git.
4. Confirm a tested database backup and named rollback owner.
5. Keep `NG_MEDICAL_IMAGING_AUTHORIZED` and `NEXT_PUBLIC_NG_MEDICAL_IMAGING_AUTHORIZED` unset unless re-authorization is documented.
6. Keep `DHIS2_ALLOW_LIVE_SYNC` unset until formal approvals, mappings, sandbox proof and a change ticket exist.

## Staging sequence

```text
npm ci
npm audit --omit=dev
npm run lint
npm test
npm run build
node ng/migrations/migrate.js
```

Then start the candidate on a non-public port, verify `.next/BUILD_ID`, query the application and Nigeria health endpoints, run database-backed smoke tests and only then switch the reverse proxy. The Nigeria health endpoint is expected to remain `503 degraded` until the government import/quarantine/data-quality schema is implemented; do not override that signal.

## Stability gate

- Confirm process stays ready for at least 10 minutes under representative smoke traffic.
- Confirm database connection, query latency, error rate, queue depth and disk/memory are within approved thresholds.
- Confirm authentication, one patient read/write, one clinician read/write, one scoped government aggregate read and a denied cross-scope request.
- Confirm logs contain no tokens, PHI, DHIS2 secrets or media credentials.

## Rollback

Stop traffic activation, restore the previous release directory/SHA, restart the previous PM2 process definition and verify its health. Database migration 018 is backward compatible because it only permits null report values; do not re-add a default zero during rollback. If data was written with nulls, older code must not be reactivated unless it handles them safely.

## Production activation

Production activation, live migrations, DHIS2 enablement, imaging enablement, or merge to `main` requires explicit approval. Record deployed SHA, migration filenames, operator, timestamps and post-deploy evidence.
