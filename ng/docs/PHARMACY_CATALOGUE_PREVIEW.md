# Pharmacy catalogue validation preview (contract v1)

`POST /api/ng/pharmacy/:pharmacyId/inventory/catalogue-preview`

This authenticated, transport-free endpoint validates a proposed partner feed
against the existing drug catalogue. It does **not** connect to a supplier,
fetch a URL, import inventory, verify availability, approve a clinical mapping,
or activate an integration. A passing preview is not permission to dispense.
External API/file activation remains blocked by the existing commercial policy.

## Scope and input

The current NG account must be an administrator or the owning pharmacy account.
The pharmacy must remain approved, verified and licensed. The supplied profile
and branch reference must match its already-recorded commercial branch binding;
suspended profiles are rejected. Preview does not create branch bindings or
bypass the existing approvals needed to create them.

The JSON envelope has exactly these properties:

- `schemaVersion`: `1`
- `profileId`: the recorded UUID
- `partnerBranchReference`: the exact recorded reference
- `generatedAt`: ISO timestamp with time zone, no future dates
- `items`: 1–500 rows; the complete request is at most 256 KiB

Each item must contain exactly:

- `partnerItemId`, `drugId` (existing catalogue UUID)
- `identity`: `name`, `dosageForm`, `strength`, `packSize`, `manufacturer`
- `quantityUnit`: `catalogue_pack`
- `quantityAvailable`: nonnegative integer, at most 2,147,483,647
- `unitPriceMinor`: nonnegative integer **kobo per catalogue pack**, at most
  999,999,999,999; `currency`: `NGN`
- `batchNumber`, `expiryDate` (real `YYYY-MM-DD`, later than today's UTC date)
- `observedAt`: ISO timestamp with time zone, not after `generatedAt`

All identity fields must be present and match the local record after trimming
and case normalization. There is no fuzzy matching, synonym resolution,
strength conversion, pack conversion, substitution or automatic medicine-ID
assignment. Incomplete local identity, inactive products and locally unapproved
products fail. The stored approval flag is not independently verified with a
regulator by this endpoint.

Feed and row timestamps must be within the profile's configured
`inventoryMaxAgeSeconds` (60–86,400). The caller cannot override this setting.
Duplicate partner item IDs or catalogue-product/batch pairs fail every
conflicting row. Unknown properties—including URLs, tokens and patient data—
are rejected, not forwarded. No clinical or credential information belongs in
this request.

## Response and interpretation

A scoped, structurally valid envelope returns HTTP 200 with `valid`, `rows`
(index, valid, reasons), `accepted`, `rejected`, and `profileVersion`. Row-level
failure is a successful validation operation, **not** an accepted import.
`persisted`, `liveConnection`, `availabilityVerified` and `activationAuthorized`
are always false. Responses omit stored catalogue values and use `no-store`.

Envelope errors return 400, over-size requests 413, unauthorized/unbound scope
403, missing freshness configuration 409, and stale/future feed timestamps 422.
A data-store failure returns a generic 503 without database details.

## Remaining partner onboarding

A real adapter still needs the partner's agreed specification, reviewed stable
product/branch mapping, consent/data-sharing and catalogue rights where
applicable, credential/transport controls, replay and ordering safeguards for
actual writes, operational acceptance, and independent activation authorization.
This preview supplies a bounded contract test; it does not replace those steps.
