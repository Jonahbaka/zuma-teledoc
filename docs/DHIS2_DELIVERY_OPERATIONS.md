# DoctaRx DHIS2 delivery operations

This worker processes retained, independently approved aggregate reports. It is disabled by default. No credentials, government identifiers or activation evidence are created by migrations. Actual authority sandbox acceptance remains required before activation.

## Supported profile and prerequisites

Run the core and NG migrations, including additive `028_ng_dhis2_delivery_operations.sql`. Keep a tested backup and the existing encryption key lifecycle. The worker requires an explicit 64-character hexadecimal `ENCRYPTION_KEY`; it does not activate with a derived fallback key.

Through the protected DHIS2 settings API, configure the authority's actual endpoint, credentials, dataset, organisation unit and mappings, complete the government/data-sharing/privacy approvals, and set `apiVersion` to `2.43` with the actual approved `profileApprovalReference`. Unknown/unapproved versions remain blocked. `enabled=true`, `dryRunOnly=false`, a sandbox/production environment, and `DHIS2_ALLOW_LIVE_SYNC=true` are required. These settings are activation controls, not evidence of a successful connection.

Optional `asyncImportEnabled=true` supports only the approved DHIS2 2.43 data-value profile. It requires a named DHIS2 username so the stored destination identity binds the initiating and polling principal. Token-only principal discovery is not implemented for this optional profile. Verify the actual server version and account permissions in the authority's sandbox before approving the profile.

The [official data-value API](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-243/data.html) documents async initiation. The [task API documentation](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-243/maintenance.html) requires the initiating account for polling. DoctaRx accepts only a validated `DATAVALUE_IMPORT` identifier, constructs the task-summary path on the approved origin, and ignores notifier URLs. Redirects are rejected. A successful task summary still requires exact absolute remote-value readback before confirmation.

## Start and stop

Leave `DHIS2_DELIVERY_WORKER_ENABLED` unset or false until operational ownership is approved. One pass:

```sh
npm run reconcile:ng:dhis2 -- --limit=10
```

For autonomous processing, configure the deployment's existing process supervisor to run:

```sh
npm run worker:ng:dhis2 -- --limit=10
```

Set `DHIS2_DELIVERY_WORKER_ENABLED=true` in that process's secret-managed environment. Watch mode runs sequential bounded passes; `DHIS2_WORKER_INTERVAL_MS` defaults to 30000 and accepts 1000–60000. Each pass accepts at most 50 jobs; the default is 10. Multiple instances share database leases. Do not add a second transport or queue implementation.

SIGTERM/SIGINT stops taking new jobs and lets the current bounded attempt finish. Allow at least 90 seconds for graceful shutdown. If the process crashes, an expired submitting lease is recovered through GET/task reconciliation, never a second POST. Retained records survive restart.

## State and retry rules

- `POST /api/ng/integrations/dhis2/sync/:reportId` now validates and enqueues only. Queued or pending is not government acceptance. The worker independently rechecks the current report approval, payload, destination/profile, active NG delegated actor and original approver, their MFA enrollment and current report approval/export permissions before network operations.
- Only the first fresh queued claim can POST. An uncertain result uses readback. Transient 408/425/429/5xx and transport interruption receive bounded exponential backoff, a capped `Retry-After` delay and jitter. Normal attempts stop after eight claims; the polling deadline is 30 minutes. HTTP calls time out after 20 seconds and response JSON is bounded to 2 MB.
- A known async task must produce a valid complete import summary before the absolute values are checked. Pending, mismatched, missing, rejected or expired evidence cannot become confirmed. Profile/approval/principal changes require operator review rather than silently moving the retained payload.
- Result, report status and sync-log writes commit together using the current lease token. A superseded worker cannot overwrite the newer result. Commands and attempts retain operational evidence without credentials or remote narratives in logs.

## Scoped operator recovery

Use CareOps **Reports and DHIS2 delivery**. The list and evidence are limited to the current reporting scope. Review the retained result and an operational reason; avoid patient information in that reason.

`POST /api/ng/integrations/dhis2/deliveries/:jobId/commands` requires current MFA plus report approval and export authority. Its strict body is `{action,expectedVersion,reason}`; action is `reconcile` or `close`, version is the current positive integer and reason is 3–500 characters. Supply a UUID `Idempotency-Key` and reuse it with the exact normalized body after an uncertain acknowledgment. Different content under that key returns conflict. A replay returns the actual current delivery state.

`reconcile` grants one GET/task reconciliation attempt for a retained failed, rejected or reconciliation job; it preserves total attempts and never returns the job to queued. An active lease, already pending command, changed version or confirmed job rejects a new command. `close` records `closed_unresolved`, preserves all evidence and prevents further processing. It does not mark a report accepted. Changed data, destination or original report approval requires a separate independently approved report revision.

Old jobs lacking a profile remain blocked until an authorized operator explicitly reviews and schedules a GET-only reconciliation under the approved profile. A legacy task identifier without a validated task type cannot be polled; close it unresolved or use a separately approved revision. The command preserves original creator and approval attribution while recording the current reauthorizing actor separately.

## Verification and activation

Focused tests use injected HTTP responses and rollback-only PostgreSQL writes. They cover stale queued objects, expired leases, scheduling/backoff/restart, async pending/completion/readback, current-authority revocation, changed payload/destination/profile, MFA/foreign-scope denial, command retries/version conflicts and audit rollback. No live authority endpoint is contacted by those tests. Repeat the existing platform database and accessibility gates on the exact release commit, then obtain actual authority sandbox import/poll/readback receipts and operational sign-off before enabling delivery.
