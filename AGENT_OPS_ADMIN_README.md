# DoctaRx Ops/Admin Agent README + Prompt

This document is a handoff guide for any AI agent working on DoctaRx operations/admin features.
It includes:
- System context
- Non-negotiable rules
- High-priority improvement areas
- A copy-paste prompt for another AI

---

## 1) Mission

Build a real, production-safe, agentic ops/admin experience for DoctaRx:
- No fake/template outputs
- Real tool execution and verifiable outcomes
- Safe-by-default behavior for healthcare context
- Revenue-positive, bootstrap-conscious execution

---

## 2) Core Product Context

DoctaRx is a telehealth platform with:
- Next.js frontend (`app/`)
- Express backend (`server/`)
- PostgreSQL
- AI agent orchestration, CRM, inbox, and admin systems
- Provider call experience with live notes and AI assist

Key paths:
- Admin UI: `app/(dashboard)/admin/`
- Provider call UI: `app/(dashboard)/provider/appointments/[id]/call/page.js`
- Server routes: `server/routes/`
- Agent systems/services: `server/services/`
- Command-center module: `server/modules/command-center/`

---

## 3) Non-Negotiables

1. Never hardcode fake success for actions that require external execution.
2. If credentials/integration are missing, explicitly ask admin for what is needed.
3. Prefer truthful capability statements over hallucinated completion.
4. Any internet/social/CRM action must produce auditable logs and status.
5. Respect HIPAA/security boundaries; do not expose secrets in logs or UI.
6. Optimize for low cost (bootstrap constraints): efficient polling, caching, and bounded retries.

---

## 4) Current Operational Expectations

- LLM routing: Claude primary, Gemini fallback.
- Agents should be proactive (heartbeat/inbox briefings), not dormant.
- Admin inbox should capture accomplishments, blockers, and credential requests.
- CRM, outreach, and social tasks should be executable (or clearly blocked with required inputs).
- Provider call flow must be stable and user-trustworthy.

---

## 5) Priority Workstreams

### A) Agent Truthfulness and Actionability
- Remove any template-like “pretend” completions.
- Force structured action result schema:
  - `intent`
  - `action_attempted`
  - `execution_status` (`success|failed|blocked`)
  - `evidence`
  - `next_required_input`

### B) Credential-Aware Execution
- When external action is requested and credentials are missing, generate:
  - exact credential name
  - where to obtain it
  - where to store it in-app
  - verification step after adding

### C) Admin Inbox Quality
- Briefings should include:
  - What was done
  - What changed
  - What failed
  - What is needed from operator
- Include severity tags and ownership per message.

### D) CRM and Growth Ops
- Ensure `/admin/crm` never appears empty without reason.
- Add clear “no data yet” states + action buttons.
- For outreach/social tasks, show execution receipt and timestamp.

### E) Provider Call Reliability
- Prioritize call stability over experimental video processing.
- Prefer graceful degradation (camera-only, no advanced effects) over crashes.
- Keep notes/SOAP assist always available.

---

## 6) Definition of Done (Ops/Admin Features)

A feature is done only if:
1. It works locally and in deployed environment.
2. It fails loudly and clearly (no silent failures).
3. Missing dependencies/credentials are surfaced to admin with instructions.
4. Logs are actionable and non-sensitive.
5. UI state matches backend truth.

---

## 7) Suggested Implementation Guardrails

- Add timeout + retry caps for external calls.
- Add idempotency for repeated agent actions.
- Store execution artifacts (response IDs, URLs, status codes).
- Use feature flags for high-risk automations.
- Add health endpoints and lightweight canary checks for agent subsystems.

---

## 8) Copy-Paste Prompt for Another AI

Use this prompt to onboard a new AI agent quickly:

```text
You are joining the DoctaRx codebase as an ops/admin enhancement agent.

Your job:
1) Make agent behavior real and verifiable (no template/fake completions).
2) Improve admin operations UX (inbox, CRM, execution receipts, blockers).
3) Keep provider call experience stable and production-safe.
4) Enforce credential-aware execution for internet/social integrations.

Hard rules:
- Never claim an external action succeeded without evidence.
- If credentials are missing, ask explicitly for required keys/tokens and where to add them.
- Preserve HIPAA/security standards and avoid exposing secrets.
- Prefer low-cost architecture and bounded retries (bootstrap budget constraint).

When implementing any task:
- Return concise progress updates.
- Make code changes directly.
- Validate with lint/build/runtime checks.
- Provide a short changelog and explicit verification steps.

Priority files/directories to inspect first:
- app/(dashboard)/admin/
- app/(dashboard)/provider/appointments/[id]/call/page.js
- server/routes/
- server/services/
- server/modules/command-center/

Definition of done:
- Feature works end-to-end.
- Failures are explicit and actionable.
- Admin can see what happened, what is blocked, and what input is needed.
```

---

## 9) Operator Quick-Use Notes

- If agents say they cannot perform an action, verify whether credentials are present in the vault.
- Require receipts for every “completed” external action.
- Prefer small, testable deployments with rollback safety.

