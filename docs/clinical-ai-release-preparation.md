# DoctaRx Clinical AI release preparation (non-deploying)

This is a release-preparation record for stacked PRs #16, #17, #18. **Do not merge or deploy solely on this document.** Clinical sign-off and privacy approval remain independent and unresolved (issue #19).

## Migration safety

- Nigeria migrations now acquire a single checked-out PostgreSQL connection, serialize concurrent invocations with `pg_advisory_lock`, use a per-file transaction and check exact migration checksums.
- Run `npm run migrations:verify` and then apply core + NG migrations **twice** in a disposable PostgreSQL environment using the CI workflow. Inspect the `ng_migrations` manifest before any real-data migration.
- File 034 replaces the AI suggestion-type CHECK constraint in a single migration transaction; verify all existing types are allowed. File 035 adds nullable provenance links and an equality CHECK to avoid half-linked prescriptions. Both need synthetic data/integrity checks.
- **Roll back code using a known-good build.** Do not drop PHI tables or remove columns in production as a rollback. Before any future migration of real data, take and verify an encrypted backup, rehearse restoration to an isolated database, record recovery point/time objectives, and plan post-backup external event reconciliation. A schema/data failure needs maintenance-mode writes stopped and an independently reviewed forward fix or restore.
- The root startup will not complete API initialization until NG migration verification succeeds. The production workflow should be separately reviewed for an explicit pre-deploy migration gate, rather than relying on app startup alone.

## Runtime configuration and secrets

- **Default clinical operation for the next deployment: AI DISABLED.** Explicitly set `CLINICAL_AI_KILL_SWITCH=true`, `CLINICAL_AI_ALLOW_EXTERNAL_PHI=false`, and `CLINICAL_AI_ALLOW_DEMO_GROQ=false` on production.
- Groq GPT-OSS 120B and `GROQ_API_KEY` are for synthetic development/test only, with `CLINICAL_AI_PROVIDER=groq` and `CLINICAL_AI_ALLOW_DEMO_GROQ=true` set on a nonproduction sandbox. Never expose the key via `NEXT_PUBLIC_*`, repo, client bundles, logs or health endpoints.
- `CLINICAL_AI_ENCRYPTION_KEY` must be an independently managed random 32-byte secret (64 hex characters or base64), separate from JWT/session/DB/encryption keys. Generate and provision it using the secret-management workflow; never put key bytes or a copy of production PHI in GitHub.
- `node scripts/clinical-ai-release-preflight.cjs` checks nonsecret configuration constraints and fails closed. It cannot prove the existence or quality of GitHub secrets, key rotation, a processor agreement, or the policy suitability of an external provider.
- The existing `env.example` and deploy workflow must be kept synchronized. Any activated external model with real clinical data requires renewed DPO/security and clinical review; a ChatGPT subscription does not supply those permissions.

## Observability and incident control

- `/api/health` shows a **nonsecret** `clinicalAi` state containing kill-switch active, provider configured and production activation blocked.
- Monitor source-linked draft creation/review audit actions, external model timeout/error counts, error codes, stale source rejections, unauthorized read attempts, queue/referral/pharmacy status lag, DB migration failures, high memory and request latency. Log structured counts/codes and request IDs **without** patient text, generated notes, credentials or prompt bodies.
- Exercise the kill switch on a synthetic programme: new generation, clinician review, and AI-linked Rx/referral/follow-up action must stop; ordinary manual triage, charting, prescribing and referrals must remain available.
- When provider health degrades, set the kill switch and use normal clinician workflows. Public `/api/health` is **not** permission to reveal clinical data or keys.
- A release incident requires a named on-call owner, threshold/alert destination, patient safety escalation, audit preservation, and documented time of disablement/reactivation.

## Final gate

1. CI and CareOps must pass on exact final PR commit, not a previous baseline.
2. Migration checksum/restore and synthetic patient journey tests must pass and evidence must be attached.
3. Secret inventory, key rotation, incident alerting, production kill-switch value and backup/restore rehearsal must be verified by operational owners, not guessed from repository code.
4. Issue #19 must contain clinician and privacy reviewer names, decisions, dates and approved exact commit.
5. Do not merge PRs or deploy until explicitly authorized after those approvals.
