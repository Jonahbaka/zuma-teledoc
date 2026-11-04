# DoctaRx pharmacy integration operations

## Access and activation

Open **Administration → Pharmacy integrations**. Administrators can read the private register; only an active super administrator can create, revise, suspend or assign a commercial profile. The backend rechecks the account for every action. Changes have audit records and optimistic version checks.

Create a draft with the agreed NGN fees. Store references to restricted agreement records, never credentials, signatures, contract attachments or patient records. An executed NDA alone does not authorize commercial activity, patient data exchange, catalogue reuse or publicity.

Before activation, record executed confidentiality and commercial agreements, approved data-sharing terms, catalogue rights, payment/settlement arrangements, the fee schedule and completed operational acceptance. Enter the agreed pharmacy quote and verified-stock validity periods. The application does not invent these periods. Obtain separate publicity permission before public name/logo use.

The pharmacist portal is the supported activation mode. External API and catalogue-feed modes, memberships, savings redemption and partner-specific insurer funding remain blocked pending separate implementation and acceptance. No partner API endpoint or live credential is created by this release.

After activation, assign only the specifically authorized, licensed pharmacy branches and record their partner branch IDs and authorization evidence. An assigned inactive profile blocks new partner orders; it does not fall back to general pricing. Suspending a profile blocks new approvals, charges and dispatches. Financial reconciliation and patient refunds remain available.

## Patient and pharmacist workflow

1. The patient chooses a reviewed prescription and authorizes the pharmacy to receive the prescription and necessary dispensing information.
2. The platform checks the selected pharmacy, catalogue IDs, prescription ownership and verified stock before reserving stock for a unique order. Catalogue imports require reviewed drug IDs; name-only product matching is rejected.
3. The licensed pharmacist confirms exact products, quantities, final medicine prices and package handling. Stock prices are indicative until this confirmation. A commercial pharmacy quote receives an immutable reference and an expiry timestamp.
4. The patient chooses pharmacy collection or delivery, reviews the itemized approved prices and consents before payment. Expired pharmacy quotes require renewed pharmacist confirmation and patient approval. Pending or uncertain payments must be reconciled first.
5. For delivery, the pharmacist prepares and verifies the order. A live approved courier quote is obtained, the patient approves and pays the exact delivery-stage amount, and the courier is booked once. New or changed courier quotes require renewed consent and correct payment adjustment.
6. Collection or verified delivery proof completes fulfillment. The signed-prescription and pharmacist verification controls remain in force. Record returns as quarantined stock and reconcile refunds; do not return dispatched medicines to saleable inventory automatically.

Substitutions, automatic refills and partial fills are not silently accepted. This checkout requires the reviewed prescription's exact quantities. A partial-fill, changed-product or remaining-balance request needs pharmacy review and a separately validated workflow before it can be offered. The EMR provides an order-scoped FHIR R4 medication exchange interface; this does not establish an active external pharmacy connection. See `FHIR_EMR_INTEGRATION.md` for resources, authorization and partner acceptance requirements.

## Charges and reconciliation

Commercial fees apply only to authorized branches and are frozen on the order. Collection carries no courier or delivery-support fee. Delivery passes through the actual approved courier quote, separately from the configured DoctaRx delivery-support fee. The commercial order-service fee includes coordination; the general coordination fee cannot be added again. Consultation prices are unchanged.

Medicine collections remain a pharmacy payable. Courier collections remain a courier payable. Commercial order-service collections remain unearned until collection or delivery completion; delivery-support collections remain unearned until proven delivery. Actual processing costs, insurer receivables where separately supported, refunds and verified settlements have separate ledger accounts. Never deduct processing costs from the pharmacy's medicine payable.

Open **Administration → Medication delivery** to reconcile ledger accounts, payment evidence, refunds and settlements. A pending payment, refund or transfer is not completed financial evidence. Settlement requires explicit activation, current super-administrator approval, adequate actual funds and a verified payee arrangement. Existing accepted orders retain their fee schedule when a profile is revised.

## External acceptance still required

- Courier coverage, pharmaceutical carriage permission, credentials and contract acceptance must be independently verified before courier activation. No real courier is activated by profile creation.
- Partner APIs and stock feeds require official specifications, identifiers, authentication, signed-event and replay rules, reservation/expiry semantics and acceptance testing. File access requires an approved secure exchange and mapping review.
- Partial fills, substitutions, partner FHIR exchange, memberships, savings and insurance benefits need separate validated contracts and workflows. Their absence must be stated during pilot acceptance.
- SMS/email and other external delivery channels require configured providers and monitoring. Do not promise a notification channel based only on a proposed partnership.
- Restrict pharmacy access to the pharmacy's own authorized orders. Couriers receive minimum delivery contacts, locations and approved handling details, without diagnoses, medication names or prescription documents.

## Release verification

Run `npm run test:ng:medication-delivery`, the medication PostgreSQL/HTTP suite against an isolated loopback database ending in `_test`, lint, production build and relevant browser checks. Apply migration `031_ng_pharmacy_commercial_profiles.sql` through the existing checksum-verified migration runner. It creates configuration tables and nullable fulfillment fields without seeding partners or changing existing orders.

Normal release uses the existing `.github/workflows/deploy.yml` artifact workflow. The existing recovery workflow now uses the configured GitHub OIDC role and SSM to inspect or restart only the named application. It does not open inbound ports, alter Cloudflare Tunnel, reset source code, build on the operator's computer or seed accounts.
