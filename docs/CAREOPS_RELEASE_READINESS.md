# DoctaRx CareOps and patient workflow foundation

Implementation review — 13 October 2026

This change establishes the first implementation milestone from the approved patient/CareOps plan. It is a reviewable application and security foundation. It does not certify the whole repository for production or activate an external healthcare, insurer, payment, or government agreement.

## What is available

| Area | Implemented behavior | Verification and limits |
| --- | --- | --- |
| CareOps | Separate `/careops/login`, clinical workspace, public-health records, reports/delivery, and `/careops/insurance`. Navigation uses Clinical care, Public health, Reports, and role-gated Insurance. Existing PHC services remain the shared clinical core. | Desktop/mobile sign-in and government MFA exercised using the provisioned DoctaRx demo accounts in isolated PostgreSQL. Browser inspection does not seed accounts, reset passwords, or create/rename patients and facilities. Separate application deployment, domain, and SSO are subsequent infrastructure work. |
| Brand and readability | Existing DoctaRx blue/cyan wordmark and care imagery, navy navigation and blue actions, readable sans-serif typography, 16px minimum interface text and 48px controls. Clinical typography also applies to the shared patient/provider portal shell. | Clinical and government screens scanned for WCAG 2 A/AA and 2.1 AA; automated scanning does not establish full accessibility conformance. Images and fonts finish loading before preview capture. |
| Patient booking | Reviewed symptom/history intake; medications/allergies may explicitly remain unknown. AI guidance is optional. Provider and patient market membership comes from the database. | Real PostgreSQL concurrent bookings yield one reservation and one conflict. Provider-row locks are shared by creation/rescheduling; appointment revision checks prevent stale updates. Patients cannot set clinical status or provider notes. |
| Consent and records | Active, effective, state-appropriate consent version displayed for explicit review; electronic acknowledgement required. Record loading failures remain distinct from empty history. Text records can be opened. | State/version/acknowledgement checks are server-side. Consumer appointment admission and jurisdiction-specific consent policy still require clinical acceptance. |
| Clinical EMR | Existing encrypted PHC intake, observations, queue, clinician sign-off, referral, follow-up and reporting services are reused. Late worklist/action responses cannot replace a different facility context. | Real database workflow exercises intake, device fixture, signed clinical note, completion, referral and reporting. Device fixtures do not validate medical hardware. |
| MFA | Signed, user-bound and access-token-bound MFA proof replaces the unsigned `mfaVerified=true` cookie. Proof expires after 15 minutes; refresh preserves its original expiry. | Forgery, replay across users/tokens, expiry and refresh rotation tested; real TOTP sign-in exercised in the browser. Existing sessions must sign in again. A dedicated in-session step-up dialog remains follow-up UX work. |
| Financial/clinical object access | Patient ownership, current market, provider relationship and claim ownership enforced before legacy claim/insurance/FHIR access. | Negative HTTP and database ownership/market cases tested. This is not a complete audit of all historic repository routes. |
| Nigeria consultation payments | Server-approved tariff snapshot; NGN integer kobo invoices; one persistent Paystack attempt; hosted checkout; independent server verification; one ledger posting; payment receipt and refund-review request. | Amount/reference/currency/environment mismatch, ambiguous initialization, concurrent confirmation and signed webhook replay tested using synthetic gateway responses. No real charge was made. Refund review does not transfer funds. |
| Pharmacy payment repair | Reference reserved before network initialization; automatic gateway fallback removed; verified confirmation locks the order and commits wallet, revenue and audit together. | Real PostgreSQL replay/concurrency proves one wallet/revenue/audit posting. Settlement execution and accounting acceptance are still external/operational work. |
| Insurance management | Programme insurer registry, Insurer onboarding form, and explicit adapters for eligibility, authorisation, claims and remittance. Every call rechecks activation evidence and capability. | No live insurer adapter is registered. Hygeia's acknowledgement is an onboarding review, not an active contract. Registry entry or stored insurance details never establish eligibility. |
| Video | Official LiveKit server SDK, bounded join tokens, server-derived media grants, admitted participant/room checks, room controls and signed raw-body webhook receipts. | Token/webhook and existing conference authorization/lifecycle tests pass. Real SFU/TURN, hosting-specific revocation and three-device media acceptance remain required. |
| PHC FHIR | Programme/facility/clinical-role/enrollment/consent-scoped Patient and Encounter reads plus Observation search by encounter. Observations preserve zero, unit codes, missing components and clinical status. | Positive database serialization, foreign-facility denial, government-role denial and value/unit tests. Base R4 subset only; no partner implementation-guide, SMART/OAuth or hospital connectivity claim. |
| Legacy FHIR repair | Patient/Encounter/MedicationRequest mappings use real migrated columns; unsupported profile assertions removed; basic bundle validation tightened. | Patient/Encounter serialization exercised. Legacy observations fail visibly with 503 because their expected `vitals` table does not exist; use the scoped PHC endpoint. |
| Government access | Current assignment rows and per-resource jurisdiction, facility, programme and permission checks. Read, preparation, approval and export rights cannot be borrowed from another assignment. Search/source/report/submission filtering occurs before totals/pagination. | Real database revocation and same-jurisdiction programme privilege cases; browser denies clinical FHIR and national analytics to a scoped government account. |
| DHIS2 delivery | Strict numeric aggregate payload, official UID shapes, independent report approval, persistent payload/destination identity, leases, attempts and result evidence. Ambiguous POSTs reconcile by reading remote values rather than blindly submitting again. | Synthetic remote import/GET fixtures plus real local delivery-job transactions. `synced` requires matching remote values; HTTP 200 alone is insufficient. |

## Visible reductions and changed contracts

- Forced AI intake and untrusted client triage data are removed from booking. Smart-booking clients must send `intake.historyReviewed=true` and explicit medication/allergy statuses.
- Legacy transportless prescription delivery returns unavailable; unconnected eligibility is unknown; synthetic claims are explicitly labelled and allowed only outside production with `ALLOW_SYNTHETIC_INTEGRATIONS=true`.
- The consumer prescribing screen no longer offers a transportless Send action or automatic prior authorisation. Estimated medicine pricing is labelled unverified.
- Legacy national charts, forecasts and executive calculations are restricted to platform administrators because their queries do not consistently implement all assignment axes. The executive page now renders a read-only approved-record workspace with scoped metadata and no import or export controls. Replacing the aggregate calculations is subsequent work; displaying them as scoped would be misleading.
- DHIS2 transmission requires both approval and export authority for the same report. Governance submission scope must agree with the underlying report; metadata cannot move a foreign report into an actor's scope.
- Ambiguous payments retain the original reference and require reconciliation. They cannot start another collectible payment through an automatic retry or alternative gateway.

## API entry points

All protected endpoints use the existing application authentication. CareOps uses the same server and database in this milestone; it is a distinct product surface, not a separately deployed service.

| Path | Purpose |
| --- | --- |
| `/api/ng/funding/partners` | Programme-scoped insurer onboarding registry; facility/programme administration membership required. Existing API naming is retained for compatibility; product navigation is Insurance. |
| `/api/ng/billing/invoices` | Current NG patient's consultation invoices and approved-tariff invoice creation. |
| `/api/ng/billing/invoices/:id/checkout` | Initialise or reuse the existing hosted Paystack attempt. |
| `/api/ng/billing/invoices/:id/verify` | Verify the owned attempt with the payment provider. |
| `/api/ng/billing/invoices/:id/refund-request` | Request review; no automatic refund. |
| `/api/ng/webhooks/paystack` | Original-byte HMAC verification, retained receipt and idempotent confirmation. |
| `/api/ng/webhooks/livekit` | Official SDK authorization/body verification and deduplicated media evidence. |
| `/api/ng/interop/fhir/Patient/:id` | Enrolled and consented patient in the selected clinical context. |
| `/api/ng/interop/fhir/Encounter/:id` | Canonical PHC encounter inside the selected context. |
| `/api/ng/interop/fhir/Observation?encounter=:id` | Encounter-scoped observations, `_count` and `_offset` pagination. |
| `/api/ng/public-health/reports/:id/delivery` | Authorised report's retained delivery summaries. |
| `/api/ng/integrations/dhis2/sync/:reportId` | Initial delivery or reconciliation of its retained job. |

PHC FHIR requests require `programmeId` and `facilityId` context query parameters or the existing `x-programme-id` and `x-facility-id` headers. No patient-level FHIR access is granted to government reporting roles by their job title.

## Migration and rollout

1. Review the complete diff and deploy to an isolated staging environment first. Use an approved supported Node release; Nodemailer 10 requires Node 20 or later. The repository already requires Node 20.19 or later; local linting also warns on Node 22.12 because a development dependency requires 22.13 or later.
2. Take a backup and prove restore in staging. Run the existing server and NG migration runners. New `025_ng_funding_and_delivery.sql` adds partner, tariff, invoice, attempt, ledger, webhook-receipt and delivery-job tables. It seeds no real tariff, insurer agreement or secret.
3. Ensure the server and Next application are deployed together. New client contracts and signed MFA proofs are incompatible with trusting the old boolean MFA cookie.
4. Leave consultation checkout disabled until merchant testing and pricing approval. `NG_PATIENT_CHECKOUT_ENABLED=true`, `PAYSTACK_SECRET_KEY` and a valid approved tariff are required. Live keys additionally require `NG_PAYSTACK_LIVE_APPROVED=true` and an HTTPS `NEXT_PUBLIC_APP_URL`. No fees or medical tariffs are hardcoded.
5. Configure verified Paystack and LiveKit webhook destinations. Keep secrets in the deployment secret store. Gateway callback redirects are UI navigation; they are not payment confirmation.
6. Use the existing protected DHIS2 settings flow only after the receiving authority supplies its approved endpoint, dataset, organisation unit and category IDs. Do not replace them with invented IDs. Persisted delivery identities prevent silently moving an approved payload to another destination.
7. Ensure CareOps assignments, institutional access and MFA are provisioned intentionally. Production must not run synthetic seed scripts or enable synthetic integrations.

The public route sitemap continues to use an explicit public allowlist. CareOps and consultation billing are excluded from robots indexing; application authorization remains the actual access boundary. Consumer analytics are omitted on the standalone clinical/government workspace routes.

## Verification performed

- `npm test`: core production-foundation tests plus existing authorization, conference, clinical integrity, lifecycle, regression and portal suites.
- `node --test ng/tests/careops-production-db.test.js ng/tests/phc-workflow-db.test.js ng/tests/government-data-db.test.js`: real PostgreSQL booking, pricing, ledger, webhook, clinical and government workflow cases.
- `npm run lint`: no errors; 38 existing hook-dependency warnings elsewhere in the repository.
- `npm run build`: optimized Next production build, including the new routes.
- `npm run migrations:verify`: 36 server migration files, no blocking findings; NG migrations separately applied and rerun against the isolated database with checksum verification.
- `node scripts/e2e-careops-ui.cjs`: actual application login, nurse context/navigation, mobile width, government TOTP sign-in with workspace preservation, insurance administration privilege denial, government clinical-FHIR denial, national-analytics denial, report-delivery workspace and read-only executive approved-record view. Clinical and government Axe scans returned no violations in the exercised states.
- `npm audit --omit=dev`: no reported runtime advisories after updates. Full audit retains eight high development-tool alerts rooted in the unpatched `braces` glob-processing chain used by Tailwind, nodemon and Next ESLint. No forced Tailwind-major upgrade or framework rewrite was applied.
- No production database, real patient record, live payment, insurer submission or government transmission was used in validation.

The new `CareOps foundation` GitHub workflow repeats integrity/database checks on an isolated PostgreSQL 16 service and exercises browser roles/accessibility. Remote workflow results must still be reviewed on the PR; local PostgreSQL validation used PostgreSQL 18.

Database suites and the browser script require an explicitly supplied disposable database. The new production-foundation/browser suites reject non-loopback targets or database names not ending in `_test`. Existing older database suites only check that `DATABASE_URL` is present; operators must not point them at production. Browser previews reuse the provisioned demo accounts, use a separate `.next-careops-preview` output directory, and close the servers they start. Isolated automated database suites retain their required test fixtures.

## External activation and remaining engineering gates

| Gate | Required evidence/work before activation |
| --- | --- |
| Paystack | Approved merchant, test-mode initialization/verification/webhook/reconciliation, approved consultation tariffs, accounting sign-off, cancellation/dispute/refund operating procedure. Paystack is the implementation default for Nigeria; direct Nigerian Stripe API access is not assumed. |
| Flutterwave | Provider-specific reference/transaction-ID verification and webhook/ledger tests before activation. Existing optional code is not validated by this milestone and automatic fallback is removed. |
| Hygeia and other HMOs | Executed agreement, benefit/eligibility rules, identifier/disclosure contract, authorization/claim transport documentation, sandbox receipts, remittance reconciliation and approved capability activation. |
| DHIS2 | Receiving authority's metadata/version and sandbox, aggregate privacy/data-quality review, approved reporting agreement, actual import receipts and remote-value reconciliation. Background retry scheduling, async-task polling and an operator resolution workflow remain work; the current synchronous action can reconcile retained jobs without re-POSTing. |
| LiveKit | Actual SFU/TURN configuration, low-bandwidth and mobile/browser tests, three-way nurse/patient/clinician call, join removal/revocation proof for the chosen hosting mode, continuity and reconnect acceptance. Tokens and mocked contract tests do not prove media transport. |
| FHIR/EHR | Named partner implementation guide, terminology/profile validation, Practitioner/Organization resolution, consent/disclosure policy, integration authentication, partner sandbox round trip and operational receipt handling. The included structural validator is not a complete official FHIR validator. |
| Clinical readiness | Licensed clinician review, emergency escalation, consent policy, prescribing and referral partner acceptance, longitudinal reconciliation and patient-safety sign-off. AI documentation remains draft/review-based in the existing PHC workflow. |
| Operations | Separate CareOps deployment/SSO decision, backup/restore, encryption-key lifecycle, monitoring/alerts, load and failure testing, incident recovery and approved data-retention processes. |
| UI coverage | Further patient/provider screen simplification and manual keyboard/screen-reader testing. The screenshots and scans cover the stated screens, not every historic portal. |

## Recovery

Pause new checkout by disabling `NG_PATIENT_CHECKOUT_ENABLED`; preserve verification and reconciliation for retained attempts. `npm run reconcile:ng:payments` processes retained verified Paystack webhook receipts; schedule it only in an environment with approved operational ownership. Payments that arrive after cancellation retain their verified receipt and require operator reconciliation rather than granting clinical completion.

DHIS2 retains approved payload/destination identity and pending or failed evidence. After an ambiguous submission, reconcile the retained job against the approved destination. A rejected/failed job or changed payload requires operator review and a separately approved report revision. There is no automatic destructive retry.

Do not drop invoice, ledger, receipt or delivery tables as a code rollback. Do not redeploy older unsigned-MFA or non-idempotent financial handlers while live callbacks can arrive. Prefer disabling new actions and deploying a reviewed forward fix; a full restore requires an approved reconciliation plan for external events that occurred after the backup.

## References for integration acceptance

- [FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html) and [Encounter](https://hl7.org/fhir/R4/encounter.html).
- [Paystack webhooks](https://paystack.com/docs/payments/webhooks/) and [transaction verification](https://paystack.com/docs/payments/verify-payments/).
- [Stripe global availability](https://stripe.com/global) describes the Nigeria extended network through Paystack; it is not direct Nigerian Stripe account/API activation evidence.
- [LiveKit server APIs](https://docs.livekit.io/home/server/managing-rooms/) and [webhooks](https://docs.livekit.io/home/server/webhooks/).
- [Nodemailer requirements and CommonJS/SMTP support](https://nodemailer.com/).
- [Remaining braces development-tool advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
