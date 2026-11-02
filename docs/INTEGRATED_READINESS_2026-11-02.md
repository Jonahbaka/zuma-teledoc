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
| Patient messaging | Normalize normal-created and idempotent response shape so confirmed sends remain visible | Existing message authorization/idempotency tests; dedicated send-display browser coverage still outstanding |
| Telehealth consent | Current patient/provider care authority; capture/revoke and metadata audit in one transaction; protected signature path preserved | Service/route regressions and actual PostgreSQL authority/audit rollback tests |
| Migration release | Discard checked-out connection when advisory unlock/session reset fails; release on migration directory error | Migration release safety regressions |

Local full tests, exact configured type check, deployment guards, 27 workflow simulations, lint and production build were run on the integration. Database-dependent local tests skip because no local PostgreSQL service is available; only the exact published-head CI can establish those results. See CI links in the draft integration PR for final status rather than treating this paragraph as a permanent green assertion.

## Open engineering and acceptance work

- Refresh-token rotation remains a known concurrency issue: token lookup/revocation/successor insertion are separate writes. Credential-reset/change and active-session invalidation require an atomic, independently tested follow-on correction. Do not describe authentication as fully accepted while this remains open.
- Whole-platform inventory is not fully re-audited. Existing auth/registration, EMR/intake, triage/SOAP, labs, Rx/pharmacy, referrals/follow-up, payments and admin tests are regression evidence, not proof that every feature or real partner works.
- Catalogue preview performs validation only; it does not fetch/import/activate a pharmacy feed. FHIR ServiceRequest is an internal, encounter-scoped minimal subset, not general FHIR certification or external transport consent.
- Live labs, pharmacies, referral partners, EMR exchange, delivery, payment settlement and production TURN/SFU require their respective sandbox/partner contracts and credentials. Synthetic fixtures do not establish live compatibility.
- Keep external clinical AI and production use disabled until documented clinician/privacy approvals, provider data terms and relevant deployment preflight pass. Manual workflows remain required.
- Production backup/restore rehearsal, encryption-key availability, additive migration/rollback review, private-repository fetch, observability and owner release approval remain independent gates. No production database, account, provider setting or deployment is changed by this branch.
