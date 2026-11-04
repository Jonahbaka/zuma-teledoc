# Current-session binding for live voice

The development-only broker now requires **two independent authorization dependencies** in addition to its provider: current evaluation/processing approval and current authenticated-session authority. A provider plus an approval callback cannot enable a broker without an explicit session-authority checker. The shipped application mount configures neither a provider nor these readers, and production still cannot activate the prototype.

## Verified request binding

After the existing JWT and current-session checks succeed, authentication attaches a frozen, server-only `authSessionContext`: current user ID, verified token family ID, explicit credential version and token expiry. It contains no raw credential and is not returned to the browser. Existing authentication decisions for other application routes remain unchanged.

The voice route constructs its actor from the authenticated user and this verified context. Request bodies, local browser storage, model output and an arbitrary claimed role cannot supply or replace it. The voice session checker requires a valid family ID, explicit nonnegative credential version and finite future token expiry. Legacy unbound tokens can retain their existing general-application compatibility but cannot authorize live voice.

The broker retains the original binding. Another session family cannot connect or renew the old permit, and a newer access token in the same family cannot expand its original expiry. An authenticated owner may still perform cleanup from a different valid family or after role removal, without receiving creation or read authority.

## Fresh authority reader

`createVoiceSessionAuthority` is an **unmounted adapter**, not an account store, credential reader or new login mechanism. Its composition must provide `readSessionSnapshot({ userId, familyId })` from an authoritative, consistent current source. The source must not be a client assertion, cached approval or model result.

The expected snapshot contains:

- `observedAt`, an integer epoch-millisecond timestamp no more than one second old and not in the future.
- `principal`: matching ID, active account, canonical current role, provider approval status, required-password-change state and integer credential version.
- `family`: matching family/user IDs, active/non-revoked status and future integer expiry.

The reader must canonicalize roles in the same way as authentication, reflect family revocation/expiry and credential rotation, and return a consistent observation. The authority checker performs no SQL itself. A separate minimal PostgreSQL snapshot reader is now implemented but remains unmounted and locally tested only through query doubles. See [PostgreSQL session reader](VOICE_POSTGRES_SESSION_READER.md). Real database/source and transaction-isolation acceptance are still required before activation.

Every check rereads without a cache. Missing state, account/role/approval changes, pending password rotation, mismatched credential epoch, family revocation, stale observation, failed read or one-second reader timeout fails closed. Token expiry is checked both before the read and after it resolves. Expected primitive binding values are captured before awaiting, so caller mutation cannot replace the family/version under review.

## Active-session revocation and cleanup

The broker invokes session authority before and after evaluation-policy I/O, at reserve/connect/HTTP lease and on each server-owned five-second background lease. It checks cancellation/expiry again after awaited authority work. A Stop while an authority reader is pending cannot create a provider later. Revocation during provider creation closes the resulting connection before an answer is returned.

The evaluation adapter returns its observation timestamp and the earliest expiry across all required approvals. After the last awaited session check, the broker synchronously rejects stale or expired approval results. This prevents authority reads from carrying an expired processing approval into provider creation.

The permit expires at the earliest of its three-minute cap, original token expiry and original approval expiry. Fresh checks can shorten this deadline when approvals expire sooner, but cannot extend the original deadline. This also gives the browser an earlier local stop deadline. Background session denial initiates provider termination even if a now-invalid access token can no longer reach the HTTP lease or stop route. Detection/termination is subject to scheduling, bounded reader latency and provider-close latency; it is not an instantaneous revocation guarantee.

Cleanup does not require the admission checker to approve again. Existing pending-creation and failed-termination handles/receipts remain intact. A confirmed close is not confirmed final usage/accounting. Real-provider outages, process loss, durable reconciliation and retention remain separate pre-activation work.

## Evidence and limits

Actual-JWT loopback tests now demonstrate that active family and credential-epoch revocation cause the background checker to terminate a fake provider, and original token expiry independently ends it. Earlier HTTP denial alone did not establish that. Additional tests cover legacy tokens, family replay, delayed/stalled readers, expiry during a read, revocation while evaluation approval or provider creation is pending, cancellation during a reader wait and owner cleanup after role removal.

The actual-auth suite uses real middleware/JWT/current-session code with a fictional database query source, the real PostgreSQL snapshot adapter and a fictional evaluation-approval callback/provider. Older broker/media/browser fixtures explicitly inject test-only session authority as well; their success is not authentication proof. No real PostgreSQL, account, patient, model, microphone or camera was used. Browser cases remain unexecuted.

This is local, default-disabled engineering work. It does not alter the frozen repository upload payload, activate a service, grant processing approval, create credentials or publish/deploy anything.

Independent account-status suspension is now part of the current-session check: both is_active=true and exact accountStatus='active' are required. Missing/legacy-null/unknown statuses fail closed. Background checking terminates the fake provider after an independently suspended account is observed, even if its token family and credential epoch remain valid. Generic authentication is unchanged.
