# Proposed manual return custody recovery

Status: **default-disabled; not approved for live use**. This is a code/test preparation for returns after the original pharmacy becomes unavailable. It is not evidence of a partner integration, operational approval, legal compliance, a completed transfer, or a refund.

## Release gates

Before any real use, obtain documented clinician, privacy and operations approval for the procedure, recipient verification, patient authorization, physical handover, quarantine, incident handling and evidence retention. Review the API and any eventual operator interface with those owners. Exercise the disposable PostgreSQL race/reconciliation suite and exact-commit CI. Obtain deployment authorization separately. No production configuration or real patient information is included here.

The service is disabled unless NG_RETURN_CUSTODY_ENABLED is exactly `true` and NG_RETURN_CUSTODY_CLINICIAN_APPROVAL, NG_RETURN_CUSTODY_PRIVACY_APPROVAL and NG_RETURN_CUSTODY_OPERATIONS_APPROVAL each contain an opaque recorded approval reference. Missing or malformed references deny even parcel reads before any custody-data query. Existing authentication may still query the current account. References are evidence pointers, not automatic verification of professional approval. Changing an approval reference invalidates existing nominations. Keep all flags unset until release approval. This change provides API scaffolding, not an operator-facing UI or an automatic transfer process.

## Operator protocol requiring approval

1. A current active Nigeria super-administrator verifies documented patient permission to share a specific returned parcel with a specific receiving pharmacy, a custody-transfer approval, and that pharmacy's acceptance. Store only opaque references, never the consent document or patient/clinical details in this endpoint.
2. Nominate a different currently active, approved and professionally authorized pharmacy and its current owner. The original pharmacy or its owner must be unavailable. The order must already have courier return evidence and its stock must already have been released from saleable/reserved inventory through the existing fulfillment workflow. Only sealed ambient medication parcels are eligible. Other medication/return categories remain blocked for a separately supervised process.
3. A nomination lasts at most 24 hours. It is specific to the order, receiving pharmacy and owner, approval protocol and immutable nomination ID. It can be superseded or explicitly revoked before physical custody is recorded. A change in owner, licence, account status, authorization, or current nomination denies access. Re-nomination requires newly verified authorization, not reuse of an old request key.
4. Coordinate any physical handover through the separately approved manual procedure. The API sends no message, books no courier and reveals no patient name, prescription, medicine, address, telephone, price or payer to the receiver. The receiver gets only a parcel/order reference, handling category, nomination ID/time, expiry and current version. Do not infer that a nomination means a transfer occurred.
5. Only that current active receiving pharmacy owner may attest that the parcel was physically received and quarantined, with an opaque evidence reference. Do not attest before a witnessed receipt. Returned medicines are not restocked, dispensed, or made saleable by this API. Custody provenance identifies the alternate pharmacy, rather than attributing it to the original pharmacy's dispensing activity.
6. Custody recording does not initiate payment or refund. The existing, separate super-administrator merchant-funded return-refund approval remains mandatory. Existing financial reconciliation must still verify the refund; no success is assumed.

## API contract

All routes require the existing authenticated Nigeria application context. Service authorization additionally checks current database role, account, market, pharmacy ownership and licence in the same transaction. Administrator credentials never substitute for receiving-pharmacist authority. Responses are private/no-store.

- GET `/api/ng/admin/medication-delivery/return-custody/availability`: activation state only, no approval references.
- POST `/api/ng/admin/medication-delivery/:orderId/return-custody/nominate`: version, stable idempotencyKey, receivingPharmacyId, patientAuthorizationReference, transferApprovalReference, receivingAcceptanceReference, expiresAt, authorizationVerified=true, sealedAmbientOnly=true.
- POST `/api/ng/admin/medication-delivery/:orderId/return-custody/revoke`: version, stable idempotencyKey, current nominationId, reasonReference. Denied after physical receipt.
- GET `/api/ng/pharmacy/:pharmacyId/return-custody?after=0`: minimal current nominated parcels; follow nextCursor until null. Expired/closed/revoked entries are omitted while the cursor still advances.
- POST `/api/ng/pharmacy/:pharmacyId/return-custody/:orderId/receive`: version, stable idempotencyKey, current nominationId, evidenceReference, physicallyReceivedAndQuarantined=true.

Evidence references accept only 3–120 characters of letters, digits, dot, underscore, colon and hyphen, starting with a letter/digit. They are not URLs, free text or an attachment channel. All unrecognized input fields are rejected. A 409 means refresh/review current authority before acting; do not assume receipt. A 503 means unavailable or a transactional failure, never a successful transfer. Retries must keep the same key and payload; current authority is rechecked before returning a prior result.

## Storage and verification

No schema change. Nominations, revocations and attributed alternate-custody receipts use existing append-only medication events. Order and fulfillment locks serialize competing commands; the latest nomination is read after the order lock. Current actor and pharmacy authorization are held through commit. Evidence, version, idempotency record and compliance audit commit together. A custody receipt reference is visibly prefixed `alternate-custody:<nominationId>:` for subsequent review.

Hermetic tests cover disabled gates, permissions, minimum disclosure, replay, supersession, wrong order, ownership/account/licence changes, expiry, revocation, pagination, route errors and audit rollback. The isolated PostgreSQL suite additionally tests blocked supersession races, immutable history, rollback, and unchanged inventory, dispensing and payment counters before a separate refund approval. Synthetic transports exist only in the pre-existing test fixture. A local skip is not a PostgreSQL pass.
