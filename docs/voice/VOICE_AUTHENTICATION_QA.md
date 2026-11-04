# Voice route authentication evidence

`server/tests/voice/voice-authenticated-http.test.js` exercises the real JWT verifier, complete `authenticate` middleware, `assertCurrentSession`, Express live-voice router and voice broker through an owned loopback HTTP server.

The signing key is generated in memory for the test and is never persisted, printed or sent externally. Database and financial-membership doubles are installed before the authentication module is loaded, so this suite does not initialize the real database module, load its dotenv configuration, connect to PostgreSQL or use actual credentials. The database double accepts only the read-only current-user/current-refresh-family queries and the exact parameterized voice snapshot statement; other statements fail. The PostgreSQL snapshot adapter itself is real, while its query results remain fictional. Provider connection and termination are in-process fakes. The suite does not replace the JWT verifier, authentication handler or current-session policy.

## Executed coverage

The current suite has eighteen cases; the original fourteen-case checkpoint reproduced the active-session gap before the separate session-binding fix. Current coverage:

- Missing, malformed, incorrectly signed and expired access tokens fail before any database or voice-policy read.
- Hausa, Igbo and Yoruba permit creation uses actual token verification and current-user/current-session-family checks.
- Cookie tokens use the same authentication path as bearer tokens.
- A stale/forged role claim cannot override the current database role; a request-body actor claim is rejected.
- Credential-version changes and revoked refresh-token families block connect/lease or new permit creation before provider creation.
- Inactive accounts, unapproved providers and required-password-change accounts cannot reach the voice authorization policy.
- Role removal blocks new voice authority but permits cleanup by the still-authenticated owner. Another authenticated actor cannot stop it.
- Connect, lease and terminal receipts retain owner isolation, with a fake provider connected and terminated exactly once.
- Missing users and malformed family identifiers fail before voice authorization.
- Production remains disabled after successful authentication, even when a provider fixture and feature flag are supplied.
- Active-family and credential-epoch revocation deny HTTP access and independently terminate the fake provider through the bound server background checker. Original token expiry also ends the permit.
- Legacy tokens missing family/version/expiry cannot authorize voice, verified metadata is frozen, and another session family cannot replay a permit.

All requests receive private/no-store cache headers. The original test-only checkpoint did not change runtime authentication. The separate session-binding slice adds frozen server-only metadata while preserving authentication acceptance behavior for unrelated routes. No application/provider composition, clinical path, dependency or permission setting is enabled.

## What this does not establish

This is stronger evidence than injecting a user object into the router, but it is not real PostgreSQL, login issuance, browser-cookie/CSRF behavior, full application-session integration or provider validation. The membership authority read is a fixture rather than a payment/account assertion. The voice policy and provider are also fixtures; this suite does not grant an approval or enable a live connection.

The existing authentication policy's compatibility behavior is unchanged. This suite tests modern family-bearing tokens, and does not claim that all legacy tokens are family-bound. Deactivated/expired/revoked credentials still cannot use an authenticated cleanup route; that situation relies on immediate local audio shutdown plus the separate server-owned revocation/expiry and reconciliation design. The separate session-binding adapter now checks family, credential epoch and token expiration during background leases; see [current-session binding](VOICE_SESSION_BINDING.md). The concrete PostgreSQL snapshot adapter is implemented and exercised over fictional query results, but is not installed in the application or connected to a real database. Live activation still requires that composition and real integration tests, plus reconciliation for uncertain termination. A successful HTTP denial here is not proof that an already-running external session has terminated or that all provider usage is final.

The 32 prepared browser cases remain unexecuted. No microphone, camera, rendered browser interaction, patient data or real external service is involved in this suite.

Run the focused suite with `node --test server/tests/voice/voice-authenticated-http.test.js`; `npm run test:voice` also discovers it.
