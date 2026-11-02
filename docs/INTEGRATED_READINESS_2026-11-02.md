# Integrated readiness checkpoint — 2026-11-02

This is a development verification ledger, **not production acceptance or deployment authorization**. It supersedes no clinical approval. Both source branches remain separate and unmerged into main.

## Reconciled source

- Clinical foundation / draft PR 16: `3344bee6b23a1f893494284f4d441a6428cc49ee` (follow-up lifecycle, pharmacy catalogue preview and internal minimal FHIR referral read).
- Unified care AI stages: `c55a863840a1866104e8a1385f60cfd084b08849` (central provider boundary, linked clinical workflows and release preflight).
- Each source passed its existing CI before integration. Source-level passes do not establish the combined result. The integration branch must independently pass all database, recovery and browser jobs.

## Defensive corrections in this integration

| Area | Correction | Evidence required |
|---|---|---|
| Conference invitations and membership | Authenticate before consuming; atomic one-use invite and role installation; stranger and revoked membership cannot bypass waiting policy; capacity serialized with room writes | Unit regression plus real PostgreSQL concurrent redemption/capacity/end tests |
| Conference moderation | Require admitted moderator; enforce invite role/permission ceiling; provider room owner retains documented host authority | Authorization regression and generic provider-host browser flow |
| Conference media and exit | Revoke stale signaling and media after committed removal/end/cancel; current membership checked on signals; persist leave; stop late camera/screen acquisition | Deferred media regressions; synthetic three-party peer-media browser journey; real SFU remains separately gated |
| Conference invitation UI | Explicit accept, repeated-click guard and sign-in guidance; no effect-driven automatic consumption or delayed redirect | Actual invitation UI repeated-click browser journey |
| Shared WebSocket upgrades | OpenClaw claims only its own upgrade path; Socket.IO no longer receives a second invalid handshake; authenticated ICE configuration uses existing API client | Real loopback dual-protocol test fails before fix and passes after; combined-server three-party CI passed at 5f37b7e; final changed-head rerun required |
| Patient messaging | Normalize saved responses; isolate account/navigation state; preserve newer drafts and guard repeated sends | Executable component regressions; actual care-scoped encrypted-send browser journey added, awaiting changed-head CI |
| Telehealth consent | Current patient/provider care authority; capture/revoke and metadata audit in one transaction; protected signature path preserved | Service/route regressions and actual PostgreSQL authority/audit rollback tests |
| Migration release | Discard checked-out connection when advisory unlock/session reset fails; release on migration directory error | Migration release safety regressions |

Local full tests, exact configured type check, deployment guards, 27 workflow simulations, lint and production build were run on the integration. Database-dependent local tests skip because no local PostgreSQL service is available; only the exact published-head CI can establish those results. See CI links in the draft integration PR for final status rather than treating this paragraph as a permanent green assertion.

## Open engineering and acceptance work

- Implemented session correction: additive core migration041 gives refresh tokens family lineage and accounts a credential epoch. User-first transactions serialize rotation, logout and credential change/reset; password audit failure rolls back the change. New access tokens and sockets recheck epoch/family. Expired socket packets pause for bounded same-user/family reauthentication rather than dropping long consultations; changed roles fail closed. Unit and source review evidence is not a substitute for exact-head PostgreSQL and refreshed-call browser CI.
- Session rollout compatibility: pre-migration access tokens have no family and are accepted only at credential epoch0 until their configured JWT expiry (default15 minutes); any password reset/change increments the epoch and rejects them immediately. Legacy refresh tokens receive separate families. Family-aware immediate logout applies to newly issued tokens; release planning must account for the legacy access-token expiry window. Do not roll back to code that ignores epochs/families without revoking active sessions and an approved recovery plan.
- Raw OpenClaw adapter authentication now fails closed without an explicitly configured strong gateway token or explicit JWT access key; no published default credential is substituted. User identity/role, credential epoch and family are revalidated on every message and before broadcasts; logout/reset closes matching raw sessions. Payload and unauthenticated-handshake bounds are enforced. Operator availability requires the already-authorized deployment credential setup; this code does not provision credentials or activate an agent/provider. Raw adapter events no longer broadcast implicitly: explicit recipient account IDs are mandatory and each target session is revalidated. No current broadcast caller exists; any future caller must establish payload/care authorization before supplying recipients. External operator/agent functionality is not accepted merely because transport/auth tests pass.
- Whole-platform inventory is not fully re-audited. Existing auth/registration, EMR/intake, triage/SOAP, labs, Rx/pharmacy, referrals/follow-up, payments and admin tests are regression evidence, not proof that every feature or real partner works.
- Catalogue preview performs validation only; it does not fetch/import/activate a pharmacy feed. FHIR ServiceRequest is an internal, encounter-scoped minimal subset, not general FHIR certification or external transport consent.
- Live labs, pharmacies, referral partners, EMR exchange, delivery, payment settlement and production TURN/SFU require their respective sandbox/partner contracts and credentials. Synthetic fixtures do not establish live compatibility.
- Keep external clinical AI and production use disabled until documented clinician/privacy approvals, provider data terms and relevant deployment preflight pass. Manual workflows remain required.
- Production backup/restore rehearsal, encryption-key availability, additive migration/rollback review, private-repository fetch, observability and owner release approval remain independent gates. No production database, account, provider setting or deployment is changed by this branch.

## Verified integration checkpoint (not a release approval)

Commit `5f37b7ee64108bd1f9cb4b9e8866c3d06823c779` passed [CI271](https://github.com/Jonahbaka/zuma-teledoc/actions/runs/41493784322): functional tests, lint/type/build, PWA/accessibility, two-party calls, PostgreSQL migration/restore reconciliation, government role matrix and the actual combined-server three-party conference with expired-token refresh and removal/leave/end. [CareOps122](https://github.com/Jonahbaka/zuma-teledoc/actions/runs/41493784394) also passed all database, main/admin/public/membership browser and standalone isolation stages. Later code changes require their own exact-head results.

## Whole-platform evidence inventory

| Workflow | Existing executable evidence | Remaining acceptance boundary |
|---|---|---|
| Auth / registration / sessions | auth-session-integrity, auth-session-races, main/CareOps browser sign-in; real PostgreSQL rotation/logout/reset concurrency | Production delivery/MFA recovery and operational session migration acceptance |
| Video / conferences / messaging | two-party browser, three-party combined-server browser, conference PostgreSQL capacity/invite transactions, messaging authorization and UI tests | Real TURN/SFU and partner-network conditions; new messaging integrity slice requires final CI |
| Intake / EMR / clinical profile | patient-clinical-profile-integrity, clinical-encounter-integrity, medical-record-integrity; real database workflows | Clinician acceptance of actual clinical workflow and data migration |
| Triage / SOAP / AI review | triage authorization/abstention/HTTP safety, reviewed-ai-soap-import, clinical-ai-workflow-db and reviewed documentation browser | Provider privacy/data terms, human clinical validation and explicit activation approvals |
| Labs / imaging / prescriptions | Nigeria imaging authorization, clinical-record-integrity, private-prescription and provider-prescription tests, eRx intent integrity | Actual lab orders/results and partner transport contracts are not established by tests |
| Pharmacy / delivery / payments | medication delivery HTTP/settlement database tests, receipt-backed membership browser, catalogue-preview tests | Catalogue preview is not live stock/import; external payment settlement, insurance, pharmacy and courier sandbox/live acceptance |
| Referrals / follow-up / FHIR | PHC scope/consent workflow tests, encrypted task closure browser, minimal FHIR capability and database tests | External receiving-partner mapping, transport consent, acknowledgments; no full FHIR certification claim |
| Admin / public health / operations | admin-recorded-actions, government browser roles, DHIS2 delivery integrity/operations, backup/restore CI | Production least-privilege review, monitoring, partner credentials and disaster-recovery rehearsal |

## Dedicated encryption-key rollout gate

New production `encrypt()` calls now require an explicitly configured 64-hex-character `ENCRYPTION_KEY`; credential-derived and published fallback keys cannot authorize new production PHI writes. This code neither generates nor changes deployed keys. Existing decryption compatibility remains only to keep already-protected legacy records readable during a controlled transition; it is **not** approval to continue fallback-key storage. Release requires an authorized operator to verify the dedicated key, identify legacy ciphertext/key provenance, rehearse backup/restore and controlled re-encryption on a copy, and approve rollback/revocation plans. Historical exposed/default-key ciphertext must be assessed by the privacy/security owner. Removing legacy read candidates or rotating production keys requires that separate migration plan and approval. Configuration syntax tests do not establish secret strength, custody, or successful production migration.

## Messaging integrity follow-on

The next slice makes persisted canonical payloads authoritative for retry keys: mismatches return409, including a concurrent unique-key race. Account and care-grant rows are locked with message insertion; failed notification dispatch cannot turn a committed save into a failed send. Realtime delivery is best effort, explicitly scoped to current sender/recipient sessions and current care authority, never cached conversation-room membership. Idle expired recipients must reauthenticate before receiving protected content; this wait does not delay the sender's saved response. A retry does not assert receipt or repeat notification side effects. Pagination marks only returned, successfully decrypted messages read and preserves original read timestamps. UI generations preserve newer drafts and isolate account/navigation changes. These are implemented corrections with local regressions; exact updated-head PostgreSQL and browser evidence remains required.
