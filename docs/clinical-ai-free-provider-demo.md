# Cost-conscious Clinical Copilot inference: synthetic demos only

The Clinical Copilot source-bound draft/review gate remains intact. It previously
supported only the 'anthropic' inference provider. This feature branch introduces
a second opt-in provider ('groq') for synthetic non-production demonstration
data only. It does not authorize use with actual patient records.

## Synthetic demo configuration

Set these in the server environment, not in a browser or committed file:

    NODE_ENV=development
    CLINICAL_AI_PROVIDER=groq
    CLINICAL_AI_MODEL=openai/gpt-oss-20b
    GROQ_API_KEY=<private-key>
    CLINICAL_AI_ALLOW_DEMO_GROQ=true
    CLINICAL_AI_ENCRYPTION_KEY=<existing-32-byte-protected-storage-key>

The relevant programme must separately enable Clinical AI. Do not configure the
production application with these development settings or use them for real
patient data. For tests, NODE_ENV=test is also permitted.

- Fail closed for production, unknown environments, non-demo programmes,
  absent opt-in, missing credentials, unsupported model names or provider errors.
- Provider endpoint is fixed to Groq; no arbitrary destination URLs.
- Existing clinician authorization, source reference validation, encryption,
  audit, 24-hour expiry, record lineage and review/signature gates are unchanged.
- No automatic fallback to another external provider. Rate-limit failures return
  a controlled unavailable response and must not leak upstream response content.
- No real-patient transfers are approved by this change. Live use requires
  separately reviewed provider terms, regional privacy requirements, clinical
  evaluation and explicit release authorization.

Model and free-tier quotas change independently of source code. Confirm the
account's live quotas before demonstrations. The existing Anthropic adapter is
unchanged.
