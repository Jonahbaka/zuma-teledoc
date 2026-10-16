# DoctaRx medication courier activation evidence

Reviewed on 15 October 2026. This research authorizes no courier booking, customer charge, or activation. Provider contract tests use isolated local fixtures and mocked HTTP. They do not prove commercial availability.

## Decision

The implemented adapter targets Uber Direct's documented merchant delivery API. **No live courier integration is activated.** Public documentation has not established Uber Direct coverage in Abuja/FCT, a DoctaRx merchant account with that coverage, or written permission for these medicine deliveries. Uber ride availability is not evidence of Direct availability. The implementation supports only sealed, ambient, noncontrolled medication parcels after licensed-pharmacist approval; cold-chain, controlled and otherwise sensitive categories remain blocked.

Kwik is a commercially relevant FCT candidate. HealthPlus/mPharma may be a pharmacy fulfillment partner. Neither is implemented through guessed endpoints. Their complete commercial API, permission, authentication, webhook and settlement contracts must be obtained before adding an adapter.

## Uber Direct evidence and contract

[Uber's supported SDK and published OpenAPI](https://github.com/uber/uber-direct-sdk/blob/main/src/deliveries/openapi.yaml) document merchant quotation, delivery creation, retrieval, cancellation and proof retrieval under `https://api.uber.com/v1/customers/{customer_id}`. Quotes return provider identifiers, integer minor-unit fares, currency, expiration and ETA. The adapter retains these values and rejects invalid currency, fractional fares, malformed timestamps, mismatched addresses and expired quotes. It never estimates an Uber fare from distance.

Delivery creation uses the approved `quote_id`, an opaque internal reference, a durable `idempotency_key`, authorized contact details and a generic parcel manifest. The SDK specifies that the default provider idempotency window is **60 minutes**, not permanent. `external_id` is a reference visible in the provider dashboard/billing; the reviewed contract does not establish an API lookup by external ID. DoctaRx must retain its own durable booking claim. An ambiguous booking response must be reconciled using signed events, its provider identifier when known, and the provider dashboard/support. It must not trigger a replacement booking after that retention window.

[Uber Direct authentication](https://developer.uber.com/docs/deliveries/guides/authentication) specifies OAuth client credentials at `https://auth.uber.com/oauth/v2/token` using scope `eats.deliveries`. Credentials stay server-side, and access tokens are cached with a safety margin. The adapter fixes the HTTPS host, refuses redirects and uses a bounded timeout. Booking and cancellation requests are never automatically retried.

[Uber Direct's FAQ](https://developer.uber.com/docs/deliveries/faq) gives a 15-minute quotation validity period and recommends identical address formatting during quotation and booking. DoctaRx uses a two-stage medicine/payment and ready-for-dispatch quote/payment process. The provider's actual `expires` is authoritative. A fresh quote and explicit approval are required after expiration or price changes.

[Uber's webhook authentication guidance](https://developer.uber.com/docs/deliveries/guides/webhooks) requires the signing key and `x-uber-signature` HMAC-SHA256 over the **original raw request bytes**. JSON parsing and reserialization may change escaped characters and invalidate that proof. The adapter checks the signature in constant time before parsing, validates the configured customer and matching delivery/status, and returns the event ID plus a payload digest. The application must store event IDs/digests to prevent replay and apply timestamp/state ordering. Production rejects signed sandbox events.

[Delivery status webhook documentation](https://developer.uber.com/docs/deliveries/daas/references/api/webhooks/delivery-status-webhook) describes pickup, transit, delivery, cancellation, return and waypoint verification fields. DoctaRx requests pickup photo and recipient signature, with an undeliverable return to the pharmacy rather than leaving medicines unattended. The adapter retains validated HTTPS proof references and verification outcomes; it excludes secret PIN values and arbitrary courier payload fields. A delivered status alone must not be represented as proof received if verification is still missing. Return records require pharmacy review and must never automatically restore returned medicines to saleable stock.

[Uber's prohibited/restricted item policy](https://help.uber.com/en/merchants-and-restaurants/article/what-items-are-restricted-through-uber-direct?nodeId=63024079-3274-4259-8c7c-96724b882da5) identifies pharmacy and prescription items as restricted and requiring Uber approval. Permission is product-, agreement- and jurisdiction-specific; general API access is insufficient. [Uber's integration overview](https://developer.uber.com/docs/deliveries/overview) describes a pilot with actual stores before broader production rollout. No pilot or medicine/FCT permission has been verified for DoctaRx.

## Nigerian alternatives

[Kwik's official FAQ](https://kwik.delivery/faq/) advertises Abuja operations and tracked local deliveries. This establishes a public service claim, not guaranteed coverage of a particular address or permission for an individual medicine. [Kwik's developer resources](https://kwik.delivery/home/developer/) link the [official Apiary API documentation](https://apikwik.docs.apiary.io/). The documentation page was accessible, but the reviewed material did not establish all required production quotation, cancellation, authenticated webhook and pharmaceutical handling contracts. Existing guessed `/orders` and simulated dispatch behavior must not be reused.

[Kwik's official partnership page](https://kwik.delivery/partnership/) advertises business logistics partnerships and temperature-sensitive services. This is a route to commercial diligence, not cold-chain approval. Obtain written FCT route/category permission, handling and liability terms, API credentials/schema/version, quote expiry and rate rules, webhook signing/replay rules, booking idempotency, cancellation/return fees, proof access/retention and settlement documentation. Until verified and implemented, Kwik is unavailable in DoctaRx checkout.

[HealthPlus describes its pharmacy and delivery services](https://healthplusnigeria.com/pages/about-healthplus), and its [store finder](https://healthplusnigeria.com/pages/store-finder) lists Abuja pharmacies. [Its published shipping policy](https://healthplusnigeria.com/policies/shipping-policy) describes website checkout/shipping and prominently discusses Lagos; this is not a merchant delivery API or proof of FCT commercial fulfillment coverage. No public partner quotation/booking/webhook API was verified. [mPharma's acquisition announcement](https://mpharma.com/2022/09/14/mpharma-acquires-majority-stake-in-healthplus/) establishes the corporate relationship, not access to private systems. A signed fulfillment/data-sharing agreement and documented technical contract are still required.

**Ordinary Bolt Send is excluded.** [Bolt Nigeria's customer terms](https://bolt.eu/en-ng/legal/rides/tnc-services-customer/) section 5.25.6 prohibits transporting drugs, medicines or medical equipment via its delivery service. No Bolt Send adapter or fallback is implemented.

## Activation configuration and responsibilities

The adapter returns unavailable without all of:

```text
NG_COURIER_DELIVERY_ENABLED=true
NG_COURIER_PROVIDER=uber_direct
UBER_DIRECT_ENABLED=true
UBER_DIRECT_CONTRACT_REFERENCE=<approved agreement record reference>
UBER_DIRECT_FCT_APPROVAL_REFERENCE=<verified service area/account record reference>
UBER_DIRECT_MEDICATION_APPROVAL_REFERENCE=<written category permission record reference>
UBER_DIRECT_CLIENT_ID=<server secret>
UBER_DIRECT_CLIENT_SECRET=<server secret>
UBER_DIRECT_CUSTOMER_ID=<approved merchant customer ID>
UBER_DIRECT_WEBHOOK_SIGNING_KEY=<server secret>
```

These references are operator attestations to independently verified evidence, not automatic verification or permission. Do not fill them with placeholders or activate based on this document. Configure the signing endpoint for `event.delivery_status` in the provider dashboard. Supported implementation region `NG-FCT` does not assert that Uber Direct is commercially available there. A successful live quotation is also required for each selected pharmacy/address pair.

Patient consent, signed prescription/pharmacist verification, approved pharmacy pickup identity/location, medication restrictions, payment/insurance evidence, quote approval, durable dispatch claim, replay protection, audit storage, refunds, payables and settlement belong to the application workflow around this adapter. The adapter must never be exposed directly to an unauthenticated client.

## Verification

`node --test ng/tests/courier-provider-contract.test.js` exercises disabled activation; every missing approval/credential; unsupported providers; mock isolation; actual documented endpoint/payload shapes; integer NGN fees; cached OAuth; privacy minimization; category/address validation; invalid and expired quotes; quote binding; durable booking keys; ambiguous failures without retries; official get/cancel paths; proof normalization; raw-body signature validation with escaped Unicode; customer/delivery matching; untrusted URL rejection; and production sandbox-event rejection.

No credentials, real customer details, real quote, payment, courier booking, provider pilot, or external settlement were used. Live operational availability remains blocked pending the agreements, verified regional/category permissions and credentials above.
