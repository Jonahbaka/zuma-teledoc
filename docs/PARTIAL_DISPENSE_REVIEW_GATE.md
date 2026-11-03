# Partial dispensing and legacy quantity review

Status: implementation proposal and local safety controls. This is not clinical approval, a live integration certification, or permission to deploy.

## Supported behavior

The normalized prescription engine supports dispensing each signed item in full. A prescription can still be partially dispensed across different items. It does not implement splitting a single item's signed quantity across multiple handovers, managing a remaining quantity, or authorizing a replacement prescription. Short item quantities are therefore rejected before clinical writes. Full quantities, existing order reservations, and valid unavailable/cancelled final items retain their existing lifecycle.

Completion and inbox fulfillment require actual matching recorded quantities, not merely a historical `fully_dispensed` label. Prior inconsistent quantities are never overwritten or converted to an assumed remainder. The prescription detail also reflects unresolved quantity-related handover events; changing an item record alone does not clear the hold. It shows the discrepancy and suppresses dispensing/completion controls. New medication reservations and dispatch are denied when a quantity discrepancy exists.

## Already-occurring physical handover

Trusted courier reconciliation is different from authorizing another handover. If an existing order already has verified physical handover evidence and a legacy quantity discrepancy is discovered, the transaction preserves the provider-bound pickup/delivery proof, order status, inventory release and existing payment/financial recognition facts. It appends an audited `handover_requires_clinical_review` event. It does not create more normalized Rx or FHIR dispense records, complete the prescription, dispense a presumed remainder, initiate another payment, book another courier, or initiate a refund. Existing clinical evidence remains unchanged. A review-audit failure rolls the transaction back; it is not swallowed.

The checkout exposes a review notice alongside the actual delivery and payment status. A historical prescription lifecycle label may remain unchanged, including an incorrect old `fully_dispensed` label; the notice and quantity guard prevent treating that label as validated clinical completion. Replayed provider evidence does not release inventory twice, duplicate a review event, or manufacture additional medication. Existing cancelled/expired-prescription handling is unchanged. Order quantities are compared to aggregate signed quantities before clinical writes. The current courier FHIR writer only supports one signed item per drug ID. Multiple signed items sharing a drug ID are therefore denied for new courier checkout and retained on review hold after an existing physical handover; this patch does not invent combined dosing directions or FHIR attribution. Direct full per-item pharmacy dispensing remains supported.

## Required before live use

- A licensed clinical owner must approve the full-item restriction and how discrepant historical quantities are reconciled. Do not infer what the patient actually received from conflicting records.
- Operations must designate who receives these review notices, how patients contact that team, response-time expectations, and how unresolved holds are escalated. The code does not supply a clinical resolution workflow or silently clear a hold after record edits.
- Any future correction must preserve original evidence and include explicit clinical authorization, provenance and an independently reviewed resolution design. Additional medicine, refunds or physical custody transfers require their separate approved workflows. This patch authorizes none of them.
- Run disposable PostgreSQL regression/race suites and required CI against the exact published commit. Local mock tests are not evidence of PostgreSQL execution.
- Complete authorized staging checks and obtain clinical/operations and deployment approval. No real patient, courier or financial action was used to validate this patch.

This is a narrow safety gate, not a complete audit of the prescription, refill, clinical or financial platform.
