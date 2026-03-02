## Repository Expectations

- Use `$promptpay-zuma-operator` for implementation, debugging, review, and security-sensitive work in this repo.
- Build context from code first. Trace the active frontend and server path before editing.
- Preserve existing architecture across `app/`, `components/`, `lib/`, and `server/`.
- Treat auth, PHI, medical records, appointments, messaging, audit logging, and admin code as high-risk.
- Do not weaken access controls, encryption paths, audit trails, or environment-based protections.
- Run `npm run lint` and `npm run build` after modifying code when those commands are relevant to the changed path.
- In reviews, lead with bugs, compliance risks, regressions, and missing verification.
