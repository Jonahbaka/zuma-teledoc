# DoctaRx CareOps deployment profile

CareOps can be built and started independently from the main DoctaRx frontend, using this repository and the existing authenticated backend. This profile does not start Express, create a database, provision an institution, grant clinical/reporting access, or activate SSO. A hostname is a product entry point, not an authorization boundary.

## Configuration and commands

Use `config/careops.env.example` as a configuration template. Supply approved values through the deployment environment or a private environment file. Its `.invalid` hosts are intentionally rejected by production validation; they are not proposed deployment domains.

| Setting | Meaning |
| --- | --- |
| `DOCTARX_PRODUCT_PROFILE=careops` | Select the CareOps product. The public profile must agree; the provided launcher sets both. Omission preserves the existing main platform. |
| `DOCTARX_DEPLOYMENT_ID` | Bounded release identity, distinct from clinical institution or market permissions. |
| `NEXT_PUBLIC_APP_URL` | The approved frontend HTTPS origin. No embedded credentials, path, query, or fragment. HTTP loopback is permitted for local validation. |
| `NEXT_PUBLIC_API_URL=/api` | Keep authentication and MFA requests same-origin. Cross-site direct API cookies are not silently enabled. |
| `DOCTARX_API_PROXY_TARGET` | Explicit origin or `/api` base of the existing shared backend. Next proxies `/api/*`; `/socket.io/*` uses the same backend origin. It cannot point back at the frontend. |
| `NEXT_DIST_DIR=.next-careops` | Isolated build artifacts. A bounded `.next-careops-...` name is also supported. Main `.next` artifacts remain separate. |
| `CAREOPS_MEDIA_ORIGINS` | Optional comma-separated exact approved HTTPS/WSS transport origins. The CareOps CSP grants no wildcard network access. Actual media acceptance remains required. |
| `PORT`, `CAREOPS_HOST` | Frontend listening address; defaults to port 3000 and `0.0.0.0`. |

With these variables supplied:

```sh
npm run careops:validate
npm run careops:build
npm run careops:start
```

Alternatively, a supported Node release can load an operator-managed file explicitly:

```sh
node --env-file=.env.careops scripts/careops-profile.cjs validate
node --env-file=.env.careops scripts/careops-profile.cjs build
node --env-file=.env.careops scripts/careops-profile.cjs start
```

The build records its product, deployment ID, frontend origin, API target, media origins and actual Next build ID in its private artifact directory. Startup rejects a runtime mismatch. Starting a rebuild invalidates the previous attestation; a failed rebuild cannot start as a completed release. Rebuild when changing these settings. `ecosystem.careops.config.cjs` is an optional single-process PM2 frontend configuration; its environment must be supplied by the operator. The existing main process configuration and `npm start` remain unchanged. Express rejects the CareOps product profile to prevent accidentally starting another backend.

Do not copy the backend's database URL, signing/encryption keys, gateway credentials, or government integration secrets into this frontend deployment. The frontend release endpoint `/careops/release` returns only product/deployment/build identity, with no clinical records, private proxy URL or secrets. CareOps deployment update checks use this frontend identity rather than the backend's bundle ID.

## Shared-backend authentication

For an institution origin that cannot use the existing domain cookies, configure `AUTH_COOKIE_DOMAIN_MODE=host-only` on the existing shared backend. The existing default remains unchanged. Host-only mode preserves HttpOnly, production Secure, SameSite and MFA attestation protections; login and logout also clear the previous configured domain cookies so they cannot shadow the new session. The proxy must preserve authorization headers and Set-Cookie responses. Browser/proxy acceptance is required on the actual domain before opening access.

Sign-in, sign-out, session expiry and required password rotation stay within `/careops`. Return destinations are restricted to actual CareOps workspaces; external URLs and login/password loops are rejected. Password changes use the existing authenticated current-password endpoint, server policy, token rotation and audit. The profile supplies no password reset, account seed, role elevation or MFA bypass.

Authentication cookie writes are serialized across tabs using the browser's Web Locks API. A secure supported browser is required; missing coordination fails before sending a cookie mutation. Cross-tab account changes invalidate pending responses and clear the previous view until the current account is confirmed by the backend. Refresh uses the explicit stored session token, checks the intended bearer account when supplied, and never substitutes another account's shared-domain cookie. Logout revocation is scoped to the authenticated owner. Separate application origins should use host-only cookies to avoid shared-domain logout/MFA interference.

Navigation is based on current programme contexts and successful scoped public-health/report access checks. Unknown access is not treated as granted. Each API still checks current account, programme, facility, jurisdiction, assignment, consent and action authority. Direct navigation to a restricted page retains its actual API denial. Institutional access and staff provisioning remain deliberate administrative operations.

## Branding, installation and privacy

The entry and generic sign-in redirect to CareOps. Titles and installation identity use DoctaRx CareOps without selecting a country. The CareOps manifest starts within its workspace, has a separate installation ID, and contains no consumer or country-specific shortcuts. CareOps documents receive noindex headers, dedicated robots/sitemap responses, and no consumer analytics. Clinical views are excluded from service-worker page caching; installing the app does not promise offline clinical operations or video.

## Validation and activation limits

`server/tests/careops-deployment-profile.test.js` checks unsafe configuration, preservation of the default main configuration, build/start identity matching, actual Next redirects/proxy/security headers, bounded auth return paths, actual API expiry/password interception, navigation capabilities and HTTP cookie attributes/legacy clearing. `server/tests/auth-session-races.test.js` exercises delayed login/logout/refresh/password completions, independent tab storage and cookie ordering, replacement sign-in denial/MFA and HTTP session-token binding. The profile browser command reuses the existing isolated-database nurse/government accounts through a real same-origin proxy, preserving MFA and current API denials. It does not seed or reset accounts. Set `CAREOPS_PROFILE_PRODUCTION_E2E=true` to verify the actual isolated production build through the profile launcher; the default command retains the existing development preview behavior.

Supply `CAREOPS_E2E_PASSWORD` for the existing isolated test accounts. The browser runner verifies the configured password against those accounts before making sign-in attempts, without printing or changing credentials. CI supplies its own isolated fixture credential. Local credentials need not equal that fixture value.

On October 14, 2026, the 12 auth-session tests and six deployment-profile tests passed with no skips; scoped lint passed. An isolated production build completed successfully, and the actual profile launcher started that built release against the existing loopback test API. The production browser run passed 13 checks covering entry/release/installation identity, nurse sign-in and scoped navigation, government MFA, insurance/clinical-FHIR/national-analytics denial, CareOps logout return, report/executive read-only views, 16px body text and mobile width. The settled clinical and government screens had no serious or critical automated accessibility violations. Four screenshots and the two accessibility reports remain private test evidence under `work/careops-profile-validation`; existing database fixture labels are not changed or presented as real clinical records. The browser and API processes closed after the run. These checks used HTTP loopback, not an institution's provisioned HTTPS deployment.

Actual institution DNS/TLS, reverse-proxy trust/IP forwarding, any host-specific origin policy, WebSocket upgrades, SFU/TURN/media transport, invited forced-password journeys, identity/SSO and institutional acceptance remain deployment gates. No actual domain or SSO credentials are assumed. This increment does not certify live video, real payment collection, government transmission or EHR connectivity. Main-platform and CareOps clinical acceptance, manual accessibility testing, operations, restore/rollback, and partner activation gates remain in the scope ledger.
