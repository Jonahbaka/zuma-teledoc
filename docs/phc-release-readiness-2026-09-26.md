# DoctaRx PHC Rollout — Release Readiness Report

Date: 2026-09-26
Scope: Nigeria (NG) primary-health-care care journey, PHC training experience, and the public
progress page for the joint DoctaRx / FCT PHCB facility assessment.
Branch: `main` at `1358dbe` plus this increment.

This report deliberately separates three states. Nothing here is marked production-ready without
evidence for its real operating conditions.

| State | Meaning |
|---|---|
| **VERIFIED** | Implemented and exercised in this clean worktree, with the evidence named. |
| **AWAITING LIVE VALIDATION** | Implemented and unit/contract-tested, but not yet proven with real participants, real PHC networks, or production infrastructure. |
| **BLOCKED** | Cannot be completed here. Names the blocker and the owner. |

---

## 1. Completed work in this increment

### 1.1 Clinical record integrity (EMR)

Problem found by inspecting the code rather than the feature inventory: the provider/patient
clinical API (`ng/routes/clinical.js`, tables from `ng/migrations/017`) permitted three clinical
integrity failures that the newer PHC module (migrations 021/022) already prevented.

- **No encounter ownership on note writes.** `POST /clinical/encounters/:id/soap` authorised only
  by *patient-level* relationship. Any clinician with any appointment for that patient could append
  notes to another clinician's encounter. Now the owning clinician is required; a different
  clinician must send a covering reason (`x-covering-clinician-reason`, ≥10 chars) and the response
  returns `coveringClinician: true`.
- **No sign-off path at all.** `ng_clinical_encounters.status` permitted `'signed'` and
  `ng_soap_notes.signed_at` existed, but no endpoint ever set either — encounters were created
  `draft` and never finalized. Added `POST /clinical/encounters/:id/sign`, which stamps notes with a
  SHA-256 content digest, moves the encounter to `signed`, bumps `record_version`, and writes an
  `encounter_signed` audit row. Already-signed or non-signable encounters fail closed.
- **Silent overwrite on referral status.** `PATCH /clinical/referrals/:id/status` accepted any
  status string and replaced `audit_metadata.lastStatusUpdate`, destroying the prior transition.
  Now the transition is validated against the `ng_referrals` status set, the update is a
  compare-and-swap on the expected prior status, and every transition is appended to a new
  `ng_referral_status_events` table.
- **Amendments without overwriting.** `POST /clinical/encounters/:id/notes/:noteId/amend` creates a
  new note that references the one it replaces, marks the original `is_current = FALSE` **without
  rewriting its text**, stores the pre-amendment snapshot and digests in
  `ng_clinical_record_amendments`, and sets the encounter to `amended`. An amendment cannot itself be
  amended, and a concurrent second amendment fails with `AMENDMENT_CONFLICT`.
- **Silent, unscoped empty results.** `GET /clinical/encounters` and `GET /clinical/prescriptions`
  compared the raw `req.user.role` against `'patient'` and had no role allow-list, so a
  non-clinical role received an empty result instead of a denial. Both now deny explicitly
  (`CLINICAL_ACCESS_DENIED`, or `BREAK_GLASS_REQUIRED_FOR_LIST` for admin roles, which points to the
  audited per-patient break-glass path).

Changed files:
- `ng/migrations/023_ng_clinical_record_amendments.sql` (new)
- `ng/services/clinical/clinicalRecordIntegrityService.js` (new)
- `ng/routes/clinical.js`
- `ng/tests/clinical-record-integrity.test.js` (new, 15 tests)
- `package.json` (new suite added to `npm test`)

Evidence: `node --test ng/tests/clinical-record-integrity.test.js` → **15 tests, 15 pass, 0 fail**.
Full suite `npm test` → **184 tests, 176 pass, 0 fail** (8 DB-blocked skips, unchanged from baseline
169/161/0 — no regressions).

### 1.2 PHC training assets and low-bandwidth delivery

Problem found by inspecting shipped assets: the eight PHC field-guide illustrations were
**~2 MB each, 15.9 MB in total**, served to the exact audience the FCT assessment describes as
having variable power and connectivity.

- `scripts/optimize-training-assets.cjs` (new, reproducible) re-encodes them and emits WebP.
- Result: **15.9 MB → 4.3 MB as PNG (72.7% smaller) and 364 KB as WebP (97.7% smaller)**.
- `components/ng/phc/TrainingIllustration.jsx` (new) serves WebP first with the optimized PNG as
  fallback, explicit dimensions, and lazy loading. All 8 usages in `PhcTrainingManual.jsx` migrated.

### 1.3 Original visual assets

No GPT Images (or any image-generation) capability exists in this environment, so no model output is
claimed. The assets are **original, hand-authored SVG compositions** rendered to PNG/WebP by
`scripts/generate-phc-visual-assets.cjs` (new, reproducible):

- `public/media/ng/fct-assessment-hero` (1600×900) — used on the public progress page.
- `public/media/ng/phc-workspace-ribbon` (1600×420) — workspace header band.

No competitor artwork, photography, branding, screenshots, or text-in-image was used, and no patient
or staff information appears in any asset. Readiness data, tables, and clinical diagrams are
deliberately **not** images — they remain real HTML so they stay accurate and accessible.

### 1.4 Public progress page

`app/ng/fct-phcb-assessment/page.js` (new) summarises the assessment, grounded in the report:
the 27 August 2026 meeting, the two-day assessment of Karmo Sabo, Gwagwa, Garki Village and Pyakasa
PHCs, the observed readiness levels, cross-cutting needs, and that the way forward is for DoctaRx and
FCT PHCB to determine jointly. It states explicitly that no pilot has launched, no deployment has been
approved, and no 12-month pilot has been executed. No individual is named. It is marked as a draft
for review and is **not yet approved for publication** — see §3.

**Publication gate (deliberate):** the page is reachable by direct URL for review, but it has
deliberately **not** been added to `lib/seo/public-seo-config.cjs` (sitemap/robots) and **not** linked
from navigation. Those are the publication steps and they require organizational approval before any
statement attributed to FCT PHCB is published. To publish after approval: add
`/ng/fct-phcb-assessment` to `PUBLIC_ROUTES` in `lib/seo/public-seo-config.cjs`, run `npm run build`
so the sitemap is regenerated, and link it from the Nigeria site navigation.

### Deployment attempt log

- `c3102fe` pushed to `main` on 2026-09-26. CI, Video WebRTC E2E (NG), and LiveKit SFU E2E (NG) all
  completed **success**. The `Deploy to EC2` run failed at the step
  "Upload artifact and start EC2 deploy", after `npm ci`, the deploy gate, the production build, and
  artifact packaging had all succeeded.
- That step calls the authenticated `POST https://doctarx.com/api/upload-build-binary`. The endpoint
  answers `401` without a valid `x-deploy-token` (GitHub secret `DEPLOY_SECRET`) or a GitHub OIDC
  bearer token for audience `doctarx-deploy`. The failure is therefore a **deploy-credential or
  upload-transport issue on the live host, not a code, test, or build defect**.
- **No partial rollout occurred.** Immediately after the failure, `GET https://doctarx.com/api/health`
  reported `status: healthy` and `gitCommit: 1358dbe171e3` (the previous commit) with a healthy
  primary database. Production was never moved onto the new build.
- Confirming the exact cause needs the CI step log (needs repository Actions access) and the live
  `/api/deploy/log` endpoint (needs the deploy token).

---
## 2. State of the wider care journey

Assessed by reading the current code and running the suites, not by trusting the feature
inventory's labels.

| Area | State | Evidence / note |
|---|---|---|
| PHC clinical module (registration, consent, identity match, queue, intake, observations, referrals, follow-up, AI review gate, offline sync) | **VERIFIED (code + tests)** | `ng/routes/phc.js`, `ng/services/phc/*`: programme + facility scoping, zod validation, idempotency keys, encrypted complaint fields, audit lineage, sign-off required before completing a consultation, `ng_phc_sync_conflicts` for offline merges. Suites: `phc-workflow-*`, `programme-scope-authorization`, `phc-governance-services`, `telehealth-lifecycle-*`. |
| Observations with units, method, provenance, timestamp, missing-vs-zero separation | **VERIFIED (code + tests)** | `ng_clinical_observations`: numeric values required by validation, `method: device` requires a device, `observedAt` mandatory, public-health missing-value migration (018). |
| Legacy provider/patient clinical API | **VERIFIED (this increment)** | See section 1.1 - ownership, sign-off, amendments, referral history, explicit role denials. |
| AI assistance | **AWAITING LIVE VALIDATION** | `clinicalAiService.js` + `ng_clinical_ai_suggestions/reviews/sources`: drafting-only suggestions, review restricted to `remote_clinician` with accept/edit/reject, provenance stored (model, prompt version, input hash). Not yet validated against real clinical review; no approved data-protection arrangement with the model provider confirmed. |
| DHIS2 / national reporting | **BLOCKED (intentionally fail-closed)** | `ng/routes/dhis2.js` requires export authority for dry runs, approval authority for live sync, MFA for government roles. Live sync stays disabled until FCT PHCB authorization, credentials, approved mappings, sandbox proof, and sign-off exist. |
| One-to-one and three-party video | **AWAITING LIVE VALIDATION** | Contract/unit suites pass, but multiparty calling stays behind its guard until production SFU/TURN infrastructure and real multi-participant tests succeed. A passing contract test is not evidence. |
| Direct messaging | **AWAITING LIVE VALIDATION** | Relationship/recipient/room authorization enforced and unit-tested; two-browser end-to-end evidence with a real database was not reproduced here. |
| Device integrations | **BLOCKED (hardware)** | Gateway and ingestion tables exist. No physical device or validated protocol was available, so no device reading is claimed. Manual entry with provenance remains supported. |


## 3. Remaining blockers and owners

| Blocker | Owner | Needed to clear |
|---|---|---|
| FCT PHCB authorization, credentials, approved facility/indicator mappings, sandbox proof, sign-off for live DHIS2 sync | DoctaRx and FCT PHCB (Planning, Research & Statistics) | Joint sign-off; until then live sync stays fail-closed |
| Publication approval for any statement attributed to FCT PHCB | DoctaRx leadership + FCT PHCB | Organizational approval before `/ng/fct-phcb-assessment` is linked publicly |
| Real multi-participant video evidence and production SFU/TURN credentials | DoctaRx engineering + LiveKit account owner | Three real participants, network interruption, reconnect, departure/re-entry tests |
| Power, security, and workspace remediation (backup power, fencing, CCTV, container workstation) | Facility management + FCT PHCB | Physical works; software cannot substitute |
| Staff training completion and supportive supervision records | FCT PHCB + facility leads | Training delivery and supervision logs |
| Clinical sign-off of AI drafting behaviour and the model data-protection arrangement | Clinical lead + legal/DPO | Approved arrangement and documented review standard |

## 4. Deployment and rollback

- **Deploy path (existing, current):** `.github/workflows/deploy.yml` runs on push to `main`:
  capture pre-deploy build id, `npm ci`, `npm run test:deploy-gate`, `npm run build`, package
  `.next` plus public assets, then upload to the live server's `/api/upload-build-binary` with a
  deploy token (or GitHub OIDC) and the required secrets. The server behind `doctarx.com` is the
  deployment target.
- **Do not use** `doctarx-aws-new-ec2-deploy.yml` for an existing environment: it provisions a
  brand-new instance on every run.
- **Database:** `023_ng_clinical_record_amendments.sql` is additive (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and runs via `npm run ng:migrate`. It
  does not drop or rewrite existing clinical data. Until it is applied, the new sign/amend endpoints
  fail closed with the existing "tables are not migrated" 503 rather than writing partial data.
- **Rollback:** re-run the deploy workflow from the previous known-good `main` commit, or re-POST
  the previous artifact. The additive migration means an application rollback needs no schema
  rollback. `ng/migrations/migrate.js` enforces a checksum guard per file, so any schema reversal
  must be a new, reviewed migration.

## 5. Claims that are safe to make publicly

Safe now:

- DoctaRx and the FCT Primary Health Care Board assessed four named PHCs in the Abuja Municipal
  Area Council.
- The assessment followed a 27 August 2026 meeting; the report is dated 21 September 2026.
- It examined readiness, power, human resources, service delivery points, existing digital and
  telemedicine resources, and security.
- Observed readiness differs by facility, and specific needs were identified: backup power,
  security, connectivity, equipment, and staff capacity.
- The way forward is to be jointly discussed and determined by DoctaRx and FCT PHCB.
- DoctaRx is building and verifying software for nurse-assisted registration, queue and intake,
  remote consultation, longitudinal records with sign-off and non-destructive amendments, referral
  and escalation tracking, and aggregate reporting without patient identifiers.

Not safe to claim without new evidence:

- That the FCT PHCB has approved, endorsed, or procured anything.
- That a 12-month pilot has launched, been executed, or been scheduled.
- That the software is deployed or in active clinical use at the four facilities.
- Any patient outcome, clinical benefit, or service-quality result.
- That multiparty video calling or live DHIS2 synchronization is operational.


