# Environment Variables

Never put real values in this document or Git. Validate production variables through the secret manager and deployment environment.

## Required platform secrets

| Variable group | Purpose | Rule |
|---|---|---|
| `DATABASE_URL`, optional `PGSSLROOTCERT`, DB pool/timeouts | Primary PostgreSQL | TLS and least-privilege database role required. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` | Tokens, sessions and encrypted integration settings | Independent high-entropy secrets; rotate through a documented procedure. |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, `COOKIE_DOMAIN`, `PORT`, `NODE_ENV` | Runtime origin/cookies | HTTPS production origin; `NODE_ENV=production`. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring | Do not send PHI or secrets; sampling requires privacy review. |

## Nigeria video

- LiveKit: `NG_LIVEKIT_URL`, `NG_LIVEKIT_API_KEY`, `NG_LIVEKIT_API_SECRET`.
- TURN: `NG_TURN_SHARED_SECRET` or the approved TURN URL/username/credential variables.
- Browser ICE: only public server URLs and short-lived credentials may use `NEXT_PUBLIC_*`; never expose shared secrets.
- Safety gates: `REQUIRE_LIVEKIT_E2E`, `REQUIRE_TURN_RELAY` in controlled validation.

## Government and DHIS2

- `DHIS2_ALLOW_LIVE_SYNC` defaults disabled and must only be enabled under an approved change.
- DHIS2 endpoint and credentials are stored encrypted in the database; they are not public variables.
- `NG_MEDICAL_IMAGING_AUTHORIZED` and `NEXT_PUBLIC_NG_MEDICAL_IMAGING_AUTHORIZED` both default false/unset.
- `PUBLIC_HEALTH_DEMO_SEED`, `DEMO_MODE`, `NG_AUTO_SEED_DISCOVERY` must be reviewed and disabled for live institutional data unless explicitly required.

## Optional providers

Payment (`PAYSTACK_*`, `FLUTTERWAVE_*`, `STRIPE_*`), communication (`SMTP_*`, `SENDGRID_*`, `TERMII_*`, WhatsApp), delivery, claims, e-prescribing, AI and social variables are only required when the corresponding feature is approved and enabled. Missing credentials must produce an unavailable/disabled state, never a fake successful integration.

## Validation

The deployment pipeline must check presence without printing values, reject known placeholders, confirm HTTPS/provider origins and report the build SHA. Rotate any secret that appears in terminal, logs, tickets or Git history.
