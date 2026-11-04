# DoctaRx medication fulfillment operations

This runbook covers collection, quoted delivery, payment evidence, pharmacy handover, courier tracking, refunds and financial reconciliation. It is an activation guide, not proof that a commercial courier or insurer has approved DoctaRx. No live courier, real customer charge, bank transfer or production deployment was performed during implementation.

## Release prerequisites

Read `AGENTS.md`, `docs/DOCTARX_MASTER_PROMPT.md`, the scope ledger and `docs/DOCTARX_COURIER_PROVIDER_RESEARCH.md`. Preserve CareOps PR #11 and concurrent branch changes. Keep existing clinical records, demo accounts, credentials and prices; never seed or reset production accounts. Consultation pricing is outside this change.

Use the repository's existing successful deployment workflow only after review and explicit deployment approval. Before activation, retain an encrypted database backup and verify restoration in an isolated environment, current migration checksums, application revision, API health and the payment/courier configuration. The additive medication migrations are `ng/migrations/029_ng_medication_delivery.sql` and `ng/migrations/030_ng_medication_prescription_claims.sql`; apply them through `npm run ng:migrate` after the core `npm run migrate` prerequisites. Migration application must not import provider packs or create demo records. Migration 030 retains the permanent prescription/order history while releasing only an undispatched, cancelled order's active prescription claim. Pickup/return evidence prevents release. A valid prescription can then create one replacement order without another signature or duplicate stock reservation.

The safe rollback is to disable new checkout/courier/payout activation and restore application behavior while retaining all receipts, reservations, quotes, booking claims, refunds, settlements and append-only financial/audit history. Do not drop medication tables, delete booking claims, zero balances, reverse verified payments with SQL, remove Rx reservations, or rotate the clinical/address encryption key as a rollback shortcut. Existing work in flight requires reconciliation before releasing stock or replacing a courier.

Migration 030 replaces only `ng_medication_one_digital_rx` with the active-claim unique index in the same migration transaction. This preserves all prescription, order and financial rows and retains one active order per digital prescription. The static migration verifier accepts this exact reviewed file/index/predicate pair; other index drops, removed uniqueness or a broadened predicate still fail. Run the ordinary `npm run migrations:verify` gate without a destructive override.

## Configuration and external evidence

All courier and payout activation is off when its explicit enable flag is absent. Keep credentials in server-side secret management. Never put them in browser bundles or client-prefixed environment variables. Reuse the existing `ENCRYPTION_KEY`; changing it without managed re-encryption makes saved delivery addresses unreadable.

Courier activation requires all of these values:

```text
NG_COURIER_DELIVERY_ENABLED=true
NG_COURIER_PROVIDER=uber_direct
UBER_DIRECT_ENABLED=true
UBER_DIRECT_CLIENT_ID
UBER_DIRECT_CLIENT_SECRET
UBER_DIRECT_CUSTOMER_ID
UBER_DIRECT_WEBHOOK_SIGNING_KEY
UBER_DIRECT_CONTRACT_REFERENCE
UBER_DIRECT_FCT_APPROVAL_REFERENCE
UBER_DIRECT_MEDICATION_APPROVAL_REFERENCE
```

The three approval references must identify independently reviewed agreements/evidence. A configured reference is an operator attestation, not automatic verification. Obtain written merchant/account coverage for the actual Abuja/FCT pharmacies and destinations, restricted medicine category permission, operating hours, packaging/size limits, insurance, return/cancellation charges, proof retention, data sharing, support and billing. Uber ride coverage is insufficient. Production activation of Uber Direct remains blocked until this evidence and a provider-approved pilot exist.

Set up `event.delivery_status` at `/api/ng/webhooks/delivery/uber_direct` in the provider dashboard. The global request parser preserves original JSON bytes. HMAC-SHA256 verification, configured customer matching, event ID/digest checks and delivery association occur before state changes. Other courier webhook names are rejected. A proxy must not rewrite signed request bytes. Use HTTPS and do not log payloads, contact details, proof URLs or signatures.

Medication payment processing requires its separate `NG_MEDICATION_CHECKOUT_ENABLED=true` gate (default off), the server-side `PAYSTACK_SECRET_KEY`, an approved `NEXT_PUBLIC_APP_URL` origin with HTTPS in production, and `NG_PAYSTACK_LIVE_APPROVED=true` for a live key. Live/test evidence must match the configured merchant; production refuses test evidence. No missing credential produces a successful checkout. Before enabling medication charging, independently review merchant approval, pharmacy terms, refund procedures and the patient price/consent screens. Keep new medication checkout disabled until its release approval is recorded.

Paystack signs raw bytes at `/api/ng/webhooks/paystack`. Medication references are processed through their own verified payment attempts before consultation or legacy order handlers. Refund events trigger fresh refund verification. Patient redirects, query parameters, webhook claims or a payment initialization response alone do not prove money was received.

Payout initiation is separately disabled unless all required treasury configuration and authorization exist:

```text
NG_MEDICATION_SETTLEMENTS_ENABLED=true
NG_MEDICATION_TRANSFER_FEE_RESERVE_MINOR=<approved nonnegative integer kobo reserve>
NG_MEDICATION_TRANSFER_FEE_APPROVAL_REFERENCE=<merchant-funded fee policy reference>
```

An active super administrator must supply an explicit payout approval reference. The pharmacy needs recorded `paystack_transfer_recipient_code`, `settlement_approval_reference`, `settlement_approved_at` and approved bank details. The provider recipient is fetched and compared with those bank details before initiation; arbitrary client recipient/account values are never accepted. The actual NGN merchant balance must cover aggregate medication liabilities and transfer fee reserves. Merchant funding covers processor costs; the pharmacy receives its full authorized payable even for a collection order whose processing fees exceed DoctaRx's earned fee.

**Avoid paying the courier twice.** Uber Direct may already debit its merchant billing method. Direct courier bank payouts require an explicit separately approved settlement arrangement, in addition to the treasury flags:

```text
UBER_DIRECT_SETTLEMENT_MODE=paystack_transfer
UBER_DIRECT_SETTLEMENT_APPROVAL_REFERENCE
UBER_DIRECT_PAYSTACK_RECIPIENT_CODE
UBER_DIRECT_SETTLEMENT_BANK_FINGERPRINT=<SHA256 of bankCode:accountNumber>
```

If this arrangement is not in the actual agreement, keep the courier transfer path disabled and reconcile provider billing against its invoice/payment evidence. No provider debit or rebate is invented. Kwik and HealthPlus/mPharma require documented partner API and commercial contracts before an adapter can be activated. Bolt Send is excluded.

## Clinical and inventory workflow

Only a current signed prescription routed to an approved licensed pharmacy, or an eligible pharmacy-verified upload, can create an order. Quantities must match the verified prescription. Available inventory must be verified and unexpired. The pharmacy confirms final medicine prices and the handling category; no distance estimate, guessed tax rate or simulated dispatch becomes an invoice fare.

The medication order reserves actual stock under row locks and claims its normalized Rx items. FEFO batch ordering and deterministic medicine ordering reduce contention. Operation keys and versions prevent duplicate or stale patient/pharmacy commands. Legacy direct dispensing cannot take an item claimed by another medication order, and marking a reserved item unavailable must use the order workflow. Prescription mutations lock the header, compare the expected lifecycle, and update item/header/audit within one transaction; supplied transaction clients are reused.

Patients choose collection with no courier charge, or an authorized encrypted delivery address and contact sharing consent. The final itemized charge must be explicitly approved. The registered pharmacy prepares and verifies the medicines. A delivery quote is obtained only for the actual approved pickup/destination/category and is bound to that request. Courier requests carry a generic sealed parcel description, authorized contact and location information; they exclude diagnoses, drug names and prescription records.

Dispatch needs current pharmacy/Rx/category/stock authorization, readiness, approved consent, a fresh quote and exact verified patient payment or current documented insurance coverage. A durable unique booking intent commits before the external booking request. Payment and dispatch are not made atomic by holding a database transaction across an uncontrolled retry. Keep uncertain outcomes held for reconciliation.

Courier pickup consumes the reservation and records dispensing; patient collection records the actual handover. Returned medicines are quarantined and never automatically restored to saleable stock. Clinical withdrawal, a revoked license, changed handling restrictions, expired stock or expired insurer authorization require a hold and pharmacy review; do not satisfy them by overriding payment or reservation checks.

## Pricing and recognition

Use integer NGN kobo throughout. The actual approved quote is the courier fare. Management is **75000 kobo**, earned only after completed delivery with recipient proof. Coordination is **50000 kobo** only when separately authorized, billable and not included elsewhere. Insurer-covered coordination remains an insurer receivable; it is not charged to the patient again. Taxes need individually verified applicable rules. None are added from a guessed percentage.

Medicines of 900000, courier fare of 280000 and management of 75000 produce patient total **1255000 kobo**, before separately authorized payer allocation. Pharmacy payable is 900000, courier payable 280000, and earned delivery-management revenue 75000. Money collected for the pharmacy/courier is not DoctaRx revenue. Actual payment and transfer fees are merchant expenses, evidenced by provider verification rather than a guessed fee percentage.

Quotes normally last about fifteen minutes; the provider expiration is authoritative. Preparation therefore precedes a separate delivery-stage quote/payment. A higher fresh quote requires a new approved amount and collects only the positive courier difference without another management fee. A lower paid quote first refunds the old delivery stage, waits for actual processed refund evidence, then needs a new quote/approval/payment; medicine payment remains intact. Do not dispatch while repricing/refund reconciliation is pending.

Ledger/report accounts distinguish gateway cash, insurer receivables, pharmacy/courier/tax payables, unearned management, earned management/coordination, payment processing, transfer processing and merchant-funded return refunds. Per-order cash can be negative when DoctaRx funds fees/refunds. The report is a verified transaction ledger, not a fresh bank balance. The payout preflight separately checks actual merchant available balance. Review unresolved refunds, transfers, receivables and courier invoices before calling a period settled.

The pharmacy wallet response includes a separate read-only `medicationStatement` in integer kobo: outstanding pharmacy payable, verified settled amounts and the number of orders with pharmacy financial postings. These amounts are scoped to the authorized pharmacy. Processing costs are borne by DoctaRx. They are never added to legacy wallet balances or paid through the legacy wallet settlement button; medication payouts continue through the independently approved administration workflow. A missing ledger or invalid aggregate is unavailable, never a fabricated zero balance.

## Failure and reconciliation procedures

- **Payment initialization unknown:** retain the reference and attempt. Verify it; do not create a replacement gateway charge or switch gateways. A matching successful transaction posts financial allocations exactly once. A late payment after cancellation follows the refund path.
- **Courier booking unknown:** preserve the booking ID, provider customer, quote and idempotency reference. Do not delete the claim or use a new booking key. Uber's default deduplication period is limited, so a retry after expiry can dispatch a second courier. Recover with signed matching events, known provider delivery ID or provider dashboard/support, and record reviewed evidence.
- **Unmatched courier event:** retain its receipt and digest. Investigate merchant, external reference and approved quote binding. Never attach it to a patient merely because a fare or address looks similar. Repeat processing must preserve the event identity and audit trail.
- **Missing delivery proof:** keep `proof_pending`; refresh the known provider delivery. Do not mark the management fee earned from an unverified completion claim.
- **Cancellation before pickup:** confirm absence/cancellation of any courier before releasing stock. Unique refund claims are committed before the provider refund request. A queued refund is pending; only the fetched provider refund matching transaction, currency, domain and amount can mark it processed and reverse the corresponding payable allocations.
- **Refund request unknown:** retain `requested`/`reconciliation_required`; do not reissue. Find the existing provider refund in the merchant dashboard/support, then reconcile it against the payment. A failed refund remains visible and needs operator resolution. Provider-refunded funds may take additional banking time to reach the customer.
- **External/dashboard refund:** a signed event for a known medication payment without matching local refund evidence places the payment on an audited reconciliation hold. A successful response for the original charge cannot clear this hold, because the original transaction may still say success after a separate refund. An optional numeric refund ID supplies provider evidence for review only; it never automatically posts a refund or silently re-enables dispensing/dispatch.
- **Return after pickup:** a pharmacist verifies physical receipt/quarantine with evidence. An explicitly approved administrator refund policy may refund the patient in full at DoctaRx's cost; the actual courier liability remains payable and is recorded as merchant refund expense. Never assume a courier refund or invent an additional return fare. Reconcile any actual return charge separately under the approved contract.
- **Payout unknown or reversed:** preserve the one per-order/payee claim and reference. Refresh the official transfer status. Exact approved beneficiary, amount, currency, domain and actual transfer cost must match. An uncertain/reversed previously paid transfer requires bank-ledger reconciliation; it must not automatically issue a second transfer or silently remain verified.

Failed Paystack receipts can be rechecked with the repository's existing `npm run reconcile:ng:payments` operator command after its configuration is verified. Refund recovery uses the stored provider refund ID and fresh provider evidence; raw customer payloads need not be stored. Use the authenticated administration refresh actions for refunds and settlements. Unmatched booking recovery, unknown refund creation without a provider ID, and bank transfer reversal need reviewed provider/bank evidence and an audited reconciliation, not manual deletion/retry.

## Validation before activation

Run focused provider, pricing, workflow/database, payment/webhook, financial, Rx concurrency and authorization tests, then full required lint and production build. Browser-test collection/delivery checkout and pharmacy controls at mobile/tablet/desktop sizes, including error and unavailable states. Test races with actual isolated PostgreSQL and no production records. Simulated media testing must be reported separately from live TURN/SFU/network validation.

Unit/provider tests deliberately use mocks in isolated test/development. Do not interpret them as a live provider quote, medicine-handling permission, actual settlement, insurer benefit or production activation. Record exact revisions and test receipts, show the site for review, and keep merge/deployment and real external financial/courier actions on hold until explicitly approved.
